/**
 * Clips Plugin
 *
 * Create and manage Twitch clips
 * Features:
 * - !clip command to create clips
 * - Auto-clip on events
 * - Clip queue management
 * - Recent clips display
 */

import { Plugin } from '../base/Plugin';
import { PluginMeta, Permission } from '../../types/plugins';
import { getDatabase, DatabaseService } from '../../services/Database';

interface Clip {
  id: string;
  url: string;
  embedUrl: string;
  title: string;
  creatorName: string;
  gameId: string;
  viewCount: number;
  createdAt: Date;
}

interface ClipsSettings {
  enabled: boolean;
  cooldown: number;
  autoClipOnHighlight: boolean;
  autoClipOnRaid: boolean;
  minRaidViewers: number;
  announceClips: boolean;
  announcementTemplate: string;
}

const DEFAULT_SETTINGS: ClipsSettings = {
  enabled: true,
  cooldown: 30,
  autoClipOnHighlight: false,
  autoClipOnRaid: false,
  minRaidViewers: 10,
  announceClips: true,
  announcementTemplate: '🎬 Clip erstellt: {url}',
};

export class ClipsPlugin extends Plugin {
  meta: PluginMeta = {
    name: 'clips',
    version: '1.0.0',
    description: 'Create and manage Twitch clips',
    author: 'StreamCore',
  };

  private db!: DatabaseService;
  private settings: ClipsSettings = DEFAULT_SETTINGS;
  private recentClips: Clip[] = [];
  private lastClipTime = 0;
  private accessToken = '';
  private clientId = '';
  private broadcasterId = '';

  protected async init(): Promise<void> {
    this.db = getDatabase();
    this.log.info('Initializing Clips...');

    this.initTables();
    this.loadSettings();
    this.setupEventHandlers();
    this.registerCommands();

    this.log.info('Clips initialized!');
  }

  protected async destroy(): Promise<void> {}

  private initTables(): void {
    const db = this.db.raw();
    db.exec(`
      CREATE TABLE IF NOT EXISTS clips (
        id TEXT PRIMARY KEY,
        url TEXT NOT NULL,
        embed_url TEXT,
        title TEXT,
        creator_name TEXT NOT NULL,
        game_id TEXT,
        view_count INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_clips_creator ON clips(creator_name);
      CREATE INDEX IF NOT EXISTS idx_clips_date ON clips(created_at);
    `);
  }

  private loadSettings(): void {
    const saved = this.db.getSetting<ClipsSettings>('clips_settings');
    if (saved) {
      this.settings = { ...DEFAULT_SETTINGS, ...saved };
    }

    // Load API credentials
    const tokens = this.db.getSetting<any>('twitch_tokens');
    if (tokens) {
      this.accessToken = tokens.accessToken || '';
      this.clientId = tokens.clientId || process.env.TWITCH_CLIENT_ID || '';
      this.broadcasterId = tokens.broadcasterId || '';
    }
  }

  private saveSettings(): void {
    this.db.setSetting('clips_settings', this.settings);
  }

  private setupEventHandlers(): void {
    // Auto-clip on raid if enabled
    this.ctx.events.on('twitch:raid', (event: any) => {
      if (this.settings.autoClipOnRaid && event.viewers >= this.settings.minRaidViewers) {
        this.createClip(`Raid von ${event.fromUserName}`);
      }
    });

    // Auto-clip on highlight event
    this.ctx.events.on('stream:highlight', () => {
      if (this.settings.autoClipOnHighlight) {
        this.createClip('Highlight');
      }
    });
  }

  private async createClip(title?: string): Promise<Clip | null> {
    if (!this.accessToken || !this.broadcasterId) {
      this.log.error('Missing Twitch API credentials');
      return null;
    }

    // Check cooldown
    const now = Date.now();
    if (now - this.lastClipTime < this.settings.cooldown * 1000) {
      this.log.warn('Clip cooldown active');
      return null;
    }

    try {
      const response = await fetch('https://api.twitch.tv/helix/clips', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.accessToken}`,
          'Client-Id': this.clientId,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          broadcaster_id: this.broadcasterId,
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        this.log.error(`Failed to create clip: ${error}`);
        return null;
      }

      const data = await response.json() as { data: any[] };
      const clipId = data.data[0]?.id;

      if (!clipId) {
        this.log.error('No clip ID returned');
        return null;
      }

      this.lastClipTime = now;

      // Wait a moment for the clip to be processed
      await new Promise((resolve) => setTimeout(resolve, 5000));

      // Get clip details
      const clip = await this.getClipDetails(clipId);
      if (clip) {
        // Save to database
        this.saveClip(clip);

        // Add to recent clips
        this.recentClips.unshift(clip);
        if (this.recentClips.length > 20) {
          this.recentClips.pop();
        }

        return clip;
      }

      return null;
    } catch (error) {
      this.log.error(`Error creating clip: ${error}`);
      return null;
    }
  }

  private async getClipDetails(clipId: string): Promise<Clip | null> {
    try {
      const response = await fetch(`https://api.twitch.tv/helix/clips?id=${clipId}`, {
        headers: {
          'Authorization': `Bearer ${this.accessToken}`,
          'Client-Id': this.clientId,
        },
      });

