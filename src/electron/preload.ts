import { contextBridge, ipcRenderer } from 'electron';

// Expose protected methods to the renderer process
contextBridge.exposeInMainWorld('api', {
  // Window controls
  window: {
    minimize: () => ipcRenderer.send('window:minimize'),
    maximize: () => ipcRenderer.send('window:maximize'),
    close: () => ipcRenderer.send('window:close'),
  },

  // Bot
  bot: {
    connect: (credentials?: {
      username: string;
      oauthToken: string;
      channel: string;
      clientId?: string;
      clientSecret?: string;
    }) => ipcRenderer.invoke('bot:connect', credentials),
    disconnect: () => ipcRenderer.invoke('bot:disconnect'),
    getStatus: () => ipcRenderer.invoke('bot:getStatus'),
    getStats: () => ipcRenderer.invoke('bot:getStats'),
    sendMessage: (message: string) => ipcRenderer.invoke('bot:sendMessage', message),
  },

  // Viewers/Users
  viewers: {
    getOnline: () => ipcRenderer.invoke('viewers:getOnline'),
    getAll: () => ipcRenderer.invoke('viewers:getAll'),
    getTop: (limit?: number) => ipcRenderer.invoke('viewers:getTop', limit),
    getUser: (username: string) => ipcRenderer.invoke('viewers:getUser', username),
    updatePoints: (username: string, points: number) => ipcRenderer.invoke('viewers:updatePoints', username, points),
  },

  // Commands
  commands: {
    getAll: () => ipcRenderer.invoke('commands:getAll'),
    add: (name: string, response: string, options?: any) => ipcRenderer.invoke('commands:add', name, response, options),
    update: (name: string, updates: any) => ipcRenderer.invoke('commands:update', name, updates),
    delete: (name: string) => ipcRenderer.invoke('commands:delete', name),
    toggle: (name: string) => ipcRenderer.invoke('commands:toggle', name),
  },

  // Timers
  timers: {
    getAll: () => ipcRenderer.invoke('timers:getAll'),
    add: (name: string, messages: string[], interval: number) => ipcRenderer.invoke('timers:add', name, messages, interval),
    update: (id: string, updates: any) => ipcRenderer.invoke('timers:update', id, updates),
    delete: (id: string) => ipcRenderer.invoke('timers:delete', id),
    toggle: (id: string) => ipcRenderer.invoke('timers:toggle', id),
  },

  // Song Request
  songs: {
    getQueue: () => ipcRenderer.invoke('songs:getQueue'),
    getCurrent: () => ipcRenderer.invoke('songs:getCurrent'),
    add: (query: string, username: string) => ipcRenderer.invoke('songs:add', query, username),
    skip: () => ipcRenderer.invoke('songs:skip'),
    remove: (index: number) => ipcRenderer.invoke('songs:remove', index),
    clear: () => ipcRenderer.invoke('songs:clear'),
    setVolume: (volume: number) => ipcRenderer.invoke('songs:setVolume', volume),
    toggle: () => ipcRenderer.invoke('songs:toggle'),
  },

  // TTS
  tts: {
    getQueue: () => ipcRenderer.invoke('tts:getQueue'),
    toggle: () => ipcRenderer.invoke('tts:toggle'),
    skip: () => ipcRenderer.invoke('tts:skip'),
    clear: () => ipcRenderer.invoke('tts:clear'),
    setVolume: (volume: number) => ipcRenderer.invoke('tts:setVolume', volume),
    setVoice: (voice: string) => ipcRenderer.invoke('tts:setVoice', voice),
    add: (username: string, message: string) => ipcRenderer.invoke('tts:add', username, message),
    playbackComplete: () => ipcRenderer.send('tts:playbackComplete'),
    getSettings: () => ipcRenderer.invoke('tts:getSettings'),
    updateSettings: (settings: any) => ipcRenderer.invoke('tts:updateSettings', settings),
  },

  // Giveaway
  giveaway: {
    getStatus: () => ipcRenderer.invoke('giveaway:getStatus'),
    start: (prize: string, duration?: number) => ipcRenderer.invoke('giveaway:start', prize, duration),
    end: () => ipcRenderer.invoke('giveaway:end'),
    draw: () => ipcRenderer.invoke('giveaway:draw'),
    getEntries: () => ipcRenderer.invoke('giveaway:getEntries'),
  },

  // Loyalty/Points
  loyalty: {
    getSettings: () => ipcRenderer.invoke('loyalty:getSettings'),
    updateSettings: (settings: any) => ipcRenderer.invoke('loyalty:updateSettings', settings),
    getLeaderboard: (limit?: number) => ipcRenderer.invoke('loyalty:getLeaderboard', limit),
    addPoints: (username: string, amount: number) => ipcRenderer.invoke('loyalty:addPoints', username, amount),
    removePoints: (username: string, amount: number) => ipcRenderer.invoke('loyalty:removePoints', username, amount),
    setPoints: (username: string, amount: number) => ipcRenderer.invoke('loyalty:setPoints', username, amount),
  },

  // Moderation
  moderation: {
    getSettings: () => ipcRenderer.invoke('moderation:getSettings'),
    updateSettings: (settings: any) => ipcRenderer.invoke('moderation:updateSettings', settings),
    getBlacklist: () => ipcRenderer.invoke('moderation:getBlacklist'),
    addBlacklist: (word: string, type?: string) => ipcRenderer.invoke('moderation:addBlacklist', word, type),
    removeBlacklist: (word: string) => ipcRenderer.invoke('moderation:removeBlacklist', word),
    timeout: (username: string, duration: number, reason?: string) => ipcRenderer.invoke('moderation:timeout', username, duration, reason),
    ban: (username: string, reason?: string) => ipcRenderer.invoke('moderation:ban', username, reason),
    unban: (username: string) => ipcRenderer.invoke('moderation:unban', username),
  },

  // Alerts
  alerts: {
    getSettings: () => ipcRenderer.invoke('alerts:getSettings'),
    updateSettings: (settings: any) => ipcRenderer.invoke('alerts:updateSettings', settings),
    test: (type: string) => ipcRenderer.invoke('alerts:test', type),
  },

  // Database
  db: {
    getUsers: (limit?: number) => ipcRenderer.invoke('db:getUsers', limit),
    getCommands: () => ipcRenderer.invoke('db:getCommands'),
    getSettings: () => ipcRenderer.invoke('db:getSettings'),
    setSetting: (key: string, value: any) => ipcRenderer.invoke('db:setSetting', key, value),
    getTimers: () => ipcRenderer.invoke('db:getTimers'),
  },

  // Settings
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    save: (settings: any) => ipcRenderer.invoke('settings:save', settings),
    getCredentials: () => ipcRenderer.invoke('settings:getCredentials'),
    saveCredentials: (credentials: any) => ipcRenderer.invoke('settings:saveCredentials', credentials),
  },

  // Messages/Chat
  messages: {
    getRecent: (limit?: number) => ipcRenderer.invoke('messages:getRecent', limit),
    send: (message: string) => ipcRenderer.invoke('messages:send', message),
  },

  // Events - listen for events from main process
  on: (channel: string, callback: (...args: any[]) => void) => {
    const allowedChannels = [
      'chat:message',
      'chat:command',
      'bot:status',
      'bot:connected',
      'bot:disconnected',
      'bot:error',
      'bot:ready',
      'viewers:updated',
      'songs:added',
      'songs:started',
      'songs:skipped',
      'songs:ended',
      'songs:queueUpdated',
      'tts:play',
      'tts:started',
      'tts:ended',
      'tts:queueUpdated',
      'tts:enabledChanged',
      'giveaway:started',
      'giveaway:ended',
      'giveaway:winner',
      'giveaway:entry',
      'twitch:follow',
      'twitch:subscription',
      'twitch:raid',
      'twitch:cheer',
      'alert:show',
      'points:updated',
      'user:joined',
      'user:left',
    ];

    if (allowedChannels.includes(channel)) {
      const subscription = (_event: any, ...args: any[]) => callback(...args);
      ipcRenderer.on(channel, subscription);
      return () => ipcRenderer.removeListener(channel, subscription);
    }
    return () => {};
  },

  // Remove listener
  off: (channel: string, callback: (...args: any[]) => void) => {
    ipcRenderer.removeListener(channel, callback);
  },

  // External links
  openExternal: (url: string) => ipcRenderer.send('open:external', url),
});
