/**
 * Moderation Plugin
 *
 * Features:
 * - Spam detection (repeated messages)
 * - Caps detection
 * - Link filtering
 * - Word blacklist
 * - Emote spam detection
 * - Auto-timeout with escalation
 */

import { Plugin } from '../base/Plugin';
import { PluginMeta, Permission } from '../../types/plugins';
import { ChatMessageEvent, ChatUser } from '../../types/events';
import { getDatabase, DatabaseService } from '../../services/Database';

interface ModerationSettings {
  // Caps filter
  capsEnabled: boolean;
  capsMinLength: number;
  capsMaxPercent: number;

  // Spam filter
  spamEnabled: boolean;
  spamMaxRepeats: number;

  // Link filter
  linksEnabled: boolean;
  linksAllowSubs: boolean;
  linksAllowVips: boolean;
  permitDuration: number; // seconds

  // Emote spam
  emoteSpamEnabled: boolean;
  emoteSpamMax: number;

  // Blacklist
  blacklistEnabled: boolean;

  // Timeout escalation (in seconds)
  timeoutEscalation: number[];
}

interface UserWarning {
  count: number;
  lastWarning: number;
}

const DEFAULT_SETTINGS: ModerationSettings = {
  capsEnabled: true,
  capsMinLength: 10,
  capsMaxPercent: 70,

  spamEnabled: true,
  spamMaxRepeats: 3,

  linksEnabled: true,
  linksAllowSubs: true,
  linksAllowVips: true,
  permitDuration: 60,

  emoteSpamEnabled: true,
  emoteSpamMax: 10,

  blacklistEnabled: true,

  timeoutEscalation: [10, 60, 300, 600, 3600], // 10s, 1m, 5m, 10m, 1h
};

const LINK_REGEX = /(?:https?:\/\/|www\.)[^\s]+|[^\s]+\.(com|net|org|tv|gg|co|io|me|de|at|ch)[^\s]*/gi;

export class ModerationPlugin extends Plugin {
  meta: PluginMeta = {
    name: 'moderation',
    version: '1.0.0',
    description: 'Chat moderation with auto-timeout',
    author: 'StreamCore',
  };

  private db!: DatabaseService;
  private settings: ModerationSettings = DEFAULT_SETTINGS;
  private userMessages: Map<string, string[]> = new Map();
  private userWarnings: Map<string, UserWarning> = new Map();
  private linkPermits: Map<string, number> = new Map();

  protected async init(): Promise<void> {
    this.db = getDatabase();
    this.log.info('Initializing Moderation system...');

    // Load settings
    const savedSettings = this.db.getSetting<Partial<ModerationSettings>>('moderation_settings');
    if (savedSettings) {
      this.settings = { ...DEFAULT_SETTINGS, ...savedSettings };
    }

    // Register commands
    this.registerCommands();

    this.log.info('Moderation system initialized!');
  }

  /**
   * Check a message for moderation violations
   * Returns violation type or null if clean
   */
  checkMessage(event: ChatMessageEvent): { type: string; reason: string } | null {
    const { user, message } = event;

    // Skip mods and broadcaster
    if (user.isMod || user.isBroadcaster) {
      return null;
    }

    // Check blacklist
    if (this.settings.blacklistEnabled) {
      const blacklistHit = this.db.isBlacklisted(message);
      if (blacklistHit) {
        return { type: 'blacklist', reason: `Verbotenes Wort: ${blacklistHit.word}` };
      }
    }

    // Check caps
    if (this.settings.capsEnabled) {
      const capsViolation = this.checkCaps(message);
      if (capsViolation) {
        return capsViolation;
      }
    }

    // Check spam
    if (this.settings.spamEnabled) {
      const spamViolation = this.checkSpam(user, message);
      if (spamViolation) {
        return spamViolation;
      }
    }

    // Check links
    if (this.settings.linksEnabled) {
      const linkViolation = this.checkLinks(user, message);
      if (linkViolation) {
        return linkViolation;
      }
    }

    // Check emote spam
    if (this.settings.emoteSpamEnabled) {
      const emoteViolation = this.checkEmoteSpam(event);
      if (emoteViolation) {
        return emoteViolation;
      }
    }

    return null;
  }

  private checkCaps(message: string): { type: string; reason: string } | null {
    // Remove emotes and links for caps check
    const cleanMessage = message.replace(LINK_REGEX, '').trim();

    if (cleanMessage.length < this.settings.capsMinLength) {
      return null;
    }

    const letters = cleanMessage.replace(/[^a-zA-Z]/g, '');
    if (letters.length === 0) {
      return null;
    }

    const upperCase = letters.replace(/[^A-Z]/g, '');
    const capsPercent = (upperCase.length / letters.length) * 100;

    if (capsPercent > this.settings.capsMaxPercent) {
      return { type: 'caps', reason: 'Zu viele Großbuchstaben' };
    }

    return null;
  }

