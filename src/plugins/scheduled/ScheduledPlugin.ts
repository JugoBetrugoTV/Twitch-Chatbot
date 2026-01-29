/**
 * Scheduled Commands Plugin
 *
 * Features:
 * - Run commands at specific times
 * - Cron-like scheduling
 * - One-time and recurring schedules
 * - Timezone support
 */

import { Plugin } from '../base/Plugin';
import { PluginMeta, Permission } from '../../types/plugins';
import { getDatabase, DatabaseService } from '../../services/Database';

interface ScheduledTask {
  id: string;
  name: string;
  type: 'message' | 'command';
  content: string;
  channel: string;
  schedule: {
    type: 'once' | 'daily' | 'weekly' | 'interval';
    time?: string; // HH:MM format
    days?: number[]; // 0-6 for weekly (0=Sunday)
    intervalMinutes?: number;
    nextRun?: Date;
  };
  enabled: boolean;
  lastRun?: string;
}

export class ScheduledPlugin extends Plugin {
  meta: PluginMeta = {
    name: 'scheduled',
    version: '1.0.0',
    description: 'Scheduled commands and messages',
    author: 'StreamCore',
  };

  private db!: DatabaseService;
  private tasks: Map<string, ScheduledTask> = new Map();
  private checkInterval?: NodeJS.Timeout;
  private defaultChannel: string = '';

  protected async init(): Promise<void> {
    this.db = getDatabase();
    this.log.info('Initializing Scheduled Commands...');

    this.defaultChannel = process.env.TWITCH_CHANNEL || '';
    this.initTables();
    this.loadTasks();
    this.registerCommands();
    this.startScheduler();

    this.log.info('Scheduled Commands initialized!');
  }

