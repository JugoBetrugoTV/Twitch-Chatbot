/**
 * Analytics Plugin
 *
 * Features:
 * - Chat activity tracking
 * - Command usage statistics
 * - Viewer patterns
 * - Peak hours analysis
 * - Growth metrics
 */

import { Plugin } from '../base/Plugin';
import { PluginMeta, Permission } from '../../types/plugins';
import { ChatMessageEvent } from '../../types/events';
import { getDatabase, DatabaseService } from '../../services/Database';

interface HourlyStats {
  hour: number;
  messages: number;
  uniqueUsers: number;
  commands: number;
}

interface DailyStats {
  date: string;
  totalMessages: number;
  uniqueUsers: number;
  commandUsage: number;
  peakViewers: number;
  newFollowers: number;
  newSubs: number;
}

interface CommandStats {
  command: string;
  useCount: number;
  lastUsed: Date;
  uniqueUsers: number;
}

interface UserActivity {
  username: string;
  messageCount: number;
  commandCount: number;
  firstSeen: Date;
  lastSeen: Date;
}

interface AnalyticsSettings {
  enabled: boolean;
  trackMessages: boolean;
  trackCommands: boolean;
  trackUsers: boolean;
  retentionDays: number;
}

const DEFAULT_SETTINGS: AnalyticsSettings = {
  enabled: true,
  trackMessages: true,
  trackCommands: true,
  trackUsers: true,
  retentionDays: 90,
};

export class AnalyticsPlugin extends Plugin {
  meta: PluginMeta = {
    name: 'analytics',
    version: '1.0.0',
    description: 'Stream and chat analytics',
    author: 'StreamCore',
  };

  private db!: DatabaseService;
  private settings: AnalyticsSettings = DEFAULT_SETTINGS;

  // In-memory tracking for current session
  private sessionStart = new Date();
  private hourlyMessages: Map<number, number> = new Map();
  private hourlyUsers: Map<number, Set<string>> = new Map();
  private commandUsage: Map<string, number> = new Map();
  private activeUsers: Set<string> = new Set();

  protected async init(): Promise<void> {
    this.db = getDatabase();
    this.log.info('Initializing Analytics...');

    this.initTables();
    this.loadSettings();
    this.setupEventHandlers();
    this.registerCommands();
    this.startCleanupSchedule();

    this.log.info('Analytics initialized!');
  }

  protected async destroy(): Promise<void> {
    // Save current session data
    this.saveSessionData();
  }

  private initTables(): void {
    const db = this.db.raw();
    db.exec(`
      CREATE TABLE IF NOT EXISTS analytics_daily (
        date TEXT PRIMARY KEY,
        total_messages INTEGER DEFAULT 0,
        unique_users INTEGER DEFAULT 0,
        command_usage INTEGER DEFAULT 0,
        peak_viewers INTEGER DEFAULT 0,
        new_followers INTEGER DEFAULT 0,
        new_subs INTEGER DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS analytics_hourly (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        date TEXT NOT NULL,
        hour INTEGER NOT NULL,
        messages INTEGER DEFAULT 0,
        unique_users INTEGER DEFAULT 0,
        commands INTEGER DEFAULT 0,
        UNIQUE(date, hour)
      );

      CREATE TABLE IF NOT EXISTS analytics_commands (
        command TEXT PRIMARY KEY,
        use_count INTEGER DEFAULT 0,
        last_used DATETIME,
        unique_users INTEGER DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS analytics_user_activity (
        username TEXT PRIMARY KEY,
        message_count INTEGER DEFAULT 0,
        command_count INTEGER DEFAULT 0,
        first_seen DATETIME DEFAULT CURRENT_TIMESTAMP,
        last_seen DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_analytics_hourly_date ON analytics_hourly(date);
    `);
  }

  private loadSettings(): void {
    const saved = this.db.getSetting<AnalyticsSettings>('analytics_settings');
    if (saved) {
      this.settings = { ...DEFAULT_SETTINGS, ...saved };
    }
  }

  private saveSettings(): void {
    this.db.setSetting('analytics_settings', this.settings);
  }

