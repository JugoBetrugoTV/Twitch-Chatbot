/**
 * Achievements Plugin
 *
 * Custom achievements and badges for viewers
 * Features:
 * - Automatic achievement unlocking
 * - Custom achievements
 * - Badge display
 * - Achievement announcements
 */

import { Plugin } from '../base/Plugin';
import { PluginMeta, Permission } from '../../types/plugins';
import { getDatabase, DatabaseService } from '../../services/Database';

interface Achievement {
  id: string;
  name: string;
  description: string;
  emoji: string;
  category: 'chat' | 'loyalty' | 'gambling' | 'social' | 'special';
  requirement: AchievementRequirement;
  reward: number;
  hidden: boolean;
}

interface AchievementRequirement {
  type: 'messages' | 'watchtime' | 'points' | 'follows' | 'gambleWins' | 'gambleLosses' | 'custom';
  value: number;
  customCheck?: string;
}

interface UserAchievement {
  odvisnost: string;
  odvisnoId: string;
  unlockedAt: Date;
}

interface AchievementSettings {
  enabled: boolean;
  announceUnlocks: boolean;
  announcementTemplate: string;
  showHiddenCount: boolean;
}

const DEFAULT_SETTINGS: AchievementSettings = {
  enabled: true,
  announceUnlocks: true,
  announcementTemplate: '🏆 {user} hat "{achievement}" freigeschaltet! {emoji}',
  showHiddenCount: true,
};

const DEFAULT_ACHIEVEMENTS: Achievement[] = [
  // Chat achievements
  { id: 'first_message', name: 'Erste Worte', description: 'Schreibe deine erste Nachricht', emoji: '💬', category: 'chat', requirement: { type: 'messages', value: 1 }, reward: 10, hidden: false },
  { id: 'chatter_100', name: 'Plaudertasche', description: 'Schreibe 100 Nachrichten', emoji: '🗣️', category: 'chat', requirement: { type: 'messages', value: 100 }, reward: 50, hidden: false },
  { id: 'chatter_1000', name: 'Redselig', description: 'Schreibe 1.000 Nachrichten', emoji: '📢', category: 'chat', requirement: { type: 'messages', value: 1000 }, reward: 200, hidden: false },
  { id: 'chatter_10000', name: 'Moderator Material', description: 'Schreibe 10.000 Nachrichten', emoji: '🎙️', category: 'chat', requirement: { type: 'messages', value: 10000 }, reward: 1000, hidden: false },

  // Loyalty achievements
  { id: 'watch_1h', name: 'Reingeschaut', description: '1 Stunde zugeschaut', emoji: '👀', category: 'loyalty', requirement: { type: 'watchtime', value: 60 }, reward: 25, hidden: false },
  { id: 'watch_10h', name: 'Stammgast', description: '10 Stunden zugeschaut', emoji: '🏠', category: 'loyalty', requirement: { type: 'watchtime', value: 600 }, reward: 100, hidden: false },
  { id: 'watch_100h', name: 'Treuer Zuschauer', description: '100 Stunden zugeschaut', emoji: '💎', category: 'loyalty', requirement: { type: 'watchtime', value: 6000 }, reward: 500, hidden: false },
  { id: 'watch_500h', name: 'Legende', description: '500 Stunden zugeschaut', emoji: '👑', category: 'loyalty', requirement: { type: 'watchtime', value: 30000 }, reward: 2500, hidden: false },

  // Points achievements
  { id: 'points_1000', name: 'Sparschwein', description: 'Sammle 1.000 Punkte', emoji: '🐷', category: 'loyalty', requirement: { type: 'points', value: 1000 }, reward: 0, hidden: false },
  { id: 'points_10000', name: 'Wohlhabend', description: 'Sammle 10.000 Punkte', emoji: '💰', category: 'loyalty', requirement: { type: 'points', value: 10000 }, reward: 0, hidden: false },
  { id: 'points_100000', name: 'Millionär', description: 'Sammle 100.000 Punkte', emoji: '🤑', category: 'loyalty', requirement: { type: 'points', value: 100000 }, reward: 0, hidden: false },

  // Gambling achievements
  { id: 'first_gamble', name: 'Anfängerglück', description: 'Gewinne dein erstes Gamble', emoji: '🎲', category: 'gambling', requirement: { type: 'gambleWins', value: 1 }, reward: 25, hidden: false },
  { id: 'gamble_wins_10', name: 'Glückspilz', description: 'Gewinne 10 Gambles', emoji: '🍀', category: 'gambling', requirement: { type: 'gambleWins', value: 10 }, reward: 100, hidden: false },
  { id: 'gamble_wins_100', name: 'High Roller', description: 'Gewinne 100 Gambles', emoji: '🎰', category: 'gambling', requirement: { type: 'gambleWins', value: 100 }, reward: 500, hidden: false },
  { id: 'gamble_loss_big', name: 'Pechvogel', description: 'Verliere 10.000 Punkte beim Gamblen', emoji: '😭', category: 'gambling', requirement: { type: 'gambleLosses', value: 10000 }, reward: 100, hidden: true },

  // Social achievements
  { id: 'follower', name: 'Follower', description: 'Folge dem Kanal', emoji: '❤️', category: 'social', requirement: { type: 'follows', value: 1 }, reward: 50, hidden: false },

  // Special achievements
  { id: 'night_owl', name: 'Nachteule', description: 'Schaue nach Mitternacht', emoji: '🦉', category: 'special', requirement: { type: 'custom', value: 0, customCheck: 'nightOwl' }, reward: 25, hidden: true },
  { id: 'early_bird', name: 'Frühaufsteher', description: 'Schaue vor 6 Uhr morgens', emoji: '🐦', category: 'special', requirement: { type: 'custom', value: 0, customCheck: 'earlyBird' }, reward: 25, hidden: true },
];

