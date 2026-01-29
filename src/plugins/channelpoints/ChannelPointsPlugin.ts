/**
 * Channel Points Plugin
 *
 * Handle Twitch channel point redemptions
 * Features:
 * - Custom reward actions
 * - TTS redemptions
 * - Sound alerts
 * - Highlight messages
 * - VIP rewards
 * - Custom commands on redeem
 */

import { Plugin } from '../base/Plugin';
import { PluginMeta, Permission } from '../../types/plugins';
import { getDatabase, DatabaseService } from '../../services/Database';

interface RewardAction {
  id: string;
  rewardId: string;
  rewardTitle: string;
  actionType: 'tts' | 'sound' | 'highlight' | 'vip' | 'command' | 'message' | 'timeout';
  actionData: Record<string, any>;
  enabled: boolean;
  createdAt: Date;
}

interface Redemption {
  id: string;
  oderId: string;
  userName: string;
  rewardId: string;
  rewardTitle: string;
  userInput: string;
  cost: number;
  status: 'unfulfilled' | 'fulfilled' | 'canceled';
  redeemedAt: Date;
}

interface ChannelPointsSettings {
  enabled: boolean;
  logRedemptions: boolean;
  announceRedemptions: boolean;
  announcementTemplate: string;
}

const DEFAULT_SETTINGS: ChannelPointsSettings = {
  enabled: true,
  logRedemptions: true,
  announceRedemptions: false,
  announcementTemplate: '🎁 {user} hat "{reward}" eingelöst!',
};

export class ChannelPointsPlugin extends Plugin {
  meta: PluginMeta = {
    name: 'channelpoints',
    version: '1.0.0',
    description: 'Channel point redemption handling',
    author: 'StreamCore',
  };

  private db!: DatabaseService;
  private settings: ChannelPointsSettings = DEFAULT_SETTINGS;
  private rewardActions: Map<string, RewardAction> = new Map();
  private recentRedemptions: Redemption[] = [];

  protected async init(): Promise<void> {
    this.db = getDatabase();
    this.log.info('Initializing Channel Points...');

    this.initTables();
    this.loadSettings();
    this.loadRewardActions();
    this.setupEventHandlers();
    this.registerCommands();

    this.log.info('Channel Points initialized!');
  }

  protected async destroy(): Promise<void> {}

  private initTables(): void {
    const db = this.db.raw();
    db.exec(`
      CREATE TABLE IF NOT EXISTS reward_actions (
        id TEXT PRIMARY KEY,
        reward_id TEXT NOT NULL,
        reward_title TEXT NOT NULL,
        action_type TEXT NOT NULL,
        action_data TEXT NOT NULL,
        enabled INTEGER DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS redemptions_log (
        id TEXT PRIMARY KEY,
        user_name TEXT NOT NULL,
        reward_id TEXT NOT NULL,
        reward_title TEXT NOT NULL,
        user_input TEXT,
        cost INTEGER NOT NULL,
        status TEXT DEFAULT 'unfulfilled',
        redeemed_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_redemptions_user ON redemptions_log(user_name);
      CREATE INDEX IF NOT EXISTS idx_redemptions_reward ON redemptions_log(reward_id);
    `);
  }

  private loadSettings(): void {
    const saved = this.db.getSetting<ChannelPointsSettings>('channelpoints_settings');
    if (saved) {
      this.settings = { ...DEFAULT_SETTINGS, ...saved };
    }
  }

  private saveSettings(): void {
    this.db.setSetting('channelpoints_settings', this.settings);
  }

  private loadRewardActions(): void {
    const db = this.db.raw();
    const rows = db.prepare('SELECT * FROM reward_actions WHERE enabled = 1').all() as any[];

    for (const row of rows) {
      this.rewardActions.set(row.reward_id, {
        id: row.id,
        rewardId: row.reward_id,
        rewardTitle: row.reward_title,
        actionType: row.action_type,
        actionData: JSON.parse(row.action_data),
        enabled: !!row.enabled,
        createdAt: new Date(row.created_at),
      });
    }

    this.log.info(`Loaded ${this.rewardActions.size} reward actions`);
  }

  private setupEventHandlers(): void {
    // Listen for channel point redemptions from EventSub
    this.ctx.events.on('twitch:redemption', (event: any) => {
      this.handleRedemption(event);
    });
  }

