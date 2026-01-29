/**
 * Database Service
 *
 * SQLite-based persistent storage for:
 * - Users (points, watchtime, stats)
 * - Custom Commands
 * - Timers
 * - Settings
 * - Event logs
 */

import Database from 'better-sqlite3';
import { Logger } from '../utils/logger';
import path from 'path';
import fs from 'fs';

// Types
export interface DBUser {
  id: string;
  platform: string;
  username: string;
  display_name: string;
  points: number;
  watch_time: number;
  message_count: number;
  first_seen: string;
  last_seen: string;
  is_regular: boolean;
  custom_data: string; // JSON
}

export interface DBCommand {
  id: string;
  name: string;
  response: string;
  cooldown_user: number;
  cooldown_global: number;
  permission: string;
  enabled: boolean;
  use_count: number;
  created_at: string;
  updated_at: string;
}

export interface DBTimer {
  id: string;
  name: string;
  messages: string; // JSON array
  interval_minutes: number;
  min_messages: number;
  enabled: boolean;
  last_triggered: string | null;
}

export interface DBSettings {
  key: string;
  value: string;
  updated_at: string;
}

export interface DBEvent {
  id: number;
  type: string;
  data: string; // JSON
  timestamp: string;
}

export class DatabaseService {
  private db: Database.Database;
  private logger = new Logger('Database');

  // Blacklist cache for performance
  private blacklistCache: { word: string; type: string; action: string }[] | null = null;
  private blacklistCacheTime: number = 0;
  private readonly BLACKLIST_CACHE_TTL = 60000; // 1 minute

  constructor(dbPath?: string) {
    // Ensure data directory exists
    const dataDir = path.join(process.cwd(), 'data');
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    const fullPath = dbPath || path.join(dataDir, 'streamcore.db');
    this.db = new Database(fullPath);

    // Enable WAL mode for better performance
    this.db.pragma('journal_mode = WAL');

    this.initTables();
    this.logger.info(`Database initialized: ${fullPath}`);
  }

  private initTables(): void {
    // Users table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        platform TEXT NOT NULL,
        username TEXT NOT NULL,
        display_name TEXT,
        points INTEGER DEFAULT 0,
        watch_time INTEGER DEFAULT 0,
        message_count INTEGER DEFAULT 0,
        first_seen DATETIME DEFAULT CURRENT_TIMESTAMP,
        last_seen DATETIME DEFAULT CURRENT_TIMESTAMP,
        is_regular BOOLEAN DEFAULT FALSE,
        custom_data TEXT DEFAULT '{}',
        UNIQUE(platform, username)
      );

