/**
 * Electron Main Process
 *
 * Desktop application for StreamCore Twitch Bot
 */

import { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, shell } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import 'dotenv/config';

// Import StreamCore
import { StreamCore, StreamCoreConfig } from '../core/StreamCore';
import { initDatabase, getDatabase } from '../services/Database';
import { Logger } from '../utils/logger';

// Import ALL plugins
import { CoreCommandsPlugin } from '../plugins/commands/CoreCommandsPlugin';
import { CustomCommandsPlugin } from '../plugins/commands/CustomCommandsPlugin';
import { LoyaltyPlugin } from '../plugins/loyalty/LoyaltyPlugin';
import { TimerPlugin } from '../plugins/timers/TimerPlugin';
import { ModerationPlugin } from '../plugins/moderation/ModerationPlugin';
import { SongRequestPlugin } from '../plugins/songrequest/SongRequestPlugin';
import { TTSPlugin } from '../plugins/tts/TTSPlugin';
import { GamesPlugin } from '../plugins/games/GamesPlugin';
import { GiveawayPlugin } from '../plugins/giveaway/GiveawayPlugin';
import { PollsPlugin } from '../plugins/polls/PollsPlugin';
import { QuotesPlugin } from '../plugins/quotes/QuotesPlugin';
import { QueuePlugin } from '../plugins/queue/QueuePlugin';
import { CountersPlugin } from '../plugins/counters/CountersPlugin';
import { RanksPlugin } from '../plugins/ranks/RanksPlugin';
import { WelcomePlugin } from '../plugins/welcome/WelcomePlugin';
import { ShopPlugin } from '../plugins/shop/ShopPlugin';
import { StreamControlPlugin } from '../plugins/streamcontrol/StreamControlPlugin';
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
import { AlertsPlugin } from '../plugins/alerts/AlertsPlugin';
import { DiscordPlugin } from '../plugins/discord/DiscordPlugin';
import { DashboardPlugin } from '../plugins/dashboard/DashboardPlugin';
import { TwitchInfoPlugin } from '../plugins/twitchinfo/TwitchInfoPlugin';
import { HypeTrainPlugin } from '../plugins/hypetrain/HypeTrainPlugin';
import { EmoteStatsPlugin } from '../plugins/emotestats/EmoteStatsPlugin';
import { BitsLeaderboardPlugin } from '../plugins/bitsleaderboard/BitsLeaderboardPlugin';
import { WatchlistPlugin } from '../plugins/watchlist/WatchlistPlugin';
import { RaidProtectionPlugin } from '../plugins/raidprotection/RaidProtectionPlugin';
import { ChatModesPlugin } from '../plugins/chatmodes/ChatModesPlugin';
import { OBSControlPlugin } from '../plugins/obscontrol/OBSControlPlugin';
import { StreamNotesPlugin } from '../plugins/streamnotes/StreamNotesPlugin';
import { HydrationPlugin } from '../plugins/hydration/HydrationPlugin';
import { TwitterPlugin } from '../plugins/twitter/TwitterPlugin';
import { AnalyticsPlugin } from '../plugins/analytics/AnalyticsPlugin';

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let bot: StreamCore | null = null;
const logger = new Logger('Electron');

// Store for chat messages
let chatMessages: any[] = [];
const MAX_MESSAGES = 500;

// Store for users
let onlineUsers: Set<string> = new Set();

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    title: 'StreamCore',
    backgroundColor: '#0f0f0f',
    frame: false,
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

  if (process.env.DEBUG === 'true') {
    mainWindow.webContents.openDevTools();
  }
}

function createTray() {
  const iconPath = path.join(__dirname, '../../assets/icon.png');
  let icon = nativeImage.createFromPath(iconPath);
  if (icon.isEmpty()) {
    icon = nativeImage.createEmpty();
  }

  tray = new Tray(icon);

  updateTrayMenu();

  tray.setToolTip('StreamCore - Twitch Bot');

  tray.on('double-click', () => {
    mainWindow?.show();
  });
}

