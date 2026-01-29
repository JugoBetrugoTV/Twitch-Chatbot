/**
 * TTS (Text-to-Speech) Plugin
 *
 * Features:
 * - Read chat messages aloud
 * - Multiple voices/languages
 * - Queue system
 * - Word/user blacklist
 * - Points cost option
 */

import { Plugin } from '../base/Plugin';
import { PluginMeta, Permission } from '../../types/plugins';
import { ChatMessageEvent } from '../../types/events';
import { getDatabase, DatabaseService } from '../../services/Database';
import googleTTS from 'google-tts-api';
import { v4 as uuidv4 } from 'uuid';

export interface TTSMessage {
  id: string;
  username: string;
  text: string;
  audioUrl?: string;
  timestamp: Date;
}

interface TTSSettings {
  enabled: boolean;
  language: string;
  speed: number; // 0.5 - 2.0
  volume: number; // 0-100
  maxLength: number;
  pointsCost: number;
  subOnly: boolean;
  readUsername: boolean;
  blockedWords: string[];
  blockedUsers: string[];
}

const DEFAULT_SETTINGS: TTSSettings = {
  enabled: true,
  language: 'de',
  speed: 1.0,
  volume: 80,
  maxLength: 200,
  pointsCost: 0,
  subOnly: false,
  readUsername: true,
  blockedWords: [],
  blockedUsers: [],
};

const LANGUAGES: Record<string, string> = {
  'de': 'Deutsch',
  'en': 'English',
  'es': 'Español',
  'fr': 'Français',
  'it': 'Italiano',
  'pt': 'Português',
  'ru': 'Русский',
  'ja': 'Japanese',
  'ko': 'Korean',
  'zh': 'Chinese',
};

export class TTSPlugin extends Plugin {
  meta: PluginMeta = {
    name: 'tts',
    version: '1.0.0',
    description: 'Text-to-Speech for chat messages',
    author: 'StreamCore',
  };

  private db!: DatabaseService;
  private settings: TTSSettings = DEFAULT_SETTINGS;
  private queue: TTSMessage[] = [];
  private isPlaying: boolean = false;

  protected async init(): Promise<void> {
    this.db = getDatabase();
    this.log.info('Initializing TTS system...');

    // Load settings
    const savedSettings = this.db.getSetting<Partial<TTSSettings>>('tts_settings');
    if (savedSettings) {
      this.settings = { ...DEFAULT_SETTINGS, ...savedSettings };
    }

    this.registerCommands();
    this.log.info('TTS system initialized!');
  }

