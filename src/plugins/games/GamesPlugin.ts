/**
 * Games Plugin
 *
 * Chat minigames:
 * - Duel - 1v1 point battles
 * - Heist - Group gambling
 * - Trivia - Quiz questions
 * - Slots - Slot machine
 * - Roulette - Red/Black betting
 */

import { Plugin } from '../base/Plugin';
import { PluginMeta, Permission } from '../../types/plugins';
import { getDatabase, DatabaseService } from '../../services/Database';

// Trivia questions
const TRIVIA_QUESTIONS = [
  { q: 'Was ist die Hauptstadt von Deutschland?', a: ['berlin'] },
  { q: 'Wie viele Planeten hat unser Sonnensystem?', a: ['8', 'acht'] },
  { q: 'Wer malte die Mona Lisa?', a: ['da vinci', 'leonardo', 'leonardo da vinci'] },
  { q: 'In welchem Jahr fiel die Berliner Mauer?', a: ['1989'] },
  { q: 'Was ist die chemische Formel für Wasser?', a: ['h2o'] },
  { q: 'Wie viele Kontinente gibt es?', a: ['7', 'sieben'] },
  { q: 'Wer schrieb "Faust"?', a: ['goethe', 'johann wolfgang von goethe'] },
  { q: 'Was ist die größte Wüste der Welt?', a: ['sahara'] },
  { q: 'Wie heißt der höchste Berg der Erde?', a: ['mount everest', 'everest'] },
  { q: 'In welchem Jahr wurde YouTube gegründet?', a: ['2005'] },
  { q: 'Wie viele Sekunden hat eine Stunde?', a: ['3600'] },
  { q: 'Was ist 7 x 8?', a: ['56'] },
  { q: 'Welches Element hat das Symbol "Au"?', a: ['gold'] },
  { q: 'Wie heißt die Hauptstadt von Japan?', a: ['tokyo', 'tokio'] },
  { q: 'Wer erfand die Glühbirne?', a: ['edison', 'thomas edison'] },
];

const SLOT_SYMBOLS = ['🍒', '🍋', '🍊', '🍇', '💎', '7️⃣', '🔔', '⭐'];
const SLOT_PAYOUTS: Record<string, number> = {
  '🍒🍒🍒': 5,
  '🍋🍋🍋': 10,
  '🍊🍊🍊': 15,
  '🍇🍇🍇': 20,
  '🔔🔔🔔': 30,
  '⭐⭐⭐': 50,
  '💎💎💎': 100,
  '7️⃣7️⃣7️⃣': 500,
};

interface ActiveDuel {
  challenger: string;
  target: string;
  amount: number;
  timestamp: number;
}

interface ActiveHeist {
  starter: string;
  participants: Map<string, number>; // username -> amount
  timestamp: number;
}

interface ActiveTrivia {
  question: string;
  answers: string[];
  reward: number;
  timestamp: number;
}

export class GamesPlugin extends Plugin {
  meta: PluginMeta = {
    name: 'games',
    version: '1.0.0',
    description: 'Chat minigames (Duel, Heist, Trivia, Slots, Roulette)',
    author: 'StreamCore',
  };

  private db!: DatabaseService;
  private activeDuels: Map<string, ActiveDuel> = new Map();
  private activeHeist: ActiveHeist | null = null;
  private activeTrivia: ActiveTrivia | null = null;
  private heistTimeout?: NodeJS.Timeout;
  private triviaTimeout?: NodeJS.Timeout;

  protected async init(): Promise<void> {
    this.db = getDatabase();
    this.log.info('Initializing Games system...');
    this.registerCommands();
    this.log.info('Games system initialized!');
  }

  protected async destroy(): Promise<void> {
    if (this.heistTimeout) clearTimeout(this.heistTimeout);
    if (this.triviaTimeout) clearTimeout(this.triviaTimeout);
  }

