/**
 * Stream Schedule Plugin
 *
 * Display and manage stream schedule
 * Features:
 * - Show next stream
 * - Weekly schedule
 * - Schedule reminders
 * - Twitch schedule sync
 */

import { Plugin } from '../base/Plugin';
import { PluginMeta, Permission } from '../../types/plugins';
import { getDatabase, DatabaseService } from '../../services/Database';

interface ScheduleEntry {
  id: string;
  dayOfWeek: number; // 0 = Sunday, 6 = Saturday
  startTime: string; // HH:MM format
  endTime: string;
  title: string;
  category: string;
  recurring: boolean;
  enabled: boolean;
}

interface ScheduleSettings {
  enabled: boolean;
  timezone: string;
  showInChat: boolean;
  reminderEnabled: boolean;
  reminderMinutes: number;
}

const DEFAULT_SETTINGS: ScheduleSettings = {
  enabled: true,
  timezone: 'Europe/Berlin',
  showInChat: true,
  reminderEnabled: true,
  reminderMinutes: 15,
};

const DAY_NAMES = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
const DAY_NAMES_SHORT = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];

export class StreamSchedulePlugin extends Plugin {
  meta: PluginMeta = {
    name: 'schedule',
    version: '1.0.0',
    description: 'Display and manage stream schedule',
    author: 'StreamCore',
  };

  private db!: DatabaseService;
  private settings: ScheduleSettings = DEFAULT_SETTINGS;
  private schedule: ScheduleEntry[] = [];
  private reminderInterval: ReturnType<typeof setInterval> | null = null;

  protected async init(): Promise<void> {
    this.db = getDatabase();
    this.log.info('Initializing Stream Schedule...');

    this.initTables();
    this.loadSettings();
    this.loadSchedule();
    this.startReminderCheck();
    this.registerCommands();

    this.log.info('Stream Schedule initialized!');
  }

  protected async destroy(): Promise<void> {
    if (this.reminderInterval) {
      clearInterval(this.reminderInterval);
      this.reminderInterval = null;
    }
  }

  private initTables(): void {
    const db = this.db.raw();
    db.exec(`
      CREATE TABLE IF NOT EXISTS stream_schedule (
        id TEXT PRIMARY KEY,
        day_of_week INTEGER NOT NULL,
        start_time TEXT NOT NULL,
        end_time TEXT,
        title TEXT,
        category TEXT,
        recurring INTEGER DEFAULT 1,
        enabled INTEGER DEFAULT 1
      );
    `);
  }

  private loadSettings(): void {
    const saved = this.db.getSetting<ScheduleSettings>('schedule_settings');
    if (saved) {
      this.settings = { ...DEFAULT_SETTINGS, ...saved };
    }
  }

  private saveSettings(): void {
    this.db.setSetting('schedule_settings', this.settings);
  }

  private loadSchedule(): void {
    const db = this.db.raw();
    const rows = db.prepare('SELECT * FROM stream_schedule WHERE enabled = 1').all() as any[];

    this.schedule = rows.map((row) => ({
      id: row.id,
      dayOfWeek: row.day_of_week,
      startTime: row.start_time,
      endTime: row.end_time || '',
      title: row.title || '',
      category: row.category || '',
      recurring: row.recurring === 1,
      enabled: row.enabled === 1,
    }));
  }

