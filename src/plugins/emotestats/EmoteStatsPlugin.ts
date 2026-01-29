/**
 * Emote Stats Plugin
 *
 * Features:
 * - Track most used emotes
 * - Emote leaderboard
 * - Per-user emote stats
 */

import { Plugin } from '../base/Plugin';
import { PluginMeta, Permission } from '../../types/plugins';
import { ChatMessageEvent } from '../../types/events';
import { getDatabase, DatabaseService } from '../../services/Database';

interface EmoteCount {
  emote: string;
  count: number;
}

export class EmoteStatsPlugin extends Plugin {
  meta: PluginMeta = {
    name: 'emotestats',
    version: '1.0.0',
    description: 'Track and display emote usage statistics',
    author: 'StreamCore',
  };

  private db!: DatabaseService;
  private emoteCache: Map<string, number> = new Map();
  private sessionEmotes: Map<string, number> = new Map();
  private saveInterval?: NodeJS.Timeout;

  protected async init(): Promise<void> {
    this.db = getDatabase();
    this.log.info('Initializing Emote Stats...');

    this.initTables();
    this.loadEmoteCounts();
    this.setupEventHandlers();
    this.registerCommands();

    this.log.info('Emote Stats initialized!');
  }

  protected async destroy(): Promise<void> {
    if (this.saveInterval) clearInterval(this.saveInterval);
    // Save session emotes before shutdown
    this.saveEmoteCounts();
  }

  private initTables(): void {
    const db = this.db.raw();
    db.exec(`
      CREATE TABLE IF NOT EXISTS emote_stats (
        emote TEXT PRIMARY KEY,
        count INTEGER DEFAULT 0,
        last_used DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_emote_count ON emote_stats(count DESC);
    `);
  }

  private loadEmoteCounts(): void {
    const db = this.db.raw();
    const stmt = db.prepare('SELECT emote, count FROM emote_stats');
    const rows = stmt.all() as EmoteCount[];

    for (const row of rows) {
      this.emoteCache.set(row.emote, row.count);
    }

    this.log.info(`Loaded ${this.emoteCache.size} emote stats`);
  }

  private saveEmoteCounts(): void {
    const db = this.db.raw();
    const stmt = db.prepare(`
      INSERT INTO emote_stats (emote, count, last_used)
      VALUES (?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(emote) DO UPDATE SET
        count = emote_stats.count + excluded.count,
        last_used = CURRENT_TIMESTAMP
    `);

    const transaction = db.transaction(() => {
      for (const [emote, count] of this.sessionEmotes.entries()) {
        stmt.run(emote, count);
      }
    });

    transaction();
    this.sessionEmotes.clear();
  }

  private setupEventHandlers(): void {
    this.ctx.events.on('chat:message', (event: ChatMessageEvent) => {
      this.trackEmotes(event);
    });

    // Save emotes every 5 minutes
    this.saveInterval = setInterval(() => {
      if (this.sessionEmotes.size > 0) {
        this.saveEmoteCounts();
      }
    }, 5 * 60 * 1000);
  }

  private trackEmotes(event: ChatMessageEvent): void {
    if (!event.emotes || event.emotes.length === 0) return;

    for (const emote of event.emotes) {
      // Count occurrences in message
      const count = emote.positions.length;

      // Update session cache
      const current = this.sessionEmotes.get(emote.name) || 0;
      this.sessionEmotes.set(emote.name, current + count);

      // Update memory cache
      const total = this.emoteCache.get(emote.name) || 0;
      this.emoteCache.set(emote.name, total + count);
    }
  }

