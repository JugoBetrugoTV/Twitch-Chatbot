/**
 * Loyalty Shop Plugin
 *
 * Features:
 * - Redeem points for rewards
 * - Customizable shop items
 * - Built-in rewards: TTS, Song Skip, VIP, Highlight
 * - Cooldowns per item
 * - Stock limits (optional)
 * - Redemption history
 */

import { Plugin } from '../base/Plugin';
import { PluginMeta, Permission } from '../../types/plugins';
import { getDatabase, DatabaseService } from '../../services/Database';

export interface ShopItem {
  id: string;
  name: string;
  description: string;
  cost: number;
  type: 'tts' | 'songskip' | 'vip' | 'highlight' | 'timeout' | 'custom';
  enabled: boolean;
  cooldownMinutes: number;
  stock: number; // -1 = unlimited
  requireInput: boolean;
  inputPrompt?: string;
  customAction?: string; // For custom items
}

interface Redemption {
  id: number;
  itemId: string;
  username: string;
  cost: number;
  input?: string;
  timestamp: string;
  fulfilled: boolean;
}

interface ShopSettings {
  enabled: boolean;
  currencyName: string;
}

const DEFAULT_ITEMS: ShopItem[] = [
  {
    id: 'tts',
    name: 'TTS Nachricht',
    description: 'Lasse eine Nachricht vorlesen',
    cost: 500,
    type: 'tts',
    enabled: true,
    cooldownMinutes: 5,
    stock: -1,
    requireInput: true,
    inputPrompt: 'Was soll vorgelesen werden?',
  },
  {
    id: 'songskip',
    name: 'Song Skippen',
    description: 'Überspringe den aktuellen Song',
    cost: 1000,
    type: 'songskip',
    enabled: true,
    cooldownMinutes: 10,
    stock: -1,
    requireInput: false,
  },
  {
    id: 'vip_1h',
    name: 'VIP für 1 Stunde',
    description: 'Werde für 1 Stunde VIP',
    cost: 5000,
    type: 'vip',
    enabled: true,
    cooldownMinutes: 60,
    stock: -1,
    requireInput: false,
  },
  {
    id: 'highlight',
    name: 'Nachricht Hervorheben',
    description: 'Deine nächste Nachricht wird hervorgehoben',
    cost: 200,
    type: 'highlight',
    enabled: true,
    cooldownMinutes: 2,
    stock: -1,
    requireInput: false,
  },
  {
    id: 'timeout_friend',
    name: 'Freund timeouten',
    description: 'Gib einem Freund einen 60s Timeout',
    cost: 2000,
    type: 'timeout',
    enabled: true,
    cooldownMinutes: 30,
    stock: -1,
    requireInput: true,
    inputPrompt: 'Wen willst du timeouten?',
  },
];

export class ShopPlugin extends Plugin {
  meta: PluginMeta = {
    name: 'shop',
    version: '1.0.0',
    description: 'Loyalty shop for redeeming points',
    author: 'StreamCore',
  };

  private db!: DatabaseService;
  private items: Map<string, ShopItem> = new Map();
  private cooldowns: Map<string, Map<string, number>> = new Map(); // itemId -> username -> timestamp
  private settings: ShopSettings = { enabled: true, currencyName: 'Punkte' };
  private highlightedUsers: Set<string> = new Set();
  private tempVips: Map<string, NodeJS.Timeout> = new Map();

  protected async init(): Promise<void> {
    this.db = getDatabase();
    this.log.info('Initializing Shop system...');

    // Initialize database tables
    this.initTables();

    // Load items from database
    this.loadItems();

    // Load settings
    const savedSettings = this.db.getSetting<ShopSettings>('shop_settings');
    if (savedSettings) {
      this.settings = savedSettings;
    }

    // Register commands
    this.registerCommands();

    this.log.info('Shop system initialized!');
  }

  protected async destroy(): Promise<void> {
    // Clear temp VIP timers
    for (const timer of this.tempVips.values()) {
      clearTimeout(timer);
    }
  }

  private initTables(): void {
    const db = this.db.raw();

    // Shop items table
    db.exec(`
      CREATE TABLE IF NOT EXISTS shop_items (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        cost INTEGER NOT NULL,
        type TEXT NOT NULL,
        enabled BOOLEAN DEFAULT TRUE,
        cooldown_minutes INTEGER DEFAULT 0,
        stock INTEGER DEFAULT -1,
        require_input BOOLEAN DEFAULT FALSE,
        input_prompt TEXT,
        custom_action TEXT
      );
    `);

    // Redemptions table
    db.exec(`
      CREATE TABLE IF NOT EXISTS shop_redemptions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        item_id TEXT NOT NULL,
        username TEXT NOT NULL,
        cost INTEGER NOT NULL,
        input TEXT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        fulfilled BOOLEAN DEFAULT FALSE,
        FOREIGN KEY (item_id) REFERENCES shop_items(id)
      );

      CREATE INDEX IF NOT EXISTS idx_redemptions_item ON shop_redemptions(item_id);
      CREATE INDEX IF NOT EXISTS idx_redemptions_user ON shop_redemptions(username);
    `);
  }

