/**
 * Sub Goals Plugin
 *
 * Features:
 * - Track sub/follower goals
 * - Progress display
 * - Goal completion alerts
 * - Multiple goal types
 */

import { Plugin } from '../base/Plugin';
import { PluginMeta, Permission } from '../../types/plugins';
import { getDatabase, DatabaseService } from '../../services/Database';

interface Goal {
  id: string;
  type: 'subs' | 'followers' | 'bits' | 'donations' | 'custom';
  name: string;
  target: number;
  current: number;
  reward?: string;
  startedAt: string;
  completedAt?: string;
  active: boolean;
}

export class SubGoalsPlugin extends Plugin {
  meta: PluginMeta = {
    name: 'subgoals',
    version: '1.0.0',
    description: 'Track subscriber and follower goals',
    author: 'StreamCore',
  };

  private db!: DatabaseService;
  private goals: Map<string, Goal> = new Map();

  protected async init(): Promise<void> {
    this.db = getDatabase();
    this.log.info('Initializing Sub Goals...');

    this.initTables();
    this.loadGoals();
    this.setupEventHandlers();
    this.registerCommands();

    this.log.info('Sub Goals initialized!');
  }

  protected async destroy(): Promise<void> {}

  private initTables(): void {
    const db = this.db.raw();
    db.exec(`
      CREATE TABLE IF NOT EXISTS goals (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        name TEXT NOT NULL,
        target INTEGER NOT NULL,
        current INTEGER DEFAULT 0,
        reward TEXT,
        started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        completed_at DATETIME,
        active BOOLEAN DEFAULT TRUE
      );
    `);
  }

  private loadGoals(): void {
    const db = this.db.raw();
    const stmt = db.prepare('SELECT * FROM goals WHERE active = TRUE');
    const rows = stmt.all() as any[];

    for (const row of rows) {
      this.goals.set(row.id, {
        id: row.id,
        type: row.type,
        name: row.name,
        target: row.target,
        current: row.current,
        reward: row.reward,
        startedAt: row.started_at,
        completedAt: row.completed_at,
        active: !!row.active,
      });
    }

    this.log.info(`Loaded ${this.goals.size} active goals`);
  }

  private setupEventHandlers(): void {
    // Track subscriptions
    this.ctx.events.on('twitch:subscription', () => {
      this.incrementGoal('subs', 1);
    });

    // Track bits
    this.ctx.events.on('twitch:cheer', (event: any) => {
      this.incrementGoal('bits', event.bits);
    });

    // Track gift subs
    this.ctx.events.on('twitch:gift', (event: any) => {
      this.incrementGoal('subs', event.amount || 1);
    });
  }

  private incrementGoal(type: string, amount: number): void {
    for (const goal of this.goals.values()) {
      if (goal.type === type && goal.active) {
        goal.current += amount;
        this.saveGoal(goal);

        // Check completion
        if (goal.current >= goal.target && !goal.completedAt) {
          this.completeGoal(goal);
        }
      }
    }
  }

  private completeGoal(goal: Goal): void {
    goal.completedAt = new Date().toISOString();
    goal.active = false;
    this.saveGoal(goal);

    // Emit completion event
    this.ctx.events.emit('goal:completed', {
      goal,
      reward: goal.reward,
    });

    this.log.info(`Goal completed: ${goal.name}`);
  }

