/**
 * Polls Plugin
 *
 * Features:
 * - Create chat polls with multiple options
 * - Vote tracking
 * - Results display
 * - Timer-based auto-close
 */

import { Plugin } from '../base/Plugin';
import { PluginMeta, Permission } from '../../types/plugins';

interface ActivePoll {
  question: string;
  options: string[];
  votes: Map<string, number>; // username -> option index
  createdAt: Date;
  endsAt?: Date;
}

export class PollsPlugin extends Plugin {
  meta: PluginMeta = {
    name: 'polls',
    version: '1.0.0',
    description: 'Chat polls and voting',
    author: 'StreamCore',
  };

  private activePoll: ActivePoll | null = null;
  private pollTimeout?: NodeJS.Timeout;

  protected async init(): Promise<void> {
    this.log.info('Initializing Polls system...');
    this.registerCommands();
    this.log.info('Polls system initialized!');
  }

  protected async destroy(): Promise<void> {
    if (this.pollTimeout) clearTimeout(this.pollTimeout);
  }

  private registerCommands(): void {
    // !poll - Create a poll
    this.registerCommand({
      name: 'poll',
      aliases: ['umfrage', 'vote'],
      description: 'Create or manage a poll',
      usage: '!poll "Frage?" "Option1" "Option2" [time=60]',
      permission: Permission.MODERATOR,
      cooldown: { user: 0, global: 0 },
      handler: async (ctx) => {
        if (ctx.args.length === 0) {
          ctx.reply('Verwendung: !poll "Frage?" "Option1" "Option2" oder !poll end/results');
          return;
        }

        const action = ctx.args[0].toLowerCase();

        if (action === 'end' || action === 'stop') {
          this.endPoll(ctx);
          return;
        }

        if (action === 'results' || action === 'status') {
          this.showResults(ctx);
          return;
        }

        // Parse poll creation
        // Join args and split by quotes
        const fullText = ctx.args.join(' ');
        const matches = fullText.match(/"([^"]+)"/g);

        if (!matches || matches.length < 3) {
          ctx.reply('Verwendung: !poll "Frage?" "Option1" "Option2" [Option3...]');
          return;
        }

        const question = matches[0].replace(/"/g, '');
        const options = matches.slice(1).map(m => m.replace(/"/g, ''));

        // Check for time parameter
        const timeMatch = fullText.match(/time=(\d+)/);
        const duration = timeMatch ? parseInt(timeMatch[1]) : 60;

        if (this.activePoll) {
          ctx.reply('❌ Es läuft bereits eine Umfrage! Beende sie zuerst mit !poll end');
          return;
        }

        if (options.length < 2 || options.length > 10) {
          ctx.reply('❌ Du brauchst 2-10 Optionen!');
          return;
        }

        this.activePoll = {
          question,
          options,
          votes: new Map(),
          createdAt: new Date(),
          endsAt: new Date(Date.now() + duration * 1000),
        };

        // Format options
        const optionsList = options.map((opt, i) => `${i + 1}. ${opt}`).join(' | ');

        ctx.reply(
          `📊 UMFRAGE: ${question}\n` +
          `Optionen: ${optionsList}\n` +
          `Stimme mit !vote <nummer> ab! Endet in ${duration} Sekunden.`
        );

        // Auto-end poll
        this.pollTimeout = setTimeout(() => {
          this.endPoll({ ...ctx, args: [] });
        }, duration * 1000);
      },
    });

    // !vote - Vote in a poll
    this.registerCommand({
      name: 'vote',
      aliases: ['v', 'stimme'],
      description: 'Vote in the active poll',
      usage: '!vote <number>',
      cooldown: { user: 2, global: 0 },
      handler: async (ctx) => {
        if (!this.activePoll) {
          ctx.reply('❌ Keine aktive Umfrage!');
          return;
        }

        if (ctx.args.length === 0) {
          const opts = this.activePoll.options.map((o, i) => `${i + 1}. ${o}`).join(' | ');
          ctx.reply(`📊 ${this.activePoll.question} - ${opts} - Stimme mit !vote <nummer>`);
          return;
        }

        const choice = parseInt(ctx.args[0]);
        if (isNaN(choice) || choice < 1 || choice > this.activePoll.options.length) {
          ctx.reply(`❌ Wähle eine Zahl zwischen 1 und ${this.activePoll.options.length}!`);
          return;
        }

        const username = ctx.user.username.toLowerCase();
        const previousVote = this.activePoll.votes.get(username);

        this.activePoll.votes.set(username, choice - 1);

        if (previousVote !== undefined) {
          ctx.reply(`✅ ${ctx.user.displayName} hat seine Stimme geändert zu: ${this.activePoll.options[choice - 1]}`);
        } else {
          ctx.reply(`✅ ${ctx.user.displayName} stimmt für: ${this.activePoll.options[choice - 1]}`);
        }
      },
    });
  }

  private endPoll(ctx: any): void {
    if (this.pollTimeout) {
      clearTimeout(this.pollTimeout);
      this.pollTimeout = undefined;
    }

    if (!this.activePoll) {
      ctx.reply('❌ Keine aktive Umfrage!');
      return;
    }

    this.showResults(ctx, true);
    this.activePoll = null;
  }

  private showResults(ctx: any, final: boolean = false): void {
    if (!this.activePoll) {
      ctx.reply('❌ Keine aktive Umfrage!');
      return;
    }

    const voteCounts = new Array(this.activePoll.options.length).fill(0);
    for (const optionIndex of this.activePoll.votes.values()) {
      voteCounts[optionIndex]++;
    }

    const totalVotes = this.activePoll.votes.size;
    const results = this.activePoll.options.map((opt, i) => {
      const count = voteCounts[i];
      const percent = totalVotes > 0 ? Math.round((count / totalVotes) * 100) : 0;
      return `${opt}: ${count} (${percent}%)`;
    }).join(' | ');

    // Find winner
    const maxVotes = Math.max(...voteCounts);
    const winnerIndex = voteCounts.indexOf(maxVotes);
    const winner = this.activePoll.options[winnerIndex];

    if (final) {
      ctx.reply(
        `📊 UMFRAGE BEENDET: ${this.activePoll.question}\n` +
        `Ergebnis: ${results}\n` +
        `🏆 Gewinner: ${winner} mit ${maxVotes} Stimmen!`
      );
    } else {
      ctx.reply(
        `📊 Aktueller Stand: ${results} (${totalVotes} Stimmen)`
      );
    }
  }
}
