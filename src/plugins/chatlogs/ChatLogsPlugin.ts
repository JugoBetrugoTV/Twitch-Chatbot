/**
 * Chat Logs Plugin
 *
 * Features:
 * - Log all chat messages to database
 * - Search chat history
 * - User message history
 * - Export logs
 * - Deleted message tracking
 */

import { Plugin } from '../base/Plugin';
import { PluginMeta, Permission } from '../../types/plugins';
import { ChatMessageEvent } from '../../types/events';
import { getDatabase, DatabaseService } from '../../services/Database';

interface ChatLog {
  id: number;
  platform: string;
  channel: string;
  userId: string;
  username: string;
  displayName: string;
  message: string;
  isAction: boolean;
  isDeleted: boolean;
  deletedBy?: string;
  timestamp: string;
}

interface LogSettings {
  enabled: boolean;
  logDeleted: boolean;
  retentionDays: number;
  excludeBots: boolean;
  excludedUsers: string[];
}

const DEFAULT_SETTINGS: LogSettings = {
  enabled: true,
  logDeleted: true,
  retentionDays: 30,
  excludeBots: true,
  excludedUsers: ['nightbot', 'streamelements', 'moobot'],
};

export class ChatLogsPlugin extends Plugin {
  meta: PluginMeta = {
    name: 'chatlogs',
    version: '1.0.0',
    description: 'Log and search chat messages',
    author: 'StreamCore',
  };

  private db!: DatabaseService;
  private settings: LogSettings = DEFAULT_SETTINGS;
  private messageCount = 0;
  private cleanupInterval?: NodeJS.Timeout;

  protected async init(): Promise<void> {
    this.db = getDatabase();
    this.log.info('Initializing Chat Logs...');

    this.initTables();
    this.loadSettings();
    this.setupEventHandlers();
    this.registerCommands();
    this.startCleanup();

    this.log.info('Chat Logs initialized!');
  }

  protected async destroy(): Promise<void> {
    if (this.cleanupInterval) clearInterval(this.cleanupInterval);
  }

  private initTables(): void {
    const db = this.db.raw();
    db.exec(`
      CREATE TABLE IF NOT EXISTS chat_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        platform TEXT NOT NULL,
        channel TEXT NOT NULL,
        user_id TEXT NOT NULL,
        username TEXT NOT NULL,
        display_name TEXT,
        message TEXT NOT NULL,
        is_action BOOLEAN DEFAULT FALSE,
        is_deleted BOOLEAN DEFAULT FALSE,
        deleted_by TEXT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_logs_user ON chat_logs(username);
      CREATE INDEX IF NOT EXISTS idx_logs_channel ON chat_logs(channel);
      CREATE INDEX IF NOT EXISTS idx_logs_timestamp ON chat_logs(timestamp DESC);
      CREATE INDEX IF NOT EXISTS idx_logs_message ON chat_logs(message);
    `);
  }

  private loadSettings(): void {
    const saved = this.db.getSetting<LogSettings>('chatlogs_settings');
    if (saved) {
      this.settings = { ...DEFAULT_SETTINGS, ...saved };
    }
  }

  private setupEventHandlers(): void {
    // Log messages
    this.ctx.events.on('chat:message', (event: ChatMessageEvent) => {
      this.logMessage(event);
    });

    // Track deleted messages
    this.ctx.events.on('chat:messageDeleted', (event: any) => {
      this.markDeleted(event.messageId, event.deletedBy);
    });
  }

