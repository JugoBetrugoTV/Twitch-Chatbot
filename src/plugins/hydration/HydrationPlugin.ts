/**
 * Hydration & Break Reminder Plugin
 *
 * Features:
 * - Periodic water reminders
 * - Stretch/break reminders
 * - Posture reminders
 * - Customizable intervals
 * - Pause during breaks
 */

import { Plugin } from '../base/Plugin';
import { PluginMeta, Permission } from '../../types/plugins';
import { getDatabase, DatabaseService } from '../../services/Database';

interface ReminderSettings {
  enabled: boolean;
  hydrationEnabled: boolean;
  hydrationInterval: number; // minutes
  stretchEnabled: boolean;
  stretchInterval: number;
  postureEnabled: boolean;
  postureInterval: number;
  customMessages: {
    hydration: string[];
    stretch: string[];
    posture: string[];
  };
  quietHours: {
    enabled: boolean;
    start: number; // hour (0-23)
    end: number;
  };
  onlyWhenLive: boolean;
}

const DEFAULT_SETTINGS: ReminderSettings = {
  enabled: true,
  hydrationEnabled: true,
  hydrationInterval: 30,
  stretchEnabled: true,
  stretchInterval: 60,
  postureEnabled: true,
  postureInterval: 45,
  customMessages: {
    hydration: [
      '💧 Zeit für einen Schluck Wasser!',
      '🥤 Hydration Check! Trink was!',
      '💦 Wasser-Erinnerung! Bleib hydriert!',
      '🌊 Dein Körper braucht Wasser! Trink!',
    ],
    stretch: [
      '🧘 Zeit für eine kurze Dehn-Pause!',
      '💪 Stretch-Alarm! Beweg dich mal!',
      '🏃 Kurze Bewegungspause einlegen!',
    ],
    posture: [
      '🪑 Haltungs-Check! Sitz gerade!',
      '📐 Posture-Reminder: Schultern zurück!',
      '🧍 Sitz aufrecht und entspann die Schultern!',
    ],
  },
  quietHours: {
    enabled: false,
    start: 22,
    end: 8,
  },
  onlyWhenLive: true,
};

export class HydrationPlugin extends Plugin {
  meta: PluginMeta = {
    name: 'hydration',
    version: '1.0.0',
    description: 'Health reminders for streamer',
    author: 'StreamCore',
  };

  private db!: DatabaseService;
  private settings: ReminderSettings = DEFAULT_SETTINGS;
  private timers: Map<string, NodeJS.Timeout> = new Map();
  private paused = false;
  private isLive = false;
  private lastReminders: Map<string, Date> = new Map();

  protected async init(): Promise<void> {
    this.db = getDatabase();
    this.log.info('Initializing Hydration Reminders...');

    this.loadSettings();
    this.setupEventHandlers();
    this.registerCommands();
    this.startTimers();

    this.log.info('Hydration Reminders initialized!');
  }

  protected async destroy(): Promise<void> {
    this.stopTimers();
  }

  private loadSettings(): void {
    const saved = this.db.getSetting<ReminderSettings>('hydration_settings');
    if (saved) {
      this.settings = { ...DEFAULT_SETTINGS, ...saved };
    }
  }

  private saveSettings(): void {
    this.db.setSetting('hydration_settings', this.settings);
  }

  private setupEventHandlers(): void {
    this.ctx.events.on('stream:online', () => {
      this.isLive = true;
      if (this.settings.enabled && !this.paused) {
        this.startTimers();
      }
    });

    this.ctx.events.on('stream:offline', () => {
      this.isLive = false;
      if (this.settings.onlyWhenLive) {
        this.stopTimers();
      }
    });
  }

  private startTimers(): void {
    this.stopTimers();

    if (!this.settings.enabled) return;
    if (this.settings.onlyWhenLive && !this.isLive) return;
    if (this.paused) return;

    if (this.settings.hydrationEnabled) {
      const timer = setInterval(() => this.sendReminder('hydration'),
        this.settings.hydrationInterval * 60 * 1000);
      this.timers.set('hydration', timer);
    }

    if (this.settings.stretchEnabled) {
      const timer = setInterval(() => this.sendReminder('stretch'),
        this.settings.stretchInterval * 60 * 1000);
      this.timers.set('stretch', timer);
    }

    if (this.settings.postureEnabled) {
      const timer = setInterval(() => this.sendReminder('posture'),
        this.settings.postureInterval * 60 * 1000);
      this.timers.set('posture', timer);
    }

    this.log.info('Reminder timers started');
  }

