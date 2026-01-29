/**
 * Word Games Plugin
 *
 * Various word-based games
 * Features:
 * - Hangman
 * - Word Scramble
 * - Word Chain
 * - Anagrams
 */

import { Plugin } from '../base/Plugin';
import { PluginMeta, Permission } from '../../types/plugins';
import { getDatabase, DatabaseService } from '../../services/Database';

interface HangmanGame {
  active: boolean;
  word: string;
  category: string;
  guessed: Set<string>;
  wrong: number;
  maxWrong: number;
}

interface ScrambleGame {
  active: boolean;
  original: string;
  scrambled: string;
  hint: string;
  startTime: number;
}

interface ChainGame {
  active: boolean;
  currentWord: string;
  lastPlayer: string;
  usedWords: Set<string>;
  score: number;
}

interface WordGamesSettings {
  enabled: boolean;
  hangmanMaxWrong: number;
  scrambleTimeout: number;
  chainTimeout: number;
  pointsHangman: number;
  pointsScramble: number;
  pointsChain: number;
}

const DEFAULT_SETTINGS: WordGamesSettings = {
  enabled: true,
  hangmanMaxWrong: 6,
  scrambleTimeout: 60000,
  chainTimeout: 30000,
  pointsHangman: 100,
  pointsScramble: 75,
  pointsChain: 25,
};

// German word lists
const HANGMAN_WORDS: { word: string; category: string }[] = [
  // Tiere
  { word: 'ELEFANT', category: 'Tier' },
  { word: 'GIRAFFE', category: 'Tier' },
  { word: 'PINGUIN', category: 'Tier' },
  { word: 'DELFIN', category: 'Tier' },
  { word: 'SCHMETTERLING', category: 'Tier' },
  // Essen
  { word: 'PIZZA', category: 'Essen' },
  { word: 'SPAGHETTI', category: 'Essen' },
  { word: 'BRATWURST', category: 'Essen' },
  { word: 'SCHNITZEL', category: 'Essen' },
  { word: 'BRETZEL', category: 'Essen' },
  // Gaming
  { word: 'CONTROLLER', category: 'Gaming' },
  { word: 'HEADSET', category: 'Gaming' },
  { word: 'SPEEDRUN', category: 'Gaming' },
  { word: 'RESPAWN', category: 'Gaming' },
  { word: 'STREAMING', category: 'Gaming' },
  // Twitch
  { word: 'EMOTE', category: 'Twitch' },
  { word: 'SUBSCRIBER', category: 'Twitch' },
  { word: 'MODERATOR', category: 'Twitch' },
  { word: 'CHANNEL', category: 'Twitch' },
  { word: 'OVERLAY', category: 'Twitch' },
];

const SCRAMBLE_WORDS: { word: string; hint: string }[] = [
  { word: 'STREAM', hint: 'Live-Übertragung' },
  { word: 'TWITCH', hint: 'Streaming-Plattform' },
  { word: 'GAMING', hint: 'Videospiele spielen' },
  { word: 'COMPUTER', hint: 'Elektronisches Gerät' },
  { word: 'INTERNET', hint: 'Weltweites Netzwerk' },
  { word: 'KAFFEE', hint: 'Beliebtes Getränk' },
  { word: 'MUSIK', hint: 'Töne und Melodien' },
  { word: 'FREUNDE', hint: 'Gute Bekannte' },
  { word: 'WETTER', hint: 'Regen oder Sonne' },
  { word: 'HERBST', hint: 'Jahreszeit' },
];

export class WordGamesPlugin extends Plugin {
  meta: PluginMeta = {
    name: 'wordgames',
    version: '1.0.0',
    description: 'Various word-based games',
    author: 'StreamCore',
  };

  private db!: DatabaseService;
  private settings: WordGamesSettings = DEFAULT_SETTINGS;

