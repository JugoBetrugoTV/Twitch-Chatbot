/**
 * Welcome Messages Plugin
 *
 * Features:
 * - Greet first-time chatters
 * - Welcome back returning viewers (optional)
 * - Customizable messages with variables
 * - Cooldown to prevent spam
 * - VIP/Sub special welcomes
 */

import { Plugin } from '../base/Plugin';
import { PluginMeta, Permission } from '../../types/plugins';
import { ChatMessageEvent, ChatUser } from '../../types/events';
import { getDatabase, DatabaseService } from '../../services/Database';
import { getCache, CacheService } from '../../services/CacheService';

interface WelcomeSettings {
  enabled: boolean;
  welcomeNewChatters: boolean;
  welcomeReturning: boolean;
  returningThresholdDays: number;

  // Messages (supports variables: {user}, {channel}, {points}, {watchtime})
  newChatterMessage: string;
  returningMessage: string;
  vipMessage: string;
  subMessage: string;

  // Cooldowns
  globalCooldown: number; // seconds between any welcome
  userCooldown: number; // hours before welcoming same user again

  // Excluded users
  excludeBots: boolean;
  excludedUsers: string[];
}

const DEFAULT_SETTINGS: WelcomeSettings = {
  enabled: true,
  welcomeNewChatters: true,
  welcomeReturning: false,
  returningThresholdDays: 7,

  newChatterMessage: '👋 Willkommen im Stream, {user}! Viel Spaß! 🎉',
  returningMessage: '👋 Willkommen zurück, {user}!',
  vipMessage: '⭐ VIP {user} ist da! Willkommen!',
  subMessage: '💜 Sub {user} ist da! Willkommen zurück!',

  globalCooldown: 5,
  userCooldown: 24,

  excludeBots: true,
  excludedUsers: ['nightbot', 'streamelements', 'moobot', 'fossabot'],
};

export class WelcomePlugin extends Plugin {
  meta: PluginMeta = {
    name: 'welcome',
    version: '1.0.0',
    description: 'Welcome new and returning chatters',
    author: 'StreamCore',
  };

  private db!: DatabaseService;
  private cache!: CacheService;
  private settings: WelcomeSettings = DEFAULT_SETTINGS;
  private lastWelcome: number = 0;
  private welcomedToday: Set<string> = new Set();
  private clearInterval?: NodeJS.Timeout;

  protected async init(): Promise<void> {
    this.db = getDatabase();
    this.cache = getCache();
    this.log.info('Initializing Welcome system...');

    // Load settings
    const savedSettings = this.db.getSetting<Partial<WelcomeSettings>>('welcome_settings');
    if (savedSettings) {
      this.settings = { ...DEFAULT_SETTINGS, ...savedSettings };
    }

    // Setup message handler
    this.setupMessageHandler();

    // Register commands
    this.registerCommands();

    // Clear welcomed users daily
    this.clearInterval = setInterval(() => {
      this.welcomedToday.clear();
    }, 24 * 60 * 60 * 1000);

    this.log.info('Welcome system initialized!');
  }

  protected async destroy(): Promise<void> {
    if (this.clearInterval) clearInterval(this.clearInterval);
  }

  private setupMessageHandler(): void {
    // Listen for chat messages
    this.ctx.events.on('chat:message', (event: ChatMessageEvent) => {
      this.handleMessage(event);
    });
  }

