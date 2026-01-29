/**
 * Raid Protection Plugin
 *
 * Features:
 * - Anti-hate raid detection
 * - Auto-enable follower/sub mode
 * - Mass message detection
 * - Suspicious account detection
 * - Emergency mode
 */

import { Plugin } from '../base/Plugin';
import { PluginMeta, Permission } from '../../types/plugins';
import { ChatMessageEvent } from '../../types/events';
import { getDatabase, DatabaseService } from '../../services/Database';

interface SuspiciousActivity {
  username: string;
  accountAge?: Date;
  messages: string[];
  timestamp: Date;
}

interface RaidProtectionSettings {
  enabled: boolean;
  // Detection thresholds
  messagesPerSecond: number;
  uniqueUsersThreshold: number;
  detectionWindow: number;
  // Auto-actions
  autoFollowerMode: boolean;
  autoSubMode: boolean;
  autoEmoteOnly: boolean;
  autoSlowMode: number;
  // Account filters
  minAccountAge: number; // hours
  minFollowAge: number; // minutes
  blockNewAccounts: boolean;
  // Message patterns
  banPhrases: string[];
  suspiciousPhrases: string[];
}

const DEFAULT_SETTINGS: RaidProtectionSettings = {
  enabled: true,
  messagesPerSecond: 10,
  uniqueUsersThreshold: 15,
  detectionWindow: 10,
  autoFollowerMode: true,
  autoSubMode: false,
  autoEmoteOnly: false,
  autoSlowMode: 30,
  minAccountAge: 24,
  minFollowAge: 10,
  blockNewAccounts: true,
  banPhrases: [],
  suspiciousPhrases: [],
};

export class RaidProtectionPlugin extends Plugin {
  meta: PluginMeta = {
    name: 'raidprotection',
    version: '1.0.0',
    description: 'Protection against hate raids',
    author: 'StreamCore',
  };

  private db!: DatabaseService;
  private settings: RaidProtectionSettings = DEFAULT_SETTINGS;
  private recentMessages: Map<string, number> = new Map();
  private recentUsers: Set<string> = new Set();
  private suspiciousUsers: Map<string, SuspiciousActivity> = new Map();
  private emergencyMode = false;
  private checkInterval?: NodeJS.Timeout;
  private lastCleanup = Date.now();

  protected async init(): Promise<void> {
    this.db = getDatabase();
    this.log.info('Initializing Raid Protection...');

    this.loadSettings();
    this.setupEventHandlers();
    this.registerCommands();
    this.startMonitoring();

    this.log.info('Raid Protection initialized!');
  }

