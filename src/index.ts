/**
 * StreamCore - Entry Point
 *
 * A next-generation Twitch chatbot that's modular, extensible, and fun.
 * Better than Streamlabs, Nightbot, and MixItUp combined.
 */

import 'dotenv/config';
import { StreamCore, StreamCoreConfig } from './core/StreamCore';
import { Logger } from './utils/logger';

// Plugins
import { CoreCommandsPlugin } from './plugins/commands/CoreCommandsPlugin';
import { CustomCommandsPlugin } from './plugins/commands/CustomCommandsPlugin';
import { LoyaltyPlugin } from './plugins/loyalty/LoyaltyPlugin';
import { TimerPlugin } from './plugins/timers/TimerPlugin';
import { ModerationPlugin } from './plugins/moderation/ModerationPlugin';

const logger = new Logger('Main');

// ASCII Art Banner
const banner = `
\x1b[36m╔═══════════════════════════════════════════════════════════════╗
║                                                               ║
║   ███████╗████████╗██████╗ ███████╗ █████╗ ███╗   ███╗        ║
║   ██╔════╝╚══██╔══╝██╔══██╗██╔════╝██╔══██╗████╗ ████║        ║
║   ███████╗   ██║   ██████╔╝█████╗  ███████║██╔████╔██║        ║
║   ╚════██║   ██║   ██╔══██╗██╔══╝  ██╔══██║██║╚██╔╝██║        ║
║   ███████║   ██║   ██║  ██║███████╗██║  ██║██║ ╚═╝ ██║        ║
║   ╚══════╝   ╚═╝   ╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝╚═╝     ╚═╝        ║
║                      ██████╗ ██████╗ ██████╗ ███████╗         ║
║                     ██╔════╝██╔═══██╗██╔══██╗██╔════╝         ║
║                     ██║     ██║   ██║██████╔╝█████╗           ║
║                     ██║     ██║   ██║██╔══██╗██╔══╝           ║
║                     ╚██████╗╚██████╔╝██║  ██║███████╗         ║
║                      ╚═════╝ ╚═════╝ ╚═╝  ╚═╝╚══════╝         ║
║                                                               ║
║      Next-Gen Twitch Chatbot • Modular • Event-Driven        ║
║                                                               ║
╚═══════════════════════════════════════════════════════════════╝\x1b[0m
`;

