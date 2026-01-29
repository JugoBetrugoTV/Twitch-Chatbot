/**
 * Quotes Plugin
 *
 * Features:
 * - Save memorable quotes
 * - Random quote recall
 * - Quote by ID
 * - Search quotes
 */

import { Plugin } from '../base/Plugin';
import { PluginMeta, Permission } from '../../types/plugins';
import { getDatabase, DatabaseService } from '../../services/Database';
import { v4 as uuidv4 } from 'uuid';

interface Quote {
  id: number;
  text: string;
  author: string;
  addedBy: string;
  addedAt: string;
  game?: string;
}

export class QuotesPlugin extends Plugin {
  meta: PluginMeta = {
    name: 'quotes',
    version: '1.0.0',
    description: 'Save and recall quotes',
    author: 'StreamCore',
  };

  private db!: DatabaseService;

  protected async init(): Promise<void> {
    this.db = getDatabase();
    this.log.info('Initializing Quotes system...');

    // Create quotes table if not exists
    this.db.raw().exec(`
      CREATE TABLE IF NOT EXISTS quotes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        text TEXT NOT NULL,
        author TEXT,
        added_by TEXT NOT NULL,
        added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        game TEXT
      )
    `);

    this.registerCommands();
    this.log.info('Quotes system initialized!');
  }

  private registerCommands(): void {
    // !quote - Get a random or specific quote
    this.registerCommand({
      name: 'quote',
      aliases: ['zitat', 'q'],
      description: 'Get a random or specific quote',
      usage: '!quote [id/search]',
      cooldown: { user: 5, global: 0 },
      handler: async (ctx) => {
        if (ctx.args.length === 0) {
          // Random quote
          const quote = this.getRandomQuote();
          if (!quote) {
            ctx.reply('📜 Noch keine Zitate gespeichert!');
            return;
          }
          ctx.reply(this.formatQuote(quote));
          return;
        }

        const arg = ctx.args[0];

        // Check if it's an ID
        const id = parseInt(arg);
        if (!isNaN(id)) {
          const quote = this.getQuoteById(id);
          if (!quote) {
            ctx.reply(`❌ Zitat #${id} nicht gefunden!`);
            return;
          }
          ctx.reply(this.formatQuote(quote));
          return;
        }

        // Search
        const query = ctx.args.join(' ');
        const quote = this.searchQuote(query);
        if (!quote) {
          ctx.reply('❌ Kein passendes Zitat gefunden!');
          return;
        }
        ctx.reply(this.formatQuote(quote));
      },
    });

    // !addquote - Add a new quote
    this.registerCommand({
      name: 'addquote',
      aliases: ['quoteadd', 'newquote', 'aq'],
      description: 'Add a new quote',
      usage: '!addquote <text> [--author Name]',
      permission: Permission.MODERATOR,
      cooldown: { user: 5, global: 0 },
      handler: async (ctx) => {
        if (ctx.args.length === 0) {
          ctx.reply('Verwendung: !addquote <text> [--author Name]');
          return;
        }

        const fullText = ctx.args.join(' ');

        // Parse author if provided
        let text = fullText;
        let author = '';

        const authorMatch = fullText.match(/--author\s+(.+?)(?:\s+--|$)/i);
        if (authorMatch) {
          author = authorMatch[1].trim();
          text = fullText.replace(/--author\s+.+?(?:\s+--|$)/i, '').trim();
        }

        const id = this.addQuote(text, author, ctx.user.username);
        ctx.reply(`✅ Zitat #${id} gespeichert!`);
      },
    });

    // !delquote - Delete a quote
    this.registerCommand({
      name: 'delquote',
      aliases: ['quotedel', 'removequote', 'rmquote'],
      description: 'Delete a quote',
      usage: '!delquote <id>',
      permission: Permission.MODERATOR,
      cooldown: { user: 0, global: 0 },
      handler: async (ctx) => {
        if (ctx.args.length === 0) {
          ctx.reply('Verwendung: !delquote <id>');
          return;
        }

        const id = parseInt(ctx.args[0]);
        if (isNaN(id)) {
          ctx.reply('❌ Ungültige ID!');
          return;
        }

        const deleted = this.deleteQuote(id);
        if (deleted) {
          ctx.reply(`✅ Zitat #${id} gelöscht!`);
        } else {
          ctx.reply(`❌ Zitat #${id} nicht gefunden!`);
        }
      },
    });

    // !editquote - Edit a quote
    this.registerCommand({
      name: 'editquote',
      aliases: ['quoteedit'],
      description: 'Edit a quote',
      usage: '!editquote <id> <new text>',
      permission: Permission.MODERATOR,
      cooldown: { user: 0, global: 0 },
      handler: async (ctx) => {
        if (ctx.args.length < 2) {
          ctx.reply('Verwendung: !editquote <id> <neuer text>');
          return;
        }

        const id = parseInt(ctx.args[0]);
        if (isNaN(id)) {
          ctx.reply('❌ Ungültige ID!');
          return;
        }

        const newText = ctx.args.slice(1).join(' ');
        const updated = this.editQuote(id, newText);

        if (updated) {
          ctx.reply(`✅ Zitat #${id} aktualisiert!`);
        } else {
          ctx.reply(`❌ Zitat #${id} nicht gefunden!`);
        }
      },
    });

    // !quotestats - Show quote stats
    this.registerCommand({
      name: 'quotestats',
      aliases: ['quotecount'],
      description: 'Show quote statistics',
      cooldown: { user: 10, global: 5 },
      handler: async (ctx) => {
        const count = this.getQuoteCount();
        ctx.reply(`📜 Es gibt ${count} gespeicherte Zitate!`);
      },
    });
  }