  protected async destroy(): Promise<void> {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
    }
  }

  private loadSettings(): void {
    const saved = this.db.getSetting<RaidProtectionSettings>('raidprotection_settings');
    if (saved) {
      this.settings = { ...DEFAULT_SETTINGS, ...saved };
    }
  }

  private saveSettings(): void {
    this.db.setSetting('raidprotection_settings', this.settings);
  }

  private startMonitoring(): void {
    // Check for suspicious activity every second
    this.checkInterval = setInterval(() => {
      this.analyzeActivity();
      this.cleanup();
    }, 1000);
  }

  private setupEventHandlers(): void {
    this.ctx.events.on('chat:message', (event: ChatMessageEvent) => {
      if (!this.settings.enabled) return;

      const username = event.user.username.toLowerCase();
      const now = Date.now();

      // Track message
      this.recentMessages.set(username, (this.recentMessages.get(username) || 0) + 1);
      this.recentUsers.add(username);

      // Check for ban phrases
      if (this.containsBanPhrase(event.message)) {
        this.handleSuspiciousUser(event, 'ban_phrase');
        return;
      }

      // Check for suspicious patterns
      if (this.isSuspiciousMessage(event)) {
        this.trackSuspiciousUser(event);
      }
    });

    // Track new users joining
    this.ctx.events.on('chat:join', (event: any) => {
      const username = event.username?.toLowerCase();
      if (username && this.emergencyMode) {
        // In emergency mode, log all new joins
        this.log.warn(`User joined during emergency: ${username}`);
      }
    });
  }

  private containsBanPhrase(message: string): boolean {
    const lowerMessage = message.toLowerCase();
    return this.settings.banPhrases.some((phrase) =>
      lowerMessage.includes(phrase.toLowerCase())
    );
  }

  private isSuspiciousMessage(event: ChatMessageEvent): boolean {
    const lowerMessage = event.message.toLowerCase();

    // Check suspicious phrases
    if (this.settings.suspiciousPhrases.some((phrase) =>
      lowerMessage.includes(phrase.toLowerCase())
    )) {
      return true;
    }

    // Check for repeated characters (spam pattern)
    if (/(.)\1{10,}/.test(event.message)) {
      return true;
    }

    // Check for excessive caps
    const capsRatio = (event.message.match(/[A-Z]/g)?.length || 0) / event.message.length;
    if (event.message.length > 20 && capsRatio > 0.7) {
      return true;
    }

    return false;
  }

  private trackSuspiciousUser(event: ChatMessageEvent): void {
    const username = event.user.username.toLowerCase();

    let activity = this.suspiciousUsers.get(username);
    if (!activity) {
      activity = {
        username: event.user.username,
        messages: [],
        timestamp: new Date(),
      };
      this.suspiciousUsers.set(username, activity);
    }

    activity.messages.push(event.message);

    // If user has too many suspicious messages, take action
    if (activity.messages.length >= 3) {
      this.handleSuspiciousUser(event, 'pattern');
    }
  }

  private handleSuspiciousUser(event: ChatMessageEvent, reason: string): void {
    const username = event.user.username.toLowerCase();

    this.log.warn(`Suspicious user detected: ${username} (${reason})`);

    // Emit event for other plugins
    this.ctx.events.emit('raidprotection:suspicious', {
      user: event.user,
      reason,
      message: event.message,
    });

    // Auto-timeout if enabled
    if (this.settings.enabled) {
      this.ctx.events.emit('moderation:timeout', {
        username,
        duration: 600,
        reason: `Raid Protection: ${reason}`,
      });
    }
  }

  private analyzeActivity(): void {
    if (!this.settings.enabled) return;

    const messagesPerSecond = this.recentMessages.size;
    const uniqueUsers = this.recentUsers.size;

    // Check if we're under attack
    if (
      messagesPerSecond >= this.settings.messagesPerSecond ||
      uniqueUsers >= this.settings.uniqueUsersThreshold
    ) {
      if (!this.emergencyMode) {
        this.triggerEmergencyMode();
      }
    }
  }

  private triggerEmergencyMode(): void {
    this.emergencyMode = true;
    this.log.warn('🚨 EMERGENCY MODE ACTIVATED - Possible hate raid detected!');

    this.ctx.events.emit('raidprotection:emergency', {
      timestamp: new Date(),
      messagesPerSecond: this.recentMessages.size,
      uniqueUsers: this.recentUsers.size,
    });

    // Announce in chat
    this.ctx.chat.send('🛡️ Raid-Schutz aktiviert! Chat-Beschränkungen sind aktiv.');

    // Apply protections
    if (this.settings.autoFollowerMode) {
      this.ctx.events.emit('chat:mode', { mode: 'followers', duration: 10 });
      this.log.info('Enabled follower-only mode');
    }

    if (this.settings.autoSubMode) {
      this.ctx.events.emit('chat:mode', { mode: 'subscribers' });
      this.log.info('Enabled subscriber-only mode');
    }

    if (this.settings.autoEmoteOnly) {
      this.ctx.events.emit('chat:mode', { mode: 'emoteonly' });
      this.log.info('Enabled emote-only mode');
    }

    if (this.settings.autoSlowMode > 0) {
      this.ctx.events.emit('chat:mode', { mode: 'slow', duration: this.settings.autoSlowMode });
      this.log.info(`Enabled slow mode: ${this.settings.autoSlowMode}s`);
    }

    // Log incident
    this.db.logEvent('raid_protection', {
      type: 'emergency_activated',
      messagesPerSecond: this.recentMessages.size,
      uniqueUsers: this.recentUsers.size,
    });
  }

  private cleanup(): void {
    const now = Date.now();

    // Cleanup every detection window
    if (now - this.lastCleanup > this.settings.detectionWindow * 1000) {
      this.recentMessages.clear();
      this.recentUsers.clear();
      this.lastCleanup = now;
    }

    // Remove old suspicious users
    const expireTime = now - 300000; // 5 minutes
    for (const [username, activity] of this.suspiciousUsers) {
      if (activity.timestamp.getTime() < expireTime) {
        this.suspiciousUsers.delete(username);
      }
    }
  }

  private registerCommands(): void {
    // !raidprotect - Toggle or configure raid protection
    this.registerCommand({
      name: 'raidprotect',
      aliases: ['rp', 'antiraid'],
      description: 'Configure raid protection',
      usage: '!raidprotect [on|off|status]',
      permission: Permission.MODERATOR,
      cooldown: { user: 5, global: 0 },
      handler: async (ctx) => {
        const action = ctx.args[0]?.toLowerCase();

        if (!action || action === 'status') {
          ctx.reply(
            `🛡️ Raid-Schutz: ${this.settings.enabled ? 'An' : 'Aus'} | ` +
            `Emergency: ${this.emergencyMode ? '🚨 AKTIV' : '✅ Normal'} | ` +
            `Verdächtige: ${this.suspiciousUsers.size}`
          );
          return;
        }

        if (action === 'on') {
          this.settings.enabled = true;
          this.saveSettings();
          ctx.reply('🛡️ Raid-Schutz aktiviert');
        } else if (action === 'off') {
          this.settings.enabled = false;
          this.saveSettings();
          ctx.reply('🛡️ Raid-Schutz deaktiviert');
        }
      },
    });

    // !emergency - Toggle emergency mode manually
    this.registerCommand({
      name: 'emergency',
      aliases: ['panic', 'lockdown'],
      description: 'Manually trigger emergency mode',
      usage: '!emergency [on|off]',
      permission: Permission.MODERATOR,
      cooldown: { user: 5, global: 0 },
      handler: async (ctx) => {
        const action = ctx.args[0]?.toLowerCase();

        if (action === 'on' || !action && !this.emergencyMode) {
          this.triggerEmergencyMode();
          ctx.reply('🚨 Emergency-Modus manuell aktiviert!');
        } else if (action === 'off' || !action && this.emergencyMode) {
          this.emergencyMode = false;
          this.ctx.chat.send('✅ Emergency-Modus deaktiviert. Chat-Beschränkungen können aufgehoben werden.');
          ctx.reply('✅ Emergency-Modus deaktiviert');
        }
      },
    });

    // !banphrase - Add/remove ban phrases
    this.registerCommand({
      name: 'banphrase',
      aliases: ['bp'],
      description: 'Manage ban phrases',
      usage: '!banphrase <add|remove|list> [phrase]',
      permission: Permission.MODERATOR,
      cooldown: { user: 5, global: 0 },
      handler: async (ctx) => {
        const action = ctx.args[0]?.toLowerCase();
        const phrase = ctx.args.slice(1).join(' ');

        if (!action || action === 'list') {
          if (this.settings.banPhrases.length === 0) {
            ctx.reply('📋 Keine Ban-Phrasen konfiguriert');
            return;
          }
          ctx.reply(`📋 Ban-Phrasen (${this.settings.banPhrases.length}): ${this.settings.banPhrases.join(', ')}`);
          return;
        }

        if (!phrase) {
          ctx.reply('❌ Bitte gib eine Phrase an');
          return;
        }

        if (action === 'add') {
          if (this.settings.banPhrases.includes(phrase.toLowerCase())) {
            ctx.reply('ℹ️ Phrase bereits vorhanden');
            return;
          }
          this.settings.banPhrases.push(phrase.toLowerCase());
          this.saveSettings();
          ctx.reply(`✅ Ban-Phrase hinzugefügt: "${phrase}"`);
        } else if (action === 'remove') {
          const index = this.settings.banPhrases.indexOf(phrase.toLowerCase());
          if (index === -1) {
            ctx.reply('ℹ️ Phrase nicht gefunden');
            return;
          }
          this.settings.banPhrases.splice(index, 1);
          this.saveSettings();
          ctx.reply(`✅ Ban-Phrase entfernt: "${phrase}"`);
        }
      },
    });

    // !suspicious - View suspicious users
    this.registerCommand({
      name: 'suspicious',
      aliases: ['suspects'],
      description: 'View suspicious users',
      permission: Permission.MODERATOR,
      cooldown: { user: 10, global: 5 },
      handler: async (ctx) => {
        if (this.suspiciousUsers.size === 0) {
          ctx.reply('✅ Keine verdächtigen User erkannt');
          return;
        }

        const list = Array.from(this.suspiciousUsers.values())
          .slice(0, 5)
          .map((u) => `${u.username} (${u.messages.length} msgs)`)
          .join(', ');

        ctx.reply(`🔍 Verdächtige User (${this.suspiciousUsers.size}): ${list}`);
      },
    });

    // !clearsuspicious - Clear suspicious user list
    this.registerCommand({
      name: 'clearsuspicious',
      description: 'Clear suspicious user list',
      permission: Permission.MODERATOR,
      cooldown: { user: 30, global: 10 },
      handler: async (ctx) => {
        this.suspiciousUsers.clear();
        ctx.reply('✅ Liste verdächtiger User geleert');
      },
    });

    // !raidconfig - Configure raid protection settings
    this.registerCommand({
      name: 'raidconfig',
      description: 'Configure raid protection thresholds',
      usage: '!raidconfig <setting> <value>',
      permission: Permission.BROADCASTER,
      cooldown: { user: 5, global: 0 },
      handler: async (ctx) => {
        const setting = ctx.args[0]?.toLowerCase();
        const value = ctx.args[1];

        if (!setting) {
          ctx.reply(
            `⚙️ Config: MPS=${this.settings.messagesPerSecond} | ` +
            `Users=${this.settings.uniqueUsersThreshold} | ` +
            `Window=${this.settings.detectionWindow}s | ` +
            `Slow=${this.settings.autoSlowMode}s`
          );
          return;
        }

        if (!value) {
          ctx.reply('❌ Bitte gib einen Wert an');
          return;
        }

        const numValue = parseInt(value);

        switch (setting) {
          case 'mps':
            this.settings.messagesPerSecond = numValue;
            ctx.reply(`✅ Messages per Second: ${numValue}`);
            break;
          case 'users':
            this.settings.uniqueUsersThreshold = numValue;
            ctx.reply(`✅ User Threshold: ${numValue}`);
            break;
          case 'window':
            this.settings.detectionWindow = numValue;
            ctx.reply(`✅ Detection Window: ${numValue}s`);
            break;
          case 'slow':
            this.settings.autoSlowMode = numValue;
            ctx.reply(`✅ Auto Slow Mode: ${numValue}s`);
            break;
          default:
            ctx.reply('❌ Unbekannte Einstellung (mps, users, window, slow)');
            return;
        }

        this.saveSettings();
      },
    });
  }

  // Public API
  isEmergencyActive(): boolean {
    return this.emergencyMode;
  }

  getSuspiciousUsers(): Map<string, SuspiciousActivity> {
    return new Map(this.suspiciousUsers);
  }

  addBanPhrase(phrase: string): void {
    if (!this.settings.banPhrases.includes(phrase.toLowerCase())) {
      this.settings.banPhrases.push(phrase.toLowerCase());
      this.saveSettings();
    }
  }
}
