/**
 * Predictions Plugin
 *
 * Features:
 * - Create predictions with outcomes
 * - Track channel points bets
 * - Resolve predictions
 * - Integration with Twitch Predictions API
 */

import { Plugin } from '../base/Plugin';
import { PluginMeta, Permission } from '../../types/plugins';
import { getDatabase, DatabaseService } from '../../services/Database';

interface Prediction {
  id: string;
  title: string;
  outcomes: PredictionOutcome[];
  status: 'active' | 'locked' | 'resolved' | 'cancelled';
  winningOutcome?: number;
  createdAt: Date;
  lockedAt?: Date;
  resolvedAt?: Date;
  createdBy: string;
}

interface PredictionOutcome {
  id: number;
  title: string;
  bets: Map<string, number>; // username -> amount
  totalPoints: number;
  color: string;
}

interface PredictionSettings {
  enabled: boolean;
  defaultDuration: number; // seconds before auto-lock
  maxBetAmount: number;
  minBetAmount: number;
  allowMultipleBets: boolean;
}

const DEFAULT_SETTINGS: PredictionSettings = {
  enabled: true,
  defaultDuration: 120,
  maxBetAmount: 10000,
  minBetAmount: 10,
  allowMultipleBets: false,
};

export class PredictionsPlugin extends Plugin {
  meta: PluginMeta = {
    name: 'predictions',
    version: '1.0.0',
    description: 'Channel point predictions system',
    author: 'StreamCore',
  };

  private db!: DatabaseService;
  private settings: PredictionSettings = DEFAULT_SETTINGS;
  private activePrediction: Prediction | null = null;
  private autoLockTimer?: NodeJS.Timeout;

  protected async init(): Promise<void> {
    this.db = getDatabase();
    this.log.info('Initializing Predictions...');

    this.initTables();
    this.loadSettings();
    this.registerCommands();

    this.log.info('Predictions initialized!');
  }

  protected async destroy(): Promise<void> {
    if (this.autoLockTimer) {
      clearTimeout(this.autoLockTimer);
    }
  }

  private initTables(): void {
    const db = this.db.raw();
    db.exec(`
      CREATE TABLE IF NOT EXISTS predictions (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        outcomes TEXT NOT NULL,
        status TEXT DEFAULT 'active',
        winning_outcome INTEGER,
        created_by TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        locked_at DATETIME,
        resolved_at DATETIME
      );

      CREATE TABLE IF NOT EXISTS prediction_bets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        prediction_id TEXT NOT NULL,
        username TEXT NOT NULL,
        outcome_id INTEGER NOT NULL,
        amount INTEGER NOT NULL,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (prediction_id) REFERENCES predictions(id)
      );
    `);
  }

  private loadSettings(): void {
    const saved = this.db.getSetting<PredictionSettings>('prediction_settings');
    if (saved) {
      this.settings = { ...DEFAULT_SETTINGS, ...saved };
    }
  }