  // Game states
  private hangman: HangmanGame = { active: false, word: '', category: '', guessed: new Set(), wrong: 0, maxWrong: 6 };
  private scramble: ScrambleGame = { active: false, original: '', scrambled: '', hint: '', startTime: 0 };
  private chain: ChainGame = { active: false, currentWord: '', lastPlayer: '', usedWords: new Set(), score: 0 };

  private scrambleTimeout: ReturnType<typeof setTimeout> | null = null;
  private chainTimeout: ReturnType<typeof setTimeout> | null = null;

  protected async init(): Promise<void> {
    this.db = getDatabase();
    this.log.info('Initializing Word Games...');

    this.loadSettings();
    this.setupEventHandlers();
    this.registerCommands();

    this.log.info('Word Games initialized!');
  }

  protected async destroy(): Promise<void> {
    if (this.scrambleTimeout) clearTimeout(this.scrambleTimeout);
    if (this.chainTimeout) clearTimeout(this.chainTimeout);
  }

  private loadSettings(): void {
    const saved = this.db.getSetting<WordGamesSettings>('wordgames_settings');
    if (saved) {
      this.settings = { ...DEFAULT_SETTINGS, ...saved };
    }
  }

  // ==================== HANGMAN ====================

  private startHangman(): void {
    const wordData = HANGMAN_WORDS[Math.floor(Math.random() * HANGMAN_WORDS.length)];

    this.hangman = {
      active: true,
      word: wordData.word,
      category: wordData.category,
      guessed: new Set(),
      wrong: 0,
      maxWrong: this.settings.hangmanMaxWrong,
    };

    const display = this.getHangmanDisplay();
    this.ctx.events.emit('chat:send',
      `🎯 HANGMAN [${wordData.category}]: ${display} (${this.hangman.maxWrong} Versuche)`
    );
  }

  private getHangmanDisplay(): string {
    return this.hangman.word
      .split('')
      .map((c) => (this.hangman.guessed.has(c) ? c : '_'))
      .join(' ');
  }

  private guessHangmanLetter(letter: string, username: string, displayName: string): void {
    letter = letter.toUpperCase();

    if (this.hangman.guessed.has(letter)) {
      this.ctx.events.emit('chat:send', `❌ "${letter}" wurde bereits geraten!`);
      return;
    }

    this.hangman.guessed.add(letter);

    if (this.hangman.word.includes(letter)) {
      const display = this.getHangmanDisplay();

      if (!display.includes('_')) {
        // Won!
        this.ctx.events.emit('chat:send', `🎉 ${displayName} hat gewonnen! Das Wort war: ${this.hangman.word}`);
        this.ctx.events.emit('points:add', { username, amount: this.settings.pointsHangman, reason: 'Hangman gewonnen' });
        this.hangman.active = false;
      } else {
        this.ctx.events.emit('chat:send', `✅ Richtig! ${display}`);
      }
    } else {
      this.hangman.wrong++;

      if (this.hangman.wrong >= this.hangman.maxWrong) {
        // Lost
        this.ctx.events.emit('chat:send', `💀 Game Over! Das Wort war: ${this.hangman.word}`);
        this.hangman.active = false;
      } else {
        const remaining = this.hangman.maxWrong - this.hangman.wrong;
        this.ctx.events.emit('chat:send', `❌ Falsch! Noch ${remaining} Versuche. ${this.getHangmanDisplay()}`);
      }
    }
  }

  private guessHangmanWord(word: string, username: string, displayName: string): void {
    if (word.toUpperCase() === this.hangman.word) {
      this.ctx.events.emit('chat:send', `🎉 ${displayName} hat das Wort erraten: ${this.hangman.word}!`);
      this.ctx.events.emit('points:add', { username, amount: this.settings.pointsHangman, reason: 'Hangman gewonnen' });
      this.hangman.active = false;
    } else {
      this.hangman.wrong++;
      if (this.hangman.wrong >= this.hangman.maxWrong) {
        this.ctx.events.emit('chat:send', `💀 Falsch! Game Over! Das Wort war: ${this.hangman.word}`);
        this.hangman.active = false;
      } else {
        const remaining = this.hangman.maxWrong - this.hangman.wrong;
        this.ctx.events.emit('chat:send', `❌ Falsches Wort! Noch ${remaining} Versuche`);
      }
    }
  }