  private formatQuote(quote: Quote): string {
    let formatted = `📜 #${quote.id}: "${quote.text}"`;
    if (quote.author) {
      formatted += ` - ${quote.author}`;
    }
    return formatted;
  }

  private getRandomQuote(): Quote | null {
    const stmt = this.db.raw().prepare(`
      SELECT * FROM quotes ORDER BY RANDOM() LIMIT 1
    `);
    const row = stmt.get() as any;
    if (!row) return null;

    return {
      id: row.id,
      text: row.text,
      author: row.author || '',
      addedBy: row.added_by,
      addedAt: row.added_at,
      game: row.game,
    };
  }

  private getQuoteById(id: number): Quote | null {
    const stmt = this.db.raw().prepare('SELECT * FROM quotes WHERE id = ?');
    const row = stmt.get(id) as any;
    if (!row) return null;

    return {
      id: row.id,
      text: row.text,
      author: row.author || '',
      addedBy: row.added_by,
      addedAt: row.added_at,
      game: row.game,
    };
  }

  private searchQuote(query: string): Quote | null {
    const stmt = this.db.raw().prepare(`
      SELECT * FROM quotes
      WHERE text LIKE ? OR author LIKE ?
      ORDER BY RANDOM() LIMIT 1
    `);
    const searchTerm = `%${query}%`;
    const row = stmt.get(searchTerm, searchTerm) as any;
    if (!row) return null;

    return {
      id: row.id,
      text: row.text,
      author: row.author || '',
      addedBy: row.added_by,
      addedAt: row.added_at,
      game: row.game,
    };
  }

  private addQuote(text: string, author: string, addedBy: string): number {
    const stmt = this.db.raw().prepare(`
      INSERT INTO quotes (text, author, added_by) VALUES (?, ?, ?)
    `);
    const result = stmt.run(text, author || null, addedBy);
    return result.lastInsertRowid as number;
  }

  private deleteQuote(id: number): boolean {
    const stmt = this.db.raw().prepare('DELETE FROM quotes WHERE id = ?');
    const result = stmt.run(id);
    return result.changes > 0;
  }

  private editQuote(id: number, newText: string): boolean {
    const stmt = this.db.raw().prepare('UPDATE quotes SET text = ? WHERE id = ?');
    const result = stmt.run(newText, id);
    return result.changes > 0;
  }

  private getQuoteCount(): number {
    const stmt = this.db.raw().prepare('SELECT COUNT(*) as count FROM quotes');
    const result = stmt.get() as { count: number };
    return result.count;
  }
}
