/**
 * User Levels Plugin
 *
 * XP-based level system for chat activity
 * Features:
 * - XP for messages
 * - Level progression
 * - Rank titles
 * - Level-up announcements
 */

import { Plugin } from '../base/Plugin';
import { PluginMeta, Permission } from '../../types/plugins';
import { getDatabase, DatabaseService } from '../../services/Database';

interface UserLevel {
  username: string;
  displayName: string;
  xp: number;
  level: number;
  rank: string;
  nextLevelXp: number;
  progress: number;
}

interface LevelConfig {
  level: number;
  xpRequired: number;
  rank: string;
  emoji: string;
  reward: number;
}

interface LevelSettings {
  enabled: boolean;
  xpPerMessage: number;
  xpPerMinute: number;
  xpCooldown: number;
  announceLevel: boolean;
  announcementTemplate: string;
  bonusXpSubs: number;
  bonusXpVips: number;
}

const DEFAULT_SETTINGS: LevelSettings = {
  enabled: true,
  xpPerMessage: 10,
  xpPerMinute: 5,
  xpCooldown: 60000, // 1 minute
  announceLevel: true,
  announcementTemplate: '🎉 {user} hat Level {level} erreicht! Neuer Rang: {rank} {emoji}',
  bonusXpSubs: 50, // +50% XP for subs
  bonusXpVips: 25, // +25% XP for VIPs
};

const LEVEL_CONFIG: LevelConfig[] = [
  { level: 1, xpRequired: 0, rank: 'Neuling', emoji: '🌱', reward: 0 },
  { level: 2, xpRequired: 100, rank: 'Anfänger', emoji: '🌿', reward: 50 },
  { level: 3, xpRequired: 300, rank: 'Bekannt', emoji: '🌳', reward: 100 },
  { level: 4, xpRequired: 600, rank: 'Stammgast', emoji: '⭐', reward: 150 },
  { level: 5, xpRequired: 1000, rank: 'Veteran', emoji: '🌟', reward: 200 },
  { level: 6, xpRequired: 1500, rank: 'Elite', emoji: '💫', reward: 300 },
  { level: 7, xpRequired: 2100, rank: 'Champion', emoji: '🏆', reward: 400 },
  { level: 8, xpRequired: 2800, rank: 'Held', emoji: '🦸', reward: 500 },
  { level: 9, xpRequired: 3600, rank: 'Legende', emoji: '👑', reward: 750 },
  { level: 10, xpRequired: 4500, rank: 'Mythisch', emoji: '🔱', reward: 1000 },
  { level: 15, xpRequired: 8000, rank: 'Unsterblich', emoji: '⚡', reward: 2000 },
  { level: 20, xpRequired: 15000, rank: 'Göttlich', emoji: '🌈', reward: 5000 },
  { level: 25, xpRequired: 25000, rank: 'Transzendent', emoji: '✨', reward: 10000 },
  { level: 30, xpRequired: 40000, rank: 'Allmächtig', emoji: '💎', reward: 20000 },
  { level: 50, xpRequired: 100000, rank: 'Streamer-Gott', emoji: '🌌', reward: 50000 },
];

export class UserLevelsPlugin extends Plugin {
  meta: PluginMeta = {
    name: 'userlevels',
    version: '1.0.0',
    description: 'XP-based level system for chat activity',
    author: 'StreamCore',
  };

  private db!: DatabaseService;
  private settings: LevelSettings = DEFAULT_SETTINGS;
  private xpCooldowns: Map<string, number> = new Map();

  protected async init(): Promise<void> {
    this.db = getDatabase();
    this.log.info('Initializing User Levels...');

    this.initTables();
    this.loadSettings();
    this.setupEventHandlers();
    this.registerCommands();

    this.log.info('User Levels initialized!');
  }

  protected async destroy(): Promise<void> {
    this.xpCooldowns.clear();
  }

  private initTables(): void {
    const db = this.db.raw();
    db.exec(`
      CREATE TABLE IF NOT EXISTS user_levels (
        username TEXT PRIMARY KEY,
        display_name TEXT,
        xp INTEGER DEFAULT 0,
        level INTEGER DEFAULT 1,
        last_xp_time DATETIME
      );

      CREATE INDEX IF NOT EXISTS idx_user_levels_xp ON user_levels(xp DESC);
      CREATE INDEX IF NOT EXISTS idx_user_levels_level ON user_levels(level DESC);
    `);
  }

  private loadSettings(): void {
    const saved = this.db.getSetting<LevelSettings>('userlevels_settings');
    if (saved) {
      this.settings = { ...DEFAULT_SETTINGS, ...saved };
    }
  }

  private saveSettings(): void {
    this.db.setSetting('userlevels_settings', this.settings);
  }

