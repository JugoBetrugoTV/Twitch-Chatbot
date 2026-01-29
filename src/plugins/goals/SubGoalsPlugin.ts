/**
 * Sub Goals Plugin
 *
 * Track subscription goals with progress
 * Features:
 * - Sub goal tracking
 * - Progress display
 * - Goal milestones
 * - Celebration alerts
 */

import { Plugin } from '../base/Plugin';
import { PluginMeta, Permission } from '../../types/plugins';
import { getDatabase, DatabaseService } from '../../services/Database';

interface SubGoal {
  id: string;
  target: number;
  current: number;
  title: string;
  reward: string;
  startDate: Date;
  endDate: Date | null;
  active: boolean;
  completed: boolean;
}

interface SubGoalSettings {
  enabled: boolean;
  showProgress: boolean;
  celebrateGoal: boolean;
  celebrationMessage: string;
  progressTemplate: string;
}

const DEFAULT_SETTINGS: SubGoalSettings = {
  enabled: true,
  showProgress: true,
  celebrateGoal: true,
  celebrationMessage: '🎉🎉🎉 SUB-ZIEL ERREICHT! {current}/{target} Subs! {reward} 🎉🎉🎉',
  progressTemplate: '📊 Sub-Ziel: {current}/{target} ({percent}%) - {title}',
};

export class SubGoalsPlugin extends Plugin {
  meta: PluginMeta = {
    name: 'subgoals',
    version: '1.0.0',
    description: 'Track subscription goals with progress',
    author: 'StreamCore',
  };

  private db!: DatabaseService;
  private settings: SubGoalSettings = DEFAULT_SETTINGS;
  private currentGoal: SubGoal | null = null;

  protected async init(): Promise<void> {
    this.db = getDatabase();
    this.log.info('Initializing Sub Goals...');

    this.initTables();
    this.loadSettings();
    this.loadCurrentGoal();
    this.setupEventHandlers();
    this.registerCommands();

    this.log.info('Sub Goals initialized!');
  }

  protected async destroy(): Promise<void> {}

  private initTables(): void {
    const db = this.db.raw();
    db.exec(`
      CREATE TABLE IF NOT EXISTS sub_goals (
        id TEXT PRIMARY KEY,
        target INTEGER NOT NULL,
        current INTEGER DEFAULT 0,
        title TEXT,
        reward TEXT,
        start_date DATETIME DEFAULT CURRENT_TIMESTAMP,
        end_date DATETIME,
        active INTEGER DEFAULT 1,
        completed INTEGER DEFAULT 0
      );
    `);
  }

  private loadSettings(): void {
    const saved = this.db.getSetting<SubGoalSettings>('subgoals_settings');
    if (saved) {
      this.settings = { ...DEFAULT_SETTINGS, ...saved };
    }
  }

  private saveSettings(): void {
    this.db.setSetting('subgoals_settings', this.settings);
  }

  private loadCurrentGoal(): void {
    const db = this.db.raw();
    const row = db.prepare('SELECT * FROM sub_goals WHERE active = 1 ORDER BY start_date DESC LIMIT 1').get() as any;

    if (row) {
      this.currentGoal = {
        id: row.id,
        target: row.target,
        current: row.current,
        title: row.title || '',
        reward: row.reward || '',
        startDate: new Date(row.start_date),
        endDate: row.end_date ? new Date(row.end_date) : null,
        active: row.active === 1,
        completed: row.completed === 1,
      };
    }
  }

