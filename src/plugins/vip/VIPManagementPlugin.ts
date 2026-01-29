/**
 * VIP Management Plugin
 *
 * Features:
 * - Auto-VIP based on points
 * - Temporary VIP rewards
 * - VIP tracking
 * - VIP commands
 */

import { Plugin } from '../base/Plugin';
import { PluginMeta, Permission } from '../../types/plugins';
import { getDatabase, DatabaseService } from '../../services/Database';

interface VIPSettings {
  enabled: boolean;
  autoVipEnabled: boolean;
  autoVipThreshold: number; // Points needed for auto-VIP
  autoVipCheckInterval: number; // Minutes
  tempVipDuration: number; // Default temp VIP duration in hours
}

interface TempVIP {
  username: string;
  grantedBy: string;
  expiresAt: Date;
  reason?: string;
}

const DEFAULT_SETTINGS: VIPSettings = {
  enabled: true,
  autoVipEnabled: false,
  autoVipThreshold: 50000,
  autoVipCheckInterval: 30,
  tempVipDuration: 24,
};

export class VIPManagementPlugin extends Plugin {
  meta: PluginMeta = {
    name: 'vipmanagement',
    version: '1.0.0',
    description: 'VIP management and auto-VIP system',
    author: 'StreamCore',
  };

  private db!: DatabaseService;
  private settings: VIPSettings = DEFAULT_SETTINGS;
  private tempVips: Map<string, TempVIP> = new Map();
  private checkInterval?: NodeJS.Timeout;

  protected async init(): Promise<void> {
    this.db = getDatabase();
    this.log.info('Initializing VIP Management...');

    this.initTables();
    this.loadSettings();
    this.loadTempVips();
    this.registerCommands();
    this.startAutoVipCheck();

    // Listen for shop VIP purchases
    this.ctx.events.on('shop:vip', (event: any) => {
      this.grantTempVip(event.username, 'Shop', event.duration / 3600000);
    });

    this.log.info('VIP Management initialized!');
  }

