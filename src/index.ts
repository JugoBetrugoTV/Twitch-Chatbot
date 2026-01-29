/**
 * StreamCore - Entry Point
 *
 * A next-generation Twitch chatbot that's modular, extensible, and fun.
 * Better than Streamlabs, Nightbot, and MixItUp combined.
 */

import 'dotenv/config';
import { StreamCore, StreamCoreConfig } from './core/StreamCore';
import { Logger } from './utils/logger';

// Core Plugins
import { CoreCommandsPlugin } from './plugins/commands/CoreCommandsPlugin';
import { CustomCommandsPlugin } from './plugins/commands/CustomCommandsPlugin';
import { LoyaltyPlugin } from './plugins/loyalty/LoyaltyPlugin';
import { TimerPlugin } from './plugins/timers/TimerPlugin';
import { ModerationPlugin } from './plugins/moderation/ModerationPlugin';

// Entertainment Plugins
import { SongRequestPlugin } from './plugins/songrequest/SongRequestPlugin';
import { TTSPlugin } from './plugins/tts/TTSPlugin';
import { GamesPlugin } from './plugins/games/GamesPlugin';

// Interaction Plugins
import { GiveawayPlugin } from './plugins/giveaway/GiveawayPlugin';
import { PollsPlugin } from './plugins/polls/PollsPlugin';
import { QuotesPlugin } from './plugins/quotes/QuotesPlugin';
import { QueuePlugin } from './plugins/queue/QueuePlugin';

// Tools Plugins
import { CountersPlugin } from './plugins/counters/CountersPlugin';
import { RanksPlugin } from './plugins/ranks/RanksPlugin';
import { WelcomePlugin } from './plugins/welcome/WelcomePlugin';
import { ShopPlugin } from './plugins/shop/ShopPlugin';
import { StreamControlPlugin } from './plugins/streamcontrol/StreamControlPlugin';

