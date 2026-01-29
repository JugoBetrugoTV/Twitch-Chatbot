/**
 * Lurk System Plugin
 *
 * Features:
 * - !lurk to enter lurk mode
 * - !unlurk / !back to return
 * - Track lurk duration
 * - Welcome back messages
 */

import { Plugin } from '../base/Plugin';
import { PluginMeta, Permission } from '../../types/plugins';
import { ChatMessageEvent } from '../../types/events';
import { getDatabase, DatabaseService } from '../../services/Database';

interface Lurker {
  username: string;
  displayName: string;
  startedAt: Date;
  message?: string;
}

export class LurkPlugin extends Plugin {
  meta: PluginMeta = {
    name: 'lurk',
    version: '1.0.0',
    description: 'Lurk tracking system',
    author: 'StreamCore',
  };

  private db!: DatabaseService;
  private lurkers: Map<string, Lurker> = new Map();
  private welcomeMessages: string[] = [
    'Willkommen zurück, {user}! Du hast {time} gelurkt! 👀',
    '{user} ist wieder da nach {time} im Schatten! 🌙',
    'Der Lurker {user} kehrt nach {time} zurück! 👋',
    '{user} hat {time} lang die Schatten beobachtet und ist zurück! 🦇',
  ];

  protected async init(): Promise<void> {
    this.db = getDatabase();
    this.log.info('Initializing Lurk system...');

    this.registerCommands();
    this.setupAutoUnlurk();

    this.log.info('Lurk system initialized!');
  }

  protected async destroy(): Promise<void> {}

  private setupAutoUnlurk(): void {
    // Auto-unlurk when lurker sends a message
    this.ctx.events.on('chat:message', (event: ChatMessageEvent) => {
      const username = event.user.username.toLowerCase();

      // Skip if it's a lurk/unlurk command
      if (event.message.startsWith('!lurk') || event.message.startsWith('!back') || event.message.startsWith('!unlurk')) {
        return;
      }

      // Check if user is lurking
      if (this.lurkers.has(username)) {
        // Don't auto-announce, let them use !unlurk if they want
      }
    });
  }

  private registerCommands(): void {
    // !lurk - Enter lurk mode
    this.registerCommand({
      name: 'lurk',
      aliases: ['afk', 'brb'],
      description: 'Enter lurk mode',
      usage: '!lurk [message]',
      cooldown: { user: 30, global: 0 },
      handler: async (ctx) => {
        const username = ctx.user.username.toLowerCase();

        // Check if already lurking
        if (this.lurkers.has(username)) {
          ctx.reply(`👀 ${ctx.user.displayName}, du lurkst bereits!`);
          return;
        }

        const message = ctx.args.join(' ') || undefined;

        this.lurkers.set(username, {
          username,
          displayName: ctx.user.displayName,
          startedAt: new Date(),
          message,
        });

        if (message) {
          ctx.reply(`👀 ${ctx.user.displayName} lurkt jetzt: "${message}"`);
        } else {
          ctx.reply(`👀 ${ctx.user.displayName} ist jetzt im Lurk-Modus! Bis später!`);
        }
      },
    });

    // !unlurk / !back - Return from lurk
    this.registerCommand({
      name: 'unlurk',
      aliases: ['back', 'return', 'da'],
      description: 'Return from lurk mode',
      cooldown: { user: 30, global: 0 },
      handler: async (ctx) => {
        const username = ctx.user.username.toLowerCase();
        const lurker = this.lurkers.get(username);

        if (!lurker) {
          ctx.reply(`👋 Willkommen, ${ctx.user.displayName}!`);
          return;
        }

        const duration = this.formatDuration(lurker.startedAt);
        this.lurkers.delete(username);

        // Random welcome message
        const template = this.welcomeMessages[Math.floor(Math.random() * this.welcomeMessages.length)];
        const message = template
          .replace('{user}', ctx.user.displayName)
          .replace('{time}', duration);

        ctx.reply(message);

        // Log lurk time
        this.db.logEvent('lurk_end', {
          username,
          duration: Date.now() - lurker.startedAt.getTime(),
        });
      },
    });

    // !lurkers - Show current lurkers (mod)
    this.registerCommand({
      name: 'lurkers',
      aliases: ['wholurks'],
      description: 'Show current lurkers',
      permission: Permission.MODERATOR,
      cooldown: { user: 30, global: 10 },
      handler: async (ctx) => {
        if (this.lurkers.size === 0) {
          ctx.reply('👀 Keine bekannten Lurker gerade');
          return;
        }

        const lurkerList = Array.from(this.lurkers.values())
          .slice(0, 10)
          .map((l) => `${l.displayName} (${this.formatDuration(l.startedAt)})`)
          .join(', ');

        ctx.reply(`👀 Lurker (${this.lurkers.size}): ${lurkerList}`);
      },
    });

    // !lurktime - Check how long you've been lurking
    this.registerCommand({
      name: 'lurktime',
      description: 'Check your lurk time',
      cooldown: { user: 30, global: 0 },
      handler: async (ctx) => {
        const username = ctx.user.username.toLowerCase();
        const lurker = this.lurkers.get(username);

        if (!lurker) {
          ctx.reply(`${ctx.user.displayName}, du lurkst nicht gerade!`);
          return;
        }

        const duration = this.formatDuration(lurker.startedAt);
        ctx.reply(`👀 ${ctx.user.displayName} lurkt seit ${duration}`);
      },
    });

    // !lurkboard - Show longest lurkers
    this.registerCommand({
      name: 'lurkboard',
      aliases: ['toplurkers'],
      description: 'Show longest lurkers',
      cooldown: { user: 60, global: 30 },
      handler: async (ctx) => {
        if (this.lurkers.size === 0) {
          ctx.reply('👀 Keine Lurker gerade');
          return;
        }

        const sorted = Array.from(this.lurkers.values())
          .sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime())
          .slice(0, 5);

        const medals = ['🥇', '🥈', '🥉', '4️⃣', '5️⃣'];
        const board = sorted
          .map((l, i) => `${medals[i]} ${l.displayName}: ${this.formatDuration(l.startedAt)}`)
          .join(' | ');

        ctx.reply(`👀 Top Lurker: ${board}`);
      },
    });
  }

  private formatDuration(startDate: Date): string {
    const ms = Date.now() - startDate.getTime();
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) {
      return `${hours}h ${minutes % 60}m`;
    } else if (minutes > 0) {
      return `${minutes}m`;
    } else {
      return `${seconds}s`;
    }
  }

  // Public API
  isLurking(username: string): boolean {
    return this.lurkers.has(username.toLowerCase());
  }

  getLurkers(): Lurker[] {
    return Array.from(this.lurkers.values());
  }

  getLurkerCount(): number {
    return this.lurkers.size;
  }
}
