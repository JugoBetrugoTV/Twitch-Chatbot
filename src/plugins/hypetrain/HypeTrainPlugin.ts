/**
 * Hype Train Plugin
 *
 * Features:
 * - Track active hype trains
 * - Progress notifications
 * - Level up alerts
 * - Contribution tracking
 */

import { Plugin } from '../base/Plugin';
import { PluginMeta, Permission } from '../../types/plugins';
import { getDatabase, DatabaseService } from '../../services/Database';

interface HypeTrain {
  id: string;
  level: number;
  progress: number;
  goal: number;
  totalContributions: number;
  topContributors: { username: string; amount: number; type: string }[];
  startedAt: Date;
  expiresAt: Date;
  active: boolean;
}

interface HypeTrainSettings {
  enabled: boolean;
  announceStart: boolean;
  announceLevelUp: boolean;
  announceEnd: boolean;
  announceProgress: boolean;
  progressInterval: number; // Announce every X percent
}

const DEFAULT_SETTINGS: HypeTrainSettings = {
  enabled: true,
  announceStart: true,
  announceLevelUp: true,
  announceEnd: true,
  announceProgress: true,
  progressInterval: 25,
};

export class HypeTrainPlugin extends Plugin {
  meta: PluginMeta = {
    name: 'hypetrain',
    version: '1.0.0',
    description: 'Track and celebrate hype trains',
    author: 'StreamCore',
  };

  private db!: DatabaseService;
  private settings: HypeTrainSettings = DEFAULT_SETTINGS;
  private currentTrain: HypeTrain | null = null;
  private lastAnnouncedProgress = 0;
  private defaultChannel: string = '';

  protected async init(): Promise<void> {
    this.db = getDatabase();
    this.log.info('Initializing Hype Train...');

    this.defaultChannel = process.env.TWITCH_CHANNEL || '';
    this.loadSettings();
    this.setupEventHandlers();
    this.registerCommands();

    this.log.info('Hype Train initialized!');
  }

  protected async destroy(): Promise<void> {}

  private loadSettings(): void {
    const saved = this.db.getSetting<HypeTrainSettings>('hypetrain_settings');
    if (saved) {
      this.settings = { ...DEFAULT_SETTINGS, ...saved };
    }
  }

  private saveSettings(): void {
    this.db.setSetting('hypetrain_settings', this.settings);
  }

  private setupEventHandlers(): void {
    // Hype train started
    this.ctx.events.on('twitch:hypeTrainBegin', (event: any) => {
      this.currentTrain = {
        id: event.id,
        level: 1,
        progress: 0,
        goal: event.goal,
        totalContributions: 0,
        topContributors: [],
        startedAt: new Date(),
        expiresAt: new Date(event.expires_at),
        active: true,
      };

      this.lastAnnouncedProgress = 0;

      if (this.settings.enabled && this.settings.announceStart) {
        this.sendMessage(
          this.defaultChannel,
          `🚂 HYPE TRAIN GESTARTET! Level 1 | Ziel: ${event.goal} | LET'S GOOO!`
        );
      }

      this.db.logEvent('hypetrain_start', { id: event.id });
    });

    // Hype train progress
    this.ctx.events.on('twitch:hypeTrainProgress', (event: any) => {
      if (!this.currentTrain) return;

      this.currentTrain.progress = event.progress;
      this.currentTrain.goal = event.goal;
      this.currentTrain.level = event.level;
      this.currentTrain.totalContributions = event.total;

      // Update top contributors
      if (event.top_contributions) {
        this.currentTrain.topContributors = event.top_contributions.map((c: any) => ({
          username: c.user_name,
          amount: c.total,
          type: c.type,
        }));
      }

      // Announce progress
      const progressPercent = Math.floor((event.progress / event.goal) * 100);
      if (
        this.settings.enabled &&
        this.settings.announceProgress &&
        progressPercent >= this.lastAnnouncedProgress + this.settings.progressInterval
      ) {
        this.lastAnnouncedProgress = Math.floor(progressPercent / this.settings.progressInterval) * this.settings.progressInterval;
        this.sendMessage(
          this.defaultChannel,
          `🚂 Hype Train Level ${event.level}: ${progressPercent}% | Weiter so!`
        );
      }
    });

    // Hype train level up
    this.ctx.events.on('twitch:hypeTrainLevelUp', (event: any) => {
      if (!this.currentTrain) return;

      this.currentTrain.level = event.level;
      this.lastAnnouncedProgress = 0;

      if (this.settings.enabled && this.settings.announceLevelUp) {
        const emojis = ['🎉', '🔥', '💥', '⚡', '🚀'];
        const emoji = emojis[Math.min(event.level - 1, emojis.length - 1)];

        this.sendMessage(
          this.defaultChannel,
          `${emoji} LEVEL ${event.level}! Der Hype Train fährt weiter! ${emoji}`
        );
      }
    });

    // Hype train ended
    this.ctx.events.on('twitch:hypeTrainEnd', (event: any) => {
      if (!this.currentTrain) return;

      if (this.settings.enabled && this.settings.announceEnd) {
        const topUser = this.currentTrain.topContributors[0];
        const topInfo = topUser ? ` | Top: ${topUser.username} (${topUser.amount})` : '';

        this.sendMessage(
          this.defaultChannel,
          `🚂 Hype Train beendet auf Level ${event.level}!${topInfo} | Danke an alle!`
        );
      }

      // Log to database
      this.db.logEvent('hypetrain_end', {
        id: this.currentTrain.id,
        level: event.level,
        total: this.currentTrain.totalContributions,
        topContributors: this.currentTrain.topContributors.slice(0, 5),
      });

      this.currentTrain = null;
    });

    // Track contributions
    this.ctx.events.on('twitch:subscription', () => {
      if (this.currentTrain) {
        this.currentTrain.totalContributions++;
      }
    });

    this.ctx.events.on('twitch:cheer', (event: any) => {
      if (this.currentTrain) {
        this.currentTrain.totalContributions += event.bits;
      }
    });
  }