  private registerCommands(): void {
    // !prediction - Create a prediction (mod)
    this.registerCommand({
      name: 'prediction',
      aliases: ['pred', 'vorhersage'],
      description: 'Create or manage predictions',
      usage: '!prediction <title> | <outcome1> | <outcome2>',
      permission: Permission.MODERATOR,
      cooldown: { user: 5, global: 0 },
      handler: async (ctx) => {
        if (ctx.args.length === 0) {
          if (this.activePrediction) {
            this.showPredictionStatus(ctx);
          } else {
            ctx.reply('Verwendung: !prediction <titel> | <option1> | <option2>');
          }
          return;
        }

        if (this.activePrediction && this.activePrediction.status === 'active') {
          ctx.reply('❌ Es läuft bereits eine Prediction!');
          return;
        }

        // Parse prediction: "title | outcome1 | outcome2"
        const parts = ctx.args.join(' ').split('|').map((s) => s.trim());

        if (parts.length < 3) {
          ctx.reply('Verwendung: !prediction <titel> | <option1> | <option2>');
          return;
        }

        const [title, ...outcomeStrings] = parts;
        const outcomes: PredictionOutcome[] = outcomeStrings.slice(0, 10).map((o, i) => ({
          id: i + 1,
          title: o,
          bets: new Map(),
          totalPoints: 0,
          color: ['blue', 'pink', 'green', 'orange', 'purple'][i % 5],
        }));

        this.activePrediction = {
          id: `pred_${Date.now()}`,
          title,
          outcomes,
          status: 'active',
          createdAt: new Date(),
          createdBy: ctx.user.username,
        };

        // Save to database
        this.savePrediction();

        // Build outcome string
        const outcomeList = outcomes.map((o) => `[${o.id}] ${o.title}`).join(' | ');

        ctx.reply(
          `🎯 PREDICTION: ${title} | ${outcomeList} | ` +
          `Stimme mit !bet <nummer> <punkte> ab!`
        );

        // Auto-lock timer
        this.autoLockTimer = setTimeout(() => {
          if (this.activePrediction?.status === 'active') {
            this.lockPrediction(ctx.channel);
          }
        }, this.settings.defaultDuration * 1000);
      },
    });

    // !bet - Place a bet
    this.registerCommand({
      name: 'bet',
      aliases: ['wette', 'predict'],
      description: 'Place a bet on a prediction',
      usage: '!bet <outcome> <amount>',
      cooldown: { user: 5, global: 0 },
      handler: async (ctx) => {
        if (!this.activePrediction || this.activePrediction.status !== 'active') {
          ctx.reply('❌ Keine aktive Prediction');
          return;
        }

        if (ctx.args.length < 2) {
          ctx.reply('Verwendung: !bet <nummer> <punkte>');
          return;
        }

        const outcomeId = parseInt(ctx.args[0]);
        const amount = ctx.args[1].toLowerCase() === 'all'
          ? this.db.getUser('twitch', ctx.user.username)?.points || 0
          : parseInt(ctx.args[1]);

        const outcome = this.activePrediction.outcomes.find((o) => o.id === outcomeId);

        if (!outcome) {
          ctx.reply('❌ Ungültige Option');
          return;
        }

        if (isNaN(amount) || amount < this.settings.minBetAmount) {
          ctx.reply(`❌ Minimum: ${this.settings.minBetAmount} Punkte`);
          return;
        }

        if (amount > this.settings.maxBetAmount) {
          ctx.reply(`❌ Maximum: ${this.settings.maxBetAmount} Punkte`);
          return;
        }

        // Check if already bet
        if (!this.settings.allowMultipleBets) {
          for (const o of this.activePrediction.outcomes) {
            if (o.bets.has(ctx.user.username.toLowerCase())) {
              ctx.reply('❌ Du hast bereits gewettet!');
              return;
            }
          }
        }

        // Check points
        const user = this.db.getUser('twitch', ctx.user.username);
        if (!user || user.points < amount) {
          ctx.reply('❌ Nicht genug Punkte');
          return;
        }

        // Place bet
        this.db.updateUserPoints('twitch', ctx.user.username, -amount);
        outcome.bets.set(ctx.user.username.toLowerCase(), amount);
        outcome.totalPoints += amount;

        // Save bet
        this.saveBet(ctx.user.username, outcomeId, amount);

        ctx.reply(
          `✅ ${ctx.user.displayName} setzt ${amount} Punkte auf "${outcome.title}"!`
        );
      },
    });

    // !lockpred - Lock prediction (mod)
    this.registerCommand({
      name: 'lockpred',
      aliases: ['lockprediction'],
      description: 'Lock the current prediction',
      permission: Permission.MODERATOR,
      cooldown: { user: 5, global: 0 },
      handler: async (ctx) => {
        if (!this.activePrediction || this.activePrediction.status !== 'active') {
          ctx.reply('❌ Keine aktive Prediction');
          return;
        }

        this.lockPrediction(ctx.channel);
      },
    });

    // !resolve - Resolve prediction (mod)
    this.registerCommand({
      name: 'resolve',
      aliases: ['winner', 'gewinner'],
      description: 'Resolve prediction with winner',
      usage: '!resolve <outcome>',
      permission: Permission.MODERATOR,
      cooldown: { user: 5, global: 0 },
      handler: async (ctx) => {
        if (!this.activePrediction) {
          ctx.reply('❌ Keine Prediction vorhanden');
          return;
        }

        if (this.activePrediction.status === 'resolved') {
          ctx.reply('❌ Prediction bereits aufgelöst');
          return;
        }

        if (ctx.args.length === 0) {
          ctx.reply('Verwendung: !resolve <nummer>');
          return;
        }

        const outcomeId = parseInt(ctx.args[0]);
        const outcome = this.activePrediction.outcomes.find((o) => o.id === outcomeId);

        if (!outcome) {
          ctx.reply('❌ Ungültige Option');
          return;
        }

        this.resolvePrediction(outcomeId, ctx.channel);
      },
    });

    // !cancelpred - Cancel prediction (mod)
    this.registerCommand({
      name: 'cancelpred',
      aliases: ['cancelprediction'],
      description: 'Cancel and refund prediction',
      permission: Permission.MODERATOR,
      cooldown: { user: 5, global: 0 },
      handler: async (ctx) => {
        if (!this.activePrediction) {
          ctx.reply('❌ Keine Prediction vorhanden');
          return;
        }

        this.cancelPrediction(ctx.channel);
      },
    });

    // !predstatus - Show prediction status
    this.registerCommand({
      name: 'predstatus',
      aliases: ['predinfo'],
      description: 'Show current prediction status',
      cooldown: { user: 10, global: 5 },
      handler: async (ctx) => {
        this.showPredictionStatus(ctx);
      },
    });
  }

