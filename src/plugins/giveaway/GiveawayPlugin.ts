/**
 * Giveaway/Raffle Plugin
 *
 * Features:
 * - Keyword entry giveaways
 * - Points cost entry
 * - Sub/follower requirements
 * - Random winner selection
 * - Multi-winner support
 */

import { Plugin } from '../base/Plugin';
import { PluginMeta, Permission } from '../../types/plugins';
import { ChatMessageEvent } from '../../types/events';
import { getDatabase, DatabaseService } from '../../services/Database';

interface ActiveGiveaway {
  prize: string;
  keyword: string;
  entries: Set<string>;
  pointsCost: number;
  subOnly: boolean;
  maxEntries: number;
  createdAt: Date;
}

export class GiveawayPlugin extends Plugin {
  meta: PluginMeta = {
    name: 'giveaway',
    version: '1.0.0',
    description: 'Giveaway and raffle system',
    author: 'StreamCore',
  };

  private db!: DatabaseService;
  private activeGiveaway: ActiveGiveaway | null = null;

  protected async init(): Promise<void> {
    this.db = getDatabase();
    this.log.info('Initializing Giveaway system...');
    this.registerCommands();
    this.log.info('Giveaway system initialized!');
  }

  private registerCommands(): void {
    // !giveaway start - Start a giveaway
    this.registerCommand({
      name: 'giveaway',
      aliases: ['raffle', 'gw'],
      description: 'Manage giveaways',
      usage: '!giveaway start <prize> / !giveaway draw / !giveaway end',
      permission: Permission.MODERATOR,
      cooldown: { user: 0, global: 0 },
      handler: async (ctx) => {
        if (ctx.args.length === 0) {
          ctx.reply('Verwendung: !giveaway start/draw/end/info');
          return;
        }

        const action = ctx.args[0].toLowerCase();

        switch (action) {
          case 'start':
            await this.startGiveaway(ctx);
            break;
          case 'draw':
          case 'pick':
            await this.drawWinner(ctx);
            break;
          case 'end':
          case 'stop':
          case 'cancel':
            await this.endGiveaway(ctx);
            break;
          case 'info':
          case 'status':
            await this.showInfo(ctx);
            break;
          default:
            ctx.reply('❌ Unbekannte Aktion. Verwende: start, draw, end, info');
        }
      },
    });

    // !enter - Enter the giveaway
    this.registerCommand({
      name: 'enter',
      aliases: ['join', 'teilnehmen'],
      description: 'Enter the active giveaway',
      cooldown: { user: 5, global: 0 },
      handler: async (ctx) => {
        if (!this.activeGiveaway) {
          ctx.reply('❌ Es gibt gerade kein aktives Giveaway!');
          return;
        }

        const username = ctx.user.username.toLowerCase();

        // Check if already entered
        if (this.activeGiveaway.entries.has(username)) {
          ctx.reply('❌ Du bist bereits eingetragen!');
          return;
        }

        // Check sub requirement
        if (this.activeGiveaway.subOnly && !ctx.user.isSub && !ctx.user.isMod) {
          ctx.reply('❌ Dieses Giveaway ist nur für Subs!');
          return;
        }

        // Check max entries
        if (this.activeGiveaway.maxEntries > 0 &&
            this.activeGiveaway.entries.size >= this.activeGiveaway.maxEntries) {
          ctx.reply('❌ Maximale Teilnehmerzahl erreicht!');
          return;
        }

        // Check points cost
        if (this.activeGiveaway.pointsCost > 0) {
          const user = this.db.getUser('twitch', ctx.user.username);
          if (!user || user.points < this.activeGiveaway.pointsCost) {
            ctx.reply(`❌ Du brauchst ${this.activeGiveaway.pointsCost} Punkte zur Teilnahme!`);
            return;
          }
          this.db.updateUserPoints('twitch', ctx.user.username, -this.activeGiveaway.pointsCost);
        }

        this.activeGiveaway.entries.add(username);
        ctx.reply(
          `✅ ${ctx.user.displayName} nimmt teil! ` +
          `(${this.activeGiveaway.entries.size} Teilnehmer)`
        );
      },
    });

    // Dynamic keyword entry (handled via chat message hook)
  }

