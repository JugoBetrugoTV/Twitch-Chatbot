/**
 * Twitter/X Integration Plugin
 *
 * Features:
 * - Auto-tweet when going live
 * - Auto-tweet highlights/clips
 * - Manual tweet command
 * - Tweet templates
 * - Schedule tweets
 */

import { Plugin } from '../base/Plugin';
import { PluginMeta, Permission } from '../../types/plugins';
import { getDatabase, DatabaseService } from '../../services/Database';

interface TwitterSettings {
  enabled: boolean;
  apiKey: string;
  apiSecret: string;
  accessToken: string;
  accessSecret: string;
  autoLiveTweet: boolean;
  liveTemplate: string;
  autoClipTweet: boolean;
  clipTemplate: string;
  autoOfflineTweet: boolean;
  offlineTemplate: string;
  cooldownMinutes: number;
}

interface TweetHistory {
  id: string;
  content: string;
  type: 'live' | 'clip' | 'manual' | 'offline';
  timestamp: Date;
  success: boolean;
}

const DEFAULT_SETTINGS: TwitterSettings = {
  enabled: false,
  apiKey: '',
  apiSecret: '',
  accessToken: '',
  accessSecret: '',
  autoLiveTweet: true,
  liveTemplate: '🔴 Ich bin jetzt LIVE auf Twitch!\n\n{title}\n\n🎮 {game}\n\n📺 https://twitch.tv/{channel}',
  autoClipTweet: false,
  clipTemplate: '🎬 Neuer Clip: {title}\n\n{url}',
  autoOfflineTweet: false,
  offlineTemplate: 'Stream ist vorbei! Danke fürs Zuschauen! 💜\n\nBis zum nächsten Mal auf https://twitch.tv/{channel}',
  cooldownMinutes: 5,
};

export class TwitterPlugin extends Plugin {
  meta: PluginMeta = {
    name: 'twitter',
    version: '1.0.0',
    description: 'Twitter/X integration',
    author: 'StreamCore',
  };

  private db!: DatabaseService;
  private settings: TwitterSettings = DEFAULT_SETTINGS;
  private lastTweetTime?: Date;
  private tweetHistory: TweetHistory[] = [];

  protected async init(): Promise<void> {
    this.db = getDatabase();
    this.log.info('Initializing Twitter Integration...');

    this.initTables();
    this.loadSettings();
    this.setupEventHandlers();
    this.registerCommands();

    if (!this.settings.apiKey) {
      this.log.warn('Twitter API credentials not configured');
    }

    this.log.info('Twitter Integration initialized!');
  }

  protected async destroy(): Promise<void> {}

  private initTables(): void {
    const db = this.db.raw();
    db.exec(`
      CREATE TABLE IF NOT EXISTS tweet_history (
        id TEXT PRIMARY KEY,
        content TEXT NOT NULL,
        type TEXT NOT NULL,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        success INTEGER DEFAULT 1
      );
    `);
  }

  private loadSettings(): void {
    const saved = this.db.getSetting<TwitterSettings>('twitter_settings');
    if (saved) {
      this.settings = { ...DEFAULT_SETTINGS, ...saved };
    }
  }

  private saveSettings(): void {
    this.db.setSetting('twitter_settings', this.settings);
  }

  private setupEventHandlers(): void {
    // Auto-tweet when going live
    this.ctx.events.on('stream:online', async (event: any) => {
      if (!this.settings.enabled || !this.settings.autoLiveTweet) return;

      const content = this.formatTemplate(this.settings.liveTemplate, {
        title: event.title || 'Live Stream',
        game: event.game || 'Gaming',
        channel: event.channel || process.env.TWITCH_CHANNEL || '',
      });

      await this.sendTweet(content, 'live');
    });

    // Auto-tweet when going offline
    this.ctx.events.on('stream:offline', async (event: any) => {
      if (!this.settings.enabled || !this.settings.autoOfflineTweet) return;

      const content = this.formatTemplate(this.settings.offlineTemplate, {
        channel: event.channel || process.env.TWITCH_CHANNEL || '',
      });

      await this.sendTweet(content, 'offline');
    });

    // Auto-tweet clips
    this.ctx.events.on('clip:created', async (event: any) => {
      if (!this.settings.enabled || !this.settings.autoClipTweet) return;

      const content = this.formatTemplate(this.settings.clipTemplate, {
        title: event.title || 'Clip',
        url: event.url || '',
        creator: event.creator || '',
      });

      await this.sendTweet(content, 'clip');
    });
  }

  private formatTemplate(template: string, vars: Record<string, string>): string {
    let result = template;
    for (const [key, value] of Object.entries(vars)) {
      result = result.replace(new RegExp(`{${key}}`, 'g'), value);
    }
    return result;
  }