export class AchievementsPlugin extends Plugin {
  meta: PluginMeta = {
    name: 'achievements',
    version: '1.0.0',
    description: 'Custom achievements and badges for viewers',
    author: 'StreamCore',
  };

  private db!: DatabaseService;
  private settings: AchievementSettings = DEFAULT_SETTINGS;
  private achievements: Map<string, Achievement> = new Map();
  private userAchievements: Map<string, Set<string>> = new Map();

  protected async init(): Promise<void> {
    this.db = getDatabase();
    this.log.info('Initializing Achievements...');

    this.initTables();
    this.loadSettings();
    this.loadAchievements();
    this.setupEventHandlers();
    this.registerCommands();

    this.log.info('Achievements initialized!');
  }

  protected async destroy(): Promise<void> {}

  private initTables(): void {
    const db = this.db.raw();
    db.exec(`
      CREATE TABLE IF NOT EXISTS achievements (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        emoji TEXT,
        category TEXT,
        requirement_type TEXT,
        requirement_value INTEGER,
        reward INTEGER DEFAULT 0,
        hidden INTEGER DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS user_achievements (
        username TEXT NOT NULL,
        achievement_id TEXT NOT NULL,
        unlocked_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (username, achievement_id)
      );

      CREATE INDEX IF NOT EXISTS idx_user_achievements_user ON user_achievements(username);
    `);
  }

  private loadSettings(): void {
    const saved = this.db.getSetting<AchievementSettings>('achievements_settings');
    if (saved) {
      this.settings = { ...DEFAULT_SETTINGS, ...saved };
    }
  }