  private checkSpam(user: ChatUser, message: string): { type: string; reason: string } | null {
    const key = `${user.platform}:${user.username}`;
    const lowerMessage = message.toLowerCase().trim();

    if (!this.userMessages.has(key)) {
      this.userMessages.set(key, []);
    }

    const messages = this.userMessages.get(key)!;
    messages.push(lowerMessage);

    // Keep only last N messages
    if (messages.length > this.settings.spamMaxRepeats) {
      messages.shift();
    }

    // Check if all messages are the same
    if (messages.length >= this.settings.spamMaxRepeats) {
      const allSame = messages.every(m => m === lowerMessage);
      if (allSame) {
        this.userMessages.set(key, []); // Reset
        return { type: 'spam', reason: 'Wiederholte Nachricht (Spam)' };
      }
    }

    return null;
  }

  private checkLinks(user: ChatUser, message: string): { type: string; reason: string } | null {
    // Check if user is exempt
    if (this.settings.linksAllowSubs && user.isSub) {
      return null;
    }
    if (this.settings.linksAllowVips && user.isVip) {
      return null;
    }

    // Check for permit
    const key = `${user.platform}:${user.username}`;
    const permitExpiry = this.linkPermits.get(key);
    if (permitExpiry && Date.now() < permitExpiry) {
      return null;
    }

    // Check for links
    if (LINK_REGEX.test(message)) {
      return { type: 'link', reason: 'Links sind nicht erlaubt' };
    }

    return null;
  }

  private checkEmoteSpam(event: ChatMessageEvent): { type: string; reason: string } | null {
    const emoteCount = event.emotes?.length || 0;

    if (emoteCount > this.settings.emoteSpamMax) {
      return { type: 'emotes', reason: 'Zu viele Emotes' };
    }

    return null;
  }

  /**
   * Get timeout duration based on user's warning count
   */
  getTimeoutDuration(user: ChatUser): number {
    const key = `${user.platform}:${user.username}`;
    const warning = this.userWarnings.get(key) || { count: 0, lastWarning: 0 };

    // Reset if last warning was more than 1 hour ago
    if (Date.now() - warning.lastWarning > 3600000) {
      warning.count = 0;
    }

    // Get escalated timeout
    const index = Math.min(warning.count, this.settings.timeoutEscalation.length - 1);
    const duration = this.settings.timeoutEscalation[index];

    // Update warning count
    warning.count++;
    warning.lastWarning = Date.now();
    this.userWarnings.set(key, warning);

    return duration;
  }

