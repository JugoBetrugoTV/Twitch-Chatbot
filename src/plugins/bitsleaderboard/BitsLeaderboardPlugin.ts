/**
 * Bits Leaderboard Plugin
 *
 * Features:
 * - Track bits cheered
 * - Daily/Weekly/Monthly/All-time leaderboards
 * - Top cheerer announcements
 * - Milestone alerts
 */

import { Plugin } from '../base/Plugin';
import { PluginMeta, Permission } from '../../types/plugins';
import { getDatabase, DatabaseService } from '../../services/Database';

interface CheerRecord {
  username: string;
  displayName: string;
  totalBits: number;
  cheerCount: number;
  lastCheer: Date;
  highestCheer: number;
}

interface BitsSettings {
  enabled: boolean;
  announceTopCheerer: boolean;
  milestoneAlerts: boolean;
  milestones: number[];
  showLeaderboardSize: number;
}

const DEFAULT_SETTINGS: BitsSettings = {
  enabled: true,
  announceTopCheerer: true,
  milestoneAlerts: true,
  milestones: [100, 500, 1000, 5000, 10000, 50000, 100000],
  showLeaderboardSize: 10,
};

export class BitsLeaderboardPlugin extends Plugin {
  meta: PluginMeta = {
    name: 'bitsleaderboard',
    version: '1.0.0',
    description: 'Track and display bits leaderboard',
    author: 'StreamCore',
  };

  private db!: DatabaseService;
  private settings: BitsSettings = DEFAULT_SETTINGS;
  private cheerCache: Map<string, CheerRecord> = new Map();

  protected async init(): Promise<void> {
    this.db = getDatabase();
    this.log.info('Initializing Bits Leaderboard...');

    this.initTables();
    this.loadSettings();
    this.loadCache();
    this.setupEventHandlers();
    this.registerCommands();

    this.log.info('Bits Leaderboard initialized!');
  }

  protected async destroy(): Promise<void> {}

  private initTables(): void {
    const db = this.db.raw();
    db.exec(`
      CREATE TABLE IF NOT EXISTS bits_leaderboard (
        username TEXT PRIMARY KEY,
        display_name TEXT NOT NULL,
        total_bits INTEGER DEFAULT 0,
        cheer_count INTEGER DEFAULT 0,
        last_cheer DATETIME,
        highest_cheer INTEGER DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS bits_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL,
        bits INTEGER NOT NULL,
        message TEXT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_bits_history_user ON bits_history(username);
      CREATE INDEX IF NOT EXISTS idx_bits_history_time ON bits_history(timestamp);
    `);
  }

  private loadSettings(): void {
    const saved = this.db.getSetting<BitsSettings>('bits_settings');
    if (saved) {
      this.settings = { ...DEFAULT_SETTINGS, ...saved };
    }
  }

  private saveSettings(): void {
    this.db.setSetting('bits_settings', this.settings);
  }

  private loadCache(): void {
    const db = this.db.raw();
    const stmt = db.prepare('SELECT * FROM bits_leaderboard ORDER BY total_bits DESC LIMIT 100');
    const rows = stmt.all() as any[];

    for (const row of rows) {
      this.cheerCache.set(row.username.toLowerCase(), {
        username: row.username,
        displayName: row.display_name,
        totalBits: row.total_bits,
        cheerCount: row.cheer_count,
        lastCheer: new Date(row.last_cheer),
        highestCheer: row.highest_cheer,
      });
    }

    this.log.info(`Loaded ${this.cheerCache.size} cheerers into cache`);
  }

  private setupEventHandlers(): void {
    this.ctx.events.on('twitch:cheer', (event: any) => {
      if (!this.settings.enabled) return;

      const username = event.user.username.toLowerCase();
      const bits = event.bits;

      // Update or create record
      let record = this.cheerCache.get(username);

      if (!record) {
        record = {
          username: event.user.username,
          displayName: event.user.displayName || event.user.username,
          totalBits: 0,
          cheerCount: 0,
          lastCheer: new Date(),
          highestCheer: 0,
        };
      }

      const previousTotal = record.totalBits;
      record.totalBits += bits;
      record.cheerCount++;
      record.lastCheer = new Date();
      record.highestCheer = Math.max(record.highestCheer, bits);

      this.cheerCache.set(username, record);
      this.saveCheerRecord(record);
      this.logCheer(username, bits, event.message);

      // Check milestones
      if (this.settings.milestoneAlerts) {
        this.checkMilestones(record.displayName, previousTotal, record.totalBits);
      }
    });
  }

