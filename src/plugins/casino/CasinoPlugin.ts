/**
 * Casino Plugin
 *
 * Chat gambling games using channel points
 * Features:
 * - Slots machine
 * - Dice rolling
 * - Coin flip
 * - Roulette
 * - Jackpot system
 */

import { Plugin } from '../base/Plugin';
import { PluginMeta, Permission } from '../../types/plugins';
import { getDatabase, DatabaseService } from '../../services/Database';

interface CasinoSettings {
  enabled: boolean;
  minBet: number;
  maxBet: number;
  cooldownSeconds: number;
  jackpotEnabled: boolean;
  jackpotContribution: number; // percentage of losses
  houseEdge: number; // percentage
}

interface JackpotState {
  amount: number;
  lastWinner: string;
  lastWinAmount: number;
  lastWinTime: Date | null;
}

const DEFAULT_SETTINGS: CasinoSettings = {
  enabled: true,
  minBet: 10,
  maxBet: 10000,
  cooldownSeconds: 5,
  jackpotEnabled: true,
  jackpotContribution: 5,
  houseEdge: 2,
};

const SLOT_SYMBOLS = ['🍒', '🍋', '🍊', '🍇', '💎', '7️⃣', '🎰'];
const SLOT_PAYOUTS: Record<string, number> = {
  '🍒🍒🍒': 5,
  '🍋🍋🍋': 8,
  '🍊🍊🍊': 10,
  '🍇🍇🍇': 15,
  '💎💎💎': 25,
  '7️⃣7️⃣7️⃣': 50,
  '🎰🎰🎰': 100, // Jackpot!
};

export class CasinoPlugin extends Plugin {
  meta: PluginMeta = {
    name: 'casino',
    version: '1.0.0',
    description: 'Casino games with channel points',
    author: 'StreamCore',
  };

  private db!: DatabaseService;
  private settings: CasinoSettings = DEFAULT_SETTINGS;
  private jackpot: JackpotState = {
    amount: 1000,
    lastWinner: '',
    lastWinAmount: 0,
    lastWinTime: null,
  };
  private cooldowns: Map<string, number> = new Map();

  protected async init(): Promise<void> {
    this.db = getDatabase();
    this.log.info('Initializing Casino...');

    this.loadSettings();
    this.loadJackpot();
    this.registerCommands();

    this.log.info('Casino initialized!');
  }

  protected async destroy(): Promise<void> {
    this.saveJackpot();
  }

  private loadSettings(): void {
    const saved = this.db.getSetting<CasinoSettings>('casino_settings');
    if (saved) {
      this.settings = { ...DEFAULT_SETTINGS, ...saved };
    }
  }

  private saveSettings(): void {
    this.db.setSetting('casino_settings', this.settings);
  }

  private loadJackpot(): void {
    const saved = this.db.getSetting<JackpotState>('casino_jackpot');
    if (saved) {
      this.jackpot = {
        ...saved,
        lastWinTime: saved.lastWinTime ? new Date(saved.lastWinTime) : null,
      };
    }
  }

  private saveJackpot(): void {
    this.db.setSetting('casino_jackpot', this.jackpot);
  }

  private checkCooldown(username: string): boolean {
    const lastPlay = this.cooldowns.get(username.toLowerCase()) || 0;
    const now = Date.now();

    if (now - lastPlay < this.settings.cooldownSeconds * 1000) {
      return false;
    }

    this.cooldowns.set(username.toLowerCase(), now);
    return true;
  }

  private validateBet(username: string, amount: number): { valid: boolean; error?: string; points?: number } {
    if (amount < this.settings.minBet) {
      return { valid: false, error: `Minimum: ${this.settings.minBet} Punkte` };
    }

    if (amount > this.settings.maxBet) {
      return { valid: false, error: `Maximum: ${this.settings.maxBet} Punkte` };
    }

    const user = this.db.getUser('twitch', username);
    if (!user || user.points < amount) {
      return { valid: false, error: 'Nicht genug Punkte!' };
    }

    return { valid: true, points: user.points };
  }

