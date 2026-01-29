/**
 * Betting System Plugin
 *
 * Features:
 * - User vs User bets
 * - Custom bet creation
 * - Bet history
 * - Accept/decline mechanics
 */

import { Plugin } from '../base/Plugin';
import { PluginMeta, Permission } from '../../types/plugins';
import { getDatabase, DatabaseService } from '../../services/Database';

interface Bet {
  id: string;
  creator: string;
  opponent: string | null;
  description: string;
  amount: number;
  status: 'pending' | 'active' | 'completed' | 'cancelled';
  winner?: string;
  createdAt: Date;
  expiresAt: Date;
}

export class BettingPlugin extends Plugin {
  meta: PluginMeta = {
    name: 'betting',
    version: '1.0.0',
    description: 'User vs user betting system',
    author: 'StreamCore',
  };

  private db!: DatabaseService;
  private activeBets: Map<string, Bet> = new Map();
  private pendingChallenges: Map<string, Bet> = new Map(); // challengeId -> Bet

  protected async init(): Promise<void> {
    this.db = getDatabase();
    this.log.info('Initializing Betting system...');

    this.initTables();
    this.registerCommands();

    // Cleanup expired bets every minute
    setInterval(() => this.cleanupExpired(), 60000);

    this.log.info('Betting system initialized!');
  }

  protected async destroy(): Promise<void> {}

  private initTables(): void {
    const db = this.db.raw();
    db.exec(`
      CREATE TABLE IF NOT EXISTS bets (
        id TEXT PRIMARY KEY,
        creator TEXT NOT NULL,
        opponent TEXT,
        description TEXT NOT NULL,
        amount INTEGER NOT NULL,
        status TEXT DEFAULT 'pending',
        winner TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        completed_at DATETIME
      );

      CREATE INDEX IF NOT EXISTS idx_bets_creator ON bets(creator);
      CREATE INDEX IF NOT EXISTS idx_bets_status ON bets(status);
    `);
  }

