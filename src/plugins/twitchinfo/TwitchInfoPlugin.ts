/**
 * Twitch Info Plugin
 *
 * Features:
 * - Follow age (!followage)
 * - Account age (!accountage)
 * - User info (!userinfo)
 * - Channel info (!channel)
 */

import { Plugin } from '../base/Plugin';
import { PluginMeta, Permission } from '../../types/plugins';
import { getDatabase, DatabaseService } from '../../services/Database';
import { getCache, CacheService } from '../../services/CacheService';

interface TwitchTokens {
  accessToken: string;
  clientId: string;
  broadcasterId: string;
}

export class TwitchInfoPlugin extends Plugin {
  meta: PluginMeta = {
    name: 'twitchinfo',
    version: '1.0.0',
    description: 'Twitch user and channel information',
    author: 'StreamCore',
  };

  private db!: DatabaseService;
  private cache!: CacheService;
  private tokens: TwitchTokens | null = null;
  private readonly API_BASE = 'https://api.twitch.tv/helix';

  protected async init(): Promise<void> {
    this.db = getDatabase();
    this.cache = getCache();
    this.log.info('Initializing Twitch Info...');

    this.tokens = this.db.getSetting<TwitchTokens>('twitch_tokens', null);
    this.registerCommands();

    this.log.info('Twitch Info initialized!');
  }

  protected async destroy(): Promise<void> {}

  private async apiRequest<T>(endpoint: string): Promise<T | null> {
    if (!this.tokens) return null;

    try {
      const response = await fetch(`${this.API_BASE}${endpoint}`, {
        headers: {
          Authorization: `Bearer ${this.tokens.accessToken}`,
          'Client-Id': this.tokens.clientId,
        },
      });

      if (!response.ok) return null;
      return await response.json() as T;
    } catch {
      return null;
    }
  }

  private registerCommands(): void {
    // !followage - Check follow age
    this.registerCommand({
      name: 'followage',
      aliases: ['fa', 'following'],
      description: 'Check how long you have been following',
      usage: '!followage [user]',
      cooldown: { user: 10, global: 3 },
      handler: async (ctx) => {
        const username = (ctx.args[0] || ctx.user.username).toLowerCase().replace('@', '');

        // Get user ID
        const userId = await this.getUserId(username);
        if (!userId) {
          ctx.reply(`❌ Benutzer ${username} nicht gefunden`);
          return;
        }

        // Get follow info
        const followData = await this.getFollowAge(userId);

        if (!followData) {
          ctx.reply(`❌ ${username} folgt dem Kanal nicht`);
          return;
        }

        const followDate = new Date(followData.followed_at);
        const now = new Date();
        const diff = now.getTime() - followDate.getTime();

        const years = Math.floor(diff / (365 * 24 * 60 * 60 * 1000));
        const months = Math.floor((diff % (365 * 24 * 60 * 60 * 1000)) / (30 * 24 * 60 * 60 * 1000));
        const days = Math.floor((diff % (30 * 24 * 60 * 60 * 1000)) / (24 * 60 * 60 * 1000));

        let duration = '';
        if (years > 0) duration += `${years} Jahr${years > 1 ? 'e' : ''} `;
        if (months > 0) duration += `${months} Monat${months > 1 ? 'e' : ''} `;
        if (days > 0 || duration === '') duration += `${days} Tag${days !== 1 ? 'e' : ''}`;

        ctx.reply(`📅 ${username} folgt seit ${duration.trim()} (${followDate.toLocaleDateString('de-DE')})`);
      },
    });

    // !accountage - Check account age
    this.registerCommand({
      name: 'accountage',
      aliases: ['aa', 'created'],
      description: 'Check account creation date',
      usage: '!accountage [user]',
      cooldown: { user: 10, global: 3 },
      handler: async (ctx) => {
        const username = (ctx.args[0] || ctx.user.username).toLowerCase().replace('@', '');

        const userData = await this.getUserData(username);
        if (!userData) {
          ctx.reply(`❌ Benutzer ${username} nicht gefunden`);
          return;
        }

        const createdDate = new Date(userData.created_at);
        const now = new Date();
        const diff = now.getTime() - createdDate.getTime();

        const years = Math.floor(diff / (365 * 24 * 60 * 60 * 1000));
        const months = Math.floor((diff % (365 * 24 * 60 * 60 * 1000)) / (30 * 24 * 60 * 60 * 1000));
        const days = Math.floor((diff % (30 * 24 * 60 * 60 * 1000)) / (24 * 60 * 60 * 1000));

        let duration = '';
        if (years > 0) duration += `${years} Jahr${years > 1 ? 'e' : ''} `;
        if (months > 0) duration += `${months} Monat${months > 1 ? 'e' : ''} `;
        if (days > 0 || duration === '') duration += `${days} Tag${days !== 1 ? 'e' : ''}`;

        ctx.reply(`🎂 ${username}'s Account ist ${duration.trim()} alt (${createdDate.toLocaleDateString('de-DE')})`);
      },
    });

    // !userinfo - Get user info
    this.registerCommand({
      name: 'userinfo',
      aliases: ['ui', 'whois'],
      description: 'Get detailed user information',
      usage: '!userinfo [user]',
      cooldown: { user: 15, global: 5 },
      handler: async (ctx) => {
        const username = (ctx.args[0] || ctx.user.username).toLowerCase().replace('@', '');

        const userData = await this.getUserData(username);
        if (!userData) {
          ctx.reply(`❌ Benutzer ${username} nicht gefunden`);
          return;
        }

        const dbUser = this.db.getUser('twitch', username);
        const createdDate = new Date(userData.created_at);

        let info = `👤 ${userData.display_name}`;
        if (userData.broadcaster_type) info += ` [${userData.broadcaster_type}]`;
        info += ` | Account: ${createdDate.toLocaleDateString('de-DE')}`;

        if (dbUser) {
          info += ` | ${dbUser.points.toLocaleString()} Punkte`;
          info += ` | ${dbUser.message_count} Nachrichten`;
        }

        ctx.reply(info);
      },
    });

    // !viewers - Get current viewer count
    this.registerCommand({
      name: 'viewers',
      aliases: ['viewercount', 'zuschauer'],
      description: 'Get current viewer count',
      cooldown: { user: 30, global: 10 },
      handler: async (ctx) => {
        if (!this.tokens) {
          ctx.reply('❌ Twitch API nicht konfiguriert');
          return;
        }

        const streamData = await this.apiRequest<any>(
          `/streams?user_id=${this.tokens.broadcasterId}`
        );

        if (!streamData?.data?.[0]) {
          ctx.reply('📺 Stream ist offline');
          return;
        }

        const viewers = streamData.data[0].viewer_count;
        ctx.reply(`👥 Aktuell ${viewers.toLocaleString()} Zuschauer`);
      },
    });

    // !subage - Check subscription age
    this.registerCommand({
      name: 'subage',
      aliases: ['subtime', 'sublength'],
      description: 'Check subscription duration',
      usage: '!subage [user]',
      cooldown: { user: 10, global: 3 },
      handler: async (ctx) => {
        const username = (ctx.args[0] || ctx.user.username).toLowerCase().replace('@', '');

        const userId = await this.getUserId(username);
        if (!userId) {
          ctx.reply(`❌ Benutzer ${username} nicht gefunden`);
          return;
        }

        // This requires broadcaster scope
        const subData = await this.getSubInfo(userId);

        if (!subData) {
          ctx.reply(`❌ ${username} ist kein Subscriber`);
          return;
        }

        ctx.reply(
          `💜 ${username} ist Tier ${subData.tier / 1000} Sub seit ${subData.months} Monaten` +
          (subData.is_gift ? ' (Geschenk)' : '')
        );
      },
    });
  }

