/**
 * Chat Modes Plugin
 *
 * Features:
 * - Emote-only mode toggle
 * - Slow mode toggle
 * - Subscriber-only mode toggle
 * - Follower-only mode toggle
 * - Mode scheduling
 */

import { Plugin } from '../base/Plugin';
import { PluginMeta, Permission } from '../../types/plugins';
import { getDatabase, DatabaseService } from '../../services/Database';

interface ChatModeStatus {
  emoteOnly: boolean;
  slowMode: number;
  subOnly: boolean;
  followerOnly: number;
  uniqueChat: boolean;
}

interface ChatModesSettings {
  enabled: boolean;
  defaultSlowDuration: number;
  defaultFollowerAge: number;
  autoEnableOnRaid: boolean;
  autoDisableAfter: number;
}

const DEFAULT_SETTINGS: ChatModesSettings = {
  enabled: true,
  defaultSlowDuration: 30,
  defaultFollowerAge: 10,
  autoEnableOnRaid: false,
  autoDisableAfter: 300,
};

export class ChatModesPlugin extends Plugin {
  meta: PluginMeta = {
    name: 'chatmodes',
    version: '1.0.0',
    description: 'Chat mode management',
    author: 'StreamCore',
  };

  private db!: DatabaseService;
  private settings: ChatModesSettings = DEFAULT_SETTINGS;
  private currentModes: ChatModeStatus = {
    emoteOnly: false,
    slowMode: 0,
    subOnly: false,
    followerOnly: 0,
    uniqueChat: false,
  };
  private autoDisableTimers: Map<string, NodeJS.Timeout> = new Map();

  protected async init(): Promise<void> {
    this.db = getDatabase();
    this.log.info('Initializing Chat Modes...');

    this.loadSettings();
    this.setupEventHandlers();
    this.registerCommands();

    this.log.info('Chat Modes initialized!');
  }

  protected async destroy(): Promise<void> {
    for (const timer of this.autoDisableTimers.values()) {
      clearTimeout(timer);
    }
  }

  private loadSettings(): void {
    const saved = this.db.getSetting<ChatModesSettings>('chatmodes_settings');
    if (saved) {
      this.settings = { ...DEFAULT_SETTINGS, ...saved };
    }
  }

  private saveSettings(): void {
    this.db.setSetting('chatmodes_settings', this.settings);
  }

  private setupEventHandlers(): void {
    // Listen for chat mode changes from Twitch
    this.ctx.events.on('twitch:roomstate', (event: any) => {
      if (event.emoteOnly !== undefined) {
        this.currentModes.emoteOnly = event.emoteOnly;
      }
      if (event.slow !== undefined) {
        this.currentModes.slowMode = event.slow;
      }
      if (event.subsOnly !== undefined) {
        this.currentModes.subOnly = event.subsOnly;
      }
      if (event.followersOnly !== undefined) {
        this.currentModes.followerOnly = event.followersOnly;
      }
    });

    // Handle mode requests from other plugins
    this.ctx.events.on('chat:mode', (event: any) => {
      switch (event.mode) {
        case 'emoteonly':
          this.setEmoteOnly(true);
          break;
        case 'emoteoff':
          this.setEmoteOnly(false);
          break;
        case 'slow':
          this.setSlowMode(event.duration || this.settings.defaultSlowDuration);
          break;
        case 'slowoff':
          this.setSlowMode(0);
          break;
        case 'subscribers':
          this.setSubOnly(true);
          break;
        case 'subscribersoff':
          this.setSubOnly(false);
          break;
        case 'followers':
          this.setFollowerOnly(event.duration || this.settings.defaultFollowerAge);
          break;
        case 'followersoff':
          this.setFollowerOnly(0);
          break;
      }
    });
  }

  private setEmoteOnly(enabled: boolean, autoDisable?: number): void {
    this.ctx.chat.send(enabled ? '/emoteonly' : '/emoteonlyoff');
    this.currentModes.emoteOnly = enabled;

    if (enabled && autoDisable) {
      this.setAutoDisable('emoteonly', autoDisable, () => this.setEmoteOnly(false));
    }
  }

  private setSlowMode(duration: number, autoDisable?: number): void {
    this.ctx.chat.send(duration > 0 ? `/slow ${duration}` : '/slowoff');
    this.currentModes.slowMode = duration;

    if (duration > 0 && autoDisable) {
      this.setAutoDisable('slow', autoDisable, () => this.setSlowMode(0));
    }
  }

  private setSubOnly(enabled: boolean, autoDisable?: number): void {
    this.ctx.chat.send(enabled ? '/subscribers' : '/subscribersoff');
    this.currentModes.subOnly = enabled;

    if (enabled && autoDisable) {
      this.setAutoDisable('subonly', autoDisable, () => this.setSubOnly(false));
    }
  }