  private setupEventHandlers(): void {
    // Track chat messages
    this.ctx.events.on('chat:message', (event: ChatMessageEvent) => {
      if (!this.settings.enabled || !this.settings.trackMessages) return;

      const hour = new Date().getHours();
      const username = event.user.username.toLowerCase();

      // Update hourly stats
      this.hourlyMessages.set(hour, (this.hourlyMessages.get(hour) || 0) + 1);

      if (!this.hourlyUsers.has(hour)) {
        this.hourlyUsers.set(hour, new Set());
      }
      this.hourlyUsers.get(hour)!.add(username);

      // Track active users
      this.activeUsers.add(username);

      // Update user activity
      if (this.settings.trackUsers) {
        this.updateUserActivity(username, 'message');
      }
    });

    // Track command usage
    this.ctx.events.on('command:executed', (event: any) => {
      if (!this.settings.enabled || !this.settings.trackCommands) return;

      const command = event.command.toLowerCase();
      this.commandUsage.set(command, (this.commandUsage.get(command) || 0) + 1);

      // Update command stats in DB
      this.updateCommandStats(command);

      // Update user activity
      if (this.settings.trackUsers && event.user) {
        this.updateUserActivity(event.user.username.toLowerCase(), 'command');
      }
    });

    // Save data periodically
    setInterval(() => this.saveSessionData(), 5 * 60 * 1000); // Every 5 minutes
  }

  private updateUserActivity(username: string, type: 'message' | 'command'): void {
    const db = this.db.raw();
    const now = new Date().toISOString();

    if (type === 'message') {
      db.prepare(`
        INSERT INTO analytics_user_activity (username, message_count, last_seen)
        VALUES (?, 1, ?)
        ON CONFLICT(username) DO UPDATE SET
          message_count = message_count + 1,
          last_seen = ?
      `).run(username, now, now);
    } else {
      db.prepare(`
        INSERT INTO analytics_user_activity (username, command_count, last_seen)
        VALUES (?, 1, ?)
        ON CONFLICT(username) DO UPDATE SET
          command_count = command_count + 1,
          last_seen = ?
      `).run(username, now, now);
    }
  }