  // API Methods
  private async getUserId(username: string): Promise<string | null> {
    const cacheKey = `twitch:userid:${username}`;
    const cached = this.cache.get<string>(cacheKey);
    if (cached) return cached;

    const data = await this.apiRequest<any>(`/users?login=${username}`);
    if (!data?.data?.[0]) return null;

    const userId = data.data[0].id;
    this.cache.set(cacheKey, userId, 3600);
    return userId;
  }

  private async getUserData(username: string): Promise<any | null> {
    const cacheKey = `twitch:user:${username}`;
    const cached = this.cache.get<any>(cacheKey);
    if (cached) return cached;

    const data = await this.apiRequest<any>(`/users?login=${username}`);
    if (!data?.data?.[0]) return null;

    this.cache.set(cacheKey, data.data[0], 300);
    return data.data[0];
  }

  private async getFollowAge(userId: string): Promise<{ followed_at: string } | null> {
    if (!this.tokens) return null;

    const data = await this.apiRequest<any>(
      `/channels/followers?broadcaster_id=${this.tokens.broadcasterId}&user_id=${userId}`
    );

    return data?.data?.[0] || null;
  }

  private async getSubInfo(userId: string): Promise<any | null> {
    if (!this.tokens) return null;

    const data = await this.apiRequest<any>(
      `/subscriptions?broadcaster_id=${this.tokens.broadcasterId}&user_id=${userId}`
    );

    if (!data?.data?.[0]) return null;

    return {
      tier: parseInt(data.data[0].tier),
      months: 0, // Would need additional API call
      is_gift: data.data[0].is_gift,
    };
  }

  // Public API
  async getFollowerCount(): Promise<number | null> {
    if (!this.tokens) return null;

    const data = await this.apiRequest<any>(
      `/channels/followers?broadcaster_id=${this.tokens.broadcasterId}&first=1`
    );

    return data?.total || null;
  }
}
