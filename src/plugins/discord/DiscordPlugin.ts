/**
 * Discord Integration Plugin
 *
 * Features:
 * - Live notifications in Discord
 * - Stream start/end announcements
 * - Chat relay (optional)
 * - Clip sharing
 */

import { Plugin } from '../base/Plugin';
import { PluginMeta, Permission } from '../../types/plugins';
import { getDatabase, DatabaseService } from '../../services/Database';

interface DiscordSettings {
  enabled: boolean;
  webhookUrl: string;
  liveNotifications: boolean;
  offlineNotifications: boolean;
  clipSharing: boolean;
  chatRelay: boolean;
  raidNotifications: boolean;
  announcementChannel?: string;
  mentionRole?: string;
}

interface DiscordEmbed {
  title?: string;
  description?: string;
  url?: string;
  color?: number;
  fields?: { name: string; value: string; inline?: boolean }[];
  thumbnail?: { url: string };
  image?: { url: string };
  footer?: { text: string; icon_url?: string };
  timestamp?: string;
  author?: { name: string; url?: string; icon_url?: string };
}

const DEFAULT_SETTINGS: DiscordSettings = {
  enabled: false,
  webhookUrl: '',
  liveNotifications: true,
  offlineNotifications: false,
  clipSharing: true,
  chatRelay: false,
  raidNotifications: true,
};

export class DiscordPlugin extends Plugin {
  meta: PluginMeta = {
    name: 'discord',
    version: '1.0.0',
    description: 'Discord integration for notifications',
    author: 'StreamCore',
  };

  private db!: DatabaseService;
  private settings: DiscordSettings = DEFAULT_SETTINGS;
  private isLive = false;

  protected async init(): Promise<void> {
    this.db = getDatabase();
    this.log.info('Initializing Discord integration...');

    this.loadSettings();
    this.setupEventHandlers();
    this.registerCommands();

    if (!this.settings.webhookUrl) {
      this.log.warn('Discord webhook not configured. Use !setwebhook to set up.');
    }

    this.log.info('Discord integration initialized!');
  }

  protected async destroy(): Promise<void> {}

  private loadSettings(): void {
    const saved = this.db.getSetting<DiscordSettings>('discord_settings');
    if (saved) {
      this.settings = { ...DEFAULT_SETTINGS, ...saved };
    }
  }

  private saveSettings(): void {
    this.db.setSetting('discord_settings', this.settings);
  }

  private setupEventHandlers(): void {
    // Stream went live
    this.ctx.events.on('stream:online', async (event: any) => {
      if (!this.settings.enabled || !this.settings.liveNotifications || this.isLive) return;

      this.isLive = true;

      const mention = this.settings.mentionRole ? `<@&${this.settings.mentionRole}> ` : '';

      await this.sendWebhook({
        content: `${mention}🔴 **Stream ist jetzt LIVE!**`,
        embeds: [{
          title: event.title || 'Live auf Twitch!',
          description: event.game ? `Spielt: ${event.game}` : undefined,
          url: `https://twitch.tv/${event.channel}`,
          color: 0x9146FF,
          thumbnail: event.thumbnail ? { url: event.thumbnail } : undefined,
          timestamp: new Date().toISOString(),
          footer: { text: 'StreamCore Bot' },
        }],
      });
    });

    // Stream went offline
    this.ctx.events.on('stream:offline', async (event: any) => {
      if (!this.settings.enabled || !this.settings.offlineNotifications || !this.isLive) return;

      this.isLive = false;

      await this.sendWebhook({
        embeds: [{
          title: '⚫ Stream ist offline',
          description: `Danke fürs Zuschauen!`,
          color: 0x808080,
          timestamp: new Date().toISOString(),
        }],
      });
    });

    // Raid notification
    this.ctx.events.on('twitch:raid', async (event: any) => {
      if (!this.settings.enabled || !this.settings.raidNotifications) return;

      await this.sendWebhook({
        embeds: [{
          title: '🎉 Raid!',
          description: `**${event.user.displayName || event.user.username}** raidet mit **${event.viewers}** Zuschauern!`,
          color: 0xFF6B6B,
          timestamp: new Date().toISOString(),
        }],
      });
    });

    // Clip created
    this.ctx.events.on('clip:created', async (event: any) => {
      if (!this.settings.enabled || !this.settings.clipSharing) return;

      await this.sendWebhook({
        content: '🎬 Neuer Clip erstellt!',
        embeds: [{
          title: event.title || 'Clip',
          url: event.url,
          color: 0x9146FF,
          image: event.thumbnail ? { url: event.thumbnail } : undefined,
          footer: { text: `Erstellt von ${event.creator || 'Unknown'}` },
        }],
      });
    });
  }