  private registerCommands(): void {
    // !emotes - Show top emotes
    this.registerCommand({
      name: 'emotes',
      aliases: ['topemotes', 'emoteleaderboard'],
      description: 'Show most used emotes',
      cooldown: { user: 30, global: 10 },
      handler: async (ctx) => {
        const count = Math.min(parseInt(ctx.args[0]) || 5, 10);

        const sorted = Array.from(this.emoteCache.entries())
          .sort((a, b) => b[1] - a[1])
          .slice(0, count);

        if (sorted.length === 0) {
          ctx.reply('📊 Noch keine Emote-Statistiken');
          return;
        }

        const medals = ['🥇', '🥈', '🥉', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];
        const leaderboard = sorted
          .map(([emote, count], i) => `${medals[i]} ${emote}: ${count.toLocaleString()}`)
          .join(' | ');

        ctx.reply(`📊 Top Emotes: ${leaderboard}`);
      },
    });

    // !emotecount - Get specific emote count
    this.registerCommand({
      name: 'emotecount',
      aliases: ['ec'],
      description: 'Get usage count for a specific emote',
      usage: '!emotecount <emote>',
      cooldown: { user: 10, global: 3 },
      handler: async (ctx) => {
        if (ctx.args.length === 0) {
          ctx.reply('Verwendung: !emotecount <emote>');
          return;
        }

        const emote = ctx.args[0];
        const count = this.emoteCache.get(emote) || 0;

        if (count === 0) {
          ctx.reply(`📊 ${emote} wurde noch nie benutzt`);
        } else {
          // Get rank
          const sorted = Array.from(this.emoteCache.entries())
            .sort((a, b) => b[1] - a[1]);
          const rank = sorted.findIndex(([e]) => e === emote) + 1;

          ctx.reply(`📊 ${emote}: ${count.toLocaleString()}x benutzt (Platz #${rank})`);
        }
      },
    });

    // !emotestats - Show emote statistics
    this.registerCommand({
      name: 'emotestats',
      description: 'Show overall emote statistics',
      permission: Permission.MODERATOR,
      cooldown: { user: 30, global: 10 },
      handler: async (ctx) => {
        const totalEmotes = this.emoteCache.size;
        const totalUsage = Array.from(this.emoteCache.values()).reduce((a, b) => a + b, 0);
        const topEmote = Array.from(this.emoteCache.entries())
          .sort((a, b) => b[1] - a[1])[0];

        ctx.reply(
          `📊 Emote Stats: ${totalEmotes} verschiedene Emotes | ` +
          `${totalUsage.toLocaleString()} total | ` +
          `Top: ${topEmote ? `${topEmote[0]} (${topEmote[1].toLocaleString()})` : 'N/A'}`
        );
      },
    });

    // !emotereset - Reset emote stats (broadcaster)
    this.registerCommand({
      name: 'emotereset',
      description: 'Reset emote statistics',
      permission: Permission.BROADCASTER,
      cooldown: { user: 0, global: 0 },
      handler: async (ctx) => {
        const db = this.db.raw();
        db.exec('DELETE FROM emote_stats');
        this.emoteCache.clear();
        this.sessionEmotes.clear();

        ctx.reply('✅ Emote-Statistiken zurückgesetzt');
      },
    });

    // !sessionemotes - Show session emotes
    this.registerCommand({
      name: 'sessionemotes',
      aliases: ['todayemotes'],
      description: 'Show emotes used this session',
      cooldown: { user: 30, global: 10 },
      handler: async (ctx) => {
        const sorted = Array.from(this.sessionEmotes.entries())
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5);

        if (sorted.length === 0) {
          ctx.reply('📊 Diese Session: Noch keine Emotes benutzt');
          return;
        }

        const list = sorted
          .map(([emote, count]) => `${emote}: ${count}`)
          .join(' | ');

        ctx.reply(`📊 Diese Session: ${list}`);
      },
    });
  }

  // Public API
  getTopEmotes(count: number = 10): EmoteCount[] {
    return Array.from(this.emoteCache.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, count)
      .map(([emote, count]) => ({ emote, count }));
  }

  getEmoteCount(emote: string): number {
    return this.emoteCache.get(emote) || 0;
  }
}