      CREATE INDEX IF NOT EXISTS idx_users_platform_username ON users(platform, username);
      CREATE INDEX IF NOT EXISTS idx_users_points ON users(points DESC);
    `);

    // Commands table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS commands (
        id TEXT PRIMARY KEY,
        name TEXT UNIQUE NOT NULL,
        response TEXT NOT NULL,
        cooldown_user INTEGER DEFAULT 5,
        cooldown_global INTEGER DEFAULT 0,
        permission TEXT DEFAULT 'everyone',
        enabled BOOLEAN DEFAULT TRUE,
        use_count INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_commands_name ON commands(name);
    `);

    // Timers table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS timers (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        messages TEXT NOT NULL,
        interval_minutes INTEGER DEFAULT 15,
        min_messages INTEGER DEFAULT 5,
        enabled BOOLEAN DEFAULT TRUE,
        last_triggered DATETIME
      );
    `);

    // Settings table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Events log table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT NOT NULL,
        data TEXT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_events_type ON events(type);
      CREATE INDEX IF NOT EXISTS idx_events_timestamp ON events(timestamp DESC);
    `);

    // Word blacklist table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS blacklist (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        word TEXT UNIQUE NOT NULL,
        type TEXT DEFAULT 'word',
        action TEXT DEFAULT 'delete',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);

    this.logger.debug('Database tables initialized');
  }

  // ==========================================
  // User Methods
  // ==========================================

  getUser(platform: string, username: string): DBUser | null {
    const stmt = this.db.prepare(`
      SELECT * FROM users WHERE platform = ? AND LOWER(username) = LOWER(?)
    `);
    return stmt.get(platform, username) as DBUser | null;
  }

  getUserById(id: string): DBUser | null {
    const stmt = this.db.prepare('SELECT * FROM users WHERE id = ?');
    return stmt.get(id) as DBUser | null;
  }

  createOrUpdateUser(
    id: string,
    platform: string,
    username: string,
    displayName: string
  ): DBUser {
    const stmt = this.db.prepare(`
      INSERT INTO users (id, platform, username, display_name, last_seen)
      VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(platform, username) DO UPDATE SET
        display_name = excluded.display_name,
        last_seen = CURRENT_TIMESTAMP
      RETURNING *
    `);
    return stmt.get(id, platform, username, displayName) as DBUser;
  }

  updateUserPoints(platform: string, username: string, delta: number): void {
    const stmt = this.db.prepare(`
      UPDATE users SET points = MAX(0, points + ?)
      WHERE platform = ? AND LOWER(username) = LOWER(?)
    `);
    stmt.run(delta, platform, username);
  }

  setUserPoints(platform: string, username: string, points: number): void {
    const stmt = this.db.prepare(`
      UPDATE users SET points = ?
      WHERE platform = ? AND LOWER(username) = LOWER(?)
    `);
    stmt.run(Math.max(0, points), platform, username);
  }

  incrementWatchTime(platform: string, username: string, minutes: number): void {
    const stmt = this.db.prepare(`
      UPDATE users SET watch_time = watch_time + ?
      WHERE platform = ? AND LOWER(username) = LOWER(?)
    `);
    stmt.run(minutes, platform, username);
  }

  incrementMessageCount(platform: string, username: string): void {
    const stmt = this.db.prepare(`
      UPDATE users SET message_count = message_count + 1, last_seen = CURRENT_TIMESTAMP
      WHERE platform = ? AND LOWER(username) = LOWER(?)
    `);
    stmt.run(platform, username);
  }

  getTopUsers(limit: number = 10, orderBy: 'points' | 'watch_time' = 'points'): DBUser[] {
    // Whitelist validation to prevent SQL injection
    const allowedColumns = ['points', 'watch_time', 'message_count'];
    const safeOrderBy = allowedColumns.includes(orderBy) ? orderBy : 'points';

    const stmt = this.db.prepare(`
      SELECT * FROM users ORDER BY ${safeOrderBy} DESC LIMIT ?
    `);
    return stmt.all(limit) as DBUser[];
  }

  getAllUsers(platform?: string): DBUser[] {
    if (platform) {
      const stmt = this.db.prepare('SELECT * FROM users WHERE platform = ?');
      return stmt.all(platform) as DBUser[];
    }
    const stmt = this.db.prepare('SELECT * FROM users');
    return stmt.all() as DBUser[];
  }

  getUserCount(): number {
    const stmt = this.db.prepare('SELECT COUNT(*) as count FROM users');
    const result = stmt.get() as { count: number };
    return result.count;
  }

  // ==========================================
  // Command Methods
  // ==========================================

  getCommand(name: string): DBCommand | null {
    const stmt = this.db.prepare('SELECT * FROM commands WHERE LOWER(name) = LOWER(?)');
    return stmt.get(name) as DBCommand | null;
  }

  getAllCommands(): DBCommand[] {
    const stmt = this.db.prepare('SELECT * FROM commands ORDER BY name');
    return stmt.all() as DBCommand[];
  }

  createCommand(
    id: string,
    name: string,
    response: string,
    options?: Partial<DBCommand>
  ): DBCommand {
    const stmt = this.db.prepare(`
      INSERT INTO commands (id, name, response, cooldown_user, cooldown_global, permission, enabled)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      RETURNING *
    `);
    return stmt.get(
      id,
      name.toLowerCase(),
      response,
      options?.cooldown_user ?? 5,
      options?.cooldown_global ?? 0,
      options?.permission ?? 'everyone',
      options?.enabled ?? true
    ) as DBCommand;
  }

  updateCommand(name: string, updates: Partial<DBCommand>): void {
    const fields: string[] = [];
    const values: any[] = [];

    if (updates.response !== undefined) {
      fields.push('response = ?');
      values.push(updates.response);
    }
    if (updates.cooldown_user !== undefined) {
      fields.push('cooldown_user = ?');
      values.push(updates.cooldown_user);
    }
    if (updates.cooldown_global !== undefined) {
      fields.push('cooldown_global = ?');
      values.push(updates.cooldown_global);
    }
    if (updates.permission !== undefined) {
      fields.push('permission = ?');
      values.push(updates.permission);
    }
    if (updates.enabled !== undefined) {
      fields.push('enabled = ?');
      values.push(updates.enabled);
    }

    if (fields.length === 0) return;

    fields.push('updated_at = CURRENT_TIMESTAMP');
    values.push(name.toLowerCase());

    const stmt = this.db.prepare(`
      UPDATE commands SET ${fields.join(', ')} WHERE LOWER(name) = LOWER(?)
    `);
    stmt.run(...values);
  }

  deleteCommand(name: string): void {
    const stmt = this.db.prepare('DELETE FROM commands WHERE LOWER(name) = LOWER(?)');
    stmt.run(name);
  }

  incrementCommandUsage(name: string): void {
    const stmt = this.db.prepare(`
      UPDATE commands SET use_count = use_count + 1 WHERE LOWER(name) = LOWER(?)
    `);
    stmt.run(name);
  }

  // ==========================================
  // Timer Methods
  // ==========================================

  getTimer(id: string): DBTimer | null {
    const stmt = this.db.prepare('SELECT * FROM timers WHERE id = ?');
    return stmt.get(id) as DBTimer | null;
  }

  getAllTimers(): DBTimer[] {
    const stmt = this.db.prepare('SELECT * FROM timers');
    return stmt.all() as DBTimer[];
  }

  createTimer(
    id: string,
    name: string,
    messages: string[],
    intervalMinutes: number,
    minMessages: number = 5
  ): DBTimer {
    const stmt = this.db.prepare(`
      INSERT INTO timers (id, name, messages, interval_minutes, min_messages)
      VALUES (?, ?, ?, ?, ?)
      RETURNING *
    `);
    return stmt.get(id, name, JSON.stringify(messages), intervalMinutes, minMessages) as DBTimer;
  }

  updateTimerLastTriggered(id: string): void {
    const stmt = this.db.prepare(`
      UPDATE timers SET last_triggered = CURRENT_TIMESTAMP WHERE id = ?
    `);
    stmt.run(id);
  }

  deleteTimer(id: string): void {
    const stmt = this.db.prepare('DELETE FROM timers WHERE id = ?');
    stmt.run(id);
  }

  // ==========================================
  // Settings Methods
  // ==========================================

  getSetting<T = string>(key: string, defaultValue?: T): T {
    const stmt = this.db.prepare('SELECT value FROM settings WHERE key = ?');
    const result = stmt.get(key) as { value: string } | undefined;

    if (!result) {
      return defaultValue as T;
    }

    try {
      return JSON.parse(result.value) as T;
    } catch {
      return result.value as T;
    }
  }

  setSetting(key: string, value: any): void {
    const stringValue = typeof value === 'string' ? value : JSON.stringify(value);
    const stmt = this.db.prepare(`
      INSERT INTO settings (key, value, updated_at)
      VALUES (?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        updated_at = CURRENT_TIMESTAMP
    `);
    stmt.run(key, stringValue);
  }

  deleteSetting(key: string): void {
    const stmt = this.db.prepare('DELETE FROM settings WHERE key = ?');
    stmt.run(key);
  }

  getAllSettings(): Record<string, any> {
    const stmt = this.db.prepare('SELECT key, value FROM settings');
    const rows = stmt.all() as { key: string; value: string }[];

    const settings: Record<string, any> = {};
    for (const row of rows) {
      try {
        settings[row.key] = JSON.parse(row.value);
      } catch {
        settings[row.key] = row.value;
      }
    }
    return settings;
  }

  // ==========================================
  // Event Log Methods
  // ==========================================

  logEvent(type: string, data?: any): void {
    const stmt = this.db.prepare(`
      INSERT INTO events (type, data) VALUES (?, ?)
    `);
    stmt.run(type, data ? JSON.stringify(data) : null);
  }

  getRecentEvents(limit: number = 50, type?: string): DBEvent[] {
    if (type) {
      const stmt = this.db.prepare(`
        SELECT * FROM events WHERE type = ? ORDER BY timestamp DESC LIMIT ?
      `);
      return stmt.all(type, limit) as DBEvent[];
    }

    const stmt = this.db.prepare(`
      SELECT * FROM events ORDER BY timestamp DESC LIMIT ?
    `);
    return stmt.all(limit) as DBEvent[];
  }

  clearOldEvents(daysOld: number = 30): number {
    const stmt = this.db.prepare(`
      DELETE FROM events WHERE timestamp < datetime('now', '-' || ? || ' days')
    `);
    const result = stmt.run(daysOld);
    return result.changes;
  }

  // ==========================================
  // Blacklist Methods
  // ==========================================

  addBlacklistWord(word: string, type: string = 'word', action: string = 'delete'): void {
    const stmt = this.db.prepare(`
      INSERT OR IGNORE INTO blacklist (word, type, action) VALUES (?, ?, ?)
    `);
    stmt.run(word.toLowerCase(), type, action);
    this.invalidateBlacklistCache();
  }

  removeBlacklistWord(word: string): void {
    const stmt = this.db.prepare('DELETE FROM blacklist WHERE LOWER(word) = LOWER(?)');
    stmt.run(word);
    this.invalidateBlacklistCache();
  }

  private invalidateBlacklistCache(): void {
    this.blacklistCache = null;
    this.blacklistCacheTime = 0;
  }

  getBlacklist(): { word: string; type: string; action: string }[] {
    const now = Date.now();
    if (this.blacklistCache && now - this.blacklistCacheTime < this.BLACKLIST_CACHE_TTL) {
      return this.blacklistCache;
    }

    const stmt = this.db.prepare('SELECT word, type, action FROM blacklist');
    this.blacklistCache = stmt.all() as { word: string; type: string; action: string }[];
    this.blacklistCacheTime = now;
    return this.blacklistCache;
  }

  isBlacklisted(text: string): { word: string; action: string } | null {
    const blacklist = this.getBlacklist();
    const lowerText = text.toLowerCase();

    for (const entry of blacklist) {
      if (entry.type === 'word' && lowerText.includes(entry.word)) {
        return { word: entry.word, action: entry.action };
      }
      if (entry.type === 'regex') {
        try {
          const regex = new RegExp(entry.word, 'i');
          if (regex.test(text)) {
            return { word: entry.word, action: entry.action };
          }
        } catch {
          // Invalid regex, skip
        }
      }
    }

    return null;
  }

  // ==========================================
  // Utility Methods
  // ==========================================

  close(): void {
    this.db.close();
    this.logger.info('Database connection closed');
  }

  backup(backupPath: string): void {
    this.db.backup(backupPath);
    this.logger.info(`Database backed up to: ${backupPath}`);
  }

  /**
   * Run raw SQL (for advanced use)
   */
  raw(): Database.Database {
    return this.db;
  }
}

// Singleton instance
let dbInstance: DatabaseService | null = null;

export function getDatabase(): DatabaseService {
  if (!dbInstance) {
    dbInstance = new DatabaseService();
  }
  return dbInstance;
}