  // ==================== SCRAMBLE ====================

  private scrambleWord(word: string): string {
    const chars = word.split('');
    for (let i = chars.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [chars[i], chars[j]] = [chars[j], chars[i]];
    }
    // Make sure it's actually scrambled
    if (chars.join('') === word && word.length > 1) {
      return this.scrambleWord(word);
    }
    return chars.join('');
  }

  private startScramble(): void {
    const wordData = SCRAMBLE_WORDS[Math.floor(Math.random() * SCRAMBLE_WORDS.length)];

    this.scramble = {
      active: true,
      original: wordData.word.toUpperCase(),
      scrambled: this.scrambleWord(wordData.word.toUpperCase()),
      hint: wordData.hint,
      startTime: Date.now(),
    };

    this.ctx.events.emit('chat:send',
      `🔀 WORT-SCRAMBLE: ${this.scramble.scrambled} (Hinweis: ${this.scramble.hint})`
    );

    this.scrambleTimeout = setTimeout(() => {
      if (this.scramble.active) {
        this.ctx.events.emit('chat:send', `⏱️ Zeit abgelaufen! Das Wort war: ${this.scramble.original}`);
        this.scramble.active = false;
      }
    }, this.settings.scrambleTimeout);
  }

  private checkScrambleAnswer(answer: string, username: string, displayName: string): boolean {
    if (answer.toUpperCase() === this.scramble.original) {
      const time = ((Date.now() - this.scramble.startTime) / 1000).toFixed(1);
      this.ctx.events.emit('chat:send', `🎉 ${displayName} hat es in ${time}s erraten: ${this.scramble.original}!`);
      this.ctx.events.emit('points:add', { username, amount: this.settings.pointsScramble, reason: 'Scramble gewonnen' });

      if (this.scrambleTimeout) clearTimeout(this.scrambleTimeout);
      this.scramble.active = false;
      return true;
    }
    return false;
  }

  // ==================== WORD CHAIN ====================

  private startChain(startWord: string): void {
    this.chain = {
      active: true,
      currentWord: startWord.toLowerCase(),
      lastPlayer: '',
      usedWords: new Set([startWord.toLowerCase()]),
      score: 0,
    };

    this.ctx.events.emit('chat:send',
      `⛓️ WORD CHAIN gestartet! Das letzte Wort ist: "${startWord}". ` +
      `Schreibe ein Wort, das mit "${startWord.slice(-1).toUpperCase()}" beginnt!`
    );

    this.resetChainTimeout();
  }

  private resetChainTimeout(): void {
    if (this.chainTimeout) clearTimeout(this.chainTimeout);

    this.chainTimeout = setTimeout(() => {
      if (this.chain.active) {
        this.ctx.events.emit('chat:send',
          `⏱️ Word Chain beendet! Score: ${this.chain.score} Wörter | ` +
          `Letztes Wort: ${this.chain.currentWord}`
        );
        this.chain.active = false;
      }
    }, this.settings.chainTimeout);
  }

  private checkChainWord(word: string, username: string, displayName: string): boolean {
    word = word.toLowerCase();

    // Must start with last letter of current word
    if (word[0] !== this.chain.currentWord.slice(-1)) {
      return false;
    }

    // Must not be used before
    if (this.chain.usedWords.has(word)) {
      return false;
    }

    // Same player can't go twice in a row
    if (username === this.chain.lastPlayer) {
      return false;
    }

    // Accept the word
    this.chain.usedWords.add(word);
    this.chain.currentWord = word;
    this.chain.lastPlayer = username;
    this.chain.score++;

    this.ctx.events.emit('points:add', { username, amount: this.settings.pointsChain, reason: 'Word Chain' });
    this.ctx.events.emit('chat:send',
      `⛓️ ${displayName}: "${word}" ✅ | Nächster Buchstabe: "${word.slice(-1).toUpperCase()}" | Score: ${this.chain.score}`
    );

    this.resetChainTimeout();
    return true;
  }

