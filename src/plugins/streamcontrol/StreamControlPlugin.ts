/**
 * Stream Control Plugin
 *
 * Features:
 * - Change stream title via !title
 * - Change game/category via !game
 * - View current stream info via !streaminfo
 * - Requires Twitch API credentials with channel:manage:broadcast scope
 */

import { Plugin } from '../base/Plugin';
import { PluginMeta, Permission } from '../../types/plugins';
import { getDatabase, DatabaseService } from '../../services/Database';
import { getCache, CacheService } from '../../services/CacheService';

interface TwitchTokens {
  accessToken: string;
  refreshToken?: string;
  clientId: string;
  broadcasterId: string;
}

interface StreamInfo {
  title: string;
  gameName: string;
  gameId: string;
  viewerCount: number;
  startedAt: string | null;
  tags: string[];
}

interface GameInfo {
  id: string;
  name: string;
  boxArtUrl: string;
}

export class StreamControlPlugin extends Plugin {
  meta: PluginMeta = {
    name: 'streamcontrol',
    version: '1.0.0',
    description: 'Control stream title and game via chat',
    author: 'StreamCore',
  };

  private db!: DatabaseService;
  private cache!: CacheService;
  private tokens: TwitchTokens | null = null;
  private readonly API_BASE = 'https://api.twitch.tv/helix';

  protected async init(): Promise<void> {
    this.db = getDatabase();
    this.cache = getCache();
    this.log.info('Initializing Stream Control...');

    // Load tokens from database
    this.tokens = this.db.getSetting<TwitchTokens>('twitch_tokens', null);

    if (!this.tokens) {
      this.log.warn('Twitch API tokens not configured. Use !settoken to configure.');
    }

    // Register commands
    this.registerCommands();

    this.log.info('Stream Control initialized!');
  }

  protected async destroy(): Promise<void> {
    // Cleanup
  }

