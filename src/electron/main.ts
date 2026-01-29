/**
 * Electron Main Process
 *
 * Desktop application for StreamCore Twitch Bot
 */

import { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, shell } from 'electron';
import * as path from 'path';
import 'dotenv/config';

// Import StreamCore
import { StreamCore, StreamCoreConfig } from '../core/StreamCore';
import { initDatabase, getDatabase } from '../services/Database';
import { Logger } from '../utils/logger';

// Import ALL plugins
// Core
import { CoreCommandsPlugin } from '../plugins/commands/CoreCommandsPlugin';
import { CustomCommandsPlugin } from '../plugins/commands/CustomCommandsPlugin';
import { LoyaltyPlugin } from '../plugins/loyalty/LoyaltyPlugin';
import { TimerPlugin } from '../plugins/timers/TimerPlugin';
import { ModerationPlugin } from '../plugins/moderation/ModerationPlugin';
// Entertainment
import { SongRequestPlugin } from '../plugins/songrequest/SongRequestPlugin';
import { TTSPlugin } from '../plugins/tts/TTSPlugin';
import { GamesPlugin } from '../plugins/games/GamesPlugin';
// Interaction
import { GiveawayPlugin } from '../plugins/giveaway/GiveawayPlugin';
import { PollsPlugin } from '../plugins/polls/PollsPlugin';
import { QuotesPlugin } from '../plugins/quotes/QuotesPlugin';
import { QueuePlugin } from '../plugins/queue/QueuePlugin';
// Tools
import { CountersPlugin } from '../plugins/counters/CountersPlugin';
import { RanksPlugin } from '../plugins/ranks/RanksPlugin';
import { WelcomePlugin } from '../plugins/welcome/WelcomePlugin';
import { ShopPlugin } from '../plugins/shop/ShopPlugin';
import { StreamControlPlugin } from '../plugins/streamcontrol/StreamControlPlugin';
// Advanced
import { ChatLogsPlugin } from '../plugins/chatlogs/ChatLogsPlugin';
import { BettingPlugin } from '../plugins/betting/BettingPlugin';
import { SubGoalsPlugin } from '../plugins/subgoals/SubGoalsPlugin';
import { LurkPlugin } from '../plugins/lurk/LurkPlugin';
import { AutoShoutoutPlugin } from '../plugins/autoshoutout/AutoShoutoutPlugin';
import { ScheduledPlugin } from '../plugins/scheduled/ScheduledPlugin';
import { SoundAlertsPlugin } from '../plugins/sounds/SoundAlertsPlugin';
import { SpotifyPlugin } from '../plugins/spotify/SpotifyPlugin';
import { AIChatPlugin } from '../plugins/ai/AIChatPlugin';
import { VIPManagementPlugin } from '../plugins/vip/VIPManagementPlugin';
import { PredictionsPlugin } from '../plugins/predictions/PredictionsPlugin';
// Integration
import { AlertsPlugin } from '../plugins/alerts/AlertsPlugin';
import { DiscordPlugin } from '../plugins/discord/DiscordPlugin';
import { DashboardPlugin } from '../plugins/dashboard/DashboardPlugin';
// Twitch Tools
import { TwitchInfoPlugin } from '../plugins/twitchinfo/TwitchInfoPlugin';
import { HypeTrainPlugin } from '../plugins/hypetrain/HypeTrainPlugin';
import { EmoteStatsPlugin } from '../plugins/emotestats/EmoteStatsPlugin';
import { BitsLeaderboardPlugin } from '../plugins/bitsleaderboard/BitsLeaderboardPlugin';
// Moderation+
import { WatchlistPlugin } from '../plugins/watchlist/WatchlistPlugin';
import { RaidProtectionPlugin } from '../plugins/raidprotection/RaidProtectionPlugin';
import { ChatModesPlugin } from '../plugins/chatmodes/ChatModesPlugin';
// Stream Tools
import { OBSControlPlugin } from '../plugins/obscontrol/OBSControlPlugin';
import { StreamNotesPlugin } from '../plugins/streamnotes/StreamNotesPlugin';
import { HydrationPlugin } from '../plugins/hydration/HydrationPlugin';
// Social
import { TwitterPlugin } from '../plugins/twitter/TwitterPlugin';
// Analytics
import { AnalyticsPlugin } from '../plugins/analytics/AnalyticsPlugin';

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let bot: StreamCore | null = null;
const logger = new Logger('Electron');

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 700,
    title: 'StreamCore',
    backgroundColor: '#0f0f0f',
    frame: false, // Custom titlebar
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
    icon: path.join(__dirname, '../../assets/icon.png'),
    show: false,
  });

  mainWindow.loadFile(path.join(__dirname, '../../app/index.html'));

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  mainWindow.on('close', (event) => {
    if (tray) {
      event.preventDefault();
      mainWindow?.hide();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Open dev tools in development
  if (process.env.DEBUG === 'true') {
    mainWindow.webContents.openDevTools();
  }
}

function createTray() {
  const iconPath = path.join(__dirname, '../../assets/icon.png');
  let icon = nativeImage.createFromPath(iconPath);

  if (icon.isEmpty()) {
    // Create a simple default icon if none exists
    icon = nativeImage.createEmpty();
  }

  tray = new Tray(icon);

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'StreamCore öffnen',
      click: () => {
        mainWindow?.show();
      },
    },
    { type: 'separator' },
    {
      label: bot ? 'Bot trennen' : 'Bot verbinden',
      click: async () => {
        if (bot) {
          await bot.stop();
          bot = null;
          mainWindow?.webContents.send('bot:status', { connected: false });
        } else {
          await startBot();
        }
        updateTrayMenu();
      },
    },
    { type: 'separator' },
    {
      label: 'Beenden',
      click: () => {
        tray?.destroy();
        tray = null;
        app.quit();
      },
    },
  ]);

  tray.setToolTip('StreamCore - Twitch Bot');
  tray.setContextMenu(contextMenu);

  tray.on('double-click', () => {
    mainWindow?.show();
  });
}

