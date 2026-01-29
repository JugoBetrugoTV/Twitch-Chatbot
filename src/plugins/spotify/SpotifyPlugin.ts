/**
 * Spotify Integration Plugin
 *
 * Features:
 * - Now playing display
 * - Song requests via Spotify
 * - Queue management
 * - Playback control
 */

import { Plugin } from '../base/Plugin';
import { PluginMeta, Permission } from '../../types/plugins';
import { getDatabase, DatabaseService } from '../../services/Database';
import { getCache, CacheService } from '../../services/CacheService';

interface SpotifyTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

interface SpotifyTrack {
  id: string;
  name: string;
  artist: string;
  album: string;
  duration: number;
  uri: string;
  url: string;
}

interface SpotifySettings {
  enabled: boolean;
  clientId: string;
  clientSecret: string;
  allowRequests: boolean;
  maxQueueSize: number;
  blacklistedArtists: string[];
}

const DEFAULT_SETTINGS: SpotifySettings = {
  enabled: true,
  clientId: '',
  clientSecret: '',
  allowRequests: true,
  maxQueueSize: 20,
  blacklistedArtists: [],
};

export class SpotifyPlugin extends Plugin {
  meta: PluginMeta = {
    name: 'spotify',
    version: '1.0.0',
    description: 'Spotify integration for now playing and song requests',
    author: 'StreamCore',
  };

  private db!: DatabaseService;
  private cache!: CacheService;
  private settings: SpotifySettings = DEFAULT_SETTINGS;
  private tokens: SpotifyTokens | null = null;
  private readonly API_BASE = 'https://api.spotify.com/v1';

  protected async init(): Promise<void> {
    this.db = getDatabase();
    this.cache = getCache();
    this.log.info('Initializing Spotify...');

    this.loadSettings();
    this.loadTokens();
    this.registerCommands();

    if (!this.tokens) {
      this.log.warn('Spotify not configured. Use !spotifyauth to set up.');
    }

    this.log.info('Spotify initialized!');
  }

  protected async destroy(): Promise<void> {}

  private loadSettings(): void {
    const saved = this.db.getSetting<SpotifySettings>('spotify_settings');
    if (saved) {
      this.settings = { ...DEFAULT_SETTINGS, ...saved };
    }
  }

  private loadTokens(): void {
    this.tokens = this.db.getSetting<SpotifyTokens>('spotify_tokens') || null;
  }

  private saveTokens(): void {
    if (this.tokens) {
      this.db.setSetting('spotify_tokens', this.tokens);
    }
  }

  private async refreshTokenIfNeeded(): Promise<boolean> {
    if (!this.tokens) return false;

    if (Date.now() >= this.tokens.expiresAt - 60000) {
      return await this.refreshToken();
    }
    return true;
  }

  private async refreshToken(): Promise<boolean> {
    if (!this.tokens || !this.settings.clientId || !this.settings.clientSecret) {
      return false;
    }

    try {
      const response = await fetch('https://accounts.spotify.com/api/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization: `Basic ${Buffer.from(`${this.settings.clientId}:${this.settings.clientSecret}`).toString('base64')}`,
        },
        body: `grant_type=refresh_token&refresh_token=${this.tokens.refreshToken}`,
      });

      if (!response.ok) {
        this.log.error('Failed to refresh Spotify token');
        return false;
      }

      const data = await response.json() as any;
      this.tokens.accessToken = data.access_token;
      this.tokens.expiresAt = Date.now() + data.expires_in * 1000;
      if (data.refresh_token) {
        this.tokens.refreshToken = data.refresh_token;
      }