  private loadAchievements(): void {
    // Load default achievements
    for (const achievement of DEFAULT_ACHIEVEMENTS) {
      this.achievements.set(achievement.id, achievement);
    }

    // Load custom achievements from DB
    const db = this.db.raw();
    const rows = db.prepare('SELECT * FROM achievements').all() as any[];
    for (const row of rows) {
      if (!this.achievements.has(row.id)) {
        this.achievements.set(row.id, {
          id: row.id,
          name: row.name,
          description: row.description,
          emoji: row.emoji || '🏆',
          category: row.category || 'special',
          requirement: {
            type: row.requirement_type,
            value: row.requirement_value,
          },
          reward: row.reward || 0,
          hidden: row.hidden === 1,
        });
      }
    }
  }

  private getUserAchievements(username: string): Set<string> {
    if (!this.userAchievements.has(username)) {
      const db = this.db.raw();
      const rows = db.prepare('SELECT achievement_id FROM user_achievements WHERE username = ?').all(username) as any[];
      this.userAchievements.set(username, new Set(rows.map((r) => r.achievement_id)));
    }
    return this.userAchievements.get(username)!;
  }

  private async unlockAchievement(username: string, displayName: string, achievementId: string): Promise<boolean> {
    const achievement = this.achievements.get(achievementId);
    if (!achievement) return false;

    const userAchievements = this.getUserAchievements(username);
    if (userAchievements.has(achievementId)) return false;

    // Save to DB
    const db = this.db.raw();
    db.prepare('INSERT OR IGNORE INTO user_achievements (username, achievement_id) VALUES (?, ?)').run(username, achievementId);

    userAchievements.add(achievementId);

    // Give reward
    if (achievement.reward > 0) {
      this.ctx.events.emit('points:add', { username, amount: achievement.reward, reason: `Achievement: ${achievement.name}` });
    }

    // Announce
    if (this.settings.announceUnlocks && this.settings.enabled) {
      const message = this.settings.announcementTemplate
        .replace('{user}', displayName)
        .replace('{achievement}', achievement.name)
        .replace('{emoji}', achievement.emoji)
        .replace('{description}', achievement.description);

      this.ctx.events.emit('chat:send', message);
    }

    this.ctx.events.emit('achievement:unlocked', { username, achievement });
    this.log.info(`${username} unlocked achievement: ${achievement.name}`);

    return true;
  }

  private async checkAchievements(username: string, displayName: string, stats: any): Promise<void> {
    if (!this.settings.enabled) return;

    for (const [id, achievement] of this.achievements) {
      const userAchievements = this.getUserAchievements(username);
      if (userAchievements.has(id)) continue;

      let unlocked = false;

      switch (achievement.requirement.type) {
        case 'messages':
          unlocked = (stats.messageCount || 0) >= achievement.requirement.value;
          break;
        case 'watchtime':
          unlocked = (stats.watchTime || 0) >= achievement.requirement.value;
          break;
        case 'points':
          unlocked = (stats.points || 0) >= achievement.requirement.value;
          break;
        case 'gambleWins':
          unlocked = (stats.gambleWins || 0) >= achievement.requirement.value;
          break;
        case 'gambleLosses':
          unlocked = (stats.gambleLosses || 0) >= achievement.requirement.value;
          break;
        case 'follows':
          unlocked = stats.isFollower === true;
          break;
        case 'custom':
          unlocked = this.checkCustomRequirement(achievement.requirement.customCheck || '', stats);
          break;
      }

      if (unlocked) {
        await this.unlockAchievement(username, displayName, id);
      }
    }
  }

  private checkCustomRequirement(check: string, stats: any): boolean {
    const hour = new Date().getHours();

    switch (check) {
      case 'nightOwl':
        return hour >= 0 && hour < 4;
      case 'earlyBird':
        return hour >= 4 && hour < 6;
      default:
        return false;
    }
  }