  protected async destroy(): Promise<void> {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
    }
  }

  private initTables(): void {
    const db = this.db.raw();
    db.exec(`
      CREATE TABLE IF NOT EXISTS scheduled_tasks (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        content TEXT NOT NULL,
        channel TEXT NOT NULL,
        schedule_type TEXT NOT NULL,
        schedule_time TEXT,
        schedule_days TEXT,
        schedule_interval INTEGER,
        enabled BOOLEAN DEFAULT TRUE,
        last_run DATETIME,
        next_run DATETIME
      );
    `);
  }

  private loadTasks(): void {
    const db = this.db.raw();
    const stmt = db.prepare('SELECT * FROM scheduled_tasks WHERE enabled = TRUE');
    const rows = stmt.all() as any[];

    for (const row of rows) {
      const task: ScheduledTask = {
        id: row.id,
        name: row.name,
        type: row.type,
        content: row.content,
        channel: row.channel,
        schedule: {
          type: row.schedule_type,
          time: row.schedule_time,
          days: row.schedule_days ? JSON.parse(row.schedule_days) : undefined,
          intervalMinutes: row.schedule_interval,
          nextRun: row.next_run ? new Date(row.next_run) : undefined,
        },
        enabled: !!row.enabled,
        lastRun: row.last_run,
      };

      this.calculateNextRun(task);
      this.tasks.set(task.id, task);
    }

    this.log.info(`Loaded ${this.tasks.size} scheduled tasks`);
  }

  private saveTask(task: ScheduledTask): void {
    const db = this.db.raw();
    const stmt = db.prepare(`
      INSERT OR REPLACE INTO scheduled_tasks
      (id, name, type, content, channel, schedule_type, schedule_time, schedule_days, schedule_interval, enabled, last_run, next_run)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      task.id,
      task.name,
      task.type,
      task.content,
      task.channel,
      task.schedule.type,
      task.schedule.time,
      task.schedule.days ? JSON.stringify(task.schedule.days) : null,
      task.schedule.intervalMinutes,
      task.enabled ? 1 : 0,
      task.lastRun,
      task.schedule.nextRun?.toISOString()
    );
  }

  private deleteTask(id: string): void {
    const db = this.db.raw();
    db.prepare('DELETE FROM scheduled_tasks WHERE id = ?').run(id);
    this.tasks.delete(id);
  }

  private startScheduler(): void {
    // Check every minute
    this.checkInterval = setInterval(() => {
      this.checkTasks();
    }, 60000);

    // Initial check
    setTimeout(() => this.checkTasks(), 5000);
  }

  private checkTasks(): void {
    const now = new Date();

    for (const task of this.tasks.values()) {
      if (!task.enabled || !task.schedule.nextRun) continue;

      if (now >= task.schedule.nextRun) {
        this.executeTask(task);
        task.lastRun = now.toISOString();
        this.calculateNextRun(task);
        this.saveTask(task);
      }
    }
  }

  private executeTask(task: ScheduledTask): void {
    this.log.info(`Executing scheduled task: ${task.name}`);

    if (task.type === 'message') {
      this.sendMessage(task.channel, task.content);
    } else if (task.type === 'command') {
      // Emit as if it was a command
      this.ctx.events.emit('scheduled:command', {
        command: task.content,
        channel: task.channel,
      });
    }
  }

  private calculateNextRun(task: ScheduledTask): void {
    const now = new Date();

    switch (task.schedule.type) {
      case 'once':
        // Already passed, disable
        if (task.lastRun) {
          task.enabled = false;
        }
        break;

      case 'interval':
        if (task.schedule.intervalMinutes) {
          task.schedule.nextRun = new Date(now.getTime() + task.schedule.intervalMinutes * 60000);
        }
        break;

      case 'daily':
        if (task.schedule.time) {
          const [hours, minutes] = task.schedule.time.split(':').map(Number);
          const next = new Date(now);
          next.setHours(hours, minutes, 0, 0);

          if (next <= now) {
            next.setDate(next.getDate() + 1);
          }
          task.schedule.nextRun = next;
        }
        break;

      case 'weekly':
        if (task.schedule.time && task.schedule.days && task.schedule.days.length > 0) {
          const [hours, minutes] = task.schedule.time.split(':').map(Number);
          const currentDay = now.getDay();

          // Find next scheduled day
          let daysUntil = Infinity;
          for (const day of task.schedule.days) {
            let diff = day - currentDay;
            if (diff < 0) diff += 7;
            if (diff === 0) {
              // Today, check if time passed
              const todayTime = new Date(now);
              todayTime.setHours(hours, minutes, 0, 0);
              if (todayTime > now) {
                diff = 0;
              } else {
                diff = 7;
              }
            }
            if (diff < daysUntil) daysUntil = diff;
          }

          const next = new Date(now);
          next.setDate(next.getDate() + daysUntil);
          next.setHours(hours, minutes, 0, 0);
          task.schedule.nextRun = next;
        }
        break;
    }
  }

  private registerCommands(): void {
    // !schedule - List schedules
    this.registerCommand({
      name: 'schedule',
      aliases: ['schedules', 'zeitplan'],
      description: 'List scheduled tasks',
      permission: Permission.MODERATOR,
      cooldown: { user: 10, global: 5 },
      handler: async (ctx) => {
        if (this.tasks.size === 0) {
          ctx.reply('⏰ Keine geplanten Aufgaben');
          return;
        }

        const list = Array.from(this.tasks.values())
          .filter((t) => t.enabled)
          .slice(0, 5)
          .map((t) => {
            const next = t.schedule.nextRun
              ? t.schedule.nextRun.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })
              : '?';
            return `${t.name} (${next})`;
          })
          .join(' | ');

        ctx.reply(`⏰ Geplante Aufgaben: ${list}`);
      },
    });

    // !addschedule - Add scheduled message
    this.registerCommand({
      name: 'addschedule',
      aliases: ['newschedule'],
      description: 'Add a scheduled message',
      usage: '!addschedule <interval|daily> <minutes|HH:MM> <name> <message>',
      permission: Permission.MODERATOR,
      cooldown: { user: 5, global: 0 },
      handler: async (ctx) => {
        if (ctx.args.length < 4) {
          ctx.reply('Verwendung: !addschedule <interval|daily> <min|HH:MM> <name> <nachricht>');
          return;
        }

        const type = ctx.args[0].toLowerCase() as 'interval' | 'daily';
        const timeArg = ctx.args[1];
        const name = ctx.args[2];
        const content = ctx.args.slice(3).join(' ');

        if (!['interval', 'daily'].includes(type)) {
          ctx.reply('❌ Typ muss "interval" oder "daily" sein');
          return;
        }

        const taskId = `sched_${Date.now()}`;
        const task: ScheduledTask = {
          id: taskId,
          name,
          type: 'message',
          content,
          channel: ctx.channel,
          schedule: { type },
          enabled: true,
        };

        if (type === 'interval') {
          const minutes = parseInt(timeArg);
          if (isNaN(minutes) || minutes < 1) {
            ctx.reply('❌ Ungültiges Intervall (Minuten)');
            return;
          }
          task.schedule.intervalMinutes = minutes;
        } else {
          if (!/^\d{1,2}:\d{2}$/.test(timeArg)) {
            ctx.reply('❌ Ungültige Zeit (HH:MM)');
            return;
          }
          task.schedule.time = timeArg;
        }

        this.calculateNextRun(task);
        this.tasks.set(taskId, task);
        this.saveTask(task);

        ctx.reply(`✅ Geplante Nachricht "${name}" erstellt`);
      },
    });

    // !delschedule - Delete schedule
    this.registerCommand({
      name: 'delschedule',
      aliases: ['removeschedule'],
      description: 'Delete a scheduled task',
      usage: '!delschedule <name>',
      permission: Permission.MODERATOR,
      cooldown: { user: 5, global: 0 },
      handler: async (ctx) => {
        if (ctx.args.length === 0) {
          ctx.reply('Verwendung: !delschedule <name>');
          return;
        }

        const name = ctx.args[0].toLowerCase();
        let found = false;

        for (const [id, task] of this.tasks.entries()) {
          if (task.name.toLowerCase() === name) {
            this.deleteTask(id);
            found = true;
            ctx.reply(`✅ Geplante Aufgabe "${task.name}" gelöscht`);
            break;
          }
        }

        if (!found) {
          ctx.reply('❌ Aufgabe nicht gefunden');
        }
      },
    });

    // !toggleschedule - Toggle schedule
    this.registerCommand({
      name: 'toggleschedule',
      description: 'Enable/disable a schedule',
      usage: '!toggleschedule <name>',
      permission: Permission.MODERATOR,
      cooldown: { user: 5, global: 0 },
      handler: async (ctx) => {
        if (ctx.args.length === 0) {
          ctx.reply('Verwendung: !toggleschedule <name>');
          return;
        }

        const name = ctx.args[0].toLowerCase();

        for (const task of this.tasks.values()) {
          if (task.name.toLowerCase() === name) {
            task.enabled = !task.enabled;
            this.saveTask(task);
            ctx.reply(`✅ ${task.name}: ${task.enabled ? 'aktiviert' : 'deaktiviert'}`);
            return;
          }
        }

        ctx.reply('❌ Aufgabe nicht gefunden');
      },
    });
  }

  // Public API
  getTasks(): ScheduledTask[] {
    return Array.from(this.tasks.values());
  }

  addTask(task: Omit<ScheduledTask, 'id'>): string {
    const id = `sched_${Date.now()}`;
    const fullTask = { ...task, id } as ScheduledTask;
    this.calculateNextRun(fullTask);
    this.tasks.set(id, fullTask);
    this.saveTask(fullTask);
    return id;
  }
}
