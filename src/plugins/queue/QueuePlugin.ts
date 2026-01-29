/**
 * Queue Plugin
 *
 * Features:
 * - Viewer game queue
 * - Join/leave queue
 * - Pick next player
 * - Random pick
 * - Queue limits
 */

import { Plugin } from '../base/Plugin';
import { PluginMeta, Permission } from '../../types/plugins';
import { getDatabase, DatabaseService } from '../../services/Database';

interface QueueEntry {
  username: string;
  displayName: string;
  joinedAt: Date;
  note?: string;
}

interface QueueSettings {
  enabled: boolean;
  maxSize: number;
  subPriority: boolean;
  pointsCost: number;
}

const DEFAULT_SETTINGS: QueueSettings = {
  enabled: true,
  maxSize: 50,
  subPriority: false,
  pointsCost: 0,
};

export class QueuePlugin extends Plugin {
  meta: PluginMeta = {
    name: 'queue',
    version: '1.0.0',
    description: 'Viewer game queue system',
    author: 'StreamCore',
  };

  private db!: DatabaseService;
  private queue: QueueEntry[] = [];
  private settings: QueueSettings = DEFAULT_SETTINGS;

  protected async init(): Promise<void> {
    this.db = getDatabase();
    this.log.info('Initializing Queue system...');

    // Load settings
    const saved = this.db.getSetting<Partial<QueueSettings>>('queue_settings');
    if (saved) {
      this.settings = { ...DEFAULT_SETTINGS, ...saved };
    }

    this.registerCommands();
    this.log.info('Queue system initialized!');
  }