  private registerCommands(): void {
    // ==========================================
    // DUEL SYSTEM
    // ==========================================

    this.registerCommand({
      name: 'duel',
      aliases: ['battle', 'fight'],
      description: 'Challenge someone to a duel',
      usage: '!duel <user> <amount>',
      cooldown: { user: 30, global: 0 },
      handler: async (ctx) => {
        if (ctx.args.length < 2) {
          ctx.reply('Verwendung: !duel <user> <menge>');
          return;
        }

        const targetName = ctx.args[0].replace('@', '').toLowerCase();
        const amount = parseInt(ctx.args[1]);

        if (targetName === ctx.user.username.toLowerCase()) {
          ctx.reply('❌ Du kannst dich nicht selbst herausfordern!');
          return;
        }

        if (isNaN(amount) || amount < 10) {
          ctx.reply('❌ Minimum 10 Punkte!');
          return;
        }

        const challenger = this.db.getUser('twitch', ctx.user.username);
        if (!challenger || challenger.points < amount) {
          ctx.reply('❌ Du hast nicht genug Punkte!');
          return;
        }

        const target = this.db.getUser('twitch', targetName);
        if (!target) {
          ctx.reply('❌ Benutzer nicht gefunden!');
          return;
        }

        if (target.points < amount) {
          ctx.reply(`❌ ${targetName} hat nicht genug Punkte!`);
          return;
        }

        // Create duel challenge
        const duelKey = targetName;
        this.activeDuels.set(duelKey, {
          challenger: ctx.user.username,
          target: targetName,
          amount,
          timestamp: Date.now(),
        });

        // Auto-expire after 60 seconds
        setTimeout(() => {
          if (this.activeDuels.has(duelKey)) {
            this.activeDuels.delete(duelKey);
          }
        }, 60000);

        ctx.reply(
          `⚔️ ${ctx.user.displayName} fordert ${targetName} zu einem Duell heraus! ` +
          `Einsatz: ${amount} Punkte | ${targetName}, schreibe !accept um anzunehmen!`
        );
      },
    });

    this.registerCommand({
      name: 'accept',
      description: 'Accept a duel challenge',
      cooldown: { user: 5, global: 0 },
      handler: async (ctx) => {
        const duelKey = ctx.user.username.toLowerCase();
        const duel = this.activeDuels.get(duelKey);

        if (!duel) {
          ctx.reply('❌ Du hast keine offene Duell-Herausforderung!');
          return;
        }

        this.activeDuels.delete(duelKey);

        // Verify both still have points
        const challenger = this.db.getUser('twitch', duel.challenger);
        const target = this.db.getUser('twitch', duel.target);

        if (!challenger || challenger.points < duel.amount ||
            !target || target.points < duel.amount) {
          ctx.reply('❌ Nicht genug Punkte für das Duell!');
          return;
        }

        // Fight!
        const challengerWins = Math.random() < 0.5;
        const winner = challengerWins ? duel.challenger : duel.target;
        const loser = challengerWins ? duel.target : duel.challenger;

        this.db.updateUserPoints('twitch', winner, duel.amount);
        this.db.updateUserPoints('twitch', loser, -duel.amount);

        ctx.reply(
          `⚔️ DUELL! ${duel.challenger} vs ${duel.target} | ` +
          `🏆 ${winner} gewinnt ${duel.amount} Punkte!`
        );
      },
    });

    // ==========================================
    // HEIST SYSTEM
    // ==========================================

    this.registerCommand({
      name: 'heist',
      aliases: ['bankheist', 'robbery'],
      description: 'Start or join a heist',
      usage: '!heist <amount>',
      cooldown: { user: 5, global: 0 },
      handler: async (ctx) => {
        if (ctx.args.length === 0) {
          ctx.reply('Verwendung: !heist <menge>');
          return;
        }

        const amount = parseInt(ctx.args[0]);
        if (isNaN(amount) || amount < 10) {
          ctx.reply('❌ Minimum 10 Punkte!');
          return;
        }

        const user = this.db.getUser('twitch', ctx.user.username);
        if (!user || user.points < amount) {
          ctx.reply('❌ Du hast nicht genug Punkte!');
          return;
        }

        if (!this.activeHeist) {
          // Start new heist
          this.activeHeist = {
            starter: ctx.user.username,
            participants: new Map(),
            timestamp: Date.now(),
          };

          this.activeHeist.participants.set(ctx.user.username, amount);

          ctx.reply(
            `🏦 ${ctx.user.displayName} startet einen BANKRAUB mit ${amount} Punkten! ` +
            `Schreibt !heist <menge> um mitzumachen! Startet in 60 Sekunden...`
          );

          // Execute heist after 60 seconds
          this.heistTimeout = setTimeout(() => {
            this.executeHeist(ctx.channel);
          }, 60000);

        } else {
          // Join existing heist
          if (this.activeHeist.participants.has(ctx.user.username)) {
            ctx.reply('❌ Du bist bereits beim Heist dabei!');
            return;
          }

          this.activeHeist.participants.set(ctx.user.username, amount);

          ctx.reply(
            `🏦 ${ctx.user.displayName} schließt sich dem Heist an! ` +
            `(${this.activeHeist.participants.size} Räuber, ` +
            `${this.getTotalHeistAmount()} Punkte im Spiel)`
          );
        }
      },
    });

    // ==========================================
    // TRIVIA SYSTEM
    // ==========================================

    this.registerCommand({
      name: 'trivia',
      aliases: ['quiz'],
      description: 'Start a trivia question',
      permission: Permission.MODERATOR,
      cooldown: { user: 0, global: 30 },
      handler: async (ctx) => {
        if (this.activeTrivia) {
          ctx.reply('❌ Es läuft bereits eine Trivia-Frage!');
          return;
        }

        const reward = parseInt(ctx.args[0]) || 50;
        const question = TRIVIA_QUESTIONS[Math.floor(Math.random() * TRIVIA_QUESTIONS.length)];

        this.activeTrivia = {
          question: question.q,
          answers: question.a,
          reward,
          timestamp: Date.now(),
        };

        ctx.reply(`❓ TRIVIA (${reward} Punkte): ${question.q}`);

        // Timeout after 30 seconds
        this.triviaTimeout = setTimeout(() => {
          if (this.activeTrivia) {
            this.sendMessage(ctx.channel, `⏰ Zeit abgelaufen! Antwort: ${question.a[0]}`);
            this.activeTrivia = null;
          }
        }, 30000);
      },
    });

    // Hook into chat messages for trivia answers
    this.registerCommand({
      name: 'answer',
      aliases: ['a'],
      description: 'Answer a trivia question',
      cooldown: { user: 2, global: 0 },
      handler: async (ctx) => {
        if (!this.activeTrivia) {
          return; // No active trivia
        }

        const answer = ctx.args.join(' ').toLowerCase();
        if (this.activeTrivia.answers.some(a => answer.includes(a))) {
          // Correct!
          clearTimeout(this.triviaTimeout);
          this.db.updateUserPoints('twitch', ctx.user.username, this.activeTrivia.reward);

          ctx.reply(
            `🎉 RICHTIG! ${ctx.user.displayName} gewinnt ${this.activeTrivia.reward} Punkte!`
          );

          this.activeTrivia = null;
        }
      },
    });

    // ==========================================
    // SLOTS SYSTEM
    // ==========================================

    this.registerCommand({
      name: 'slots',
      aliases: ['slot', 'spin'],
      description: 'Play the slot machine',
      usage: '!slots <amount>',
      cooldown: { user: 10, global: 0 },
      handler: async (ctx) => {
        if (ctx.args.length === 0) {
          ctx.reply('Verwendung: !slots <menge>');
          return;
        }

        const amount = parseInt(ctx.args[0]);
        if (isNaN(amount) || amount < 10) {
          ctx.reply('❌ Minimum 10 Punkte!');
          return;
        }

        const user = this.db.getUser('twitch', ctx.user.username);
        if (!user || user.points < amount) {
          ctx.reply('❌ Du hast nicht genug Punkte!');
          return;
        }

        // Deduct points
        this.db.updateUserPoints('twitch', ctx.user.username, -amount);

        // Spin the slots
        const reel1 = SLOT_SYMBOLS[Math.floor(Math.random() * SLOT_SYMBOLS.length)];
        const reel2 = SLOT_SYMBOLS[Math.floor(Math.random() * SLOT_SYMBOLS.length)];
        const reel3 = SLOT_SYMBOLS[Math.floor(Math.random() * SLOT_SYMBOLS.length)];

        const result = `${reel1}${reel2}${reel3}`;
        const multiplier = SLOT_PAYOUTS[result] || 0;

        if (multiplier > 0) {
          const winnings = amount * multiplier;
          this.db.updateUserPoints('twitch', ctx.user.username, winnings);

          ctx.reply(
            `🎰 [ ${reel1} | ${reel2} | ${reel3} ] ` +
            `JACKPOT! ${ctx.user.displayName} gewinnt ${winnings} Punkte! (x${multiplier})`
          );
        } else if (reel1 === reel2 || reel2 === reel3) {
          // Two matching - return bet
          this.db.updateUserPoints('twitch', ctx.user.username, amount);
          ctx.reply(
            `🎰 [ ${reel1} | ${reel2} | ${reel3} ] ` +
            `Fast! ${ctx.user.displayName} bekommt den Einsatz zurück.`
          );
        } else {
          ctx.reply(
            `🎰 [ ${reel1} | ${reel2} | ${reel3} ] ` +
            `${ctx.user.displayName} verliert ${amount} Punkte.`
          );
        }
      },
    });

    // ==========================================
    // ROULETTE SYSTEM
    // ==========================================

    this.registerCommand({
      name: 'roulette',
      aliases: ['roul', 'bet'],
      description: 'Play roulette',
      usage: '!roulette <rot/schwarz/zahl> <amount>',
      cooldown: { user: 10, global: 0 },
      handler: async (ctx) => {
        if (ctx.args.length < 2) {
          ctx.reply('Verwendung: !roulette <rot/schwarz/gerade/ungerade/0-36> <menge>');
          return;
        }

        const choice = ctx.args[0].toLowerCase();
        const amount = parseInt(ctx.args[1]);

        if (isNaN(amount) || amount < 10) {
          ctx.reply('❌ Minimum 10 Punkte!');
          return;
        }

        const user = this.db.getUser('twitch', ctx.user.username);
        if (!user || user.points < amount) {
          ctx.reply('❌ Du hast nicht genug Punkte!');
          return;
        }

        // Deduct bet
        this.db.updateUserPoints('twitch', ctx.user.username, -amount);

        // Spin the wheel
        const result = Math.floor(Math.random() * 37); // 0-36
        const isRed = [1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36].includes(result);
        const isBlack = result !== 0 && !isRed;
        const color = result === 0 ? '🟢' : isRed ? '🔴' : '⚫';

        let won = false;
        let multiplier = 0;

        // Check win conditions
        if (choice === 'rot' || choice === 'red') {
          won = isRed;
          multiplier = 2;
        } else if (choice === 'schwarz' || choice === 'black') {
          won = isBlack;
          multiplier = 2;
        } else if (choice === 'gerade' || choice === 'even') {
          won = result !== 0 && result % 2 === 0;
          multiplier = 2;
        } else if (choice === 'ungerade' || choice === 'odd') {
          won = result % 2 === 1;
          multiplier = 2;
        } else {
          // Specific number
          const num = parseInt(choice);
          if (!isNaN(num) && num >= 0 && num <= 36) {
            won = result === num;
            multiplier = 36;
          } else {
            ctx.reply('❌ Ungültige Wahl! Optionen: rot, schwarz, gerade, ungerade, 0-36');
            this.db.updateUserPoints('twitch', ctx.user.username, amount); // Refund
            return;
          }
        }

        if (won) {
          const winnings = amount * multiplier;
          this.db.updateUserPoints('twitch', ctx.user.username, winnings);
          ctx.reply(
            `🎲 ${color} ${result} - ${ctx.user.displayName} GEWINNT ${winnings} Punkte! (x${multiplier})`
          );
        } else {
          ctx.reply(
            `🎲 ${color} ${result} - ${ctx.user.displayName} verliert ${amount} Punkte.`
          );
        }
      },
    });
  }