async function main() {
  console.log(banner);

  // Validate environment
  const requiredEnv = ['TWITCH_BOT_USERNAME', 'TWITCH_OAUTH_TOKEN', 'TWITCH_CHANNEL'];
  const missing = requiredEnv.filter((key) => !process.env[key]);

  if (missing.length > 0) {
    console.log('\x1b[31m╔═══════════════════════════════════════════════════════════════╗');
    console.log('║                    ⚠️  CONFIGURATION ERROR                     ║');
    console.log('╠═══════════════════════════════════════════════════════════════╣\x1b[0m');
    console.log('');
    logger.error('Missing required environment variables:');
    missing.forEach((key) => logger.error(`  ❌ ${key}`));
    console.log('');
    console.log('\x1b[33m📝 Create a .env file with:\x1b[0m');
    console.log('');
    console.log('   TWITCH_BOT_USERNAME=your_bot_username');
    console.log('   TWITCH_OAUTH_TOKEN=oauth:your_token_here');
    console.log('   TWITCH_CHANNEL=your_channel_name');
    console.log('');
    console.log('\x1b[36m🔑 Get your OAuth token at: https://twitchapps.com/tmi/\x1b[0m');
    console.log('');
    process.exit(1);
  }

  // Create config
  const config: StreamCoreConfig = {
    twitch: {
      enabled: true,
      username: process.env.TWITCH_BOT_USERNAME!,
      oauthToken: process.env.TWITCH_OAUTH_TOKEN!,
      channels: [process.env.TWITCH_CHANNEL!],
      commandPrefix: process.env.COMMAND_PREFIX || '!',
    },
    mood: (process.env.DEFAULT_MOOD as any) || 'competitive',
    debug: process.env.DEBUG === 'true',
  };

  // Create StreamCore instance
  const bot = new StreamCore(config);

  // Load all plugins
  console.log('');
  console.log('\x1b[36m╔═══════════════════════════════════════════════════════════════╗');
  console.log('║                      📦 LOADING PLUGINS                        ║');
  console.log('╚═══════════════════════════════════════════════════════════════╝\x1b[0m');
  console.log('');

  const plugins = [
    { instance: new CoreCommandsPlugin(), name: 'Core Commands' },
    { instance: new CustomCommandsPlugin(), name: 'Custom Commands' },
    { instance: new LoyaltyPlugin(), name: 'Loyalty/Points' },
    { instance: new TimerPlugin(), name: 'Timers' },
    { instance: new ModerationPlugin(), name: 'Moderation' },
  ];

  for (const plugin of plugins) {
    try {
      await bot.loadPlugin(plugin.instance);
      logger.info(`  ✅ ${plugin.name}`);
    } catch (error) {
      logger.error(`  ❌ ${plugin.name}: ${error}`);
    }
  }

  // Start the bot
  console.log('');
  await bot.start();

  // Summary
  const commands = bot.getCommands();
  const loadedPlugins = bot.getPlugins();

  console.log('');
  console.log('\x1b[32m╔═══════════════════════════════════════════════════════════════╗');
  console.log('║                     🚀 BOT IS READY!                           ║');
  console.log('╚═══════════════════════════════════════════════════════════════╝\x1b[0m');
  console.log('');
  console.log(`  📺 Channel:     \x1b[36m${process.env.TWITCH_CHANNEL}\x1b[0m`);
  console.log(`  🤖 Bot:         \x1b[36m${process.env.TWITCH_BOT_USERNAME}\x1b[0m`);
  console.log(`  📦 Plugins:     \x1b[36m${loadedPlugins.length}\x1b[0m`);
  console.log(`  🎮 Commands:    \x1b[36m${commands.length}\x1b[0m`);
  console.log(`  🎭 Mood:        \x1b[36m${bot.getMood()}\x1b[0m`);
  console.log('');
  console.log('\x1b[33m╔═══════════════════════════════════════════════════════════════╗');
  console.log('║                      📋 QUICK REFERENCE                        ║');
  console.log('╚═══════════════════════════════════════════════════════════════╝\x1b[0m');
  console.log('');
  console.log('  \x1b[36m── Core Commands ──\x1b[0m');
  console.log('  !ping, !uptime, !commands, !dice, !8ball, !hug, !shoutout');
  console.log('');
  console.log('  \x1b[36m── Points System ──\x1b[0m');
  console.log('  !points, !give, !gamble, !leaderboard, !watchtime');
  console.log('');
  console.log('  \x1b[36m── Custom Commands (Mod) ──\x1b[0m');
  console.log('  !addcmd, !editcmd, !delcmd, !togglecmd, !listcmds');
  console.log('  !setcooldown, !setperm, !cmdinfo, !variables');
  console.log('');
  console.log('  \x1b[36m── Timers (Mod) ──\x1b[0m');
  console.log('  !timer add/remove/list/enable/disable');
  console.log('');
  console.log('  \x1b[36m── Moderation (Mod) ──\x1b[0m');
  console.log('  !permit, !blacklist, !modstats, !modsettings, !modtoggle');
  console.log('');
  console.log('\x1b[2m  Press Ctrl+C to stop the bot\x1b[0m');
  console.log('');

  // Graceful shutdown
  const shutdown = async () => {
    console.log('');
    logger.info('👋 Shutting down gracefully...');
    await bot.stop();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

// Run!
main().catch((error) => {
  logger.error('💥 Fatal error:', error);
  process.exit(1);
});