  private registerCommands(): void {
    // !hypetrain - Show current hype train status
    this.registerCommand({
      name: 'hypetrain',
      aliases: ['hype', 'train'],
      description: 'Show hype train status',
      cooldown: { user: 10, global: 5 },
      handler: async (ctx) => {
        if (!this.currentTrain || !this.currentTrain.active) {
          ctx.reply('🚂 Kein aktiver Hype Train');
          return;
        }

        const progressPercent = Math.floor(
          (this.currentTrain.progress / this.currentTrain.goal) * 100
        );
        const remaining = Math.ceil(
          (this.currentTrain.expiresAt.getTime() - Date.now()) / 1000
        );

        ctx.reply(
          `🚂 Level ${this.currentTrain.level} | ${progressPercent}% (${this.currentTrain.progress}/${this.currentTrain.goal}) | ` +
          `⏱️ ${remaining}s`
        );
      },
    });

    // !hypetop - Show top contributors
    this.registerCommand({
      name: 'hypetop',
      aliases: ['hypecontributors'],
      description: 'Show hype train top contributors',
      cooldown: { user: 30, global: 10 },
      handler: async (ctx) => {
        if (!this.currentTrain || this.currentTrain.topContributors.length === 0) {
          ctx.reply('🚂 Keine Hype Train Daten verfügbar');
          return;
        }

        const top = this.currentTrain.topContributors
          .slice(0, 5)
          .map((c, i) => `${i + 1}. ${c.username}: ${c.amount}`)
          .join(' | ');

        ctx.reply(`🚂 Top Contributors: ${top}`);
      },
    });

    // !hypehistory - Show recent hype trains
    this.registerCommand({
      name: 'hypehistory',
      aliases: ['hypetrains'],
      description: 'Show recent hype trains',
      permission: Permission.MODERATOR,
      cooldown: { user: 30, global: 10 },
      handler: async (ctx) => {
        const events = this.db.getRecentEvents(5, 'hypetrain_end');

        if (events.length === 0) {
          ctx.reply('🚂 Keine Hype Train Historie');
          return;
        }

        const history = events.map((e) => {
          const data = JSON.parse(e.data);
          return `L${data.level}`;
        }).join(', ');

        ctx.reply(`🚂 Letzte Hype Trains: ${history}`);
      },
    });

    // !hypetoggle - Toggle hype train announcements
    this.registerCommand({
      name: 'hypetoggle',
      description: 'Toggle hype train announcements',
      permission: Permission.MODERATOR,
      cooldown: { user: 5, global: 0 },
      handler: async (ctx) => {
        const setting = ctx.args[0]?.toLowerCase();

        if (!setting) {
          this.settings.enabled = !this.settings.enabled;
          this.saveSettings();
          ctx.reply(`🚂 Hype Train Ankündigungen: ${this.settings.enabled ? 'An' : 'Aus'}`);
          return;
        }

        switch (setting) {
          case 'start':
            this.settings.announceStart = !this.settings.announceStart;
            ctx.reply(`🚂 Start-Ankündigung: ${this.settings.announceStart ? 'An' : 'Aus'}`);
            break;
          case 'level':
            this.settings.announceLevelUp = !this.settings.announceLevelUp;
            ctx.reply(`🚂 Level-Up-Ankündigung: ${this.settings.announceLevelUp ? 'An' : 'Aus'}`);
            break;
          case 'end':
            this.settings.announceEnd = !this.settings.announceEnd;
            ctx.reply(`🚂 End-Ankündigung: ${this.settings.announceEnd ? 'An' : 'Aus'}`);
            break;
          case 'progress':
            this.settings.announceProgress = !this.settings.announceProgress;
            ctx.reply(`🚂 Progress-Ankündigung: ${this.settings.announceProgress ? 'An' : 'Aus'}`);
            break;
          default:
            ctx.reply('Verwendung: !hypetoggle [start|level|end|progress]');
        }

        this.saveSettings();
      },
    });
  }

  // Public API
  isActive(): boolean {
    return this.currentTrain !== null && this.currentTrain.active;
  }

  getCurrentLevel(): number {
    return this.currentTrain?.level || 0;
  }

  getProgress(): { current: number; goal: number } | null {
    if (!this.currentTrain) return null;
    return {
      current: this.currentTrain.progress,
      goal: this.currentTrain.goal,
    };
  }
}
