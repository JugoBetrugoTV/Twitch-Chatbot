/**
 * Loyalty/Points Plugin
 *
 * Features:
 * - Points for watching (passive)
 * - Points for chatting (active)
 * - Bonus multipliers for subs/VIPs
 * - Points commands (!points, !give, !gamble)
 * - Leaderboard
 */

import { Plugin } from '../base/Plugin';
import { PluginMeta, Permission, CommandContext } from '../../types/plugins';
import { ChatMessageEvent, ChatUser } from '../../types/events';
import { getDatabase, DatabaseService } from '../../services/Database';

interface LoyaltySettings {
  // Points per interval
  pointsPerInterval: number;
  intervalMinutes: number;

  // Multipliers
  subscriberMultiplier: number;
  vipMultiplier: number;
  moderatorMultiplier: number;

  // Chat activity bonus
  pointsPerMessage: number;
  messagePointsCooldown: number; // seconds

  // Currency name
  currencyName: string;
  currencyNamePlural: string;
}

const DEFAULT_SETTINGS: LoyaltySettings = {
  pointsPerInterval: 10,
  intervalMinutes: 5,
  subscriberMultiplier: 2.0,
  vipMultiplier: 1.5,
  moderatorMultiplier: 1.5,
  pointsPerMessage: 1,
  messagePointsCooldown: 30,
  currencyName: 'Punkt',
  currencyNamePlural: 'Punkte',
};

export class LoyaltyPlugin extends Plugin {
  meta: PluginMeta = {
    name: 'loyalty',
    version: '1.0.0',
    description: 'Points/Loyalty system with chat rewards',
    author: 'StreamCore',
  };

  private db!: DatabaseService;
  private settings: LoyaltySettings = DEFAULT_SETTINGS;
  private pointsInterval?: NodeJS.Timeout;
  private activeUsers: Set<string> = new Set();
  private messagePointsCooldowns: Map<string, number> = new Map();

  protected async init(): Promise<void> {
    this.db = getDatabase();
    this.log.info('Initializing Loyalty system...');

    // Load settings from database
    const savedSettings = this.db.getSetting<Partial<LoyaltySettings>>('loyalty_settings');
    if (savedSettings) {
      this.settings = { ...DEFAULT_SETTINGS, ...savedSettings };
    }

    // Register event handlers
    this.setupEventHandlers();

    // Register commands
    this.registerCommands();

    // Start points distribution interval
    this.startPointsInterval();

    this.log.info('Loyalty system initialized!');
  }

  protected async destroy(): Promise<void> {
    if (this.pointsInterval) {
      clearInterval(this.pointsInterval);
    }
  }

  private setupEventHandlers(): void {
    // Track chat activity and give message points
    this.ctx.emit = ((originalEmit) => {
      return (event: string, data: any) => {
        if (event === 'chat:message') {
          this.handleChatMessage(data);
        }
        return originalEmit(event, data);
      };
    })(this.ctx.emit);
  }

  private handleChatMessage(event: ChatMessageEvent): void {
    const { user } = event;
    const key = `${user.platform}:${user.username}`;

    // Track as active user
    this.activeUsers.add(key);

    // Ensure user exists in database
    this.db.createOrUpdateUser(user.id, user.platform, user.username, user.displayName);

    // Increment message count
    this.db.incrementMessageCount(user.platform, user.username);

    // Give message points (with cooldown)
    const now = Date.now();
    const lastPoints = this.messagePointsCooldowns.get(key) || 0;

    if (now - lastPoints > this.settings.messagePointsCooldown * 1000) {
      const points = this.calculatePoints(user, this.settings.pointsPerMessage);
      this.db.updateUserPoints(user.platform, user.username, points);
      this.messagePointsCooldowns.set(key, now);
    }
  }

  private calculatePoints(user: ChatUser, basePoints: number): number {
    let multiplier = 1.0;

    if (user.isSub) {
      multiplier = Math.max(multiplier, this.settings.subscriberMultiplier);
    }
    if (user.isVip) {
      multiplier = Math.max(multiplier, this.settings.vipMultiplier);
    }
    if (user.isMod) {
      multiplier = Math.max(multiplier, this.settings.moderatorMultiplier);
    }

    return Math.floor(basePoints * multiplier);
  }

