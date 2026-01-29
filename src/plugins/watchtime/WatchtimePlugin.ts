/**
 * Watchtime Plugin
 *
 * Track viewer watch time accurately
 * Features:
 * - Track time when stream is live
 * - Periodic updates
 * - Watchtime leaderboard
 * - Milestones and rewards
 */

import { Plugin } from '../base/Plugin';
import { PluginMeta, Permission } from '../../types/plugins';
import { getDatabase, DatabaseService } from '../../services/Database';

interface WatchtimeSettings {
  enabled: boolean;
  updateIntervalMinutes: number;
  trackOffline: boolean;
  milestones: WatchtimeMilestone[];
  announceMilestones: boolean;
}

interface WatchtimeMilestone {
  hours: number;
  reward: number;
  message: string;
}

interface ActiveViewer {
  username: string;
  joinedAt: Date;
  lastUpdate: Date;
}

const DEFAULT_SETTINGS: WatchtimeSettings = {
  enabled: true,
  updateIntervalMinutes: 5,
  trackOffline: false,
  milestones: [
    { hours: 1, reward: 100, message: '🎉 {user} hat 1 Stunde Watchtime erreicht!' },
    { hours: 10, reward: 500, message: '🌟 {user} hat 10 Stunden Watchtime erreicht!' },
    { hours: 50, reward: 2500, message: '💫 {user} hat 50 Stunden Watchtime erreicht!' },
    { hours: 100, reward: 5000, message: '🏆 {user} hat 100 Stunden Watchtime erreicht!' },
  ],
  announceMilestones: true,
};

export class WatchtimePlugin extends Plugin {
  meta: PluginMeta = {
    name: 'watchtime',
    version: '1.0.0',
    description: 'Track viewer watch time',
    author: 'StreamCore',
  };

  private db!: DatabaseService;
  private settings: WatchtimeSettings = DEFAULT_SETTINGS;
  private activeViewers: Map<string, ActiveViewer> = new Map();
  private isStreamLive = false;
  private updateInterval?: NodeJS.Timeout;
  private achievedMilestones: Map<string, Set<number>> = new Map();

  protected async init(): Promise<void> {
    this.db = getDatabase();
    this.log.info('Initializing Watchtime...');

    this.initTables();
    this.loadSettings();
    this.loadMilestones();
    this.setupEventHandlers();
    this.registerCommands();
    this.startTracking();

    this.log.info('Watchtime initialized!');
  }