  private async handleRedemption(event: any): Promise<void> {
    if (!this.settings.enabled) return;

    const redemption: Redemption = {
      id: event.id,
      oderId: event.id,
      userName: event.userName,
      rewardId: event.rewardId,
      rewardTitle: event.rewardTitle,
      userInput: event.userInput || '',
      cost: event.rewardCost,
      status: 'unfulfilled',
      redeemedAt: new Date(),
    };

    // Log redemption
    if (this.settings.logRedemptions) {
      this.logRedemption(redemption);
    }

    // Add to recent redemptions
    this.recentRedemptions.unshift(redemption);
    if (this.recentRedemptions.length > 100) {
      this.recentRedemptions.pop();
    }

    // Announce if enabled
    if (this.settings.announceRedemptions) {
      const message = this.settings.announcementTemplate
        .replace('{user}', event.userName)
        .replace('{reward}', event.rewardTitle)
        .replace('{cost}', event.rewardCost.toString())
        .replace('{input}', event.userInput || '');
      this.ctx.chat.send(message);
    }

    // Execute action if configured
    const action = this.rewardActions.get(event.rewardId);
    if (action && action.enabled) {
      await this.executeAction(action, event);
    }

    // Emit event for other plugins
    this.ctx.events.emit('channelpoints:redemption', {
      ...redemption,
      action: action?.actionType,
    });
  }

