/**
 * Watchlist Plugin
 *
 * Features:
 * - User warning system
 * - Strike tracking
 * - Auto-actions on strike thresholds
 * - Watchlist management
 */

import { Plugin } from '../base/Plugin';
import { PluginMeta, Permission } from '../../types/plugins';
import { ChatMessageEvent } from '../../types/events';
import { getDatabase, DatabaseService } from '../../services/Database';

interface WatchedUser {
  username: string;
  strikes: number;
  reasons: string[];
  addedBy: string;
  addedAt: Date;
  lastStrike?: Date;
  notes?: string;
}

interface WatchlistSettings {
  enabled: boolean;
  autoTimeout: boolean;
  timeoutOnStrikes: number;
  timeoutDuration: number;
  autoBan: boolean;
  banOnStrikes: number;
  notifyMods: boolean;
}

const DEFAULT_SETTINGS: WatchlistSettings = {
  enabled: true,
  autoTimeout: true,
  timeoutOnStrikes: 3,
  timeoutDuration: 600,
  autoBan: false,
  banOnStrikes: 5,
  notifyMods: true,
};

export class WatchlistPlugin extends Plugin {
  meta: PluginMeta = {
    name: 'watchlist',
    version: '1.0.0',
    description: 'User warning and strike system',
    author: 'StreamCore',
  };

  private db!: DatabaseService;
  private settings: WatchlistSettings = DEFAULT_SETTINGS;
  private watchlist: Map<string, WatchedUser> = new Map();

  protected async init(): Promise<void> {
    this.db = getDatabase();
    this.log.info('Initializing Watchlist...');

    this.initTables();
    this.loadSettings();
    this.loadWatchlist();
    this.setupEventHandlers();
    this.registerCommands();

    this.log.info('Watchlist initialized!');
  }

  protected async destroy(): Promise<void> {}

