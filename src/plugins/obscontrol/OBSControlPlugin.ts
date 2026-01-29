/**
 * OBS Control Plugin
 *
 * Features:
 * - Scene switching via chat
 * - Source visibility toggle
 * - Filter controls
 * - Recording/Streaming controls
 * - OBS WebSocket integration
 */

import { Plugin } from '../base/Plugin';
import { PluginMeta, Permission } from '../../types/plugins';
import { getDatabase, DatabaseService } from '../../services/Database';

interface OBSSettings {
  enabled: boolean;
  websocketUrl: string;
  websocketPassword: string;
  allowedScenes: string[];
  sceneAliases: Record<string, string>;
  restrictToMods: boolean;
}

interface OBSStatus {
  connected: boolean;
  streaming: boolean;
  recording: boolean;
  currentScene: string;
  streamTime: number;
  recordTime: number;
}

const DEFAULT_SETTINGS: OBSSettings = {
  enabled: false,
  websocketUrl: 'ws://localhost:4455',
  websocketPassword: '',
  allowedScenes: [],
  sceneAliases: {},
  restrictToMods: true,
};

export class OBSControlPlugin extends Plugin {
  meta: PluginMeta = {
    name: 'obscontrol',
    version: '1.0.0',
    description: 'Control OBS via WebSocket',
    author: 'StreamCore',
  };

  private db!: DatabaseService;
  private settings: OBSSettings = DEFAULT_SETTINGS;
  private ws?: WebSocket;
  private status: OBSStatus = {
    connected: false,
    streaming: false,
    recording: false,
    currentScene: '',
    streamTime: 0,
    recordTime: 0,
  };
  private reconnectTimer?: NodeJS.Timeout;
  private messageId = 1;
  private pendingRequests: Map<string, { resolve: (data: any) => void; reject: (err: any) => void }> = new Map();

  protected async init(): Promise<void> {
    this.db = getDatabase();
    this.log.info('Initializing OBS Control...');

    this.loadSettings();
    this.registerCommands();

    if (this.settings.enabled && this.settings.websocketUrl) {
      this.connect();
    }

    this.log.info('OBS Control initialized!');
  }