      if (!response.ok) {
        return null;
      }

      const data = await response.json() as { data: any[] };
      const clipData = data.data[0];

      if (!clipData) {
        return null;
      }

      return {
        id: clipData.id,
        url: clipData.url,
        embedUrl: clipData.embed_url,
        title: clipData.title,
        creatorName: clipData.creator_name,
        gameId: clipData.game_id,
        viewCount: clipData.view_count,
        createdAt: new Date(clipData.created_at),
      };
    } catch (error) {
      this.log.error(`Error getting clip details: ${error}`);
      return null;
    }
  }

  private saveClip(clip: Clip): void {
    const db = this.db.raw();
    const stmt = db.prepare(`
      INSERT OR REPLACE INTO clips (id, url, embed_url, title, creator_name, game_id, view_count, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      clip.id,
      clip.url,
      clip.embedUrl,
      clip.title,
      clip.creatorName,
      clip.gameId,
      clip.viewCount,
      clip.createdAt.toISOString()
    );
  }

  private registerCommands(): void {
    // !clip - Create a clip
    this.registerCommand({
      name: 'clip',
      aliases: ['clap', 'highlight'],
      description: 'Create a clip of the current stream',
      usage: '!clip [title]',
      cooldown: { user: 30, global: 10 },
      handler: async (ctx) => {
        if (!this.settings.enabled) {
          ctx.reply('🎬 Clips sind deaktiviert');
          return;
        }

        const title = ctx.args.join(' ') || undefined;
        ctx.reply('🎬 Erstelle Clip...');

        const clip = await this.createClip(title);
        if (clip) {
          if (this.settings.announceClips) {
            const message = this.settings.announcementTemplate
              .replace('{url}', clip.url)
              .replace('{title}', clip.title)
              .replace('{creator}', ctx.user.displayName);
            ctx.reply(message);
          }
        } else {
          ctx.reply('❌ Clip konnte nicht erstellt werden');
        }
      },
    });

    // !clips - View recent clips
    this.registerCommand({
      name: 'clips',
      aliases: ['recentclips'],
      description: 'View recent clips',
      cooldown: { user: 10, global: 5 },
      handler: async (ctx) => {
        if (this.recentClips.length === 0) {
          // Load from database
          const db = this.db.raw();
          const rows = db.prepare('SELECT * FROM clips ORDER BY created_at DESC LIMIT 5').all() as any[];

          if (rows.length === 0) {
            ctx.reply('🎬 Keine Clips vorhanden');
            return;
          }

          const list = rows.map((r) => r.url).join(' | ');
          ctx.reply(`🎬 Letzte Clips: ${list}`);
        } else {
          const list = this.recentClips.slice(0, 3).map((c) => c.url).join(' | ');
          ctx.reply(`🎬 Letzte Clips: ${list}`);
        }
      },
    });

    // !topclips - View top clips by views
    this.registerCommand({
      name: 'topclips',
      description: 'View most viewed clips',
      cooldown: { user: 30, global: 10 },
      handler: async (ctx) => {
        const db = this.db.raw();
        const rows = db.prepare('SELECT * FROM clips ORDER BY view_count DESC LIMIT 3').all() as any[];

        if (rows.length === 0) {
          ctx.reply('🎬 Keine Clips vorhanden');
          return;
        }

        const list = rows.map((r) => `${r.title || 'Clip'} (${r.view_count} views)`).join(' | ');
        ctx.reply(`🏆 Top Clips: ${list}`);
      },
    });

    // !clipconfig - Configure clips
    this.registerCommand({
      name: 'clipconfig',
      description: 'Configure clip settings',
      usage: '!clipconfig <setting> <value>',
      permission: Permission.MODERATOR,
      cooldown: { user: 5, global: 0 },
      handler: async (ctx) => {
        const setting = ctx.args[0]?.toLowerCase();
        const value = ctx.args[1];

        if (!setting) {
          ctx.reply(
            `🎬 Config: Cooldown=${this.settings.cooldown}s | ` +
            `AutoRaid=${this.settings.autoClipOnRaid ? 'An' : 'Aus'} | ` +
            `Announce=${this.settings.announceClips ? 'An' : 'Aus'}`
          );
          return;
        }

        switch (setting) {
          case 'cooldown':
            this.settings.cooldown = parseInt(value) || 30;
            ctx.reply(`✅ Cooldown: ${this.settings.cooldown}s`);
            break;
          case 'autoraid':
            this.settings.autoClipOnRaid = value === 'on' || value === 'an';
            ctx.reply(`✅ Auto-Clip bei Raid: ${this.settings.autoClipOnRaid ? 'An' : 'Aus'}`);
            break;
          case 'announce':
            this.settings.announceClips = value === 'on' || value === 'an';
            ctx.reply(`✅ Clip-Ankündigung: ${this.settings.announceClips ? 'An' : 'Aus'}`);
            break;
          default:
            ctx.reply('❌ Unbekannte Einstellung (cooldown, autoraid, announce)');
            return;
        }

        this.saveSettings();
      },
    });
  }

  // Public API
  getRecentClips(): Clip[] {
    return [...this.recentClips];
  }

  async clipNow(title?: string): Promise<Clip | null> {
    return this.createClip(title);
  }
}