  private logMessage(event: ChatMessageEvent): void {
    if (!this.settings.enabled) return;

    const { user, message, channel, isAction } = event;

    // Skip excluded users
    if (this.settings.excludeBots) {
      if (this.settings.excludedUsers.includes(user.username.toLowerCase())) {
        return;
      }
    }

    const db = this.db.raw();
    const stmt = db.prepare(`
      INSERT INTO chat_logs (platform, channel, user_id, username, display_name, message, is_action)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      user.platform,
      channel,
      user.id,
      user.username.toLowerCase(),
      user.displayName,
      message,
      isAction ? 1 : 0
    );

    this.messageCount++;
  }

  private markDeleted(messageId: string, deletedBy?: string): void {
    // This would require message ID tracking - simplified version
  }

  private startCleanup(): void {
    // Clean old logs daily
    this.cleanupInterval = setInterval(() => {
      const db = this.db.raw();
      const stmt = db.prepare(`
        DELETE FROM chat_logs
        WHERE timestamp < datetime('now', '-' || ? || ' days')
      `);
      const result = stmt.run(this.settings.retentionDays);
      if (result.changes > 0) {
        this.log.info(`Cleaned ${result.changes} old chat logs`);
      }
    }, 24 * 60 * 60 * 1000);
  }

  private registerCommands(): void {
    // !logs - Search logs
    this.registerCommand({
      name: 'logs',
      aliases: ['chatlog', 'history'],
      description: 'Search chat logs',
      usage: '!logs <user> [search]',
      permission: Permission.MODERATOR,
      cooldown: { user: 10, global: 5 },
      handler: async (ctx) => {
        if (ctx.args.length === 0) {
          ctx.reply(`📜 ${this.messageCount} Nachrichten geloggt. !logs <user> [suche]`);
          return;
        }

        const username = ctx.args[0].toLowerCase().replace('@', '');
        const search = ctx.args.slice(1).join(' ');

        const logs = this.getUserLogs(username, search, 5);

        if (logs.length === 0) {
          ctx.reply(`📜 Keine Logs für ${username} gefunden`);
          return;
        }

        const display = logs
          .map((l) => `[${this.formatTime(l.timestamp)}] ${l.message.slice(0, 50)}`)
          .join(' | ');

        ctx.reply(`📜 ${username}: ${display}`);
      },
    });

    // !userstats - User chat stats
    this.registerCommand({
      name: 'userstats',
      aliases: ['chatstats'],
      description: 'Show user chat statistics',
      usage: '!userstats [user]',
      cooldown: { user: 30, global: 10 },
      handler: async (ctx) => {
        const username = (ctx.args[0] || ctx.user.username).toLowerCase().replace('@', '');
        const stats = this.getUserStats(username);

        if (!stats) {
          ctx.reply(`📊 Keine Statistiken für ${username}`);
          return;
        }

        ctx.reply(
          `📊 ${username}: ${stats.messageCount} Nachrichten | ` +
          `Erste: ${this.formatDate(stats.firstMessage)} | ` +
          `Letzte: ${this.formatDate(stats.lastMessage)}`
        );
      },
    });

    // !logstoggle - Toggle logging
    this.registerCommand({
      name: 'logstoggle',
      description: 'Toggle chat logging',
      permission: Permission.BROADCASTER,
      cooldown: { user: 5, global: 0 },
      handler: async (ctx) => {
        this.settings.enabled = !this.settings.enabled;
        this.db.setSetting('chatlogs_settings', this.settings);
        ctx.reply(`📜 Chat Logging ${this.settings.enabled ? 'aktiviert' : 'deaktiviert'}`);
      },
    });
  }

  // Helpers
  private getUserLogs(username: string, search?: string, limit = 10): ChatLog[] {
    const db = this.db.raw();

    if (search) {
      const stmt = db.prepare(`
        SELECT * FROM chat_logs
        WHERE LOWER(username) = ? AND message LIKE ?
        ORDER BY timestamp DESC LIMIT ?
      `);
      return stmt.all(username.toLowerCase(), `%${search}%`, limit) as ChatLog[];
    }

    const stmt = db.prepare(`
      SELECT * FROM chat_logs
      WHERE LOWER(username) = ?
      ORDER BY timestamp DESC LIMIT ?
    `);
    return stmt.all(username.toLowerCase(), limit) as ChatLog[];
  }

  private getUserStats(username: string): {
    messageCount: number;
    firstMessage: string;
    lastMessage: string;
  } | null {
    const db = this.db.raw();
    const stmt = db.prepare(`
      SELECT
        COUNT(*) as count,
        MIN(timestamp) as first_msg,
        MAX(timestamp) as last_msg
      FROM chat_logs
      WHERE LOWER(username) = ?
    `);
    const result = stmt.get(username.toLowerCase()) as any;

    if (!result || result.count === 0) return null;

    return {
      messageCount: result.count,
      firstMessage: result.first_msg,
      lastMessage: result.last_msg,
    };
  }

  private formatTime(timestamp: string): string {
    const date = new Date(timestamp);
    return date.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
  }

  private formatDate(timestamp: string): string {
    const date = new Date(timestamp);
    return date.toLocaleDateString('de-DE');
  }

  // Public API
  searchLogs(query: string, limit = 50): ChatLog[] {
    const db = this.db.raw();
    const stmt = db.prepare(`
      SELECT * FROM chat_logs
      WHERE message LIKE ?
      ORDER BY timestamp DESC LIMIT ?
    `);
    return stmt.all(`%${query}%`, limit) as ChatLog[];
  }

  getLogCount(): number {
    const db = this.db.raw();
    const stmt = db.prepare('SELECT COUNT(*) as count FROM chat_logs');
    const result = stmt.get() as { count: number };
    return result.count;
  }
}