  private registerCommands(): void {
    // !tts - Send a TTS message
    this.registerCommand({
      name: 'tts',
      aliases: ['say', 'speak'],
      description: 'Send a text-to-speech message',
      usage: '!tts <message>',
      cooldown: { user: 10, global: 0 },
      handler: async (ctx) => {
        if (!this.settings.enabled) {
          ctx.reply('❌ TTS ist deaktiviert.');
          return;
        }

        if (ctx.args.length === 0) {
          ctx.reply('Verwendung: !tts <nachricht>');
          return;
        }

        // Check if user is blocked
        if (this.settings.blockedUsers.includes(ctx.user.username.toLowerCase())) {
          return; // Silently ignore
        }

        if (this.settings.subOnly && !ctx.user.isSub && !ctx.user.isMod) {
          ctx.reply('❌ TTS ist nur für Subs!');
          return;
        }

        let text = ctx.args.join(' ');

        // Check length
        if (text.length > this.settings.maxLength) {
          ctx.reply(`❌ Nachricht zu lang! Maximum: ${this.settings.maxLength} Zeichen`);
          return;
        }

        // Filter blocked words
        for (const word of this.settings.blockedWords) {
          const regex = new RegExp(word, 'gi');
          text = text.replace(regex, '***');
        }

        // Check points
        if (this.settings.pointsCost > 0) {
          const user = this.db.getUser('twitch', ctx.user.username);
          if (!user || user.points < this.settings.pointsCost) {
            ctx.reply(`❌ Du brauchst ${this.settings.pointsCost} Punkte für TTS!`);
            return;
          }
          this.db.updateUserPoints('twitch', ctx.user.username, -this.settings.pointsCost);
        }

        // Add username prefix if enabled
        const fullText = this.settings.readUsername
          ? `${ctx.user.displayName} sagt: ${text}`
          : text;

        const ttsMessage: TTSMessage = {
          id: uuidv4(),
          username: ctx.user.displayName,
          text: fullText,
          timestamp: new Date(),
        };

        try {
          // Generate TTS URL
          const audioUrl = googleTTS.getAudioUrl(fullText, {
            lang: this.settings.language,
            slow: this.settings.speed < 0.8,
            host: 'https://translate.google.com',
          });

          ttsMessage.audioUrl = audioUrl;
          this.queue.push(ttsMessage);

          // Emit for dashboard/player
          this.emit('tts:queued' as any, { message: ttsMessage, position: this.queue.length });

          ctx.reply(`🔊 TTS in Queue! Position: #${this.queue.length}`);

        } catch (error) {
          this.log.error('TTS error:', error);
          ctx.reply('❌ TTS Fehler!');
        }
      },
    });

    // !ttsqueue - Show TTS queue
    this.registerCommand({
      name: 'ttsqueue',
      aliases: ['ttsq'],
      description: 'Show the TTS queue',
      cooldown: { user: 10, global: 5 },
      handler: async (ctx) => {
        if (this.queue.length === 0) {
          ctx.reply('📋 TTS Queue ist leer.');
          return;
        }

        const preview = this.queue.slice(0, 3).map((m, i) =>
          `${i + 1}. ${m.username}`
        ).join(' | ');

        ctx.reply(`🔊 TTS Queue (${this.queue.length}): ${preview}`);
      },
    });

    // !ttsskip - Skip current TTS
    this.registerCommand({
      name: 'ttsskip',
      aliases: ['skiptts'],
      description: 'Skip the current TTS message',
      permission: Permission.MODERATOR,
      cooldown: { user: 0, global: 0 },
      handler: async (ctx) => {
        this.emit('tts:skip' as any, {});
        ctx.reply('⏭️ TTS übersprungen!');
      },
    });

    // !ttsclear - Clear TTS queue
    this.registerCommand({
      name: 'ttsclear',
      aliases: ['cleartts'],
      description: 'Clear the TTS queue',
      permission: Permission.MODERATOR,
      cooldown: { user: 0, global: 0 },
      handler: async (ctx) => {
        const count = this.queue.length;
        this.queue = [];
        ctx.reply(`🗑️ TTS Queue geleert! (${count} Nachrichten)`);
      },
    });

    // !ttstoggle - Toggle TTS
    this.registerCommand({
      name: 'ttstoggle',
      description: 'Toggle TTS on/off',
      permission: Permission.MODERATOR,
      cooldown: { user: 0, global: 0 },
      handler: async (ctx) => {
        this.settings.enabled = !this.settings.enabled;
        this.saveSettings();
        ctx.reply(`🔊 TTS ist jetzt ${this.settings.enabled ? 'AN' : 'AUS'}!`);
      },
    });

    // !ttslang - Change language
    this.registerCommand({
      name: 'ttslang',
      aliases: ['ttslanguage'],
      description: 'Change TTS language',
      usage: '!ttslang <de|en|es|fr|...>',
      permission: Permission.MODERATOR,
      cooldown: { user: 0, global: 0 },
      handler: async (ctx) => {
        if (ctx.args.length === 0) {
          const langs = Object.entries(LANGUAGES).map(([k, v]) => `${k}=${v}`).join(', ');
          ctx.reply(`🌐 Aktuelle Sprache: ${this.settings.language} | Verfügbar: ${langs}`);
          return;
        }

        const lang = ctx.args[0].toLowerCase();
        if (!LANGUAGES[lang]) {
          ctx.reply('❌ Unbekannte Sprache!');
          return;
        }

        this.settings.language = lang;
        this.saveSettings();
        ctx.reply(`🌐 TTS Sprache: ${LANGUAGES[lang]}`);
      },
    });

    // !ttsvolume - Set TTS volume
    this.registerCommand({
      name: 'ttsvolume',
      aliases: ['ttsvol'],
      description: 'Set TTS volume',
      usage: '!ttsvolume <0-100>',
      permission: Permission.MODERATOR,
      cooldown: { user: 0, global: 0 },
      handler: async (ctx) => {
        if (ctx.args.length === 0) {
          ctx.reply(`🔊 TTS Volume: ${this.settings.volume}%`);
          return;
        }

        const vol = parseInt(ctx.args[0]);
        if (isNaN(vol) || vol < 0 || vol > 100) {
          ctx.reply('❌ Volume muss zwischen 0 und 100 sein!');
          return;
        }

        this.settings.volume = vol;
        this.saveSettings();
        this.emit('tts:volume' as any, { volume: vol });
        ctx.reply(`🔊 TTS Volume: ${vol}%`);
      },
    });

    // !ttsblock - Block a user from TTS
    this.registerCommand({
      name: 'ttsblock',
      description: 'Block a user from TTS',
      usage: '!ttsblock <username>',
      permission: Permission.MODERATOR,
      cooldown: { user: 0, global: 0 },
      handler: async (ctx) => {
        if (ctx.args.length === 0) {
          ctx.reply('Verwendung: !ttsblock <username>');
          return;
        }

        const user = ctx.args[0].toLowerCase().replace('@', '');

        if (this.settings.blockedUsers.includes(user)) {
          // Unblock
          this.settings.blockedUsers = this.settings.blockedUsers.filter(u => u !== user);
          this.saveSettings();
          ctx.reply(`✅ ${user} kann wieder TTS nutzen.`);
        } else {
          // Block
          this.settings.blockedUsers.push(user);
          this.saveSettings();
          ctx.reply(`🚫 ${user} ist von TTS geblockt.`);
        }
      },
    });

    // !ttsword - Block a word from TTS
    this.registerCommand({
      name: 'ttsword',
      aliases: ['ttsblockword'],
      description: 'Block/unblock a word from TTS',
      usage: '!ttsword <word>',
      permission: Permission.MODERATOR,
      cooldown: { user: 0, global: 0 },
      handler: async (ctx) => {
        if (ctx.args.length === 0) {
          ctx.reply('Verwendung: !ttsword <wort>');
          return;
        }

        const word = ctx.args[0].toLowerCase();

        if (this.settings.blockedWords.includes(word)) {
          this.settings.blockedWords = this.settings.blockedWords.filter(w => w !== word);
          this.saveSettings();
          ctx.reply(`✅ "${word}" ist nicht mehr geblockt.`);
        } else {
          this.settings.blockedWords.push(word);
          this.saveSettings();
          ctx.reply(`🚫 "${word}" wird jetzt zensiert.`);
        }
      },
    });

    // !ttssettings - Show TTS settings
    this.registerCommand({
      name: 'ttssettings',
      description: 'Show TTS settings',
      permission: Permission.MODERATOR,
      cooldown: { user: 5, global: 0 },
      handler: async (ctx) => {
        const s = this.settings;
        ctx.reply(
          `⚙️ TTS: ${s.enabled ? 'AN' : 'AUS'} | ` +
          `Lang: ${s.language} | Vol: ${s.volume}% | ` +
          `Max: ${s.maxLength} | Cost: ${s.pointsCost} | ` +
          `SubOnly: ${s.subOnly ? 'Ja' : 'Nein'}`
        );
      },
    });
  }

  private saveSettings(): void {
    this.db.setSetting('tts_settings', this.settings);
  }

  // Public API
  getQueue(): TTSMessage[] {
    return [...this.queue];
  }

  getSettings(): TTSSettings {
    return { ...this.settings };
  }

  getNextMessage(): TTSMessage | null {
    return this.queue.shift() || null;
  }

  skip(): void {
    this.emit('tts:skip' as any, {});
  }
}
