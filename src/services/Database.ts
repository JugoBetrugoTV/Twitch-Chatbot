/**
 * Database Service
 *
 * SQLite-based persistent storage using sql.js (pure JavaScript, no native compilation)
 *
 * Features:
 * - Users (points, watchtime, stats)
 * - Custom Commands
 * - Timers
 * - Settings
 * - Event logs
 */

import initSqlJs, { Database as SqlJsDatabase, Statement } from 'sql.js';
import { Logger } from '../utils/logger';
import path from 'path';
import fs from 'fs';

// ==========================================
// Compatibility Wrapper for better-sqlite3 API
// ==========================================

/**
 * Wrapper that makes sql.js prepared statements behave like better-sqlite3 statements
 */
class CompatStatement {
  constructor(
    private db: SqlJsDatabase,
    private sql: string,
    private parent: DatabaseService
  ) {}

  /**
   * Execute query and return all rows (better-sqlite3 compatible)
   */
  all(...params: any[]): any[] {
    const results: any[] = [];
    const stmt = this.db.prepare(this.sql);
    stmt.bind(params.length > 0 ? params : undefined);
    while (stmt.step()) {
      results.push(stmt.getAsObject());
    }
    stmt.free();
    return results;
  }

  /**
   * Execute query and return first row (better-sqlite3 compatible)
   */
  get(...params: any[]): any | undefined {
    const stmt = this.db.prepare(this.sql);
    stmt.bind(params.length > 0 ? params : undefined);
    if (stmt.step()) {
      const row = stmt.getAsObject();
      stmt.free();
      return row;
    }
    stmt.free();
    return undefined;
  }

  /**
   * Execute statement (INSERT, UPDATE, DELETE) (better-sqlite3 compatible)
   */
  run(...params: any[]): { changes: number; lastInsertRowid: number } {
    this.db.run(this.sql, params.length > 0 ? params : undefined);
    this.parent['markDirty']();
    return {
      changes: this.db.getRowsModified(),
      lastInsertRowid: 0, // sql.js doesn't directly expose this
    };
  }

  /**
   * Bind parameters for iteration (better-sqlite3 compatible)
   */
  bind(...params: any[]): CompatStatement {
    // Returns self for chaining, params will be used in iteration
    return this;
  }

  /**
   * Iterate over results (better-sqlite3 compatible)
   */
  *iterate(...params: any[]): IterableIterator<any> {
    const stmt = this.db.prepare(this.sql);
    stmt.bind(params.length > 0 ? params : undefined);
    while (stmt.step()) {
      yield stmt.getAsObject();
    }
    stmt.free();
  }

  /**
   * Get column names (better-sqlite3 compatible)
   */
  columns(): { name: string }[] {
    const result = this.db.exec(this.sql + ' LIMIT 0');
    if (result.length > 0) {
      return result[0].columns.map((name) => ({ name }));
    }
    return [];
  }
}

/**
 * Wrapper that makes sql.js database behave like better-sqlite3 database
 * This allows existing plugins to work without modification
 */
class BetterSqlite3Compat {
  constructor(
    private db: SqlJsDatabase,
    private parent: DatabaseService
  ) {}

  /**
   * Prepare a statement (better-sqlite3 compatible)
   */
  prepare(sql: string): CompatStatement {
    return new CompatStatement(this.db, sql, this.parent);
  }

  /**
   * Execute raw SQL (better-sqlite3 compatible)
   */
  exec(sql: string): this {
    this.db.run(sql);
    this.parent['markDirty']();
    return this;
  }

  /**
   * Begin a transaction (better-sqlite3 compatible)
   */
  transaction<T>(fn: () => T): () => T {
    const self = this;
    return function () {
      self.db.run('BEGIN TRANSACTION');
      try {
        const result = fn();
        self.db.run('COMMIT');
        self.parent['markDirty']();
        return result;
      } catch (error) {
        self.db.run('ROLLBACK');
        throw error;
      }
    };
  }