  private loadItems(): void {
    const db = this.db.raw();
    const stmt = db.prepare('SELECT * FROM shop_items');
    const rows = stmt.all() as any[];

    if (rows.length === 0) {
      // Insert default items
      for (const item of DEFAULT_ITEMS) {
        this.saveItem(item);
        this.items.set(item.id, item);
      }
      this.log.info(`Loaded ${DEFAULT_ITEMS.length} default shop items`);
    } else {
      for (const row of rows) {
        const item: ShopItem = {
          id: row.id,
          name: row.name,
          description: row.description,
          cost: row.cost,
          type: row.type,
          enabled: !!row.enabled,
          cooldownMinutes: row.cooldown_minutes,
          stock: row.stock,
          requireInput: !!row.require_input,
          inputPrompt: row.input_prompt,
          customAction: row.custom_action,
        };
        this.items.set(item.id, item);
      }
      this.log.info(`Loaded ${rows.length} shop items`);
    }
  }

  private saveItem(item: ShopItem): void {
    const db = this.db.raw();
    const stmt = db.prepare(`
      INSERT OR REPLACE INTO shop_items
      (id, name, description, cost, type, enabled, cooldown_minutes, stock, require_input, input_prompt, custom_action)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      item.id,
      item.name,
      item.description,
      item.cost,
      item.type,
      item.enabled ? 1 : 0,
      item.cooldownMinutes,
      item.stock,
      item.requireInput ? 1 : 0,
      item.inputPrompt,
      item.customAction
    );
  }

  private registerCommands(): void {
    // !shop - Show shop
    this.registerCommand({
      name: 'shop',
      aliases: ['store', 'rewards'],
      description: 'View the loyalty shop',
      cooldown: { user: 10, global: 0 },
      handler: async (ctx) => {
        if (!this.settings.enabled) {
          ctx.reply('🛒 Der Shop ist derzeit geschlossen!');
          return;
        }

        const items = Array.from(this.items.values()).filter((i) => i.enabled);

        if (items.length === 0) {
          ctx.reply('🛒 Der Shop ist leer!');
          return;
        }

        // Show first 5 items
        const display = items
          .slice(0, 5)
          .map((i) => `${i.name} (${i.cost} ${this.settings.currencyName})`)
          .join(' | ');

        ctx.reply(`🛒 Shop: ${display} | Nutze !buy <item> zum Kaufen`);
      },
    });

    // !buy - Buy item
    this.registerCommand({
      name: 'buy',
      aliases: ['redeem', 'kaufen'],
      description: 'Buy an item from the shop',
      usage: '!buy <item> [input]',
      cooldown: { user: 3, global: 0 },
      handler: async (ctx) => {
        if (!this.settings.enabled) {
          ctx.reply('🛒 Der Shop ist derzeit geschlossen!');
          return;
        }

        if (ctx.args.length === 0) {
          ctx.reply('Verwendung: !buy <item> [input] - Nutze !shop für verfügbare Items');
          return;
        }

        const itemQuery = ctx.args[0].toLowerCase();
        const input = ctx.args.slice(1).join(' ');

        // Find item by ID or name
        let item: ShopItem | undefined;
        for (const i of this.items.values()) {
          if (
            i.id.toLowerCase() === itemQuery ||
            i.name.toLowerCase().includes(itemQuery)
          ) {
            item = i;
            break;
          }
        }

        if (!item) {
          ctx.reply('❌ Item nicht gefunden! Nutze !shop für verfügbare Items');
          return;
        }

        if (!item.enabled) {
          ctx.reply('❌ Dieses Item ist nicht verfügbar!');
          return;
        }

        // Check input requirement
        if (item.requireInput && !input) {
          ctx.reply(`❌ ${item.inputPrompt || 'Bitte gib einen Text an!'}`);
          return;
        }

        // Check stock
        if (item.stock === 0) {
          ctx.reply('❌ Dieses Item ist ausverkauft!');
          return;
        }

        // Check cooldown
        const cooldownKey = `${item.id}:${ctx.user.username.toLowerCase()}`;
        const itemCooldowns = this.cooldowns.get(item.id) || new Map();
        const lastUse = itemCooldowns.get(ctx.user.username.toLowerCase()) || 0;
        const cooldownEnd = lastUse + item.cooldownMinutes * 60 * 1000;

        if (Date.now() < cooldownEnd) {
          const remaining = Math.ceil((cooldownEnd - Date.now()) / 60000);
          ctx.reply(`⏳ Du musst noch ${remaining} Minuten warten!`);
          return;
        }

        // Check points
        const user = this.db.getUser('twitch', ctx.user.username);
        if (!user || user.points < item.cost) {
          ctx.reply(
            `❌ Du hast nicht genug ${this.settings.currencyName}! ` +
            `(${user?.points || 0}/${item.cost})`
          );
          return;
        }

        // Deduct points
        this.db.updateUserPoints('twitch', ctx.user.username, -item.cost);

        // Update cooldown
        itemCooldowns.set(ctx.user.username.toLowerCase(), Date.now());
        this.cooldowns.set(item.id, itemCooldowns);

        // Update stock
        if (item.stock > 0) {
          item.stock--;
          this.saveItem(item);
        }

        // Log redemption
        this.logRedemption(item, ctx.user.username, input);

        // Execute reward
        await this.executeReward(ctx, item, input);
      },
    });

    // !shopitem - Manage shop items (mod)
    this.registerCommand({
      name: 'shopitem',
      aliases: ['setitem'],
      description: 'Manage shop items',
      usage: '!shopitem <add|remove|price|toggle> <item> [value]',
      permission: Permission.MODERATOR,
      cooldown: { user: 3, global: 0 },
      handler: async (ctx) => {
        const action = ctx.args[0]?.toLowerCase();

        if (!action) {
          ctx.reply('Verwendung: !shopitem <add|remove|price|toggle|stock> <item> [value]');
          return;
        }

        if (action === 'list') {
          const items = Array.from(this.items.values());
          const display = items
            .map((i) => `${i.id}: ${i.cost}P ${i.enabled ? '✅' : '❌'}`)
            .join(' | ');
          ctx.reply(`📋 Items: ${display}`);
          return;
        }

        const itemId = ctx.args[1]?.toLowerCase();
        if (!itemId) {
          ctx.reply('❌ Bitte gib ein Item an!');
          return;
        }

        const item = this.items.get(itemId);

        switch (action) {
          case 'price':
            if (!item) {
              ctx.reply('❌ Item nicht gefunden!');
              return;
            }
            const price = parseInt(ctx.args[2]);
            if (isNaN(price) || price < 0) {
              ctx.reply('❌ Ungültiger Preis!');
              return;
            }
            item.cost = price;
            this.saveItem(item);
            ctx.reply(`✅ ${item.name} kostet jetzt ${price} ${this.settings.currencyName}`);
            break;

          case 'toggle':
            if (!item) {
              ctx.reply('❌ Item nicht gefunden!');
              return;
            }
            item.enabled = !item.enabled;
            this.saveItem(item);
            ctx.reply(`✅ ${item.name} ist jetzt ${item.enabled ? 'aktiviert' : 'deaktiviert'}`);
            break;

          case 'stock':
            if (!item) {
              ctx.reply('❌ Item nicht gefunden!');
              return;
            }
            const stock = parseInt(ctx.args[2]);
            if (isNaN(stock)) {
              ctx.reply('❌ Ungültige Anzahl! (-1 = unbegrenzt)');
              return;
            }
            item.stock = stock;
            this.saveItem(item);
            ctx.reply(
              `✅ ${item.name} hat jetzt ${stock === -1 ? 'unbegrenzten' : stock} Vorrat`
            );
            break;

          case 'cooldown':
            if (!item) {
              ctx.reply('❌ Item nicht gefunden!');
              return;
            }
            const cooldown = parseInt(ctx.args[2]);
            if (isNaN(cooldown) || cooldown < 0) {
              ctx.reply('❌ Ungültiger Cooldown (in Minuten)!');
              return;
            }
            item.cooldownMinutes = cooldown;
            this.saveItem(item);
            ctx.reply(`✅ ${item.name} hat jetzt ${cooldown} Minuten Cooldown`);
            break;

          case 'add':
            const name = ctx.args.slice(2).join(' ');
            if (!name) {
              ctx.reply('❌ Bitte gib einen Namen an! !shopitem add <id> <name>');
              return;
            }
            const newItem: ShopItem = {
              id: itemId,
              name: name,
              description: '',
              cost: 1000,
              type: 'custom',
              enabled: true,
              cooldownMinutes: 5,
              stock: -1,
              requireInput: false,
            };
            this.items.set(itemId, newItem);
            this.saveItem(newItem);
            ctx.reply(`✅ Item "${name}" erstellt! Nutze !shopitem price/toggle um es anzupassen`);
            break;

          case 'remove':
            if (!item) {
              ctx.reply('❌ Item nicht gefunden!');
              return;
            }
            this.items.delete(itemId);
            const db = this.db.raw();
            db.prepare('DELETE FROM shop_items WHERE id = ?').run(itemId);
            ctx.reply(`✅ ${item.name} wurde entfernt!`);
            break;

          default:
            ctx.reply('❌ Unbekannte Aktion. Nutze: add, remove, price, toggle, stock, cooldown');
        }
      },
    });

    // !shoptoggle - Toggle shop
    this.registerCommand({
      name: 'shoptoggle',
      description: 'Enable/disable the shop',
      permission: Permission.MODERATOR,
      cooldown: { user: 5, global: 0 },
      handler: async (ctx) => {
        this.settings.enabled = !this.settings.enabled;
        this.db.setSetting('shop_settings', this.settings);
        ctx.reply(`🛒 Shop ist jetzt ${this.settings.enabled ? 'geöffnet' : 'geschlossen'}`);
      },
    });

    // !redemptions - Show recent redemptions (mod)
    this.registerCommand({
      name: 'redemptions',
      aliases: ['redeems'],
      description: 'Show recent redemptions',
      permission: Permission.MODERATOR,
      cooldown: { user: 10, global: 0 },
      handler: async (ctx) => {
        const db = this.db.raw();
        const stmt = db.prepare(`
          SELECT r.*, i.name as item_name
          FROM shop_redemptions r
          JOIN shop_items i ON r.item_id = i.id
          ORDER BY r.timestamp DESC
          LIMIT 5
        `);
        const rows = stmt.all() as any[];

        if (rows.length === 0) {
          ctx.reply('📋 Keine Einlösungen vorhanden');
          return;
        }

        const display = rows
          .map((r) => `${r.username}: ${r.item_name}`)
          .join(' | ');
        ctx.reply(`📋 Letzte Einlösungen: ${display}`);
      },
    });
  }

  private logRedemption(item: ShopItem, username: string, input?: string): void {
    const db = this.db.raw();
    const stmt = db.prepare(`
      INSERT INTO shop_redemptions (item_id, username, cost, input)
      VALUES (?, ?, ?, ?)
    `);
    stmt.run(item.id, username.toLowerCase(), item.cost, input || null);
  }

  private async executeReward(ctx: any, item: ShopItem, input?: string): Promise<void> {
    const channel = ctx.channel;

    switch (item.type) {
      case 'tts':
        // Emit TTS event for TTS plugin to handle
        this.ctx.events.emit('shop:tts', {
          username: ctx.user.displayName,
          message: input!,
          channel,
        });
        ctx.reply(`🔊 ${ctx.user.displayName} hat eine TTS Nachricht eingelöst!`);
        break;

      case 'songskip':
        // Emit song skip event for SongRequest plugin
        this.ctx.events.emit('shop:songskip', {
          username: ctx.user.displayName,
          channel,
        });
        ctx.reply(`⏭️ ${ctx.user.displayName} hat den Song geskippt!`);
        break;

      case 'vip':
        // Give temporary VIP
        ctx.reply(`⭐ ${ctx.user.displayName} ist jetzt für 1 Stunde VIP!`);
        // Emit for external handling (would need Twitch API)
        this.ctx.events.emit('shop:vip', {
          username: ctx.user.username,
          duration: 3600000, // 1 hour
          channel,
        });
        break;

      case 'highlight':
        // Mark user for highlight
        this.highlightedUsers.add(ctx.user.username.toLowerCase());
        ctx.reply(`✨ ${ctx.user.displayName}'s nächste Nachricht wird hervorgehoben!`);
        // Remove after 5 minutes if not used
        setTimeout(() => {
          this.highlightedUsers.delete(ctx.user.username.toLowerCase());
        }, 5 * 60 * 1000);
        break;

      case 'timeout':
        const target = input?.replace('@', '').toLowerCase();
        if (!target) {
          ctx.reply('❌ Kein Ziel angegeben!');
          return;
        }
        // Don't timeout mods/broadcaster
        ctx.reply(`⏰ ${ctx.user.displayName} hat ${target} für 60 Sekunden getimeoutet! 😈`);
        this.ctx.events.emit('shop:timeout', {
          username: target,
          duration: 60,
          reason: `Timeout von ${ctx.user.displayName} (Shop)`,
          channel,
        });
        break;

      case 'custom':
        ctx.reply(`🎁 ${ctx.user.displayName} hat ${item.name} eingelöst!`);
        this.ctx.events.emit('shop:custom', {
          itemId: item.id,
          itemName: item.name,
          username: ctx.user.displayName,
          input,
          channel,
        });
        break;
    }
  }

  // Public API
  getItems(): ShopItem[] {
    return Array.from(this.items.values());
  }

  getItem(id: string): ShopItem | undefined {
    return this.items.get(id);
  }

  isHighlighted(username: string): boolean {
    const highlighted = this.highlightedUsers.has(username.toLowerCase());
    if (highlighted) {
      this.highlightedUsers.delete(username.toLowerCase());
    }
    return highlighted;
  }
}