  private saveGoal(goal: Goal): void {
    const db = this.db.raw();
    const stmt = db.prepare(`
      INSERT OR REPLACE INTO goals (id, type, name, target, current, reward, started_at, completed_at, active)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      goal.id,
      goal.type,
      goal.name,
      goal.target,
      goal.current,
      goal.reward,
      goal.startedAt,
      goal.completedAt,
      goal.active ? 1 : 0
    );
  }

  private registerCommands(): void {
    // !goal - Show current goal
    this.registerCommand({
      name: 'goal',
      aliases: ['subgoal', 'ziel'],
      description: 'Show current goal progress',
      cooldown: { user: 10, global: 5 },
      handler: async (ctx) => {
        const activeGoals = Array.from(this.goals.values()).filter((g) => g.active);

        if (activeGoals.length === 0) {
          ctx.reply('🎯 Kein aktives Ziel');
          return;
        }

        const goal = activeGoals[0];
        const percent = Math.floor((goal.current / goal.target) * 100);
        const bar = this.createProgressBar(percent);

        ctx.reply(
          `🎯 ${goal.name}: ${goal.current}/${goal.target} ${bar} ${percent}%` +
          (goal.reward ? ` | Belohnung: ${goal.reward}` : '')
        );
      },
    });

    // !setgoal - Create new goal (mod)
    this.registerCommand({
      name: 'setgoal',
      aliases: ['creategoal', 'newgoal'],
      description: 'Create a new goal',
      usage: '!setgoal <type> <target> <name> [reward]',
      permission: Permission.MODERATOR,
      cooldown: { user: 5, global: 0 },
      handler: async (ctx) => {
        if (ctx.args.length < 3) {
          ctx.reply('Verwendung: !setgoal <subs|bits|custom> <ziel> <name> [belohnung]');
          return;
        }

        const type = ctx.args[0].toLowerCase() as Goal['type'];
        const target = parseInt(ctx.args[1]);
        const remaining = ctx.args.slice(2).join(' ');

        // Parse name and optional reward (separated by |)
        const parts = remaining.split('|').map((s) => s.trim());
        const name = parts[0];
        const reward = parts[1];

        if (!['subs', 'followers', 'bits', 'donations', 'custom'].includes(type)) {
          ctx.reply('❌ Ungültiger Typ! (subs, bits, custom)');
          return;
        }

        if (isNaN(target) || target < 1) {
          ctx.reply('❌ Ungültiges Ziel!');
          return;
        }

        const goalId = `goal_${Date.now()}`;
        const goal: Goal = {
          id: goalId,
          type,
          name,
          target,
          current: 0,
          reward,
          startedAt: new Date().toISOString(),
          active: true,
        };

        this.goals.set(goalId, goal);
        this.saveGoal(goal);

        ctx.reply(`✅ Ziel erstellt: ${name} (${target} ${type})`);
      },
    });

    // !goalset - Set current progress (mod)
    this.registerCommand({
      name: 'goalset',
      aliases: ['setprogress'],
      description: 'Set goal progress',
      usage: '!goalset <amount>',
      permission: Permission.MODERATOR,
      cooldown: { user: 5, global: 0 },
      handler: async (ctx) => {
        const amount = parseInt(ctx.args[0]);

        if (isNaN(amount)) {
          ctx.reply('Verwendung: !goalset <menge>');
          return;
        }

        const activeGoal = Array.from(this.goals.values()).find((g) => g.active);
        if (!activeGoal) {
          ctx.reply('❌ Kein aktives Ziel!');
          return;
        }

        activeGoal.current = Math.max(0, amount);
        this.saveGoal(activeGoal);

        ctx.reply(`✅ Fortschritt gesetzt: ${activeGoal.current}/${activeGoal.target}`);
      },
    });

    // !goaladd - Add to progress (mod)
    this.registerCommand({
      name: 'goaladd',
      aliases: ['addgoal'],
      description: 'Add to goal progress',
      usage: '!goaladd <amount>',
      permission: Permission.MODERATOR,
      cooldown: { user: 5, global: 0 },
      handler: async (ctx) => {
        const amount = parseInt(ctx.args[0]) || 1;
        const activeGoal = Array.from(this.goals.values()).find((g) => g.active);

        if (!activeGoal) {
          ctx.reply('❌ Kein aktives Ziel!');
          return;
        }

        activeGoal.current += amount;
        this.saveGoal(activeGoal);

        if (activeGoal.current >= activeGoal.target) {
          this.completeGoal(activeGoal);
          ctx.reply(`🎉 ZIEL ERREICHT! ${activeGoal.name} abgeschlossen!`);
        } else {
          ctx.reply(`✅ +${amount} | ${activeGoal.current}/${activeGoal.target}`);
        }
      },
    });

    // !goalreset - Reset goal (mod)
    this.registerCommand({
      name: 'goalreset',
      aliases: ['resetgoal'],
      description: 'Reset or delete current goal',
      usage: '!goalreset [delete]',
      permission: Permission.MODERATOR,
      cooldown: { user: 5, global: 0 },
      handler: async (ctx) => {
        const activeGoal = Array.from(this.goals.values()).find((g) => g.active);

        if (!activeGoal) {
          ctx.reply('❌ Kein aktives Ziel!');
          return;
        }

        if (ctx.args[0] === 'delete') {
          activeGoal.active = false;
          this.goals.delete(activeGoal.id);
          this.saveGoal(activeGoal);
          ctx.reply('✅ Ziel gelöscht!');
        } else {
          activeGoal.current = 0;
          this.saveGoal(activeGoal);
          ctx.reply('✅ Fortschritt zurückgesetzt!');
        }
      },
    });
  }

  private createProgressBar(percent: number): string {
    const filled = Math.floor(percent / 10);
    const empty = 10 - filled;
    return '[' + '█'.repeat(filled) + '░'.repeat(empty) + ']';
  }

  // Public API
  getActiveGoal(): Goal | null {
    return Array.from(this.goals.values()).find((g) => g.active) || null;
  }

  getAllGoals(): Goal[] {
    return Array.from(this.goals.values());
  }
}