  private initTables(): void {
    const db = this.db.raw();
    db.exec(`
      CREATE TABLE IF NOT EXISTS watchlist (
        username TEXT PRIMARY KEY,
        strikes INTEGER DEFAULT 0,
        reasons TEXT DEFAULT '[]',
        added_by TEXT NOT NULL,
        added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        last_strike DATETIME,
        notes TEXT
      );

      CREATE TABLE IF NOT EXISTS warnings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL,
        reason TEXT NOT NULL,
        issued_by TEXT NOT NULL,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);
  }

  private loadSettings(): void {
    const saved = this.db.getSetting<WatchlistSettings>('watchlist_settings');
    if (saved) {
      this.settings = { ...DEFAULT_SETTINGS, ...saved };
    }
  }

  private saveSettings(): void {
    this.db.setSetting('watchlist_settings', this.settings);
  }

  private loadWatchlist(): void {
    const db = this.db.raw();
    const stmt = db.prepare('SELECT * FROM watchlist');
    const rows = stmt.all() as any[];

    for (const row of rows) {
      this.watchlist.set(row.username.toLowerCase(), {
        username: row.username,
        strikes: row.strikes,
        reasons: JSON.parse(row.reasons || '[]'),
        addedBy: row.added_by,
        addedAt: new Date(row.added_at),
        lastStrike: row.last_strike ? new Date(row.last_strike) : undefined,
        notes: row.notes,
      });
    }

    this.log.info(`Loaded ${this.watchlist.size} watched users`);
  }

  private saveUser(user: WatchedUser): void {
    const db = this.db.raw();
    const stmt = db.prepare(`
      INSERT OR REPLACE INTO watchlist
      (username, strikes, reasons, added_by, added_at, last_strike, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      user.username.toLowerCase(),
      user.strikes,
      JSON.stringify(user.reasons),
      user.addedBy,
      user.addedAt.toISOString(),
      user.lastStrike?.toISOString(),
      user.notes
    );
  }

  private setupEventHandlers(): void {
    // Monitor watched users
    this.ctx.events.on('chat:message', (event: ChatMessageEvent) => {
      if (!this.settings.enabled) return;

      const username = event.user.username.toLowerCase();
      const watched = this.watchlist.get(username);

      if (watched && this.settings.notifyMods) {
        // Emit notification for mods
        this.ctx.events.emit('watchlist:activity', {
          user: event.user,
          strikes: watched.strikes,
          message: event.message,
        });
      }
    });
  }

  private registerCommands(): void {
    // !warn - Warn a user
    this.registerCommand({
      name: 'warn',
      aliases: ['warning', 'strike'],
      description: 'Issue a warning to a user',
      usage: '!warn <user> [reason]',
      permission: Permission.MODERATOR,
      cooldown: { user: 3, global: 0 },
      handler: async (ctx) => {
        if (ctx.args.length === 0) {
          ctx.reply('Verwendung: !warn <user> [grund]');
          return;
        }

        const username = ctx.args[0].toLowerCase().replace('@', '');
        const reason = ctx.args.slice(1).join(' ') || 'Keine Angabe';

        let user = this.watchlist.get(username);

        if (!user) {
          user = {
            username,
            strikes: 0,
            reasons: [],
            addedBy: ctx.user.username,
            addedAt: new Date(),
          };
          this.watchlist.set(username, user);
        }

        user.strikes++;
        user.reasons.push(`[${new Date().toISOString()}] ${reason} (by ${ctx.user.username})`);
        user.lastStrike = new Date();

        this.saveUser(user);
        this.logWarning(username, reason, ctx.user.username);

        ctx.reply(`⚠️ ${username} hat Strike ${user.strikes} erhalten: ${reason}`);

        // Check auto-actions
        if (this.settings.autoTimeout && user.strikes >= this.settings.timeoutOnStrikes) {
          if (user.strikes < this.settings.banOnStrikes || !this.settings.autoBan) {
            this.ctx.events.emit('watchlist:timeout', {
              username,
              duration: this.settings.timeoutDuration,
              reason: `${user.strikes} Strikes`,
            });
            ctx.reply(`⏰ ${username} wurde für ${this.settings.timeoutDuration}s getimeoutet (${user.strikes} Strikes)`);
          }
        }

        if (this.settings.autoBan && user.strikes >= this.settings.banOnStrikes) {
          this.ctx.events.emit('watchlist:ban', {
            username,
            reason: `${user.strikes} Strikes`,
          });
          ctx.reply(`🔨 ${username} wurde gebannt (${user.strikes} Strikes)`);
        }
      },
    });

    // !unwarn - Remove a strike
    this.registerCommand({
      name: 'unwarn',
      aliases: ['removestrike', 'forgive'],
      description: 'Remove a strike from a user',
      usage: '!unwarn <user>',
      permission: Permission.MODERATOR,
      cooldown: { user: 3, global: 0 },
      handler: async (ctx) => {
        if (ctx.args.length === 0) {
          ctx.reply('Verwendung: !unwarn <user>');
          return;
        }

        const username = ctx.args[0].toLowerCase().replace('@', '');
        const user = this.watchlist.get(username);

        if (!user || user.strikes === 0) {
          ctx.reply(`ℹ️ ${username} hat keine Strikes`);
          return;
        }

        user.strikes = Math.max(0, user.strikes - 1);
        this.saveUser(user);

        ctx.reply(`✅ Strike entfernt. ${username} hat jetzt ${user.strikes} Strike(s)`);
      },
    });

    // !strikes - Check strikes
    this.registerCommand({
      name: 'strikes',
      aliases: ['warnings', 'checkwarn'],
      description: 'Check user strikes',
      usage: '!strikes [user]',
      cooldown: { user: 10, global: 3 },
      handler: async (ctx) => {
        const username = (ctx.args[0] || ctx.user.username).toLowerCase().replace('@', '');

        // Only mods can check others
        if (username !== ctx.user.username.toLowerCase() && !ctx.user.isMod && !ctx.user.isBroadcaster) {
          ctx.reply('❌ Du kannst nur deine eigenen Strikes sehen');
          return;
        }

        const user = this.watchlist.get(username);

        if (!user || user.strikes === 0) {
          ctx.reply(`✅ ${username} hat keine Strikes`);
          return;
        }

        ctx.reply(`⚠️ ${username}: ${user.strikes} Strike(s)`);
      },
    });

    // !watchlist - View watchlist
    this.registerCommand({
      name: 'watchlist',
      aliases: ['wl'],
      description: 'View or manage watchlist',
      usage: '!watchlist [add|remove|list] [user]',
      permission: Permission.MODERATOR,
      cooldown: { user: 5, global: 0 },
      handler: async (ctx) => {
        const action = ctx.args[0]?.toLowerCase();

        if (!action || action === 'list') {
          if (this.watchlist.size === 0) {
            ctx.reply('📋 Watchlist ist leer');
            return;
          }

          const sorted = Array.from(this.watchlist.values())
            .sort((a, b) => b.strikes - a.strikes)
            .slice(0, 10);

          const list = sorted
            .map((u) => `${u.username} (${u.strikes})`)
            .join(', ');

          ctx.reply(`📋 Watchlist (${this.watchlist.size}): ${list}`);
          return;
        }

        const username = ctx.args[1]?.toLowerCase().replace('@', '');

        if (!username) {
          ctx.reply('❌ Bitte gib einen Benutzer an');
          return;
        }

        if (action === 'add') {
          if (this.watchlist.has(username)) {
            ctx.reply(`ℹ️ ${username} ist bereits auf der Watchlist`);
            return;
          }

          const user: WatchedUser = {
            username,
            strikes: 0,
            reasons: [],
            addedBy: ctx.user.username,
            addedAt: new Date(),
            notes: ctx.args.slice(2).join(' ') || undefined,
          };

          this.watchlist.set(username, user);
          this.saveUser(user);

          ctx.reply(`✅ ${username} zur Watchlist hinzugefügt`);
        } else if (action === 'remove') {
          if (!this.watchlist.has(username)) {
            ctx.reply(`ℹ️ ${username} ist nicht auf der Watchlist`);
            return;
          }

          this.watchlist.delete(username);
          const db = this.db.raw();
          db.prepare('DELETE FROM watchlist WHERE username = ?').run(username);

          ctx.reply(`✅ ${username} von Watchlist entfernt`);
        } else if (action === 'info') {
          const user = this.watchlist.get(username);

          if (!user) {
            ctx.reply(`ℹ️ ${username} ist nicht auf der Watchlist`);
            return;
          }

          const lastReason = user.reasons[user.reasons.length - 1] || 'Kein Grund';

          ctx.reply(
            `📋 ${username}: ${user.strikes} Strikes | ` +
            `Hinzugefügt: ${user.addedAt.toLocaleDateString('de-DE')} | ` +
            `Letzter Grund: ${lastReason.slice(0, 50)}`
          );
        }
      },
    });

    // !clearstrikes - Clear all strikes for a user
    this.registerCommand({
      name: 'clearstrikes',
      aliases: ['resetstrikes'],
      description: 'Clear all strikes for a user',
      usage: '!clearstrikes <user>',
      permission: Permission.MODERATOR,
      cooldown: { user: 5, global: 0 },
      handler: async (ctx) => {
        if (ctx.args.length === 0) {
          ctx.reply('Verwendung: !clearstrikes <user>');
          return;
        }

        const username = ctx.args[0].toLowerCase().replace('@', '');
        const user = this.watchlist.get(username);

        if (!user) {
          ctx.reply(`ℹ️ ${username} ist nicht auf der Watchlist`);
          return;
        }

        user.strikes = 0;
        user.reasons = [];
        this.saveUser(user);

        ctx.reply(`✅ Alle Strikes für ${username} gelöscht`);
      },
    });
  }

  private logWarning(username: string, reason: string, issuedBy: string): void {
    const db = this.db.raw();
    const stmt = db.prepare(`
      INSERT INTO warnings (username, reason, issued_by)
      VALUES (?, ?, ?)
    `);
    stmt.run(username, reason, issuedBy);
  }

  // Public API
  isWatched(username: string): boolean {
    return this.watchlist.has(username.toLowerCase());
  }

  getStrikes(username: string): number {
    return this.watchlist.get(username.toLowerCase())?.strikes || 0;
  }

  addStrike(username: string, reason: string, issuedBy: string = 'System'): void {
    let user = this.watchlist.get(username.toLowerCase());

    if (!user) {
      user = {
        username: username.toLowerCase(),
        strikes: 0,
        reasons: [],
        addedBy: issuedBy,
        addedAt: new Date(),
      };
      this.watchlist.set(username.toLowerCase(), user);
    }

    user.strikes++;
    user.reasons.push(`[${new Date().toISOString()}] ${reason} (by ${issuedBy})`);
    user.lastStrike = new Date();

    this.saveUser(user);
  }
}
