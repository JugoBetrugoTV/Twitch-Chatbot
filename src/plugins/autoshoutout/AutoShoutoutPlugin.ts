/**
 * Auto Shoutout Plugin
 *
 * Features:
 * - Automatic shoutouts for raiders
 * - VIP/Special user shoutouts
 * - Configurable messages
 * - Cooldowns to prevent spam
 */

import { Plugin } from '../base/Plugin';
import { PluginMeta, Permission } from '../../types/plugins';
import { ChatMessageEvent, RaidEvent } from '../../types/events';
import { getDatabase, DatabaseService } from '../../services/Database';

interface ShoutoutSettings {
  enabled: boolean;
  shoutoutRaiders: boolean;
  shoutoutVips: boolean;
  shoutoutMods: boolean;
  minRaidViewers: number;
  cooldownMinutes: number;
  raidMessage: string;
  vipMessage: string;
  manualMessage: string;
  autoUsers: string[]; // Always shoutout these users
}

const DEFAULT_SETTINGS: ShoutoutSettings = {
  enabled: true,
  shoutoutRaiders: true,
  shoutoutVips: false,
  shoutoutMods: false,
  minRaidViewers: 1,
  cooldownMinutes: 60,
  raidMessage: '🎉 Danke für den Raid, @{user}! Schaut bei ihnen vorbei: twitch.tv/{user} ❤️',
  vipMessage: '⭐ Willkommen {user}! Checkt den Channel: twitch.tv/{user}',
  manualMessage: '📣 Schaut bei @{user} vorbei! → twitch.tv/{user}',
  autoUsers: [],
};

export class AutoShoutoutPlugin extends Plugin {
  meta: PluginMeta = {
    name: 'autoshoutout',
    version: '1.0.0',
    description: 'Automatic shoutouts for raiders and VIPs',
    author: 'StreamCore',
  };

  private db!: DatabaseService;
  private settings: ShoutoutSettings = DEFAULT_SETTINGS;
  private recentShoutouts: Map<string, number> = new Map(); // username -> timestamp

  protected async init(): Promise<void> {
    this.db = getDatabase();
    this.log.info('Initializing Auto Shoutout...');

    this.loadSettings();
    this.setupEventHandlers();
    this.registerCommands();

    this.log.info('Auto Shoutout initialized!');
  }

  protected async destroy(): Promise<void> {}

  private loadSettings(): void {
    const saved = this.db.getSetting<ShoutoutSettings>('autoshoutout_settings');
    if (saved) {
      this.settings = { ...DEFAULT_SETTINGS, ...saved };
    }
  }

  private saveSettings(): void {
    this.db.setSetting('autoshoutout_settings', this.settings);
  }

  private setupEventHandlers(): void {
    // Handle raids
    this.ctx.events.on('twitch:raid', (event: RaidEvent) => {
      if (!this.settings.enabled || !this.settings.shoutoutRaiders) return;
      if (event.viewers < this.settings.minRaidViewers) return;

      this.doShoutout(event.user.username, event.user.displayName, 'raid', event.channel);
    });

    // Handle VIP/special user messages
    this.ctx.events.on('chat:message', (event: ChatMessageEvent) => {
      if (!this.settings.enabled) return;

      const username = event.user.username.toLowerCase();

      // Check auto-users list
      if (this.settings.autoUsers.includes(username)) {
        this.doShoutout(username, event.user.displayName, 'vip', event.channel);
        return;
      }

      // VIP shoutout
      if (this.settings.shoutoutVips && event.user.isVip && !event.user.isMod) {
        this.doShoutout(username, event.user.displayName, 'vip', event.channel);
      }
    });
  }

  private doShoutout(username: string, displayName: string, type: 'raid' | 'vip' | 'manual', channel: string): void {
    const lowerUsername = username.toLowerCase();

    // Check cooldown
    const lastShoutout = this.recentShoutouts.get(lowerUsername) || 0;
    const cooldownMs = this.settings.cooldownMinutes * 60 * 1000;

    if (Date.now() - lastShoutout < cooldownMs) {
      return;
    }

    // Select message template
    let template: string;
    switch (type) {
      case 'raid':
        template = this.settings.raidMessage;
        break;
      case 'vip':
        template = this.settings.vipMessage;
        break;
      default:
        template = this.settings.manualMessage;
    }

    const message = template
      .replace(/{user}/g, displayName)
      .replace(/{username}/g, lowerUsername);

    this.sendMessage(channel, message);
    this.recentShoutouts.set(lowerUsername, Date.now());

    this.log.info(`Shoutout: ${displayName} (${type})`);
  }

