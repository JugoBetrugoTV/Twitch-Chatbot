/**
 * Song Request Plugin
 *
 * Features:
 * - YouTube song requests via URL or search
 * - Queue management
 * - Skip, volume, pause controls
 * - Request limits and cooldowns
 * - Blacklist songs/users
 */

import { Plugin } from '../base/Plugin';
import { PluginMeta, Permission } from '../../types/plugins';
import { getDatabase, DatabaseService } from '../../services/Database';
import { v4 as uuidv4 } from 'uuid';
import playdl from 'play-dl';
import ytdl from 'ytdl-core';

export interface Song {
  id: string;
  title: string;
  url: string;
  duration: number; // seconds
  thumbnail?: string;
  requestedBy: string;
  requestedAt: Date;
}

interface SongRequestSettings {
  enabled: boolean;
  maxQueueSize: number;
  maxSongDuration: number; // seconds
  maxRequestsPerUser: number;
  pointsCost: number;
  subOnly: boolean;
  volume: number; // 0-100
}

const DEFAULT_SETTINGS: SongRequestSettings = {
  enabled: true,
  maxQueueSize: 50,
  maxSongDuration: 600, // 10 minutes
  maxRequestsPerUser: 3,
  pointsCost: 0,
  subOnly: false,
  volume: 50,
};

export class SongRequestPlugin extends Plugin {
  meta: PluginMeta = {
    name: 'songrequest',
    version: '1.0.0',
    description: 'YouTube song request system',
    author: 'StreamCore',
  };

  private db!: DatabaseService;
  private settings: SongRequestSettings = DEFAULT_SETTINGS;
  private queue: Song[] = [];
  private currentSong: Song | null = null;
  private isPlaying: boolean = false;
  private blacklistedSongs: Set<string> = new Set();

  protected async init(): Promise<void> {
    this.db = getDatabase();
    this.log.info('Initializing Song Request system...');

    // Load settings
    const savedSettings = this.db.getSetting<Partial<SongRequestSettings>>('songrequest_settings');
    if (savedSettings) {
      this.settings = { ...DEFAULT_SETTINGS, ...savedSettings };
    }

    // Load blacklist
    const blacklist = this.db.getSetting<string[]>('songrequest_blacklist') || [];
    this.blacklistedSongs = new Set(blacklist);

    this.registerCommands();
    this.log.info('Song Request system initialized!');
  }

