import { contextBridge, ipcRenderer } from 'electron';

// Expose protected methods to the renderer process
contextBridge.exposeInMainWorld('api', {
  // Bot
  bot: {
    connect: (credentials: any) => ipcRenderer.invoke('bot:connect', credentials),
    disconnect: () => ipcRenderer.invoke('bot:disconnect'),
    getStats: () => ipcRenderer.invoke('bot:getStats'),
  },

  // Viewers
  viewers: {
    getOnline: () => ipcRenderer.invoke('viewers:getOnline'),
    getAll: () => ipcRenderer.invoke('viewers:getAll'),
    getTop: (limit?: number) => ipcRenderer.invoke('viewers:getTop', limit),
  },

  // Songs
  songs: {
    getQueue: () => ipcRenderer.invoke('songs:getQueue'),
    skip: () => ipcRenderer.invoke('songs:skip'),
    playNext: () => ipcRenderer.invoke('songs:playNext'),
    remove: (index: number) => ipcRenderer.invoke('songs:remove', index),
    clear: () => ipcRenderer.invoke('songs:clear'),
    add: (query: string, username: string) => ipcRenderer.invoke('songs:add', query, username),
  },

  // TTS
  tts: {
    getQueue: () => ipcRenderer.invoke('tts:getQueue'),
    toggle: () => ipcRenderer.invoke('tts:toggle'),
    skip: () => ipcRenderer.invoke('tts:skip'),
    clear: () => ipcRenderer.invoke('tts:clear'),
    getAudio: (text: string) => ipcRenderer.invoke('tts:getAudio', text),
    add: (username: string, text: string) => ipcRenderer.invoke('tts:add', username, text),
    playbackComplete: () => ipcRenderer.send('tts:playbackComplete'),
  },

  // Messages
  messages: {
    getRecent: () => ipcRenderer.invoke('messages:getRecent'),
  },

  // Settings
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    save: (settings: any) => ipcRenderer.invoke('settings:save', settings),
  },

  // Events
  on: (channel: string, callback: (...args: any[]) => void) => {
    const allowedChannels = [
      'chat:message',
      'bot:connected',
      'bot:disconnected',
      'viewers:updated',
      'songs:added',
      'songs:started',
      'songs:skipped',
      'tts:play',
      'tts:enabledChanged',
    ];

    if (allowedChannels.includes(channel)) {
      const subscription = (_event: any, ...args: any[]) => callback(...args);
      ipcRenderer.on(channel, subscription);
      return () => ipcRenderer.removeListener(channel, subscription);
    }
    return () => {};
  },

  // External
  openExternal: (url: string) => ipcRenderer.send('open:external', url),
});
