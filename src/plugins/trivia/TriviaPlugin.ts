/**
 * Trivia Plugin
 *
 * Quiz games with various categories
 * Features:
 * - Multiple categories
 * - Timed questions
 * - Points rewards
 * - Leaderboard
 */

import { Plugin } from '../base/Plugin';
import { PluginMeta, Permission } from '../../types/plugins';
import { getDatabase, DatabaseService } from '../../services/Database';

interface TriviaQuestion {
  id: string;
  category: string;
  question: string;
  answer: string;
  alternatives: string[];
  difficulty: 'easy' | 'medium' | 'hard';
  points: number;
}

interface TriviaGame {
  active: boolean;
  question: TriviaQuestion | null;
  startTime: number;
  hints: number;
  answered: boolean;
  winner: string | null;
}

interface TriviaStats {
  username: string;
  correct: number;
  wrong: number;
  points: number;
  streak: number;
  bestStreak: number;
}

interface TriviaSettings {
  enabled: boolean;
  timeLimit: number;
  hintDelay: number;
  maxHints: number;
  pointsEasy: number;
  pointsMedium: number;
  pointsHard: number;
  streakBonus: number;
  announceWinner: boolean;
}

const DEFAULT_SETTINGS: TriviaSettings = {
  enabled: true,
  timeLimit: 30000, // 30 seconds
  hintDelay: 10000, // 10 seconds
  maxHints: 2,
  pointsEasy: 50,
  pointsMedium: 100,
  pointsHard: 200,
  streakBonus: 25,
  announceWinner: true,
};

// Default questions (German)
const DEFAULT_QUESTIONS: Omit<TriviaQuestion, 'id'>[] = [
  // Gaming
  { category: 'Gaming', question: 'In welchem Jahr wurde Minecraft veröffentlicht?', answer: '2011', alternatives: ['2011'], difficulty: 'easy', points: 50 },
  { category: 'Gaming', question: 'Wie heißt der Protagonist in "The Legend of Zelda"?', answer: 'Link', alternatives: ['link'], difficulty: 'easy', points: 50 },
  { category: 'Gaming', question: 'Welches Unternehmen entwickelte "Fortnite"?', answer: 'Epic Games', alternatives: ['epic', 'epic games'], difficulty: 'medium', points: 100 },
  { category: 'Gaming', question: 'Wie viele Pokemon gab es in der ersten Generation?', answer: '151', alternatives: ['151'], difficulty: 'medium', points: 100 },
  { category: 'Gaming', question: 'In welchem Jahr wurde die erste PlayStation veröffentlicht?', answer: '1994', alternatives: ['1994'], difficulty: 'hard', points: 200 },

  // Geographie
  { category: 'Geographie', question: 'Was ist die Hauptstadt von Australien?', answer: 'Canberra', alternatives: ['canberra'], difficulty: 'medium', points: 100 },
  { category: 'Geographie', question: 'Welcher Fluss fließt durch Paris?', answer: 'Seine', alternatives: ['seine', 'die seine'], difficulty: 'easy', points: 50 },
  { category: 'Geographie', question: 'Wie viele Bundesländer hat Deutschland?', answer: '16', alternatives: ['16', 'sechzehn'], difficulty: 'easy', points: 50 },
  { category: 'Geographie', question: 'Was ist das größte Land der Welt?', answer: 'Russland', alternatives: ['russland'], difficulty: 'easy', points: 50 },

  // Wissenschaft
  { category: 'Wissenschaft', question: 'Wie viele Planeten hat unser Sonnensystem?', answer: '8', alternatives: ['8', 'acht'], difficulty: 'easy', points: 50 },
  { category: 'Wissenschaft', question: 'Was ist das chemische Symbol für Gold?', answer: 'Au', alternatives: ['au'], difficulty: 'medium', points: 100 },
  { category: 'Wissenschaft', question: 'Wie viele Knochen hat der menschliche Körper?', answer: '206', alternatives: ['206'], difficulty: 'hard', points: 200 },

  // Film & TV
  { category: 'Film & TV', question: 'Wer spielte Iron Man im MCU?', answer: 'Robert Downey Jr.', alternatives: ['robert downey jr', 'downey', 'robert downey'], difficulty: 'easy', points: 50 },
  { category: 'Film & TV', question: 'In welchem Jahr wurde der erste Harry Potter Film veröffentlicht?', answer: '2001', alternatives: ['2001'], difficulty: 'medium', points: 100 },
  { category: 'Film & TV', question: 'Wie heißt der Heimatplanet von Superman?', answer: 'Krypton', alternatives: ['krypton'], difficulty: 'easy', points: 50 },

  // Musik
  { category: 'Musik', question: 'Welche Band sang "Bohemian Rhapsody"?', answer: 'Queen', alternatives: ['queen'], difficulty: 'easy', points: 50 },
  { category: 'Musik', question: 'Wie viele Mitglieder hatte die Band ABBA?', answer: '4', alternatives: ['4', 'vier'], difficulty: 'easy', points: 50 },
  { category: 'Musik', question: 'In welcher Stadt wurden die Beatles gegründet?', answer: 'Liverpool', alternatives: ['liverpool'], difficulty: 'medium', points: 100 },

  // Sport
  { category: 'Sport', question: 'Wie viele Spieler hat eine Fußballmannschaft auf dem Feld?', answer: '11', alternatives: ['11', 'elf'], difficulty: 'easy', points: 50 },
  { category: 'Sport', question: 'In welchem Land fanden die Olympischen Spiele 2020 statt?', answer: 'Japan', alternatives: ['japan', 'tokio'], difficulty: 'easy', points: 50 },
  { category: 'Sport', question: 'Wie viele Ringe hat das olympische Symbol?', answer: '5', alternatives: ['5', 'fünf'], difficulty: 'easy', points: 50 },

  // Twitch
  { category: 'Twitch', question: 'In welchem Jahr wurde Twitch gegründet?', answer: '2011', alternatives: ['2011'], difficulty: 'medium', points: 100 },
  { category: 'Twitch', question: 'Wie hieß Twitch ursprünglich?', answer: 'Justin.tv', alternatives: ['justin.tv', 'justintv', 'justin tv'], difficulty: 'hard', points: 200 },
  { category: 'Twitch', question: 'Welches Unternehmen besitzt Twitch?', answer: 'Amazon', alternatives: ['amazon'], difficulty: 'easy', points: 50 },
];