  private registerCommands(): void {
    // !bet - Create a bet challenge
    this.registerCommand({
      name: 'bet',
      aliases: ['wette', 'challenge'],
      description: 'Challenge someone to a bet',
      usage: '!bet <user> <amount> <description>',
      cooldown: { user: 10, global: 0 },
      handler: async (ctx) => {
        if (ctx.args.length < 3) {
          ctx.reply('Verwendung: !bet <user> <punkte> <beschreibung>');
          return;
        }

        const target = ctx.args[0].toLowerCase().replace('@', '');
        const amount = parseInt(ctx.args[1]);
        const description = ctx.args.slice(2).join(' ');

        if (target === ctx.user.username.toLowerCase()) {
          ctx.reply('❌ Du kannst nicht gegen dich selbst wetten!');
          return;
        }

        if (isNaN(amount) || amount < 10) {
          ctx.reply('❌ Minimum 10 Punkte!');
          return;
        }

        // Check if creator has enough points
        const creator = this.db.getUser('twitch', ctx.user.username);
        if (!creator || creator.points < amount) {
          ctx.reply('❌ Du hast nicht genug Punkte!');
          return;
        }

        // Check if target exists
        const opponent = this.db.getUser('twitch', target);
        if (!opponent) {
          ctx.reply('❌ Benutzer nicht gefunden!');
          return;
        }

        if (opponent.points < amount) {
          ctx.reply(`❌ ${target} hat nicht genug Punkte!`);
          return;
        }

        // Check for existing challenge
        const existingKey = `${ctx.user.username.toLowerCase()}:${target}`;
        if (this.pendingChallenges.has(existingKey)) {
          ctx.reply('❌ Du hast bereits eine offene Wette mit diesem User!');
          return;
        }

        // Create bet
        const betId = `bet_${Date.now()}`;
        const bet: Bet = {
          id: betId,
          creator: ctx.user.username.toLowerCase(),
          opponent: target,
          description,
          amount,
          status: 'pending',
          createdAt: new Date(),
          expiresAt: new Date(Date.now() + 2 * 60 * 1000), // 2 minutes
        };

        this.pendingChallenges.set(existingKey, bet);

        ctx.reply(
          `🎲 @${target}, ${ctx.user.displayName} fordert dich zu einer Wette heraus! ` +
          `${amount} Punkte: "${description}" | !acceptbet oder !declinebet (2 Min)`
        );
      },
    });

    // !acceptbet - Accept a bet challenge
    this.registerCommand({
      name: 'acceptbet',
      aliases: ['annahme'],
      description: 'Accept a bet challenge',
      cooldown: { user: 5, global: 0 },
      handler: async (ctx) => {
        // Find pending bet for this user
        let foundBet: Bet | null = null;
        let foundKey: string | null = null;

        for (const [key, bet] of this.pendingChallenges.entries()) {
          if (bet.opponent === ctx.user.username.toLowerCase() && bet.status === 'pending') {
            foundBet = bet;
            foundKey = key;
            break;
          }
        }

        if (!foundBet || !foundKey) {
          ctx.reply('❌ Keine offene Wette gefunden!');
          return;
        }

        // Check points again
        const opponent = this.db.getUser('twitch', ctx.user.username);
        if (!opponent || opponent.points < foundBet.amount) {
          ctx.reply('❌ Du hast nicht genug Punkte!');
          this.pendingChallenges.delete(foundKey);
          return;
        }

        // Reserve points from both users
        this.db.updateUserPoints('twitch', foundBet.creator, -foundBet.amount);
        this.db.updateUserPoints('twitch', ctx.user.username, -foundBet.amount);

        // Move to active
        foundBet.status = 'active';
        this.activeBets.set(foundBet.id, foundBet);
        this.pendingChallenges.delete(foundKey);

        // Save to database
        this.saveBet(foundBet);

        ctx.reply(
          `✅ Wette angenommen! ${foundBet.creator} vs ${ctx.user.username} ` +
          `um ${foundBet.amount} Punkte: "${foundBet.description}" | ` +
          `Mod: !betwin ${foundBet.creator}/${ctx.user.username}`
        );
      },
    });

    // !declinebet - Decline a bet
    this.registerCommand({
      name: 'declinebet',
      aliases: ['ablehnen'],
      description: 'Decline a bet challenge',
      cooldown: { user: 5, global: 0 },
      handler: async (ctx) => {
        for (const [key, bet] of this.pendingChallenges.entries()) {
          if (bet.opponent === ctx.user.username.toLowerCase()) {
            this.pendingChallenges.delete(key);
            ctx.reply(`❌ ${ctx.user.displayName} hat die Wette abgelehnt!`);
            return;
          }
        }
        ctx.reply('❌ Keine offene Wette gefunden!');
      },
    });

    // !betwin - Declare winner (mod)
    this.registerCommand({
      name: 'betwin',
      aliases: ['betwinner'],
      description: 'Declare bet winner',
      usage: '!betwin <winner>',
      permission: Permission.MODERATOR,
      cooldown: { user: 0, global: 0 },
      handler: async (ctx) => {
        if (ctx.args.length === 0) {
          // List active bets
          if (this.activeBets.size === 0) {
            ctx.reply('🎲 Keine aktiven Wetten');
            return;
          }

          const bets = Array.from(this.activeBets.values())
            .map((b) => `${b.creator} vs ${b.opponent}: ${b.amount}P`)
            .join(' | ');
          ctx.reply(`🎲 Aktive Wetten: ${bets}`);
          return;
        }

        const winner = ctx.args[0].toLowerCase().replace('@', '');

        // Find bet with this winner
        let foundBet: Bet | null = null;
        for (const bet of this.activeBets.values()) {
          if (bet.creator === winner || bet.opponent === winner) {
            foundBet = bet;
            break;
          }
        }

        if (!foundBet) {
          ctx.reply('❌ Keine aktive Wette mit diesem User gefunden!');
          return;
        }

        // Award winner
        const totalPot = foundBet.amount * 2;
        this.db.updateUserPoints('twitch', winner, totalPot);

        foundBet.status = 'completed';
        foundBet.winner = winner;
        this.activeBets.delete(foundBet.id);
        this.updateBet(foundBet);

        const loser = winner === foundBet.creator ? foundBet.opponent : foundBet.creator;

        ctx.reply(
          `🏆 ${winner} gewinnt die Wette gegen ${loser}! ` +
          `+${totalPot} Punkte für "${foundBet.description}"`
        );
      },
    });

    // !betcancel - Cancel a bet (mod)
    this.registerCommand({
      name: 'betcancel',
      aliases: ['cancelbet'],
      description: 'Cancel an active bet',
      usage: '!betcancel <user>',
      permission: Permission.MODERATOR,
      cooldown: { user: 0, global: 0 },
      handler: async (ctx) => {
        if (ctx.args.length === 0) {
          ctx.reply('Verwendung: !betcancel <user>');
          return;
        }

        const user = ctx.args[0].toLowerCase().replace('@', '');

        for (const [id, bet] of this.activeBets.entries()) {
          if (bet.creator === user || bet.opponent === user) {
            // Refund both users
            this.db.updateUserPoints('twitch', bet.creator, bet.amount);
            this.db.updateUserPoints('twitch', bet.opponent!, bet.amount);

            bet.status = 'cancelled';
            this.activeBets.delete(id);
            this.updateBet(bet);

            ctx.reply(`🔄 Wette zwischen ${bet.creator} und ${bet.opponent} abgebrochen. Punkte erstattet.`);
            return;
          }
        }

        ctx.reply('❌ Keine aktive Wette mit diesem User gefunden!');
      },
    });

    // !mybets - Show your bet history
    this.registerCommand({
      name: 'mybets',
      aliases: ['bethistory'],
      description: 'Show your bet history',
      cooldown: { user: 30, global: 0 },
      handler: async (ctx) => {
        const stats = this.getUserBetStats(ctx.user.username.toLowerCase());

        ctx.reply(
          `🎲 ${ctx.user.displayName}: ${stats.wins}W/${stats.losses}L | ` +
          `Gewonnen: ${stats.totalWon} | Verloren: ${stats.totalLost}`
        );
      },
    });
  }