  private setupEventHandlers(): void {
    // Check achievements on chat
    this.ctx.events.on('chat:message', (event: any) => {
      this.checkAchievements(event.username, event.displayName, {
        messageCount: event.messageCount,
        points: event.points,
        watchTime: event.watchTime,
        isFollower: event.isFollower,
      });
    });

    // Check on gamble
    this.ctx.events.on('gamble:result', (event: any) => {
      this.checkAchievements(event.username, event.displayName, {
        gambleWins: event.totalWins,
        gambleLosses: event.totalLosses,
      });
    });

    // Check on follow
    this.ctx.events.on('twitch:follow', (event: any) => {
      this.unlockAchievement(event.username, event.displayName, 'follower');
    });
  }

  private registerCommands(): void {
    // !achievements - Show user's achievements
    this.registerCommand({
      name: 'achievements',
      aliases: ['badges', 'erfolge'],
      description: 'Show your achievements',
      cooldown: { user: 15, global: 5 },
      handler: async (ctx) => {
        const targetUser = ctx.args[0]?.replace('@', '') || ctx.user.username;
        const userAchievements = this.getUserAchievements(targetUser.toLowerCase());

        if (userAchievements.size === 0) {
          ctx.reply(`🏆 ${targetUser} hat noch keine Achievements`);
          return;
        }

        const badges = Array.from(userAchievements)
          .map((id) => this.achievements.get(id))
          .filter((a) => a && !a.hidden)
          .map((a) => a!.emoji)
          .slice(0, 10)
          .join(' ');

        const total = this.achievements.size;
        const unlocked = userAchievements.size;
        const hiddenCount = Array.from(userAchievements)
          .filter((id) => this.achievements.get(id)?.hidden)
          .length;

        let response = `🏆 ${targetUser}: ${badges} (${unlocked}/${total})`;
        if (this.settings.showHiddenCount && hiddenCount > 0) {
          response += ` +${hiddenCount} geheim`;
        }

        ctx.reply(response);
      },
    });

    // !achievementlist - Show all achievements
    this.registerCommand({
      name: 'achievementlist',
      aliases: ['allachievements', 'achievementsliste'],
      description: 'Show all available achievements',
      cooldown: { user: 30, global: 10 },
      handler: async (ctx) => {
        const category = ctx.args[0]?.toLowerCase();

        let achievements = Array.from(this.achievements.values()).filter((a) => !a.hidden);

        if (category) {
          achievements = achievements.filter((a) => a.category === category);
        }

        if (achievements.length === 0) {
          ctx.reply('❌ Keine Achievements gefunden');
          return;
        }

        const list = achievements.slice(0, 5).map((a) => `${a.emoji} ${a.name}`).join(' | ');
        ctx.reply(`🏆 Achievements: ${list} (${achievements.length} gesamt)`);
      },
    });

    // !giveachievement - Give achievement to user (admin)
    this.registerCommand({
      name: 'giveachievement',
      description: 'Give achievement to user',
      usage: '!giveachievement <user> <achievement_id>',
      permission: Permission.BROADCASTER,
      cooldown: { user: 0, global: 0 },
      handler: async (ctx) => {
        const [targetUser, achievementId] = ctx.args;
        if (!targetUser || !achievementId) {
          ctx.reply('❌ Usage: !giveachievement <user> <achievement_id>');
          return;
        }

        const achievement = this.achievements.get(achievementId);
        if (!achievement) {
          ctx.reply('❌ Achievement nicht gefunden');
          return;
        }

        const unlocked = await this.unlockAchievement(
          targetUser.toLowerCase().replace('@', ''),
          targetUser,
          achievementId
        );

        if (unlocked) {
          ctx.reply(`✅ ${achievement.emoji} "${achievement.name}" an ${targetUser} vergeben`);
        } else {
          ctx.reply(`❌ ${targetUser} hat dieses Achievement bereits`);
        }
      },
    });
  }

  // Public API
  getAchievements(): Achievement[] {
    return Array.from(this.achievements.values());
  }

  getUserBadges(username: string): string[] {
    const userAchievements = this.getUserAchievements(username);
    return Array.from(userAchievements)
      .map((id) => this.achievements.get(id)?.emoji)
      .filter((e): e is string => !!e);
  }
}
