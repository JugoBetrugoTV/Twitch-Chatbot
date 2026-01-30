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
    getGeneral: () => ipcRenderer.invoke('settings:getGeneral'),
    saveGeneral: (settings: any) => ipcRenderer.invoke('settings:saveGeneral', settings),
    getLocalization: () => ipcRenderer.invoke('settings:getLocalization'),
    saveLocalization: (settings: any) => ipcRenderer.invoke('settings:saveLocalization', settings),
    getUsageStats: () => ipcRenderer.invoke('settings:getUsageStats'),
    getMacros: () => ipcRenderer.invoke('settings:getMacros'),
    addMacro: (data: { name: string; commands: string[] }) => ipcRenderer.invoke('settings:addMacro', data),
    deleteMacro: (id: string) => ipcRenderer.invoke('settings:deleteMacro', id),
    getHotkeys: () => ipcRenderer.invoke('settings:getHotkeys'),
    addHotkey: (data: { action: string; keys: string }) => ipcRenderer.invoke('settings:addHotkey', data),
    deleteHotkey: (id: string) => ipcRenderer.invoke('settings:deleteHotkey', id),
    getStyle: () => ipcRenderer.invoke('settings:getStyle'),
    saveStyle: (settings: any) => ipcRenderer.invoke('settings:saveStyle', settings),
    getChangelog: () => ipcRenderer.invoke('settings:getChangelog'),
  },

  // Quotes
  quotes: {
    getAll: () => ipcRenderer.invoke('quotes:getAll'),
    add: (text: string, author: string, addedBy: string) => ipcRenderer.invoke('quotes:add', text, author, addedBy),
    delete: (id: number) => ipcRenderer.invoke('quotes:delete', id),
  },

  // Polls
  polls: {
    getAll: () => ipcRenderer.invoke('polls:getAll'),
    create: (title: string, options: string[], duration: number) => ipcRenderer.invoke('polls:create', title, options, duration),
    end: (id: string) => ipcRenderer.invoke('polls:end', id),
  },

  // Counters
  counters: {
    getAll: () => ipcRenderer.invoke('counters:getAll'),
    create: (data: { name: string; value?: number }) => ipcRenderer.invoke('counters:create', data),
    increment: (id: string) => ipcRenderer.invoke('counters:increment', id),
    decrement: (id: string) => ipcRenderer.invoke('counters:decrement', id),
    reset: (id: string) => ipcRenderer.invoke('counters:reset', id),
    delete: (id: string) => ipcRenderer.invoke('counters:delete', id),
  },

  // Sounds
  sounds: {
    getAll: () => ipcRenderer.invoke('sounds:getAll'),
    add: (data: { name: string; command: string; path: string; volume?: number }) => ipcRenderer.invoke('sounds:add', data),
    delete: (id: string) => ipcRenderer.invoke('sounds:delete', id),
    play: (id: string) => ipcRenderer.invoke('sounds:play', id),
    selectFile: () => ipcRenderer.invoke('sounds:selectFile'),
  },

  // Queue
  queue: {
    getAll: () => ipcRenderer.invoke('queue:getAll'),
    add: (username: string, message?: string) => ipcRenderer.invoke('queue:add', username, message),
    process: (id: number) => ipcRenderer.invoke('queue:process', id),
    remove: (id: number) => ipcRenderer.invoke('queue:remove', id),
    clear: () => ipcRenderer.invoke('queue:clear'),
  },

  // Currency
  currency: {
    getSettings: () => ipcRenderer.invoke('currency:getSettings'),
    saveSettings: (settings: any) => ipcRenderer.invoke('currency:saveSettings', settings),
    getLeaderboard: (limit?: number) => ipcRenderer.invoke('currency:getLeaderboard', limit),
  },

  // Minigames
  minigames: {
    getSettings: () => ipcRenderer.invoke('minigames:getSettings'),
    saveSettings: (settings: any) => ipcRenderer.invoke('minigames:saveSettings', settings),
  },

  // Betting
  betting: {
    getActive: () => ipcRenderer.invoke('betting:getActive'),
    getHistory: () => ipcRenderer.invoke('betting:getHistory'),
    create: (data: { title: string; options: string[] }) => ipcRenderer.invoke('betting:create', data),
    close: (winner: string) => ipcRenderer.invoke('betting:close', winner),
    cancel: () => ipcRenderer.invoke('betting:cancel'),
  },

  // Events
  events: {
    getAll: (filter?: string) => ipcRenderer.invoke('events:getAll', filter),
  },

  // Mod Tools
  modtools: {
    getSettings: () => ipcRenderer.invoke('modtools:getSettings'),
    saveSettings: (settings: any) => ipcRenderer.invoke('modtools:saveSettings', settings),
    getLogs: () => ipcRenderer.invoke('modtools:getLogs'),
  },

  // Notifications
  notifications: {
    getSettings: () => ipcRenderer.invoke('notifications:getSettings'),
    saveSettings: (settings: any) => ipcRenderer.invoke('notifications:saveSettings', settings),
  },

  // Discord
  discord: {
    getSettings: () => ipcRenderer.invoke('discord:getSettings'),
    saveSettings: (settings: any) => ipcRenderer.invoke('discord:saveSettings', settings),
    testWebhook: () => ipcRenderer.invoke('discord:testWebhook'),
  },

  // Subscribers
  subscribers: {
    getAll: () => ipcRenderer.invoke('subscribers:getAll'),
  },

  // Extra Quotes
  extraquotes: {
    getAll: () => ipcRenderer.invoke('extraquotes:getAll'),
    add: (data: { text: string; author?: string; category?: string }) => ipcRenderer.invoke('extraquotes:add', data),
    delete: (id: number) => ipcRenderer.invoke('extraquotes:delete', id),
  },

  // Analytics
  analytics: {
    getData: (range?: number) => ipcRenderer.invoke('analytics:getData', range),
    export: () => ipcRenderer.invoke('analytics:export'),
  },

  // Users (extended)
  users: {
    getAll: () => ipcRenderer.invoke('viewers:getAll'),
    update: (username: string, updates: any) => ipcRenderer.invoke('users:update', username, updates),
    delete: (username: string) => ipcRenderer.invoke('users:delete', username),
  },

  // Integrations
  integrations: {
    getSettings: () => ipcRenderer.invoke('integrations:getSettings'),
    saveSettings: (settings: any) => ipcRenderer.invoke('integrations:saveSettings', settings),
    testOBS: () => ipcRenderer.invoke('integrations:testOBS'),
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
      'sounds:play',
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
      'counter:updated',
      'poll:updated',
      'betting:updated',
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