  private registerCommands(): void {
    // !title - View or set stream title
    this.registerCommand({
      name: 'title',
      aliases: ['settitle'],
      description: 'View or set stream title',
      usage: '!title [new title]',
      cooldown: { user: 5, global: 2 },
      handler: async (ctx) => {
        // View title (everyone)
        if (ctx.args.length === 0) {
          const info = await this.getStreamInfo();
          if (info) {
            ctx.reply(`📺 Titel: ${info.title}`);
          } else {
            ctx.reply('❌ Stream-Informationen nicht verfügbar');
          }
          return;
        }

        // Set title (mod only)
        if (!ctx.user.isMod && !ctx.user.isBroadcaster) {
          ctx.reply('❌ Nur Mods können den Titel ändern!');
          return;
        }

        const newTitle = ctx.args.join(' ');

        if (newTitle.length > 140) {
          ctx.reply('❌ Titel zu lang! (max. 140 Zeichen)');
          return;
        }

        const success = await this.setTitle(newTitle);
        if (success) {
          ctx.reply(`✅ Titel geändert zu: ${newTitle}`);
          this.db.logEvent('title_change', {
            user: ctx.user.username,
            title: newTitle,
          });
        } else {
          ctx.reply('❌ Fehler beim Ändern des Titels. API nicht konfiguriert?');
        }
      },
    });

    // !game - View or set game
    this.registerCommand({
      name: 'game',
      aliases: ['setgame', 'category'],
      description: 'View or set stream game/category',
      usage: '!game [game name]',
      cooldown: { user: 5, global: 2 },
      handler: async (ctx) => {
        // View game (everyone)
        if (ctx.args.length === 0) {
          const info = await this.getStreamInfo();
          if (info) {
            ctx.reply(`🎮 Spiel: ${info.gameName || 'Kein Spiel'}`);
          } else {
            ctx.reply('❌ Stream-Informationen nicht verfügbar');
          }
          return;
        }

        // Set game (mod only)
        if (!ctx.user.isMod && !ctx.user.isBroadcaster) {
          ctx.reply('❌ Nur Mods können das Spiel ändern!');
          return;
        }

        const gameName = ctx.args.join(' ');
        const game = await this.searchGame(gameName);

        if (!game) {
          ctx.reply(`❌ Spiel "${gameName}" nicht gefunden!`);
          return;
        }

        const success = await this.setGame(game.id);
        if (success) {
          ctx.reply(`✅ Spiel geändert zu: ${game.name}`);
          this.db.logEvent('game_change', {
            user: ctx.user.username,
            game: game.name,
            gameId: game.id,
          });
        } else {
          ctx.reply('❌ Fehler beim Ändern des Spiels');
        }
      },
    });

    // !streaminfo - Show stream info
    this.registerCommand({
      name: 'streaminfo',
      aliases: ['stream', 'info'],
      description: 'Show current stream information',
      cooldown: { user: 30, global: 10 },
      handler: async (ctx) => {
        const info = await this.getStreamInfo();

        if (!info) {
          ctx.reply('📺 Stream ist offline oder Info nicht verfügbar');
          return;
        }

        let uptime = '';
        if (info.startedAt) {
          const start = new Date(info.startedAt);
          const now = new Date();
          const diff = Math.floor((now.getTime() - start.getTime()) / 1000);
          const hours = Math.floor(diff / 3600);
          const minutes = Math.floor((diff % 3600) / 60);
          uptime = ` | Uptime: ${hours}h ${minutes}m`;
        }

        ctx.reply(
          `📺 ${info.title} | 🎮 ${info.gameName || 'Kein Spiel'} | ` +
          `👥 ${info.viewerCount} Zuschauer${uptime}`
        );
      },
    });

    // !settoken - Configure Twitch API (broadcaster only)
    this.registerCommand({
      name: 'settoken',
      description: 'Configure Twitch API token',
      usage: '!settoken <clientId> <accessToken> <broadcasterId>',
      permission: Permission.BROADCASTER,
      cooldown: { user: 0, global: 0 },
      handler: async (ctx) => {
        if (ctx.args.length < 3) {
          ctx.reply(
            'Verwendung: !settoken <clientId> <accessToken> <broadcasterId> ' +
            '(Token braucht scope: channel:manage:broadcast)'
          );
          return;
        }

        const [clientId, accessToken, broadcasterId] = ctx.args;

        this.tokens = {
          clientId,
          accessToken,
          broadcasterId,
        };

        this.db.setSetting('twitch_tokens', this.tokens);

        // Test the token
        const info = await this.getStreamInfo();
        if (info !== null) {
          ctx.reply('✅ Twitch API erfolgreich konfiguriert!');
        } else {
          ctx.reply('⚠️ Token gespeichert, aber API-Test fehlgeschlagen. Prüfe die Credentials.');
        }
      },
    });

    // !marker - Create stream marker
    this.registerCommand({
      name: 'marker',
      aliases: ['mark', 'highlight'],
      description: 'Create a stream marker',
      usage: '!marker [description]',
      permission: Permission.MODERATOR,
      cooldown: { user: 30, global: 10 },
      handler: async (ctx) => {
        const description = ctx.args.join(' ') || 'Marker';

        const success = await this.createMarker(description);
        if (success) {
          ctx.reply(`📍 Marker erstellt: ${description}`);
        } else {
          ctx.reply('❌ Fehler beim Erstellen des Markers. Stream muss live sein!');
        }
      },
    });

    // !clip - Create clip
    this.registerCommand({
      name: 'clip',
      aliases: ['makeclip'],
      description: 'Create a clip',
      cooldown: { user: 60, global: 30 },
      handler: async (ctx) => {
        const clip = await this.createClip();
        if (clip) {
          ctx.reply(`🎬 Clip erstellt! ${clip.editUrl}`);
        } else {
          ctx.reply('❌ Fehler beim Erstellen des Clips. Stream muss live sein!');
        }
      },
    });

    // !tags - View or set stream tags
    this.registerCommand({
      name: 'tags',
      aliases: ['settags'],
      description: 'View or set stream tags',
      usage: '!tags [tag1, tag2, ...]',
      cooldown: { user: 10, global: 5 },
      handler: async (ctx) => {
        // View tags (everyone)
        if (ctx.args.length === 0) {
          const info = await this.getStreamInfo();
          if (info && info.tags.length > 0) {
            ctx.reply(`🏷️ Tags: ${info.tags.join(', ')}`);
          } else {
            ctx.reply('🏷️ Keine Tags gesetzt');
          }
          return;
        }

        // Set tags (mod only)
        if (!ctx.user.isMod && !ctx.user.isBroadcaster) {
          ctx.reply('❌ Nur Mods können Tags ändern!');
          return;
        }

        const tags = ctx.args.join(' ').split(',').map((t) => t.trim()).filter((t) => t);

        if (tags.length > 10) {
          ctx.reply('❌ Maximal 10 Tags erlaubt!');
          return;
        }

        const success = await this.setTags(tags);
        if (success) {
          ctx.reply(`✅ Tags gesetzt: ${tags.join(', ')}`);
        } else {
          ctx.reply('❌ Fehler beim Setzen der Tags');
        }
      },
    });
  }

  // ==========================================
  // Twitch API Methods
  // ==========================================