function updateTrayMenu() {
  if (!tray) return;

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'StreamCore öffnen',
      click: () => mainWindow?.show(),
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
    const username = process.env.TWITCH_BOT_USERNAME;
    const token = process.env.TWITCH_OAUTH_TOKEN;
    const channel = process.env.TWITCH_CHANNEL;

    if (!username || !token || !channel) {
      mainWindow?.webContents.send('bot:error', {
        message: 'Twitch-Anmeldedaten fehlen. Bitte in den Einstellungen konfigurieren.',
      });
      return;
    }

    logger.info('Initializing database...');
    await initDatabase();

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

    bot = new StreamCore(config);

    // Load ALL plugins
    const plugins = [
      new CoreCommandsPlugin(),
      new CustomCommandsPlugin(),
      new LoyaltyPlugin(),
      new TimerPlugin(),
      new ModerationPlugin(),
      new SongRequestPlugin(),
      new TTSPlugin(),
      new GamesPlugin(),
      new GiveawayPlugin(),
      new PollsPlugin(),
      new QuotesPlugin(),
      new QueuePlugin(),
      new CountersPlugin(),
      new RanksPlugin(),
      new WelcomePlugin(),
      new ShopPlugin(),
      new StreamControlPlugin(),
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
      new AlertsPlugin(),
      new DiscordPlugin(),
      new DashboardPlugin(),
      new TwitchInfoPlugin(),
      new HypeTrainPlugin(),
      new EmoteStatsPlugin(),
      new BitsLeaderboardPlugin(),
      new WatchlistPlugin(),
      new RaidProtectionPlugin(),
      new ChatModesPlugin(),
      new OBSControlPlugin(),
      new StreamNotesPlugin(),
      new HydrationPlugin(),
      new TwitterPlugin(),
      new AnalyticsPlugin(),
    ];

    for (const plugin of plugins) {
      try {
        await bot.loadPlugin(plugin);
      } catch (err) {
        logger.warn(`Plugin failed to load: ${err}`);
      }
    }

    setupBotEvents();
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

  // Forward ALL chat messages to renderer
  eventBus.on('chat:message', (message) => {
    // Store message
    chatMessages.push({
      ...message,
      timestamp: new Date().toISOString(),
    });
    if (chatMessages.length > MAX_MESSAGES) {
      chatMessages = chatMessages.slice(-MAX_MESSAGES);
    }

    // Track user
    if (message.user?.username) {
      onlineUsers.add(message.user.username);
    }

    // Send to renderer
    mainWindow?.webContents.send('chat:message', message);
  });

  // Forward commands
  eventBus.on('chat:command', (data) => {
    mainWindow?.webContents.send('chat:command', data);
  });

  // Forward connection events
  eventBus.on('bot:connected', (data) => {
    mainWindow?.webContents.send('bot:connected', data);
  });

  eventBus.on('bot:disconnected', (data) => {
    mainWindow?.webContents.send('bot:disconnected', data);
  });

  // Forward Twitch events
  eventBus.on('twitch:follow', (data) => {
    mainWindow?.webContents.send('twitch:follow', data);
    mainWindow?.webContents.send('alert:show', { type: 'follow', data });
  });

  eventBus.on('twitch:subscription', (data) => {
    mainWindow?.webContents.send('twitch:subscription', data);
    mainWindow?.webContents.send('alert:show', { type: 'subscription', data });
  });

  eventBus.on('twitch:raid', (data) => {
    mainWindow?.webContents.send('twitch:raid', data);
    mainWindow?.webContents.send('alert:show', { type: 'raid', data });
  });

  eventBus.on('twitch:cheer', (data) => {
    mainWindow?.webContents.send('twitch:cheer', data);
    mainWindow?.webContents.send('alert:show', { type: 'cheer', data });
  });
}

