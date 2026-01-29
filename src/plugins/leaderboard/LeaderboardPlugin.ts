/**
 * Leaderboard Plugin
 *
 * Display rankings for various metrics
 * Features:
 * - Points leaderboard
 * - Watchtime leaderboard
 * - Message count leaderboard
 * - Gamble stats leaderboard
 * - Custom leaderboards
 */

import { Plugin } from '../base/Plugin';
import { PluginMeta, Permission } from '../../types/plugins';
import { getDatabase, DatabaseService } from '../../services/Database';

interface LeaderboardEntry {
  rank: number;
  username: string;
  displayName: string;
  value: number;
  formattedValue: string;
}

interface LeaderboardConfig {
  id: string;
  name: string;
  description: string;
  query: string;
  valueFormatter: (value: number) => string;
  emoji: string;
}

interface LeaderboardSettings {
  defaultLimit: number;
  cacheTime: number;
  announceTopChanges: boolean;
}

const DEFAULT_SETTINGS: LeaderboardSettings = {
  defaultLimit: 10,
  cacheTime: 60000, // 1 minute
  announceTopChanges: false,
};

export class LeaderboardPlugin extends Plugin {
  meta: PluginMeta = {
    name: 'leaderboard',
    version: '1.0.0',
    description: 'Display rankings for various metrics',
    author: 'StreamCore',
  };

  private db!: DatabaseService;
  private settings: LeaderboardSettings = DEFAULT_SETTINGS;
  private leaderboards: Map<string, LeaderboardConfig> = new Map();
  private cache: Map<string, { data: LeaderboardEntry[]; timestamp: number }> = new Map();

  protected async init(): Promise<void> {
    this.db = getDatabase();
    this.log.info('Initializing Leaderboard...');

    this.loadSettings();
    this.setupDefaultLeaderboards();
    this.registerCommands();

    this.log.info('Leaderboard initialized!');
  }

  protected async destroy(): Promise<void> {
    this.cache.clear();
  }

  private loadSettings(): void {
    const saved = this.db.getSetting<LeaderboardSettings>('leaderboard_settings');
    if (saved) {
      this.settings = { ...DEFAULT_SETTINGS, ...saved };
    }
  }

  private setupDefaultLeaderboards(): void {
    // Points leaderboard
    this.leaderboards.set('points', {
      id: 'points',
      name: 'Punkte',
      description: 'Top Punktesammler',
      query: 'SELECT username, display_name, points as value FROM users WHERE points > 0 ORDER BY points DESC LIMIT ?',
      valueFormatter: (v) => `${v.toLocaleString('de-DE')} Punkte`,
      emoji: '💰',
    });

    // Watchtime leaderboard
    this.leaderboards.set('watchtime', {
      id: 'watchtime',
      name: 'Watchtime',
      description: 'Längste Zuschauzeit',
      query: 'SELECT username, display_name, watch_time as value FROM users WHERE watch_time > 0 ORDER BY watch_time DESC LIMIT ?',
      valueFormatter: (v) => {
        const hours = Math.floor(v / 60);
        const minutes = v % 60;
        return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
      },
      emoji: '⏱️',
    });

    // Messages leaderboard
    this.leaderboards.set('messages', {
      id: 'messages',
      name: 'Nachrichten',
      description: 'Meiste Nachrichten',
      query: 'SELECT username, display_name, message_count as value FROM users WHERE message_count > 0 ORDER BY message_count DESC LIMIT ?',
      valueFormatter: (v) => `${v.toLocaleString('de-DE')} Nachrichten`,
      emoji: '💬',
    });

    // Gamble wins leaderboard
    this.leaderboards.set('gamblewins', {
      id: 'gamblewins',
      name: 'Gamble Gewinne',
      description: 'Höchste Gamble-Gewinne',
      query: `SELECT username, display_name,
              COALESCE((SELECT SUM(CASE WHEN won > 0 THEN won ELSE 0 END) FROM gamble_history WHERE gamble_history.username = users.username), 0) as value
              FROM users ORDER BY value DESC LIMIT ?`,
      valueFormatter: (v) => `${v.toLocaleString('de-DE')} gewonnen`,
      emoji: '🎰',
    });

    // Gamble losses leaderboard
    this.leaderboards.set('gamblelosses', {
      id: 'gamblelosses',
      name: 'Gamble Verluste',
      description: 'Höchste Gamble-Verluste',
      query: `SELECT username, display_name,
              COALESCE((SELECT SUM(CASE WHEN won < 0 THEN ABS(won) ELSE 0 END) FROM gamble_history WHERE gamble_history.username = users.username), 0) as value
              FROM users ORDER BY value DESC LIMIT ?`,
      valueFormatter: (v) => `${v.toLocaleString('de-DE')} verloren`,
      emoji: '📉',
    });

    // Follows given leaderboard
    this.leaderboards.set('follows', {
      id: 'follows',
      name: 'Follow-Zeit',
      description: 'Längste Follower',
      query: `SELECT username, display_name,
              CAST((julianday('now') - julianday(followed_at)) as INTEGER) as value
              FROM users WHERE followed_at IS NOT NULL ORDER BY followed_at ASC LIMIT ?`,
      valueFormatter: (v) => `${v} Tage`,
      emoji: '❤️',
    });
  }

