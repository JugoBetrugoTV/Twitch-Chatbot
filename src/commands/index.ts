import { BotCommand, CommandContext } from '../types';
import { SongRequestManager } from '../features/SongRequestManager';
import { TTSManager } from '../features/TTSManager';
import { ViewerManager } from '../features/ViewerManager';

export function createCommands(
  songManager: SongRequestManager,
  ttsManager: TTSManager,
  viewerManager: ViewerManager
): BotCommand[] {
  const commands: BotCommand[] = [
    // ============ SONG REQUEST COMMANDS ============
    {
      name: 'sr',
      aliases: ['songrequest', 'request'],
      description: 'Request a song to be played',
      usage: '!sr <YouTube URL or search query>',
      cooldown: 10,
      modOnly: false,
      subOnly: false,
      enabled: true,
      execute: async (ctx: CommandContext) => {
        if (ctx.args.length === 0) {
          ctx.reply('Usage: !sr <YouTube URL or search query>');
          return;
        }

        const query = ctx.args.join(' ');
        const result = await songManager.addRequest(query, ctx.user.username);
        ctx.reply(result.message);
      },
    },
    {
      name: 'skip',
      aliases: ['skipsong', 'nextsong'],
      description: 'Skip the current song (Mod only)',
      usage: '!skip',
      cooldown: 0,
      modOnly: true,
      subOnly: false,
      enabled: true,
      execute: async (ctx: CommandContext) => {
        const skipped = await songManager.skip();
        if (skipped) {
          ctx.reply(`Skipped: ${skipped.title}`);
        } else {
          ctx.reply('No song is currently playing.');
        }
      },
    },
    {
      name: 'queue',
      aliases: ['sq', 'songqueue', 'playlist'],
      description: 'Show the current song queue',
      usage: '!queue',
      cooldown: 5,
      modOnly: false,
      subOnly: false,
      enabled: true,
      execute: async (ctx: CommandContext) => {
        const queue = songManager.getQueue();
        const current = songManager.getCurrentSong();

        if (!current && queue.length === 0) {
          ctx.reply('The song queue is empty.');
          return;
        }

        let response = '';
        if (current) {
          response += `Now playing: ${current.title} (requested by ${current.requestedBy}). `;
        }
        response += `Queue: ${queue.length} song(s). `;
        if (queue.length > 0) {
          const next = queue.slice(0, 3).map((s, i) => `${i + 1}. ${s.title}`).join(', ');
          response += `Next: ${next}`;
        }

        ctx.reply(response);
      },
    },
    {
      name: 'currentsong',
      aliases: ['song', 'np', 'nowplaying'],
      description: 'Show the currently playing song',
      usage: '!currentsong',
      cooldown: 5,
      modOnly: false,
      subOnly: false,
      enabled: true,
      execute: async (ctx: CommandContext) => {
        const current = songManager.getCurrentSong();
        if (current) {
          ctx.reply(`Now playing: ${current.title} (requested by ${current.requestedBy})`);
        } else {
          ctx.reply('No song is currently playing.');
        }
      },
    },
    {
      name: 'wrongsong',
      aliases: ['removesong', 'cancelsong'],
      description: 'Remove your last song request from the queue',
      usage: '!wrongsong',
      cooldown: 5,
      modOnly: false,
      subOnly: false,
      enabled: true,
      execute: async (ctx: CommandContext) => {
        const removed = songManager.removeSongByUser(ctx.user.username);
        if (removed) {
          ctx.reply(`Removed "${removed.title}" from the queue.`);
        } else {
          ctx.reply('You have no songs in the queue.');
        }
      },
    },
    {
      name: 'clearqueue',
      aliases: ['clearsr'],
      description: 'Clear the entire song queue (Mod only)',
      usage: '!clearqueue',
      cooldown: 0,
      modOnly: true,
      subOnly: false,
      enabled: true,
      execute: async (ctx: CommandContext) => {
        songManager.clearQueue();
        ctx.reply('Song queue has been cleared.');
      },
    },

    // ============ TTS COMMANDS ============
    {
      name: 'tts',
      aliases: ['say', 'speak'],
      description: 'Send a text-to-speech message',
      usage: '!tts <message>',
      cooldown: 30,
      modOnly: false,
      subOnly: false,
      enabled: true,
      execute: async (ctx: CommandContext) => {
        if (ctx.args.length === 0) {
          ctx.reply('Usage: !tts <message>');
          return;
        }

        const text = ctx.args.join(' ');
        const result = await ttsManager.addMessage(ctx.user.username, text);
        if (!result.success) {
          ctx.reply(result.message);
        }
      },
    },
    {
      name: 'skiptts',
      aliases: ['stoptts'],
      description: 'Skip the current TTS message (Mod only)',
      usage: '!skiptts',
      cooldown: 0,
      modOnly: true,
      subOnly: false,
      enabled: true,
      execute: async (ctx: CommandContext) => {
        ttsManager.skip();
        ctx.reply('TTS message skipped.');
      },
    },
    {
      name: 'cleartts',
      aliases: [],
      description: 'Clear the TTS queue (Mod only)',
      usage: '!cleartts',
      cooldown: 0,
      modOnly: true,
      subOnly: false,
      enabled: true,
      execute: async (ctx: CommandContext) => {
        ttsManager.clearQueue();
        ctx.reply('TTS queue cleared.');
      },
    },
    {
      name: 'ttsoff',
      aliases: ['disabletts'],
      description: 'Disable TTS (Mod only)',
      usage: '!ttsoff',
      cooldown: 0,
      modOnly: true,
      subOnly: false,
      enabled: true,
      execute: async (ctx: CommandContext) => {
        ttsManager.setEnabled(false);
        ctx.reply('TTS has been disabled.');
      },
    },
    {
      name: 'ttson',
      aliases: ['enabletts'],
      description: 'Enable TTS (Mod only)',
      usage: '!ttson',
      cooldown: 0,
      modOnly: true,
      subOnly: false,
      enabled: true,
      execute: async (ctx: CommandContext) => {
        ttsManager.setEnabled(true);
        ctx.reply('TTS has been enabled.');
      },
    },

    // ============ VIEWER COMMANDS ============
    {
      name: 'viewers',
      aliases: ['viewercount', 'watchtime'],
      description: 'Show current viewer count',
      usage: '!viewers',
      cooldown: 10,
      modOnly: false,
      subOnly: false,
      enabled: true,
      execute: async (ctx: CommandContext) => {
        const count = viewerManager.getOnlineViewerCount();
        ctx.reply(`Currently ${count} viewer(s) in chat.`);
      },
    },
    {
      name: 'points',
      aliases: ['balance', 'coins'],
      description: 'Check your points balance',
      usage: '!points [username]',
      cooldown: 5,
      modOnly: false,
      subOnly: false,
      enabled: true,
      execute: async (ctx: CommandContext) => {
        const targetUser = ctx.args[0]?.replace('@', '') || ctx.user.username;
        const viewer = viewerManager.getViewer(targetUser);

        if (viewer) {
          ctx.reply(`${viewer.displayName} has ${viewer.points} points.`);
        } else {
          ctx.reply(`${targetUser} has not been seen yet.`);
        }
      },
    },
    {
      name: 'watchtime',
      aliases: ['wt'],
      description: 'Check your watch time',
      usage: '!watchtime [username]',
      cooldown: 5,
      modOnly: false,
      subOnly: false,
      enabled: true,
      execute: async (ctx: CommandContext) => {
        const targetUser = ctx.args[0]?.replace('@', '') || ctx.user.username;
        const viewer = viewerManager.getViewer(targetUser);

        if (viewer) {
          const hours = Math.floor(viewer.watchTime / 60);
          const minutes = viewer.watchTime % 60;
          ctx.reply(`${viewer.displayName} has watched for ${hours}h ${minutes}m.`);
        } else {
          ctx.reply(`${targetUser} has not been seen yet.`);
        }
      },
    },
    {
      name: 'top',
      aliases: ['leaderboard', 'toppoints'],
      description: 'Show the top viewers by points',
      usage: '!top',
      cooldown: 30,
      modOnly: false,
      subOnly: false,
      enabled: true,
      execute: async (ctx: CommandContext) => {
        const top = viewerManager.getTopViewersByPoints(5);
        if (top.length === 0) {
          ctx.reply('No viewers tracked yet.');
          return;
        }

        const list = top
          .map((v, i) => `${i + 1}. ${v.displayName}: ${v.points}`)
          .join(' | ');
        ctx.reply(`Top viewers: ${list}`);
      },
    },
    {
      name: 'givepoints',
      aliases: ['addpoints'],
      description: 'Give points to a user (Mod only)',
      usage: '!givepoints <username> <amount>',
      cooldown: 0,
      modOnly: true,
      subOnly: false,
      enabled: true,
      execute: async (ctx: CommandContext) => {
        if (ctx.args.length < 2) {
          ctx.reply('Usage: !givepoints <username> <amount>');
          return;
        }

        const targetUser = ctx.args[0].replace('@', '');
        const amount = parseInt(ctx.args[1], 10);

        if (isNaN(amount) || amount <= 0) {
          ctx.reply('Please provide a valid positive number.');
          return;
        }

        viewerManager.addPoints(targetUser, amount);
        ctx.reply(`Gave ${amount} points to ${targetUser}.`);
      },
    },

    // ============ GENERAL COMMANDS ============
    {
      name: 'commands',
      aliases: ['help', 'cmds'],
      description: 'Show available commands',
      usage: '!commands',
      cooldown: 10,
      modOnly: false,
      subOnly: false,
      enabled: true,
      execute: async (ctx: CommandContext) => {
        ctx.reply(
          'Commands: !sr, !queue, !skip, !tts, !points, !watchtime, !top, !viewers - Use !help <command> for details'
        );
      },
    },
    {
      name: 'uptime',
      aliases: [],
      description: 'Show bot uptime',
      usage: '!uptime',
      cooldown: 30,
      modOnly: false,
      subOnly: false,
      enabled: true,
      execute: async (ctx: CommandContext) => {
        const uptimeMs = process.uptime() * 1000;
        const hours = Math.floor(uptimeMs / 3600000);
        const minutes = Math.floor((uptimeMs % 3600000) / 60000);
        ctx.reply(`Bot has been running for ${hours}h ${minutes}m.`);
      },
    },
  ];

  return commands;
}
