/**
 * Core Commands Plugin
 *
 * Provides essential built-in commands:
 * - !ping - Check if bot is alive
 * - !commands / !help - List available commands
 * - !uptime - Show bot uptime
 * - !echo - Echo a message (mod only)
 * - !shoutout / !so - Shoutout a user
 */

import { Plugin } from '../base/Plugin';
import { PluginMeta, Permission, CommandContext } from '../../types/plugins';

export class CoreCommandsPlugin extends Plugin {
  meta: PluginMeta = {
    name: 'core-commands',
    version: '1.0.0',
    description: 'Essential bot commands',
    author: 'StreamCore',
  };

  private startTime = Date.now();

  protected async init(): Promise<void> {
    this.log.info('Initializing core commands...');

    // !ping - Simple response check
    this.registerCommand({
      name: 'ping',
      description: 'Check if the bot is responding',
      cooldown: { user: 5, global: 0 },
      handler: async (ctx) => {
        const latency = Date.now() - ctx.data.startTime || 0;
        ctx.reply(`🏓 Pong! Bot is alive!`);
      },
    });

    // !commands / !help
    this.registerCommand({
      name: 'commands',
      aliases: ['help', 'cmds'],
      description: 'List available commands',
      cooldown: { user: 10, global: 0 },
      handler: async (ctx) => {
        ctx.reply(
          `📋 Commands: !ping, !uptime, !dice, !8ball, !shoutout - Use !help <command> for details`
        );
      },
    });

    // !uptime
    this.registerCommand({
      name: 'uptime',
      description: 'Show how long the bot has been running',
      cooldown: { user: 10, global: 0 },
      handler: async (ctx) => {
        const uptime = Date.now() - this.startTime;
        const hours = Math.floor(uptime / 3600000);
        const minutes = Math.floor((uptime % 3600000) / 60000);
        const seconds = Math.floor((uptime % 60000) / 1000);

        ctx.reply(`⏱️ Bot uptime: ${hours}h ${minutes}m ${seconds}s`);
      },
    });

    // !echo (mod only)
    this.registerCommand({
      name: 'echo',
      aliases: ['say'],
      description: 'Make the bot say something',
      usage: '!echo <message>',
      permission: Permission.MODERATOR,
      cooldown: { user: 0, global: 0 },
      handler: async (ctx) => {
        if (ctx.args.length === 0) {
          ctx.reply('Usage: !echo <message>');
          return;
        }
        ctx.reply(ctx.args.join(' '));
      },
    });

    // !shoutout / !so
    this.registerCommand({
      name: 'shoutout',
      aliases: ['so'],
      description: 'Give a shoutout to another streamer',
      usage: '!so <username>',
      permission: Permission.MODERATOR,
      cooldown: { user: 0, global: 5 },
      handler: async (ctx) => {
        if (ctx.args.length === 0) {
          ctx.reply('Usage: !so <username>');
          return;
        }

        const target = ctx.args[0].replace('@', '');
        ctx.reply(
          `📢 Go check out ${target} at https://twitch.tv/${target} - They're awesome! 💜`
        );
      },
    });

    // !dice - Fun command
    this.registerCommand({
      name: 'dice',
      aliases: ['roll', 'd6'],
      description: 'Roll a dice',
      cooldown: { user: 3, global: 0 },
      handler: async (ctx) => {
        const sides = parseInt(ctx.args[0]) || 6;
        const result = Math.floor(Math.random() * Math.min(sides, 100)) + 1;
        ctx.reply(`🎲 ${ctx.user.displayName} rolled a ${result}!`);
      },
    });

    // !8ball - Magic 8-ball
    this.registerCommand({
      name: '8ball',
      aliases: ['ask', 'magic'],
      description: 'Ask the magic 8-ball',
      usage: '!8ball <question>',
      cooldown: { user: 5, global: 0 },
      handler: async (ctx) => {
        if (ctx.args.length === 0) {
          ctx.reply('🎱 Ask me a question! Usage: !8ball <question>');
          return;
        }

        const responses = [
          'It is certain 🎯',
          'Without a doubt 💯',
          'Yes, definitely! ✅',
          'You may rely on it 🤝',
          'Most likely 👍',
          'Outlook good 😊',
          'Signs point to yes ➡️',
          'Reply hazy, try again 🌫️',
          'Ask again later ⏰',
          'Better not tell you now 🤐',
          "Can't predict now 🔮",
          'Concentrate and ask again 🧘',
          "Don't count on it ❌",
          'My reply is no 👎',
          'My sources say no 📰',
          'Outlook not so good 😬',
          'Very doubtful 🤔',
        ];

        const response = responses[Math.floor(Math.random() * responses.length)];
        ctx.reply(`🎱 ${response}`);
      },
    });

    // !hug - Social command
    this.registerCommand({
      name: 'hug',
      description: 'Give someone a hug',
      usage: '!hug <username>',
      cooldown: { user: 5, global: 0 },
      handler: async (ctx) => {
        if (ctx.args.length === 0) {
          ctx.reply(`🤗 ${ctx.user.displayName} needs a hug!`);
          return;
        }

        const target = ctx.args[0].replace('@', '');
        ctx.reply(`🤗 ${ctx.user.displayName} gives ${target} a big hug!`);
      },
    });

    this.log.info('Core commands initialized!');
  }
}