  private startPointsInterval(): void {
    this.pointsInterval = setInterval(() => {
      this.distributePoints();
    }, this.settings.intervalMinutes * 60 * 1000);

    this.log.debug(`Points interval started: every ${this.settings.intervalMinutes} minutes`);
  }

  private distributePoints(): void {
    if (this.activeUsers.size === 0) return;

    this.log.debug(`Distributing points to ${this.activeUsers.size} active users`);

    for (const key of this.activeUsers) {
      const [platform, username] = key.split(':');
      const user = this.db.getUser(platform, username);

      if (user) {
        // Simple multiplier based on stored data (would need user status from chat)
        const points = this.settings.pointsPerInterval;
        this.db.updateUserPoints(platform, username, points);
      }
    }

    // Clear active users for next interval
    this.activeUsers.clear();
  }

  private registerCommands(): void {
    const currency = this.settings.currencyNamePlural;

    // !points - Check your points
    this.registerCommand({
      name: 'points',
      aliases: ['punkte', 'balance', 'coins'],
      description: `Check your ${currency}`,
      cooldown: { user: 5, global: 0 },
      handler: async (ctx) => {
        const user = this.db.getUser('twitch', ctx.user.username);
        const points = user?.points || 0;
        ctx.reply(`💰 ${ctx.user.displayName} hat ${points.toLocaleString()} ${currency}!`);
      },
    });

    // !give - Give points to another user
    this.registerCommand({
      name: 'give',
      aliases: ['gift', 'transfer'],
      description: `Give ${currency} to another user`,
      usage: '!give <user> <amount>',
      cooldown: { user: 10, global: 0 },
      handler: async (ctx) => {
        if (ctx.args.length < 2) {
          ctx.reply(`Verwendung: !give <user> <menge>`);
          return;
        }

        const targetName = ctx.args[0].replace('@', '');
        const amount = parseInt(ctx.args[1]);

        if (isNaN(amount) || amount <= 0) {
          ctx.reply('❌ Ungültige Menge!');
          return;
        }

        const sender = this.db.getUser('twitch', ctx.user.username);
        if (!sender || sender.points < amount) {
          ctx.reply(`❌ Du hast nicht genug ${currency}!`);
          return;
        }

        const target = this.db.getUser('twitch', targetName);
        if (!target) {
          ctx.reply('❌ Benutzer nicht gefunden!');
          return;
        }

        if (targetName.toLowerCase() === ctx.user.username.toLowerCase()) {
          ctx.reply('❌ Du kannst dir nicht selbst Punkte geben!');
          return;
        }

        // Transfer points
        this.db.updateUserPoints('twitch', ctx.user.username, -amount);
        this.db.updateUserPoints('twitch', targetName, amount);

        ctx.reply(
          `💸 ${ctx.user.displayName} hat ${amount.toLocaleString()} ${currency} an ${targetName} gegeben!`
        );
      },
    });

    // !gamble - Gamble your points
    this.registerCommand({
      name: 'gamble',
      aliases: ['bet', 'roulette'],
      description: `Gamble your ${currency}`,
      usage: '!gamble <amount|all>',
      cooldown: { user: 30, global: 0 },
      handler: async (ctx) => {
        if (ctx.args.length === 0) {
          ctx.reply('Verwendung: !gamble <menge|all>');
          return;
        }

        const user = this.db.getUser('twitch', ctx.user.username);
        if (!user || user.points === 0) {
          ctx.reply(`❌ Du hast keine ${currency}!`);
          return;
        }

        let amount: number;
        if (ctx.args[0].toLowerCase() === 'all') {
          amount = user.points;
        } else {
          amount = parseInt(ctx.args[0]);
        }

        if (isNaN(amount) || amount <= 0) {
          ctx.reply('❌ Ungültige Menge!');
          return;
        }

        if (amount > user.points) {
          ctx.reply(`❌ Du hast nur ${user.points.toLocaleString()} ${currency}!`);
          return;
        }

        // 45% chance to win (house edge)
        const won = Math.random() < 0.45;

        if (won) {
          this.db.updateUserPoints('twitch', ctx.user.username, amount);
          const newTotal = user.points + amount;
          ctx.reply(
            `🎰 GEWONNEN! ${ctx.user.displayName} hat ${amount.toLocaleString()} ${currency} gewonnen! ` +
            `Neuer Stand: ${newTotal.toLocaleString()} ${currency} 🎉`
          );
        } else {
          this.db.updateUserPoints('twitch', ctx.user.username, -amount);
          const newTotal = user.points - amount;
          ctx.reply(
            `🎰 Verloren! ${ctx.user.displayName} hat ${amount.toLocaleString()} ${currency} verloren. ` +
            `Neuer Stand: ${newTotal.toLocaleString()} ${currency} 😢`
          );
        }
      },
    });

    // !leaderboard - Show top users
    this.registerCommand({
      name: 'leaderboard',
      aliases: ['top', 'ranking', 'lb'],
      description: `Show top users by ${currency}`,
      cooldown: { user: 30, global: 10 },
      handler: async (ctx) => {
        const topUsers = this.db.getTopUsers(5, 'points');

        if (topUsers.length === 0) {
          ctx.reply('📊 Noch keine Benutzer im Ranking!');
          return;
        }

        const medals = ['🥇', '🥈', '🥉', '4️⃣', '5️⃣'];
        const ranking = topUsers
          .map((u, i) => `${medals[i]} ${u.display_name || u.username}: ${u.points.toLocaleString()}`)
          .join(' | ');

        ctx.reply(`📊 Top 5: ${ranking}`);
      },
    });

    // !addpoints - Mod command to add points
    this.registerCommand({
      name: 'addpoints',
      aliases: ['givepoints'],
      description: 'Add points to a user (mod only)',
      usage: '!addpoints <user> <amount>',
      permission: Permission.MODERATOR,
      cooldown: { user: 0, global: 0 },
      handler: async (ctx) => {
        if (ctx.args.length < 2) {
          ctx.reply('Verwendung: !addpoints <user> <menge>');
          return;
        }

        const targetName = ctx.args[0].replace('@', '');
        const amount = parseInt(ctx.args[1]);

        if (isNaN(amount)) {
          ctx.reply('❌ Ungültige Menge!');
          return;
        }

        const target = this.db.getUser('twitch', targetName);
        if (!target) {
          ctx.reply('❌ Benutzer nicht gefunden!');
          return;
        }

        this.db.updateUserPoints('twitch', targetName, amount);
        const newTotal = target.points + amount;

        ctx.reply(
          `✅ ${amount > 0 ? '+' : ''}${amount.toLocaleString()} ${currency} für ${targetName}. ` +
          `Neuer Stand: ${newTotal.toLocaleString()}`
        );
      },
    });

    // !watchtime - Check watchtime
    this.registerCommand({
      name: 'watchtime',
      aliases: ['wt', 'zeit'],
      description: 'Check your watchtime',
      cooldown: { user: 10, global: 0 },
      handler: async (ctx) => {
        const user = this.db.getUser('twitch', ctx.user.username);
        const minutes = user?.watch_time || 0;
        const hours = Math.floor(minutes / 60);
        const mins = minutes % 60;

        ctx.reply(
          `⏱️ ${ctx.user.displayName} hat ${hours}h ${mins}m zugeschaut!`
        );
      },
    });
  }

  // Public API for other plugins
  getPoints(platform: string, username: string): number {
    const user = this.db.getUser(platform, username);
    return user?.points || 0;
  }

  addPoints(platform: string, username: string, amount: number): void {
    this.db.updateUserPoints(platform, username, amount);
  }

  removePoints(platform: string, username: string, amount: number): boolean {
    const user = this.db.getUser(platform, username);
    if (!user || user.points < amount) {
      return false;
    }
    this.db.updateUserPoints(platform, username, -amount);
    return true;
  }

  getSettings(): LoyaltySettings {
    return { ...this.settings };
  }

  updateSettings(newSettings: Partial<LoyaltySettings>): void {
    this.settings = { ...this.settings, ...newSettings };
    this.db.setSetting('loyalty_settings', this.settings);

    // Restart interval if it changed
    if (newSettings.intervalMinutes && this.pointsInterval) {
      clearInterval(this.pointsInterval);
      this.startPointsInterval();
    }
  }
}
