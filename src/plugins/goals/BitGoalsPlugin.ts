/**
 * Bit Goals Plugin
 *
 * Track bit donation goals with milestones
 * Features:
 * - Bit goal tracking
 * - Milestone rewards
 * - Progress display
 * - Celebration alerts
 */

import { Plugin } from '../base/Plugin';
import { PluginMeta, Permission } from '../../types/plugins';
import { getDatabase, DatabaseService } from '../../services/Database';

interface BitGoal {
  id: string;
  target: number;
  current: number;
  title: string;
  reward: string;
  milestones: BitMilestone[];
  startDate: Date;
  endDate: Date | null;
  active: boolean;
  completed: boolean;
}

interface BitMilestone {
  amount: number;
  reward: string;
  reached: boolean;
}

interface BitGoalSettings {
  enabled: boolean;
  showProgress: boolean;
  celebrateMilestones: boolean;
  celebrateGoal: boolean;
  milestoneMessage: string;
  goalMessage: string;
  progressTemplate: string;
}

const DEFAULT_SETTINGS: BitGoalSettings = {
  enabled: true,
  showProgress: true,
  celebrateMilestones: true,
  celebrateGoal: true,
  milestoneMessage: '🎯 MILESTONE! {current} Bits erreicht! {reward}',
  goalMessage: '🎉🎉🎉 BIT-ZIEL ERREICHT! {current}/{target} Bits! {reward} 🎉🎉🎉',
  progressTemplate: '💎 Bit-Ziel: {current}/{target} ({percent}%) - {title}',
};

export class BitGoalsPlugin extends Plugin {
  meta: PluginMeta = {
    name: 'bitgoals',
    version: '1.0.0',
    description: 'Track bit donation goals with milestones',
    author: 'StreamCore',
  };

  private db!: DatabaseService;
  private settings: BitGoalSettings = DEFAULT_SETTINGS;
  private currentGoal: BitGoal | null = null;

  protected async init(): Promise<void> {
    this.db = getDatabase();
    this.log.info('Initializing Bit Goals...');

    this.initTables();
    this.loadSettings();
    this.loadCurrentGoal();
    this.setupEventHandlers();
    this.registerCommands();

    this.log.info('Bit Goals initialized!');
  }

  protected async destroy(): Promise<void> {}

  private initTables(): void {
    const db = this.db.raw();
    db.exec(`
      CREATE TABLE IF NOT EXISTS bit_goals (
        id TEXT PRIMARY KEY,
        target INTEGER NOT NULL,
        current INTEGER DEFAULT 0,
        title TEXT,
        reward TEXT,
        milestones TEXT,
        start_date DATETIME DEFAULT CURRENT_TIMESTAMP,
        end_date DATETIME,
        active INTEGER DEFAULT 1,
        completed INTEGER DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS bit_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL,
        display_name TEXT,
        amount INTEGER NOT NULL,
        message TEXT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_bit_history_time ON bit_history(timestamp DESC);
    `);
  }

  private loadSettings(): void {
    const saved = this.db.getSetting<BitGoalSettings>('bitgoals_settings');
    if (saved) {
      this.settings = { ...DEFAULT_SETTINGS, ...saved };
    }
  }

  private saveSettings(): void {
    this.db.setSetting('bitgoals_settings', this.settings);
  }

  private loadCurrentGoal(): void {
    const db = this.db.raw();
    const row = db.prepare('SELECT * FROM bit_goals WHERE active = 1 ORDER BY start_date DESC LIMIT 1').get() as any;

    if (row) {
      this.currentGoal = {
        id: row.id,
        target: row.target,
        current: row.current,
        title: row.title || '',
        reward: row.reward || '',
        milestones: row.milestones ? JSON.parse(row.milestones) : [],
        startDate: new Date(row.start_date),
        endDate: row.end_date ? new Date(row.end_date) : null,
        active: row.active === 1,
        completed: row.completed === 1,
      };
    }
  }