export class TriviaPlugin extends Plugin {
  meta: PluginMeta = {
    name: 'trivia',
    version: '1.0.0',
    description: 'Quiz games with various categories',
    author: 'StreamCore',
  };

  private db!: DatabaseService;
  private settings: TriviaSettings = DEFAULT_SETTINGS;
  private questions: TriviaQuestion[] = [];
  private game: TriviaGame = { active: false, question: null, startTime: 0, hints: 0, answered: false, winner: null };
  private stats: Map<string, TriviaStats> = new Map();
  private gameTimeout: ReturnType<typeof setTimeout> | null = null;
  private hintTimeout: ReturnType<typeof setTimeout> | null = null;

  protected async init(): Promise<void> {
    this.db = getDatabase();
    this.log.info('Initializing Trivia...');

    this.initTables();
    this.loadSettings();
    this.loadQuestions();
    this.loadStats();
    this.setupEventHandlers();
    this.registerCommands();

    this.log.info('Trivia initialized!');
  }

  protected async destroy(): Promise<void> {
    if (this.gameTimeout) clearTimeout(this.gameTimeout);
    if (this.hintTimeout) clearTimeout(this.hintTimeout);
  }

  private initTables(): void {
    const db = this.db.raw();
    db.exec(`
      CREATE TABLE IF NOT EXISTS trivia_questions (
        id TEXT PRIMARY KEY,
        category TEXT NOT NULL,
        question TEXT NOT NULL,
        answer TEXT NOT NULL,
        alternatives TEXT,
        difficulty TEXT DEFAULT 'medium',
        points INTEGER DEFAULT 100
      );

      CREATE TABLE IF NOT EXISTS trivia_stats (
        username TEXT PRIMARY KEY,
        correct INTEGER DEFAULT 0,
        wrong INTEGER DEFAULT 0,
        points INTEGER DEFAULT 0,
        streak INTEGER DEFAULT 0,
        best_streak INTEGER DEFAULT 0
      );
    `);
  }

  private loadSettings(): void {
    const saved = this.db.getSetting<TriviaSettings>('trivia_settings');
    if (saved) {
      this.settings = { ...DEFAULT_SETTINGS, ...saved };
    }
  }

  private loadQuestions(): void {
    const db = this.db.raw();
    const rows = db.prepare('SELECT * FROM trivia_questions').all() as any[];

    if (rows.length === 0) {
      // Insert default questions
      for (const q of DEFAULT_QUESTIONS) {
        const id = `q-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        this.questions.push({ id, ...q });
        db.prepare(`
          INSERT INTO trivia_questions (id, category, question, answer, alternatives, difficulty, points)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(id, q.category, q.question, q.answer, JSON.stringify(q.alternatives), q.difficulty, q.points);
      }
    } else {
      for (const row of rows) {
        this.questions.push({
          id: row.id,
          category: row.category,
          question: row.question,
          answer: row.answer,
          alternatives: row.alternatives ? JSON.parse(row.alternatives) : [],
          difficulty: row.difficulty || 'medium',
          points: row.points || 100,
        });
      }
    }
  }