  private getTotalHeistAmount(): number {
    if (!this.activeHeist) return 0;
    let total = 0;
    for (const amount of this.activeHeist.participants.values()) {
      total += amount;
    }
    return total;
  }

  private executeHeist(channel: string): void {
    if (!this.activeHeist) return;

    const participants = Array.from(this.activeHeist.participants.entries());
    const totalAmount = this.getTotalHeistAmount();

    // Success chance based on participants (more = higher chance, max 70%)
    const baseChance = 0.3;
    const bonusPerPlayer = 0.1;
    const successChance = Math.min(0.7, baseChance + (participants.length - 1) * bonusPerPlayer);

    const success = Math.random() < successChance;

    if (success) {
      // Heist successful! Double everyone's bet
      const multiplier = 1.5 + Math.random(); // 1.5x - 2.5x
      const winners: string[] = [];

      for (const [username, bet] of participants) {
        const winnings = Math.floor(bet * multiplier);
        this.db.updateUserPoints('twitch', username, winnings);
        winners.push(`${username} (+${winnings})`);
      }

      this.sendMessage(channel,
        `🏦💰 HEIST ERFOLGREICH! Beute: ${Math.floor(totalAmount * multiplier)} Punkte! ` +
        `Gewinner: ${winners.slice(0, 5).join(', ')}${winners.length > 5 ? ` +${winners.length - 5} mehr` : ''}`
      );
    } else {
      // Heist failed! Everyone loses their bet
      for (const [username, bet] of participants) {
        this.db.updateUserPoints('twitch', username, -bet);
      }

      this.sendMessage(channel,
        `🏦🚨 HEIST FEHLGESCHLAGEN! Die Polizei hat alle ${participants.length} Räuber erwischt! ` +
        `${totalAmount} Punkte verloren!`
      );
    }

    this.activeHeist = null;
  }
}