  private async handleMessage(event: ChatMessageEvent): Promise<void> {
    if (!this.settings.enabled) return;

    const { user, channel } = event;
    const userKey = `${user.platform}:${user.username.toLowerCase()}`;

    // Skip excluded users
    if (this.isExcluded(user)) return;

    // Check if already welcomed today
    if (this.welcomedToday.has(userKey)) return;

    // Check global cooldown
    const now = Date.now();
    if (now - this.lastWelcome < this.settings.globalCooldown * 1000) return;

    // Check user cooldown (from cache)
    const cacheKey = `welcome:${userKey}`;
    if (this.cache.has(cacheKey)) return;

    // Get user from database
    const dbUser = this.db.getUser(user.platform, user.username);
    const isNew = !dbUser || this.isFirstTime(dbUser);
    const isReturning = dbUser && this.isReturning(dbUser);

    let message: string | null = null;

    if (isNew && this.settings.welcomeNewChatters) {
      // New chatter!
      message = this.settings.newChatterMessage;
      this.log.info(`New chatter: ${user.displayName}`);
      this.db.logEvent('new_chatter', { username: user.username, channel });
    } else if (isReturning && this.settings.welcomeReturning) {
      // Check for special status
      if (user.isVip) {
        message = this.settings.vipMessage;
      } else if (user.isSub) {
        message = this.settings.subMessage;
      } else {
        message = this.settings.returningMessage;
      }
    }

    if (message) {
      const formattedMessage = this.formatMessage(message, user, dbUser);
      await this.sendMessage(channel, formattedMessage);

      // Update cooldowns
      this.lastWelcome = now;
      this.welcomedToday.add(userKey);
      this.cache.set(cacheKey, true, this.settings.userCooldown * 3600);
    }
  }

  private isExcluded(user: ChatUser): boolean {
    const username = user.username.toLowerCase();

    // Exclude bots
    if (this.settings.excludeBots) {
      if (this.settings.excludedUsers.includes(username)) {
        return true;
      }
    }

    // Exclude broadcaster (they don't need welcome)
    if (user.isBroadcaster) return true;

    return false;
  }

  private isFirstTime(dbUser: any): boolean {
    // User is "new" if message count is 0 or 1 (this is their first message)
    return !dbUser || dbUser.message_count <= 1;
  }

  private isReturning(dbUser: any): boolean {
    if (!dbUser || !dbUser.last_seen) return false;

    const lastSeen = new Date(dbUser.last_seen);
    const daysSince = (Date.now() - lastSeen.getTime()) / (1000 * 60 * 60 * 24);

    return daysSince >= this.settings.returningThresholdDays;
  }

  private formatMessage(template: string, user: ChatUser, dbUser: any): string {
    const watchtime = dbUser?.watch_time || 0;
    const hours = Math.floor(watchtime / 60);
    const points = dbUser?.points || 0;

    return template
      .replace(/{user}/g, user.displayName)
      .replace(/{username}/g, user.username)
      .replace(/{points}/g, points.toLocaleString())
      .replace(/{watchtime}/g, `${hours}h`)
      .replace(/{messages}/g, String(dbUser?.message_count || 0));
  }