  private registerCommands(): void {
    // !so / !shoutout - Manual shoutout
    this.registerCommand({
      name: 'so',
      aliases: ['shoutout'],
      description: 'Shoutout a user',
      usage: '!so <user>',
      permission: Permission.MODERATOR,
      cooldown: { user: 5, global: 3 },
      handler: async (ctx) => {
        if (ctx.args.length === 0) {
          ctx.reply('Verwendung: !so <user>');
          return;
        }

        const username = ctx.args[0].replace('@', '').toLowerCase();
        this.doShoutout(username, username, 'manual', ctx.channel);
      },
    });

    // !autoso - Configure auto shoutout
    this.registerCommand({
      name: 'autoso',
      aliases: ['autosoconfig'],
      description: 'Configure auto shoutout',
      usage: '!autoso <on|off|raids|vips|add|remove>',
      permission: Permission.MODERATOR,
      cooldown: { user: 5, global: 0 },
      handler: async (ctx) => {
        const action = ctx.args[0]?.toLowerCase();

        if (!action || action === 'status') {
          ctx.reply(
            `📣 Auto-SO: ${this.settings.enabled ? 'An' : 'Aus'} | ` +
            `Raids: ${this.settings.shoutoutRaiders ? '✅' : '❌'} | ` +
            `VIPs: ${this.settings.shoutoutVips ? '✅' : '❌'}`
          );
          return;
        }

        switch (action) {
          case 'on':
            this.settings.enabled = true;
            this.saveSettings();
            ctx.reply('✅ Auto-Shoutout aktiviert');
            break;

          case 'off':
            this.settings.enabled = false;
            this.saveSettings();
            ctx.reply('❌ Auto-Shoutout deaktiviert');
            break;

          case 'raids':
            this.settings.shoutoutRaiders = !this.settings.shoutoutRaiders;
            this.saveSettings();
            ctx.reply(`📣 Raid-Shoutouts: ${this.settings.shoutoutRaiders ? 'An' : 'Aus'}`);
            break;

          case 'vips':
            this.settings.shoutoutVips = !this.settings.shoutoutVips;
            this.saveSettings();
            ctx.reply(`📣 VIP-Shoutouts: ${this.settings.shoutoutVips ? 'An' : 'Aus'}`);
            break;

          case 'add':
            const addUser = ctx.args[1]?.toLowerCase().replace('@', '');
            if (!addUser) {
              ctx.reply('❌ Kein User angegeben');
              return;
            }
            if (!this.settings.autoUsers.includes(addUser)) {
              this.settings.autoUsers.push(addUser);
              this.saveSettings();
              ctx.reply(`✅ ${addUser} zur Auto-SO Liste hinzugefügt`);
            }
            break;

          case 'remove':
            const removeUser = ctx.args[1]?.toLowerCase().replace('@', '');
            if (!removeUser) {
              ctx.reply('❌ Kein User angegeben');
              return;
            }
            const idx = this.settings.autoUsers.indexOf(removeUser);
            if (idx > -1) {
              this.settings.autoUsers.splice(idx, 1);
              this.saveSettings();
              ctx.reply(`✅ ${removeUser} von Auto-SO Liste entfernt`);
            }
            break;

          case 'list':
            const list = this.settings.autoUsers.join(', ') || 'keine';
            ctx.reply(`📣 Auto-SO Liste: ${list}`);
            break;

          default:
            ctx.reply('Verwendung: !autoso <on|off|raids|vips|add|remove|list>');
        }
      },
    });

    // !setso - Set shoutout message
    this.registerCommand({
      name: 'setso',
      description: 'Set shoutout message',
      usage: '!setso <raid|vip|manual> <message>',
      permission: Permission.MODERATOR,
      cooldown: { user: 5, global: 0 },
      handler: async (ctx) => {
        if (ctx.args.length < 2) {
          ctx.reply('Verwendung: !setso <raid|vip|manual> <nachricht> (Variablen: {user})');
          return;
        }

        const type = ctx.args[0].toLowerCase();
        const message = ctx.args.slice(1).join(' ');

        switch (type) {
          case 'raid':
            this.settings.raidMessage = message;
            break;
          case 'vip':
            this.settings.vipMessage = message;
            break;
          case 'manual':
            this.settings.manualMessage = message;
            break;
          default:
            ctx.reply('❌ Ungültiger Typ (raid, vip, manual)');
            return;
        }

        this.saveSettings();
        ctx.reply(`✅ ${type} Shoutout-Nachricht gesetzt`);
      },
    });
  }

  // Public API
  shoutout(username: string, channel: string): void {
    this.doShoutout(username, username, 'manual', channel);
  }

  getSettings(): ShoutoutSettings {
    return { ...this.settings };
  }
}
