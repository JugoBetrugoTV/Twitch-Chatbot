/**
 * Ranks/Levels Plugin
 *
 * Features:
 * - User ranks based on points/watchtime
 * - Level up notifications
 * - Rank commands
 * - Custom rank names
 */

import { Plugin } from '../base/Plugin';
import { PluginMeta, Permission } from '../../types/plugins';
import { getDatabase, DatabaseService } from '../../services/Database';

interface Rank {
  name: string;
  minPoints: number;
  icon: string;
}

const DEFAULT_RANKS: Rank[] = [
  { name: 'Neuling', minPoints: 0, icon: '🌱' },
  { name: 'Zuschauer', minPoints: 100, icon: '👤' },
  { name: 'Stammgast', minPoints: 500, icon: '⭐' },
  { name: 'Supporter', minPoints: 1000, icon: '💫' },
  { name: 'Veteran', minPoints: 2500, icon: '🏅' },
  { name: 'Elite', minPoints: 5000, icon: '🎖️' },
  { name: 'Champion', minPoints: 10000, icon: '🏆' },
  { name: 'Legende', minPoints: 25000, icon: '👑' },
  { name: 'Mythisch', minPoints: 50000, icon: '💎' },
  { name: 'Göttlich', minPoints: 100000, icon: '⚡' },
];

export class RanksPlugin extends Plugin {
  meta: PluginMeta = {
    name: 'ranks',
    version: '1.0.0',
    description: 'User ranks and levels based on points',
    author: 'StreamCore',
  };

  private db!: DatabaseService;
  private ranks: Rank[] = DEFAULT_RANKS;

  protected async init(): Promise<void> {
    this.db = getDatabase();
    this.log.info('Initializing Ranks system...');

    // Load custom ranks if any
    const customRanks = this.db.getSetting<Rank[]>('custom_ranks');
    if (customRanks && customRanks.length > 0) {
      this.ranks = customRanks;
    }

    this.registerCommands();
    this.log.info('Ranks system initialized!');
  }