  private stopTimers(): void {
    for (const timer of this.timers.values()) {
      clearInterval(timer);
    }
    this.timers.clear();
  }

  private isQuietHours(): boolean {
    if (!this.settings.quietHours.enabled) return false;

    const hour = new Date().getHours();
    const { start, end } = this.settings.quietHours;

    if (start < end) {
      return hour >= start && hour < end;
    } else {
      // Wraps around midnight
      return hour >= start || hour < end;
    }
  }

  private sendReminder(type: 'hydration' | 'stretch' | 'posture'): void {
    if (this.paused) return;
    if (this.isQuietHours()) return;
    if (this.settings.onlyWhenLive && !this.isLive) return;

    const messages = this.settings.customMessages[type];
    const message = messages[Math.floor(Math.random() * messages.length)];

    this.ctx.chat.send(message);
    this.lastReminders.set(type, new Date());

    this.ctx.events.emit('hydration:reminder', { type, message });
    this.log.info(`Sent ${type} reminder`);
  }

  private registerCommands(): void {
    // !hydrate - Toggle or configure hydration reminders
    this.registerCommand({
      name: 'hydrate',
      aliases: ['water', 'drink'],
      description: 'Hydration reminder settings',
      usage: '!hydrate [on|off|interval <minutes>]',
      permission: Permission.BROADCASTER,
      cooldown: { user: 5, global: 0 },
      handler: async (ctx) => {
        const action = ctx.args[0]?.toLowerCase();

        if (!action) {
          ctx.reply(
            `💧 Hydration: ${this.settings.hydrationEnabled ? 'An' : 'Aus'} | ` +
            `Intervall: ${this.settings.hydrationInterval} Min`
          );
          return;
        }

        if (action === 'on' || action === 'an') {
          this.settings.hydrationEnabled = true;
          this.saveSettings();
          this.startTimers();
          ctx.reply('💧 Hydration-Erinnerungen aktiviert');
        } else if (action === 'off' || action === 'aus') {
          this.settings.hydrationEnabled = false;
          this.saveSettings();
          this.startTimers();
          ctx.reply('💧 Hydration-Erinnerungen deaktiviert');
        } else if (action === 'interval') {
          const minutes = parseInt(ctx.args[1]);
          if (isNaN(minutes) || minutes < 5) {
            ctx.reply('❌ Intervall muss mindestens 5 Minuten sein');
            return;
          }
          this.settings.hydrationInterval = minutes;
          this.saveSettings();
          this.startTimers();
          ctx.reply(`💧 Hydration-Intervall: ${minutes} Minuten`);
        } else if (action === 'now') {
          this.sendReminder('hydration');
        }
      },
    });

    // !stretch - Toggle or configure stretch reminders
    this.registerCommand({
      name: 'stretch',
      aliases: ['break', 'move'],
      description: 'Stretch reminder settings',
      usage: '!stretch [on|off|interval <minutes>]',
      permission: Permission.BROADCASTER,
      cooldown: { user: 5, global: 0 },
      handler: async (ctx) => {
        const action = ctx.args[0]?.toLowerCase();

        if (!action) {
          ctx.reply(
            `🧘 Stretch: ${this.settings.stretchEnabled ? 'An' : 'Aus'} | ` +
            `Intervall: ${this.settings.stretchInterval} Min`
          );
          return;
        }

        if (action === 'on' || action === 'an') {
          this.settings.stretchEnabled = true;
          this.saveSettings();
          this.startTimers();
          ctx.reply('🧘 Stretch-Erinnerungen aktiviert');
        } else if (action === 'off' || action === 'aus') {
          this.settings.stretchEnabled = false;
          this.saveSettings();
          this.startTimers();
          ctx.reply('🧘 Stretch-Erinnerungen deaktiviert');
        } else if (action === 'interval') {
          const minutes = parseInt(ctx.args[1]);
          if (isNaN(minutes) || minutes < 10) {
            ctx.reply('❌ Intervall muss mindestens 10 Minuten sein');
            return;
          }
          this.settings.stretchInterval = minutes;
          this.saveSettings();
          this.startTimers();
          ctx.reply(`🧘 Stretch-Intervall: ${minutes} Minuten`);
        } else if (action === 'now') {
          this.sendReminder('stretch');
        }
      },
    });

    // !posture - Toggle or configure posture reminders
    this.registerCommand({
      name: 'posture',
      aliases: ['situp'],
      description: 'Posture reminder settings',
      usage: '!posture [on|off|interval <minutes>]',
      permission: Permission.BROADCASTER,
      cooldown: { user: 5, global: 0 },
      handler: async (ctx) => {
        const action = ctx.args[0]?.toLowerCase();

        if (!action) {
          ctx.reply(
            `🪑 Posture: ${this.settings.postureEnabled ? 'An' : 'Aus'} | ` +
            `Intervall: ${this.settings.postureInterval} Min`
          );
          return;
        }

        if (action === 'on' || action === 'an') {
          this.settings.postureEnabled = true;
          this.saveSettings();
          this.startTimers();
          ctx.reply('🪑 Posture-Erinnerungen aktiviert');
        } else if (action === 'off' || action === 'aus') {
          this.settings.postureEnabled = false;
          this.saveSettings();
          this.startTimers();
          ctx.reply('🪑 Posture-Erinnerungen deaktiviert');
        } else if (action === 'interval') {
          const minutes = parseInt(ctx.args[1]);
          if (isNaN(minutes) || minutes < 10) {
            ctx.reply('❌ Intervall muss mindestens 10 Minuten sein');
            return;
          }
          this.settings.postureInterval = minutes;
          this.saveSettings();
          this.startTimers();
          ctx.reply(`🪑 Posture-Intervall: ${minutes} Minuten`);
        } else if (action === 'now') {
          this.sendReminder('posture');
        }
      },
    });

    // !reminders - Show all reminder settings
    this.registerCommand({
      name: 'reminders',
      aliases: ['health'],
      description: 'Show all reminder settings',
      permission: Permission.BROADCASTER,
      cooldown: { user: 10, global: 5 },
      handler: async (ctx) => {
        const status = [
          `Global: ${this.settings.enabled ? 'An' : 'Aus'}`,
          `Paused: ${this.paused ? 'Ja' : 'Nein'}`,
          `💧 ${this.settings.hydrationEnabled ? `${this.settings.hydrationInterval}m` : 'Aus'}`,
          `🧘 ${this.settings.stretchEnabled ? `${this.settings.stretchInterval}m` : 'Aus'}`,
          `🪑 ${this.settings.postureEnabled ? `${this.settings.postureInterval}m` : 'Aus'}`,
        ].join(' | ');

        ctx.reply(`⏰ Reminders: ${status}`);
      },
    });

    // !pausereminders - Pause all reminders
    this.registerCommand({
      name: 'pausereminders',
      aliases: ['pausehealth', 'reminderpause'],
      description: 'Pause all reminders',
      usage: '!pausereminders [minutes]',
      permission: Permission.BROADCASTER,
      cooldown: { user: 5, global: 0 },
      handler: async (ctx) => {
        if (this.paused) {
          this.paused = false;
          this.startTimers();
          ctx.reply('▶️ Erinnerungen fortgesetzt');
          return;
        }

        this.paused = true;
        this.stopTimers();

        const duration = parseInt(ctx.args[0]);
        if (!isNaN(duration) && duration > 0) {
          setTimeout(() => {
            this.paused = false;
            this.startTimers();
            this.ctx.chat.send('▶️ Erinnerungen automatisch fortgesetzt');
          }, duration * 60 * 1000);
          ctx.reply(`⏸️ Erinnerungen pausiert für ${duration} Minuten`);
        } else {
          ctx.reply('⏸️ Erinnerungen pausiert (!pausereminders zum Fortsetzen)');
        }
      },
    });

    // !quiethours - Set quiet hours
    this.registerCommand({
      name: 'quiethours',
      description: 'Set quiet hours for reminders',
      usage: '!quiethours [on|off|start-end]',
      permission: Permission.BROADCASTER,
      cooldown: { user: 5, global: 0 },
      handler: async (ctx) => {
        const arg = ctx.args[0]?.toLowerCase();

        if (!arg) {
          if (this.settings.quietHours.enabled) {
            ctx.reply(`🌙 Quiet Hours: ${this.settings.quietHours.start}:00 - ${this.settings.quietHours.end}:00`);
          } else {
            ctx.reply('🌙 Quiet Hours: Aus');
          }
          return;
        }

        if (arg === 'off' || arg === 'aus') {
          this.settings.quietHours.enabled = false;
          this.saveSettings();
          ctx.reply('🌙 Quiet Hours deaktiviert');
        } else if (arg === 'on' || arg === 'an') {
          this.settings.quietHours.enabled = true;
          this.saveSettings();
          ctx.reply(`🌙 Quiet Hours aktiviert: ${this.settings.quietHours.start}:00 - ${this.settings.quietHours.end}:00`);
        } else if (arg.includes('-')) {
          const [start, end] = arg.split('-').map((h) => parseInt(h));
          if (isNaN(start) || isNaN(end) || start < 0 || start > 23 || end < 0 || end > 23) {
            ctx.reply('❌ Ungültiges Format. Beispiel: 22-8');
            return;
          }
          this.settings.quietHours.start = start;
          this.settings.quietHours.end = end;
          this.settings.quietHours.enabled = true;
          this.saveSettings();
          ctx.reply(`🌙 Quiet Hours: ${start}:00 - ${end}:00`);
        }
      },
    });

    // !addreminder - Add custom reminder message
    this.registerCommand({
      name: 'addreminder',
      description: 'Add custom reminder message',
      usage: '!addreminder <hydration|stretch|posture> <message>',
      permission: Permission.BROADCASTER,
      cooldown: { user: 5, global: 0 },
      handler: async (ctx) => {
        const type = ctx.args[0]?.toLowerCase() as 'hydration' | 'stretch' | 'posture';
        const message = ctx.args.slice(1).join(' ');

        if (!type || !['hydration', 'stretch', 'posture'].includes(type)) {
          ctx.reply('❌ Typ muss hydration, stretch oder posture sein');
          return;
        }

        if (!message) {
          ctx.reply('❌ Bitte gib eine Nachricht an');
          return;
        }

        this.settings.customMessages[type].push(message);
        this.saveSettings();

        ctx.reply(`✅ ${type}-Nachricht hinzugefügt`);
      },
    });

    // !lastreminder - Show when last reminder was sent
    this.registerCommand({
      name: 'lastreminder',
      description: 'Show last reminder times',
      permission: Permission.BROADCASTER,
      cooldown: { user: 10, global: 5 },
      handler: async (ctx) => {
        const times: string[] = [];

        for (const [type, date] of this.lastReminders) {
          const minutes = Math.floor((Date.now() - date.getTime()) / 60000);
          times.push(`${type}: vor ${minutes}m`);
        }

        if (times.length === 0) {
          ctx.reply('📊 Noch keine Erinnerungen gesendet');
        } else {
          ctx.reply(`📊 Letzte Erinnerungen: ${times.join(' | ')}`);
        }
      },
    });
  }

  // Public API
  isPaused(): boolean {
    return this.paused;
  }

  triggerReminder(type: 'hydration' | 'stretch' | 'posture'): void {
    this.sendReminder(type);
  }

  setInterval(type: 'hydration' | 'stretch' | 'posture', minutes: number): void {
    switch (type) {
      case 'hydration':
        this.settings.hydrationInterval = minutes;
        break;
      case 'stretch':
        this.settings.stretchInterval = minutes;
        break;
      case 'posture':
        this.settings.postureInterval = minutes;
        break;
    }
    this.saveSettings();
    this.startTimers();
  }
}