  private saveGoal(goal: BitGoal): void {
    const db = this.db.raw();
    db.prepare(`
      INSERT OR REPLACE INTO bit_goals
      (id, target, current, title, reward, milestones, start_date, end_date, active, completed)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      goal.id,
      goal.target,
      goal.current,
      goal.title,
      goal.reward,
      JSON.stringify(goal.milestones),
      goal.startDate.toISOString(),
      goal.endDate?.toISOString() || null,
      goal.active ? 1 : 0,
      goal.completed ? 1 : 0
    );
  }

  private saveBitDonation(username: string, displayName: string, amount: number, message: string): void {
    const db = this.db.raw();
    db.prepare(`
      INSERT INTO bit_history (username, display_name, amount, message)
      VALUES (?, ?, ?, ?)
    `).run(username, displayName, amount, message);
  }

  private formatProgress(): string {
    if (!this.currentGoal) return 'Kein Bit-Ziel aktiv';

    const percent = Math.floor((this.currentGoal.current / this.currentGoal.target) * 100);

    return this.settings.progressTemplate
      .replace('{current}', this.currentGoal.current.toLocaleString('de-DE'))
      .replace('{target}', this.currentGoal.target.toLocaleString('de-DE'))
      .replace('{percent}', percent.toString())
      .replace('{title}', this.currentGoal.title || 'Bit-Ziel')
      .replace('{remaining}', (this.currentGoal.target - this.currentGoal.current).toLocaleString('de-DE'));
  }

  private createProgressBar(current: number, target: number, length: number = 10): string {
    const filled = Math.floor((current / target) * length);
    const empty = length - filled;
    return '█'.repeat(Math.min(filled, length)) + '░'.repeat(Math.max(0, empty));
  }

  private checkMilestones(): void {
    if (!this.currentGoal || !this.settings.celebrateMilestones) return;

    for (const milestone of this.currentGoal.milestones) {
      if (!milestone.reached && this.currentGoal.current >= milestone.amount) {
        milestone.reached = true;
        this.saveGoal(this.currentGoal);

        const message = this.settings.milestoneMessage
          .replace('{current}', milestone.amount.toLocaleString('de-DE'))
          .replace('{reward}', milestone.reward);

        this.ctx.events.emit('chat:send', message);
        this.ctx.events.emit('bitgoal:milestone', { goal: this.currentGoal, milestone });
      }
    }
  }

  private checkGoalCompletion(): void {
    if (!this.currentGoal || this.currentGoal.completed) return;

    if (this.currentGoal.current >= this.currentGoal.target) {
      this.currentGoal.completed = true;
      this.saveGoal(this.currentGoal);

      if (this.settings.celebrateGoal) {
        const message = this.settings.goalMessage
          .replace('{current}', this.currentGoal.current.toLocaleString('de-DE'))
          .replace('{target}', this.currentGoal.target.toLocaleString('de-DE'))
          .replace('{title}', this.currentGoal.title)
          .replace('{reward}', this.currentGoal.reward);

        this.ctx.events.emit('chat:send', message);
      }

      this.ctx.events.emit('bitgoal:completed', { goal: this.currentGoal });
      this.log.info(`Bit goal completed: ${this.currentGoal.target} bits!`);
    }
  }

  private setupEventHandlers(): void {
    // Listen for bit donations (cheers)
    this.ctx.events.on('twitch:cheer', (event: any) => {
      const amount = event.bits || 0;
      if (amount <= 0) return;

      // Save to history
      this.saveBitDonation(event.username, event.displayName, amount, event.message || '');

      // Update goal
      if (this.currentGoal && !this.currentGoal.completed) {
        this.currentGoal.current += amount;
        this.saveGoal(this.currentGoal);
        this.checkMilestones();
        this.checkGoalCompletion();
      }
    });
  }

  private registerCommands(): void {
    // !bitgoal - Show current bit goal
    this.registerCommand({
      name: 'bitgoal',
      aliases: ['bitziel', 'bits'],
      description: 'Show current bit goal progress',
      cooldown: { user: 10, global: 5 },
      handler: async (ctx) => {
        if (!this.currentGoal) {
          ctx.reply('💎 Kein Bit-Ziel aktiv');
          return;
        }

        const progress = this.formatProgress();
        const bar = this.createProgressBar(this.currentGoal.current, this.currentGoal.target);

        ctx.reply(`${progress} [${bar}]`);
      },
    });

    // !setbitgoal - Set new bit goal
    this.registerCommand({
      name: 'setbitgoal',
      description: 'Set a new bit goal',
      usage: '!setbitgoal <target> [title] | [reward]',
      permission: Permission.MODERATOR,
      cooldown: { user: 0, global: 0 },
      handler: async (ctx) => {
        const targetStr = ctx.args[0];
        if (!targetStr) {
          ctx.reply('❌ Usage: !setbitgoal <target> [title] | [reward]');
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

        // Create default milestones at 25%, 50%, 75%
        const milestones: BitMilestone[] = [
          { amount: Math.floor(target * 0.25), reward: '25% erreicht!', reached: false },
          { amount: Math.floor(target * 0.5), reward: '50% erreicht!', reached: false },
          { amount: Math.floor(target * 0.75), reward: '75% erreicht!', reached: false },
        ];

        // Create new goal
        this.currentGoal = {
          id: `bitgoal-${Date.now()}`,
          target,
          current: 0,
          title,
          reward,
          milestones,
          startDate: new Date(),
          endDate: null,
          active: true,
          completed: false,
        };

        this.saveGoal(this.currentGoal);
        ctx.reply(`✅ Bit-Ziel gesetzt: ${target.toLocaleString('de-DE')} Bits${title ? ` - ${title}` : ''}`);
      },
    });

    // !addbitcount - Manually add bits to goal
    this.registerCommand({
      name: 'addbitcount',
      aliases: ['addbits'],
      description: 'Manually add bits to goal',
      usage: '!addbitcount <amount>',
      permission: Permission.MODERATOR,
      cooldown: { user: 0, global: 0 },
      handler: async (ctx) => {
        if (!this.currentGoal) {
          ctx.reply('❌ Kein Bit-Ziel aktiv');
          return;
        }

        const amount = parseInt(ctx.args[0]) || 0;
        if (amount <= 0) {
          ctx.reply('❌ Ungültige Anzahl');
          return;
        }

        this.currentGoal.current += amount;
        this.saveGoal(this.currentGoal);
        this.checkMilestones();
        this.checkGoalCompletion();

        ctx.reply(`✅ ${amount} Bits hinzugefügt (${this.currentGoal.current.toLocaleString('de-DE')}/${this.currentGoal.target.toLocaleString('de-DE')})`);
      },
    });

    // !addmilestone - Add milestone to current goal
    this.registerCommand({
      name: 'addmilestone',
      description: 'Add milestone to bit goal',
      usage: '!addmilestone <amount> <reward>',
      permission: Permission.MODERATOR,
      cooldown: { user: 0, global: 0 },
      handler: async (ctx) => {
        if (!this.currentGoal) {
          ctx.reply('❌ Kein Bit-Ziel aktiv');
          return;
        }

        const amount = parseInt(ctx.args[0]);
        const reward = ctx.args.slice(1).join(' ');

        if (isNaN(amount) || !reward) {
          ctx.reply('❌ Usage: !addmilestone <amount> <reward>');
          return;
        }

        this.currentGoal.milestones.push({
          amount,
          reward,
          reached: this.currentGoal.current >= amount,
        });

        // Sort milestones by amount
        this.currentGoal.milestones.sort((a, b) => a.amount - b.amount);
        this.saveGoal(this.currentGoal);

        ctx.reply(`✅ Milestone bei ${amount.toLocaleString('de-DE')} Bits hinzugefügt: ${reward}`);
      },
    });

    // !topbits - Show top bit donators
    this.registerCommand({
      name: 'topbits',
      aliases: ['topcheers'],
      description: 'Show top bit donators',
      cooldown: { user: 15, global: 5 },
      handler: async (ctx) => {
        const db = this.db.raw();
        const rows = db.prepare(`
          SELECT username, display_name, SUM(amount) as total
          FROM bit_history
          GROUP BY username
          ORDER BY total DESC
          LIMIT 5
        `).all() as any[];

        if (rows.length === 0) {
          ctx.reply('💎 Noch keine Bit-Spenden');
          return;
        }

        const list = rows.map((r, i) => {
          const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`;
          return `${medal} ${r.display_name || r.username}: ${r.total.toLocaleString('de-DE')}`;
        }).join(' | ');

        ctx.reply(`💎 Top Cheerer: ${list}`);
      },
    });

    // !clearbitgoal - Clear current goal
    this.registerCommand({
      name: 'clearbitgoal',
      description: 'Clear current bit goal',
      permission: Permission.BROADCASTER,
      cooldown: { user: 0, global: 0 },
      handler: async (ctx) => {
        if (this.currentGoal) {
          this.currentGoal.active = false;
          this.saveGoal(this.currentGoal);
          this.currentGoal = null;
        }

        ctx.reply('✅ Bit-Ziel gelöscht');
      },
    });
  }

  // Public API
  getCurrentGoal(): BitGoal | null {
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