  private registerCommands(): void {
    // !rank - Show your rank
    this.registerCommand({
      name: 'rank',
      aliases: ['level', 'rang', 'stufe'],
      description: 'Show your rank',
      usage: '!rank [username]',
      cooldown: { user: 5, global: 0 },
      handler: async (ctx) => {
        const targetName = ctx.args[0]?.replace('@', '') || ctx.user.username;
        const user = this.db.getUser('twitch', targetName);

        if (!user) {
          ctx.reply('❌ Benutzer nicht gefunden!');
          return;
        }

        const rank = this.getRank(user.points);
        const nextRank = this.getNextRank(user.points);

        let response = `${rank.icon} ${user.display_name || user.username}: ` +
          `Rang "${rank.name}" | ${user.points.toLocaleString()} Punkte`;

        if (nextRank) {
          const pointsNeeded = nextRank.minPoints - user.points;
          response += ` | Nächster Rang: "${nextRank.name}" (noch ${pointsNeeded.toLocaleString()} Punkte)`;
        } else {
          response += ' | 🎉 MAX RANG!';
        }

        ctx.reply(response);
      },
    });

    // !ranks - Show all ranks
    this.registerCommand({
      name: 'ranks',
      aliases: ['levels', 'raenge'],
      description: 'Show all available ranks',
      cooldown: { user: 30, global: 10 },
      handler: async (ctx) => {
        const rankList = this.ranks
          .map(r => `${r.icon} ${r.name} (${r.minPoints.toLocaleString()})`)
          .join(' → ');

        ctx.reply(`📊 Ränge: ${rankList}`);
      },
    });

    // !topranks - Show top ranked users
    this.registerCommand({
      name: 'topranks',
      aliases: ['toplevels', 'highscores'],
      description: 'Show top ranked users',
      cooldown: { user: 30, global: 10 },
      handler: async (ctx) => {
        const topUsers = this.db.getTopUsers(5, 'points');

        if (topUsers.length === 0) {
          ctx.reply('📊 Noch keine Benutzer!');
          return;
        }

        const list = topUsers.map((u, i) => {
          const rank = this.getRank(u.points);
          return `${i + 1}. ${rank.icon} ${u.display_name || u.username} (${u.points.toLocaleString()})`;
        }).join(' | ');

        ctx.reply(`🏆 Top 5: ${list}`);
      },
    });

    // !progress - Show rank progress
    this.registerCommand({
      name: 'progress',
      aliases: ['fortschritt', 'xp'],
      description: 'Show your rank progress',
      cooldown: { user: 10, global: 0 },
      handler: async (ctx) => {
        const user = this.db.getUser('twitch', ctx.user.username);

        if (!user) {
          ctx.reply('❌ Benutzer nicht gefunden!');
          return;
        }

        const rank = this.getRank(user.points);
        const nextRank = this.getNextRank(user.points);

        if (!nextRank) {
          ctx.reply(`${rank.icon} ${ctx.user.displayName}: MAX RANG erreicht! 🎉`);
          return;
        }

        // Calculate progress
        const prevRankPoints = rank.minPoints;
        const pointsInRank = user.points - prevRankPoints;
        const pointsNeeded = nextRank.minPoints - prevRankPoints;
        const progress = Math.floor((pointsInRank / pointsNeeded) * 100);

        // Create progress bar
        const filled = Math.floor(progress / 10);
        const empty = 10 - filled;
        const progressBar = '█'.repeat(filled) + '░'.repeat(empty);

        ctx.reply(
          `${rank.icon} ${ctx.user.displayName}: "${rank.name}" → "${nextRank.name}" ` +
          `[${progressBar}] ${progress}% ` +
          `(${(nextRank.minPoints - user.points).toLocaleString()} Punkte übrig)`
        );
      },
    });

    // !setrank - Set custom rank (Mod)
    this.registerCommand({
      name: 'setrank',
      description: 'Manually set a user rank (does not change points)',
      usage: '!setrank <user> <rank_name>',
      permission: Permission.BROADCASTER,
      cooldown: { user: 0, global: 0 },
      handler: async (ctx) => {
        ctx.reply('💡 Ränge basieren auf Punkten. Benutze !addpoints um Punkte zu geben.');
      },
    });

    // !addrank - Add a custom rank (Broadcaster)
    this.registerCommand({
      name: 'addrank',
      description: 'Add a custom rank',
      usage: '!addrank <name> <minPoints> <icon>',
      permission: Permission.BROADCASTER,
      cooldown: { user: 0, global: 0 },
      handler: async (ctx) => {
        if (ctx.args.length < 3) {
          ctx.reply('Verwendung: !addrank <name> <minPunkte> <icon>');
          return;
        }

        const name = ctx.args[0];
        const minPoints = parseInt(ctx.args[1]);
        const icon = ctx.args[2];

        if (isNaN(minPoints) || minPoints < 0) {
          ctx.reply('❌ Ungültige Punktzahl!');
          return;
        }

        // Check if rank with same points exists
        const existing = this.ranks.find(r => r.minPoints === minPoints);
        if (existing) {
          ctx.reply(`❌ Es gibt bereits einen Rang bei ${minPoints} Punkten!`);
          return;
        }

        this.ranks.push({ name, minPoints, icon });
        this.ranks.sort((a, b) => a.minPoints - b.minPoints);
        this.db.setSetting('custom_ranks', this.ranks);

        ctx.reply(`✅ Rang "${name}" ${icon} bei ${minPoints} Punkten hinzugefügt!`);
      },
    });

    // !delrank - Delete a custom rank (Broadcaster)
    this.registerCommand({
      name: 'delrank',
      description: 'Delete a custom rank',
      usage: '!delrank <name>',
      permission: Permission.BROADCASTER,
      cooldown: { user: 0, global: 0 },
      handler: async (ctx) => {
        if (ctx.args.length === 0) {
          ctx.reply('Verwendung: !delrank <name>');
          return;
        }

        const name = ctx.args[0].toLowerCase();
        const index = this.ranks.findIndex(r => r.name.toLowerCase() === name);

        if (index === -1) {
          ctx.reply(`❌ Rang "${name}" nicht gefunden!`);
          return;
        }

        // Don't allow deleting the base rank
        if (this.ranks[index].minPoints === 0) {
          ctx.reply('❌ Der Basis-Rang kann nicht gelöscht werden!');
          return;
        }

        const removed = this.ranks.splice(index, 1)[0];
        this.db.setSetting('custom_ranks', this.ranks);

        ctx.reply(`✅ Rang "${removed.name}" gelöscht!`);
      },
    });

    // !resetranks - Reset to default ranks (Broadcaster)
    this.registerCommand({
      name: 'resetranks',
      description: 'Reset ranks to default',
      permission: Permission.BROADCASTER,
      cooldown: { user: 0, global: 0 },
      handler: async (ctx) => {
        this.ranks = [...DEFAULT_RANKS];
        this.db.deleteSetting('custom_ranks');
        ctx.reply('✅ Ränge auf Standard zurückgesetzt!');
      },
    });
  }

  private getRank(points: number): Rank {
    // Find the highest rank the user qualifies for
    for (let i = this.ranks.length - 1; i >= 0; i--) {
      if (points >= this.ranks[i].minPoints) {
        return this.ranks[i];
      }
    }
    return this.ranks[0];
  }

  private getNextRank(points: number): Rank | null {
    for (const rank of this.ranks) {
      if (rank.minPoints > points) {
        return rank;
      }
    }
    return null;
  }

  // Public API
  getUserRank(username: string): Rank | null {
    const user = this.db.getUser('twitch', username);
    if (!user) return null;
    return this.getRank(user.points);
  }

  getAllRanks(): Rank[] {
    return [...this.ranks];
  }
}