  private registerCommands(): void {
    // !join - Join the queue
    this.registerCommand({
      name: 'join',
      aliases: ['joinqueue', 'queue', 'mitspielen'],
      description: 'Join the viewer queue',
      usage: '!join [note]',
      cooldown: { user: 5, global: 0 },
      handler: async (ctx) => {
        if (!this.settings.enabled) {
          ctx.reply('❌ Die Queue ist geschlossen!');
          return;
        }

        const username = ctx.user.username.toLowerCase();

        // Check if already in queue
        if (this.queue.some(e => e.username === username)) {
          const pos = this.queue.findIndex(e => e.username === username) + 1;
          ctx.reply(`❌ Du bist bereits in der Queue! Position: #${pos}`);
          return;
        }

        // Check queue size
        if (this.queue.length >= this.settings.maxSize) {
          ctx.reply('❌ Die Queue ist voll!');
          return;
        }

        // Check points cost
        if (this.settings.pointsCost > 0) {
          const user = this.db.getUser('twitch', ctx.user.username);
          if (!user || user.points < this.settings.pointsCost) {
            ctx.reply(`❌ Du brauchst ${this.settings.pointsCost} Punkte!`);
            return;
          }
          this.db.updateUserPoints('twitch', ctx.user.username, -this.settings.pointsCost);
        }

        const entry: QueueEntry = {
          username,
          displayName: ctx.user.displayName,
          joinedAt: new Date(),
          note: ctx.args.length > 0 ? ctx.args.join(' ') : undefined,
        };

        this.queue.push(entry);
        const position = this.queue.length;

        ctx.reply(`✅ ${ctx.user.displayName} ist der Queue beigetreten! Position: #${position}`);
      },
    });

    // !leave - Leave the queue
    this.registerCommand({
      name: 'leave',
      aliases: ['leavequeue', 'quit'],
      description: 'Leave the viewer queue',
      cooldown: { user: 5, global: 0 },
      handler: async (ctx) => {
        const username = ctx.user.username.toLowerCase();
        const index = this.queue.findIndex(e => e.username === username);

        if (index === -1) {
          ctx.reply('❌ Du bist nicht in der Queue!');
          return;
        }

        this.queue.splice(index, 1);
        ctx.reply(`✅ ${ctx.user.displayName} hat die Queue verlassen.`);
      },
    });

    // !position - Check your position
    this.registerCommand({
      name: 'position',
      aliases: ['pos', 'mypos'],
      description: 'Check your position in the queue',
      cooldown: { user: 5, global: 0 },
      handler: async (ctx) => {
        const username = ctx.user.username.toLowerCase();
        const index = this.queue.findIndex(e => e.username === username);

        if (index === -1) {
          ctx.reply('❌ Du bist nicht in der Queue!');
          return;
        }

        ctx.reply(`📋 ${ctx.user.displayName}, du bist auf Position #${index + 1} von ${this.queue.length}`);
      },
    });

    // !list - Show the queue
    this.registerCommand({
      name: 'list',
      aliases: ['queuelist', 'showqueue'],
      description: 'Show the current queue',
      cooldown: { user: 10, global: 5 },
      handler: async (ctx) => {
        if (this.queue.length === 0) {
          ctx.reply('📋 Die Queue ist leer!');
          return;
        }

        const preview = this.queue.slice(0, 5).map((e, i) => `${i + 1}. ${e.displayName}`).join(' | ');
        const more = this.queue.length > 5 ? ` ... +${this.queue.length - 5} weitere` : '';

        ctx.reply(`📋 Queue (${this.queue.length}): ${preview}${more}`);
      },
    });

    // !next - Pick next player (Mod)
    this.registerCommand({
      name: 'next',
      aliases: ['pick', 'picknext'],
      description: 'Pick the next player from queue',
      permission: Permission.MODERATOR,
      cooldown: { user: 0, global: 0 },
      handler: async (ctx) => {
        if (this.queue.length === 0) {
          ctx.reply('📋 Die Queue ist leer!');
          return;
        }

        const next = this.queue.shift()!;
        ctx.reply(
          `🎮 Nächster Spieler: @${next.displayName}` +
          (next.note ? ` (${next.note})` : '') +
          ` | Noch ${this.queue.length} in der Queue`
        );
      },
    });

    // !random - Pick random player (Mod)
    this.registerCommand({
      name: 'random',
      aliases: ['pickrandom', 'randompick'],
      description: 'Pick a random player from queue',
      permission: Permission.MODERATOR,
      cooldown: { user: 0, global: 0 },
      handler: async (ctx) => {
        if (this.queue.length === 0) {
          ctx.reply('📋 Die Queue ist leer!');
          return;
        }

        const index = Math.floor(Math.random() * this.queue.length);
        const picked = this.queue.splice(index, 1)[0];

        ctx.reply(
          `🎲 Zufällig ausgewählt: @${picked.displayName}` +
          (picked.note ? ` (${picked.note})` : '') +
          ` | Noch ${this.queue.length} in der Queue`
        );
      },
    });

    // !clear - Clear the queue (Mod)
    this.registerCommand({
      name: 'clearqueue',
      aliases: ['emptyqueue', 'resetqueue'],
      description: 'Clear the queue',
      permission: Permission.MODERATOR,
      cooldown: { user: 0, global: 0 },
      handler: async (ctx) => {
        const count = this.queue.length;
        this.queue = [];
        ctx.reply(`🗑️ Queue geleert! (${count} Einträge entfernt)`);
      },
    });

    // !open - Open the queue (Mod)
    this.registerCommand({
      name: 'open',
      aliases: ['openqueue'],
      description: 'Open the queue',
      permission: Permission.MODERATOR,
      cooldown: { user: 0, global: 0 },
      handler: async (ctx) => {
        this.settings.enabled = true;
        this.db.setSetting('queue_settings', this.settings);
        ctx.reply('✅ Die Queue ist jetzt OFFEN! Schreibt !join zum Mitmachen!');
      },
    });

    // !close - Close the queue (Mod)
    this.registerCommand({
      name: 'close',
      aliases: ['closequeue'],
      description: 'Close the queue',
      permission: Permission.MODERATOR,
      cooldown: { user: 0, global: 0 },
      handler: async (ctx) => {
        this.settings.enabled = false;
        this.db.setSetting('queue_settings', this.settings);
        ctx.reply('🔒 Die Queue ist jetzt GESCHLOSSEN!');
      },
    });

    // !remove - Remove someone from queue (Mod)
    this.registerCommand({
      name: 'remove',
      aliases: ['kick', 'removefromqueue'],
      description: 'Remove someone from the queue',
      usage: '!remove <username>',
      permission: Permission.MODERATOR,
      cooldown: { user: 0, global: 0 },
      handler: async (ctx) => {
        if (ctx.args.length === 0) {
          ctx.reply('Verwendung: !remove <username>');
          return;
        }

        const target = ctx.args[0].toLowerCase().replace('@', '');
        const index = this.queue.findIndex(e => e.username === target);

        if (index === -1) {
          ctx.reply(`❌ ${target} ist nicht in der Queue!`);
          return;
        }

        this.queue.splice(index, 1);
        ctx.reply(`✅ ${target} aus der Queue entfernt.`);
      },
    });
  }

  // Public API
  getQueue(): QueueEntry[] {
    return [...this.queue];
  }

  isOpen(): boolean {
    return this.settings.enabled;
  }

  getSize(): number {
    return this.queue.length;
  }
}
