/**
 * Audit Logger Service
 *
 * Comprehensive audit logging for security and compliance
 * Features:
 * - Event logging with timestamps
 * - User action tracking
 * - Security event logging
 * - Log rotation and retention
 * - Search and filtering
 * - Export capabilities
 */

import * as fs from 'fs';
import * as path from 'path';
import { Logger } from '../utils/logger';

export type AuditEventType =
  | 'auth.login'
  | 'auth.logout'
  | 'auth.failed'
  | 'auth.token_refresh'
  | 'user.created'
  | 'user.updated'
  | 'user.deleted'
  | 'user.banned'
  | 'user.unbanned'
  | 'user.timeout'
  | 'command.executed'
  | 'command.created'
  | 'command.updated'
  | 'command.deleted'
  | 'settings.changed'
  | 'plugin.loaded'
  | 'plugin.unloaded'
  | 'plugin.error'
  | 'moderation.action'
  | 'moderation.blacklist'
  | 'api.request'
  | 'api.error'
  | 'security.suspicious'
  | 'security.blocked'
  | 'security.rate_limited'
  | 'backup.created'
  | 'backup.restored'
  | 'system.startup'
  | 'system.shutdown'
  | 'system.error'
  | 'custom';

export type AuditSeverity = 'info' | 'warning' | 'error' | 'critical';

export interface AuditEntry {
  id: string;
  timestamp: string;
  type: AuditEventType;
  severity: AuditSeverity;
  actor?: {
    id?: string;
    username?: string;
    platform?: string;
    ip?: string;
  };
  target?: {
    id?: string;
    type?: string;
    name?: string;
  };
  action: string;
  details?: Record<string, any>;
  metadata?: {
    channel?: string;
    plugin?: string;
    command?: string;
    sessionId?: string;
  };
}

export interface AuditConfig {
  logDir: string;
  maxFileSize: number; // bytes
  maxFiles: number;
  retentionDays: number;
  logToConsole: boolean;
  logToFile: boolean;
  minSeverity: AuditSeverity;
}

export interface AuditQuery {
  type?: AuditEventType | AuditEventType[];
  severity?: AuditSeverity | AuditSeverity[];
  actorUsername?: string;
  actorId?: string;
  targetId?: string;
  startDate?: Date;
  endDate?: Date;
  search?: string;
  limit?: number;
  offset?: number;
}

const DEFAULT_CONFIG: AuditConfig = {
  logDir: './logs/audit',
  maxFileSize: 10 * 1024 * 1024, // 10MB
  maxFiles: 30,
  retentionDays: 90,
  logToConsole: false,
  logToFile: true,
  minSeverity: 'info',
};

const SEVERITY_ORDER: Record<AuditSeverity, number> = {
  info: 0,
  warning: 1,
  error: 2,
  critical: 3,
};

export class AuditLogger {
  private log = new Logger('AuditLogger');
  private config: AuditConfig;
  private currentFile: string | null = null;
  private writeStream: fs.WriteStream | null = null;
  private entryCount = 0;
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor(config: Partial<AuditConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.ensureLogDir();
    this.openLogFile();
    this.startCleanup();
    this.log.info('Audit Logger initialized');
  }

  /**
   * Log an audit event
   */
  async logEvent(
    type: AuditEventType,
    action: string,
    options: {
      severity?: AuditSeverity;
      actor?: AuditEntry['actor'];
      target?: AuditEntry['target'];
      details?: Record<string, any>;
      metadata?: AuditEntry['metadata'];
    } = {}
  ): Promise<AuditEntry> {
    const severity = options.severity || 'info';

    // Check minimum severity
    if (SEVERITY_ORDER[severity] < SEVERITY_ORDER[this.config.minSeverity]) {
      return {} as AuditEntry; // Skip logging
    }

    const entry: AuditEntry = {
      id: this.generateId(),
      timestamp: new Date().toISOString(),
      type,
      severity,
      action,
      actor: options.actor,
      target: options.target,
      details: options.details,
      metadata: options.metadata,
    };

    // Write to file
    if (this.config.logToFile) {
      await this.writeEntry(entry);
    }

    // Log to console
    if (this.config.logToConsole) {
      this.logToConsole(entry);
    }

    return entry;
  }