  private setFollowerOnly(minutes: number, autoDisable?: number): void {
    this.ctx.chat.send(minutes > 0 ? `/followers ${minutes}` : '/followersoff');
    this.currentModes.followerOnly = minutes;

    if (minutes > 0 && autoDisable) {
      this.setAutoDisable('followeronly', autoDisable, () => this.setFollowerOnly(0));
    }
  }

  private setAutoDisable(mode: string, seconds: number, callback: () => void): void {
    // Clear existing timer
    const existing = this.autoDisableTimers.get(mode);
    if (existing) {
      clearTimeout(existing);
    }

    // Set new timer
    const timer = setTimeout(() => {
      callback();
      this.autoDisableTimers.delete(mode);
    }, seconds * 1000);

    this.autoDisableTimers.set(mode, timer);
  }

  private registerCommands(): void {
    // !emoteonly - Toggle emote-only mode
    this.registerCommand({
      name: 'emoteonly',
      aliases: ['eo'],
      description: 'Toggle emote-only mode',
      usage: '!emoteonly [on|off] [duration]',
      permission: Permission.MODERATOR,
      cooldown: { user: 5, global: 0 },
      handler: async (ctx) => {
        const action = ctx.args[0]?.toLowerCase();
        const duration = parseInt(ctx.args[1]) || undefined;

        if (action === 'off' || action === 'aus') {
          this.setEmoteOnly(false);
          ctx.reply('💬 Emote-Only Modus deaktiviert');
        } else if (action === 'on' || action === 'an' || !action) {
          const toggle = !this.currentModes.emoteOnly;
          this.setEmoteOnly(toggle, duration);
          ctx.reply(`${toggle ? '😊' : '💬'} Emote-Only Modus ${toggle ? 'aktiviert' : 'deaktiviert'}${duration ? ` (${duration}s)` : ''}`);
        }
      },
    });

    // !slow - Toggle/set slow mode
    this.registerCommand({
      name: 'slow',
      aliases: ['slowmode'],
      description: 'Toggle or set slow mode',
      usage: '!slow [off|seconds] [auto-off]',
      permission: Permission.MODERATOR,
      cooldown: { user: 5, global: 0 },
      handler: async (ctx) => {
        const arg = ctx.args[0]?.toLowerCase();
        const autoOff = parseInt(ctx.args[1]) || undefined;

        if (arg === 'off' || arg === 'aus') {
          this.setSlowMode(0);
          ctx.reply('💬 Slow-Modus deaktiviert');
        } else {
          const duration = parseInt(arg) || this.settings.defaultSlowDuration;
          this.setSlowMode(duration, autoOff);
          ctx.reply(`🐢 Slow-Modus: ${duration}s zwischen Nachrichten${autoOff ? ` (auto-off in ${autoOff}s)` : ''}`);
        }
      },
    });

    // !subonly - Toggle subscriber-only mode
    this.registerCommand({
      name: 'subonly',
      aliases: ['subscribers', 'sub'],
      description: 'Toggle subscriber-only mode',
      usage: '!subonly [on|off] [duration]',
      permission: Permission.MODERATOR,
      cooldown: { user: 5, global: 0 },
      handler: async (ctx) => {
        const action = ctx.args[0]?.toLowerCase();
        const duration = parseInt(ctx.args[1]) || undefined;

        if (action === 'off' || action === 'aus') {
          this.setSubOnly(false);
          ctx.reply('💬 Sub-Only Modus deaktiviert');
        } else if (action === 'on' || action === 'an' || !action) {
          const toggle = !this.currentModes.subOnly;
          this.setSubOnly(toggle, duration);
          ctx.reply(`${toggle ? '⭐' : '💬'} Sub-Only Modus ${toggle ? 'aktiviert' : 'deaktiviert'}${duration ? ` (${duration}s)` : ''}`);
        }
      },
    });

    // !followeronly - Toggle follower-only mode
    this.registerCommand({
      name: 'followeronly',
      aliases: ['followers', 'fo'],
      description: 'Toggle follower-only mode',
      usage: '!followeronly [off|minutes] [auto-off]',
      permission: Permission.MODERATOR,
      cooldown: { user: 5, global: 0 },
      handler: async (ctx) => {
        const arg = ctx.args[0]?.toLowerCase();
        const autoOff = parseInt(ctx.args[1]) || undefined;

        if (arg === 'off' || arg === 'aus') {
          this.setFollowerOnly(0);
          ctx.reply('💬 Follower-Only Modus deaktiviert');
        } else {
          const minutes = parseInt(arg) || this.settings.defaultFollowerAge;
          this.setFollowerOnly(minutes, autoOff);
          ctx.reply(`👥 Follower-Only Modus: ${minutes} Min. Follow-Zeit erforderlich${autoOff ? ` (auto-off in ${autoOff}s)` : ''}`);
        }
      },
    });

    // !chatmode - Show current chat modes
    this.registerCommand({
      name: 'chatmode',
      aliases: ['modes', 'chatstatus'],
      description: 'Show current chat modes',
      permission: Permission.MODERATOR,
      cooldown: { user: 10, global: 5 },
      handler: async (ctx) => {
        const modes = [];

        if (this.currentModes.emoteOnly) modes.push('Emote-Only');
        if (this.currentModes.slowMode > 0) modes.push(`Slow (${this.currentModes.slowMode}s)`);
        if (this.currentModes.subOnly) modes.push('Sub-Only');
        if (this.currentModes.followerOnly > 0) modes.push(`Follower (${this.currentModes.followerOnly}m)`);

        if (modes.length === 0) {
          ctx.reply('💬 Keine Chat-Modi aktiv');
        } else {
          ctx.reply(`💬 Aktive Modi: ${modes.join(' | ')}`);
        }
      },
    });

    // !clearmode - Disable all chat modes
    this.registerCommand({
      name: 'clearmode',
      aliases: ['clearmodes', 'normalchat'],
      description: 'Disable all chat modes',
      permission: Permission.MODERATOR,
      cooldown: { user: 10, global: 5 },
      handler: async (ctx) => {
        // Clear all timers
        for (const timer of this.autoDisableTimers.values()) {
          clearTimeout(timer);
        }
        this.autoDisableTimers.clear();

        // Disable all modes
        if (this.currentModes.emoteOnly) this.setEmoteOnly(false);
        if (this.currentModes.slowMode > 0) this.setSlowMode(0);
        if (this.currentModes.subOnly) this.setSubOnly(false);
        if (this.currentModes.followerOnly > 0) this.setFollowerOnly(0);

        ctx.reply('✅ Alle Chat-Modi deaktiviert');
      },
    });

    // !unique - Toggle unique chat (no duplicate messages)
    this.registerCommand({
      name: 'unique',
      aliases: ['r9k', 'uniquechat'],
      description: 'Toggle unique chat mode',
      usage: '!unique [on|off]',
      permission: Permission.MODERATOR,
      cooldown: { user: 5, global: 0 },
      handler: async (ctx) => {
        const action = ctx.args[0]?.toLowerCase();

        if (action === 'off' || action === 'aus') {
          this.ctx.chat.send('/uniquechatoff');
          this.currentModes.uniqueChat = false;
          ctx.reply('💬 Unique-Chat deaktiviert');
        } else {
          const toggle = !this.currentModes.uniqueChat;
          this.ctx.chat.send(toggle ? '/uniquechat' : '/uniquechatoff');
          this.currentModes.uniqueChat = toggle;
          ctx.reply(`${toggle ? '🔒' : '💬'} Unique-Chat ${toggle ? 'aktiviert' : 'deaktiviert'}`);
        }
      },
    });

    // !shield - Quick protection mode
    this.registerCommand({
      name: 'shield',
      aliases: ['protect'],
      description: 'Enable quick protection mode',
      usage: '!shield [off|level 1-3]',
      permission: Permission.MODERATOR,
      cooldown: { user: 5, global: 0 },
      handler: async (ctx) => {
        const arg = ctx.args[0]?.toLowerCase();

        if (arg === 'off' || arg === 'aus') {
          this.setEmoteOnly(false);
          this.setSlowMode(0);
          this.setSubOnly(false);
          this.setFollowerOnly(0);
          ctx.reply('🛡️ Schutz deaktiviert');
          return;
        }

        const level = parseInt(arg) || 1;

        switch (level) {
          case 1:
            this.setSlowMode(10);
            ctx.reply('🛡️ Schutz Level 1: Slow-Modus (10s)');
            break;
          case 2:
            this.setSlowMode(30);
            this.setFollowerOnly(10);
            ctx.reply('🛡️ Schutz Level 2: Slow (30s) + Follower (10m)');
            break;
          case 3:
            this.setSubOnly(true);
            ctx.reply('🛡️ Schutz Level 3: Sub-Only Modus');
            break;
          default:
            ctx.reply('❌ Level 1-3 verfügbar');
        }
      },
    });
  }

  // Public API
  getCurrentModes(): ChatModeStatus {
    return { ...this.currentModes };
  }

  enableProtectionMode(level: number): void {
    switch (level) {
      case 1:
        this.setSlowMode(10);
        break;
      case 2:
        this.setSlowMode(30);
        this.setFollowerOnly(10);
        break;
      case 3:
        this.setSubOnly(true);
        break;
    }
  }

  disableAllModes(): void {
    this.setEmoteOnly(false);
    this.setSlowMode(0);
    this.setSubOnly(false);
    this.setFollowerOnly(0);
  }
}
