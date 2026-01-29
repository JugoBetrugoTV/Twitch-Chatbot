/**
 * Raid Manager Plugin
 *
 * Manage outgoing raids with favorites
 * Features:
 * - Quick raid commands
 * - Favorite streamers list
 * - Raid history
 * - Suggested raids
 */

import { Plugin } from '../base/Plugin';
import { PluginMeta, Permission } from '../../types/plugins';
import { getDatabase, DatabaseService } from '../../services/Database';

interface RaidTarget {
  username: string;
  displayName: string;
  favorite: boolean;
  lastRaid: Date | null;
  raidCount: number;
  notes: string;
}

interface RaidHistory {
  id: number;
  targetUsername: string;
  targetDisplayName: string;
  viewerCount: number;
  timestamp: Date;
}

interface RaidSettings {
  enabled: boolean;
  showSuggestions: boolean;
  maxSuggestions: number;
  autoAddRaided: boolean;
}

const DEFAULT_SETTINGS: RaidSettings = {
  enabled: true,
  showSuggestions: true,
  maxSuggestions: 5,
  autoAddRaided: true,
};

export class RaidManagerPlugin extends Plugin {
  meta: PluginMeta = {
    name: 'raidmanager',
    version: '1.0.0',
    description: 'Manage outgoing raids with favorites',
    author: 'StreamCore',
  };

  private db!: DatabaseService;
  private settings: RaidSettings = DEFAULT_SETTINGS;
  private targets: Map<string, RaidTarget> = new Map();

  protected async init(): Promise<void> {
    this.db = getDatabase();
    this.log.info('Initializing Raid Manager...');

    this.initTables();
    this.loadSettings();
    this.loadTargets();
    this.registerCommands();

    this.log.info('Raid Manager initialized!');
  }

  protected async destroy(): Promise<void> {}

  private initTables(): void {
    const db = this.db.raw();
    db.exec(`
      CREATE TABLE IF NOT EXISTS raid_targets (
        username TEXT PRIMARY KEY,
        display_name TEXT,
        favorite INTEGER DEFAULT 0,
        last_raid DATETIME,
        raid_count INTEGER DEFAULT 0,
        notes TEXT
      );

      CREATE TABLE IF NOT EXISTS raid_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        target_username TEXT NOT NULL,
        target_display_name TEXT,
        viewer_count INTEGER DEFAULT 0,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_raid_history_time ON raid_history(timestamp DESC);
    `);
  }

  private loadSettings(): void {
    const saved = this.db.getSetting<RaidSettings>('raidmanager_settings');
    if (saved) {
      this.settings = { ...DEFAULT_SETTINGS, ...saved };
    }
  }

  private saveSettings(): void {
    this.db.setSetting('raidmanager_settings', this.settings);
  }

  private loadTargets(): void {
    const db = this.db.raw();
    const rows = db.prepare('SELECT * FROM raid_targets').all() as any[];

    for (const row of rows) {
      this.targets.set(row.username.toLowerCase(), {
        username: row.username,
        displayName: row.display_name || row.username,
        favorite: row.favorite === 1,
        lastRaid: row.last_raid ? new Date(row.last_raid) : null,
        raidCount: row.raid_count || 0,
        notes: row.notes || '',
      });
    }
  }

