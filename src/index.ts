import { config, validateConfig } from './config';
import { TwitchBot } from './bot/TwitchBot';
import { ViewerManager } from './features/ViewerManager';
import { SongRequestManager } from './features/SongRequestManager';
import { TTSManager } from './features/TTSManager';
import { WebServer } from './web/server';
import { Database } from './utils/Database';
import { createCommands } from './commands';

async function main() {
  console.log('');
  console.log('╔════════════════════════════════════════╗');
  console.log('║     Twitch Chatbot - Starting...       ║');
  console.log('╚════════════════════════════════════════╝');
  console.log('');

  // Validate configuration
  if (!validateConfig()) {
    console.error('');
    console.error('Please copy .env.example to .env and fill in your credentials.');
    console.error('');
    process.exit(1);
  }

  // Initialize database
  const db = new Database('botdata.json');
  await db.init();

  // Initialize managers
  const viewerManager = new ViewerManager(db);
  const songManager = new SongRequestManager(db);
  const ttsManager = new TTSManager();

  // Initialize bot
  const bot = new TwitchBot();

  // Register commands
  const commands = createCommands(songManager, ttsManager, viewerManager);
  commands.forEach((cmd) => bot.registerCommand(cmd));

  // Setup bot event handlers
  bot.on('message', (message) => {
    viewerManager.incrementMessageCount(message.username);

    // Auto-add TTS for messages (optional - can be configured)
    // if (config.tts.enabled) {
    //   ttsManager.addMessage(message.username, message.message);
    // }
  });

  bot.on('userJoin', ({ username }) => {
    viewerManager.userJoined(username);
  });

  bot.on('userPart', ({ username }) => {
    viewerManager.userLeft(username);
  });

  bot.on('subscription', ({ username }) => {
    const viewer = viewerManager.getOrCreateViewer(username);
    viewerManager.updateViewer(username, { isSubscriber: true });
    viewerManager.addPoints(username, 500); // Bonus points for subscribing
  });

  // Initialize web server
  const webServer = new WebServer(bot, songManager, ttsManager, viewerManager);

  // Start services
  try {
    // Connect bot to Twitch
    await bot.connect();

    // Start viewer list auto-update
    viewerManager.startAutoUpdate(60000); // Every minute

    // Start web server
    webServer.start();

    console.log('');
    console.log('╔════════════════════════════════════════╗');
    console.log('║     Twitch Chatbot - Ready!            ║');
    console.log('╚════════════════════════════════════════╝');
    console.log('');
    console.log(`Channel: ${config.twitch.channel}`);
    console.log(`Dashboard: http://localhost:${config.web.port}`);
    console.log('');
  } catch (error) {
    console.error('Failed to start bot:', error);
    process.exit(1);
  }

  // Graceful shutdown
  const shutdown = async () => {
    console.log('');
    console.log('Shutting down...');

    viewerManager.stopAutoUpdate();
    await db.forceSave();
    await bot.disconnect();
    webServer.stop();

    console.log('Goodbye!');
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