  private async sendWebhook(data: {
    content?: string;
    embeds?: DiscordEmbed[];
    username?: string;
    avatar_url?: string;
  }): Promise<boolean> {
    if (!this.settings.webhookUrl) {
      return false;
    }

    try {
      const response = await fetch(this.settings.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: data.username || 'StreamCore',
          avatar_url: data.avatar_url,
          content: data.content,
          embeds: data.embeds,
        }),
      });

      if (!response.ok) {
        this.log.error(`Discord webhook failed: ${response.status}`);
        return false;
      }

      return true;
    } catch (error) {
      this.log.error(`Discord webhook error: ${error}`);
      return false;
    }
  }

  private registerCommands(): void {
    // !setwebhook - Set Discord webhook (broadcaster)
    this.registerCommand({
      name: 'setwebhook',
      aliases: ['discordwebhook'],
      description: 'Set Discord webhook URL',
      usage: '!setwebhook <url>',
      permission: Permission.BROADCASTER,
      cooldown: { user: 0, global: 0 },
      handler: async (ctx) => {
        if (ctx.args.length === 0) {
          ctx.reply('Verwendung: !setwebhook <discord-webhook-url>');
          return;
        }

        const url = ctx.args[0];

        if (!url.includes('discord.com/api/webhooks/')) {
          ctx.reply('❌ Ungültige Discord Webhook URL');
          return;
        }

        this.settings.webhookUrl = url;
        this.settings.enabled = true;
        this.saveSettings();

        // Test webhook
        const success = await this.sendWebhook({
          content: '✅ StreamCore Bot verbunden!',
          embeds: [{
            title: 'Discord Integration aktiv',
            description: 'Der Bot sendet jetzt Benachrichtigungen an diesen Kanal.',
            color: 0x00FF00,
          }],
        });

        if (success) {
          ctx.reply('✅ Discord Webhook konfiguriert und getestet!');
        } else {
          ctx.reply('⚠️ Webhook gespeichert, aber Test fehlgeschlagen.');
        }
      },
    });

    // !discord - Configure Discord settings
    this.registerCommand({
      name: 'discord',
      description: 'Configure Discord integration',
      usage: '!discord <live|offline|clips|raids|relay> [on|off]',
      permission: Permission.MODERATOR,
      cooldown: { user: 5, global: 0 },
      handler: async (ctx) => {
        const setting = ctx.args[0]?.toLowerCase();
        const value = ctx.args[1]?.toLowerCase();

        if (!setting) {
          ctx.reply(
            `📱 Discord: ${this.settings.enabled ? 'An' : 'Aus'} | ` +
            `Live: ${this.settings.liveNotifications ? '✅' : '❌'} | ` +
            `Offline: ${this.settings.offlineNotifications ? '✅' : '❌'} | ` +
            `Clips: ${this.settings.clipSharing ? '✅' : '❌'} | ` +
            `Raids: ${this.settings.raidNotifications ? '✅' : '❌'}`
          );
          return;
        }

        const enable = value === 'on' || value === 'an';

        switch (setting) {
          case 'live':
            this.settings.liveNotifications = value ? enable : !this.settings.liveNotifications;
            ctx.reply(`📱 Live-Benachrichtigungen: ${this.settings.liveNotifications ? 'An' : 'Aus'}`);
            break;
          case 'offline':
            this.settings.offlineNotifications = value ? enable : !this.settings.offlineNotifications;
            ctx.reply(`📱 Offline-Benachrichtigungen: ${this.settings.offlineNotifications ? 'An' : 'Aus'}`);
            break;
          case 'clips':
            this.settings.clipSharing = value ? enable : !this.settings.clipSharing;
            ctx.reply(`📱 Clip-Sharing: ${this.settings.clipSharing ? 'An' : 'Aus'}`);
            break;
          case 'raids':
            this.settings.raidNotifications = value ? enable : !this.settings.raidNotifications;
            ctx.reply(`📱 Raid-Benachrichtigungen: ${this.settings.raidNotifications ? 'An' : 'Aus'}`);
            break;
          case 'relay':
            this.settings.chatRelay = value ? enable : !this.settings.chatRelay;
            ctx.reply(`📱 Chat-Relay: ${this.settings.chatRelay ? 'An' : 'Aus'}`);
            break;
          default:
            ctx.reply('❌ Unbekannte Einstellung. (live, offline, clips, raids, relay)');
            return;
        }

        this.saveSettings();
      },
    });

    // !discordtest - Test Discord notification
    this.registerCommand({
      name: 'discordtest',
      description: 'Send a test Discord notification',
      permission: Permission.MODERATOR,
      cooldown: { user: 30, global: 10 },
      handler: async (ctx) => {
        if (!this.settings.webhookUrl) {
          ctx.reply('❌ Discord Webhook nicht konfiguriert. Nutze !setwebhook');
          return;
        }

        const success = await this.sendWebhook({
          content: '🧪 Test-Nachricht',
          embeds: [{
            title: 'Test von StreamCore',
            description: `Gesendet von ${ctx.user.displayName}`,
            color: 0x9146FF,
            timestamp: new Date().toISOString(),
          }],
        });

        ctx.reply(success ? '✅ Test-Nachricht gesendet!' : '❌ Fehler beim Senden');
      },
    });

    // !announce - Send announcement to Discord
    this.registerCommand({
      name: 'announce',
      aliases: ['discordannounce'],
      description: 'Send announcement to Discord',
      usage: '!announce <message>',
      permission: Permission.MODERATOR,
      cooldown: { user: 60, global: 30 },
      handler: async (ctx) => {
        if (ctx.args.length === 0) {
          ctx.reply('Verwendung: !announce <nachricht>');
          return;
        }

        const message = ctx.args.join(' ');
        const mention = this.settings.mentionRole ? `<@&${this.settings.mentionRole}>` : '';

        const success = await this.sendWebhook({
          content: mention,
          embeds: [{
            title: '📢 Ankündigung',
            description: message,
            color: 0xFFD700,
            footer: { text: `Von ${ctx.user.displayName}` },
            timestamp: new Date().toISOString(),
          }],
        });

        ctx.reply(success ? '✅ Ankündigung gesendet!' : '❌ Fehler beim Senden');
      },
    });

    // !setrole - Set mention role (broadcaster)
    this.registerCommand({
      name: 'setrole',
      description: 'Set Discord role to mention',
      usage: '!setrole <role-id>',
      permission: Permission.BROADCASTER,
      cooldown: { user: 5, global: 0 },
      handler: async (ctx) => {
        if (ctx.args.length === 0) {
          if (this.settings.mentionRole) {
            ctx.reply(`📱 Aktuelle Rolle: ${this.settings.mentionRole}`);
          } else {
            ctx.reply('📱 Keine Rolle gesetzt. !setrole <role-id>');
          }
          return;
        }

        this.settings.mentionRole = ctx.args[0];
        this.saveSettings();
        ctx.reply(`✅ Discord Rolle gesetzt: ${ctx.args[0]}`);
      },
    });
  }

  // Public API
  async sendNotification(message: string, embed?: DiscordEmbed): Promise<boolean> {
    return this.sendWebhook({
      content: message,
      embeds: embed ? [embed] : undefined,
    });
  }

  isConnected(): boolean {
    return this.settings.enabled && !!this.settings.webhookUrl;
  }
}