  private loadStats(): void {
    const db = this.db.raw();
    const rows = db.prepare('SELECT * FROM trivia_stats').all() as any[];

    for (const row of rows) {
      this.stats.set(row.username, {
        username: row.username,
        correct: row.correct || 0,
        wrong: row.wrong || 0,
        points: row.points || 0,
        streak: row.streak || 0,
        bestStreak: row.best_streak || 0,
      });
    }
  }

  private saveStats(username: string): void {
    const stats = this.stats.get(username);
    if (!stats) return;

    const db = this.db.raw();
    db.prepare(`
      INSERT OR REPLACE INTO trivia_stats (username, correct, wrong, points, streak, best_streak)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(username, stats.correct, stats.wrong, stats.points, stats.streak, stats.bestStreak);
  }

  private getRandomQuestion(category?: string): TriviaQuestion | null {
    let filtered = this.questions;
    if (category) {
      filtered = this.questions.filter((q) => q.category.toLowerCase() === category.toLowerCase());
    }

    if (filtered.length === 0) return null;
    return filtered[Math.floor(Math.random() * filtered.length)];
  }

  private startGame(question: TriviaQuestion): void {
    this.game = {
      active: true,
      question,
      startTime: Date.now(),
      hints: 0,
      answered: false,
      winner: null,
    };

    // Announce question
    const diffEmoji = question.difficulty === 'easy' ? '🟢' : question.difficulty === 'medium' ? '🟡' : '🔴';
    this.ctx.events.emit('chat:send',
      `❓ TRIVIA ${diffEmoji} [${question.category}]: ${question.question} (${this.settings.timeLimit / 1000}s)`
    );

    // Set timeout for time limit
    this.gameTimeout = setTimeout(() => this.endGame(false), this.settings.timeLimit);

    // Set hint timeouts
    this.scheduleHint();
  }

  private scheduleHint(): void {
    if (this.game.hints >= this.settings.maxHints) return;

    this.hintTimeout = setTimeout(() => {
      if (!this.game.active || !this.game.question) return;

      this.game.hints++;
      const hint = this.generateHint(this.game.question.answer, this.game.hints);
      this.ctx.events.emit('chat:send', `💡 Hinweis ${this.game.hints}: ${hint}`);

      this.scheduleHint();
    }, this.settings.hintDelay);
  }

  private generateHint(answer: string, hintLevel: number): string {
    const chars = answer.split('');
    const revealCount = Math.ceil((answer.length * hintLevel) / (this.settings.maxHints + 1));

    const revealed = new Set<number>();
    while (revealed.size < revealCount) {
      revealed.add(Math.floor(Math.random() * chars.length));
    }

    return chars.map((c, i) => {
      if (c === ' ') return ' ';
      if (revealed.has(i)) return c;
      return '_';
    }).join('');
  }

  private checkAnswer(answer: string): boolean {
    if (!this.game.question) return false;

    const normalized = answer.toLowerCase().trim();
    const correct = this.game.question.answer.toLowerCase();

    if (normalized === correct) return true;
    if (this.game.question.alternatives.some((a) => a.toLowerCase() === normalized)) return true;

    return false;
  }

  private endGame(hasWinner: boolean, winner?: string, displayName?: string): void {
    if (this.gameTimeout) {
      clearTimeout(this.gameTimeout);
      this.gameTimeout = null;
    }
    if (this.hintTimeout) {
      clearTimeout(this.hintTimeout);
      this.hintTimeout = null;
    }

    if (!this.game.question) {
      this.game.active = false;
      return;
    }

    if (hasWinner && winner) {
      // Get or create stats
      let stats = this.stats.get(winner);
      if (!stats) {
        stats = { username: winner, correct: 0, wrong: 0, points: 0, streak: 0, bestStreak: 0 };
        this.stats.set(winner, stats);
      }

      // Calculate points with streak bonus
      let points = this.game.question.points;
      if (stats.streak > 0) {
        points += this.settings.streakBonus * stats.streak;
      }

      // Update stats
      stats.correct++;
      stats.streak++;
      stats.points += points;
      if (stats.streak > stats.bestStreak) {
        stats.bestStreak = stats.streak;
      }
      this.saveStats(winner);

      // Give points
      this.ctx.events.emit('points:add', { username: winner, amount: points, reason: 'Trivia' });

      // Announce winner
      if (this.settings.announceWinner) {
        const streakText = stats.streak > 1 ? ` 🔥 ${stats.streak}er Streak!` : '';
        this.ctx.events.emit('chat:send',
          `✅ ${displayName || winner} hat richtig geantwortet! +${points} Punkte${streakText}`
        );
      }
    } else {
      // Time ran out
      this.ctx.events.emit('chat:send',
        `⏱️ Zeit abgelaufen! Die Antwort war: ${this.game.question.answer}`
      );

      // Reset all streaks
      for (const stats of this.stats.values()) {
        if (stats.streak > 0) {
          stats.streak = 0;
          this.saveStats(stats.username);
        }
      }
    }

    this.game.active = false;
    this.game.question = null;
  }

  private setupEventHandlers(): void {
    // Listen for chat messages to check answers
    this.ctx.events.on('chat:message', (event: any) => {
      if (!this.game.active || this.game.answered) return;

      if (this.checkAnswer(event.message)) {
        this.game.answered = true;
        this.game.winner = event.username;
        this.endGame(true, event.username, event.displayName);
      }
    });
  }

  private registerCommands(): void {
    // !trivia - Start trivia
    this.registerCommand({
      name: 'trivia',
      aliases: ['quiz'],
      description: 'Start a trivia question',
      usage: '!trivia [category]',
      permission: Permission.MODERATOR,
      cooldown: { user: 5, global: 0 },
      handler: async (ctx) => {
        if (this.game.active) {
          ctx.reply('❓ Es läuft bereits eine Trivia-Frage!');
          return;
        }

        const category = ctx.args.join(' ') || undefined;
        const question = this.getRandomQuestion(category);

        if (!question) {
          ctx.reply('❌ Keine Fragen gefunden');
          return;
        }

        this.startGame(question);
      },
    });

    // !triviastats - Show stats
    this.registerCommand({
      name: 'triviastats',
      aliases: ['quizstats'],
      description: 'Show your trivia stats',
      cooldown: { user: 10, global: 3 },
      handler: async (ctx) => {
        const target = ctx.args[0]?.replace('@', '').toLowerCase() || ctx.user.username;
        const stats = this.stats.get(target);

        if (!stats || stats.correct === 0) {
          ctx.reply(`📊 ${target} hat noch keine Trivia-Stats`);
          return;
        }

        const accuracy = Math.round((stats.correct / (stats.correct + stats.wrong)) * 100);
        ctx.reply(
          `📊 ${target}: ${stats.correct} richtig | ${stats.points} Punkte | ` +
          `${accuracy}% Genauigkeit | Bester Streak: ${stats.bestStreak}`
        );
      },
    });

    // !triviatop - Show leaderboard
    this.registerCommand({
      name: 'triviatop',
      aliases: ['quiztop'],
      description: 'Show trivia leaderboard',
      cooldown: { user: 15, global: 5 },
      handler: async (ctx) => {
        const sorted = Array.from(this.stats.values())
          .sort((a, b) => b.points - a.points)
          .slice(0, 5);

        if (sorted.length === 0) {
          ctx.reply('📊 Noch keine Trivia-Stats');
          return;
        }

        const list = sorted.map((s, i) => {
          const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`;
          return `${medal} ${s.username}: ${s.points}`;
        }).join(' | ');

        ctx.reply(`🧠 Trivia Top: ${list}`);
      },
    });

    // !triviacategories - Show categories
    this.registerCommand({
      name: 'triviacategories',
      aliases: ['quizcats'],
      description: 'Show available categories',
      cooldown: { user: 15, global: 5 },
      handler: async (ctx) => {
        const categories = [...new Set(this.questions.map((q) => q.category))];
        ctx.reply(`📚 Kategorien: ${categories.join(', ')}`);
      },
    });

    // !skiptrivia - Skip current question
    this.registerCommand({
      name: 'skiptrivia',
      description: 'Skip current trivia question',
      permission: Permission.MODERATOR,
      cooldown: { user: 0, global: 0 },
      handler: async (ctx) => {
        if (!this.game.active) {
          ctx.reply('❓ Keine aktive Trivia-Frage');
          return;
        }

        this.endGame(false);
        ctx.reply('⏭️ Frage übersprungen');
      },
    });
  }

  // Public API
  isGameActive(): boolean {
    return this.game.active;
  }

  getCategories(): string[] {
    return [...new Set(this.questions.map((q) => q.category))];
  }
}