  protected async destroy(): Promise<void> {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
    }
  }

  private initTables(): void {
    const db = this.db.raw();
    db.exec(`
      CREATE TABLE IF NOT EXISTS temp_vips (
        username TEXT PRIMARY KEY,
        granted_by TEXT NOT NULL,
        expires_at DATETIME NOT NULL,
        reason TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS vip_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL,
        action TEXT NOT NULL,
        granted_by TEXT,
        reason TEXT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);
  }

  private loadSettings(): void {
    const saved = this.db.getSetting<VIPSettings>('vip_settings');
    if (saved) {
      this.settings = { ...DEFAULT_SETTINGS, ...saved };
    }
  }

  private saveSettings(): void {
    this.db.setSetting('vip_settings', this.settings);
  }

  private loadTempVips(): void {
    const db = this.db.raw();
    const stmt = db.prepare('SELECT * FROM temp_vips WHERE expires_at > datetime("now")');
    const rows = stmt.all() as any[];

    for (const row of rows) {
      this.tempVips.set(row.username.toLowerCase(), {
        username: row.username,
        grantedBy: row.granted_by,
        expiresAt: new Date(row.expires_at),
        reason: row.reason,
      });
    }

    this.log.info(`Loaded ${this.tempVips.size} temporary VIPs`);
  }

  private startAutoVipCheck(): void {
    // Check for auto-VIP and expired temp VIPs
    this.checkInterval = setInterval(() => {
      this.checkExpiredVips();
      if (this.settings.autoVipEnabled) {
        this.checkAutoVip();
      }
    }, this.settings.autoVipCheckInterval * 60000);

    // Initial check
    setTimeout(() => {
      this.checkExpiredVips();
    }, 10000);
  }

  private checkExpiredVips(): void {
    const now = new Date();

    for (const [username, vip] of this.tempVips.entries()) {
      if (now >= vip.expiresAt) {
        this.tempVips.delete(username);
        this.removeFromDatabase(username);
        this.logAction(username, 'temp_expired', 'System');

        // Emit event for external handling (Twitch API)
        this.ctx.events.emit('vip:expired', { username });

        this.log.info(`Temp VIP expired: ${username}`);
      }
    }
  }

  private checkAutoVip(): void {
    const topUsers = this.db.getTopUsers(20, 'points');

    for (const user of topUsers) {
      if (user.points >= this.settings.autoVipThreshold) {
        // Check if not already VIP
        const existingVip = this.tempVips.get(user.username.toLowerCase());
        if (!existingVip) {
          // Emit event for potential VIP grant
          this.ctx.events.emit('vip:autoQualified', {
            username: user.username,
            points: user.points,
          });
        }
      }
    }
  }

  private grantTempVip(username: string, grantedBy: string, hours: number, reason?: string): void {
    const lowerUsername = username.toLowerCase();
    const expiresAt = new Date(Date.now() + hours * 3600000);

    const vip: TempVIP = {
      username,
      grantedBy,
      expiresAt,
      reason,
    };

    this.tempVips.set(lowerUsername, vip);
    this.saveToDatabase(vip);
    this.logAction(username, 'temp_granted', grantedBy, reason);

    // Emit event for external handling
    this.ctx.events.emit('vip:granted', {
      username,
      duration: hours * 3600000,
      grantedBy,
    });
  }

  private saveToDatabase(vip: TempVIP): void {
    const db = this.db.raw();
    const stmt = db.prepare(`
      INSERT OR REPLACE INTO temp_vips (username, granted_by, expires_at, reason)
      VALUES (?, ?, ?, ?)
    `);
    stmt.run(vip.username.toLowerCase(), vip.grantedBy, vip.expiresAt.toISOString(), vip.reason);
  }

  private removeFromDatabase(username: string): void {
    const db = this.db.raw();
    db.prepare('DELETE FROM temp_vips WHERE username = ?').run(username.toLowerCase());
  }

  private logAction(username: string, action: string, grantedBy: string, reason?: string): void {
    const db = this.db.raw();
    const stmt = db.prepare(`
      INSERT INTO vip_history (username, action, granted_by, reason)
      VALUES (?, ?, ?, ?)
    `);
    stmt.run(username.toLowerCase(), action, grantedBy, reason);
  }

  private registerCommands(): void {
    // !vip - Grant temp VIP (mod)
    this.registerCommand({
      name: 'vip',
      aliases: ['tempvip', 'givevip'],
      description: 'Grant temporary VIP status',
      usage: '!vip <user> [hours] [reason]',
      permission: Permission.MODERATOR,
      cooldown: { user: 5, global: 0 },
      handler: async (ctx) => {
        if (ctx.args.length === 0) {
          ctx.reply('Verwendung: !vip <user> [stunden] [grund]');
          return;
        }

        const username = ctx.args[0].replace('@', '').toLowerCase();
        const hours = parseInt(ctx.args[1]) || this.settings.tempVipDuration;
        const reason = ctx.args.slice(2).join(' ') || undefined;

        this.grantTempVip(username, ctx.user.username, hours, reason);

        ctx.reply(`⭐ ${username} ist jetzt VIP für ${hours} Stunden!`);
      },
    });

    // !unvip - Remove temp VIP (mod)
    this.registerCommand({
      name: 'unvip',
      aliases: ['removevip'],
      description: 'Remove temporary VIP status',
      usage: '!unvip <user>',
      permission: Permission.MODERATOR,
      cooldown: { user: 5, global: 0 },
      handler: async (ctx) => {
        if (ctx.args.length === 0) {
          ctx.reply('Verwendung: !unvip <user>');
          return;
        }

        const username = ctx.args[0].replace('@', '').toLowerCase();

        if (this.tempVips.has(username)) {
          this.tempVips.delete(username);
          this.removeFromDatabase(username);
          this.logAction(username, 'removed', ctx.user.username);

          this.ctx.events.emit('vip:removed', { username, removedBy: ctx.user.username });

          ctx.reply(`❌ ${username} ist kein VIP mehr`);
        } else {
          ctx.reply(`ℹ️ ${username} hat keinen temporären VIP-Status`);
        }
      },
    });

    // !viplist - List temp VIPs (mod)
    this.registerCommand({
      name: 'viplist',
      aliases: ['tempvips'],
      description: 'List temporary VIPs',
      permission: Permission.MODERATOR,
      cooldown: { user: 30, global: 10 },
      handler: async (ctx) => {
        if (this.tempVips.size === 0) {
          ctx.reply('⭐ Keine temporären VIPs');
          return;
        }

        const list = Array.from(this.tempVips.values())
          .slice(0, 10)
          .map((v) => {
            const remaining = Math.ceil((v.expiresAt.getTime() - Date.now()) / 3600000);
            return `${v.username} (${remaining}h)`;
          })
          .join(', ');

        ctx.reply(`⭐ Temp VIPs (${this.tempVips.size}): ${list}`);
      },
    });

    // !vipcheck - Check VIP status
    this.registerCommand({
      name: 'vipcheck',
      aliases: ['myvip', 'vipstatus'],
      description: 'Check your VIP status',
      cooldown: { user: 30, global: 0 },
      handler: async (ctx) => {
        const username = (ctx.args[0] || ctx.user.username).toLowerCase().replace('@', '');
        const vip = this.tempVips.get(username);

        if (vip) {
          const remaining = Math.ceil((vip.expiresAt.getTime() - Date.now()) / 3600000);
          ctx.reply(`⭐ ${username} ist VIP für noch ${remaining} Stunden`);
        } else {
          ctx.reply(`ℹ️ ${username} hat keinen temporären VIP-Status`);
        }
      },
    });

    // !autovip - Configure auto-VIP (broadcaster)
    this.registerCommand({
      name: 'autovip',
      description: 'Configure auto-VIP system',
      usage: '!autovip <on|off|threshold> [value]',
      permission: Permission.BROADCASTER,
      cooldown: { user: 5, global: 0 },
      handler: async (ctx) => {
        const action = ctx.args[0]?.toLowerCase();

        if (!action || action === 'status') {
          ctx.reply(
            `⭐ Auto-VIP: ${this.settings.autoVipEnabled ? 'An' : 'Aus'} | ` +
            `Threshold: ${this.settings.autoVipThreshold.toLocaleString()} Punkte`
          );
          return;
        }

        switch (action) {
          case 'on':
            this.settings.autoVipEnabled = true;
            this.saveSettings();
            ctx.reply('✅ Auto-VIP aktiviert');
            break;

          case 'off':
            this.settings.autoVipEnabled = false;
            this.saveSettings();
            ctx.reply('❌ Auto-VIP deaktiviert');
            break;

          case 'threshold':
            const threshold = parseInt(ctx.args[1]);
            if (isNaN(threshold) || threshold < 1000) {
              ctx.reply('❌ Threshold muss mindestens 1000 sein');
              return;
            }
            this.settings.autoVipThreshold = threshold;
            this.saveSettings();
            ctx.reply(`✅ Auto-VIP Threshold: ${threshold.toLocaleString()} Punkte`);
            break;

          default:
            ctx.reply('Verwendung: !autovip <on|off|threshold> [wert]');
        }
      },
    });

    // !viphistory - Show VIP history (mod)
    this.registerCommand({
      name: 'viphistory',
      description: 'Show VIP history for a user',
      usage: '!viphistory <user>',
      permission: Permission.MODERATOR,
      cooldown: { user: 30, global: 10 },
      handler: async (ctx) => {
        if (ctx.args.length === 0) {
          ctx.reply('Verwendung: !viphistory <user>');
          return;
        }

        const username = ctx.args[0].toLowerCase().replace('@', '');
        const db = this.db.raw();
        const stmt = db.prepare(`
          SELECT action, granted_by, timestamp FROM vip_history
          WHERE username = ? ORDER BY timestamp DESC LIMIT 5
        `);
        const rows = stmt.all(username) as any[];

        if (rows.length === 0) {
          ctx.reply(`ℹ️ Keine VIP-Historie für ${username}`);
          return;
        }

        const history = rows
          .map((r) => `${r.action} (${r.granted_by})`)
          .join(', ');

        ctx.reply(`⭐ ${username}: ${history}`);
      },
    });
  }

  // Public API
  isTempVip(username: string): boolean {
    const vip = this.tempVips.get(username.toLowerCase());
    return vip !== undefined && vip.expiresAt > new Date();
  }

  getTempVips(): TempVIP[] {
    return Array.from(this.tempVips.values());
  }

  grantVip(username: string, hours: number, grantedBy: string = 'System'): void {
    this.grantTempVip(username, grantedBy, hours);
  }
}