  /**
   * Log authentication event
   */
  async logAuth(
    action: 'login' | 'logout' | 'failed' | 'token_refresh',
    actor: AuditEntry['actor'],
    details?: Record<string, any>
  ): Promise<AuditEntry> {
    const typeMap: Record<string, AuditEventType> = {
      login: 'auth.login',
      logout: 'auth.logout',
      failed: 'auth.failed',
      token_refresh: 'auth.token_refresh',
    };

    return this.logEvent(typeMap[action], `User ${action}`, {
      severity: action === 'failed' ? 'warning' : 'info',
      actor,
      details,
    });
  }

  /**
   * Log user action
   */
  async logUserAction(
    action: 'created' | 'updated' | 'deleted' | 'banned' | 'unbanned' | 'timeout',
    actor: AuditEntry['actor'],
    target: AuditEntry['target'],
    details?: Record<string, any>
  ): Promise<AuditEntry> {
    const typeMap: Record<string, AuditEventType> = {
      created: 'user.created',
      updated: 'user.updated',
      deleted: 'user.deleted',
      banned: 'user.banned',
      unbanned: 'user.unbanned',
      timeout: 'user.timeout',
    };

    return this.logEvent(typeMap[action], `User ${action}`, {
      severity: ['banned', 'deleted'].includes(action) ? 'warning' : 'info',
      actor,
      target,
      details,
    });
  }

  /**
   * Log command execution
   */
  async logCommand(
    command: string,
    actor: AuditEntry['actor'],
    details?: Record<string, any>,
    metadata?: AuditEntry['metadata']
  ): Promise<AuditEntry> {
    return this.logEvent('command.executed', `Command executed: ${command}`, {
      severity: 'info',
      actor,
      details,
      metadata: { ...metadata, command },
    });
  }

  /**
   * Log settings change
   */
  async logSettingsChange(
    setting: string,
    oldValue: any,
    newValue: any,
    actor?: AuditEntry['actor']
  ): Promise<AuditEntry> {
    return this.logEvent('settings.changed', `Setting changed: ${setting}`, {
      severity: 'warning',
      actor,
      details: {
        setting,
        oldValue: this.sanitizeValue(oldValue),
        newValue: this.sanitizeValue(newValue),
      },
    });
  }

  /**
   * Log moderation action
   */
  async logModeration(
    action: string,
    actor: AuditEntry['actor'],
    target: AuditEntry['target'],
    reason?: string,
    duration?: number
  ): Promise<AuditEntry> {
    return this.logEvent('moderation.action', `Moderation: ${action}`, {
      severity: 'warning',
      actor,
      target,
      details: { reason, duration },
    });
  }

  /**
   * Log security event
   */
  async logSecurity(
    action: 'suspicious' | 'blocked' | 'rate_limited',
    details: Record<string, any>,
    actor?: AuditEntry['actor']
  ): Promise<AuditEntry> {
    const typeMap: Record<string, AuditEventType> = {
      suspicious: 'security.suspicious',
      blocked: 'security.blocked',
      rate_limited: 'security.rate_limited',
    };

    return this.logEvent(typeMap[action], `Security: ${action}`, {
      severity: action === 'suspicious' ? 'error' : 'warning',
      actor,
      details,
    });
  }

  /**
   * Log API request
   */
  async logApiRequest(
    method: string,
    path: string,
    statusCode: number,
    actor?: AuditEntry['actor'],
    duration?: number
  ): Promise<AuditEntry> {
    return this.logEvent('api.request', `${method} ${path} - ${statusCode}`, {
      severity: statusCode >= 400 ? 'warning' : 'info',
      actor,
      details: { method, path, statusCode, duration },
    });
  }

  /**
   * Log system event
   */
  async logSystem(
    action: 'startup' | 'shutdown' | 'error',
    details?: Record<string, any>
  ): Promise<AuditEntry> {
    const typeMap: Record<string, AuditEventType> = {
      startup: 'system.startup',
      shutdown: 'system.shutdown',
      error: 'system.error',
    };

    return this.logEvent(typeMap[action], `System ${action}`, {
      severity: action === 'error' ? 'error' : 'info',
      details,
    });
  }