  private showPredictionStatus(ctx: any): void {
    if (!this.activePrediction) {
      ctx.reply('🎯 Keine aktive Prediction');
      return;
    }

    const total = this.activePrediction.outcomes.reduce((sum, o) => sum + o.totalPoints, 0);
    const outcomeStats = this.activePrediction.outcomes.map((o) => {
      const percent = total > 0 ? Math.round((o.totalPoints / total) * 100) : 0;
      return `[${o.id}] ${o.title}: ${o.totalPoints}P (${percent}%)`;
    }).join(' | ');

    ctx.reply(
      `🎯 ${this.activePrediction.title} [${this.activePrediction.status}] | ` +
      `${outcomeStats} | Total: ${total}P`
    );
  }

  private lockPrediction(channel: string): void {
    if (!this.activePrediction) return;

    this.activePrediction.status = 'locked';
    this.activePrediction.lockedAt = new Date();

    if (this.autoLockTimer) {
      clearTimeout(this.autoLockTimer);
    }

    this.updatePrediction();

    this.sendMessage(channel, '🔒 Prediction geschlossen! Keine weiteren Wetten möglich.');
  }

  private resolvePrediction(winningOutcome: number, channel: string): void {
    if (!this.activePrediction) return;

    const winner = this.activePrediction.outcomes.find((o) => o.id === winningOutcome);
    if (!winner) return;

    this.activePrediction.status = 'resolved';
    this.activePrediction.winningOutcome = winningOutcome;
    this.activePrediction.resolvedAt = new Date();

    // Calculate and distribute winnings
    const totalPot = this.activePrediction.outcomes.reduce((sum, o) => sum + o.totalPoints, 0);
    const winnerPot = winner.totalPoints;

    if (winnerPot > 0) {
      for (const [username, betAmount] of winner.bets.entries()) {
        const ratio = betAmount / winnerPot;
        const winnings = Math.floor(totalPot * ratio);

        this.db.updateUserPoints('twitch', username, winnings);

        this.log.info(`Prediction payout: ${username} wins ${winnings}`);
      }
    }

    this.updatePrediction();

    this.sendMessage(
      channel,
      `🏆 "${winner.title}" gewinnt! ${winner.bets.size} Gewinner teilen sich ${totalPot} Punkte!`
    );

    this.activePrediction = null;
  }

  private cancelPrediction(channel: string): void {
    if (!this.activePrediction) return;

    // Refund all bets
    for (const outcome of this.activePrediction.outcomes) {
      for (const [username, amount] of outcome.bets.entries()) {
        this.db.updateUserPoints('twitch', username, amount);
      }
    }

    this.activePrediction.status = 'cancelled';
    this.updatePrediction();

    this.sendMessage(channel, '❌ Prediction abgebrochen. Alle Wetten wurden erstattet.');

    this.activePrediction = null;
  }

  private savePrediction(): void {
    if (!this.activePrediction) return;

    const db = this.db.raw();
    const stmt = db.prepare(`
      INSERT INTO predictions (id, title, outcomes, status, created_by)
      VALUES (?, ?, ?, ?, ?)
    `);
    stmt.run(
      this.activePrediction.id,
      this.activePrediction.title,
      JSON.stringify(this.activePrediction.outcomes.map((o) => ({
        id: o.id,
        title: o.title,
        color: o.color,
      }))),
      this.activePrediction.status,
      this.activePrediction.createdBy
    );
  }

  private updatePrediction(): void {
    if (!this.activePrediction) return;

    const db = this.db.raw();
    const stmt = db.prepare(`
      UPDATE predictions SET status = ?, winning_outcome = ?, locked_at = ?, resolved_at = ?
      WHERE id = ?
    `);
    stmt.run(
      this.activePrediction.status,
      this.activePrediction.winningOutcome,
      this.activePrediction.lockedAt?.toISOString(),
      this.activePrediction.resolvedAt?.toISOString(),
      this.activePrediction.id
    );
  }

  private saveBet(username: string, outcomeId: number, amount: number): void {
    if (!this.activePrediction) return;

    const db = this.db.raw();
    const stmt = db.prepare(`
      INSERT INTO prediction_bets (prediction_id, username, outcome_id, amount)
      VALUES (?, ?, ?, ?)
    `);
    stmt.run(this.activePrediction.id, username.toLowerCase(), outcomeId, amount);
  }

  // Public API
  getActivePrediction(): Prediction | null {
    return this.activePrediction;
  }

  isActive(): boolean {
    return this.activePrediction !== null && this.activePrediction.status === 'active';
  }
}