  private registerCommands(): void {
    // !sr / !songrequest - Request a song
    this.registerCommand({
      name: 'sr',
      aliases: ['songrequest', 'request', 'play'],
      description: 'Request a song',
      usage: '!sr <YouTube URL or search>',
      cooldown: { user: 10, global: 0 },
      handler: async (ctx) => {
        if (!this.settings.enabled) {
          ctx.reply('❌ Song Requests sind deaktiviert.');
          return;
        }

        if (ctx.args.length === 0) {
          ctx.reply('Verwendung: !sr <YouTube URL oder Suche>');
          return;
        }

        if (this.settings.subOnly && !ctx.user.isSub && !ctx.user.isMod) {
          ctx.reply('❌ Song Requests sind nur für Subs!');
          return;
        }

        // Check queue size
        if (this.queue.length >= this.settings.maxQueueSize) {
          ctx.reply('❌ Die Warteschlange ist voll!');
          return;
        }

        // Check user request limit
        const userRequests = this.queue.filter(
          s => s.requestedBy.toLowerCase() === ctx.user.username.toLowerCase()
        ).length;
        if (userRequests >= this.settings.maxRequestsPerUser && !ctx.user.isMod) {
          ctx.reply(`❌ Du hast bereits ${this.settings.maxRequestsPerUser} Songs in der Queue!`);
          return;
        }

        const query = ctx.args.join(' ');

        try {
          const song = await this.searchSong(query);

          if (!song) {
            ctx.reply('❌ Kein Song gefunden!');
            return;
          }

          if (this.blacklistedSongs.has(song.url)) {
            ctx.reply('❌ Dieser Song ist auf der Blacklist!');
            return;
          }

          if (song.duration > this.settings.maxSongDuration) {
            const maxMin = Math.floor(this.settings.maxSongDuration / 60);
            ctx.reply(`❌ Song ist zu lang! Maximum: ${maxMin} Minuten`);
            return;
          }

          // Check points cost
          if (this.settings.pointsCost > 0) {
            const user = this.db.getUser('twitch', ctx.user.username);
            if (!user || user.points < this.settings.pointsCost) {
              ctx.reply(`❌ Du brauchst ${this.settings.pointsCost} Punkte für einen Song Request!`);
              return;
            }
            this.db.updateUserPoints('twitch', ctx.user.username, -this.settings.pointsCost);
          }

          song.requestedBy = ctx.user.displayName;
          song.requestedAt = new Date();

          this.queue.push(song);

          const position = this.queue.length;
          const durationStr = this.formatDuration(song.duration);

          ctx.reply(
            `🎵 "${song.title}" (${durationStr}) hinzugefügt! ` +
            `Position: #${position} | Angefragt von: ${ctx.user.displayName}`
          );

          // Emit event for dashboard
          this.emit('song:queued' as any, { song, position });

        } catch (error) {
          this.log.error('Song request error:', error);
          ctx.reply('❌ Fehler beim Suchen des Songs!');
        }
      },
    });

    // !queue - Show queue
    this.registerCommand({
      name: 'queue',
      aliases: ['songqueue', 'playlist', 'sq'],
      description: 'Show the song queue',
      cooldown: { user: 10, global: 5 },
      handler: async (ctx) => {
        if (this.queue.length === 0 && !this.currentSong) {
          ctx.reply('📋 Die Warteschlange ist leer.');
          return;
        }

        let response = '';

        if (this.currentSong) {
          response += `🎵 Jetzt: "${this.currentSong.title}" | `;
        }

        if (this.queue.length > 0) {
          const next = this.queue.slice(0, 3).map((s, i) => `${i + 1}. ${s.title}`).join(' | ');
          response += `📋 Queue (${this.queue.length}): ${next}`;
          if (this.queue.length > 3) {
            response += ` ... +${this.queue.length - 3} mehr`;
          }
        }

        ctx.reply(response);
      },
    });

    // !skip - Skip current song
    this.registerCommand({
      name: 'skip',
      aliases: ['next', 'fs'],
      description: 'Skip the current song',
      permission: Permission.MODERATOR,
      cooldown: { user: 0, global: 0 },
      handler: async (ctx) => {
        if (!this.currentSong) {
          ctx.reply('❌ Es spielt gerade kein Song!');
          return;
        }

        const skipped = this.currentSong.title;
        this.currentSong = null;
        this.playNext();

        ctx.reply(`⏭️ "${skipped}" übersprungen!`);
      },
    });

    // !volume - Set volume
    this.registerCommand({
      name: 'volume',
      aliases: ['vol', 'v'],
      description: 'Set the volume',
      usage: '!volume <0-100>',
      permission: Permission.MODERATOR,
      cooldown: { user: 0, global: 0 },
      handler: async (ctx) => {
        if (ctx.args.length === 0) {
          ctx.reply(`🔊 Volume: ${this.settings.volume}%`);
          return;
        }

        const vol = parseInt(ctx.args[0]);
        if (isNaN(vol) || vol < 0 || vol > 100) {
          ctx.reply('❌ Volume muss zwischen 0 und 100 sein!');
          return;
        }

        this.settings.volume = vol;
        this.saveSettings();

        ctx.reply(`🔊 Volume auf ${vol}% gesetzt!`);
        this.emit('song:volume' as any, { volume: vol });
      },
    });

    // !wrongsong - Remove your last request
    this.registerCommand({
      name: 'wrongsong',
      aliases: ['removesong', 'oops'],
      description: 'Remove your last song request',
      cooldown: { user: 5, global: 0 },
      handler: async (ctx) => {
        const index = this.queue.findLastIndex(
          s => s.requestedBy.toLowerCase() === ctx.user.displayName.toLowerCase()
        );

        if (index === -1) {
          ctx.reply('❌ Du hast keine Songs in der Queue!');
          return;
        }

        const removed = this.queue.splice(index, 1)[0];
        ctx.reply(`✅ "${removed.title}" aus der Queue entfernt!`);
      },
    });

    // !currentsong - Show current song
    this.registerCommand({
      name: 'currentsong',
      aliases: ['song', 'np', 'nowplaying'],
      description: 'Show the current song',
      cooldown: { user: 5, global: 0 },
      handler: async (ctx) => {
        if (!this.currentSong) {
          ctx.reply('🎵 Es spielt gerade kein Song.');
          return;
        }

        ctx.reply(
          `🎵 Jetzt spielt: "${this.currentSong.title}" | ` +
          `Angefragt von: ${this.currentSong.requestedBy}`
        );
      },
    });

    // !clearqueue - Clear the queue
    this.registerCommand({
      name: 'clearqueue',
      aliases: ['cq', 'clear'],
      description: 'Clear the song queue',
      permission: Permission.MODERATOR,
      cooldown: { user: 0, global: 0 },
      handler: async (ctx) => {
        const count = this.queue.length;
        this.queue = [];
        ctx.reply(`🗑️ Queue geleert! (${count} Songs entfernt)`);
      },
    });

    // !srblacklist - Blacklist a song
    this.registerCommand({
      name: 'srblacklist',
      aliases: ['srbl', 'bansong'],
      description: 'Blacklist a song',
      usage: '!srblacklist <URL>',
      permission: Permission.MODERATOR,
      cooldown: { user: 0, global: 0 },
      handler: async (ctx) => {
        if (ctx.args.length === 0) {
          ctx.reply('Verwendung: !srblacklist <URL>');
          return;
        }

        const url = ctx.args[0];
        this.blacklistedSongs.add(url);
        this.db.setSetting('songrequest_blacklist', Array.from(this.blacklistedSongs));

        ctx.reply(`✅ Song zur Blacklist hinzugefügt!`);
      },
    });

    // !srtoggle - Toggle song requests
    this.registerCommand({
      name: 'srtoggle',
      description: 'Toggle song requests on/off',
      permission: Permission.MODERATOR,
      cooldown: { user: 0, global: 0 },
      handler: async (ctx) => {
        this.settings.enabled = !this.settings.enabled;
        this.saveSettings();

        ctx.reply(`🎵 Song Requests sind jetzt ${this.settings.enabled ? 'AN' : 'AUS'}!`);
      },
    });

    // !promote - Move a song to the front
    this.registerCommand({
      name: 'promote',
      description: 'Move a song to the front of the queue',
      usage: '!promote <position>',
      permission: Permission.MODERATOR,
      cooldown: { user: 0, global: 0 },
      handler: async (ctx) => {
        if (ctx.args.length === 0) {
          ctx.reply('Verwendung: !promote <position>');
          return;
        }

        const pos = parseInt(ctx.args[0]) - 1;
        if (isNaN(pos) || pos < 0 || pos >= this.queue.length) {
          ctx.reply('❌ Ungültige Position!');
          return;
        }

        const song = this.queue.splice(pos, 1)[0];
        this.queue.unshift(song);

        ctx.reply(`⬆️ "${song.title}" an Position 1 verschoben!`);
      },
    });
  }