  /**
   * Query audit logs
   */
  async query(query: AuditQuery): Promise<AuditEntry[]> {
    const results: AuditEntry[] = [];
    const files = this.getLogFiles();
    const limit = query.limit || 1000;
    const offset = query.offset || 0;

    let count = 0;
    let skipped = 0;

    for (const file of files) {
      if (results.length >= limit) break;

      const entries = await this.readLogFile(file);

      for (const entry of entries) {
        if (this.matchesQuery(entry, query)) {
          if (skipped < offset) {
            skipped++;
            continue;
          }

          results.push(entry);
          count++;

          if (count >= limit) break;
        }
      }
    }

    return results;
  }

  /**
   * Get recent entries
   */
  async getRecent(count: number = 100): Promise<AuditEntry[]> {
    return this.query({ limit: count });
  }

  /**
   * Get entries by type
   */
  async getByType(type: AuditEventType | AuditEventType[], limit: number = 100): Promise<AuditEntry[]> {
    return this.query({ type, limit });
  }

  /**
   * Get entries for user
   */
  async getForUser(username: string, limit: number = 100): Promise<AuditEntry[]> {
    return this.query({ actorUsername: username, limit });
  }

  /**
   * Export logs to JSON
   */
  async exportLogs(query: AuditQuery = {}): Promise<string> {
    const entries = await this.query({ ...query, limit: 10000 });
    return JSON.stringify(entries, null, 2);
  }

  /**
   * Get statistics
   */
  async getStats(): Promise<{
    totalEntries: number;
    byType: Record<string, number>;
    bySeverity: Record<string, number>;
    oldestEntry?: string;
    newestEntry?: string;
  }> {
    const entries = await this.query({ limit: 100000 });

    const byType: Record<string, number> = {};
    const bySeverity: Record<string, number> = {};
    let oldest: string | undefined;
    let newest: string | undefined;

    for (const entry of entries) {
      byType[entry.type] = (byType[entry.type] || 0) + 1;
      bySeverity[entry.severity] = (bySeverity[entry.severity] || 0) + 1;

      if (!oldest || entry.timestamp < oldest) oldest = entry.timestamp;
      if (!newest || entry.timestamp > newest) newest = entry.timestamp;
    }

    return {
      totalEntries: entries.length,
      byType,
      bySeverity,
      oldestEntry: oldest,
      newestEntry: newest,
    };
  }

  /**
   * Clean up old log files
   */
  async cleanup(): Promise<number> {
    const cutoff = Date.now() - this.config.retentionDays * 24 * 60 * 60 * 1000;
    const files = this.getLogFiles();
    let deleted = 0;

    // Sort by date (oldest first)
    const sortedFiles = files
      .map(file => {
        const stats = fs.statSync(path.join(this.config.logDir, file));
        return { file, mtime: stats.mtime.getTime() };
      })
      .sort((a, b) => a.mtime - b.mtime);

    // Delete files older than retention period
    for (const { file, mtime } of sortedFiles) {
      if (mtime < cutoff || sortedFiles.length - deleted > this.config.maxFiles) {
        try {
          fs.unlinkSync(path.join(this.config.logDir, file));
          deleted++;
          this.log.info(`Deleted old audit log: ${file}`);
        } catch (error) {
          this.log.error(`Failed to delete audit log ${file}: ${error}`);
        }
      }
    }

    return deleted;
  }

  /**
   * Destroy the logger
   */
  destroy(): void {
    if (this.writeStream) {
      this.writeStream.end();
      this.writeStream = null;
    }
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }

  // Private methods

  private ensureLogDir(): void {
    if (!fs.existsSync(this.config.logDir)) {
      fs.mkdirSync(this.config.logDir, { recursive: true });
    }
  }

  private openLogFile(): void {
    const date = new Date().toISOString().split('T')[0];
    this.currentFile = path.join(this.config.logDir, `audit-${date}.jsonl`);

    this.writeStream = fs.createWriteStream(this.currentFile, { flags: 'a' });
    this.writeStream.on('error', err => {
      this.log.error(`Write stream error: ${err}`);
    });
  }

  private async writeEntry(entry: AuditEntry): Promise<void> {
    // Check if we need to rotate
    if (this.currentFile && fs.existsSync(this.currentFile)) {
      const stats = fs.statSync(this.currentFile);
      if (stats.size >= this.config.maxFileSize) {
        await this.rotateLog();
      }
    }

    // Check if date changed
    const date = new Date().toISOString().split('T')[0];
    const expectedFile = path.join(this.config.logDir, `audit-${date}.jsonl`);
    if (this.currentFile !== expectedFile) {
      if (this.writeStream) {
        this.writeStream.end();
      }
      this.currentFile = expectedFile;
      this.openLogFile();
    }

    // Write entry
    if (this.writeStream) {
      this.writeStream.write(JSON.stringify(entry) + '\n');
      this.entryCount++;
    }
  }

