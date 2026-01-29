/**
 * Backup & Restore Service
 *
 * Features:
 * - Database backup
 * - Settings export/import
 * - Automatic scheduled backups
 * - Backup rotation
 * - Restore from backup
 */

import * as fs from 'fs';
import * as path from 'path';
import { createGzip, createGunzip } from 'zlib';
import { pipeline } from 'stream/promises';
import { Logger } from '../utils/logger';
import { getDatabase } from './Database';

export interface BackupConfig {
  backupDir: string;
  autoBackup: boolean;
  backupIntervalHours: number;
  maxBackups: number;
  compressBackups: boolean;
}

interface BackupMetadata {
  id: string;
  timestamp: Date;
  version: string;
  size: number;
  compressed: boolean;
  description?: string;
}

const DEFAULT_CONFIG: BackupConfig = {
  backupDir: './backups',
  autoBackup: true,
  backupIntervalHours: 24,
  maxBackups: 7,
  compressBackups: true,
};

export class BackupService {
  private log = new Logger('Backup');
  private config: BackupConfig;
  private backupTimer?: NodeJS.Timeout;

  constructor(config: Partial<BackupConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.ensureBackupDir();
  }

  private ensureBackupDir(): void {
    if (!fs.existsSync(this.config.backupDir)) {
      fs.mkdirSync(this.config.backupDir, { recursive: true });
      this.log.info(`Created backup directory: ${this.config.backupDir}`);
    }
  }

  start(): void {
    if (this.config.autoBackup) {
      const intervalMs = this.config.backupIntervalHours * 60 * 60 * 1000;

      this.backupTimer = setInterval(() => {
        this.createBackup('auto').catch((err) => {
          this.log.error(`Auto-backup failed: ${err}`);
        });
      }, intervalMs);

      this.log.info(`Auto-backup enabled (every ${this.config.backupIntervalHours} hours)`);
    }
  }

  /**
   * Create a backup on startup if needed
   * Only creates if last backup is older than threshold
   */
  async startupBackup(thresholdHours: number = 24): Promise<boolean> {
    const backups = this.listBackups();

    if (backups.length === 0) {
      this.log.info('No existing backups found, creating startup backup...');
      await this.createBackup('startup - initial');
      return true;
    }

    const latestBackup = backups[0];
    const hoursSinceBackup = (Date.now() - latestBackup.timestamp.getTime()) / (1000 * 60 * 60);

    if (hoursSinceBackup >= thresholdHours) {
      this.log.info(`Last backup is ${hoursSinceBackup.toFixed(1)}h old, creating startup backup...`);
      await this.createBackup('startup - scheduled');
      return true;
    }

    this.log.info(`Last backup is ${hoursSinceBackup.toFixed(1)}h old, skipping startup backup`);
    return false;
  }

  stop(): void {
    if (this.backupTimer) {
      clearInterval(this.backupTimer);
      this.backupTimer = undefined;
    }
  }

  async createBackup(description?: string): Promise<BackupMetadata> {
    const timestamp = new Date();
    const id = `backup_${timestamp.toISOString().replace(/[:.]/g, '-')}`;
    const db = getDatabase();

    this.log.info(`Creating backup: ${id}`);

    // Create backup data
    const backupData = {
      id,
      timestamp: timestamp.toISOString(),
      version: '1.0.0',
      description,
      database: this.exportDatabase(),
      settings: this.exportSettings(),
    };

    // Write backup file
    const filename = this.config.compressBackups ? `${id}.json.gz` : `${id}.json`;
    const filepath = path.join(this.config.backupDir, filename);

    if (this.config.compressBackups) {
      await this.writeCompressed(filepath, JSON.stringify(backupData, null, 2));
    } else {
      fs.writeFileSync(filepath, JSON.stringify(backupData, null, 2));
    }

    const stats = fs.statSync(filepath);

    const metadata: BackupMetadata = {
      id,
      timestamp,
      version: backupData.version,
      size: stats.size,
      compressed: this.config.compressBackups,
      description,
    };

    // Rotate old backups
    await this.rotateBackups();

    this.log.info(`Backup created: ${filename} (${this.formatSize(stats.size)})`);

    return metadata;
  }