  private async getLeaderboard(id: string, limit: number = this.settings.defaultLimit): Promise<LeaderboardEntry[]> {
    const config = this.leaderboards.get(id);
    if (!config) {
      return [];
    }

    // Check cache
    const cached = this.cache.get(id);
    if (cached && Date.now() - cached.timestamp < this.settings.cacheTime) {
      return cached.data.slice(0, limit);
    }

    try {
      const db = this.db.raw();
      const rows = db.prepare(config.query).all(limit) as any[];

      const entries: LeaderboardEntry[] = rows.map((row, index) => ({
        rank: index + 1,
        username: row.username,
        displayName: row.display_name || row.username,
        value: row.value || 0,
        formattedValue: config.valueFormatter(row.value || 0),
      }));

      // Update cache
      this.cache.set(id, { data: entries, timestamp: Date.now() });

      return entries;
    } catch (error) {
      this.log.error(`Error getting leaderboard ${id}: ${error}`);
      return [];
    }
  }

  private formatLeaderboard(config: LeaderboardConfig, entries: LeaderboardEntry[]): string {
    if (entries.length === 0) {
      return `${config.emoji} ${config.name}: Keine Einträge`;
    }

    const lines = entries.slice(0, 5).map((e) => {
      const medal = e.rank === 1 ? '🥇' : e.rank === 2 ? '🥈' : e.rank === 3 ? '🥉' : `${e.rank}.`;
      return `${medal} ${e.displayName}: ${e.formattedValue}`;
    });

    return `${config.emoji} ${config.name}: ${lines.join(' | ')}`;
  }