  private async startGiveaway(ctx: any): Promise<void> {
    if (this.activeGiveaway) {
      ctx.reply('❌ Es läuft bereits ein Giveaway! Beende es zuerst mit !giveaway end');
      return;
    }

    if (ctx.args.length < 2) {
      ctx.reply('Verwendung: !giveaway start <preis> [keyword=enter] [cost=0] [subonly=false] [max=0]');
      return;
    }

    // Parse arguments
    const prizeWords: string[] = [];
    let keyword = 'enter';
    let pointsCost = 0;
    let subOnly = false;
    let maxEntries = 0;

    for (let i = 1; i < ctx.args.length; i++) {
      const arg = ctx.args[i];
      if (arg.startsWith('keyword=')) {
        keyword = arg.split('=')[1].toLowerCase();
      } else if (arg.startsWith('cost=')) {
        pointsCost = parseInt(arg.split('=')[1]) || 0;
      } else if (arg.startsWith('subonly=')) {
        subOnly = arg.split('=')[1].toLowerCase() === 'true';
      } else if (arg.startsWith('max=')) {
        maxEntries = parseInt(arg.split('=')[1]) || 0;
      } else {
        prizeWords.push(arg);
      }
    }

    const prize = prizeWords.join(' ') || 'Geheimpreis';

    this.activeGiveaway = {
      prize,
      keyword,
      entries: new Set(),
      pointsCost,
      subOnly,
      maxEntries,
      createdAt: new Date(),
    };

    let announcement = `🎉 GIVEAWAY GESTARTET! 🎉\n`;
    announcement += `📦 Preis: ${prize}\n`;
    announcement += `📝 Schreibe !${keyword} um teilzunehmen!`;

    if (pointsCost > 0) {
      announcement += ` (Kostet ${pointsCost} Punkte)`;
    }
    if (subOnly) {
      announcement += ' (Nur für Subs!)';
    }

    ctx.reply(announcement);
  }

  private async drawWinner(ctx: any): Promise<void> {
    if (!this.activeGiveaway) {
      ctx.reply('❌ Kein aktives Giveaway!');
      return;
    }

    if (this.activeGiveaway.entries.size === 0) {
      ctx.reply('❌ Keine Teilnehmer im Giveaway!');
      return;
    }

    const entries = Array.from(this.activeGiveaway.entries);
    const winnerIndex = Math.floor(Math.random() * entries.length);
    const winner = entries[winnerIndex];

    // Remove winner from entries (for multi-draw)
    this.activeGiveaway.entries.delete(winner);

    ctx.reply(
      `🎉🎉🎉 GEWINNER: @${winner}! 🎉🎉🎉\n` +
      `Preis: ${this.activeGiveaway.prize}\n` +
      `Herzlichen Glückwunsch!`
    );

    // Log the win
    this.db.logEvent('giveaway_win', {
      winner,
      prize: this.activeGiveaway.prize,
      totalEntries: entries.length,
    });
  }

  private async endGiveaway(ctx: any): Promise<void> {
    if (!this.activeGiveaway) {
      ctx.reply('❌ Kein aktives Giveaway!');
      return;
    }

    const totalEntries = this.activeGiveaway.entries.size;
    this.activeGiveaway = null;

    ctx.reply(`🎉 Giveaway beendet! (${totalEntries} Teilnehmer)`);
  }

  private async showInfo(ctx: any): Promise<void> {
    if (!this.activeGiveaway) {
      ctx.reply('📋 Kein aktives Giveaway.');
      return;
    }

    ctx.reply(
      `🎉 GIVEAWAY: ${this.activeGiveaway.prize} | ` +
      `Teilnehmer: ${this.activeGiveaway.entries.size} | ` +
      `Keyword: !${this.activeGiveaway.keyword} | ` +
      `${this.activeGiveaway.subOnly ? '(Nur Subs)' : '(Alle)'}`
    );
  }

  // Public API
  isActive(): boolean {
    return this.activeGiveaway !== null;
  }

  getEntryCount(): number {
    return this.activeGiveaway?.entries.size || 0;
  }

  getStatus(): { active: boolean; prize: string; entries: string[]; winner: string | null } {
    if (!this.activeGiveaway) {
      return { active: false, prize: '', entries: [], winner: null };
    }
    return {
      active: true,
      prize: this.activeGiveaway.prize,
      entries: Array.from(this.activeGiveaway.entries),
      winner: null
    };
  }

  getEntries(): string[] {
    return this.activeGiveaway ? Array.from(this.activeGiveaway.entries) : [];
  }

  startFromUI(prize: string, duration?: number): { success: boolean } {
    if (this.activeGiveaway) {
      return { success: false };
    }

    this.activeGiveaway = {
      prize: prize || 'Geheimpreis',
      keyword: 'enter',
      entries: new Set(),
      pointsCost: 0,
      subOnly: false,
      maxEntries: 0,
      createdAt: new Date(),
    };

    this.log.info(`Giveaway started from UI: ${prize}`);
    return { success: true };
  }

  endFromUI(): { success: boolean } {
    if (!this.activeGiveaway) {
      return { success: false };
    }
    this.activeGiveaway = null;
    this.log.info('Giveaway ended from UI');
    return { success: true };
  }

  drawFromUI(): { success: boolean; winner: string | null } {
    if (!this.activeGiveaway || this.activeGiveaway.entries.size === 0) {
      return { success: false, winner: null };
    }

    const entries = Array.from(this.activeGiveaway.entries);
    const winnerIndex = Math.floor(Math.random() * entries.length);
    const winner = entries[winnerIndex];

    // Remove winner from entries (for multi-draw)
    this.activeGiveaway.entries.delete(winner);

    // Log the win
    this.db.logEvent('giveaway_win', {
      winner,
      prize: this.activeGiveaway.prize,
      totalEntries: entries.length,
    });

    this.log.info(`Giveaway winner drawn: ${winner}`);
    return { success: true, winner };
  }
}