  private saveCheerRecord(record: CheerRecord): void {
    const db = this.db.raw();
    const stmt = db.prepare(`
      INSERT OR REPLACE INTO bits_leaderboard
      (username, display_name, total_bits, cheer_count, last_cheer, highest_cheer)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      record.username.toLowerCase(),
      record.displayName,
      record.totalBits,
      record.cheerCount,
      record.lastCheer.toISOString(),
      record.highestCheer
    );
  }

  private logCheer(username: string, bits: number, message?: string): void {
    const db = this.db.raw();
    const stmt = db.prepare(`
      INSERT INTO bits_history (username, bits, message)
      VALUES (?, ?, ?)
    `);
    stmt.run(username.toLowerCase(), bits, message || null);
  }

  private checkMilestones(displayName: string, previousTotal: number, newTotal: number): void {
    for (const milestone of this.settings.milestones) {
      if (previousTotal < milestone && newTotal >= milestone) {
        this.ctx.events.emit('bits:milestone', {
          username: displayName,
          milestone,
          total: newTotal,
        });

        this.ctx.chat.send(
          `🎉 ${displayName} hat den ${this.formatBits(milestone)} Bits Meilenstein erreicht! ` +
          `Insgesamt: ${this.formatBits(newTotal)} Bits!`
        );
      }
    }
  }

  private formatBits(bits: number): string {
    if (bits >= 1000000) return `${(bits / 1000000).toFixed(1)}M`;
    if (bits >= 1000) return `${(bits / 1000).toFixed(1)}K`;
    return bits.toString();
  }

  private registerCommands(): void {
    // !bits - Check bits stats
    this.registerCommand({
      name: 'bits',
      aliases: ['mybits', 'cheers'],
      description: 'Check your bits stats',
      usage: '!bits [user]',
      cooldown: { user: 10, global: 3 },
      handler: async (ctx) => {
        const targetName = ctx.args[0]?.toLowerCase().replace('@', '') || ctx.user.username.toLowerCase();

        // Only mods can check others
        if (targetName !== ctx.user.username.toLowerCase() && !ctx.user.isMod && !ctx.user.isBroadcaster) {
          ctx.reply('❌ Du kannst nur deine eigenen Bits-Stats sehen');
          return;
        }

        const record = this.cheerCache.get(targetName);

        if (!record || record.totalBits === 0) {
          ctx.reply(`💎 ${targetName} hat noch keine Bits gecheerrt`);
          return;
        }

        const rank = this.getRank(targetName);

        ctx.reply(
          `💎 ${record.displayName}: ${this.formatBits(record.totalBits)} Bits | ` +
          `${record.cheerCount} Cheers | Rekord: ${this.formatBits(record.highestCheer)} | ` +
          `Rang: #${rank}`
        );
      },
    });

    // !bitsboard - Show bits leaderboard
    this.registerCommand({
      name: 'bitsboard',
      aliases: ['bitleaderboard', 'bitslb', 'topbits'],
      description: 'Show bits leaderboard',
      usage: '!bitsboard [daily|weekly|monthly|all]',
      cooldown: { user: 15, global: 5 },
      handler: async (ctx) => {
        const period = ctx.args[0]?.toLowerCase() || 'all';
        const leaderboard = this.getLeaderboard(period);

        if (leaderboard.length === 0) {
          ctx.reply('💎 Noch keine Bits gecheerrt!');
          return;
        }

        const periodName = {
          daily: 'Heute',
          weekly: 'Diese Woche',
          monthly: 'Dieser Monat',
          all: 'Gesamt',
        }[period] || 'Gesamt';

        const list = leaderboard
          .slice(0, 5)
          .map((r, i) => `${i + 1}. ${r.displayName} (${this.formatBits(r.totalBits)})`)
          .join(' | ');

        ctx.reply(`💎 Bits Leaderboard (${periodName}): ${list}`);
      },
    });

    // !bitsrank - Check your rank
    this.registerCommand({
      name: 'bitsrank',
      description: 'Check your bits rank',
      cooldown: { user: 10, global: 3 },
      handler: async (ctx) => {
        const username = ctx.user.username.toLowerCase();
        const record = this.cheerCache.get(username);

        if (!record || record.totalBits === 0) {
          ctx.reply('💎 Du hast noch keine Bits gecheerrt');
          return;
        }

        const rank = this.getRank(username);
        const total = this.cheerCache.size;

        ctx.reply(`💎 Dein Rang: #${rank} von ${total} | ${this.formatBits(record.totalBits)} Bits`);
      },
    });

    // !topcheer - Show top single cheer
    this.registerCommand({
      name: 'topcheer',
      aliases: ['biggestcheer'],
      description: 'Show biggest single cheer',
      cooldown: { user: 15, global: 5 },
      handler: async (ctx) => {
        const db = this.db.raw();
        const stmt = db.prepare(`
          SELECT username, bits, timestamp
          FROM bits_history
          ORDER BY bits DESC
          LIMIT 1
        `);
        const row = stmt.get() as any;

        if (!row) {
          ctx.reply('💎 Noch keine Cheers aufgezeichnet');
          return;
        }

        const record = this.cheerCache.get(row.username);
        const displayName = record?.displayName || row.username;

        ctx.reply(`🏆 Größter Einzelcheer: ${displayName} mit ${this.formatBits(row.bits)} Bits!`);
      },
    });

    // !bitsstats - Show overall bits stats (mod)
    this.registerCommand({
      name: 'bitsstats',
      description: 'Show overall bits statistics',
      permission: Permission.MODERATOR,
      cooldown: { user: 30, global: 10 },
      handler: async (ctx) => {
        const db = this.db.raw();

        const totalBits = db.prepare('SELECT SUM(total_bits) as total FROM bits_leaderboard').get() as any;
        const totalCheers = db.prepare('SELECT SUM(cheer_count) as total FROM bits_leaderboard').get() as any;
        const uniqueCheeers = this.cheerCache.size;

        ctx.reply(
          `📊 Bits Stats: ${this.formatBits(totalBits?.total || 0)} Bits total | ` +
          `${totalCheers?.total || 0} Cheers | ${uniqueCheeers} Cheerer`
        );
      },
    });
  }

  private getLeaderboard(period: string): CheerRecord[] {
    if (period === 'all') {
      return Array.from(this.cheerCache.values())
        .sort((a, b) => b.totalBits - a.totalBits);
    }

    // For time-based leaderboards, query the database
    const db = this.db.raw();
    let timeFilter: string;

    switch (period) {
      case 'daily':
        timeFilter = "datetime('now', '-1 day')";
        break;
      case 'weekly':
        timeFilter = "datetime('now', '-7 days')";
        break;
      case 'monthly':
        timeFilter = "datetime('now', '-30 days')";
        break;
      default:
        return Array.from(this.cheerCache.values()).sort((a, b) => b.totalBits - a.totalBits);
    }

    const stmt = db.prepare(`
      SELECT username, SUM(bits) as total_bits, COUNT(*) as cheer_count
      FROM bits_history
      WHERE timestamp > ${timeFilter}
      GROUP BY username
      ORDER BY total_bits DESC
      LIMIT ?
    `);

    const rows = stmt.all(this.settings.showLeaderboardSize) as any[];

    return rows.map((row) => {
      const cached = this.cheerCache.get(row.username);
      return {
        username: row.username,
        displayName: cached?.displayName || row.username,
        totalBits: row.total_bits,
        cheerCount: row.cheer_count,
        lastCheer: cached?.lastCheer || new Date(),
        highestCheer: cached?.highestCheer || 0,
      };
    });
  }

  private getRank(username: string): number {
    const sorted = Array.from(this.cheerCache.entries())
      .sort((a, b) => b[1].totalBits - a[1].totalBits);

    const index = sorted.findIndex(([name]) => name === username.toLowerCase());
    return index + 1;
  }

  // Public API
  getTotalBits(username: string): number {
    return this.cheerCache.get(username.toLowerCase())?.totalBits || 0;
  }

  getTopCheeers(limit: number = 10): CheerRecord[] {
    return Array.from(this.cheerCache.values())
      .sort((a, b) => b.totalBits - a.totalBits)
      .slice(0, limit);
  }
}