  private registerCommands(): void {
    // !welcome toggle
    this.registerCommand({
      name: 'welcome',
      description: 'Welcome system settings',
      usage: '!welcome <on|off|status|test>',
      permission: Permission.MODERATOR,
      cooldown: { user: 5, global: 0 },
      handler: async (ctx) => {
        const subCmd = ctx.args[0]?.toLowerCase();

        if (!subCmd || subCmd === 'status') {
          const status = this.settings.enabled ? 'aktiviert' : 'deaktiviert';
          ctx.reply(`👋 Willkommensnachrichten sind ${status}`);
          return;
        }

        if (subCmd === 'on') {
          this.settings.enabled = true;
          this.saveSettings();
          ctx.reply('✅ Willkommensnachrichten aktiviert!');
        } else if (subCmd === 'off') {
          this.settings.enabled = false;
          this.saveSettings();
          ctx.reply('❌ Willkommensnachrichten deaktiviert!');
        } else if (subCmd === 'test') {
          const testMsg = this.formatMessage(
            this.settings.newChatterMessage,
            ctx.user,
            this.db.getUser('twitch', ctx.user.username)
          );
          ctx.reply(`Test: ${testMsg}`);
        } else if (subCmd === 'new') {
          // Toggle new chatter welcome
          this.settings.welcomeNewChatters = !this.settings.welcomeNewChatters;
          this.saveSettings();
          const status = this.settings.welcomeNewChatters ? 'aktiviert' : 'deaktiviert';
          ctx.reply(`👋 Neue Chatter Begrüßung ${status}`);
        } else if (subCmd === 'returning') {
          // Toggle returning welcome
          this.settings.welcomeReturning = !this.settings.welcomeReturning;
          this.saveSettings();
          const status = this.settings.welcomeReturning ? 'aktiviert' : 'deaktiviert';
          ctx.reply(`👋 Rückkehrer Begrüßung ${status}`);
        }
      },
    });

    // !setwelcome - Set welcome message
    this.registerCommand({
      name: 'setwelcome',
      description: 'Set welcome message',
      usage: '!setwelcome <new|returning|vip|sub> <message>',
      permission: Permission.MODERATOR,
      cooldown: { user: 5, global: 0 },
      handler: async (ctx) => {
        if (ctx.args.length < 2) {
          ctx.reply('Verwendung: !setwelcome <new|returning|vip|sub> <nachricht>');
          ctx.reply('Variablen: {user}, {points}, {watchtime}, {messages}');
          return;
        }

        const type = ctx.args[0].toLowerCase();
        const message = ctx.args.slice(1).join(' ');

        switch (type) {
          case 'new':
            this.settings.newChatterMessage = message;
            break;
          case 'returning':
            this.settings.returningMessage = message;
            break;
          case 'vip':
            this.settings.vipMessage = message;
            break;
          case 'sub':
            this.settings.subMessage = message;
            break;
          default:
            ctx.reply('❌ Unbekannter Typ. Nutze: new, returning, vip, sub');
            return;
        }

        this.saveSettings();
        ctx.reply(`✅ ${type} Willkommensnachricht gesetzt!`);
      },
    });

    // !excludeuser - Exclude user from welcome
    this.registerCommand({
      name: 'excludeuser',
      aliases: ['welcomeexclude'],
      description: 'Exclude user from welcome messages',
      usage: '!excludeuser <add|remove|list> [username]',
      permission: Permission.MODERATOR,
      cooldown: { user: 5, global: 0 },
      handler: async (ctx) => {
        const action = ctx.args[0]?.toLowerCase();

        if (!action || action === 'list') {
          const excluded = this.settings.excludedUsers.join(', ');
          ctx.reply(`🚫 Ausgeschlossene User: ${excluded || 'keine'}`);
          return;
        }

        const username = ctx.args[1]?.toLowerCase().replace('@', '');

        if (!username) {
          ctx.reply('❌ Bitte gib einen Benutzernamen an!');
          return;
        }

        if (action === 'add') {
          if (!this.settings.excludedUsers.includes(username)) {
            this.settings.excludedUsers.push(username);
            this.saveSettings();
            ctx.reply(`✅ ${username} wird nicht mehr begrüßt!`);
          } else {
            ctx.reply(`ℹ️ ${username} ist bereits ausgeschlossen!`);
          }
        } else if (action === 'remove') {
          const index = this.settings.excludedUsers.indexOf(username);
          if (index > -1) {
            this.settings.excludedUsers.splice(index, 1);
            this.saveSettings();
            ctx.reply(`✅ ${username} wird wieder begrüßt!`);
          } else {
            ctx.reply(`ℹ️ ${username} war nicht ausgeschlossen!`);
          }
        }
      },
    });
  }

  private saveSettings(): void {
    this.db.setSetting('welcome_settings', this.settings);
  }

  // Public API
  getSettings(): WelcomeSettings {
    return { ...this.settings };
  }

  updateSettings(newSettings: Partial<WelcomeSettings>): void {
    this.settings = { ...this.settings, ...newSettings };
    this.saveSettings();
  }

  resetWelcomed(): void {
    this.welcomedToday.clear();
  }
}