  private updateCommandStats(command: string): void {
    const db = this.db.raw();
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO analytics_commands (command, use_count, last_used, unique_users)
      VALUES (?, 1, ?, 1)
      ON CONFLICT(command) DO UPDATE SET
        use_count = use_count + 1,
        last_used = ?
    `).run(command, now, now);
  }

  private saveSessionData(): void {
    if (!this.settings.enabled) return;

    const db = this.db.raw();
    const today = new Date().toISOString().split('T')[0];

    // Save hourly data
    for (const [hour, messages] of this.hourlyMessages) {
      const users = this.hourlyUsers.get(hour)?.size || 0;
      const commands = 0; // Will be tracked separately

      db.prepare(`
        INSERT INTO analytics_hourly (date, hour, messages, unique_users, commands)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(date, hour) DO UPDATE SET
          messages = messages + ?,
          unique_users = MAX(unique_users, ?)
      `).run(today, hour, messages, users, commands, messages, users);
    }

    // Save daily summary
    const totalMessages = Array.from(this.hourlyMessages.values()).reduce((a, b) => a + b, 0);
    const totalCommands = Array.from(this.commandUsage.values()).reduce((a, b) => a + b, 0);

    db.prepare(`
      INSERT INTO analytics_daily (date, total_messages, unique_users, command_usage)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(date) DO UPDATE SET
        total_messages = total_messages + ?,
        unique_users = MAX(unique_users, ?),
        command_usage = command_usage + ?
    `).run(today, totalMessages, this.activeUsers.size, totalCommands,
           totalMessages, this.activeUsers.size, totalCommands);

    // Clear session data
    this.hourlyMessages.clear();
    this.hourlyUsers.clear();
    this.commandUsage.clear();

    this.log.info(`Analytics saved for ${today}`);
  }

  private startCleanupSchedule(): void {
    // Run cleanup daily
    setInterval(() => {
      this.cleanupOldData();
    }, 24 * 60 * 60 * 1000);
  }

  private cleanupOldData(): void {
    const db = this.db.raw();
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - this.settings.retentionDays);
    const cutoff = cutoffDate.toISOString().split('T')[0];

    db.prepare('DELETE FROM analytics_daily WHERE date < ?').run(cutoff);
    db.prepare('DELETE FROM analytics_hourly WHERE date < ?').run(cutoff);

    this.log.info(`Cleaned up analytics data older than ${cutoff}`);
  }

  private registerCommands(): void {
    // !analytics - Show analytics overview
    this.registerCommand({
      name: 'analytics',
      aliases: ['stats', 'chatstats'],
      description: 'Show chat analytics',
      usage: '!analytics [today|week|month]',
      permission: Permission.MODERATOR,
      cooldown: { user: 30, global: 10 },
      handler: async (ctx) => {
        const period = ctx.args[0]?.toLowerCase() || 'today';
        const stats = this.getStats(period);

        if (!stats) {
          ctx.reply('📊 Keine Daten verfügbar');
          return;
        }

        ctx.reply(
          `📊 Statistik (${period}): ` +
          `${stats.messages} Nachrichten | ` +
          `${stats.uniqueUsers} User | ` +
          `${stats.commands} Commands`
        );
      },
    });

    // !topcommands - Show most used commands
    this.registerCommand({
      name: 'topcommands',
      aliases: ['popularcommands'],
      description: 'Show most used commands',
      permission: Permission.MODERATOR,
      cooldown: { user: 30, global: 10 },
      handler: async (ctx) => {
        const db = this.db.raw();
        const commands = db.prepare(`
          SELECT command, use_count
          FROM analytics_commands
          ORDER BY use_count DESC
          LIMIT 5
        `).all() as any[];

        if (commands.length === 0) {
          ctx.reply('📊 Keine Command-Daten');
          return;
        }

        const list = commands
          .map((c, i) => `${i + 1}. !${c.command} (${c.use_count})`)
          .join(' | ');

        ctx.reply(`📊 Top Commands: ${list}`);
      },
    });

    // !peakhours - Show peak activity hours
    this.registerCommand({
      name: 'peakhours',
      aliases: ['besthours'],
      description: 'Show peak activity hours',
      permission: Permission.MODERATOR,
      cooldown: { user: 30, global: 10 },
      handler: async (ctx) => {
        const db = this.db.raw();
        const hours = db.prepare(`
          SELECT hour, SUM(messages) as total_messages
          FROM analytics_hourly
          WHERE date >= date('now', '-7 days')
          GROUP BY hour
          ORDER BY total_messages DESC
          LIMIT 3
        `).all() as any[];

        if (hours.length === 0) {
          ctx.reply('📊 Nicht genug Daten');
          return;
        }

        const list = hours
          .map((h) => `${h.hour}:00 (${h.total_messages} msgs)`)
          .join(' | ');

        ctx.reply(`⏰ Peak-Stunden: ${list}`);
      },
    });

    // !chatters - Show active chatter count
    this.registerCommand({
      name: 'chatters',
      aliases: ['viewers'],
      description: 'Show active chatters',
      permission: Permission.MODERATOR,
      cooldown: { user: 10, global: 5 },
      handler: async (ctx) => {
        ctx.reply(`👥 Aktive Chatter diese Session: ${this.activeUsers.size}`);
      },
    });

    // !userstats - Show user statistics
    this.registerCommand({
      name: 'userstats',
      description: 'Show user statistics',
      usage: '!userstats [user]',
      permission: Permission.MODERATOR,
      cooldown: { user: 15, global: 5 },
      handler: async (ctx) => {
        const username = (ctx.args[0] || ctx.user.username).toLowerCase().replace('@', '');

        const db = this.db.raw();
        const user = db.prepare(`
          SELECT * FROM analytics_user_activity WHERE username = ?
        `).get(username) as any;

        if (!user) {
          ctx.reply(`📊 Keine Daten für ${username}`);
          return;
        }

        const firstSeen = new Date(user.first_seen).toLocaleDateString('de-DE');

        ctx.reply(
          `📊 ${username}: ${user.message_count} Nachrichten | ` +
          `${user.command_count} Commands | ` +
          `Dabei seit: ${firstSeen}`
        );
      },
    });

    // !topchatters - Show most active chatters
    this.registerCommand({
      name: 'topchatters',
      aliases: ['mostactive'],
      description: 'Show most active chatters',
      permission: Permission.MODERATOR,
      cooldown: { user: 30, global: 10 },
      handler: async (ctx) => {
        const db = this.db.raw();
        const users = db.prepare(`
          SELECT username, message_count
          FROM analytics_user_activity
          ORDER BY message_count DESC
          LIMIT 5
        `).all() as any[];

        if (users.length === 0) {
          ctx.reply('📊 Keine Daten');
          return;
        }

        const list = users
          .map((u, i) => `${i + 1}. ${u.username} (${u.message_count})`)
          .join(' | ');

        ctx.reply(`👥 Top Chatter: ${list}`);
      },
    });

    // !growth - Show growth metrics
    this.registerCommand({
      name: 'growth',
      description: 'Show growth metrics',
      permission: Permission.BROADCASTER,
      cooldown: { user: 60, global: 30 },
      handler: async (ctx) => {
        const db = this.db.raw();

        const thisWeek = db.prepare(`
          SELECT SUM(total_messages) as messages, SUM(new_followers) as followers
          FROM analytics_daily
          WHERE date >= date('now', '-7 days')
        `).get() as any;

        const lastWeek = db.prepare(`
          SELECT SUM(total_messages) as messages, SUM(new_followers) as followers
          FROM analytics_daily
          WHERE date >= date('now', '-14 days') AND date < date('now', '-7 days')
        `).get() as any;

        const messageChange = thisWeek?.messages && lastWeek?.messages
          ? Math.round(((thisWeek.messages - lastWeek.messages) / lastWeek.messages) * 100)
          : 0;

        ctx.reply(
          `📈 Wachstum: ` +
          `Nachrichten ${messageChange >= 0 ? '+' : ''}${messageChange}% | ` +
          `Diese Woche: ${thisWeek?.messages || 0} msgs`
        );
      },
    });

    // !analyticsexport - Export analytics data
    this.registerCommand({
      name: 'analyticsexport',
      description: 'Export analytics summary',
      permission: Permission.BROADCASTER,
      cooldown: { user: 300, global: 300 },
      handler: async (ctx) => {
        // Save current session first
        this.saveSessionData();

        const db = this.db.raw();
        const days = db.prepare(`
          SELECT COUNT(*) as count FROM analytics_daily
        `).get() as any;

        ctx.reply(`📊 Analytics: ${days?.count || 0} Tage Daten gespeichert`);
      },
    });

    // !resetanalytics - Reset analytics (broadcaster only)
    this.registerCommand({
      name: 'resetanalytics',
      description: 'Reset all analytics data',
      permission: Permission.BROADCASTER,
      cooldown: { user: 300, global: 300 },
      handler: async (ctx) => {
        if (ctx.args[0] !== 'confirm') {
          ctx.reply('⚠️ Warnung: Dies löscht ALLE Analytics-Daten! Nutze !resetanalytics confirm');
          return;
        }

        const db = this.db.raw();
        db.exec('DELETE FROM analytics_daily');
        db.exec('DELETE FROM analytics_hourly');
        db.exec('DELETE FROM analytics_commands');
        db.exec('DELETE FROM analytics_user_activity');

        this.activeUsers.clear();
        this.hourlyMessages.clear();
        this.hourlyUsers.clear();
        this.commandUsage.clear();

        ctx.reply('✅ Analytics zurückgesetzt');
      },
    });
  }

  private getStats(period: string): { messages: number; uniqueUsers: number; commands: number } | null {
    const db = this.db.raw();
    let dateFilter: string;

    switch (period) {
      case 'today':
        dateFilter = "date('now')";
        break;
      case 'week':
        dateFilter = "date('now', '-7 days')";
        break;
      case 'month':
        dateFilter = "date('now', '-30 days')";
        break;
      default:
        dateFilter = "date('now')";
    }

    const result = db.prepare(`
      SELECT
        SUM(total_messages) as messages,
        MAX(unique_users) as uniqueUsers,
        SUM(command_usage) as commands
      FROM analytics_daily
      WHERE date >= ${dateFilter}
    `).get() as any;

    if (!result || !result.messages) {
      // Return session data if no DB data
      return {
        messages: Array.from(this.hourlyMessages.values()).reduce((a, b) => a + b, 0),
        uniqueUsers: this.activeUsers.size,
        commands: Array.from(this.commandUsage.values()).reduce((a, b) => a + b, 0),
      };
    }

    return {
      messages: result.messages || 0,
      uniqueUsers: result.uniqueUsers || 0,
      commands: result.commands || 0,
    };
  }

  // Public API
  getActiveUsers(): number {
    return this.activeUsers.size;
  }

  getSessionDuration(): number {
    return Math.floor((Date.now() - this.sessionStart.getTime()) / 1000);
  }

  getTodayStats(): DailyStats | null {
    const stats = this.getStats('today');
    if (!stats) return null;

    return {
      date: new Date().toISOString().split('T')[0],
      totalMessages: stats.messages,
      uniqueUsers: stats.uniqueUsers,
      commandUsage: stats.commands,
      peakViewers: 0,
      newFollowers: 0,
      newSubs: 0,
    };
  }

  getCommandStats(): CommandStats[] {
    const db = this.db.raw();
    return db.prepare(`
      SELECT command, use_count, last_used, unique_users
      FROM analytics_commands
      ORDER BY use_count DESC
    `).all() as CommandStats[];
  }
}