  private exportDatabase(): Record<string, any[]> {
    const db = getDatabase().rawSqlJs();
    const tables: Record<string, any[]> = {};

    // Get all tables using sql.js API
    const tableStmt = db.prepare(`
      SELECT name FROM sqlite_master
      WHERE type='table' AND name NOT LIKE 'sqlite_%'
    `);

    const tableList: { name: string }[] = [];
    while (tableStmt.step()) {
      tableList.push(tableStmt.getAsObject() as { name: string });
    }
    tableStmt.free();

    for (const table of tableList) {
      // Security: Validate table name format before using in query
      if (!this.isValidIdentifier(table.name)) {
        this.log.warn(`Skipping invalid table name in export: ${table.name}`);
        continue;
      }

      const rowStmt = db.prepare(`SELECT * FROM "${table.name}"`);
      const rows: any[] = [];
      while (rowStmt.step()) {
        rows.push(rowStmt.getAsObject());
      }
      rowStmt.free();
      tables[table.name] = rows;
    }

    return tables;
  }

  private exportSettings(): Record<string, any> {
    const db = getDatabase();
    const settings: Record<string, any> = {};

    try {
      const rawDb = db.rawSqlJs();
      const stmt = rawDb.prepare('SELECT key, value FROM settings');
      while (stmt.step()) {
        const row = stmt.getAsObject() as { key: string; value: string };
        try {
          settings[row.key] = JSON.parse(row.value);
        } catch {
          settings[row.key] = row.value;
        }
      }
      stmt.free();
    } catch (error) {
      this.log.warn(`Could not export settings: ${error}`);
    }

    return settings;
  }

  async restore(backupId: string): Promise<boolean> {
    const files = this.listBackupFiles();
    const backupFile = files.find((f) => f.includes(backupId));

    if (!backupFile) {
      this.log.error(`Backup not found: ${backupId}`);
      return false;
    }

    const filepath = path.join(this.config.backupDir, backupFile);
    this.log.info(`Restoring from backup: ${backupFile}`);

    try {
      let content: string;

      if (backupFile.endsWith('.gz')) {
        content = await this.readCompressed(filepath);
      } else {
        content = fs.readFileSync(filepath, 'utf-8');
      }

      const backupData = JSON.parse(content);

      // Restore database tables
      if (backupData.database) {
        await this.restoreDatabase(backupData.database);
      }

      // Restore settings
      if (backupData.settings) {
        await this.restoreSettings(backupData.settings);
      }

      this.log.info('Backup restored successfully');
      return true;
    } catch (error) {
      this.log.error(`Restore failed: ${error}`);
      return false;
    }
  }

  // Whitelist of allowed table names for restore operations
  private static readonly ALLOWED_TABLES = new Set([
    'users', 'custom_commands', 'timers', 'quotes', 'settings',
    'events', 'blacklist', 'counters', 'polls', 'giveaways',
    'chat_logs', 'analytics', 'sessions', 'loyalty_rewards',
    'sound_alerts', 'scheduled_tasks', 'betting', 'trivia',
  ]);