  private getLevelConfig(level: number): LevelConfig {
    // Find the highest config that matches this level
    let config = LEVEL_CONFIG[0];
    for (const c of LEVEL_CONFIG) {
      if (c.level <= level) {
        config = c;
      } else {
        break;
      }
    }
    return config;
  }

  private getNextLevelConfig(level: number): LevelConfig | null {
    for (const c of LEVEL_CONFIG) {
      if (c.level > level) {
        return c;
      }
    }
    return null;
  }

  private calculateLevel(xp: number): number {
    let level = 1;
    for (const config of LEVEL_CONFIG) {
      if (xp >= config.xpRequired) {
        level = config.level;
      } else {
        break;
      }
    }
    return level;
  }

  private getUserLevel(username: string): UserLevel | null {
    const db = this.db.raw();
    const row = db.prepare('SELECT * FROM user_levels WHERE username = ?').get(username) as any;

    if (!row) return null;

    const level = this.calculateLevel(row.xp);
    const config = this.getLevelConfig(level);
    const nextConfig = this.getNextLevelConfig(level);

    const currentLevelXp = config.xpRequired;
    const nextLevelXp = nextConfig?.xpRequired || config.xpRequired;
    const progress = nextConfig
      ? Math.floor(((row.xp - currentLevelXp) / (nextLevelXp - currentLevelXp)) * 100)
      : 100;

    return {
      username: row.username,
      displayName: row.display_name || row.username,
      xp: row.xp,
      level,
      rank: config.rank,
      nextLevelXp,
      progress: Math.min(100, Math.max(0, progress)),
    };
  }

  private async addXp(username: string, displayName: string, amount: number, isSub: boolean, isVip: boolean): Promise<void> {
    if (!this.settings.enabled) return;

    // Check cooldown
    const now = Date.now();
    const lastXp = this.xpCooldowns.get(username) || 0;
    if (now - lastXp < this.settings.xpCooldown) return;

    this.xpCooldowns.set(username, now);

    // Apply bonuses
    let xp = amount;
    if (isSub) {
      xp = Math.floor(xp * (1 + this.settings.bonusXpSubs / 100));
    } else if (isVip) {
      xp = Math.floor(xp * (1 + this.settings.bonusXpVips / 100));
    }

    const db = this.db.raw();

    // Get current level
    const current = db.prepare('SELECT xp, level FROM user_levels WHERE username = ?').get(username) as any;
    const currentLevel = current ? this.calculateLevel(current.xp) : 1;

    // Update XP
    db.prepare(`
      INSERT INTO user_levels (username, display_name, xp, level, last_xp_time)
      VALUES (?, ?, ?, 1, datetime('now'))
      ON CONFLICT(username) DO UPDATE SET
        display_name = excluded.display_name,
        xp = xp + ?,
        last_xp_time = datetime('now')
    `).run(username, displayName, xp, xp);

    // Check for level up
    const updated = db.prepare('SELECT xp FROM user_levels WHERE username = ?').get(username) as any;
    const newLevel = this.calculateLevel(updated.xp);

    if (newLevel > currentLevel) {
      // Update level in DB
      db.prepare('UPDATE user_levels SET level = ? WHERE username = ?').run(newLevel, username);

      // Get level config for rewards
      const config = this.getLevelConfig(newLevel);

      // Give reward
      if (config.reward > 0) {
        this.ctx.events.emit('points:add', { username, amount: config.reward, reason: `Level ${newLevel} erreicht` });
      }

      // Announce
      if (this.settings.announceLevel) {
        const message = this.settings.announcementTemplate
          .replace('{user}', displayName)
          .replace('{level}', newLevel.toString())
          .replace('{rank}', config.rank)
          .replace('{emoji}', config.emoji);

        this.ctx.events.emit('chat:send', message);
      }

      this.ctx.events.emit('level:up', { username, displayName, level: newLevel, rank: config.rank });
      this.log.info(`${username} leveled up to ${newLevel} (${config.rank})`);
    }
  }

  private setupEventHandlers(): void {
    // XP for messages
    this.ctx.events.on('chat:message', (event: any) => {
      this.addXp(
        event.username,
        event.displayName,
        this.settings.xpPerMessage,
        event.isSubscriber,
        event.isVip
      );
    });
  }