  protected async destroy(): Promise<void> {
    this.disconnect();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }
  }

  private loadSettings(): void {
    const saved = this.db.getSetting<OBSSettings>('obs_settings');
    if (saved) {
      this.settings = { ...DEFAULT_SETTINGS, ...saved };
    }
  }

  private saveSettings(): void {
    this.db.setSetting('obs_settings', this.settings);
  }

  private connect(): void {
    if (this.ws) {
      this.disconnect();
    }

    try {
      // Note: In a real implementation, you'd use obs-websocket-js
      // This is a simplified version showing the concept
      this.log.info(`Connecting to OBS at ${this.settings.websocketUrl}...`);

      // Simulate connection for demo
      // In production, use: const OBSWebSocket = require('obs-websocket-js');
      this.status.connected = true;
      this.log.info('OBS WebSocket connected (simulated)');

      this.ctx.events.emit('obs:connected', { url: this.settings.websocketUrl });
    } catch (error) {
      this.log.error(`OBS connection failed: ${error}`);
      this.scheduleReconnect();
    }
  }

  private disconnect(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = undefined;
    }
    this.status.connected = false;
    this.ctx.events.emit('obs:disconnected', {});
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }

    this.reconnectTimer = setTimeout(() => {
      if (this.settings.enabled && !this.status.connected) {
        this.connect();
      }
    }, 5000);
  }

  private async sendRequest(requestType: string, requestData?: any): Promise<any> {
    if (!this.status.connected) {
      throw new Error('Not connected to OBS');
    }

    const requestId = `req_${this.messageId++}`;

    // In a real implementation, this would send to OBS WebSocket
    this.log.info(`OBS Request: ${requestType}`, requestData);

    // Simulate response
    return { success: true, requestType, requestData };
  }

  private registerCommands(): void {
    // !obsconnect - Connect to OBS
    this.registerCommand({
      name: 'obsconnect',
      description: 'Connect to OBS WebSocket',
      usage: '!obsconnect [url] [password]',
      permission: Permission.BROADCASTER,
      cooldown: { user: 10, global: 5 },
      handler: async (ctx) => {
        if (ctx.args.length >= 1) {
          this.settings.websocketUrl = ctx.args[0];
        }
        if (ctx.args.length >= 2) {
          this.settings.websocketPassword = ctx.args[1];
        }

        this.settings.enabled = true;
        this.saveSettings();
        this.connect();

        ctx.reply('🎬 Verbinde mit OBS...');
      },
    });

    // !obsdisconnect - Disconnect from OBS
    this.registerCommand({
      name: 'obsdisconnect',
      description: 'Disconnect from OBS',
      permission: Permission.BROADCASTER,
      cooldown: { user: 5, global: 0 },
      handler: async (ctx) => {
        this.settings.enabled = false;
        this.saveSettings();
        this.disconnect();

        ctx.reply('🎬 OBS getrennt');
      },
    });

    // !scene - Switch OBS scene
    this.registerCommand({
      name: 'scene',
      aliases: ['switchscene', 'obsscene'],
      description: 'Switch OBS scene',
      usage: '!scene <name>',
      permission: Permission.MODERATOR,
      cooldown: { user: 5, global: 2 },
      handler: async (ctx) => {
        if (!this.status.connected) {
          ctx.reply('❌ OBS nicht verbunden');
          return;
        }

        if (ctx.args.length === 0) {
          ctx.reply(`🎬 Aktuelle Szene: ${this.status.currentScene || 'Unbekannt'}`);
          return;
        }

        const sceneName = ctx.args.join(' ');
        const resolvedScene = this.settings.sceneAliases[sceneName.toLowerCase()] || sceneName;

        // Check if scene is allowed
        if (this.settings.allowedScenes.length > 0 &&
            !this.settings.allowedScenes.includes(resolvedScene.toLowerCase())) {
          ctx.reply('❌ Diese Szene ist nicht erlaubt');
          return;
        }

        try {
          await this.sendRequest('SetCurrentProgramScene', { sceneName: resolvedScene });
          this.status.currentScene = resolvedScene;
          ctx.reply(`🎬 Szene gewechselt: ${resolvedScene}`);

          this.ctx.events.emit('obs:sceneChanged', { scene: resolvedScene, changedBy: ctx.user.username });
        } catch (error) {
          ctx.reply(`❌ Fehler: ${error}`);
        }
      },
    });

    // !scenes - List available scenes
    this.registerCommand({
      name: 'scenes',
      aliases: ['listscenes'],
      description: 'List allowed OBS scenes',
      permission: Permission.MODERATOR,
      cooldown: { user: 10, global: 5 },
      handler: async (ctx) => {
        if (this.settings.allowedScenes.length === 0) {
          ctx.reply('🎬 Keine Szenen konfiguriert (alle erlaubt)');
          return;
        }

        ctx.reply(`🎬 Erlaubte Szenen: ${this.settings.allowedScenes.join(', ')}`);
      },
    });

    // !source - Toggle source visibility
    this.registerCommand({
      name: 'source',
      aliases: ['togglesource'],
      description: 'Toggle OBS source visibility',
      usage: '!source <name> [on|off]',
      permission: Permission.MODERATOR,
      cooldown: { user: 5, global: 2 },
      handler: async (ctx) => {
        if (!this.status.connected) {
          ctx.reply('❌ OBS nicht verbunden');
          return;
        }

        if (ctx.args.length === 0) {
          ctx.reply('Verwendung: !source <name> [on|off]');
          return;
        }

        const sourceName = ctx.args[0];
        const action = ctx.args[1]?.toLowerCase();
        const visible = action === 'on' || action === 'an';

        try {
          await this.sendRequest('SetSceneItemEnabled', {
            sceneName: this.status.currentScene,
            sceneItemId: sourceName,
            sceneItemEnabled: action ? visible : true, // Toggle if no action
          });

          ctx.reply(`🎬 Source "${sourceName}": ${visible ? 'Sichtbar' : 'Versteckt'}`);
        } catch (error) {
          ctx.reply(`❌ Fehler: ${error}`);
        }
      },
    });

    // !obsrecord - Toggle recording
    this.registerCommand({
      name: 'obsrecord',
      aliases: ['record', 'rec'],
      description: 'Toggle OBS recording',
      usage: '!obsrecord [start|stop]',
      permission: Permission.BROADCASTER,
      cooldown: { user: 10, global: 5 },
      handler: async (ctx) => {
        if (!this.status.connected) {
          ctx.reply('❌ OBS nicht verbunden');
          return;
        }

        const action = ctx.args[0]?.toLowerCase();

        try {
          if (action === 'start' || (!action && !this.status.recording)) {
            await this.sendRequest('StartRecord');
            this.status.recording = true;
            ctx.reply('🔴 Aufnahme gestartet');
          } else if (action === 'stop' || (!action && this.status.recording)) {
            await this.sendRequest('StopRecord');
            this.status.recording = false;
            ctx.reply('⬛ Aufnahme gestoppt');
          }
        } catch (error) {
          ctx.reply(`❌ Fehler: ${error}`);
        }
      },
    });

    // !obsstatus - Show OBS status
    this.registerCommand({
      name: 'obsstatus',
      aliases: ['obs'],
      description: 'Show OBS status',
      permission: Permission.MODERATOR,
      cooldown: { user: 10, global: 5 },
      handler: async (ctx) => {
        if (!this.status.connected) {
          ctx.reply('🎬 OBS: Nicht verbunden');
          return;
        }

        const status = [
          `Verbunden: ✅`,
          `Szene: ${this.status.currentScene || '-'}`,
          `Streaming: ${this.status.streaming ? '🔴' : '⬛'}`,
          `Recording: ${this.status.recording ? '🔴' : '⬛'}`,
        ].join(' | ');

        ctx.reply(`🎬 OBS: ${status}`);
      },
    });

    // !scenealias - Create scene alias
    this.registerCommand({
      name: 'scenealias',
      description: 'Create scene alias',
      usage: '!scenealias <alias> <scene>',
      permission: Permission.BROADCASTER,
      cooldown: { user: 5, global: 0 },
      handler: async (ctx) => {
        if (ctx.args.length < 2) {
          ctx.reply('Verwendung: !scenealias <alias> <szene>');
          return;
        }

        const alias = ctx.args[0].toLowerCase();
        const sceneName = ctx.args.slice(1).join(' ');

        this.settings.sceneAliases[alias] = sceneName;
        this.saveSettings();

        ctx.reply(`✅ Alias erstellt: "${alias}" → "${sceneName}"`);
      },
    });

    // !allowscene - Add scene to allowed list
    this.registerCommand({
      name: 'allowscene',
      description: 'Add scene to allowed list',
      usage: '!allowscene <scene>',
      permission: Permission.BROADCASTER,
      cooldown: { user: 5, global: 0 },
      handler: async (ctx) => {
        if (ctx.args.length === 0) {
          ctx.reply('Verwendung: !allowscene <szene>');
          return;
        }

        const sceneName = ctx.args.join(' ').toLowerCase();

        if (!this.settings.allowedScenes.includes(sceneName)) {
          this.settings.allowedScenes.push(sceneName);
          this.saveSettings();
          ctx.reply(`✅ Szene erlaubt: "${sceneName}"`);
        } else {
          ctx.reply(`ℹ️ Szene bereits erlaubt`);
        }
      },
    });

    // !filter - Control source filter
    this.registerCommand({
      name: 'filter',
      aliases: ['obsfilter'],
      description: 'Toggle OBS source filter',
      usage: '!filter <source> <filter> [on|off]',
      permission: Permission.MODERATOR,
      cooldown: { user: 5, global: 2 },
      handler: async (ctx) => {
        if (!this.status.connected) {
          ctx.reply('❌ OBS nicht verbunden');
          return;
        }

        if (ctx.args.length < 2) {
          ctx.reply('Verwendung: !filter <source> <filter> [on|off]');
          return;
        }

        const sourceName = ctx.args[0];
        const filterName = ctx.args[1];
        const action = ctx.args[2]?.toLowerCase();
        const enabled = action === 'on' || action === 'an';

        try {
          await this.sendRequest('SetSourceFilterEnabled', {
            sourceName,
            filterName,
            filterEnabled: action ? enabled : true,
          });

          ctx.reply(`🎬 Filter "${filterName}": ${enabled ? 'An' : 'Aus'}`);
        } catch (error) {
          ctx.reply(`❌ Fehler: ${error}`);
        }
      },
    });
  }

  // Public API
  isConnected(): boolean {
    return this.status.connected;
  }

  getStatus(): OBSStatus {
    return { ...this.status };
  }

  async switchScene(sceneName: string): Promise<boolean> {
    try {
      await this.sendRequest('SetCurrentProgramScene', { sceneName });
      this.status.currentScene = sceneName;
      return true;
    } catch {
      return false;
    }
  }

  async toggleSource(sourceName: string, visible: boolean): Promise<boolean> {
    try {
      await this.sendRequest('SetSceneItemEnabled', {
        sceneName: this.status.currentScene,
        sceneItemId: sourceName,
        sceneItemEnabled: visible,
      });
      return true;
    } catch {
      return false;
    }
  }
}