function updateTrayMenu() {
  if (!tray) return;

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'StreamCore öffnen',
      click: () => {
        mainWindow?.show();
      },
    },
    { type: 'separator' },
    {
      label: bot ? 'Bot trennen' : 'Bot verbinden',
      click: async () => {
        if (bot) {
          await bot.stop();
          bot = null;
          mainWindow?.webContents.send('bot:status', { connected: false });
        } else {
          await startBot();
        }
        updateTrayMenu();
      },
    },
    { type: 'separator' },
    {
      label: 'Beenden',
      click: () => {
        tray?.destroy();
        tray = null;
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(contextMenu);
}

async function startBot() {
  try {
    // Check for required env vars
    const username = process.env.TWITCH_BOT_USERNAME;
    const token = process.env.TWITCH_OAUTH_TOKEN;
    const channel = process.env.TWITCH_CHANNEL;

    if (!username || !token || !channel) {
      mainWindow?.webContents.send('bot:error', {
        message: 'Twitch-Anmeldedaten fehlen. Bitte in den Einstellungen konfigurieren.',
      });
      return;
    }

    // Initialize database
    logger.info('Initializing database...');
    await initDatabase();

    // Create config
    const config: StreamCoreConfig = {
      twitch: {
        enabled: true,
        username,
        oauthToken: token,
        channels: [channel],
        commandPrefix: process.env.COMMAND_PREFIX || '!',
      },
      mood: (process.env.DEFAULT_MOOD as any) || 'competitive',
      debug: process.env.DEBUG === 'true',
    };

    // Create bot
    bot = new StreamCore(config);

    // Load ALL plugins
    const plugins = [
      // Core
      new CoreCommandsPlugin(),
      new CustomCommandsPlugin(),
      new LoyaltyPlugin(),
      new TimerPlugin(),
      new ModerationPlugin(),
      // Entertainment
      new SongRequestPlugin(),
      new TTSPlugin(),
      new GamesPlugin(),
      // Interaction
      new GiveawayPlugin(),
      new PollsPlugin(),
      new QuotesPlugin(),
      new QueuePlugin(),
      // Tools
      new CountersPlugin(),
      new RanksPlugin(),
      new WelcomePlugin(),
      new ShopPlugin(),
      new StreamControlPlugin(),
      // Advanced
      new ChatLogsPlugin(),
      new BettingPlugin(),
      new SubGoalsPlugin(),
      new LurkPlugin(),
      new AutoShoutoutPlugin(),
      new ScheduledPlugin(),
      new SoundAlertsPlugin(),
      new SpotifyPlugin(),
      new AIChatPlugin(),
      new VIPManagementPlugin(),
      new PredictionsPlugin(),
      // Integration
      new AlertsPlugin(),
      new DiscordPlugin(),
      new DashboardPlugin(),
      // Twitch Tools
      new TwitchInfoPlugin(),
      new HypeTrainPlugin(),
      new EmoteStatsPlugin(),
      new BitsLeaderboardPlugin(),
      // Moderation+
      new WatchlistPlugin(),
      new RaidProtectionPlugin(),
      new ChatModesPlugin(),
      // Stream Tools
      new OBSControlPlugin(),
      new StreamNotesPlugin(),
      new HydrationPlugin(),
      // Social
      new TwitterPlugin(),
      // Analytics
      new AnalyticsPlugin(),
    ];

    for (const plugin of plugins) {
      try {
        await bot.loadPlugin(plugin);
      } catch (err) {
        logger.warn(`Plugin failed to load: ${err}`);
      }
    }

    // Setup event forwarding to renderer
    setupBotEvents();

    // Start the bot
    await bot.start();

    mainWindow?.webContents.send('bot:status', {
      connected: true,
      channel,
      username,
      pluginCount: bot.getPlugins().length,
      commandCount: bot.getCommands().length,
    });

    logger.info('Bot started successfully');
  } catch (error: any) {
    logger.error(`Failed to start bot: ${error.message}`);
    mainWindow?.webContents.send('bot:error', {
      message: `Bot konnte nicht gestartet werden: ${error.message}`,
    });
  }
}

function setupBotEvents() {
  if (!bot) return;

  const eventBus = bot.getEventBus();

  // Forward chat messages to renderer
  eventBus.on('chat:message', (message) => {
    mainWindow?.webContents.send('chat:message', message);
  });

  // Forward connection events
  eventBus.on('bot:connected', (data) => {
    mainWindow?.webContents.send('bot:connected', data);
  });

  eventBus.on('bot:disconnected', (data) => {
    mainWindow?.webContents.send('bot:disconnected', data);
  });
}

function setupIPC() {
  // Window controls
  ipcMain.on('window:minimize', () => {
    mainWindow?.minimize();
  });

  ipcMain.on('window:maximize', () => {
    if (mainWindow?.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow?.maximize();
    }
  });

  ipcMain.on('window:close', () => {
    mainWindow?.close();
  });

  // Bot control
  ipcMain.handle('bot:connect', async (_, credentials) => {
    if (credentials) {
      process.env.TWITCH_BOT_USERNAME = credentials.username;
      process.env.TWITCH_OAUTH_TOKEN = credentials.oauthToken;
      process.env.TWITCH_CHANNEL = credentials.channel;
    }

    await startBot();
    return { success: !!bot };
  });

  ipcMain.handle('bot:disconnect', async () => {
    if (bot) {
      await bot.stop();
      bot = null;
    }
    updateTrayMenu();
    return { success: true };
  });

  ipcMain.handle('bot:getStatus', () => {
    return {
      connected: !!bot,
      channel: process.env.TWITCH_CHANNEL,
      username: process.env.TWITCH_BOT_USERNAME,
    };
  });

  ipcMain.handle('bot:getStats', () => {
    if (!bot) return null;

    return {
      plugins: bot.getPlugins().length,
      commands: bot.getCommands().length,
      uptime: bot.getUptime(),
    };
  });

  // Database queries
  ipcMain.handle('db:getUsers', (_, limit = 100) => {
    try {
      const db = getDatabase();
      return db.getTopUsers(limit);
    } catch {
      return [];
    }
  });

  ipcMain.handle('db:getCommands', () => {
    try {
      const db = getDatabase();
      return db.getAllCommands();
    } catch {
      return [];
    }
  });

  ipcMain.handle('db:getSettings', () => {
    try {
      const db = getDatabase();
      return db.getAllSettings();
    } catch {
      return {};
    }
  });

  ipcMain.handle('db:setSetting', (_, key: string, value: any) => {
    try {
      const db = getDatabase();
      db.setSetting(key, value);
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  // External links
  ipcMain.on('open:external', (_, url: string) => {
    shell.openExternal(url);
  });

  // Settings
  ipcMain.handle('settings:get', () => {
    return {
      twitch: {
        username: process.env.TWITCH_BOT_USERNAME || '',
        channel: process.env.TWITCH_CHANNEL || '',
        hasToken: !!process.env.TWITCH_OAUTH_TOKEN,
      },
      commandPrefix: process.env.COMMAND_PREFIX || '!',
      debug: process.env.DEBUG === 'true',
    };
  });
}

// App lifecycle
app.whenReady().then(async () => {
  createWindow();
  createTray();
  setupIPC();

  // Auto-connect if credentials are available
  if (process.env.TWITCH_BOT_USERNAME && process.env.TWITCH_OAUTH_TOKEN && process.env.TWITCH_CHANNEL) {
    setTimeout(() => startBot(), 1000);
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  // Don't quit on Windows/Linux, minimize to tray
  if (process.platform === 'darwin') {
    // On macOS it's common to not quit
  }
});

app.on('before-quit', async () => {
  if (bot) {
    await bot.stop();
  }

  try {
    const db = getDatabase();
    db.save();
  } catch {
    // Database might not be initialized
  }
});