function setupIPC() {
  // ==========================================
  // Window Controls
  // ==========================================
  ipcMain.on('window:minimize', () => mainWindow?.minimize());
  ipcMain.on('window:maximize', () => {
    if (mainWindow?.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow?.maximize();
    }
  });
  ipcMain.on('window:close', () => mainWindow?.close());

  // ==========================================
  // Bot Control
  // ==========================================
  ipcMain.handle('bot:connect', async (_, credentials) => {
    if (credentials) {
      process.env.TWITCH_BOT_USERNAME = credentials.username;
      process.env.TWITCH_OAUTH_TOKEN = credentials.oauthToken;
      process.env.TWITCH_CHANNEL = credentials.channel;
      if (credentials.clientId) process.env.TWITCH_CLIENT_ID = credentials.clientId;
      if (credentials.clientSecret) process.env.TWITCH_CLIENT_SECRET = credentials.clientSecret;

      // Save to .env file
      saveCredentialsToEnv(credentials);
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

  ipcMain.handle('bot:getStatus', () => ({
    connected: !!bot,
    channel: process.env.TWITCH_CHANNEL,
    username: process.env.TWITCH_BOT_USERNAME,
  }));

  ipcMain.handle('bot:getStats', () => {
    if (!bot) return null;
    return {
      plugins: bot.getPlugins().length,
      commands: bot.getCommands().length,
      uptime: bot.getUptime(),
      messagesReceived: chatMessages.length,
      onlineUsers: onlineUsers.size,
    };
  });

  ipcMain.handle('bot:sendMessage', async (_, message: string) => {
    if (bot && process.env.TWITCH_CHANNEL) {
      bot.sendMessage(process.env.TWITCH_CHANNEL, message);
      return { success: true };
    }
    return { success: false };
  });

  // ==========================================
  // Viewers/Users
  // ==========================================
  ipcMain.handle('viewers:getOnline', () => ({
    users: Array.from(onlineUsers),
    count: onlineUsers.size,
  }));

  ipcMain.handle('viewers:getAll', () => {
    try {
      const db = getDatabase();
      return db.getAllUsers();
    } catch {
      return [];
    }
  });

  ipcMain.handle('viewers:getTop', (_, limit = 10) => {
    try {
      const db = getDatabase();
      return db.getTopUsers(limit);
    } catch {
      return [];
    }
  });

  ipcMain.handle('viewers:getUser', (_, username: string) => {
    try {
      const db = getDatabase();
      return db.getUser('twitch', username);
    } catch {
      return null;
    }
  });

  ipcMain.handle('viewers:updatePoints', (_, username: string, points: number) => {
    try {
      const db = getDatabase();
      db.setUserPoints('twitch', username, points);
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  // ==========================================
  // Commands
  // ==========================================
  ipcMain.handle('commands:getAll', () => {
    try {
      const db = getDatabase();
      return db.getAllCommands();
    } catch {
      return [];
    }
  });

  ipcMain.handle('commands:add', (_, name: string, response: string, options?: any) => {
    try {
      const db = getDatabase();
      const id = `cmd_${Date.now()}`;
      db.createCommand(id, name, response, options);
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('commands:update', (_, name: string, updates: any) => {
    try {
      const db = getDatabase();
      db.updateCommand(name, updates);
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('commands:delete', (_, name: string) => {
    try {
      const db = getDatabase();
      db.deleteCommand(name);
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('commands:toggle', (_, name: string) => {
    try {
      const db = getDatabase();
      const cmd = db.getCommand(name);
      if (cmd) {
        db.updateCommand(name, { enabled: !cmd.enabled });
      }
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  // ==========================================
  // Timers
  // ==========================================
  ipcMain.handle('timers:getAll', () => {
    try {
      const db = getDatabase();
      return db.getAllTimers();
    } catch {
      return [];
    }
  });

  ipcMain.handle('timers:add', (_, name: string, messages: string[], interval: number) => {
    try {
      const db = getDatabase();
      const id = `timer_${Date.now()}`;
      db.createTimer(id, name, messages, interval);
      return { success: true, id };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('timers:update', (_, id: string, updates: any) => {
    try {
      const db = getDatabase();
      db.updateTimer(id, updates);
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('timers:delete', (_, id: string) => {
    try {
      const db = getDatabase();
      db.deleteTimer(id);
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('timers:toggle', (_, id: string) => {
    try {
      const db = getDatabase();
      const timer = db.getTimer(id);
      if (timer) {
        db.updateTimer(id, { enabled: !timer.enabled });
      }
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('db:getTimers', () => {
    try {
      const db = getDatabase();
      return db.getAllTimers();
    } catch {
      return [];
    }
  });

  // ==========================================
  // Songs
  // ==========================================
  ipcMain.handle('songs:getQueue', () => {
    // TODO: Get from SongRequestPlugin
    return { queue: [], current: null, isPlaying: false };
  });

  ipcMain.handle('songs:getCurrent', () => {
    return null;
  });

  ipcMain.handle('songs:skip', () => {
    // TODO: Implement
    return { success: true };
  });

  ipcMain.handle('songs:add', (_, query: string, username: string) => {
    // TODO: Integrate with SongRequestPlugin when available
    mainWindow?.webContents.send('songs:added', { query, username });
    return { success: true };
  });

  ipcMain.handle('songs:remove', (_, index: number) => {
    return { success: true };
  });

  ipcMain.handle('songs:clear', () => {
    return { success: true };
  });

  ipcMain.handle('songs:setVolume', (_, volume: number) => {
    try {
      const db = getDatabase();
      db.setSetting('songs_volume', volume);
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('songs:toggle', () => {
    try {
      const db = getDatabase();
      const current = db.getSetting('songs_enabled', true);
      db.setSetting('songs_enabled', !current);
      return { success: true, enabled: !current };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  // ==========================================
  // TTS
  // ==========================================
  ipcMain.handle('tts:getQueue', () => {
    return { queue: [], current: null, enabled: true };
  });

  ipcMain.handle('tts:toggle', () => {
    return { enabled: true };
  });

  ipcMain.handle('tts:skip', () => {
    return { success: true };
  });

  ipcMain.handle('tts:clear', () => {
    return { success: true };
  });

  ipcMain.handle('tts:getSettings', () => {
    try {
      const db = getDatabase();
      return db.getSetting('tts_settings', {
        enabled: true,
        volume: 80,
        voice: 'de-DE',
        readUsernames: true,
      });
    } catch {
      return { enabled: true, volume: 80, voice: 'de-DE' };
    }
  });

  ipcMain.handle('tts:updateSettings', (_, settings: any) => {
    try {
      const db = getDatabase();
      db.setSetting('tts_settings', settings);
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('tts:setVolume', (_, volume: number) => {
    try {
      const db = getDatabase();
      const settings = db.getSetting('tts_settings', { enabled: true, volume: 80 });
      settings.volume = volume;
      db.setSetting('tts_settings', settings);
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('tts:setVoice', (_, voice: string) => {
    try {
      const db = getDatabase();
      const settings = db.getSetting('tts_settings', { enabled: true, voice: 'de-DE' });
      settings.voice = voice;
      db.setSetting('tts_settings', settings);
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('tts:add', (_, username: string, message: string) => {
    mainWindow?.webContents.send('tts:play', { username, message });
    return { success: true };
  });

  ipcMain.on('tts:playbackComplete', () => {
    // Notify TTS plugin that playback is complete
  });

  // ==========================================
  // Giveaway
  // ==========================================
  ipcMain.handle('giveaway:getStatus', () => {
    return { active: false, prize: '', entries: [], winner: null };
  });

  ipcMain.handle('giveaway:start', (_, prize: string, duration?: number) => {
    return { success: true };
  });

  ipcMain.handle('giveaway:end', () => {
    return { success: true };
  });

  ipcMain.handle('giveaway:draw', () => {
    return { success: true, winner: null };
  });

  ipcMain.handle('giveaway:getEntries', () => {
    return [];
  });

  // ==========================================
  // Loyalty/Points
  // ==========================================
  ipcMain.handle('loyalty:getSettings', () => {
    try {
      const db = getDatabase();
      return db.getSetting('loyalty_settings', {
        enabled: true,
        pointsPerMessage: 1,
        pointsPerMinute: 1,
        currencyName: 'Punkte',
      });
    } catch {
      return { enabled: true, pointsPerMessage: 1, currencyName: 'Punkte' };
    }
  });

  ipcMain.handle('loyalty:updateSettings', (_, settings: any) => {
    try {
      const db = getDatabase();
      db.setSetting('loyalty_settings', settings);
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('loyalty:getLeaderboard', (_, limit = 10) => {
    try {
      const db = getDatabase();
      return db.getTopUsers(limit, 'points');
    } catch {
      return [];
    }
  });

  ipcMain.handle('loyalty:addPoints', (_, username: string, amount: number) => {
    try {
      const db = getDatabase();
      db.updateUserPoints('twitch', username, amount);
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('loyalty:removePoints', (_, username: string, amount: number) => {
    try {
      const db = getDatabase();
      db.updateUserPoints('twitch', username, -amount);
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('loyalty:setPoints', (_, username: string, amount: number) => {
    try {
      const db = getDatabase();
      db.setUserPoints('twitch', username, amount);
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  // ==========================================
  // Moderation
  // ==========================================
  ipcMain.handle('moderation:getSettings', () => {
    try {
      const db = getDatabase();
      return db.getSetting('moderation_settings', {
        capsLock: true,
        links: true,
        spam: true,
        maxCaps: 80,
      });
    } catch {
      return { capsLock: true, links: true, spam: true };
    }
  });

  ipcMain.handle('moderation:updateSettings', (_, settings: any) => {
    try {
      const db = getDatabase();
      db.setSetting('moderation_settings', settings);
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('moderation:getBlacklist', () => {
    try {
      const db = getDatabase();
      return db.getBlacklist();
    } catch {
      return [];
    }
  });

  ipcMain.handle('moderation:addBlacklist', (_, word: string, type?: string) => {
    try {
      const db = getDatabase();
      db.addBlacklistWord(word, type || 'word');
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('moderation:removeBlacklist', (_, word: string) => {
    try {
      const db = getDatabase();
      db.removeBlacklistWord(word);
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('moderation:timeout', async (_, username: string, duration: number, reason?: string) => {
    if (bot && process.env.TWITCH_CHANNEL) {
      bot.sendMessage(process.env.TWITCH_CHANNEL, `/timeout ${username} ${duration} ${reason || ''}`);
      return { success: true };
    }
    return { success: false, error: 'Bot not connected' };
  });

  ipcMain.handle('moderation:ban', async (_, username: string, reason?: string) => {
    if (bot && process.env.TWITCH_CHANNEL) {
      bot.sendMessage(process.env.TWITCH_CHANNEL, `/ban ${username} ${reason || ''}`);
      return { success: true };
    }
    return { success: false, error: 'Bot not connected' };
  });

  ipcMain.handle('moderation:unban', async (_, username: string) => {
    if (bot && process.env.TWITCH_CHANNEL) {
      bot.sendMessage(process.env.TWITCH_CHANNEL, `/unban ${username}`);
      return { success: true };
    }
    return { success: false, error: 'Bot not connected' };
  });

  // ==========================================
  // Alerts
  // ==========================================
  ipcMain.handle('alerts:getSettings', () => {
    try {
      const db = getDatabase();
      return db.getSetting('alerts_settings', {
        followAlert: true,
        subAlert: true,
        raidAlert: true,
        cheerAlert: true,
      });
    } catch {
      return { followAlert: true, subAlert: true, raidAlert: true };
    }
  });

  ipcMain.handle('alerts:updateSettings', (_, settings: any) => {
    try {
      const db = getDatabase();
      db.setSetting('alerts_settings', settings);
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('alerts:test', (_, type: string) => {
    mainWindow?.webContents.send('alert:show', {
      type,
      data: { username: 'TestUser', amount: 100 },
    });
    return { success: true };
  });

  // ==========================================
  // Database
  // ==========================================
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

  // ==========================================
  // Settings
  // ==========================================
  ipcMain.handle('settings:get', () => ({
    twitch: {
      username: process.env.TWITCH_BOT_USERNAME || '',
      channel: process.env.TWITCH_CHANNEL || '',
      hasToken: !!process.env.TWITCH_OAUTH_TOKEN,
      clientId: process.env.TWITCH_CLIENT_ID || '',
    },
    commandPrefix: process.env.COMMAND_PREFIX || '!',
    debug: process.env.DEBUG === 'true',
  }));

  ipcMain.handle('settings:save', (_, settings: any) => {
    try {
      const db = getDatabase();
      for (const [key, value] of Object.entries(settings)) {
        db.setSetting(key, value);
      }
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('settings:getCredentials', () => ({
    username: process.env.TWITCH_BOT_USERNAME || '',
    channel: process.env.TWITCH_CHANNEL || '',
    hasToken: !!process.env.TWITCH_OAUTH_TOKEN,
    clientId: process.env.TWITCH_CLIENT_ID || '',
  }));

  ipcMain.handle('settings:saveCredentials', (_, credentials: any) => {
    try {
      process.env.TWITCH_BOT_USERNAME = credentials.username;
      process.env.TWITCH_OAUTH_TOKEN = credentials.oauthToken;
      process.env.TWITCH_CHANNEL = credentials.channel;
      if (credentials.clientId) process.env.TWITCH_CLIENT_ID = credentials.clientId;
      if (credentials.clientSecret) process.env.TWITCH_CLIENT_SECRET = credentials.clientSecret;

      saveCredentialsToEnv(credentials);
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  // ==========================================
  // Messages
  // ==========================================
  ipcMain.handle('messages:getRecent', (_, limit = 100) => {
    return chatMessages.slice(-limit);
  });

  ipcMain.handle('messages:send', async (_, message: string) => {
    if (bot && process.env.TWITCH_CHANNEL) {
      bot.sendMessage(process.env.TWITCH_CHANNEL, message);
      return { success: true };
    }
    return { success: false };
  });

  // ==========================================
  // External
  // ==========================================
  ipcMain.on('open:external', (_, url: string) => {
    shell.openExternal(url);
  });
}

function saveCredentialsToEnv(credentials: any) {
  try {
    const envPath = path.join(process.cwd(), '.env');
    let envContent = '';

    if (fs.existsSync(envPath)) {
      envContent = fs.readFileSync(envPath, 'utf8');
    }

    const updateEnv = (key: string, value: string) => {
      const regex = new RegExp(`^${key}=.*$`, 'm');
      if (regex.test(envContent)) {
        envContent = envContent.replace(regex, `${key}=${value}`);
      } else {
        envContent += `\n${key}=${value}`;
      }
    };

    if (credentials.username) updateEnv('TWITCH_BOT_USERNAME', credentials.username);
    if (credentials.oauthToken) updateEnv('TWITCH_OAUTH_TOKEN', credentials.oauthToken);
    if (credentials.channel) updateEnv('TWITCH_CHANNEL', credentials.channel);
    if (credentials.clientId) updateEnv('TWITCH_CLIENT_ID', credentials.clientId);
    if (credentials.clientSecret) updateEnv('TWITCH_CLIENT_SECRET', credentials.clientSecret);

    fs.writeFileSync(envPath, envContent.trim() + '\n');
    logger.info('Credentials saved to .env file');
  } catch (error) {
    logger.error(`Failed to save credentials: ${error}`);
  }
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
  // Keep running in tray
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