  private saveScheduleEntry(entry: ScheduleEntry): void {
    const db = this.db.raw();
    db.prepare(`
      INSERT OR REPLACE INTO stream_schedule
      (id, day_of_week, start_time, end_time, title, category, recurring, enabled)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      entry.id,
      entry.dayOfWeek,
      entry.startTime,
      entry.endTime,
      entry.title,
      entry.category,
      entry.recurring ? 1 : 0,
      entry.enabled ? 1 : 0
    );
  }

  private deleteScheduleEntry(id: string): void {
    const db = this.db.raw();
    db.prepare('DELETE FROM stream_schedule WHERE id = ?').run(id);
    this.schedule = this.schedule.filter((e) => e.id !== id);
  }

  private startReminderCheck(): void {
    if (!this.settings.reminderEnabled) return;

    this.reminderInterval = setInterval(() => {
      this.checkReminders();
    }, 60000); // Check every minute
  }

  private checkReminders(): void {
    if (!this.settings.reminderEnabled) return;

    const now = new Date();
    const currentDay = now.getDay();
    const currentMinutes = now.getHours() * 60 + now.getMinutes();

    for (const entry of this.schedule) {
      if (entry.dayOfWeek !== currentDay) continue;

      const [hours, minutes] = entry.startTime.split(':').map(Number);
      const entryMinutes = hours * 60 + minutes;
      const diff = entryMinutes - currentMinutes;

      if (diff === this.settings.reminderMinutes) {
        this.ctx.events.emit('chat:send',
          `📅 Stream startet in ${this.settings.reminderMinutes} Minuten! ${entry.title ? `(${entry.title})` : ''}`
        );
      }
    }
  }

  private getNextStream(): { entry: ScheduleEntry; date: Date } | null {
    if (this.schedule.length === 0) return null;

    const now = new Date();
    const currentDay = now.getDay();
    const currentMinutes = now.getHours() * 60 + now.getMinutes();

    // Sort by day and time
    const sorted = [...this.schedule].sort((a, b) => {
      const aDays = (a.dayOfWeek - currentDay + 7) % 7;
      const bDays = (b.dayOfWeek - currentDay + 7) % 7;

      if (aDays !== bDays) return aDays - bDays;

      const [aH, aM] = a.startTime.split(':').map(Number);
      const [bH, bM] = b.startTime.split(':').map(Number);
      return (aH * 60 + aM) - (bH * 60 + bM);
    });

    for (const entry of sorted) {
      const [hours, minutes] = entry.startTime.split(':').map(Number);
      const entryMinutes = hours * 60 + minutes;

      // Skip if today and already passed
      if (entry.dayOfWeek === currentDay && entryMinutes <= currentMinutes) {
        continue;
      }

      // Calculate next date
      let daysUntil = (entry.dayOfWeek - currentDay + 7) % 7;
      if (daysUntil === 0 && entryMinutes <= currentMinutes) {
        daysUntil = 7;
      }

      const nextDate = new Date(now);
      nextDate.setDate(nextDate.getDate() + daysUntil);
      nextDate.setHours(hours, minutes, 0, 0);

      return { entry, date: nextDate };
    }

    // If all streams passed this week, return first of next week
    if (sorted.length > 0) {
      const entry = sorted[0];
      const [hours, minutes] = entry.startTime.split(':').map(Number);
      const daysUntil = (entry.dayOfWeek - currentDay + 7) % 7 || 7;

      const nextDate = new Date(now);
      nextDate.setDate(nextDate.getDate() + daysUntil);
      nextDate.setHours(hours, minutes, 0, 0);

      return { entry, date: nextDate };
    }

    return null;
  }

  private formatTimeUntil(date: Date): string {
    const now = new Date();
    const diff = date.getTime() - now.getTime();

    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

    const parts: string[] = [];
    if (days > 0) parts.push(`${days}d`);
    if (hours > 0) parts.push(`${hours}h`);
    if (minutes > 0 && days === 0) parts.push(`${minutes}m`);

    return parts.join(' ') || 'jetzt';
  }

  private registerCommands(): void {
    // !schedule - Show full schedule
    this.registerCommand({
      name: 'schedule',
      aliases: ['zeitplan', 'plan'],
      description: 'Show stream schedule',
      cooldown: { user: 15, global: 5 },
      handler: async (ctx) => {
        if (this.schedule.length === 0) {
          ctx.reply('📅 Kein Streamplan vorhanden');
          return;
        }

        const grouped = new Map<number, ScheduleEntry[]>();
        for (const entry of this.schedule) {
          if (!grouped.has(entry.dayOfWeek)) {
            grouped.set(entry.dayOfWeek, []);
          }
          grouped.get(entry.dayOfWeek)!.push(entry);
        }

        const lines: string[] = [];
        for (let day = 0; day < 7; day++) {
          const entries = grouped.get(day);
          if (entries && entries.length > 0) {
            const times = entries.map((e) => e.startTime).join(', ');
            lines.push(`${DAY_NAMES_SHORT[day]}: ${times}`);
          }
        }

        ctx.reply(`📅 Streamplan: ${lines.join(' | ')}`);
      },
    });

    // !nextstream - Show next stream
    this.registerCommand({
      name: 'nextstream',
      aliases: ['next', 'wann'],
      description: 'Show next scheduled stream',
      cooldown: { user: 10, global: 3 },
      handler: async (ctx) => {
        const next = this.getNextStream();

        if (!next) {
          ctx.reply('📅 Kein Stream geplant');
          return;
        }

        const timeUntil = this.formatTimeUntil(next.date);
        const dayName = DAY_NAMES[next.entry.dayOfWeek];
        const title = next.entry.title ? ` - ${next.entry.title}` : '';

        ctx.reply(
          `📅 Nächster Stream: ${dayName} um ${next.entry.startTime} Uhr (in ${timeUntil})${title}`
        );
      },
    });

    // !addschedule - Add schedule entry
    this.registerCommand({
      name: 'addschedule',
      description: 'Add stream to schedule',
      usage: '!addschedule <day> <time> [title]',
      permission: Permission.MODERATOR,
      cooldown: { user: 0, global: 0 },
      handler: async (ctx) => {
        const [dayInput, time, ...titleParts] = ctx.args;

        if (!dayInput || !time) {
          ctx.reply('❌ Usage: !addschedule <day> <time> [title] (z.B. !addschedule Mo 20:00 Gaming)');
          return;
        }

        // Parse day
        const dayLower = dayInput.toLowerCase();
        let dayOfWeek = -1;

        const dayMap: Record<string, number> = {
          'so': 0, 'sonntag': 0, 'sun': 0, 'sunday': 0,
          'mo': 1, 'montag': 1, 'mon': 1, 'monday': 1,
          'di': 2, 'dienstag': 2, 'tue': 2, 'tuesday': 2,
          'mi': 3, 'mittwoch': 3, 'wed': 3, 'wednesday': 3,
          'do': 4, 'donnerstag': 4, 'thu': 4, 'thursday': 4,
          'fr': 5, 'freitag': 5, 'fri': 5, 'friday': 5,
          'sa': 6, 'samstag': 6, 'sat': 6, 'saturday': 6,
        };

        dayOfWeek = dayMap[dayLower] ?? -1;

        if (dayOfWeek === -1) {
          ctx.reply('❌ Ungültiger Tag (Mo, Di, Mi, Do, Fr, Sa, So)');
          return;
        }

        // Validate time format
        if (!/^\d{1,2}:\d{2}$/.test(time)) {
          ctx.reply('❌ Ungültige Zeit (Format: HH:MM)');
          return;
        }

        const entry: ScheduleEntry = {
          id: `${dayOfWeek}-${time}-${Date.now()}`,
          dayOfWeek,
          startTime: time,
          endTime: '',
          title: titleParts.join(' ') || '',
          category: '',
          recurring: true,
          enabled: true,
        };

        this.saveScheduleEntry(entry);
        this.schedule.push(entry);

        ctx.reply(`✅ Stream hinzugefügt: ${DAY_NAMES[dayOfWeek]} um ${time} Uhr`);
      },
    });

    // !removeschedule - Remove schedule entry
    this.registerCommand({
      name: 'removeschedule',
      aliases: ['delschedule'],
      description: 'Remove stream from schedule',
      usage: '!removeschedule <day> <time>',
      permission: Permission.MODERATOR,
      cooldown: { user: 0, global: 0 },
      handler: async (ctx) => {
        const [dayInput, time] = ctx.args;

        if (!dayInput || !time) {
          ctx.reply('❌ Usage: !removeschedule <day> <time>');
          return;
        }

        const dayLower = dayInput.toLowerCase();
        const dayMap: Record<string, number> = {
          'so': 0, 'mo': 1, 'di': 2, 'mi': 3, 'do': 4, 'fr': 5, 'sa': 6,
        };
        const dayOfWeek = dayMap[dayLower] ?? -1;

        if (dayOfWeek === -1) {
          ctx.reply('❌ Ungültiger Tag');
          return;
        }

        const entry = this.schedule.find(
          (e) => e.dayOfWeek === dayOfWeek && e.startTime === time
        );

        if (!entry) {
          ctx.reply('❌ Kein Stream zu dieser Zeit gefunden');
          return;
        }

        this.deleteScheduleEntry(entry.id);
        ctx.reply(`✅ Stream entfernt: ${DAY_NAMES[dayOfWeek]} um ${time} Uhr`);
      },
    });

    // !clearschedule - Clear all schedule
    this.registerCommand({
      name: 'clearschedule',
      description: 'Clear all scheduled streams',
      permission: Permission.BROADCASTER,
      cooldown: { user: 0, global: 0 },
      handler: async (ctx) => {
        const db = this.db.raw();
        db.prepare('DELETE FROM stream_schedule').run();
        this.schedule = [];
        ctx.reply('✅ Streamplan gelöscht');
      },
    });
  }

  // Public API
  getSchedule(): ScheduleEntry[] {
    return [...this.schedule];
  }

  getNextStreamInfo(): { entry: ScheduleEntry; date: Date } | null {
    return this.getNextStream();
  }
}