  private saveGoal(goal: SubGoal): void {
    const db = this.db.raw();
    db.prepare(`
      INSERT OR REPLACE INTO sub_goals
      (id, target, current, title, reward, start_date, end_date, active, completed)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      goal.id,
      goal.target,
      goal.current,
      goal.title,
      goal.reward,
      goal.startDate.toISOString(),
      goal.endDate?.toISOString() || null,
      goal.active ? 1 : 0,
      goal.completed ? 1 : 0
    );
  }

  private formatProgress(): string {
    if (!this.currentGoal) return 'Kein Sub-Ziel aktiv';

    const percent = Math.floor((this.currentGoal.current / this.currentGoal.target) * 100);

    return this.settings.progressTemplate
      .replace('{current}', this.currentGoal.current.toString())
      .replace('{target}', this.currentGoal.target.toString())
      .replace('{percent}', percent.toString())
      .replace('{title}', this.currentGoal.title || 'Sub-Ziel')
      .replace('{remaining}', (this.currentGoal.target - this.currentGoal.current).toString());
  }

  private createProgressBar(current: number, target: number, length: number = 10): string {
    const filled = Math.floor((current / target) * length);
    const empty = length - filled;
    return '█'.repeat(filled) + '░'.repeat(empty);
  }

  private checkGoalCompletion(): void {
    if (!this.currentGoal || this.currentGoal.completed) return;

    if (this.currentGoal.current >= this.currentGoal.target) {
      this.currentGoal.completed = true;
      this.saveGoal(this.currentGoal);

      if (this.settings.celebrateGoal) {
        const message = this.settings.celebrationMessage
          .replace('{current}', this.currentGoal.current.toString())
          .replace('{target}', this.currentGoal.target.toString())
          .replace('{title}', this.currentGoal.title)
          .replace('{reward}', this.currentGoal.reward);

        this.ctx.events.emit('chat:send', message);
      }

      this.ctx.events.emit('subgoal:completed', { goal: this.currentGoal });
      this.log.info(`Sub goal completed: ${this.currentGoal.target} subs!`);
    }
  }

  private setupEventHandlers(): void {
    // Listen for new subscriptions
    this.ctx.events.on('twitch:sub', () => {
      if (this.currentGoal && !this.currentGoal.completed) {
        this.currentGoal.current++;
        this.saveGoal(this.currentGoal);
        this.checkGoalCompletion();
      }
    });

    // Listen for gift subs
    this.ctx.events.on('twitch:subgift', (event: any) => {
      if (this.currentGoal && !this.currentGoal.completed) {
        const amount = event.amount || 1;
        this.currentGoal.current += amount;
        this.saveGoal(this.currentGoal);
        this.checkGoalCompletion();
      }
    });

    // Listen for community gift subs
    this.ctx.events.on('twitch:submysterygift', (event: any) => {
      if (this.currentGoal && !this.currentGoal.completed) {
        const amount = event.amount || 1;
        this.currentGoal.current += amount;
        this.saveGoal(this.currentGoal);
        this.checkGoalCompletion();
      }
    });
  }

  private registerCommands(): void {
    // !subgoal - Show current sub goal
    this.registerCommand({
      name: 'subgoal',
      aliases: ['subziel', 'subs'],
      description: 'Show current sub goal progress',
      cooldown: { user: 10, global: 5 },
      handler: async (ctx) => {
        if (!this.currentGoal) {
          ctx.reply('📊 Kein Sub-Ziel aktiv');
          return;
        }

        const progress = this.formatProgress();
        const bar = this.createProgressBar(this.currentGoal.current, this.currentGoal.target);

        ctx.reply(`${progress} [${bar}]`);
      },
    });

    // !setsubgoal - Set new sub goal
    this.registerCommand({
      name: 'setsubgoal',
      description: 'Set a new sub goal',
      usage: '!setsubgoal <target> [title] | [reward]',
      permission: Permission.MODERATOR,
      cooldown: { user: 0, global: 0 },
      handler: async (ctx) => {
        const targetStr = ctx.args[0];
        if (!targetStr) {
          ctx.reply('❌ Usage: !setsubgoal <target> [title] | [reward]');
          return;
        }

        const target = parseInt(targetStr);
        if (isNaN(target) || target <= 0) {
          ctx.reply('❌ Ungültiges Ziel');
          return;
        }

        // Parse title and reward
        const rest = ctx.args.slice(1).join(' ');
        const parts = rest.split('|').map((p) => p.trim());
        const title = parts[0] || '';
        const reward = parts[1] || '';

        // Deactivate current goal
        if (this.currentGoal) {
          this.currentGoal.active = false;
          this.saveGoal(this.currentGoal);
        }

        // Create new goal
        this.currentGoal = {
          id: `subgoal-${Date.now()}`,
          target,
          current: 0,
          title,
          reward,
          startDate: new Date(),
          endDate: null,
          active: true,
          completed: false,
        };

        this.saveGoal(this.currentGoal);
        ctx.reply(`✅ Sub-Ziel gesetzt: ${target} Subs${title ? ` - ${title}` : ''}`);
      },
    });

    // !addsubcount - Manually add subs to goal
    this.registerCommand({
      name: 'addsubcount',
      aliases: ['addsubs'],
      description: 'Manually add subs to goal',
      usage: '!addsubcount <amount>',
      permission: Permission.MODERATOR,
      cooldown: { user: 0, global: 0 },
      handler: async (ctx) => {
        if (!this.currentGoal) {
          ctx.reply('❌ Kein Sub-Ziel aktiv');
          return;
        }

        const amount = parseInt(ctx.args[0]) || 1;
        this.currentGoal.current += amount;
        this.saveGoal(this.currentGoal);
        this.checkGoalCompletion();

        ctx.reply(`✅ ${amount} Subs hinzugefügt (${this.currentGoal.current}/${this.currentGoal.target})`);
      },
    });

    // !setsubcount - Set current sub count
    this.registerCommand({
      name: 'setsubcount',
      description: 'Set current sub count',
      usage: '!setsubcount <amount>',
      permission: Permission.MODERATOR,
      cooldown: { user: 0, global: 0 },
      handler: async (ctx) => {
        if (!this.currentGoal) {
          ctx.reply('❌ Kein Sub-Ziel aktiv');
          return;
        }

        const amount = parseInt(ctx.args[0]);
        if (isNaN(amount) || amount < 0) {
          ctx.reply('❌ Ungültige Anzahl');
          return;
        }

        this.currentGoal.current = amount;
        this.saveGoal(this.currentGoal);
        this.checkGoalCompletion();

        ctx.reply(`✅ Sub-Zähler auf ${amount} gesetzt (${this.currentGoal.current}/${this.currentGoal.target})`);
      },
    });

    // !clearsubgoal - Clear current goal
    this.registerCommand({
      name: 'clearsubgoal',
      description: 'Clear current sub goal',
      permission: Permission.BROADCASTER,
      cooldown: { user: 0, global: 0 },
      handler: async (ctx) => {
        if (this.currentGoal) {
          this.currentGoal.active = false;
          this.saveGoal(this.currentGoal);
          this.currentGoal = null;
        }

        ctx.reply('✅ Sub-Ziel gelöscht');
      },
    });
  }

  // Public API
  getCurrentGoal(): SubGoal | null {
    return this.currentGoal ? { ...this.currentGoal } : null;
  }

  getProgress(): { current: number; target: number; percent: number } | null {
    if (!this.currentGoal) return null;
    return {
      current: this.currentGoal.current,
      target: this.currentGoal.target,
      percent: Math.floor((this.currentGoal.current / this.currentGoal.target) * 100),
    };
  }
}