  private async rotateLog(): Promise<void> {
    if (this.writeStream) {
      this.writeStream.end();
    }

    // Rename current file with timestamp
    if (this.currentFile && fs.existsSync(this.currentFile)) {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const rotatedFile = this.currentFile.replace('.jsonl', `-${timestamp}.jsonl`);
      fs.renameSync(this.currentFile, rotatedFile);
    }

    this.openLogFile();
  }

  private getLogFiles(): string[] {
    if (!fs.existsSync(this.config.logDir)) return [];

    return fs.readdirSync(this.config.logDir)
      .filter(f => f.startsWith('audit-') && f.endsWith('.jsonl'))
      .sort()
      .reverse(); // Newest first
  }

  private async readLogFile(filename: string): Promise<AuditEntry[]> {
    const filepath = path.join(this.config.logDir, filename);
    const entries: AuditEntry[] = [];

    try {
      const content = fs.readFileSync(filepath, 'utf-8');
      const lines = content.split('\n').filter(line => line.trim());

      for (const line of lines) {
        try {
          entries.push(JSON.parse(line));
        } catch {
          // Skip invalid lines
        }
      }
    } catch (error) {
      this.log.error(`Failed to read log file ${filename}: ${error}`);
    }

    return entries.reverse(); // Newest first
  }

  private matchesQuery(entry: AuditEntry, query: AuditQuery): boolean {
    // Type filter
    if (query.type) {
      const types = Array.isArray(query.type) ? query.type : [query.type];
      if (!types.includes(entry.type)) return false;
    }

    // Severity filter
    if (query.severity) {
      const severities = Array.isArray(query.severity) ? query.severity : [query.severity];
      if (!severities.includes(entry.severity)) return false;
    }

    // Actor filters
    if (query.actorUsername && entry.actor?.username !== query.actorUsername) return false;
    if (query.actorId && entry.actor?.id !== query.actorId) return false;

    // Target filter
    if (query.targetId && entry.target?.id !== query.targetId) return false;

    // Date filters
    const entryDate = new Date(entry.timestamp);
    if (query.startDate && entryDate < query.startDate) return false;
    if (query.endDate && entryDate > query.endDate) return false;

    // Search filter
    if (query.search) {
      const searchLower = query.search.toLowerCase();
      const searchStr = JSON.stringify(entry).toLowerCase();
      if (!searchStr.includes(searchLower)) return false;
    }

    return true;
  }

  private logToConsole(entry: AuditEntry): void {
    const severityColors: Record<AuditSeverity, string> = {
      info: '\x1b[36m',
      warning: '\x1b[33m',
      error: '\x1b[31m',
      critical: '\x1b[35m',
    };

    const color = severityColors[entry.severity];
    const reset = '\x1b[0m';

    console.log(
      `${color}[AUDIT]${reset} [${entry.timestamp}] ${entry.type}: ${entry.action}`,
      entry.actor ? `(actor: ${entry.actor.username || entry.actor.id})` : ''
    );
  }

  private sanitizeValue(value: any): any {
    if (typeof value === 'string' && value.length > 100) {
      return value.substring(0, 100) + '...';
    }
    return value;
  }

  private generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  private startCleanup(): void {
    // Run cleanup daily
    this.cleanupInterval = setInterval(() => {
      this.cleanup().catch(err => {
        this.log.error(`Cleanup failed: ${err}`);
      });
    }, 24 * 60 * 60 * 1000);

    // Initial cleanup
    this.cleanup().catch(() => {});
  }
}

// Singleton instance
let auditLoggerInstance: AuditLogger | null = null;

export function getAuditLogger(config?: Partial<AuditConfig>): AuditLogger {
  if (!auditLoggerInstance) {
    auditLoggerInstance = new AuditLogger(config);
  }
  return auditLoggerInstance;
}

export function createAuditLogger(config?: Partial<AuditConfig>): AuditLogger {
  return new AuditLogger(config);
}