  private cleanupExpired(): void {
    const now = Date.now();
    for (const [key, bet] of this.pendingChallenges.entries()) {
      if (now > bet.expiresAt.getTime()) {
        this.pendingChallenges.delete(key);
      }
    }
  }

  private saveBet(bet: Bet): void {
    const db = this.db.raw();
    const stmt = db.prepare(`
      INSERT INTO bets (id, creator, opponent, description, amount, status)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    stmt.run(bet.id, bet.creator, bet.opponent, bet.description, bet.amount, bet.status);
  }

  private updateBet(bet: Bet): void {
    const db = this.db.raw();
    const stmt = db.prepare(`
      UPDATE bets SET status = ?, winner = ?, completed_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `);
    stmt.run(bet.status, bet.winner, bet.id);
  }

  private getUserBetStats(username: string): {
    wins: number;
    losses: number;
    totalWon: number;
    totalLost: number;
  } {
    const db = this.db.raw();

    const winsStmt = db.prepare(`
      SELECT COUNT(*) as count, SUM(amount) as total FROM bets
      WHERE winner = ? AND status = 'completed'
    `);
    const wins = winsStmt.get(username) as any;

    const lossesStmt = db.prepare(`
      SELECT COUNT(*) as count, SUM(amount) as total FROM bets
      WHERE (creator = ? OR opponent = ?) AND winner != ? AND status = 'completed'
    `);
    const losses = lossesStmt.get(username, username, username) as any;

    return {
      wins: wins?.count || 0,
      losses: losses?.count || 0,
      totalWon: (wins?.total || 0) * 2,
      totalLost: losses?.total || 0,
    };
  }

  // Public API
  getActiveBets(): Bet[] {
    return Array.from(this.activeBets.values());
  }
}
