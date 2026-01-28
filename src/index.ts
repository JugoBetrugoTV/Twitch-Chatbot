/**
 * StreamCore - Entry Point
 *
 * A next-generation Twitch chatbot that's modular, extensible, and fun.
 * Better than Streamlabs, Nightbot, and MixItUp combined.
 */

import 'dotenv/config';
import { StreamCore, StreamCoreConfig } from './core/StreamCore';
import { CoreCommandsPlugin } from './plugins/commands/CoreCommandsPlugin';
import { Logger } from './utils/logger';

const logger = new Logger('Main');

// ASCII Art Banner
const banner = `
╔═══════════════════════════════════════════════════════════════╗
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
║   Next-Gen Twitch Chatbot • Modular • Event-Driven • Fun     ║
║                                                               ║
╚═══════════════════════════════════════════════════════════════╝
`;

async function main() {
  console.log(banner);

  // Validate environment
  const requiredEnv = ['TWITCH_BOT_USERNAME', 'TWITCH_OAUTH_TOKEN', 'TWITCH_CHANNEL'];
  const missing = requiredEnv.filter((key) => !process.env[key]);

  if (missing.length > 0) {
    logger.error('Missing required environment variables:');
    missing.forEach((key) => logger.error(`  - ${key}`));
    logger.info('');
    logger.info('Create a .env file with the following:');
    logger.info('  TWITCH_BOT_USERNAME=your_bot_username');
    logger.info('  TWITCH_OAUTH_TOKEN=oauth:your_token_here');
    logger.info('  TWITCH_CHANNEL=your_channel_name');
    logger.info('');
    logger.info('Get your OAuth token at: https://twitchapps.com/tmi/');
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

  // Load plugins
  logger.info('Loading plugins...');
  await bot.loadPlugin(new CoreCommandsPlugin());

  // Start the bot
  await bot.start();

  // Log loaded commands
  const commands = bot.getCommands();
  logger.info(`Loaded ${commands.length} commands:`);
  commands.forEach((cmd) => {
    logger.info(`  !${cmd.name}${cmd.aliases?.length ? ` (aliases: ${cmd.aliases.join(', ')})` : ''}`);
  });

  logger.info('');
  logger.info('🎮 Bot is ready! Type commands in Twitch chat.');
  logger.info('');
  logger.info('Available commands:');
  logger.info('  !ping     - Check if bot is alive');
  logger.info('  !commands - List all commands');
  logger.info('  !uptime   - Bot uptime');
  logger.info('  !dice     - Roll a dice');
  logger.info('  !8ball    - Magic 8-ball');
  logger.info('  !hug      - Give someone a hug');
  logger.info('  !echo     - Make bot say something (mod only)');
  logger.info('  !shoutout - Shoutout a streamer (mod only)');

  // Graceful shutdown
  const shutdown = async () => {
    logger.info('');
    logger.info('Shutting down...');
    await bot.stop();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

// Run!
main().catch((error) => {
  logger.error('Fatal error:', error);
  process.exit(1);
});