  private registerCommands(): void {
    // !level - Show user level
    this.registerCommand({
      name: 'level',
      aliases: ['lvl', 'rank', 'xp'],
      description: 'Show your level and XP',
      cooldown: { user: 10, global: 3 },
      handler: async (ctx) => {
        const targetUser = ctx.args[0]?.replace('@', '').toLowerCase() || ctx.user.username;
        const userLevel = this.getUserLevel(targetUser);

        if (!userLevel) {
          ctx.reply(`📊 ${targetUser} hat noch kein Level`);
          return;
        }

        const config = this.getLevelConfig(userLevel.level);
        const nextConfig = this.getNextLevelConfig(userLevel.level);

        let response = `${config.emoji} ${userLevel.displayName}: Level ${userLevel.level} (${config.rank}) | ${userLevel.xp.toLocaleString('de-DE')} XP`;

        if (nextConfig) {
          response += ` | ${userLevel.progress}% zu Level ${nextConfig.level}`;
        } else {
          response += ' | MAX LEVEL!';
        }

        ctx.reply(response);
      },
    });

    // !toplevel - Show level leaderboard
    this.registerCommand({
      name: 'toplevel',
      aliases: ['topxp', 'levelboard'],
      description: 'Show level leaderboard',
      cooldown: { user: 15, global: 5 },
      handler: async (ctx) => {
        const db = this.db.raw();
        const rows = db.prepare(`
          SELECT username, display_name, xp, level
          FROM user_levels
          ORDER BY xp DESC
          LIMIT 5
        `).all() as any[];

        if (rows.length === 0) {
          ctx.reply('📊 Noch keine Level-Daten vorhanden');
          return;
        }

        const list = rows.map((r, i) => {
          const config = this.getLevelConfig(r.level);
          const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`;
          return `${medal} ${r.display_name || r.username}: Lvl ${r.level} ${config.emoji}`;
        }).join(' | ');

        ctx.reply(`📊 Top Level: ${list}`);
      },
    });

    // !ranks - Show all ranks
    this.registerCommand({
      name: 'ranks',
      aliases: ['levelranks', 'allranks'],
      description: 'Show all available ranks',
      cooldown: { user: 30, global: 10 },
      handler: async (ctx) => {
        const ranks = LEVEL_CONFIG.slice(0, 8).map((c) => `${c.emoji} Lvl ${c.level}: ${c.rank}`).join(' | ');
        ctx.reply(`📊 Ränge: ${ranks} ...und mehr!`);
      },
    });

    // !givexp - Give XP to user (admin)
    this.registerCommand({
      name: 'givexp',
      aliases: ['addxp'],
      description: 'Give XP to user',
      usage: '!givexp <user> <amount>',
      permission: Permission.MODERATOR,
      cooldown: { user: 0, global: 0 },
      handler: async (ctx) => {
        const [targetUser, amountStr] = ctx.args;
        if (!targetUser || !amountStr) {
          ctx.reply('❌ Usage: !givexp <user> <amount>');
          return;
        }

        const amount = parseInt(amountStr);
        if (isNaN(amount) || amount <= 0) {
          ctx.reply('❌ Ungültige XP-Menge');
          return;
        }

        const username = targetUser.toLowerCase().replace('@', '');

        // Temporarily disable cooldown for admin command
        this.xpCooldowns.delete(username);

        await this.addXp(username, targetUser, amount, false, false);
        ctx.reply(`✅ ${amount} XP an ${targetUser} gegeben`);
      },
    });

    // !levelconfig - Configure level system (admin)
    this.registerCommand({
      name: 'levelconfig',
      description: 'Configure level settings',
      usage: '!levelconfig <setting> <value>',
      permission: Permission.BROADCASTER,
      cooldown: { user: 0, global: 0 },
      handler: async (ctx) => {
        const [setting, value] = ctx.args;

        if (!setting) {
          ctx.reply(
            `📊 Level Config: XP/Msg=${this.settings.xpPerMessage} | ` +
            `SubBonus=${this.settings.bonusXpSubs}% | VIPBonus=${this.settings.bonusXpVips}%`
          );
          return;
        }

        switch (setting.toLowerCase()) {
          case 'xpmessage':
            this.settings.xpPerMessage = parseInt(value) || 10;
            ctx.reply(`✅ XP pro Nachricht: ${this.settings.xpPerMessage}`);
            break;
          case 'subbonus':
            this.settings.bonusXpSubs = parseInt(value) || 50;
            ctx.reply(`✅ Sub XP Bonus: ${this.settings.bonusXpSubs}%`);
            break;
          case 'vipbonus':
            this.settings.bonusXpVips = parseInt(value) || 25;
            ctx.reply(`✅ VIP XP Bonus: ${this.settings.bonusXpVips}%`);
            break;
          case 'announce':
            this.settings.announceLevel = value === 'on' || value === 'an';
            ctx.reply(`✅ Level-Ankündigung: ${this.settings.announceLevel ? 'An' : 'Aus'}`);
            break;
          default:
            ctx.reply('❌ Unbekannte Einstellung (xpmessage, subbonus, vipbonus, announce)');
            return;
        }

        this.saveSettings();
      },
    });
  }

  // Public API
  getLevel(username: string): UserLevel | null {
    return this.getUserLevel(username);
  }

  async grantXp(username: string, displayName: string, amount: number): Promise<void> {
    this.xpCooldowns.delete(username);
    await this.addXp(username, displayName, amount, false, false);
  }
}
