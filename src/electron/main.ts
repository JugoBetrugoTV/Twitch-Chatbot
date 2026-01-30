/**
 * Electron Main Process
 *
 * Desktop application for StreamCore Twitch Bot
 */

import { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, shell, dialog } from 'electron';
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

// ==========================================
// Chat Message Types & Circular Buffer
// ==========================================
interface ChatMessage {
  user: { username: string; displayName?: string; badges?: Map<string, string> | Record<string, string> };
  message: string;
  timestamp: string;
  channel?: string;
}

// Efficient circular buffer for chat messages (no array copying)
class CircularBuffer<T> {
  private buffer: (T | undefined)[];
  private head = 0;
  private count = 0;

  constructor(private capacity: number) {
    this.buffer = new Array(capacity);
  }

  push(item: T): void {
    this.buffer[this.head] = item;
    this.head = (this.head + 1) % this.capacity;
    if (this.count < this.capacity) this.count++;
  }

  getAll(): T[] {
    const result: T[] = [];
    const start = this.count < this.capacity ? 0 : this.head;
    for (let i = 0; i < this.count; i++) {
      const idx = (start + i) % this.capacity;
      if (this.buffer[idx] !== undefined) {
        result.push(this.buffer[idx] as T);
      }
    }
    return result;
  }

  get length(): number {
    return this.count;
  }

  clear(): void {
    this.buffer = new Array(this.capacity);
    this.head = 0;
    this.count = 0;
  }
}

const chatMessages = new CircularBuffer<ChatMessage>(500);

// ==========================================
// Online Users with Auto-Cleanup
// ==========================================
const USER_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes inactivity = offline
const onlineUsers = new Map<string, number>(); // username -> last seen timestamp
let userCleanupInterval: NodeJS.Timeout | null = null;

function trackUser(username: string): void {
  onlineUsers.set(username.toLowerCase(), Date.now());
}

function cleanupOfflineUsers(): void {
  const now = Date.now();
  for (const [user, lastSeen] of onlineUsers) {
    if (now - lastSeen > USER_TIMEOUT_MS) {
      onlineUsers.delete(user);
    }
  }
}

function startUserCleanup(): void {
  if (userCleanupInterval) return;
  userCleanupInterval = setInterval(cleanupOfflineUsers, 5 * 60 * 1000); // Every 5 minutes
}

function stopUserCleanup(): void {
  if (userCleanupInterval) {
    clearInterval(userCleanupInterval);
    userCleanupInterval = null;
  }
}

// ==========================================
// Input Validation Helpers
// ==========================================
function validateString(value: unknown, name: string, minLen = 1, maxLen = 500): string {
  if (typeof value !== 'string') throw new Error(`${name} muss ein Text sein`);
  const trimmed = value.trim();
  if (trimmed.length < minLen) throw new Error(`${name} ist zu kurz (min. ${minLen} Zeichen)`);
  if (trimmed.length > maxLen) throw new Error(`${name} ist zu lang (max. ${maxLen} Zeichen)`);
  return trimmed;
}

function validateNumber(value: unknown, name: string, min?: number, max?: number): number {
  const num = typeof value === 'number' ? value : parseInt(String(value), 10);
  if (isNaN(num)) throw new Error(`${name} muss eine Zahl sein`);
  if (min !== undefined && num < min) throw new Error(`${name} muss mindestens ${min} sein`);
  if (max !== undefined && num > max) throw new Error(`${name} darf maximal ${max} sein`);
  return num;
}

function validateUsername(value: unknown): string {
  const username = validateString(value, 'Benutzername', 1, 25);
  if (!/^[a-zA-Z0-9_]+$/.test(username)) throw new Error('Ungültiger Benutzername');
  return username.toLowerCase();
}

function validateId(value: unknown): string {
  const id = validateString(value, 'ID', 1, 100);
  if (!/^[a-zA-Z0-9_\-]+$/.test(id)) throw new Error('Ungültige ID');
  return id;
}

// ==========================================
// IPC Handler Factory Functions
// ==========================================
type IpcResult<T = void> = { success: true; data?: T } | { success: false; error: string };