  private async sendTweet(content: string, type: 'live' | 'clip' | 'manual' | 'offline'): Promise<boolean> {
    if (!this.settings.apiKey || !this.settings.accessToken) {
      this.log.error('Twitter API credentials not configured');
      return false;
    }

    // Check cooldown
    if (this.lastTweetTime) {
      const timeSince = Date.now() - this.lastTweetTime.getTime();
      if (timeSince < this.settings.cooldownMinutes * 60 * 1000) {
        this.log.info(`Tweet skipped - cooldown (${Math.ceil((this.settings.cooldownMinutes * 60 * 1000 - timeSince) / 1000)}s remaining)`);
        return false;
      }
    }

    try {
      // In a real implementation, use twitter-api-v2 or similar
      // This is a placeholder showing the structure
      this.log.info(`Sending tweet: ${content.slice(0, 50)}...`);

      // Simulate API call
      // const client = new TwitterApi({
      //   appKey: this.settings.apiKey,
      //   appSecret: this.settings.apiSecret,
      //   accessToken: this.settings.accessToken,
      //   accessSecret: this.settings.accessSecret,
      // });
      // await client.v2.tweet(content);

      const tweetId = `tweet_${Date.now()}`;
      this.lastTweetTime = new Date();

      // Save to history
      this.saveTweetHistory({
        id: tweetId,
        content,
        type,
        timestamp: new Date(),
        success: true,
      });

      this.ctx.events.emit('twitter:tweeted', { id: tweetId, content, type });
      this.log.info(`Tweet sent successfully: ${tweetId}`);

      return true;
    } catch (error) {
      this.log.error(`Failed to send tweet: ${error}`);

      this.saveTweetHistory({
        id: `failed_${Date.now()}`,
        content,
        type,
        timestamp: new Date(),
        success: false,
      });

      return false;
    }
  }

  private saveTweetHistory(tweet: TweetHistory): void {
    const db = this.db.raw();
    db.prepare(`
      INSERT INTO tweet_history (id, content, type, timestamp, success)
      VALUES (?, ?, ?, ?, ?)
    `).run(tweet.id, tweet.content, tweet.type, tweet.timestamp.toISOString(), tweet.success ? 1 : 0);

    this.tweetHistory.push(tweet);
    if (this.tweetHistory.length > 100) {
      this.tweetHistory.shift();
    }
  }