// Advanced Plugins
import { ChatLogsPlugin } from './plugins/chatlogs/ChatLogsPlugin';
import { BettingPlugin } from './plugins/betting/BettingPlugin';
import { SubGoalsPlugin } from './plugins/subgoals/SubGoalsPlugin';
import { LurkPlugin } from './plugins/lurk/LurkPlugin';
import { AutoShoutoutPlugin } from './plugins/autoshoutout/AutoShoutoutPlugin';
import { ScheduledPlugin } from './plugins/scheduled/ScheduledPlugin';
import { SoundAlertsPlugin } from './plugins/sounds/SoundAlertsPlugin';
import { SpotifyPlugin } from './plugins/spotify/SpotifyPlugin';
import { AIChatPlugin } from './plugins/ai/AIChatPlugin';
import { VIPManagementPlugin } from './plugins/vip/VIPManagementPlugin';
import { PredictionsPlugin } from './plugins/predictions/PredictionsPlugin';
import { AlertsPlugin } from './plugins/alerts/AlertsPlugin';
import { DiscordPlugin } from './plugins/discord/DiscordPlugin';
import { DashboardPlugin } from './plugins/dashboard/DashboardPlugin';

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
    // Core
    { instance: new CoreCommandsPlugin(), name: 'Core Commands', category: 'Core' },
    { instance: new CustomCommandsPlugin(), name: 'Custom Commands', category: 'Core' },
    { instance: new LoyaltyPlugin(), name: 'Loyalty/Points', category: 'Core' },
    { instance: new TimerPlugin(), name: 'Timers', category: 'Core' },
    { instance: new ModerationPlugin(), name: 'Moderation', category: 'Core' },
    // Entertainment
    { instance: new SongRequestPlugin(), name: 'Song Request', category: 'Entertainment' },
    { instance: new TTSPlugin(), name: 'Text-to-Speech', category: 'Entertainment' },
    { instance: new GamesPlugin(), name: 'Games', category: 'Entertainment' },
    // Interaction
    { instance: new GiveawayPlugin(), name: 'Giveaways', category: 'Interaction' },
    { instance: new PollsPlugin(), name: 'Polls', category: 'Interaction' },
    { instance: new QuotesPlugin(), name: 'Quotes', category: 'Interaction' },
    { instance: new QueuePlugin(), name: 'Queue', category: 'Interaction' },
    // Tools
    { instance: new CountersPlugin(), name: 'Counters', category: 'Tools' },
    { instance: new RanksPlugin(), name: 'Ranks', category: 'Tools' },
    { instance: new WelcomePlugin(), name: 'Welcome', category: 'Tools' },
    { instance: new ShopPlugin(), name: 'Loyalty Shop', category: 'Tools' },
    { instance: new StreamControlPlugin(), name: 'Stream Control', category: 'Tools' },
    // Advanced
    { instance: new ChatLogsPlugin(), name: 'Chat Logs', category: 'Advanced' },
    { instance: new BettingPlugin(), name: 'Betting', category: 'Advanced' },
    { instance: new SubGoalsPlugin(), name: 'Sub Goals', category: 'Advanced' },
    { instance: new LurkPlugin(), name: 'Lurk System', category: 'Advanced' },
    { instance: new AutoShoutoutPlugin(), name: 'Auto-Shoutout', category: 'Advanced' },
    { instance: new ScheduledPlugin(), name: 'Scheduled', category: 'Advanced' },
    { instance: new SoundAlertsPlugin(), name: 'Sound Alerts', category: 'Advanced' },
    { instance: new SpotifyPlugin(), name: 'Spotify', category: 'Advanced' },
    { instance: new AIChatPlugin(), name: 'AI Chat', category: 'Advanced' },
    { instance: new VIPManagementPlugin(), name: 'VIP Management', category: 'Advanced' },
    { instance: new PredictionsPlugin(), name: 'Predictions', category: 'Advanced' },
    // Integration
    { instance: new AlertsPlugin(), name: 'Alerts (OBS)', category: 'Integration' },
    { instance: new DiscordPlugin(), name: 'Discord', category: 'Integration' },
    { instance: new DashboardPlugin(), name: 'Web Dashboard', category: 'Integration' },
  ];

  let currentCategory = '';
  for (const plugin of plugins) {
    if (plugin.category !== currentCategory) {
      currentCategory = plugin.category;
      console.log(`  \x1b[33m── ${currentCategory} ──\x1b[0m`);
    }
    try {
      await bot.loadPlugin(plugin.instance);
      logger.info(`    ✅ ${plugin.name}`);
    } catch (error) {
      logger.error(`    ❌ ${plugin.name}: ${error}`);
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
  console.log('║                      📋 COMMAND REFERENCE                      ║');
  console.log('╚═══════════════════════════════════════════════════════════════╝\x1b[0m');
  console.log('');
  console.log('  \x1b[36m── Core ──\x1b[0m');
  console.log('  !ping !uptime !commands !dice !8ball !hug !shoutout');
  console.log('');
  console.log('  \x1b[36m── Points & Ranks ──\x1b[0m');
  console.log('  !points !give !gamble !leaderboard !watchtime !rank !ranks');
  console.log('');
  console.log('  \x1b[36m── Song Request ──\x1b[0m');
  console.log('  !sr !queue !currentsong !wrongsong !skip* !volume*');
  console.log('');
  console.log('  \x1b[36m── TTS ──\x1b[0m');
  console.log('  !tts !ttsqueue !ttsskip* !ttslang* !ttstoggle*');
  console.log('');
  console.log('  \x1b[36m── Games ──\x1b[0m');
  console.log('  !duel !accept !heist !slots !roulette !trivia*');
  console.log('');
  console.log('  \x1b[36m── Interaction ──\x1b[0m');
  console.log('  !giveaway* !enter !poll* !vote !quote !join !leave !position');
  console.log('');
  console.log('  \x1b[36m── Tools ──\x1b[0m');
  console.log('  !death !counter !addcmd* !timer* !blacklist* !permit*');
  console.log('');
  console.log('  \x1b[36m── Shop ──\x1b[0m');
  console.log('  !shop !buy !shopitem* !redemptions*');
  console.log('');
  console.log('  \x1b[36m── Stream Control ──\x1b[0m');
  console.log('  !title !game !streaminfo !marker* !clip !tags');
  console.log('');
  console.log('  \x1b[36m── Advanced ──\x1b[0m');
  console.log('  !logs* !bet !goal !lurk !unlurk !so* !sound !ai');
  console.log('  !prediction* !vip* !srs (Spotify) !schedule*');
  console.log('');
  console.log('  \x1b[36m── Integration ──\x1b[0m');
  console.log('  !testalert* !discord* !dashboard*');
  console.log('');
  console.log('  \x1b[2m  * = Mod/Broadcaster only\x1b[0m');
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