  private registerCommands(): void {
    // !leaderboard / !lb - Show leaderboard
    this.registerCommand({
      name: 'leaderboard',
      aliases: ['lb', 'top', 'rangliste'],
      description: 'Show leaderboard',
      usage: '!lb [type] [limit]',
      cooldown: { user: 10, global: 5 },
      handler: async (ctx) => {
        const type = ctx.args[0]?.toLowerCase() || 'points';
        const limit = Math.min(parseInt(ctx.args[1]) || 5, 10);

        const config = this.leaderboards.get(type);
        if (!config) {
          const available = Array.from(this.leaderboards.keys()).join(', ');
          ctx.reply(`❌ Unbekannte Rangliste. Verfügbar: ${available}`);
          return;
        }

        const entries = await this.getLeaderboard(type, limit);
        ctx.reply(this.formatLeaderboard(config, entries));
      },
    });

    // !rank - Show user's rank
    this.registerCommand({
      name: 'rank',
      aliases: ['myrank', 'position'],
      description: 'Show your rank on leaderboards',
      usage: '!rank [type]',
      cooldown: { user: 15, global: 5 },
      handler: async (ctx) => {
        const type = ctx.args[0]?.toLowerCase() || 'points';
        const config = this.leaderboards.get(type);

        if (!config) {
          ctx.reply('❌ Unbekannte Rangliste');
          return;
        }

        // Get full leaderboard and find user
        const entries = await this.getLeaderboard(type, 1000);
        const userEntry = entries.find(
          (e) => e.username.toLowerCase() === ctx.user.username.toLowerCase()
        );

        if (!userEntry) {
          ctx.reply(`${config.emoji} Du bist noch nicht in der ${config.name}-Rangliste`);
          return;
        }

        ctx.reply(
          `${config.emoji} ${ctx.user.displayName}, du bist auf Platz ${userEntry.rank} ` +
          `mit ${userEntry.formattedValue}`
        );
      },
    });

    // !toppoints - Quick points leaderboard
    this.registerCommand({
      name: 'toppoints',
      aliases: ['toppunkte'],
      description: 'Show top points',
      cooldown: { user: 10, global: 5 },
      handler: async (ctx) => {
        const entries = await this.getLeaderboard('points', 5);
        const config = this.leaderboards.get('points')!;
        ctx.reply(this.formatLeaderboard(config, entries));
      },
    });

    // !topwatch - Quick watchtime leaderboard
    this.registerCommand({
      name: 'topwatch',
      aliases: ['topwatchtime', 'toptime'],
      description: 'Show top watchtime',
      cooldown: { user: 10, global: 5 },
      handler: async (ctx) => {
        const entries = await this.getLeaderboard('watchtime', 5);
        const config = this.leaderboards.get('watchtime')!;
        ctx.reply(this.formatLeaderboard(config, entries));
      },
    });

    // !topchat - Quick messages leaderboard
    this.registerCommand({
      name: 'topchat',
      aliases: ['topmessages', 'topmsgs'],
      description: 'Show top chatters',
      cooldown: { user: 10, global: 5 },
      handler: async (ctx) => {
        const entries = await this.getLeaderboard('messages', 5);
        const config = this.leaderboards.get('messages')!;
        ctx.reply(this.formatLeaderboard(config, entries));
      },
    });

    // !topgamble - Quick gamble leaderboard
    this.registerCommand({
      name: 'topgamble',
      aliases: ['topgamblers'],
      description: 'Show top gamblers',
      cooldown: { user: 10, global: 5 },
      handler: async (ctx) => {
        const wins = await this.getLeaderboard('gamblewins', 3);
        const config = this.leaderboards.get('gamblewins')!;
        ctx.reply(this.formatLeaderboard(config, wins));
      },
    });

    // !addleaderboard - Add custom leaderboard (admin)
    this.registerCommand({
      name: 'addleaderboard',
      description: 'Add custom leaderboard',
      usage: '!addleaderboard <id> <name> <query>',
      permission: Permission.BROADCASTER,
      cooldown: { user: 0, global: 0 },
      handler: async (ctx) => {
        const [id, name, ...queryParts] = ctx.args;
        if (!id || !name || queryParts.length === 0) {
          ctx.reply('❌ Usage: !addleaderboard <id> <name> <query>');
          return;
        }

        const query = queryParts.join(' ');

        // Validate query has required columns
        if (!query.toLowerCase().includes('username') || !query.toLowerCase().includes('value')) {
          ctx.reply('❌ Query muss username und value als Spalten haben');
          return;
        }

        this.leaderboards.set(id, {
          id,
          name,
          description: `Custom: ${name}`,
          query: query.includes('LIMIT') ? query : `${query} LIMIT ?`,
          valueFormatter: (v) => v.toLocaleString('de-DE'),
          emoji: '📊',
        });

        ctx.reply(`✅ Leaderboard "${name}" erstellt`);
      },
    });
  }

  // Public API
  getAvailableLeaderboards(): string[] {
    return Array.from(this.leaderboards.keys());
  }

  async getTopUsers(type: string, limit: number = 10): Promise<LeaderboardEntry[]> {
    return this.getLeaderboard(type, limit);
  }

  addCustomLeaderboard(config: LeaderboardConfig): void {
    this.leaderboards.set(config.id, config);
  }
}