function createSettingsGetHandler<T>(settingKey: string, defaultValue: T) {
  return (): T => {
    try {
      const db = getDatabase();
      return db.getSetting(settingKey, defaultValue) as T;
    } catch {
      return defaultValue;
    }
  };
}

function createSettingsSaveHandler(settingKey: string) {
  return (_: unknown, settings: unknown): IpcResult => {
    try {
      const db = getDatabase();
      db.setSetting(settingKey, settings);
      return { success: true };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unbekannter Fehler';
      logger.error(`Failed to save ${settingKey}: ${message}`);
      return { success: false, error: message };
    }
  };
}

function createArrayGetHandler(settingKey: string) {
  return (): unknown[] => {
    try {
      const db = getDatabase();
      return db.getSetting(settingKey, []) as unknown[];
    } catch {
      return [];
    }
  };
}

function createDbQueryHandler(query: string, defaultValue: unknown[] = []) {
  return (): unknown[] => {
    try {
      const db = getDatabase();
      return db.query(query);
    } catch {
      return defaultValue;
    }
  };
}

function createDbDeleteHandler(table: string, idColumn = 'id') {
  return (_: unknown, id: unknown): IpcResult => {
    try {
      const validId = validateId(id);
      const db = getDatabase();
      db.run(`DELETE FROM ${table} WHERE ${idColumn} = ?`, [validId]);
      return { success: true };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unbekannter Fehler';
      return { success: false, error: message };
    }
  };
}

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
    startWatchtimeTracking();

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
    // Store message in circular buffer (efficient, no array copying)
    chatMessages.push({
      user: message.user,
      message: message.message,
      timestamp: new Date().toISOString(),
      channel: message.channel,
    });

    // Track user with timestamp for auto-cleanup
    if (message.user?.username) {
      trackUser(message.user.username);
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
    try {
      if (credentials) {
        // Validate credentials
        const username = validateUsername(credentials.username);
        const oauthToken = validateString(credentials.oauthToken, 'OAuth Token', 10, 100);
        const channel = validateUsername(credentials.channel);

        if (!oauthToken.startsWith('oauth:')) {
          return { success: false, error: 'OAuth Token muss mit "oauth:" beginnen' };
        }

        process.env.TWITCH_BOT_USERNAME = username;
        process.env.TWITCH_OAUTH_TOKEN = oauthToken;
        process.env.TWITCH_CHANNEL = channel;
        if (credentials.clientId) {
          process.env.TWITCH_CLIENT_ID = validateString(credentials.clientId, 'Client ID', 10, 50);
        }
        if (credentials.clientSecret) {
          process.env.TWITCH_CLIENT_SECRET = validateString(credentials.clientSecret, 'Client Secret', 10, 50);
        }

        // Save to .env file
        saveCredentialsToEnv(credentials);
      }

      await startBot();
      return { success: !!bot };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unbekannter Fehler';
      logger.error(`Bot connect failed: ${message}`);
      return { success: false, error: message };
    }
  });

  ipcMain.handle('bot:disconnect', async () => {
    stopWatchtimeTracking();
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

  ipcMain.handle('commands:add', (_, name: unknown, response: unknown, options?: unknown) => {
    try {
      // Validate inputs
      const validName = validateString(name, 'Command-Name', 1, 50);
      const validResponse = validateString(response, 'Antwort', 1, 500);

      // Command name must be alphanumeric
      if (!/^[a-zA-Z0-9_]+$/.test(validName)) {
        return { success: false, error: 'Command-Name darf nur Buchstaben, Zahlen und _ enthalten' };
      }

      const db = getDatabase();
      const id = `cmd_${Date.now()}`;
      db.createCommand(id, validName.toLowerCase(), validResponse, options || {});
      return { success: true };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unbekannter Fehler';
      return { success: false, error: message };
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
    const all = chatMessages.getAll();
    return all.slice(-limit);
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

  // ==========================================
  // Quotes
  // ==========================================
  ipcMain.handle('quotes:getAll', () => {
    try {
      const db = getDatabase();
      return db.query('SELECT * FROM quotes ORDER BY id DESC');
    } catch {
      return [];
    }
  });

  ipcMain.handle('quotes:add', (_, text: string, author: string, addedBy: string) => {
    try {
      const db = getDatabase();
      db.run('INSERT INTO quotes (text, author, added_by) VALUES (?, ?, ?)', [text, author, addedBy]);
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('quotes:delete', (_, id: number) => {
    try {
      const db = getDatabase();
      db.run('DELETE FROM quotes WHERE id = ?', [id]);
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  // ==========================================
  // Polls
  // ==========================================
  ipcMain.handle('polls:getAll', () => {
    try {
      const db = getDatabase();
      return db.getSetting('polls', []) as any[];
    } catch {
      return [];
    }
  });

  ipcMain.handle('polls:create', (_, title: string, options: string[], duration: number) => {
    try {
      const db = getDatabase();
      const poll = {
        id: `poll_${Date.now()}`,
        title,
        options: options.map(opt => ({ name: opt, votes: 0 })),
        active: true,
        createdAt: new Date().toISOString(),
        endsAt: new Date(Date.now() + duration * 1000).toISOString()
      };
      const polls = db.getSetting('polls', []) as any[] as any[];
      polls.unshift(poll);
      db.setSetting('polls', polls);
      return { success: true, poll };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('polls:end', (_, id: string) => {
    try {
      const db = getDatabase();
      const polls = db.getSetting('polls', []) as any[];
      const poll = polls.find((p: any) => p.id === id);
      if (poll) {
        poll.active = false;
        poll.endedAt = new Date().toISOString();
        db.setSetting('polls', polls);
      }
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  // ==========================================
  // Counters
  // ==========================================
  ipcMain.handle('counters:getAll', () => {
    try {
      const db = getDatabase();
      return db.query('SELECT * FROM counters ORDER BY name');
    } catch {
      return [];
    }
  });

  ipcMain.handle('counters:create', (_, data: { name: string; value?: number }) => {
    try {
      const db = getDatabase();
      const id = `counter_${Date.now()}`;
      db.run('INSERT INTO counters (id, name, value) VALUES (?, ?, ?)', [id, data.name, data.value || 0]);
      return { success: true, id };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('counters:increment', (_, id: string) => {
    try {
      const db = getDatabase();
      db.run('UPDATE counters SET value = value + 1 WHERE id = ?', [id]);
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('counters:decrement', (_, id: string) => {
    try {
      const db = getDatabase();
      db.run('UPDATE counters SET value = MAX(0, value - 1) WHERE id = ?', [id]);
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('counters:reset', (_, id: string) => {
    try {
      const db = getDatabase();
      db.run('UPDATE counters SET value = 0 WHERE id = ?', [id]);
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('counters:delete', (_, id: string) => {
    try {
      const db = getDatabase();
      db.run('DELETE FROM counters WHERE id = ?', [id]);
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  // ==========================================
  // Sounds
  // ==========================================
  ipcMain.handle('sounds:getAll', () => {
    try {
      const db = getDatabase();
      return db.query('SELECT * FROM sound_effects ORDER BY name');
    } catch {
      return [];
    }
  });

  ipcMain.handle('sounds:add', (_, data: { name: string; command: string; path: string; volume?: number }) => {
    try {
      const db = getDatabase();
      const id = `sound_${Date.now()}`;
      db.run(
        'INSERT INTO sound_effects (id, name, command, file_path, volume, enabled) VALUES (?, ?, ?, ?, ?, 1)',
        [id, data.name, data.command, data.path, data.volume || 100]
      );
      return { success: true, id };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('sounds:delete', (_, id: string) => {
    try {
      const db = getDatabase();
      db.run('DELETE FROM sound_effects WHERE id = ?', [id]);
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('sounds:play', (_, id: string) => {
    mainWindow?.webContents.send('sounds:play', { id });
    return { success: true };
  });

  ipcMain.handle('sounds:selectFile', async () => {
    if (!mainWindow) return { success: false, error: 'No window' };

    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Sound-Datei auswählen',
      filters: [
        { name: 'Audio', extensions: ['mp3', 'wav', 'ogg', 'flac', 'm4a'] }
      ],
      properties: ['openFile']
    });

    if (result.canceled || result.filePaths.length === 0) {
      return { success: false, canceled: true };
    }

    const filePath = result.filePaths[0];
    const fileName = path.basename(filePath);

    // Copy to sounds directory
    const soundsDir = path.join(process.cwd(), 'sounds');
    if (!fs.existsSync(soundsDir)) {
      fs.mkdirSync(soundsDir, { recursive: true });
    }

    const destPath = path.join(soundsDir, fileName);
    fs.copyFileSync(filePath, destPath);

    return {
      success: true,
      path: destPath,
      name: fileName.replace(/\.[^/.]+$/, '') // Remove extension for name
    };
  });

  // ==========================================
  // Queue
  // ==========================================
  ipcMain.handle('queue:getAll', () => {
    try {
      const db = getDatabase();
      return db.getSetting('user_queue', []) as any[];
    } catch {
      return [];
    }
  });

  ipcMain.handle('queue:add', (_, username: string, message?: string) => {
    try {
      const db = getDatabase();
      const queue = db.getSetting('user_queue', []) as any[];
      queue.push({
        id: Date.now(),
        username,
        message,
        addedAt: new Date().toISOString()
      });
      db.setSetting('user_queue', queue);
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('queue:process', (_, id: number) => {
    try {
      const db = getDatabase();
      const queue = db.getSetting('user_queue', []) as any[];
      const index = queue.findIndex((q: any) => q.id === id);
      if (index > -1) {
        queue.splice(index, 1);
        db.setSetting('user_queue', queue);
      }
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('queue:remove', (_, id: number) => {
    try {
      const db = getDatabase();
      const queue = db.getSetting('user_queue', []) as any[];
      const index = queue.findIndex((q: any) => q.id === id);
      if (index > -1) {
        queue.splice(index, 1);
        db.setSetting('user_queue', queue);
      }
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('queue:clear', () => {
    try {
      const db = getDatabase();
      db.setSetting('user_queue', []);
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  // ==========================================
  // Currency
  // ==========================================
  ipcMain.handle('currency:getSettings', () => {
    try {
      const db = getDatabase();
      return db.getSetting('currency_settings', {
        name: 'Punkte',
        perMinute: 1,
        subBonus: 2,
        startAmount: 100
      });
    } catch {
      return { name: 'Punkte', perMinute: 1, subBonus: 2, startAmount: 100 };
    }
  });

  ipcMain.handle('currency:saveSettings', (_, settings: any) => {
    try {
      const db = getDatabase();
      db.setSetting('currency_settings', settings);
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('currency:getLeaderboard', (_, limit = 10) => {
    try {
      const db = getDatabase();
      return db.getTopUsers(limit, 'points');
    } catch {
      return [];
    }
  });

  // ==========================================
  // Minigames
  // ==========================================
  ipcMain.handle('minigames:getSettings', () => {
    try {
      const db = getDatabase();
      return db.getSetting('minigames_settings', {
        slotsEnabled: true,
        diceEnabled: true,
        blackjackEnabled: false,
        duelEnabled: true,
        heistEnabled: false,
        rouletteEnabled: false,
        minBet: 10,
        maxBet: 1000,
        cooldown: 30
      });
    } catch {
      return {};
    }
  });

  ipcMain.handle('minigames:saveSettings', (_, settings: any) => {
    try {
      const db = getDatabase();
      db.setSetting('minigames_settings', settings);
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  // ==========================================
  // Betting
  // ==========================================
  ipcMain.handle('betting:getActive', () => {
    try {
      const db = getDatabase();
      return db.getSetting('active_bet', null);
    } catch {
      return null;
    }
  });

  ipcMain.handle('betting:getHistory', () => {
    try {
      const db = getDatabase();
      return db.query('SELECT * FROM bets ORDER BY created_at DESC LIMIT 20');
    } catch {
      return [];
    }
  });

  ipcMain.handle('betting:create', (_, data: { title: string; options: string[] }) => {
    try {
      const db = getDatabase();
      const bet = {
        id: `bet_${Date.now()}`,
        title: data.title,
        options: data.options.map(name => ({ name, bets: 0, amount: 0 })),
        active: true,
        createdAt: new Date().toISOString()
      };
      db.setSetting('active_bet', bet);
      return { success: true, bet };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('betting:close', (_, winner: string) => {
    try {
      const db = getDatabase();
      const bet = db.getSetting('active_bet', null) as any;
      if (bet) {
        bet.active = false;
        bet.winner = winner;
        bet.endedAt = new Date().toISOString();
        db.run('INSERT INTO bets (id, title, options, winner, created_at, ended_at) VALUES (?, ?, ?, ?, ?, ?)',
          [bet.id, bet.title, JSON.stringify(bet.options), winner, bet.createdAt, bet.endedAt]);
        db.setSetting('active_bet', null);
      }
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('betting:cancel', () => {
    try {
      const db = getDatabase();
      db.setSetting('active_bet', null);
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  // ==========================================
  // Events
  // ==========================================
  ipcMain.handle('events:getAll', (_, filter?: string) => {
    try {
      const db = getDatabase();
      if (filter && filter !== 'all') {
        return db.getRecentEvents(100, filter);
      }
      return db.getRecentEvents(100);
    } catch {
      return [];
    }
  });

  // ==========================================
  // Mod Tools
  // ==========================================
  ipcMain.handle('modtools:getSettings', () => {
    try {
      const db = getDatabase();
      return db.getSetting('modtools_settings', {
        automodEnabled: true,
        capsFilter: true,
        linkFilter: true,
        symbolFilter: false,
        emoteFilter: false,
        maxCaps: 80,
        maxEmotes: 10,
        timeoutDuration: 60
      });
    } catch {
      return {};
    }
  });

  ipcMain.handle('modtools:saveSettings', (_, settings: any) => {
    try {
      const db = getDatabase();
      db.setSetting('modtools_settings', settings);
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('modtools:getLogs', () => {
    try {
      const db = getDatabase();
      return db.getSetting('mod_logs', []) as any[];
    } catch {
      return [];
    }
  });

  // ==========================================
  // Notifications
  // ==========================================
  ipcMain.handle('notifications:getSettings', () => {
    try {
      const db = getDatabase();
      return db.getSetting('notification_settings', {
        follows: true,
        subs: true,
        raids: true,
        hosts: false,
        cheers: true,
        sound: 'default',
        volume: 50,
        duration: 5
      });
    } catch {
      return {};
    }
  });

  ipcMain.handle('notifications:saveSettings', (_, settings: any) => {
    try {
      const db = getDatabase();
      db.setSetting('notification_settings', settings);
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  // ==========================================
  // Discord
  // ==========================================
  ipcMain.handle('discord:getSettings', () => {
    try {
      const db = getDatabase();
      return db.getSetting('discord_settings', {
        webhook: '',
        botToken: '',
        channelId: '',
        streamNotify: false,
        clipNotify: false,
        chatBridge: false
      });
    } catch {
      return {};
    }
  });

  ipcMain.handle('discord:saveSettings', (_, settings: any) => {
    try {
      const db = getDatabase();
      db.setSetting('discord_settings', settings);
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('discord:testWebhook', async () => {
    try {
      const db = getDatabase();
      const settings = db.getSetting('discord_settings', { webhook: '' }) as { webhook: string };
      if (!settings.webhook) {
        return { success: false, error: 'Kein Webhook konfiguriert' };
      }
      const response = await fetch(settings.webhook, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: '🤖 StreamCore Test-Nachricht!' })
      });
      return { success: response.ok };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  // ==========================================
  // Subscribers
  // ==========================================
  ipcMain.handle('subscribers:getAll', () => {
    try {
      const db = getDatabase();
      return db.getSetting('subscribers', []) as any[];
    } catch {
      return [];
    }
  });

  // ==========================================
  // Extra Quotes
  // ==========================================
  ipcMain.handle('extraquotes:getAll', () => {
    try {
      const db = getDatabase();
      return db.getSetting('extra_quotes', []) as any[];
    } catch {
      return [];
    }
  });

  ipcMain.handle('extraquotes:add', (_, data: { text: string; author?: string; category?: string }) => {
    try {
      const db = getDatabase();
      const quotes = db.getSetting('extra_quotes', []) as any[];
      quotes.push({
        id: Date.now(),
        text: data.text,
        author: data.author || 'Anonym',
        category: data.category || 'Allgemein',
        addedAt: new Date().toISOString()
      });
      db.setSetting('extra_quotes', quotes);
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('extraquotes:delete', (_, id: number) => {
    try {
      const db = getDatabase();
      const quotes = db.getSetting('extra_quotes', []) as any[];
      const index = quotes.findIndex((q: any) => q.id === id);
      if (index > -1) {
        quotes.splice(index, 1);
        db.setSetting('extra_quotes', quotes);
      }
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  // ==========================================
  // Settings Sub-pages
  // ==========================================
  ipcMain.handle('settings:getGeneral', () => {
    try {
      const db = getDatabase();
      return db.getSetting('general_settings', {
        autoStart: false,
        minimizeToTray: true,
        autoConnect: false,
        checkUpdates: true
      });
    } catch {
      return {};
    }
  });

  ipcMain.handle('settings:saveGeneral', (_, settings: any) => {
    try {
      const db = getDatabase();
      db.setSetting('general_settings', settings);
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('settings:getLocalization', () => {
    try {
      const db = getDatabase();
      return db.getSetting('localization_settings', {
        language: 'de',
        timezone: 'Europe/Berlin',
        dateFormat: 'DD.MM.YYYY'
      });
    } catch {
      return {};
    }
  });

  ipcMain.handle('settings:saveLocalization', (_, settings: any) => {
    try {
      const db = getDatabase();
      db.setSetting('localization_settings', settings);
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('settings:getUsageStats', () => {
    try {
      const db = getDatabase();
      const uptime = bot ? Math.floor(bot.getUptime() / 1000 / 60) : 0;
      const hours = Math.floor(uptime / 60);
      const mins = uptime % 60;
      return {
        uptime: `${hours}h ${mins}m`,
        messagesTotal: chatMessages.length,
        commandsTotal: db.query('SELECT SUM(use_count) as total FROM commands')[0]?.total || 0,
        storageUsed: '< 1 MB'
      };
    } catch {
      return { uptime: '-', messagesTotal: 0, commandsTotal: 0, storageUsed: '-' };
    }
  });

  ipcMain.handle('settings:getMacros', () => {
    try {
      const db = getDatabase();
      return db.getSetting('macros', []) as any[];
    } catch {
      return [];
    }
  });

  ipcMain.handle('settings:addMacro', (_, data: { name: string; commands: string[] }) => {
    try {
      const db = getDatabase();
      const macros = db.getSetting('macros', []) as any[];
      macros.push({ id: `macro_${Date.now()}`, name: data.name, commands: data.commands });
      db.setSetting('macros', macros);
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('settings:deleteMacro', (_, id: string) => {
    try {
      const db = getDatabase();
      const macros = db.getSetting('macros', []) as any[];
      const index = macros.findIndex((m: any) => m.id === id);
      if (index > -1) {
        macros.splice(index, 1);
        db.setSetting('macros', macros);
      }
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('settings:getHotkeys', () => {
    try {
      const db = getDatabase();
      return db.getSetting('hotkeys', []) as any[];
    } catch {
      return [];
    }
  });

  ipcMain.handle('settings:addHotkey', (_, data: { action: string; keys: string }) => {
    try {
      const db = getDatabase();
      const hotkeys = db.getSetting('hotkeys', []) as any[];
      hotkeys.push({ id: `hotkey_${Date.now()}`, action: data.action, keys: data.keys });
      db.setSetting('hotkeys', hotkeys);
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('settings:deleteHotkey', (_, id: string) => {
    try {
      const db = getDatabase();
      const hotkeys = db.getSetting('hotkeys', []) as any[];
      const index = hotkeys.findIndex((h: any) => h.id === id);
      if (index > -1) {
        hotkeys.splice(index, 1);
        db.setSetting('hotkeys', hotkeys);
      }
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('settings:getStyle', () => {
    try {
      const db = getDatabase();
      return db.getSetting('style_settings', {
        primaryColor: '#9147ff',
        fontSize: 14,
        compactMode: false,
        animations: true
      });
    } catch {
      return {};
    }
  });

  ipcMain.handle('settings:saveStyle', (_, settings: any) => {
    try {
      const db = getDatabase();
      db.setSetting('style_settings', settings);
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('settings:getChangelog', () => {
    return [
      { version: '2.0.0', date: '2026-01-30', changes: [
        'Komplettes Redesign der Benutzeroberfläche',
        'Neue Features: Currency, Minigames, Betting, Events',
        'Verbesserte Mod Tools', 'Discord Integration', 'Settings Sub-Pages'
      ]},
      { version: '1.5.0', date: '2026-01-15', changes: [
        'Song Request System verbessert', 'TTS Feature', 'Giveaway System', 'Loyalty Points'
      ]}
    ];
  });

  // ==========================================
  // Analytics
  // ==========================================
  ipcMain.handle('analytics:getData', (_, range = 30) => {
    try {
      const db = getDatabase();
      return {
        totalViews: db.getSetting('total_views', 0),
        newFollowers: db.getSetting('new_followers', 0),
        totalMessages: chatMessages.length,
        streamMinutes: bot ? Math.floor(bot.getUptime() / 1000 / 60) : 0,
        topChatters: db.getTopUsers(5, 'points').map((u: any) => ({
          username: u.username || u.display_name, messages: u.message_count || 0
        })),
        topCommands: db.query('SELECT name, use_count as uses FROM commands ORDER BY use_count DESC LIMIT 5')
      };
    } catch {
      return {};
    }
  });

  ipcMain.handle('analytics:export', () => {
    return { success: true };
  });

  // ==========================================
  // Users (extended)
  // ==========================================
  ipcMain.handle('users:update', (_, username: string, updates: any) => {
    try {
      const db = getDatabase();
      if (updates.points !== undefined) {
        db.setUserPoints('twitch', username, updates.points);
      }
      if (updates.watchTime !== undefined) {
        db.run('UPDATE users SET watch_time = ? WHERE platform = ? AND LOWER(username) = LOWER(?)',
          [updates.watchTime, 'twitch', username]);
      }
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('users:delete', (_, username: string) => {
    try {
      const db = getDatabase();
      db.run('DELETE FROM users WHERE LOWER(username) = LOWER(?)', [username]);
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  // ==========================================
  // Integrations
  // ==========================================
  ipcMain.handle('integrations:getSettings', () => {
    try {
      const db = getDatabase();
      return db.getSetting('integrations_settings', {
        spotify: { connected: false },
        obs: { connected: false, host: 'localhost', port: 4455 },
        twitter: { connected: false }
      });
    } catch {
      return {};
    }
  });

  ipcMain.handle('integrations:saveSettings', (_, settings: any) => {
    try {
      const db = getDatabase();
      db.setSetting('integrations_settings', settings);
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('integrations:testOBS', async () => {
    return { success: true };
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

// Watchtime tracking interval
let watchtimeInterval: NodeJS.Timeout | null = null;

function startWatchtimeTracking() {
  if (watchtimeInterval) return;

  // Update watchtime every minute for online users
  watchtimeInterval = setInterval(() => {
    if (!bot) return;

    try {
      const db = getDatabase();
      const currencySettings = db.getSetting('currency_settings', { perMinute: 1, subBonus: 2 });
      const pointsPerMinute = currencySettings.perMinute || 1;

      // Update all online users (iterate over Map keys)
      for (const username of onlineUsers.keys()) {
        // Increment watchtime by 1 minute
        db.incrementWatchTime('twitch', username, 1);
        // Award points based on settings
        db.updateUserPoints('twitch', username, pointsPerMinute);
      }

      logger.debug(`Updated watchtime for ${onlineUsers.size} users`);
    } catch (error) {
      logger.error(`Failed to update watchtime: ${error}`);
    }
  }, 60000); // Every minute
}

function stopWatchtimeTracking() {
  if (watchtimeInterval) {
    clearInterval(watchtimeInterval);
    watchtimeInterval = null;
  }
}

// App lifecycle
app.whenReady().then(async () => {
  createWindow();
  createTray();
  setupIPC();
  startUserCleanup(); // Start user cleanup interval

  // Auto-connect if credentials are available
  if (process.env.TWITCH_BOT_USERNAME && process.env.TWITCH_OAUTH_TOKEN && process.env.TWITCH_CHANNEL) {
    setTimeout(() => {
      startBot();
      startWatchtimeTracking();
    }, 1000);
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
  stopUserCleanup();
  stopWatchtimeTracking();

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