  private saveTarget(target: RaidTarget): void {
    const db = this.db.raw();
    db.prepare(`
      INSERT OR REPLACE INTO raid_targets
      (username, display_name, favorite, last_raid, raid_count, notes)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      target.username,
      target.displayName,
      target.favorite ? 1 : 0,
      target.lastRaid?.toISOString() || null,
      target.raidCount,
      target.notes
    );

    this.targets.set(target.username.toLowerCase(), target);
  }

  private deleteTarget(username: string): void {
    const db = this.db.raw();
    db.prepare('DELETE FROM raid_targets WHERE username = ?').run(username);
    this.targets.delete(username.toLowerCase());
  }

  private logRaid(target: RaidTarget, viewerCount: number): void {
    const db = this.db.raw();
    db.prepare(`
      INSERT INTO raid_history (target_username, target_display_name, viewer_count)
      VALUES (?, ?, ?)
    `).run(target.username, target.displayName, viewerCount);

    // Update target stats
    target.lastRaid = new Date();
    target.raidCount++;
    this.saveTarget(target);
  }

  private getFavorites(): RaidTarget[] {
    return Array.from(this.targets.values()).filter((t) => t.favorite);
  }

  private getSuggestions(): RaidTarget[] {
    // Get targets sorted by: favorites first, then by least recently raided
    return Array.from(this.targets.values())
      .sort((a, b) => {
        // Favorites first
        if (a.favorite !== b.favorite) return b.favorite ? 1 : -1;

        // Then by last raid time (oldest first)
        if (!a.lastRaid) return -1;
        if (!b.lastRaid) return 1;
        return a.lastRaid.getTime() - b.lastRaid.getTime();
      })
      .slice(0, this.settings.maxSuggestions);
  }

  private getRecentRaids(limit: number = 5): RaidHistory[] {
    const db = this.db.raw();
    const rows = db.prepare(`
      SELECT * FROM raid_history
      ORDER BY timestamp DESC
      LIMIT ?
    `).all(limit) as any[];

    return rows.map((row) => ({
      id: row.id,
      targetUsername: row.target_username,
      targetDisplayName: row.target_display_name,
      viewerCount: row.viewer_count,
      timestamp: new Date(row.timestamp),
    }));
  }

  private registerCommands(): void {
    // !raid - Start a raid
    this.registerCommand({
      name: 'raid',
      description: 'Start a raid to a channel',
      usage: '!raid <channel>',
      permission: Permission.MODERATOR,
      cooldown: { user: 0, global: 0 },
      handler: async (ctx) => {
        const targetChannel = ctx.args[0]?.replace('@', '').toLowerCase();

        if (!targetChannel) {
          // Show suggestions
          const suggestions = this.getSuggestions();
          if (suggestions.length > 0) {
            const list = suggestions.map((t) => t.displayName + (t.favorite ? ' ⭐' : '')).join(', ');
            ctx.reply(`🎯 Raid-Vorschläge: ${list} | Usage: !raid <channel>`);
          } else {
            ctx.reply('❌ Usage: !raid <channel>');
          }
          return;
        }

        // Get or create target
        let target = this.targets.get(targetChannel);
        if (!target && this.settings.autoAddRaided) {
          target = {
            username: targetChannel,
            displayName: targetChannel,
            favorite: false,
            lastRaid: null,
            raidCount: 0,
            notes: '',
          };
        }

        // Log the raid
        if (target) {
          this.logRaid(target, 0); // Viewer count unknown at this point
        }

        // Send raid command
        ctx.reply(`/raid ${targetChannel}`);
        this.ctx.events.emit('chat:send', `🎯 Raid zu ${target?.displayName || targetChannel}! Auf geht's!`);
      },
    });

    // !raidfav - Raid a random favorite
    this.registerCommand({
      name: 'raidfav',
      aliases: ['raidfavorite'],
      description: 'Raid a random favorite streamer',
      permission: Permission.MODERATOR,
      cooldown: { user: 0, global: 0 },
      handler: async (ctx) => {
        const favorites = this.getFavorites();

        if (favorites.length === 0) {
          ctx.reply('❌ Keine Favoriten vorhanden. Füge mit !addfav hinzu');
          return;
        }

        // Pick random favorite
        const target = favorites[Math.floor(Math.random() * favorites.length)];
        this.logRaid(target, 0);

        ctx.reply(`/raid ${target.username}`);
        this.ctx.events.emit('chat:send', `🎯 Raid zu ${target.displayName}! ⭐`);
      },
    });

    // !addfav - Add favorite
    this.registerCommand({
      name: 'addfav',
      aliases: ['addfavorite', 'raidadd'],
      description: 'Add channel to favorites',
      usage: '!addfav <channel> [notes]',
      permission: Permission.MODERATOR,
      cooldown: { user: 0, global: 0 },
      handler: async (ctx) => {
        const channel = ctx.args[0]?.replace('@', '').toLowerCase();
        if (!channel) {
          ctx.reply('❌ Usage: !addfav <channel> [notes]');
          return;
        }

        const notes = ctx.args.slice(1).join(' ');

        let target = this.targets.get(channel);
        if (target) {
          target.favorite = true;
          if (notes) target.notes = notes;
        } else {
          target = {
            username: channel,
            displayName: channel,
            favorite: true,
            lastRaid: null,
            raidCount: 0,
            notes,
          };
        }

        this.saveTarget(target);
        ctx.reply(`⭐ ${channel} zu Favoriten hinzugefügt`);
      },
    });

    // !removefav - Remove favorite
    this.registerCommand({
      name: 'removefav',
      aliases: ['delfav', 'raidremove'],
      description: 'Remove channel from favorites',
      usage: '!removefav <channel>',
      permission: Permission.MODERATOR,
      cooldown: { user: 0, global: 0 },
      handler: async (ctx) => {
        const channel = ctx.args[0]?.replace('@', '').toLowerCase();
        if (!channel) {
          ctx.reply('❌ Usage: !removefav <channel>');
          return;
        }

        const target = this.targets.get(channel);
        if (target) {
          target.favorite = false;
          this.saveTarget(target);
          ctx.reply(`✅ ${channel} von Favoriten entfernt`);
        } else {
          ctx.reply(`❌ ${channel} nicht in der Liste`);
        }
      },
    });

    // !raidlist - Show favorites
    this.registerCommand({
      name: 'raidlist',
      aliases: ['favorites', 'favs'],
      description: 'Show favorite raid targets',
      cooldown: { user: 15, global: 5 },
      handler: async (ctx) => {
        const favorites = this.getFavorites();

        if (favorites.length === 0) {
          ctx.reply('⭐ Keine Favoriten vorhanden');
          return;
        }

        const list = favorites.slice(0, 10).map((t) => t.displayName).join(', ');
        ctx.reply(`⭐ Favoriten (${favorites.length}): ${list}`);
      },
    });

    // !raidhistory - Show recent raids
    this.registerCommand({
      name: 'raidhistory',
      aliases: ['lastraids'],
      description: 'Show recent raids',
      cooldown: { user: 15, global: 5 },
      handler: async (ctx) => {
        const history = this.getRecentRaids(5);

        if (history.length === 0) {
          ctx.reply('📜 Keine Raid-Historie');
          return;
        }

        const list = history.map((r) => {
          const date = r.timestamp.toLocaleDateString('de-DE');
          return `${r.targetDisplayName} (${date})`;
        }).join(' | ');

        ctx.reply(`📜 Letzte Raids: ${list}`);
      },
    });

    // !raidstats - Show raid statistics
    this.registerCommand({
      name: 'raidstats',
      description: 'Show raid statistics',
      cooldown: { user: 30, global: 10 },
      handler: async (ctx) => {
        const db = this.db.raw();

        const totalRaids = (db.prepare('SELECT COUNT(*) as count FROM raid_history').get() as any).count;
        const uniqueTargets = (db.prepare('SELECT COUNT(DISTINCT target_username) as count FROM raid_history').get() as any).count;
        const favorites = this.getFavorites().length;

        // Most raided
        const mostRaided = db.prepare(`
          SELECT target_display_name, COUNT(*) as count
          FROM raid_history
          GROUP BY target_username
          ORDER BY count DESC
          LIMIT 1
        `).get() as any;

        let response = `📊 Raid Stats: ${totalRaids} Raids | ${uniqueTargets} Channels | ${favorites} Favoriten`;
        if (mostRaided) {
          response += ` | Meist geraided: ${mostRaided.target_display_name} (${mostRaided.count}x)`;
        }

        ctx.reply(response);
      },
    });
  }

  // Public API
  getTargets(): RaidTarget[] {
    return Array.from(this.targets.values());
  }

  async raidChannel(channel: string): Promise<void> {
    let target = this.targets.get(channel.toLowerCase());
    if (!target) {
      target = {
        username: channel,
        displayName: channel,
        favorite: false,
        lastRaid: null,
        raidCount: 0,
        notes: '',
      };
    }

    this.logRaid(target, 0);
    this.ctx.events.emit('chat:send', `/raid ${channel}`);
  }
}
