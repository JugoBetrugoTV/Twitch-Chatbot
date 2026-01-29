/**
 * Counters Plugin
 *
 * Features:
 * - Death counter for gaming
 * - Custom counters
 * - Increment/decrement
 * - Reset
 */

import { Plugin } from '../base/Plugin';
import { PluginMeta, Permission } from '../../types/plugins';
import { getDatabase, DatabaseService } from '../../services/Database';

interface Counter {
  name: string;
  value: number;
  game?: string;
}

export class CountersPlugin extends Plugin {
  meta: PluginMeta = {
    name: 'counters',
    version: '1.0.0',
    description: 'Death counter and custom counters',
    author: 'StreamCore',
  };

  private db!: DatabaseService;

  protected async init(): Promise<void> {
    this.db = getDatabase();
    this.log.info('Initializing Counters system...');

    // Create counters table if not exists
    this.db.raw().exec(`
      CREATE TABLE IF NOT EXISTS counters (
        name TEXT PRIMARY KEY,
        value INTEGER DEFAULT 0,
        game TEXT,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    this.registerCommands();
    this.log.info('Counters system initialized!');
  }

  private registerCommands(): void {
    // !death - Death counter
    this.registerCommand({
      name: 'death',
      aliases: ['deaths', 'died', 'tod', 'tode'],
      description: 'Death counter',
      usage: '!death [+/-/set/reset]',
      cooldown: { user: 2, global: 0 },
      handler: async (ctx) => {
        const counter = this.getCounter('deaths');

        if (ctx.args.length === 0) {
          ctx.reply(`💀 Tode: ${counter}`);
          return;
        }

        // Mod only for modifications
        if (!ctx.user.isMod && !ctx.user.isBroadcaster) {
          ctx.reply(`💀 Tode: ${counter}`);
          return;
        }

        const action = ctx.args[0].toLowerCase();

        if (action === '+' || action === 'add' || action === '++') {
          const newValue = this.incrementCounter('deaths');
          ctx.reply(`💀 Tod #${newValue}! RIP`);
        } else if (action === '-' || action === 'remove' || action === '--') {
          const newValue = this.decrementCounter('deaths');
          ctx.reply(`💀 Tode: ${newValue}`);
        } else if (action === 'set' && ctx.args[1]) {
          const value = parseInt(ctx.args[1]);
          if (!isNaN(value)) {
            this.setCounter('deaths', value);
            ctx.reply(`💀 Tode auf ${value} gesetzt!`);
          }
        } else if (action === 'reset') {
          this.setCounter('deaths', 0);
          ctx.reply(`💀 Tode zurückgesetzt!`);
        } else {
          // Try to parse as number for quick set
          const value = parseInt(action);
          if (!isNaN(value)) {
            this.setCounter('deaths', value);
            ctx.reply(`💀 Tode: ${value}`);
          }
        }
      },
    });

    // !counter - Custom counters
    this.registerCommand({
      name: 'counter',
      aliases: ['count', 'zaehler'],
      description: 'Manage custom counters',
      usage: '!counter <name> [+/-/set/reset]',
      cooldown: { user: 2, global: 0 },
      handler: async (ctx) => {
        if (ctx.args.length === 0) {
          ctx.reply('Verwendung: !counter <name> [+/-/set/reset]');
          return;
        }

        const name = ctx.args[0].toLowerCase();
        const counter = this.getCounter(name);

        if (ctx.args.length === 1) {
          ctx.reply(`📊 ${name}: ${counter}`);
          return;
        }

        // Mod only for modifications
        if (!ctx.user.isMod && !ctx.user.isBroadcaster) {
          ctx.reply(`📊 ${name}: ${counter}`);
          return;
        }

        const action = ctx.args[1].toLowerCase();

        if (action === '+' || action === 'add' || action === '++') {
          const amount = parseInt(ctx.args[2]) || 1;
          const newValue = this.incrementCounter(name, amount);
          ctx.reply(`📊 ${name}: ${newValue} (+${amount})`);
        } else if (action === '-' || action === 'remove' || action === '--') {
          const amount = parseInt(ctx.args[2]) || 1;
          const newValue = this.decrementCounter(name, amount);
          ctx.reply(`📊 ${name}: ${newValue} (-${amount})`);
        } else if (action === 'set' && ctx.args[2]) {
          const value = parseInt(ctx.args[2]);
          if (!isNaN(value)) {
            this.setCounter(name, value);
            ctx.reply(`📊 ${name} auf ${value} gesetzt!`);
          }
        } else if (action === 'reset') {
          this.setCounter(name, 0);
          ctx.reply(`📊 ${name} zurückgesetzt!`);
        } else if (action === 'delete') {
          this.deleteCounter(name);
          ctx.reply(`🗑️ Counter "${name}" gelöscht!`);
        } else {
          // Try to parse as number for quick set
          const value = parseInt(action);
          if (!isNaN(value)) {
            this.setCounter(name, value);
            ctx.reply(`📊 ${name}: ${value}`);
          }
        }
      },
    });

    // !counters - List all counters
    this.registerCommand({
      name: 'counters',
      aliases: ['listcounters'],
      description: 'List all counters',
      permission: Permission.MODERATOR,
      cooldown: { user: 10, global: 5 },
      handler: async (ctx) => {
        const counters = this.getAllCounters();

        if (counters.length === 0) {
          ctx.reply('📊 Keine Counter vorhanden.');
          return;
        }

        const list = counters.map(c => `${c.name}: ${c.value}`).join(' | ');
        ctx.reply(`📊 Counter: ${list}`);
      },
    });

    // Quick shortcuts
    this.registerCommand({
      name: 'd+',
      description: 'Quick death increment',
      permission: Permission.MODERATOR,
      cooldown: { user: 2, global: 0 },
      handler: async (ctx) => {
        const newValue = this.incrementCounter('deaths');
        ctx.reply(`💀 Tod #${newValue}!`);
      },
    });

    this.registerCommand({
      name: 'd-',
      description: 'Quick death decrement',
      permission: Permission.MODERATOR,
      cooldown: { user: 2, global: 0 },
      handler: async (ctx) => {
        const newValue = this.decrementCounter('deaths');
        ctx.reply(`💀 Tode: ${newValue}`);
      },
    });
  }

  private getCounter(name: string): number {
    const stmt = this.db.raw().prepare('SELECT value FROM counters WHERE name = ?');
    const row = stmt.get(name) as { value: number } | undefined;
    return row?.value || 0;
  }

  private setCounter(name: string, value: number): void {
    const stmt = this.db.raw().prepare(`
      INSERT INTO counters (name, value, updated_at)
      VALUES (?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(name) DO UPDATE SET value = ?, updated_at = CURRENT_TIMESTAMP
    `);
    stmt.run(name, value, value);
  }

  private incrementCounter(name: string, amount: number = 1): number {
    const current = this.getCounter(name);
    const newValue = current + amount;
    this.setCounter(name, newValue);
    return newValue;
  }

  private decrementCounter(name: string, amount: number = 1): number {
    const current = this.getCounter(name);
    const newValue = Math.max(0, current - amount);
    this.setCounter(name, newValue);
    return newValue;
  }

  private deleteCounter(name: string): void {
    const stmt = this.db.raw().prepare('DELETE FROM counters WHERE name = ?');
    stmt.run(name);
  }

  private getAllCounters(): Counter[] {
    const stmt = this.db.raw().prepare('SELECT name, value, game FROM counters');
    return stmt.all() as Counter[];
  }

  // Public API
  get(name: string): number {
    return this.getCounter(name);
  }

  set(name: string, value: number): void {
    this.setCounter(name, value);
  }

  increment(name: string, amount: number = 1): number {
    return this.incrementCounter(name, amount);
  }

  decrement(name: string, amount: number = 1): number {
    return this.decrementCounter(name, amount);
  }
}