  protected async destroy(): Promise<void> {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
    }
    // Save all active watchtime before shutdown
    this.updateAllWatchtime();
  }

  private initTables(): void {
    const db = this.db.raw();
    db.exec(`
      CREATE TABLE IF NOT EXISTS watchtime_milestones (
        username TEXT NOT NULL,
        hours INTEGER NOT NULL,
        achieved_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (username, hours)
      );

      CREATE TABLE IF NOT EXISTS watchtime_sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL,
        started_at DATETIME NOT NULL,
        ended_at DATETIME,
        duration_minutes INTEGER DEFAULT 0
      );

      CREATE INDEX IF NOT EXISTS idx_watchtime_sessions_user ON watchtime_sessions(username);
    `);
  }

  private loadSettings(): void {
    const saved = this.db.getSetting<WatchtimeSettings>('watchtime_settings');
    if (saved) {
      this.settings = { ...DEFAULT_SETTINGS, ...saved };
    }
  }

  private saveSettings(): void {
    this.db.setSetting('watchtime_settings', this.settings);
  }

  private loadMilestones(): void {
    const db = this.db.raw();
    const rows = db.prepare('SELECT username, hours FROM watchtime_milestones').all() as any[];

    for (const row of rows) {
      if (!this.achievedMilestones.has(row.username)) {
        this.achievedMilestones.set(row.username, new Set());
      }
      this.achievedMilestones.get(row.username)!.add(row.hours);
    }
  }

  private setupEventHandlers(): void {
    // Track stream status
    this.ctx.events.on('twitch:stream:online', () => {
      this.isStreamLive = true;
      this.log.info('Stream went online - tracking watchtime');
    });

    this.ctx.events.on('twitch:stream:offline', () => {
      this.isStreamLive = false;
      this.updateAllWatchtime();
      this.activeViewers.clear();
      this.log.info('Stream went offline - saved watchtime');
    });

    // Track user activity
    this.ctx.events.on('chat:message', (event: any) => {
      this.trackViewer(event.user.username);
    });

    this.ctx.events.on('chat:join', (event: any) => {
      if (event.username) {
        this.trackViewer(event.username);
      }
    });

    this.ctx.events.on('chat:part', (event: any) => {
      if (event.username) {
        this.saveViewerWatchtime(event.username);
        this.activeViewers.delete(event.username.toLowerCase());
      }
    });
  }

  private startTracking(): void {
    // Update watchtime periodically
    this.updateInterval = setInterval(() => {
      if (this.isStreamLive || this.settings.trackOffline) {
        this.updateAllWatchtime();
      }
    }, this.settings.updateIntervalMinutes * 60 * 1000);
  }

  private trackViewer(username: string): void {
    const key = username.toLowerCase();

    if (!this.activeViewers.has(key)) {
      this.activeViewers.set(key, {
        username,
        joinedAt: new Date(),
        lastUpdate: new Date(),
      });
    } else {
      // Update last activity
      const viewer = this.activeViewers.get(key)!;
      viewer.lastUpdate = new Date();
    }
  }

  private saveViewerWatchtime(username: string): void {
    const key = username.toLowerCase();
    const viewer = this.activeViewers.get(key);

    if (!viewer) return;

    const now = new Date();
    const minutes = Math.floor((now.getTime() - viewer.joinedAt.getTime()) / 60000);

    if (minutes > 0) {
      // Update user's total watchtime
      const user = this.db.getUser('twitch', username);
      if (user) {
        const newWatchtime = (user.watch_time || 0) + minutes;
        this.db.raw().prepare('UPDATE users SET watch_time = ? WHERE platform = ? AND username = ?')
          .run(newWatchtime, 'twitch', username.toLowerCase());

        // Check milestones
        this.checkMilestones(username, newWatchtime);
      }

      // Log session
      const db = this.db.raw();
      db.prepare(`
        INSERT INTO watchtime_sessions (username, started_at, ended_at, duration_minutes)
        VALUES (?, ?, ?, ?)
      `).run(username.toLowerCase(), viewer.joinedAt.toISOString(), now.toISOString(), minutes);
    }
  }

  private updateAllWatchtime(): void {
    const now = new Date();

    for (const [key, viewer] of this.activeViewers) {
      // Only update if viewer was active in the last update interval
      const inactiveMinutes = (now.getTime() - viewer.lastUpdate.getTime()) / 60000;

      if (inactiveMinutes < this.settings.updateIntervalMinutes * 2) {
        const minutes = Math.floor((now.getTime() - viewer.joinedAt.getTime()) / 60000);

        if (minutes > 0) {
          const user = this.db.getUser('twitch', viewer.username);
          if (user) {
            const newWatchtime = (user.watch_time || 0) + this.settings.updateIntervalMinutes;
            this.db.raw().prepare('UPDATE users SET watch_time = ? WHERE platform = ? AND username = ?')
              .run(newWatchtime, 'twitch', viewer.username.toLowerCase());

            this.checkMilestones(viewer.username, newWatchtime);
          }
        }

        // Reset join time for next interval
        viewer.joinedAt = now;
      }
    }
  }

  private checkMilestones(username: string, totalMinutes: number): void {
    const hours = Math.floor(totalMinutes / 60);
    const userMilestones = this.achievedMilestones.get(username.toLowerCase()) || new Set();

    for (const milestone of this.settings.milestones) {
      if (hours >= milestone.hours && !userMilestones.has(milestone.hours)) {
        // New milestone achieved!
        userMilestones.add(milestone.hours);
        this.achievedMilestones.set(username.toLowerCase(), userMilestones);

        // Save to database
        const db = this.db.raw();
        db.prepare('INSERT OR IGNORE INTO watchtime_milestones (username, hours) VALUES (?, ?)')
          .run(username.toLowerCase(), milestone.hours);

        // Award points
        if (milestone.reward > 0) {
          this.db.updateUserPoints('twitch', username, milestone.reward);
        }

        // Announce
        if (this.settings.announceMilestones) {
          const message = milestone.message.replace('{user}', username);
          this.ctx.chat.send(message);
        }

        this.log.info(`${username} achieved ${milestone.hours}h watchtime milestone`);
        this.db.logEvent('watchtime_milestone', { username, hours: milestone.hours, reward: milestone.reward });
      }
    }
  }

  private formatWatchtime(minutes: number): string {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;

    if (hours > 0) {
      return `${hours}h ${mins}m`;
    }
    return `${mins}m`;
  }

  private registerCommands(): void {
    // !watchtime - Check watchtime
    this.registerCommand({
      name: 'watchtime',
      aliases: ['wt', 'zeit'],
      description: 'Check your or someone\'s watchtime',
      usage: '!watchtime [user]',
      cooldown: { user: 10, global: 0 },
      handler: async (ctx) => {
        const targetUser = ctx.args[0]?.toLowerCase().replace('@', '') || ctx.user.username.toLowerCase();

        const user = this.db.getUser('twitch', targetUser);
        if (!user) {
          ctx.reply(`❌ User ${targetUser} nicht gefunden`);
          return;
        }

        const watchtime = user.watch_time || 0;
        const formatted = this.formatWatchtime(watchtime);

        // Find next milestone
        const hours = Math.floor(watchtime / 60);
        const nextMilestone = this.settings.milestones.find((m) => m.hours > hours);

        let message = `⏱️ ${targetUser}: ${formatted} Watchtime`;

        if (nextMilestone) {
          const hoursToNext = nextMilestone.hours - hours;
          message += ` | Nächster Milestone: ${nextMilestone.hours}h (noch ${hoursToNext}h)`;
        }

        ctx.reply(message);
      },
    });

    // !watchtimetop - Watchtime leaderboard
    this.registerCommand({
      name: 'watchtimetop',
      aliases: ['wttop', 'toplurker'],
      description: 'View watchtime leaderboard',
      cooldown: { user: 30, global: 10 },
      handler: async (ctx) => {
        const db = this.db.raw();
        const top = db.prepare(`
          SELECT username, watch_time
          FROM users
          WHERE platform = 'twitch' AND watch_time > 0
          ORDER BY watch_time DESC
          LIMIT 5
        `).all() as any[];

        if (top.length === 0) {
          ctx.reply('⏱️ Keine Watchtime-Daten vorhanden');
          return;
        }

        const list = top.map((u, i) => {
          const medal = ['🥇', '🥈', '🥉', '4️⃣', '5️⃣'][i];
          return `${medal} ${u.username}: ${this.formatWatchtime(u.watch_time)}`;
        }).join(' | ');

        ctx.reply(`⏱️ Top Watchtime: ${list}`);
      },
    });

    // !watchtimestats - Watchtime statistics
    this.registerCommand({
      name: 'watchtimestats',
      aliases: ['wtstats'],
      description: 'View watchtime statistics',
      permission: Permission.MODERATOR,
      cooldown: { user: 30, global: 10 },
      handler: async (ctx) => {
        const db = this.db.raw();

        // Total watchtime
        const total = db.prepare(`
          SELECT SUM(watch_time) as total, COUNT(*) as users
          FROM users
          WHERE platform = 'twitch' AND watch_time > 0
        `).get() as any;

        // Active viewers
        const activeCount = this.activeViewers.size;

        // Today's sessions
        const today = db.prepare(`
          SELECT COUNT(*) as count, SUM(duration_minutes) as total
          FROM watchtime_sessions
          WHERE date(started_at) = date('now')
        `).get() as any;

        ctx.reply(
          `⏱️ Stats: ${total.users} User mit ${this.formatWatchtime(total.total || 0)} gesamt | ` +
          `Aktiv: ${activeCount} | Heute: ${today.count || 0} Sessions (${this.formatWatchtime(today.total || 0)})`
        );
      },
    });

    // !milestones - View available milestones
    this.registerCommand({
      name: 'milestones',
      description: 'View watchtime milestones',
      cooldown: { user: 30, global: 10 },
      handler: async (ctx) => {
        const list = this.settings.milestones
          .map((m) => `${m.hours}h: ${m.reward}P`)
          .join(' | ');

        ctx.reply(`🏆 Watchtime Milestones: ${list}`);
      },
    });

    // !addwatchtime - Add watchtime (admin)
    this.registerCommand({
      name: 'addwatchtime',
      description: 'Add watchtime to a user',
      usage: '!addwatchtime <user> <minutes>',
      permission: Permission.BROADCASTER,
      cooldown: { user: 0, global: 0 },
      handler: async (ctx) => {
        if (ctx.args.length < 2) {
          ctx.reply('Verwendung: !addwatchtime <user> <minutes>');
          return;
        }

        const username = ctx.args[0].toLowerCase().replace('@', '');
        const minutes = parseInt(ctx.args[1]);

        if (isNaN(minutes) || minutes <= 0) {
          ctx.reply('❌ Ungültige Minuten');
          return;
        }

        const user = this.db.getUser('twitch', username);
        if (!user) {
          ctx.reply(`❌ User ${username} nicht gefunden`);
          return;
        }

        const newWatchtime = (user.watch_time || 0) + minutes;
        this.db.raw().prepare('UPDATE users SET watch_time = ? WHERE platform = ? AND username = ?')
          .run(newWatchtime, 'twitch', username);

        this.checkMilestones(username, newWatchtime);

        ctx.reply(`✅ ${username}: +${minutes}m -> ${this.formatWatchtime(newWatchtime)}`);
      },
    });
  }

  // Public API
  getActiveViewers(): string[] {
    return Array.from(this.activeViewers.keys());
  }

  getWatchtime(username: string): number {
    const user = this.db.getUser('twitch', username);
    return user?.watch_time || 0;
  }

  isViewing(username: string): boolean {
    return this.activeViewers.has(username.toLowerCase());
  }
}