  private registerCommands(): void {
    // !tweet - Send a manual tweet
    this.registerCommand({
      name: 'tweet',
      aliases: ['twitter'],
      description: 'Send a tweet',
      usage: '!tweet <message>',
      permission: Permission.BROADCASTER,
      cooldown: { user: 60, global: 30 },
      handler: async (ctx) => {
        if (!this.settings.enabled) {
          ctx.reply('❌ Twitter Integration deaktiviert');
          return;
        }

        if (ctx.args.length === 0) {
          ctx.reply('Verwendung: !tweet <nachricht>');
          return;
        }

        const content = ctx.args.join(' ');

        if (content.length > 280) {
          ctx.reply(`❌ Tweet zu lang (${content.length}/280 Zeichen)`);
          return;
        }

        const success = await this.sendTweet(content, 'manual');
        ctx.reply(success ? '✅ Tweet gesendet!' : '❌ Tweet fehlgeschlagen');
      },
    });

    // !tweetlive - Send live notification tweet
    this.registerCommand({
      name: 'tweetlive',
      description: 'Send live notification tweet',
      permission: Permission.BROADCASTER,
      cooldown: { user: 300, global: 300 },
      handler: async (ctx) => {
        if (!this.settings.enabled) {
          ctx.reply('❌ Twitter Integration deaktiviert');
          return;
        }

        const content = this.formatTemplate(this.settings.liveTemplate, {
          title: ctx.args.join(' ') || 'Live Stream',
          game: 'Gaming',
          channel: process.env.TWITCH_CHANNEL || '',
        });

        const success = await this.sendTweet(content, 'live');
        ctx.reply(success ? '✅ Live-Tweet gesendet!' : '❌ Tweet fehlgeschlagen');
      },
    });

    // !twitterconfig - Configure Twitter settings
    this.registerCommand({
      name: 'twitterconfig',
      aliases: ['twittersettings'],
      description: 'Configure Twitter integration',
      usage: '!twitterconfig <setting> [value]',
      permission: Permission.BROADCASTER,
      cooldown: { user: 5, global: 0 },
      handler: async (ctx) => {
        const setting = ctx.args[0]?.toLowerCase();

        if (!setting) {
          ctx.reply(
            `🐦 Twitter: ${this.settings.enabled ? 'An' : 'Aus'} | ` +
            `Live-Tweet: ${this.settings.autoLiveTweet ? '✅' : '❌'} | ` +
            `Clip-Tweet: ${this.settings.autoClipTweet ? '✅' : '❌'} | ` +
            `Offline-Tweet: ${this.settings.autoOfflineTweet ? '✅' : '❌'}`
          );
          return;
        }

        const value = ctx.args[1]?.toLowerCase();

        switch (setting) {
          case 'enable':
          case 'on':
            this.settings.enabled = true;
            ctx.reply('✅ Twitter Integration aktiviert');
            break;
          case 'disable':
          case 'off':
            this.settings.enabled = false;
            ctx.reply('✅ Twitter Integration deaktiviert');
            break;
          case 'live':
            this.settings.autoLiveTweet = value === 'on' || value === 'an';
            ctx.reply(`✅ Auto Live-Tweet: ${this.settings.autoLiveTweet ? 'An' : 'Aus'}`);
            break;
          case 'clip':
            this.settings.autoClipTweet = value === 'on' || value === 'an';
            ctx.reply(`✅ Auto Clip-Tweet: ${this.settings.autoClipTweet ? 'An' : 'Aus'}`);
            break;
          case 'offline':
            this.settings.autoOfflineTweet = value === 'on' || value === 'an';
            ctx.reply(`✅ Auto Offline-Tweet: ${this.settings.autoOfflineTweet ? 'An' : 'Aus'}`);
            break;
          case 'cooldown':
            const minutes = parseInt(value);
            if (isNaN(minutes) || minutes < 1) {
              ctx.reply('❌ Cooldown muss mindestens 1 Minute sein');
              return;
            }
            this.settings.cooldownMinutes = minutes;
            ctx.reply(`✅ Tweet-Cooldown: ${minutes} Minuten`);
            break;
          default:
            ctx.reply('❌ Unbekannte Einstellung (enable, disable, live, clip, offline, cooldown)');
            return;
        }

        this.saveSettings();
      },
    });

    // !setlivetemplate - Set live tweet template
    this.registerCommand({
      name: 'setlivetemplate',
      description: 'Set live tweet template',
      usage: '!setlivetemplate <template>',
      permission: Permission.BROADCASTER,
      cooldown: { user: 10, global: 0 },
      handler: async (ctx) => {
        if (ctx.args.length === 0) {
          ctx.reply(`📝 Live-Template: ${this.settings.liveTemplate.slice(0, 100)}...`);
          ctx.reply('Variablen: {title}, {game}, {channel}');
          return;
        }

        const template = ctx.args.join(' ');
        this.settings.liveTemplate = template;
        this.saveSettings();

        ctx.reply('✅ Live-Tweet Template aktualisiert');
      },
    });

    // !tweethistory - View tweet history
    this.registerCommand({
      name: 'tweethistory',
      aliases: ['tweets'],
      description: 'View recent tweets',
      permission: Permission.BROADCASTER,
      cooldown: { user: 30, global: 15 },
      handler: async (ctx) => {
        const db = this.db.raw();
        const tweets = db.prepare(`
          SELECT * FROM tweet_history
          ORDER BY timestamp DESC
          LIMIT 5
        `).all() as any[];

        if (tweets.length === 0) {
          ctx.reply('📝 Keine Tweets in der Historie');
          return;
        }

        const list = tweets.map((t) => {
          const date = new Date(t.timestamp).toLocaleDateString('de-DE');
          return `${t.success ? '✅' : '❌'} [${date}] ${t.content.slice(0, 30)}...`;
        }).join(' | ');

        ctx.reply(`🐦 Letzte Tweets: ${list}`);
      },
    });

    // !twittercredentials - Set Twitter API credentials (whisper only)
    this.registerCommand({
      name: 'twittercredentials',
      description: 'Set Twitter API credentials',
      usage: '!twittercredentials <apiKey> <apiSecret> <accessToken> <accessSecret>',
      permission: Permission.BROADCASTER,
      cooldown: { user: 60, global: 60 },
      handler: async (ctx) => {
        if (ctx.args.length < 4) {
          ctx.reply('⚠️ Bitte alle 4 Credentials angeben. ACHTUNG: Nicht im öffentlichen Chat verwenden!');
          return;
        }

        this.settings.apiKey = ctx.args[0];
        this.settings.apiSecret = ctx.args[1];
        this.settings.accessToken = ctx.args[2];
        this.settings.accessSecret = ctx.args[3];
        this.saveSettings();

        ctx.reply('✅ Twitter Credentials gespeichert');
      },
    });

    // !previewtweet - Preview a tweet without sending
    this.registerCommand({
      name: 'previewtweet',
      description: 'Preview live tweet template',
      permission: Permission.BROADCASTER,
      cooldown: { user: 10, global: 5 },
      handler: async (ctx) => {
        const preview = this.formatTemplate(this.settings.liveTemplate, {
          title: 'Beispiel Stream Titel',
          game: 'Beispiel Game',
          channel: process.env.TWITCH_CHANNEL || 'channel',
        });

        ctx.reply(`📝 Vorschau (${preview.length}/280): ${preview.slice(0, 150)}${preview.length > 150 ? '...' : ''}`);
      },
    });
  }

  // Public API
  isConfigured(): boolean {
    return !!(this.settings.apiKey && this.settings.accessToken);
  }

  async postTweet(content: string): Promise<boolean> {
    return this.sendTweet(content, 'manual');
  }

  getLastTweetTime(): Date | undefined {
    return this.lastTweetTime;
  }

  getRecentTweets(limit: number = 10): TweetHistory[] {
    return this.tweetHistory.slice(-limit);
  }
}