  // Validate that a name contains only safe characters (alphanumeric and underscore)
  private isValidIdentifier(name: string): boolean {
    return /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name);
  }

  private async restoreDatabase(tables: Record<string, any[]>): Promise<void> {
    const db = getDatabase().rawSqlJs();

    // Get actual tables in the database for validation using sql.js API
    const existingTables = new Set<string>();
    const tableStmt = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`);
    while (tableStmt.step()) {
      const row = tableStmt.getAsObject() as { name: string };
      existingTables.add(row.name);
    }
    tableStmt.free();

    for (const [tableName, rows] of Object.entries(tables)) {
      if (rows.length === 0) continue;

      // Security: Validate table name against whitelist and existing tables
      if (!BackupService.ALLOWED_TABLES.has(tableName) && !existingTables.has(tableName)) {
        this.log.warn(`Skipping unknown table: ${tableName}`);
        continue;
      }

      // Security: Validate table name format
      if (!this.isValidIdentifier(tableName)) {
        this.log.warn(`Skipping invalid table name: ${tableName}`);
        continue;
      }

      // Get column names from first row and validate them
      const columns = Object.keys(rows[0]).filter(col => this.isValidIdentifier(col));
      if (columns.length === 0) {
        this.log.warn(`No valid columns for table: ${tableName}`);
        continue;
      }

      const placeholders = columns.map(() => '?').join(', ');

      try {
        // Clear existing data - table name is now validated
        db.run(`DELETE FROM "${tableName}"`);

        // Insert backup data - columns are validated (sql.js API)
        for (const row of rows) {
          db.run(
            `INSERT INTO "${tableName}" (${columns.map(c => `"${c}"`).join(', ')}) VALUES (${placeholders})`,
            columns.map((col) => row[col])
          );
        }

        this.log.info(`Restored ${rows.length} rows to ${tableName}`);
      } catch (error) {
        this.log.error(`Failed to restore table ${tableName}: ${error}`);
      }
    }

    // Save changes
    getDatabase().save();
  }

  private async restoreSettings(settings: Record<string, any>): Promise<void> {
    const db = getDatabase();

    for (const [key, value] of Object.entries(settings)) {
      db.setSetting(key, value);
    }

    this.log.info(`Restored ${Object.keys(settings).length} settings`);
  }

  listBackups(): BackupMetadata[] {
    const files = this.listBackupFiles();
    const backups: BackupMetadata[] = [];

    for (const file of files) {
      const filepath = path.join(this.config.backupDir, file);
      const stats = fs.statSync(filepath);

      // Parse ID and timestamp from filename
      const match = file.match(/backup_(.+)\.(json|json\.gz)$/);
      if (match) {
        const timestampStr = match[1].replace(/-/g, ':').replace('T', 'T');
        backups.push({
          id: `backup_${match[1]}`,
          timestamp: new Date(timestampStr.replace(/-/g, ':')),
          version: '1.0.0',
          size: stats.size,
          compressed: file.endsWith('.gz'),
        });
      }
    }

    return backups.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  }

  private listBackupFiles(): string[] {
    if (!fs.existsSync(this.config.backupDir)) return [];

    return fs.readdirSync(this.config.backupDir)
      .filter((f) => f.startsWith('backup_') && (f.endsWith('.json') || f.endsWith('.json.gz')));
  }

  private async rotateBackups(): Promise<void> {
    const files = this.listBackupFiles()
      .map((f) => ({
        name: f,
        path: path.join(this.config.backupDir, f),
        mtime: fs.statSync(path.join(this.config.backupDir, f)).mtime,
      }))
      .sort((a, b) => b.mtime.getTime() - a.mtime.getTime());

    // Remove old backups
    while (files.length > this.config.maxBackups) {
      const oldest = files.pop()!;
      fs.unlinkSync(oldest.path);
      this.log.info(`Removed old backup: ${oldest.name}`);
    }
  }

  async deleteBackup(backupId: string): Promise<boolean> {
    const files = this.listBackupFiles();
    const backupFile = files.find((f) => f.includes(backupId));

    if (!backupFile) {
      return false;
    }

    const filepath = path.join(this.config.backupDir, backupFile);
    fs.unlinkSync(filepath);
    this.log.info(`Deleted backup: ${backupFile}`);
    return true;
  }

  private async writeCompressed(filepath: string, data: string): Promise<void> {
    const { Readable } = await import('stream');

    const source = Readable.from([data]);
    const gzip = createGzip();
    const destination = fs.createWriteStream(filepath);

    await pipeline(source, gzip, destination);
  }

  private async readCompressed(filepath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      const gunzip = createGunzip();
      const source = fs.createReadStream(filepath);

      source.pipe(gunzip);

      gunzip.on('data', (chunk) => chunks.push(chunk));
      gunzip.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
      gunzip.on('error', reject);
    });
  }

  private formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  // Export specific data
  async exportData(type: 'all' | 'settings' | 'users' | 'commands'): Promise<string> {
    const data: any = {
      exportedAt: new Date().toISOString(),
      type,
    };

    switch (type) {
      case 'all':
        data.database = this.exportDatabase();
        data.settings = this.exportSettings();
        break;
      case 'settings':
        data.settings = this.exportSettings();
        break;
      case 'users':
        data.users = this.exportDatabase()['users'] || [];
        break;
      case 'commands':
        data.commands = this.exportDatabase()['custom_commands'] || [];
        break;
    }

    return JSON.stringify(data, null, 2);
  }

  // Import specific data
  async importData(jsonData: string): Promise<{ success: boolean; imported: string[] }> {
    const imported: string[] = [];

    try {
      const data = JSON.parse(jsonData);

      if (data.settings) {
        await this.restoreSettings(data.settings);
        imported.push('settings');
      }

      if (data.database) {
        await this.restoreDatabase(data.database);
        imported.push('database');
      }

      if (data.users) {
        await this.restoreDatabase({ users: data.users });
        imported.push('users');
      }

      if (data.commands) {
        await this.restoreDatabase({ custom_commands: data.commands });
        imported.push('commands');
      }

      return { success: true, imported };
    } catch (error) {
      this.log.error(`Import failed: ${error}`);
      return { success: false, imported };
    }
  }
}

// Singleton instance
let backupInstance: BackupService | null = null;

export function getBackupService(config?: Partial<BackupConfig>): BackupService {
  if (!backupInstance) {
    backupInstance = new BackupService(config);
  }
  return backupInstance;
}

export function createBackupService(config?: Partial<BackupConfig>): BackupService {
  return new BackupService(config);
}