  private async searchSong(query: string): Promise<Song | null> {
    try {
      // Check if it's a YouTube URL
      if (ytdl.validateURL(query)) {
        const info = await ytdl.getBasicInfo(query);
        return {
          id: uuidv4(),
          title: info.videoDetails.title,
          url: query,
          duration: parseInt(info.videoDetails.lengthSeconds),
          thumbnail: info.videoDetails.thumbnails[0]?.url,
          requestedBy: '',
          requestedAt: new Date(),
        };
      }

      // Search YouTube using play-dl
      const results = await playdl.search(query, { limit: 1, source: { youtube: 'video' } });

      if (!results || results.length === 0) {
        return null;
      }

      const video = results[0];

      return {
        id: uuidv4(),
        title: video.title || 'Unknown',
        url: video.url,
        duration: video.durationInSec || 0,
        thumbnail: video.thumbnails?.[0]?.url,
        requestedBy: '',
        requestedAt: new Date(),
      };
    } catch (error) {
      this.log.error('Search error:', error);
      return null;
    }
  }

  private parseDuration(duration: string): number {
    const parts = duration.split(':').map(Number);
    if (parts.length === 2) {
      return parts[0] * 60 + parts[1];
    }
    if (parts.length === 3) {
      return parts[0] * 3600 + parts[1] * 60 + parts[2];
    }
    return 0;
  }

  private formatDuration(seconds: number): string {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }

  private playNext(): void {
    if (this.queue.length === 0) {
      this.currentSong = null;
      this.isPlaying = false;
      this.emit('song:ended' as any, {});
      return;
    }

    this.currentSong = this.queue.shift()!;
    this.isPlaying = true;
    this.emit('song:playing' as any, { song: this.currentSong });
  }

  private saveSettings(): void {
    this.db.setSetting('songrequest_settings', this.settings);
  }

  // Public API
  getQueue(): Song[] {
    return [...this.queue];
  }

  getCurrentSong(): Song | null {
    return this.currentSong;
  }

  getSettings(): SongRequestSettings {
    return { ...this.settings };
  }

  skip(): void {
    this.currentSong = null;
    this.playNext();
  }

  pause(): void {
    this.isPlaying = false;
    this.emit('song:paused' as any, {});
  }

  resume(): void {
    this.isPlaying = true;
    this.emit('song:resumed' as any, {});
  }
}