      this.saveTokens();
      return true;
    } catch (error) {
      this.log.error(`Spotify token refresh error: ${error}`);
      return false;
    }
  }

  private async apiRequest<T>(endpoint: string, method: string = 'GET', body?: any): Promise<T | null> {
    if (!await this.refreshTokenIfNeeded()) {
      return null;
    }

    try {
      const response = await fetch(`${this.API_BASE}${endpoint}`, {
        method,
        headers: {
          Authorization: `Bearer ${this.tokens!.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: body ? JSON.stringify(body) : undefined,
      });

      if (response.status === 204) {
        return {} as T;
      }

      if (!response.ok) {
        return null;
      }

      return await response.json() as T;
    } catch (error) {
      this.log.error(`Spotify API error: ${error}`);
      return null;
    }
  }

  private registerCommands(): void {
    // !song / !np - Now playing
    this.registerCommand({
      name: 'song',
      aliases: ['np', 'nowplaying', 'music'],
      description: 'Show currently playing song',
      cooldown: { user: 10, global: 5 },
      handler: async (ctx) => {
        const track = await this.getCurrentTrack();

        if (!track) {
          ctx.reply('🎵 Gerade läuft nichts auf Spotify');
          return;
        }

        ctx.reply(`🎵 ${track.name} - ${track.artist} | ${track.url}`);
      },
    });

    // !songrequest via Spotify
    this.registerCommand({
      name: 'srs',
      aliases: ['spotifyrequest'],
      description: 'Request a song via Spotify',
      usage: '!srs <song name>',
      cooldown: { user: 30, global: 5 },
      handler: async (ctx) => {
        if (!this.settings.allowRequests) {
          ctx.reply('🎵 Spotify Song-Requests sind deaktiviert');
          return;
        }

        if (ctx.args.length === 0) {
          ctx.reply('Verwendung: !srs <song name>');
          return;
        }

        const query = ctx.args.join(' ');
        const track = await this.searchTrack(query);

        if (!track) {
          ctx.reply('❌ Song nicht gefunden');
          return;
        }

        // Check blacklist
        if (this.settings.blacklistedArtists.some((a) =>
          track.artist.toLowerCase().includes(a.toLowerCase())
        )) {
          ctx.reply('❌ Dieser Artist ist nicht erlaubt');
          return;
        }

        const added = await this.addToQueue(track.uri);

        if (added) {
          ctx.reply(`✅ ${track.name} - ${track.artist} zur Queue hinzugefügt`);
        } else {
          ctx.reply('❌ Fehler beim Hinzufügen zur Queue');
        }
      },
    });

    // !skip - Skip current song (mod)
    this.registerCommand({
      name: 'skipspotify',
      aliases: ['sskip'],
      description: 'Skip current Spotify song',
      permission: Permission.MODERATOR,
      cooldown: { user: 5, global: 3 },
      handler: async (ctx) => {
        const skipped = await this.skipTrack();

        if (skipped) {
          ctx.reply('⏭️ Song übersprungen');
        } else {
          ctx.reply('❌ Fehler beim Überspringen');
        }
      },
    });

    // !pause / !resume - Playback control (mod)
    this.registerCommand({
      name: 'pausespotify',
      aliases: ['spause'],
      description: 'Pause/resume Spotify playback',
      permission: Permission.MODERATOR,
      cooldown: { user: 5, global: 3 },
      handler: async (ctx) => {
        const paused = await this.togglePlayback();
        ctx.reply(paused ? '⏸️ Pausiert' : '▶️ Fortgesetzt');
      },
    });

    // !spotifyauth - Set up Spotify (broadcaster)
    this.registerCommand({
      name: 'spotifyauth',
      description: 'Configure Spotify credentials',
      usage: '!spotifyauth <clientId> <clientSecret> <refreshToken>',
      permission: Permission.BROADCASTER,
      cooldown: { user: 0, global: 0 },
      handler: async (ctx) => {
        if (ctx.args.length < 3) {
          ctx.reply('Verwendung: !spotifyauth <clientId> <clientSecret> <refreshToken>');
          return;
        }

        const [clientId, clientSecret, refreshToken] = ctx.args;

        this.settings.clientId = clientId;
        this.settings.clientSecret = clientSecret;
        this.tokens = {
          accessToken: '',
          refreshToken,
          expiresAt: 0,
        };

        this.db.setSetting('spotify_settings', this.settings);

        // Try to refresh token
        const success = await this.refreshToken();

        if (success) {
          ctx.reply('✅ Spotify erfolgreich verbunden!');
        } else {
          ctx.reply('⚠️ Credentials gespeichert, aber Token-Refresh fehlgeschlagen');
        }
      },
    });

    // !spotifytoggle - Toggle requests
    this.registerCommand({
      name: 'spotifytoggle',
      description: 'Toggle Spotify song requests',
      permission: Permission.MODERATOR,
      cooldown: { user: 5, global: 0 },
      handler: async (ctx) => {
        this.settings.allowRequests = !this.settings.allowRequests;
        this.db.setSetting('spotify_settings', this.settings);
        ctx.reply(`🎵 Spotify Requests: ${this.settings.allowRequests ? 'An' : 'Aus'}`);
      },
    });
  }

  // API Methods
  async getCurrentTrack(): Promise<SpotifyTrack | null> {
    // Check cache first
    const cached = this.cache.get<SpotifyTrack>('spotify:current');
    if (cached) return cached;

    const data = await this.apiRequest<any>('/me/player/currently-playing');

    if (!data || !data.item) return null;

    const track: SpotifyTrack = {
      id: data.item.id,
      name: data.item.name,
      artist: data.item.artists.map((a: any) => a.name).join(', '),
      album: data.item.album.name,
      duration: data.item.duration_ms,
      uri: data.item.uri,
      url: data.item.external_urls.spotify,
    };

    // Cache for 10 seconds
    this.cache.set('spotify:current', track, 10);

    return track;
  }

  async searchTrack(query: string): Promise<SpotifyTrack | null> {
    const data = await this.apiRequest<any>(
      `/search?q=${encodeURIComponent(query)}&type=track&limit=1`
    );

    if (!data?.tracks?.items?.[0]) return null;

    const item = data.tracks.items[0];
    return {
      id: item.id,
      name: item.name,
      artist: item.artists.map((a: any) => a.name).join(', '),
      album: item.album.name,
      duration: item.duration_ms,
      uri: item.uri,
      url: item.external_urls.spotify,
    };
  }

  async addToQueue(uri: string): Promise<boolean> {
    const result = await this.apiRequest(
      `/me/player/queue?uri=${encodeURIComponent(uri)}`,
      'POST'
    );
    return result !== null;
  }

  async skipTrack(): Promise<boolean> {
    const result = await this.apiRequest('/me/player/next', 'POST');
    this.cache.delete('spotify:current');
    return result !== null;
  }

  async togglePlayback(): Promise<boolean> {
    const data = await this.apiRequest<any>('/me/player');

    if (!data) return false;

    if (data.is_playing) {
      await this.apiRequest('/me/player/pause', 'PUT');
      return true;
    } else {
      await this.apiRequest('/me/player/play', 'PUT');
      return false;
    }
  }

  // Public API
  isConfigured(): boolean {
    return this.tokens !== null && !!this.settings.clientId;
  }
}