  /**
   * Pragma command (better-sqlite3 compatible)
   */
  pragma(pragma: string, simplify?: boolean): any {
    const result = this.db.exec(`PRAGMA ${pragma}`);
    if (result.length === 0) return simplify ? undefined : [];
    if (simplify && result[0].values.length === 1) {
      return result[0].values[0][0];
    }
    return result[0].values.map((row) => {
      const obj: any = {};
      result[0].columns.forEach((col, i) => {
        obj[col] = row[i];
      });
      return obj;
    });
  }

  /**
   * Check if database is open (better-sqlite3 compatible)
   */
  get open(): boolean {
    return true; // sql.js databases are always "open" until explicitly closed
  }

  /**
   * Check if database is in-memory (better-sqlite3 compatible)
   */
  get inTransaction(): boolean {
    return false; // Simplified - could track this if needed
  }

  /**
   * Close database (better-sqlite3 compatible)
   */
  close(): void {
    this.db.close();
  }
}

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
  private db!: SqlJsDatabase;
  private logger = new Logger('Database');
  private dbPath: string;
  private saveInterval: NodeJS.Timeout | null = null;
  private dirty = false;

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

    this.dbPath = dbPath || path.join(dataDir, 'streamcore.db');
  }

  /**
   * Initialize the database (must be called before using)
   */
  async initialize(): Promise<void> {
    const SQL = await initSqlJs();

    // Load existing database or create new
    if (fs.existsSync(this.dbPath)) {
      const fileBuffer = fs.readFileSync(this.dbPath);
      this.db = new SQL.Database(fileBuffer);
      this.logger.info(`Database loaded: ${this.dbPath}`);
    } else {
      this.db = new SQL.Database();
      this.logger.info(`New database created: ${this.dbPath}`);
    }

    this.initTables();

    // Auto-save every 30 seconds if there are changes
    this.saveInterval = setInterval(() => {
      if (this.dirty) {
        this.save();
      }
    }, 30000);

    this.logger.info('Database initialized');
  }

  private initTables(): void {
    // Users table
    this.db.run(`
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
        is_regular BOOLEAN DEFAULT 0,
        custom_data TEXT DEFAULT '{}',
        UNIQUE(platform, username)
      )
    `);

    this.db.run(`CREATE INDEX IF NOT EXISTS idx_users_platform_username ON users(platform, username)`);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_users_points ON users(points DESC)`);

    // Commands table
    this.db.run(`
      CREATE TABLE IF NOT EXISTS commands (
        id TEXT PRIMARY KEY,
        name TEXT UNIQUE NOT NULL,
        response TEXT NOT NULL,
        cooldown_user INTEGER DEFAULT 5,
        cooldown_global INTEGER DEFAULT 0,
        permission TEXT DEFAULT 'everyone',
        enabled BOOLEAN DEFAULT 1,
        use_count INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    this.db.run(`CREATE INDEX IF NOT EXISTS idx_commands_name ON commands(name)`);

    // Timers table
    this.db.run(`
      CREATE TABLE IF NOT EXISTS timers (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        messages TEXT NOT NULL,
        interval_minutes INTEGER DEFAULT 15,
        min_messages INTEGER DEFAULT 5,
        enabled BOOLEAN DEFAULT 1,
        last_triggered DATETIME
      )
    `);

    // Settings table
    this.db.run(`
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Events log table
    this.db.run(`
      CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT NOT NULL,
        data TEXT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    this.db.run(`CREATE INDEX IF NOT EXISTS idx_events_type ON events(type)`);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_events_timestamp ON events(timestamp DESC)`);

    // Word blacklist table
    this.db.run(`
      CREATE TABLE IF NOT EXISTS blacklist (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        word TEXT UNIQUE NOT NULL,
        type TEXT DEFAULT 'word',
        action TEXT DEFAULT 'delete',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    this.logger.debug('Database tables initialized');
  }

  /**
   * Save database to file
   */
  save(): void {
    try {
      const data = this.db.export();
      const buffer = Buffer.from(data);
      fs.writeFileSync(this.dbPath, buffer);
      this.dirty = false;
      this.logger.debug('Database saved to disk');
    } catch (error) {
      this.logger.error(`Failed to save database: ${error}`);
    }
  }

  private markDirty(): void {
    this.dirty = true;
  }

  /**
   * Convert SQLite 0/1 to boolean for known boolean fields
   */
  private convertBooleans<T>(row: any): T {
    const booleanFields = ['is_regular', 'enabled'];
    for (const field of booleanFields) {
      if (field in row) {
        row[field] = Boolean(row[field]);
      }
    }
    return row as T;
  }

  private queryOne<T>(sql: string, params: any[] = []): T | null {
    const stmt = this.db.prepare(sql);
    stmt.bind(params);
    if (stmt.step()) {
      const row = stmt.getAsObject();
      stmt.free();
      return this.convertBooleans<T>(row);
    }
    stmt.free();
    return null;
  }

  private queryAll<T>(sql: string, params: any[] = []): T[] {
    const results: T[] = [];
    const stmt = this.db.prepare(sql);
    stmt.bind(params);
    while (stmt.step()) {
      const row = stmt.getAsObject();
      results.push(this.convertBooleans<T>(row));
    }
    stmt.free();
    return results;
  }

  private execute(sql: string, params: any[] = []): void {
    this.db.run(sql, params);
    this.markDirty();
  }

  // ==========================================
  // User Methods
  // ==========================================

  getUser(platform: string, username: string): DBUser | null {
    return this.queryOne<DBUser>(
      `SELECT * FROM users WHERE platform = ? AND LOWER(username) = LOWER(?)`,
      [platform, username]
    );
  }

  getUserById(id: string): DBUser | null {
    return this.queryOne<DBUser>('SELECT * FROM users WHERE id = ?', [id]);
  }

  createOrUpdateUser(
    id: string,
    platform: string,
    username: string,
    displayName: string
  ): DBUser {
    // Try to get existing user first
    const existing = this.getUser(platform, username);

    if (existing) {
      this.execute(
        `UPDATE users SET display_name = ?, last_seen = CURRENT_TIMESTAMP WHERE platform = ? AND LOWER(username) = LOWER(?)`,
        [displayName, platform, username]
      );
    } else {
      this.execute(
        `INSERT INTO users (id, platform, username, display_name, last_seen) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)`,
        [id, platform, username, displayName]
      );
    }

    return this.getUser(platform, username) || {
      id,
      platform,
      username,
      display_name: displayName,
      points: 0,
      watch_time: 0,
      message_count: 0,
      first_seen: new Date().toISOString(),
      last_seen: new Date().toISOString(),
      is_regular: false,
      custom_data: '{}',
    };
  }

  updateUserPoints(platform: string, username: string, delta: number): void {
    this.execute(
      `UPDATE users SET points = MAX(0, points + ?) WHERE platform = ? AND LOWER(username) = LOWER(?)`,
      [delta, platform, username]
    );
  }

  setUserPoints(platform: string, username: string, points: number): void {
    this.execute(
      `UPDATE users SET points = ? WHERE platform = ? AND LOWER(username) = LOWER(?)`,
      [Math.max(0, points), platform, username]
    );
  }

  incrementWatchTime(platform: string, username: string, minutes: number): void {
    this.execute(
      `UPDATE users SET watch_time = watch_time + ? WHERE platform = ? AND LOWER(username) = LOWER(?)`,
      [minutes, platform, username]
    );
  }

  incrementMessageCount(platform: string, username: string): void {
    this.execute(
      `UPDATE users SET message_count = message_count + 1, last_seen = CURRENT_TIMESTAMP WHERE platform = ? AND LOWER(username) = LOWER(?)`,
      [platform, username]
    );
  }

  getTopUsers(limit: number = 10, orderBy: 'points' | 'watch_time' = 'points'): DBUser[] {
    // Whitelist validation to prevent SQL injection
    const allowedColumns = ['points', 'watch_time', 'message_count'];
    const safeOrderBy = allowedColumns.includes(orderBy) ? orderBy : 'points';

    return this.queryAll<DBUser>(
      `SELECT * FROM users ORDER BY ${safeOrderBy} DESC LIMIT ?`,
      [limit]
    );
  }

  getAllUsers(platform?: string): DBUser[] {
    if (platform) {
      return this.queryAll<DBUser>('SELECT * FROM users WHERE platform = ?', [platform]);
    }
    return this.queryAll<DBUser>('SELECT * FROM users');
  }

  getUserCount(): number {
    const result = this.queryOne<{ count: number }>('SELECT COUNT(*) as count FROM users');
    return result?.count || 0;
  }

  // ==========================================
  // Command Methods
  // ==========================================

  getCommand(name: string): DBCommand | null {
    return this.queryOne<DBCommand>(
      'SELECT * FROM commands WHERE LOWER(name) = LOWER(?)',
      [name]
    );
  }

  getAllCommands(): DBCommand[] {
    return this.queryAll<DBCommand>('SELECT * FROM commands ORDER BY name');
  }

  createCommand(
    id: string,
    name: string,
    response: string,
    options?: Partial<DBCommand>
  ): DBCommand {
    this.execute(
      `INSERT INTO commands (id, name, response, cooldown_user, cooldown_global, permission, enabled) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        name.toLowerCase(),
        response,
        options?.cooldown_user ?? 5,
        options?.cooldown_global ?? 0,
        options?.permission ?? 'everyone',
        options?.enabled ?? 1,
      ]
    );
    return this.getCommand(name)!;
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

    this.execute(
      `UPDATE commands SET ${fields.join(', ')} WHERE LOWER(name) = LOWER(?)`,
      values
    );
  }

  deleteCommand(name: string): void {
    this.execute('DELETE FROM commands WHERE LOWER(name) = LOWER(?)', [name]);
  }

  incrementCommandUsage(name: string): void {
    this.execute(
      `UPDATE commands SET use_count = use_count + 1 WHERE LOWER(name) = LOWER(?)`,
      [name]
    );
  }

  // ==========================================
  // Timer Methods
  // ==========================================

  getTimer(id: string): DBTimer | null {
    return this.queryOne<DBTimer>('SELECT * FROM timers WHERE id = ?', [id]);
  }

  getAllTimers(): DBTimer[] {
    return this.queryAll<DBTimer>('SELECT * FROM timers');
  }

  createTimer(
    id: string,
    name: string,
    messages: string[],
    intervalMinutes: number,
    minMessages: number = 5
  ): DBTimer {
    this.execute(
      `INSERT INTO timers (id, name, messages, interval_minutes, min_messages) VALUES (?, ?, ?, ?, ?)`,
      [id, name, JSON.stringify(messages), intervalMinutes, minMessages]
    );
    return this.getTimer(id)!;
  }

  updateTimerLastTriggered(id: string): void {
    this.execute(
      `UPDATE timers SET last_triggered = CURRENT_TIMESTAMP WHERE id = ?`,
      [id]
    );
  }

  deleteTimer(id: string): void {
    this.execute('DELETE FROM timers WHERE id = ?', [id]);
  }

  // ==========================================
  // Settings Methods
  // ==========================================

  getSetting<T = string>(key: string, defaultValue?: T): T {
    const result = this.queryOne<{ value: string }>('SELECT value FROM settings WHERE key = ?', [key]);

    if (!result) {
      return defaultValue as T;
    }

    try {
      return JSON.parse(result.value) as T;
    } catch {
      return result.value as unknown as T;
    }
  }

  setSetting(key: string, value: any): void {
    const stringValue = typeof value === 'string' ? value : JSON.stringify(value);
    this.execute(
      `INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)`,
      [key, stringValue]
    );
  }

  deleteSetting(key: string): void {
    this.execute('DELETE FROM settings WHERE key = ?', [key]);
  }

  getAllSettings(): Record<string, any> {
    const rows = this.queryAll<{ key: string; value: string }>('SELECT key, value FROM settings');

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
    this.execute(
      `INSERT INTO events (type, data) VALUES (?, ?)`,
      [type, data ? JSON.stringify(data) : null]
    );
  }

  getRecentEvents(limit: number = 50, type?: string): DBEvent[] {
    if (type) {
      return this.queryAll<DBEvent>(
        `SELECT * FROM events WHERE type = ? ORDER BY timestamp DESC LIMIT ?`,
        [type, limit]
      );
    }

    return this.queryAll<DBEvent>(
      `SELECT * FROM events ORDER BY timestamp DESC LIMIT ?`,
      [limit]
    );
  }

  clearOldEvents(daysOld: number = 30): number {
    const beforeCount = this.queryOne<{ count: number }>('SELECT COUNT(*) as count FROM events')?.count || 0;
    this.execute(
      `DELETE FROM events WHERE timestamp < datetime('now', '-' || ? || ' days')`,
      [daysOld]
    );
    const afterCount = this.queryOne<{ count: number }>('SELECT COUNT(*) as count FROM events')?.count || 0;
    return beforeCount - afterCount;
  }

  // ==========================================
  // Blacklist Methods
  // ==========================================

  addBlacklistWord(word: string, type: string = 'word', action: string = 'delete'): void {
    this.execute(
      `INSERT OR IGNORE INTO blacklist (word, type, action) VALUES (?, ?, ?)`,
      [word.toLowerCase(), type, action]
    );
    this.invalidateBlacklistCache();
  }

  removeBlacklistWord(word: string): void {
    this.execute('DELETE FROM blacklist WHERE LOWER(word) = LOWER(?)', [word]);
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

    this.blacklistCache = this.queryAll<{ word: string; type: string; action: string }>(
      'SELECT word, type, action FROM blacklist'
    );
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
    if (this.saveInterval) {
      clearInterval(this.saveInterval);
    }
    this.save(); // Final save
    this.db.close();
    this.logger.info('Database connection closed');
  }

  backup(backupPath: string): void {
    const data = this.db.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(backupPath, buffer);
    this.logger.info(`Database backed up to: ${backupPath}`);
  }

  /**
   * Get better-sqlite3 compatible database wrapper (for plugins)
   * This wrapper provides an API compatible with better-sqlite3
   */
  raw(): BetterSqlite3Compat {
    return new BetterSqlite3Compat(this.db, this);
  }

  /**
   * Get actual raw sql.js database instance (for internal use)
   * Use this only when you need direct sql.js API access
   */
  rawSqlJs(): SqlJsDatabase {
    return this.db;
  }

  // ==========================================
  // Compatibility Layer for Plugins
  // (These methods provide a similar API to better-sqlite3)
  // ==========================================

  /**
   * Execute a query and return all rows (compatibility method)
   */
  query<T = any>(sql: string, params: any[] = []): T[] {
    return this.queryAll<T>(sql, params);
  }

  /**
   * Execute a query and return first row (compatibility method)
   */
  queryFirst<T = any>(sql: string, params: any[] = []): T | null {
    return this.queryOne<T>(sql, params);
  }

  /**
   * Execute a statement (INSERT, UPDATE, DELETE) and return changes info
   */
  run(sql: string, params: any[] = []): { changes: number } {
    this.db.run(sql, params);
    this.markDirty();
    return { changes: this.db.getRowsModified() };
  }

  /**
   * Execute raw SQL without parameters
   */
  exec(sql: string): void {
    this.db.run(sql);
    this.markDirty();
  }

  /**
   * Prepare-like interface for compatibility
   * Returns an object with .all() and .get() methods
   */
  prepare(sql: string): {
    all: (...params: any[]) => any[];
    get: (...params: any[]) => any | undefined;
    run: (...params: any[]) => { changes: number };
  } {
    const self = this;
    return {
      all(...params: any[]): any[] {
        return self.queryAll(sql, params);
      },
      get(...params: any[]): any | undefined {
        return self.queryOne(sql, params) || undefined;
      },
      run(...params: any[]): { changes: number } {
        return self.run(sql, params);
      },
    };
  }
}

// Singleton instance
let dbInstance: DatabaseService | null = null;
let initPromise: Promise<DatabaseService> | null = null;

export function getDatabase(): DatabaseService {
  if (!dbInstance) {
    throw new Error('Database not initialized. Call initDatabase() first.');
  }
  return dbInstance;
}

/**
 * Initialize the database (call once at startup)
 */
export async function initDatabase(dbPath?: string): Promise<DatabaseService> {
  if (dbInstance) {
    return dbInstance;
  }

  if (initPromise) {
    return initPromise;
  }

  initPromise = (async () => {
    dbInstance = new DatabaseService(dbPath);
    await dbInstance.initialize();
    return dbInstance;
  })();

  return initPromise;
}