  private registerCommands(): void {
    // !permit - Allow a user to post links
    this.registerCommand({
      name: 'permit',
      aliases: ['allow'],
      description: 'Allow a user to post links',
      usage: '!permit <user>',
      permission: Permission.MODERATOR,
      cooldown: { user: 0, global: 0 },
      handler: async (ctx) => {
        if (ctx.args.length === 0) {
          ctx.reply('Verwendung: !permit <user>');
          return;
        }

        const targetName = ctx.args[0].replace('@', '').toLowerCase();
        const key = `twitch:${targetName}`;
        const expiry = Date.now() + this.settings.permitDuration * 1000;

        this.linkPermits.set(key, expiry);

        ctx.reply(
          `✅ ${targetName} darf für ${this.settings.permitDuration} Sekunden Links posten.`
        );
      },
    });

    // !blacklist - Manage blacklisted words
    this.registerCommand({
      name: 'blacklist',
      aliases: ['bl'],
      description: 'Manage blacklisted words',
      usage: '!blacklist <add|remove|list> [word]',
      permission: Permission.MODERATOR,
      cooldown: { user: 0, global: 0 },
      handler: async (ctx) => {
        if (ctx.args.length === 0) {
          ctx.reply('Verwendung: !blacklist <add|remove|list> [wort]');
          return;
        }

        const action = ctx.args[0].toLowerCase();

        switch (action) {
          case 'add':
            if (ctx.args.length < 2) {
              ctx.reply('Verwendung: !blacklist add <wort>');
              return;
            }
            this.db.addBlacklistWord(ctx.args[1]);
            ctx.reply(`✅ "${ctx.args[1]}" zur Blacklist hinzugefügt.`);
            break;

          case 'remove':
          case 'delete':
            if (ctx.args.length < 2) {
              ctx.reply('Verwendung: !blacklist remove <wort>');
              return;
            }
            this.db.removeBlacklistWord(ctx.args[1]);
            ctx.reply(`✅ "${ctx.args[1]}" von der Blacklist entfernt.`);
            break;

          case 'list':
            const words = this.db.getBlacklist();
            if (words.length === 0) {
              ctx.reply('📋 Blacklist ist leer.');
            } else {
              ctx.reply(`📋 Blacklist: ${words.map(w => w.word).join(', ')}`);
            }
            break;

          default:
            ctx.reply('❌ Unbekannte Aktion. Verwende: add, remove, list');
        }
      },
    });

    // !modstats - Show moderation stats
    this.registerCommand({
      name: 'modstats',
      description: 'Show moderation statistics',
      permission: Permission.MODERATOR,
      cooldown: { user: 10, global: 0 },
      handler: async (ctx) => {
        const events = this.db.getRecentEvents(100, 'moderation');
        const stats = {
          caps: 0,
          spam: 0,
          links: 0,
          blacklist: 0,
          emotes: 0,
        };

        for (const event of events) {
          try {
            const data = JSON.parse(event.data);
            if (data.type in stats) {
              stats[data.type as keyof typeof stats]++;
            }
          } catch {}
        }

        ctx.reply(
          `📊 Moderation (letzte 100): ` +
          `Caps: ${stats.caps} | Spam: ${stats.spam} | Links: ${stats.links} | ` +
          `Blacklist: ${stats.blacklist} | Emotes: ${stats.emotes}`
        );
      },
    });

    // !modsettings - View/update moderation settings
    this.registerCommand({
      name: 'modsettings',
      description: 'View moderation settings',
      permission: Permission.MODERATOR,
      cooldown: { user: 5, global: 0 },
      handler: async (ctx) => {
        const s = this.settings;
        ctx.reply(
          `⚙️ Moderation: ` +
          `Caps: ${s.capsEnabled ? 'AN' : 'AUS'} (>${s.capsMaxPercent}%) | ` +
          `Spam: ${s.spamEnabled ? 'AN' : 'AUS'} (${s.spamMaxRepeats}x) | ` +
          `Links: ${s.linksEnabled ? 'AN' : 'AUS'} | ` +
          `Blacklist: ${s.blacklistEnabled ? 'AN' : 'AUS'}`
        );
      },
    });

    // Toggle commands
    this.registerCommand({
      name: 'modtoggle',
      description: 'Toggle moderation features',
      usage: '!modtoggle <caps|spam|links|blacklist|emotes>',
      permission: Permission.BROADCASTER,
      cooldown: { user: 0, global: 0 },
      handler: async (ctx) => {
        if (ctx.args.length === 0) {
          ctx.reply('Verwendung: !modtoggle <caps|spam|links|blacklist|emotes>');
          return;
        }

        const feature = ctx.args[0].toLowerCase();
        let toggled = false;
        let newState = false;

        switch (feature) {
          case 'caps':
            this.settings.capsEnabled = !this.settings.capsEnabled;
            newState = this.settings.capsEnabled;
            toggled = true;
            break;
          case 'spam':
            this.settings.spamEnabled = !this.settings.spamEnabled;
            newState = this.settings.spamEnabled;
            toggled = true;
            break;
          case 'links':
            this.settings.linksEnabled = !this.settings.linksEnabled;
            newState = this.settings.linksEnabled;
            toggled = true;
            break;
          case 'blacklist':
            this.settings.blacklistEnabled = !this.settings.blacklistEnabled;
            newState = this.settings.blacklistEnabled;
            toggled = true;
            break;
          case 'emotes':
            this.settings.emoteSpamEnabled = !this.settings.emoteSpamEnabled;
            newState = this.settings.emoteSpamEnabled;
            toggled = true;
            break;
        }

        if (toggled) {
          this.db.setSetting('moderation_settings', this.settings);
          ctx.reply(`✅ ${feature} ist jetzt ${newState ? 'AN' : 'AUS'}`);
        } else {
          ctx.reply('❌ Unbekanntes Feature. Optionen: caps, spam, links, blacklist, emotes');
        }
      },
    });
  }

  // Public API
  getSettings(): ModerationSettings {
    return { ...this.settings };
  }

  updateSettings(newSettings: Partial<ModerationSettings>): void {
    this.settings = { ...this.settings, ...newSettings };
    this.db.setSetting('moderation_settings', this.settings);
  }

  grantPermit(platform: string, username: string, durationSeconds?: number): void {
    const key = `${platform}:${username.toLowerCase()}`;
    const expiry = Date.now() + (durationSeconds || this.settings.permitDuration) * 1000;
    this.linkPermits.set(key, expiry);
  }
}