  private async apiRequest<T>(
    endpoint: string,
    method: 'GET' | 'POST' | 'PATCH' = 'GET',
    body?: any
  ): Promise<T | null> {
    if (!this.tokens) {
      this.log.warn('Twitch API not configured');
      return null;
    }

    try {
      const response = await fetch(`${this.API_BASE}${endpoint}`, {
        method,
        headers: {
          Authorization: `Bearer ${this.tokens.accessToken}`,
          'Client-Id': this.tokens.clientId,
          'Content-Type': 'application/json',
        },
        body: body ? JSON.stringify(body) : undefined,
      });

      if (!response.ok) {
        const error = await response.text();
        this.log.error(`API Error: ${response.status} - ${error}`);
        return null;
      }

      if (response.status === 204) {
        return {} as T;
      }

      return (await response.json()) as T;
    } catch (error) {
      this.log.error(`API Request failed: ${error}`);
      return null;
    }
  }

  async getStreamInfo(): Promise<StreamInfo | null> {
    // Check cache first
    const cached = this.cache.get<StreamInfo>('stream:info');
    if (cached) return cached;

    if (!this.tokens) return null;

    const channelData = await this.apiRequest<any>(
      `/channels?broadcaster_id=${this.tokens.broadcasterId}`
    );

    if (!channelData?.data?.[0]) return null;

    const channel = channelData.data[0];

    // Get live stream data
    const streamData = await this.apiRequest<any>(
      `/streams?user_id=${this.tokens.broadcasterId}`
    );

    const stream = streamData?.data?.[0];

    const info: StreamInfo = {
      title: channel.title,
      gameName: channel.game_name,
      gameId: channel.game_id,
      viewerCount: stream?.viewer_count || 0,
      startedAt: stream?.started_at || null,
      tags: channel.tags || [],
    };

    // Cache for 30 seconds
    this.cache.set('stream:info', info, 30);

    return info;
  }

  async setTitle(title: string): Promise<boolean> {
    if (!this.tokens) return false;

    const result = await this.apiRequest(
      `/channels?broadcaster_id=${this.tokens.broadcasterId}`,
      'PATCH',
      { title }
    );

    if (result) {
      // Invalidate cache
      this.cache.delete('stream:info');
    }

    return result !== null;
  }

  async setGame(gameId: string): Promise<boolean> {
    if (!this.tokens) return false;

    const result = await this.apiRequest(
      `/channels?broadcaster_id=${this.tokens.broadcasterId}`,
      'PATCH',
      { game_id: gameId }
    );

    if (result) {
      this.cache.delete('stream:info');
    }

    return result !== null;
  }

  async searchGame(query: string): Promise<GameInfo | null> {
    // Check cache
    const cacheKey = `game:search:${query.toLowerCase()}`;
    const cached = this.cache.get<GameInfo>(cacheKey);
    if (cached) return cached;

    const result = await this.apiRequest<any>(
      `/games?name=${encodeURIComponent(query)}`
    );

    if (!result?.data?.[0]) {
      // Try search instead of exact match
      const searchResult = await this.apiRequest<any>(
        `/search/categories?query=${encodeURIComponent(query)}&first=1`
      );

      if (!searchResult?.data?.[0]) return null;

      const game: GameInfo = {
        id: searchResult.data[0].id,
        name: searchResult.data[0].name,
        boxArtUrl: searchResult.data[0].box_art_url,
      };

      this.cache.set(cacheKey, game, 3600); // Cache 1 hour
      return game;
    }

    const game: GameInfo = {
      id: result.data[0].id,
      name: result.data[0].name,
      boxArtUrl: result.data[0].box_art_url,
    };

    this.cache.set(cacheKey, game, 3600);
    return game;
  }

  async setTags(tags: string[]): Promise<boolean> {
    if (!this.tokens) return false;

    const result = await this.apiRequest(
      `/channels?broadcaster_id=${this.tokens.broadcasterId}`,
      'PATCH',
      { tags }
    );

    if (result) {
      this.cache.delete('stream:info');
    }

    return result !== null;
  }

  async createMarker(description: string): Promise<boolean> {
    if (!this.tokens) return false;

    const result = await this.apiRequest('/stream_markers', 'POST', {
      user_id: this.tokens.broadcasterId,
      description: description.slice(0, 140),
    });

    return result !== null;
  }

  async createClip(): Promise<{ id: string; editUrl: string } | null> {
    if (!this.tokens) return null;

    const result = await this.apiRequest<any>('/clips', 'POST', {
      broadcaster_id: this.tokens.broadcasterId,
    });

    if (!result?.data?.[0]) return null;

    return {
      id: result.data[0].id,
      editUrl: result.data[0].edit_url,
    };
  }

  // Public API
  isConfigured(): boolean {
    return this.tokens !== null;
  }
}