  private addToJackpot(amount: number): void {
    if (this.settings.jackpotEnabled) {
      const contribution = Math.floor(amount * (this.settings.jackpotContribution / 100));
      this.jackpot.amount += contribution;
      this.saveJackpot();
    }
  }

  private winJackpot(username: string): number {
    const won = this.jackpot.amount;
    this.jackpot.lastWinner = username;
    this.jackpot.lastWinAmount = won;
    this.jackpot.lastWinTime = new Date();
    this.jackpot.amount = 1000; // Reset jackpot
    this.saveJackpot();
    return won;
  }

  private registerCommands(): void {
    // !slots - Play slots
    this.registerCommand({
      name: 'slots',
      aliases: ['slot', 'spin'],
      description: 'Play the slot machine',
      usage: '!slots <amount>',
      cooldown: { user: 0, global: 0 }, // We handle cooldown ourselves
      handler: async (ctx) => {
        if (!this.settings.enabled) {
          ctx.reply('🎰 Casino ist deaktiviert');
          return;
        }

        if (!this.checkCooldown(ctx.user.username)) {
          ctx.reply(`⏳ Warte ${this.settings.cooldownSeconds}s zwischen Spielen`);
          return;
        }

        const amount = parseInt(ctx.args[0]) || this.settings.minBet;
        const validation = this.validateBet(ctx.user.username, amount);

        if (!validation.valid) {
          ctx.reply(`❌ ${validation.error}`);
          return;
        }

        // Deduct bet
        this.db.updateUserPoints('twitch', ctx.user.username, -amount);

        // Spin the slots
        const result = [
          SLOT_SYMBOLS[Math.floor(Math.random() * SLOT_SYMBOLS.length)],
          SLOT_SYMBOLS[Math.floor(Math.random() * SLOT_SYMBOLS.length)],
          SLOT_SYMBOLS[Math.floor(Math.random() * SLOT_SYMBOLS.length)],
        ];

        const resultStr = result.join('');
        const payout = SLOT_PAYOUTS[resultStr];

        if (payout) {
          let winAmount = amount * payout;

          // Check for jackpot
          if (resultStr === '🎰🎰🎰' && this.settings.jackpotEnabled) {
            winAmount += this.winJackpot(ctx.user.username);
            ctx.reply(`🎰 ${result.join(' ')} 🎰 JACKPOT!!! ${ctx.user.displayName} gewinnt ${winAmount.toLocaleString()} Punkte! 🎉🎉🎉`);
          } else {
            ctx.reply(`🎰 ${result.join(' ')} 🎰 ${ctx.user.displayName} gewinnt ${winAmount.toLocaleString()} Punkte! (${payout}x)`);
          }

          this.db.updateUserPoints('twitch', ctx.user.username, winAmount);
          this.db.logEvent('casino_win', { game: 'slots', user: ctx.user.username, bet: amount, win: winAmount });
        } else {
          // Check for partial matches (2 of a kind)
          if (result[0] === result[1] || result[1] === result[2]) {
            const partialWin = Math.floor(amount * 0.5);
            this.db.updateUserPoints('twitch', ctx.user.username, partialWin);
            ctx.reply(`🎰 ${result.join(' ')} 🎰 Fast! ${ctx.user.displayName} bekommt ${partialWin} Punkte zurück`);
          } else {
            this.addToJackpot(amount);
            ctx.reply(`🎰 ${result.join(' ')} 🎰 ${ctx.user.displayName} verliert ${amount} Punkte. Jackpot: ${this.jackpot.amount.toLocaleString()}`);
          }
          this.db.logEvent('casino_loss', { game: 'slots', user: ctx.user.username, bet: amount });
        }
      },
    });

    // !dice - Roll dice
    this.registerCommand({
      name: 'dice',
      aliases: ['roll', 'würfel'],
      description: 'Roll the dice - guess higher or lower than 50',
      usage: '!dice <high|low> <amount>',
      cooldown: { user: 0, global: 0 },
      handler: async (ctx) => {
        if (!this.settings.enabled) {
          ctx.reply('🎲 Casino ist deaktiviert');
          return;
        }

        if (!this.checkCooldown(ctx.user.username)) {
          ctx.reply(`⏳ Warte ${this.settings.cooldownSeconds}s zwischen Spielen`);
          return;
        }

        const choice = ctx.args[0]?.toLowerCase();
        const amount = parseInt(ctx.args[1]) || this.settings.minBet;

        if (!choice || !['high', 'low', 'hoch', 'niedrig', 'h', 'l'].includes(choice)) {
          ctx.reply('Verwendung: !dice <high|low> <amount>');
          return;
        }

        const validation = this.validateBet(ctx.user.username, amount);
        if (!validation.valid) {
          ctx.reply(`❌ ${validation.error}`);
          return;
        }

        // Deduct bet
        this.db.updateUserPoints('twitch', ctx.user.username, -amount);

        // Roll the dice (1-100)
        const roll = Math.floor(Math.random() * 100) + 1;
        const isHigh = ['high', 'hoch', 'h'].includes(choice);
        const won = (isHigh && roll > 50) || (!isHigh && roll < 50);

        if (roll === 50) {
          // Push - return bet
          this.db.updateUserPoints('twitch', ctx.user.username, amount);
          ctx.reply(`🎲 Würfel: ${roll} - Unentschieden! Einsatz zurück`);
        } else if (won) {
          const winAmount = Math.floor(amount * 1.9); // 1.9x payout
          this.db.updateUserPoints('twitch', ctx.user.username, winAmount);
          ctx.reply(`🎲 Würfel: ${roll} - ${ctx.user.displayName} gewinnt ${winAmount.toLocaleString()} Punkte! 🎉`);
          this.db.logEvent('casino_win', { game: 'dice', user: ctx.user.username, bet: amount, win: winAmount, roll });
        } else {
          this.addToJackpot(amount);
          ctx.reply(`🎲 Würfel: ${roll} - ${ctx.user.displayName} verliert ${amount} Punkte`);
          this.db.logEvent('casino_loss', { game: 'dice', user: ctx.user.username, bet: amount, roll });
        }
      },
    });

    // !coinflip - Flip a coin
    this.registerCommand({
      name: 'coinflip',
      aliases: ['flip', 'münze', 'cf'],
      description: 'Flip a coin - heads or tails',
      usage: '!coinflip <heads|tails> <amount>',
      cooldown: { user: 0, global: 0 },
      handler: async (ctx) => {
        if (!this.settings.enabled) {
          ctx.reply('🪙 Casino ist deaktiviert');
          return;
        }

        if (!this.checkCooldown(ctx.user.username)) {
          ctx.reply(`⏳ Warte ${this.settings.cooldownSeconds}s zwischen Spielen`);
          return;
        }

        const choice = ctx.args[0]?.toLowerCase();
        const amount = parseInt(ctx.args[1]) || this.settings.minBet;

        if (!choice || !['heads', 'tails', 'kopf', 'zahl', 'h', 't', 'k', 'z'].includes(choice)) {
          ctx.reply('Verwendung: !coinflip <heads|tails> <amount>');
          return;
        }

        const validation = this.validateBet(ctx.user.username, amount);
        if (!validation.valid) {
          ctx.reply(`❌ ${validation.error}`);
          return;
        }

        // Deduct bet
        this.db.updateUserPoints('twitch', ctx.user.username, -amount);

        // Flip the coin
        const result = Math.random() < 0.5 ? 'heads' : 'tails';
        const resultEmoji = result === 'heads' ? '👑' : '🔢';
        const resultText = result === 'heads' ? 'Kopf' : 'Zahl';

        const choiceIsHeads = ['heads', 'kopf', 'h', 'k'].includes(choice);
        const won = (choiceIsHeads && result === 'heads') || (!choiceIsHeads && result === 'tails');

        if (won) {
          const winAmount = Math.floor(amount * 1.95); // 1.95x payout
          this.db.updateUserPoints('twitch', ctx.user.username, winAmount);
          ctx.reply(`🪙 ${resultEmoji} ${resultText}! ${ctx.user.displayName} gewinnt ${winAmount.toLocaleString()} Punkte! 🎉`);
        } else {
          this.addToJackpot(amount);
          ctx.reply(`🪙 ${resultEmoji} ${resultText}! ${ctx.user.displayName} verliert ${amount} Punkte`);
        }
      },
    });

    // !roulette - Roulette game
    this.registerCommand({
      name: 'roulette',
      aliases: ['rl'],
      description: 'Play roulette',
      usage: '!roulette <red|black|green|number> <amount>',
      cooldown: { user: 0, global: 0 },
      handler: async (ctx) => {
        if (!this.settings.enabled) {
          ctx.reply('🎡 Casino ist deaktiviert');
          return;
        }

        if (!this.checkCooldown(ctx.user.username)) {
          ctx.reply(`⏳ Warte ${this.settings.cooldownSeconds}s zwischen Spielen`);
          return;
        }

        const choice = ctx.args[0]?.toLowerCase();
        const amount = parseInt(ctx.args[1]) || this.settings.minBet;

        if (!choice) {
          ctx.reply('Verwendung: !roulette <red|black|green|0-36> <amount>');
          return;
        }

        const validation = this.validateBet(ctx.user.username, amount);
        if (!validation.valid) {
          ctx.reply(`❌ ${validation.error}`);
          return;
        }

        // Deduct bet
        this.db.updateUserPoints('twitch', ctx.user.username, -amount);

        // Spin the wheel (0-36)
        const result = Math.floor(Math.random() * 37);
        const redNumbers = [1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36];
        const isRed = redNumbers.includes(result);
        const isGreen = result === 0;
        const color = isGreen ? '🟢' : isRed ? '🔴' : '⚫';
        const colorName = isGreen ? 'Grün' : isRed ? 'Rot' : 'Schwarz';

        let won = false;
        let multiplier = 0;

        // Check bet
        const choiceNum = parseInt(choice);
        if (!isNaN(choiceNum) && choiceNum >= 0 && choiceNum <= 36) {
          // Bet on specific number (35x)
          if (result === choiceNum) {
            won = true;
            multiplier = 35;
          }
        } else if (['red', 'rot', 'r'].includes(choice)) {
          if (isRed) {
            won = true;
            multiplier = 2;
          }
        } else if (['black', 'schwarz', 'b', 's'].includes(choice)) {
          if (!isRed && !isGreen) {
            won = true;
            multiplier = 2;
          }
        } else if (['green', 'grün', 'g', '0'].includes(choice)) {
          if (isGreen) {
            won = true;
            multiplier = 14;
          }
        } else {
          ctx.reply('❌ Ungültige Wahl (red, black, green, oder 0-36)');
          this.db.updateUserPoints('twitch', ctx.user.username, amount); // Refund
          return;
        }

        if (won) {
          const winAmount = amount * multiplier;
          this.db.updateUserPoints('twitch', ctx.user.username, winAmount);
          ctx.reply(`🎡 ${color} ${result} (${colorName}) - ${ctx.user.displayName} gewinnt ${winAmount.toLocaleString()} Punkte! (${multiplier}x) 🎉`);
        } else {
          this.addToJackpot(amount);
          ctx.reply(`🎡 ${color} ${result} (${colorName}) - ${ctx.user.displayName} verliert ${amount} Punkte`);
        }
      },
    });

    // !jackpot - View jackpot
    this.registerCommand({
      name: 'jackpot',
      aliases: ['jp'],
      description: 'View the current jackpot',
      cooldown: { user: 10, global: 5 },
      handler: async (ctx) => {
        if (!this.settings.jackpotEnabled) {
          ctx.reply('🎰 Jackpot ist deaktiviert');
          return;
        }

        let message = `🎰 Aktueller Jackpot: ${this.jackpot.amount.toLocaleString()} Punkte`;

        if (this.jackpot.lastWinner) {
          message += ` | Letzter Gewinner: ${this.jackpot.lastWinner} (${this.jackpot.lastWinAmount.toLocaleString()})`;
        }

        ctx.reply(message);
      },
    });

    // !casinostats - View casino statistics
    this.registerCommand({
      name: 'casinostats',
      aliases: ['gambstats'],
      description: 'View your casino statistics',
      cooldown: { user: 30, global: 0 },
      handler: async (ctx) => {
        const db = this.db.raw();
        const username = ctx.args[0]?.toLowerCase().replace('@', '') || ctx.user.username.toLowerCase();

        const wins = db.prepare(`
          SELECT COUNT(*) as count, SUM(json_extract(data, '$.win')) as total
          FROM events
          WHERE type = 'casino_win' AND json_extract(data, '$.user') = ?
        `).get(username) as any;

        const losses = db.prepare(`
          SELECT COUNT(*) as count, SUM(json_extract(data, '$.bet')) as total
          FROM events
          WHERE type = 'casino_loss' AND json_extract(data, '$.user') = ?
        `).get(username) as any;

        const winCount = wins?.count || 0;
        const lossCount = losses?.count || 0;
        const totalGames = winCount + lossCount;
        const winRate = totalGames > 0 ? ((winCount / totalGames) * 100).toFixed(1) : 0;
        const netProfit = (wins?.total || 0) - (losses?.total || 0);

        ctx.reply(
          `🎰 ${username}: ${winCount}W/${lossCount}L (${winRate}%) | ` +
          `Netto: ${netProfit >= 0 ? '+' : ''}${netProfit.toLocaleString()} Punkte`
        );
      },
    });

    // !casinoconfig - Configure casino
    this.registerCommand({
      name: 'casinoconfig',
      description: 'Configure casino settings',
      permission: Permission.BROADCASTER,
      cooldown: { user: 5, global: 0 },
      handler: async (ctx) => {
        const setting = ctx.args[0]?.toLowerCase();
        const value = ctx.args[1];

        if (!setting) {
          ctx.reply(
            `🎰 Config: Min=${this.settings.minBet} | Max=${this.settings.maxBet} | ` +
            `Cooldown=${this.settings.cooldownSeconds}s | Jackpot=${this.settings.jackpotEnabled ? 'An' : 'Aus'}`
          );
          return;
        }

        switch (setting) {
          case 'min':
            this.settings.minBet = parseInt(value) || 10;
            ctx.reply(`✅ Min Bet: ${this.settings.minBet}`);
            break;
          case 'max':
            this.settings.maxBet = parseInt(value) || 10000;
            ctx.reply(`✅ Max Bet: ${this.settings.maxBet}`);
            break;
          case 'cooldown':
            this.settings.cooldownSeconds = parseInt(value) || 5;
            ctx.reply(`✅ Cooldown: ${this.settings.cooldownSeconds}s`);
            break;
          case 'jackpot':
            this.settings.jackpotEnabled = value === 'on' || value === 'an';
            ctx.reply(`✅ Jackpot: ${this.settings.jackpotEnabled ? 'An' : 'Aus'}`);
            break;
          case 'toggle':
            this.settings.enabled = !this.settings.enabled;
            ctx.reply(`✅ Casino: ${this.settings.enabled ? 'An' : 'Aus'}`);
            break;
          default:
            ctx.reply('❌ Unbekannt (min, max, cooldown, jackpot, toggle)');
            return;
        }

        this.saveSettings();
      },
    });
  }

  // Public API
  getJackpot(): number {
    return this.jackpot.amount;
  }

  addJackpot(amount: number): void {
    this.jackpot.amount += amount;
    this.saveJackpot();
  }
}
