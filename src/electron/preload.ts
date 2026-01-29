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
    }) => ipcRenderer.invoke('bot:connect', credentials),
    disconnect: () => ipcRenderer.invoke('bot:disconnect'),
    getStatus: () => ipcRenderer.invoke('bot:getStatus'),
    getStats: () => ipcRenderer.invoke('bot:getStats'),
  },

  // Database
  db: {
    getUsers: (limit?: number) => ipcRenderer.invoke('db:getUsers', limit),
    getCommands: () => ipcRenderer.invoke('db:getCommands'),
    getSettings: () => ipcRenderer.invoke('db:getSettings'),
    setSetting: (key: string, value: any) => ipcRenderer.invoke('db:setSetting', key, value),
  },

  // Settings
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
  },

  // Events
  on: (channel: string, callback: (...args: any[]) => void) => {
    const allowedChannels = [
      'chat:message',
      'bot:status',
      'bot:connected',
      'bot:disconnected',
      'bot:error',
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
