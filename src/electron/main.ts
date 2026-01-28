import { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, shell } from 'electron';
import * as path from 'path';
import { TwitchBot } from '../bot/TwitchBot';
import { ViewerManager } from '../features/ViewerManager';
import { SongRequestManager } from '../features/SongRequestManager';
import { TTSManager } from '../features/TTSManager';
import { Database } from '../utils/Database';
import { createCommands } from '../commands';
import { config, validateConfig } from '../config';

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let bot: TwitchBot | null = null;
let viewerManager: ViewerManager | null = null;
let songManager: SongRequestManager | null = null;
let ttsManager: TTSManager | null = null;
let db: Database | null = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: 'Twitch Chatbot',
    backgroundColor: '#0e0e10',
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
}

function createTray() {
  const iconPath = path.join(__dirname, '../../assets/tray-icon.png');
  const icon = nativeImage.createFromPath(iconPath);
  tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon);

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Öffnen',
      click: () => {
        mainWindow?.show();
      },
    },
    {
      label: 'TTS An/Aus',
      click: () => {
        if (ttsManager) {
          ttsManager.setEnabled(!ttsManager.isEnabled());
          mainWindow?.webContents.send('tts:enabledChanged', ttsManager.isEnabled());
        }
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

  tray.setToolTip('Twitch Chatbot');
  tray.setContextMenu(contextMenu);

  tray.on('double-click', () => {
    mainWindow?.show();
  });
}

async function initializeBot() {
  // Initialize database
  db = new Database('botdata.json');
  await db.init();

  // Initialize managers
  viewerManager = new ViewerManager(db);
  songManager = new SongRequestManager(db);
  ttsManager = new TTSManager();

  // Initialize bot
  bot = new TwitchBot();

  // Register commands
  const commands = createCommands(songManager, ttsManager, viewerManager);
  commands.forEach((cmd) => bot!.registerCommand(cmd));

  // Setup event handlers
  setupBotEvents();
}

function setupBotEvents() {
  if (!bot || !viewerManager || !songManager || !ttsManager) return;

  // Chat messages
  bot.on('message', (message) => {
    viewerManager!.incrementMessageCount(message.username);
    mainWindow?.webContents.send('chat:message', message);
  });

  bot.on('connected', (data) => {
    mainWindow?.webContents.send('bot:connected', data);
  });

  bot.on('disconnected', (reason) => {
    mainWindow?.webContents.send('bot:disconnected', reason);
  });

  bot.on('userJoin', ({ username }) => {
    viewerManager!.userJoined(username);
  });

  bot.on('userPart', ({ username }) => {
    viewerManager!.userLeft(username);
  });

  // Viewer events
  viewerManager.on('viewersUpdated', (viewers) => {
    mainWindow?.webContents.send('viewers:updated', {
      online: viewers,
      count: viewers.length,
    });
  });

  // Song events
  songManager.on('songAdded', (song) => {
    mainWindow?.webContents.send('songs:added', song);
  });

  songManager.on('songStarted', (song) => {
    mainWindow?.webContents.send('songs:started', song);
  });

  songManager.on('songSkipped', (song) => {
    mainWindow?.webContents.send('songs:skipped', song);
  });

  // TTS events
  ttsManager.on('playMessage', (data) => {
    mainWindow?.webContents.send('tts:play', data);
  });

  ttsManager.on('enabledChanged', (enabled) => {
    mainWindow?.webContents.send('tts:enabledChanged', enabled);
  });
}

function setupIPC() {
  // Bot connection
  ipcMain.handle('bot:connect', async (event, credentials) => {
    try {
      if (!bot) {
        await initializeBot();
      }

      // Update config with provided credentials
      if (credentials) {
        config.twitch.botUsername = credentials.username;
        config.twitch.oauthToken = credentials.oauthToken;
        config.twitch.channel = credentials.channel;
        config.twitch.clientId = credentials.clientId || '';
        config.twitch.clientSecret = credentials.clientSecret || '';
      }

      if (!validateConfig()) {
        return { success: false, error: 'Invalid configuration' };
      }

      await bot!.connect();
      viewerManager!.startAutoUpdate(60000);

      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('bot:disconnect', async () => {
    if (bot) {
      viewerManager?.stopAutoUpdate();
      await bot.disconnect();
    }
    return { success: true };
  });

  ipcMain.handle('bot:getStats', () => {
    return bot?.getStats() || null;
  });

  // Viewers
  ipcMain.handle('viewers:getOnline', () => {
    return {
      online: viewerManager?.getOnlineViewers() || [],
      count: viewerManager?.getOnlineViewerCount() || 0,
    };
  });

  ipcMain.handle('viewers:getAll', () => {
    return viewerManager?.getAllViewers() || [];
  });

  ipcMain.handle('viewers:getTop', (event, limit = 10) => {
    return viewerManager?.getTopViewersByPoints(limit) || [];
  });

  // Song requests
  ipcMain.handle('songs:getQueue', () => {
    return {
      queue: songManager?.getQueue() || [],
      current: songManager?.getCurrentSong() || null,
      isPlaying: songManager?.isCurrentlyPlaying() || false,
    };
  });

  ipcMain.handle('songs:skip', async () => {
    return songManager?.skip() || null;
  });

  ipcMain.handle('songs:playNext', async () => {
    return songManager?.playNext() || null;
  });

  ipcMain.handle('songs:remove', (event, index: number) => {
    return songManager?.removeFromQueue(index) || null;
  });

  ipcMain.handle('songs:clear', () => {
    songManager?.clearQueue();
    return { success: true };
  });

  ipcMain.handle('songs:add', async (event, query: string, username: string) => {
    return songManager?.addRequest(query, username) || { success: false, message: 'Not initialized' };
  });

  // TTS
  ipcMain.handle('tts:getQueue', () => {
    return {
      queue: ttsManager?.getQueue() || [],
      current: ttsManager?.getCurrentMessage() || null,
      enabled: ttsManager?.isEnabled() || false,
    };
  });

  ipcMain.handle('tts:toggle', () => {
    if (ttsManager) {
      const newState = !ttsManager.isEnabled();
      ttsManager.setEnabled(newState);
      return newState;
    }
    return false;
  });

  ipcMain.handle('tts:skip', () => {
    return ttsManager?.skip() || null;
  });

  ipcMain.handle('tts:clear', () => {
    ttsManager?.clearQueue();
    return { success: true };
  });

  ipcMain.handle('tts:getAudio', async (event, text: string) => {
    return ttsManager?.getAudioBase64(text) || null;
  });

  ipcMain.handle('tts:add', async (event, username: string, text: string) => {
    return ttsManager?.addMessage(username, text) || { success: false, message: 'Not initialized' };
  });

  ipcMain.on('tts:playbackComplete', () => {
    ttsManager?.notifyPlaybackComplete();
  });

  // Messages
  ipcMain.handle('messages:getRecent', () => {
    return bot?.getRecentMessages() || [];
  });

  // Settings
  ipcMain.handle('settings:get', () => {
    return {
      twitch: {
        botUsername: config.twitch.botUsername,
        channel: config.twitch.channel,
        // Don't send sensitive data
      },
      tts: config.tts,
      songRequest: config.songRequest,
    };
  });

  ipcMain.handle('settings:save', (event, settings) => {
    // Save settings to electron-store or .env
    return { success: true };
  });

  // External links
  ipcMain.on('open:external', (event, url) => {
    shell.openExternal(url);
  });
}

// App lifecycle
app.whenReady().then(async () => {
  createWindow();
  createTray();
  setupIPC();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    // Don't quit on Windows/Linux, minimize to tray
  }
});

app.on('before-quit', async () => {
  if (bot) {
    viewerManager?.stopAutoUpdate();
    await db?.forceSave();
    await bot.disconnect();
  }
});