  private logRedemption(redemption: Redemption): void {
    const db = this.db.raw();
    const stmt = db.prepare(`
      INSERT INTO redemptions_log (id, user_name, reward_id, reward_title, user_input, cost, status)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      redemption.id,
      redemption.userName,
      redemption.rewardId,
      redemption.rewardTitle,
      redemption.userInput,
      redemption.cost,
      redemption.status
    );
  }

  private async executeAction(action: RewardAction, event: any): Promise<void> {
    this.log.info(`Executing action: ${action.actionType} for ${event.rewardTitle}`);

    switch (action.actionType) {
      case 'tts':
        // Trigger TTS with user input
        this.ctx.events.emit('tts:speak', {
          text: event.userInput || action.actionData.defaultText || event.rewardTitle,
          user: event.userName,
          priority: action.actionData.priority || 1,
        });
        break;

      case 'sound':
        // Play sound alert
        this.ctx.events.emit('sound:play', {
          sound: action.actionData.soundFile,
          volume: action.actionData.volume || 100,
        });
        break;

      case 'highlight':
        // Highlight message in chat
        this.ctx.events.emit('chat:highlight', {
          user: event.userName,
          message: event.userInput,
          duration: action.actionData.duration || 30,
        });
        break;

      case 'vip':
        // Grant temporary or permanent VIP
        this.ctx.events.emit('moderation:vip', {
          username: event.userName,
          duration: action.actionData.duration, // undefined = permanent
        });
        break;

      case 'command':
        // Execute a command
        this.ctx.events.emit('command:execute', {
          command: action.actionData.command,
          args: (action.actionData.args || '').replace('{user}', event.userName).replace('{input}', event.userInput || ''),
          user: event.userName,
        });
        break;

      case 'message':
        // Send a chat message
        const message = action.actionData.message
          .replace('{user}', event.userName)
          .replace('{input}', event.userInput || '');
        this.ctx.chat.send(message);
        break;

      case 'timeout':
        // Fun timeout (short duration)
        this.ctx.events.emit('moderation:timeout', {
          username: action.actionData.target === 'self' ? event.userName : action.actionData.target,
          duration: action.actionData.duration || 60,
          reason: `Channel Point Redemption: ${event.rewardTitle}`,
        });
        break;

      default:
        this.log.warn(`Unknown action type: ${action.actionType}`);
    }
  }

  private registerCommands(): void {
    // !reward - Manage reward actions
    this.registerCommand({
      name: 'reward',
      aliases: ['rewardaction'],
      description: 'Manage channel point reward actions',
      usage: '!reward <add|remove|list|test> [args]',
      permission: Permission.BROADCASTER,
      cooldown: { user: 5, global: 0 },
      handler: async (ctx) => {
        const action = ctx.args[0]?.toLowerCase();

        if (!action || action === 'list') {
          if (this.rewardActions.size === 0) {
            ctx.reply('🎁 Keine Reward-Actions konfiguriert');
            return;
          }

          const list = Array.from(this.rewardActions.values())
            .map((r) => `${r.rewardTitle}: ${r.actionType}`)
            .slice(0, 5)
            .join(' | ');
          ctx.reply(`🎁 Reward-Actions: ${list}`);
          return;
        }

        if (action === 'add') {
          // !reward add <rewardId> <rewardTitle> <actionType> <actionData>
          if (ctx.args.length < 4) {
            ctx.reply('Verwendung: !reward add <rewardId> <titel> <tts|sound|highlight|vip|command|message>');
            return;
          }

          const rewardId = ctx.args[1];
          const rewardTitle = ctx.args[2];
          const actionType = ctx.args[3] as RewardAction['actionType'];
          const actionData = ctx.args.slice(4).join(' ');

          const id = `action_${Date.now()}`;
          const newAction: RewardAction = {
            id,
            rewardId,
            rewardTitle,
            actionType,
            actionData: actionData ? JSON.parse(actionData) : {},
            enabled: true,
            createdAt: new Date(),
          };

          // Save to database
          const db = this.db.raw();
          const stmt = db.prepare(`
            INSERT INTO reward_actions (id, reward_id, reward_title, action_type, action_data)
            VALUES (?, ?, ?, ?, ?)
          `);
          stmt.run(id, rewardId, rewardTitle, actionType, JSON.stringify(newAction.actionData));

          this.rewardActions.set(rewardId, newAction);
          ctx.reply(`✅ Reward-Action hinzugefügt: ${rewardTitle} -> ${actionType}`);
        } else if (action === 'remove') {
          const rewardId = ctx.args[1];
          if (!rewardId) {
            ctx.reply('Verwendung: !reward remove <rewardId>');
            return;
          }

          const existing = this.rewardActions.get(rewardId);
          if (!existing) {
            ctx.reply('❌ Reward-Action nicht gefunden');
            return;
          }

          const db = this.db.raw();
          db.prepare('DELETE FROM reward_actions WHERE reward_id = ?').run(rewardId);
          this.rewardActions.delete(rewardId);
          ctx.reply(`✅ Reward-Action entfernt: ${existing.rewardTitle}`);
        } else if (action === 'test') {
          const rewardId = ctx.args[1];
          const testAction = this.rewardActions.get(rewardId);
          if (!testAction) {
            ctx.reply('❌ Reward-Action nicht gefunden');
            return;
          }

          await this.executeAction(testAction, {
            userName: ctx.user.username,
            userInput: ctx.args.slice(2).join(' ') || 'Test input',
            rewardTitle: testAction.rewardTitle,
          });
          ctx.reply(`✅ Test ausgeführt: ${testAction.actionType}`);
        }
      },
    });

    // !redemptions - View recent redemptions
    this.registerCommand({
      name: 'redemptions',
      aliases: ['redeems'],
      description: 'View recent channel point redemptions',
      permission: Permission.MODERATOR,
      cooldown: { user: 10, global: 5 },
      handler: async (ctx) => {
        if (this.recentRedemptions.length === 0) {
          ctx.reply('🎁 Keine kürzlichen Redemptions');
          return;
        }

        const recent = this.recentRedemptions
          .slice(0, 5)
          .map((r) => `${r.userName}: ${r.rewardTitle}`)
          .join(' | ');
        ctx.reply(`🎁 Letzte Redemptions: ${recent}`);
      },
    });

    // !rewardstats - View reward statistics
    this.registerCommand({
      name: 'rewardstats',
      description: 'View channel point statistics',
      permission: Permission.MODERATOR,
      cooldown: { user: 30, global: 10 },
      handler: async (ctx) => {
        const db = this.db.raw();

        // Get total redemptions
        const total = db.prepare('SELECT COUNT(*) as count FROM redemptions_log').get() as any;

        // Get top rewards
        const topRewards = db.prepare(`
          SELECT reward_title, COUNT(*) as count, SUM(cost) as total_cost
          FROM redemptions_log
          GROUP BY reward_id
          ORDER BY count DESC
          LIMIT 3
        `).all() as any[];

        // Get top redeemers
        const topUsers = db.prepare(`
          SELECT user_name, COUNT(*) as count, SUM(cost) as total_spent
          FROM redemptions_log
          GROUP BY user_name
          ORDER BY total_spent DESC
          LIMIT 3
        `).all() as any[];

        let message = `🎁 Stats: ${total.count} Redemptions | `;
        message += `Top Rewards: ${topRewards.map((r) => `${r.reward_title}(${r.count})`).join(', ')} | `;
        message += `Top Users: ${topUsers.map((u) => `${u.user_name}(${u.total_spent})`).join(', ')}`;

        ctx.reply(message);
      },
    });
  }

  // Public API
  getRewardActions(): RewardAction[] {
    return Array.from(this.rewardActions.values());
  }

  getRecentRedemptions(): Redemption[] {
    return [...this.recentRedemptions];
  }

  addRewardAction(rewardId: string, rewardTitle: string, actionType: RewardAction['actionType'], actionData: Record<string, any>): void {
    const id = `action_${Date.now()}`;
    const action: RewardAction = {
      id,
      rewardId,
      rewardTitle,
      actionType,
      actionData,
      enabled: true,
      createdAt: new Date(),
    };

    const db = this.db.raw();
    const stmt = db.prepare(`
      INSERT INTO reward_actions (id, reward_id, reward_title, action_type, action_data)
      VALUES (?, ?, ?, ?, ?)
    `);
    stmt.run(id, rewardId, rewardTitle, actionType, JSON.stringify(actionData));

    this.rewardActions.set(rewardId, action);
  }
}