  // ==================== EVENT HANDLERS ====================

  private setupEventHandlers(): void {
    this.ctx.events.on('chat:message', (event: any) => {
      const msg = event.message.trim();

      // Check scramble answers
      if (this.scramble.active && msg.length === this.scramble.original.length) {
        this.checkScrambleAnswer(msg, event.username, event.displayName);
      }

      // Check word chain
      if (this.chain.active && msg.length >= 2 && !msg.includes(' ')) {
        this.checkChainWord(msg, event.username, event.displayName);
      }
    });
  }

  private registerCommands(): void {
    // !hangman - Start hangman
    this.registerCommand({
      name: 'hangman',
      aliases: ['hm'],
      description: 'Start a hangman game',
      permission: Permission.MODERATOR,
      cooldown: { user: 5, global: 0 },
      handler: async (ctx) => {
        if (this.hangman.active) {
          ctx.reply(`🎯 Hangman läuft: ${this.getHangmanDisplay()}`);
          return;
        }
        this.startHangman();
      },
    });

    // !guess - Guess letter or word
    this.registerCommand({
      name: 'guess',
      aliases: ['g', 'rate'],
      description: 'Guess a letter or word in hangman',
      usage: '!guess <letter/word>',
      cooldown: { user: 3, global: 1 },
      handler: async (ctx) => {
        if (!this.hangman.active) {
          ctx.reply('❌ Kein Hangman-Spiel aktiv');
          return;
        }

        const guess = ctx.args[0]?.toUpperCase();
        if (!guess) {
          ctx.reply('❌ Usage: !guess <Buchstabe oder Wort>');
          return;
        }

        if (guess.length === 1) {
          this.guessHangmanLetter(guess, ctx.user.username, ctx.user.displayName);
        } else {
          this.guessHangmanWord(guess, ctx.user.username, ctx.user.displayName);
        }
      },
    });

    // !scramble - Start scramble
    this.registerCommand({
      name: 'scramble',
      aliases: ['wortmix'],
      description: 'Start a word scramble game',
      permission: Permission.MODERATOR,
      cooldown: { user: 5, global: 0 },
      handler: async (ctx) => {
        if (this.scramble.active) {
          ctx.reply(`🔀 Scramble läuft: ${this.scramble.scrambled} (Hinweis: ${this.scramble.hint})`);
          return;
        }
        this.startScramble();
      },
    });

    // !chain - Start word chain
    this.registerCommand({
      name: 'chain',
      aliases: ['wordchain', 'wortkette'],
      description: 'Start a word chain game',
      usage: '!chain <startwort>',
      permission: Permission.MODERATOR,
      cooldown: { user: 5, global: 0 },
      handler: async (ctx) => {
        if (this.chain.active) {
          ctx.reply(`⛓️ Chain läuft: "${this.chain.currentWord}" → ?`);
          return;
        }

        const startWord = ctx.args[0] || 'Wort';
        this.startChain(startWord);
      },
    });

    // !stopgame - Stop current game
    this.registerCommand({
      name: 'stopgame',
      aliases: ['endgame'],
      description: 'Stop current word game',
      permission: Permission.MODERATOR,
      cooldown: { user: 0, global: 0 },
      handler: async (ctx) => {
        let stopped = false;

        if (this.hangman.active) {
          this.hangman.active = false;
          stopped = true;
        }
        if (this.scramble.active) {
          this.scramble.active = false;
          if (this.scrambleTimeout) clearTimeout(this.scrambleTimeout);
          stopped = true;
        }
        if (this.chain.active) {
          this.chain.active = false;
          if (this.chainTimeout) clearTimeout(this.chainTimeout);
          stopped = true;
        }

        if (stopped) {
          ctx.reply('✅ Spiel beendet');
        } else {
          ctx.reply('❌ Kein Spiel aktiv');
        }
      },
    });
  }
}
