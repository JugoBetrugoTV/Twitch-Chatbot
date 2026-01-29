/**
 * Plugin Engine
 *
 * Manages plugin lifecycle and provides plugin context.
 * Plugins can:
 * - Register commands
 * - Subscribe to events
 * - Store persistent data
 * - Access services
 */

import { EventBus } from './EventBus';
import {
  IPlugin,
  PluginContext,
  PluginConfig,
  PluginLogger,
  PluginDatabase,
  Command,
  CommandContext,
  Permission,
} from '../types/plugins';
import { EventName, EventMap, ChatUser, ChatCommandEvent } from '../types/events';
import { Logger } from '../utils/logger';
import { PlatformAdapter } from '../platforms/base/PlatformAdapter';

interface LoadedPlugin {
  instance: IPlugin;
  config: PluginConfig;
  commands: Map<string, Command>;
  enabled: boolean;
}

interface CooldownEntry {
  lastUsed: Map<string, number>; // username -> timestamp
  globalLastUsed: number;
}

export class PluginEngine {
  private plugins: Map<string, LoadedPlugin> = new Map();
  private eventBus: EventBus;
  private platforms: Map<string, PlatformAdapter> = new Map();
  private logger = new Logger('PluginEngine');
  private commandCooldowns: Map<string, CooldownEntry> = new Map();

  // In-memory plugin data store (could be replaced with SQLite)
  private pluginData: Map<string, Record<string, any>> = new Map();

  constructor(eventBus: EventBus) {
    this.eventBus = eventBus;
    this.setupCommandHandler();
  }

  /**
   * Register a platform adapter
   */
  registerPlatform(adapter: PlatformAdapter): void {
    this.platforms.set(adapter.platform, adapter);
    this.logger.info(`Platform registered: ${adapter.name}`);
  }

  /**
   * Load and initialize a plugin
   */
  async loadPlugin(plugin: IPlugin, config: PluginConfig = { enabled: true }): Promise<void> {
    const name = plugin.meta.name;

    if (this.plugins.has(name)) {
      this.logger.warn(`Plugin ${name} is already loaded`);
      return;
    }

    const context = this.createPluginContext(name, config);

    try {
      await plugin.onLoad(context);

      const loadedPlugin: LoadedPlugin = {
        instance: plugin,
        config,
        commands: new Map(),
        enabled: config.enabled,
      };

      // Register commands from plugin
      if (plugin.getCommands) {
        for (const cmd of plugin.getCommands()) {
          this.registerCommand(name, cmd);
          loadedPlugin.commands.set(cmd.name, cmd);
        }
      }

      this.plugins.set(name, loadedPlugin);
      this.logger.info(`Plugin loaded: ${name} v${plugin.meta.version}`);

      this.eventBus.emit('plugin:loaded', {
        type: 'plugin:loaded',
        platform: 'system',
        pluginName: name,
      });
    } catch (error) {
      this.logger.error(`Failed to load plugin ${name}:`, error);

      this.eventBus.emit('plugin:error', {
        type: 'plugin:error',
        platform: 'system',
        pluginName: name,
        error: error instanceof Error ? error : new Error(String(error)),
      });
    }
  }

  /**
   * Unload a plugin
   */
  async unloadPlugin(name: string): Promise<void> {
    const plugin = this.plugins.get(name);
    if (!plugin) {
      this.logger.warn(`Plugin ${name} is not loaded`);
      return;
    }

    try {
      await plugin.instance.onUnload();

      // Unregister commands
      for (const [cmdName] of plugin.commands) {
        this.unregisterCommand(cmdName);
      }

      this.plugins.delete(name);
      this.logger.info(`Plugin unloaded: ${name}`);
    } catch (error) {
      this.logger.error(`Failed to unload plugin ${name}:`, error);
    }
  }

  /**
   * Enable/disable a plugin
   */
  setPluginEnabled(name: string, enabled: boolean): void {
    const plugin = this.plugins.get(name);
    if (plugin) {
      plugin.enabled = enabled;
      plugin.config.enabled = enabled;
      this.logger.info(`Plugin ${name} ${enabled ? 'enabled' : 'disabled'}`);
    }
  }

  /**
   * Register a command
   */
  registerCommand(pluginName: string, command: Command): void {
    const plugin = this.plugins.get(pluginName);
    if (plugin) {
      plugin.commands.set(command.name, command);

      // Register aliases
      if (command.aliases) {
        for (const alias of command.aliases) {
          plugin.commands.set(alias, { ...command, name: alias });
        }
      }

      this.logger.debug(`Command registered: !${command.name} (${pluginName})`);
    }
  }

  /**
   * Unregister a command
   */
  unregisterCommand(name: string): void {
    for (const [, plugin] of this.plugins) {
      if (plugin.commands.has(name)) {
        plugin.commands.delete(name);
        this.logger.debug(`Command unregistered: !${name}`);
        return;
      }
    }
  }

  /**
   * Setup command handler
   */
  private setupCommandHandler(): void {
    this.eventBus.on('chat:command', async (event: ChatCommandEvent) => {
      await this.handleCommand(event);
    });
  }

  /**
   * Handle incoming command
   */
  private async handleCommand(event: ChatCommandEvent): Promise<void> {
    const { command: cmdName, args, user, channel, rawMessage } = event;

    // Find the command
    let command: Command | null = null;
    let ownerPlugin: LoadedPlugin | null = null;

    for (const [, plugin] of this.plugins) {
      if (!plugin.enabled) continue;

      const cmd = plugin.commands.get(cmdName);
      if (cmd && cmd.enabled) {
        command = cmd;
        ownerPlugin = plugin;
        break;
      }
    }

    if (!command || !ownerPlugin) {
      return; // Unknown command, ignore
    }

    // Check permissions
    const platform = this.platforms.get(event.platform);
    if (platform && !platform.hasPermission(user, command.permission)) {
      this.logger.debug(`Permission denied for !${cmdName} (${user.username})`);
      return;
    }

    // Check cooldowns
    if (!this.checkCooldown(cmdName, user.username, command.cooldown)) {
      this.logger.debug(`Cooldown active for !${cmdName} (${user.username})`);
      return;
    }

    // Execute command
    const context: CommandContext = {
      command: cmdName,
      args,
      rawMessage,
      user,
      channel,
      reply: (message: string) => {
        const adapter = this.platforms.get(event.platform);
        if (adapter) {
          adapter.sendMessage(channel, message);
        }
      },
      data: {},
    };

    try {
      await command.handler(context);
      this.logger.debug(`Command executed: !${cmdName} by ${user.username}`);
    } catch (error) {
      this.logger.error(`Command error (!${cmdName}):`, error);
    }
  }

  /**
   * Check and update cooldowns
   */
  private checkCooldown(
    command: string,
    username: string,
    cooldown: { user: number; global: number }
  ): boolean {
    const now = Date.now();

    if (!this.commandCooldowns.has(command)) {
      this.commandCooldowns.set(command, {
        lastUsed: new Map(),
        globalLastUsed: 0,
      });
    }

    const entry = this.commandCooldowns.get(command)!;

    // Check global cooldown
    if (cooldown.global > 0) {
      if (now - entry.globalLastUsed < cooldown.global * 1000) {
        return false;
      }
    }

    // Check user cooldown
    if (cooldown.user > 0) {
      const userLastUsed = entry.lastUsed.get(username) || 0;
      if (now - userLastUsed < cooldown.user * 1000) {
        return false;
      }
    }

    // Update cooldowns
    entry.globalLastUsed = now;
    entry.lastUsed.set(username, now);

    return true;
  }

  /**
   * Create plugin context
   */
  private createPluginContext(name: string, config: PluginConfig): PluginContext {
    const sendMessage = (channel: string, message: string) => {
      for (const [, platform] of this.platforms) {
        if (platform.isConnected()) {
          platform.sendMessage(channel, message);
        }
      }
    };

    // Get default channel from first platform
    const getDefaultChannel = (): string => {
      for (const [, platform] of this.platforms) {
        if (platform.isConnected()) {
          return (platform as any).channels?.[0] || '';
        }
      }
      return process.env.TWITCH_CHANNEL || '';
    };

    return {
      config,
      logger: this.createPluginLogger(name),
      db: this.createPluginDatabase(name),
      emit: (eventName: EventName, data: any) => {
        this.eventBus.emit(eventName, data);
      },
      sendMessage,
      events: {
        on: (event: string, handler: (data: any) => void) => {
          this.eventBus.on(event as EventName, handler);
        },
        off: (event: string, handler: (data: any) => void) => {
          this.eventBus.off(event as EventName, handler);
        },
        emit: (event: string, data: any) => {
          this.eventBus.emit(event as EventName, data);
        },
      },
      chat: {
        send: (message: string, channel?: string) => {
          const targetChannel = channel || getDefaultChannel();
          sendMessage(targetChannel, message);
        },
      },
    };
  }

  /**
   * Create plugin logger
   */
  private createPluginLogger(name: string): PluginLogger {
    const logger = new Logger(`Plugin:${name}`);
    return {
      info: (msg, ...args) => logger.info(msg, ...args),
      warn: (msg, ...args) => logger.warn(msg, ...args),
      error: (msg, ...args) => logger.error(msg, ...args),
      debug: (msg, ...args) => logger.debug(msg, ...args),
    };
  }

  /**
   * Create plugin database (simple key-value store)
   */
  private createPluginDatabase(name: string): PluginDatabase {
    if (!this.pluginData.has(name)) {
      this.pluginData.set(name, {});
    }

    const data = this.pluginData.get(name)!;

    return {
      get: <T>(key: string) => data[key] as T | undefined,
      set: <T>(key: string, value: T) => {
        data[key] = value;
      },
      delete: (key: string) => {
        delete data[key];
      },
      getAll: () => ({ ...data }),
    };
  }

  /**
   * Get all loaded plugins
   */
  getPlugins(): { name: string; version: string; enabled: boolean }[] {
    return Array.from(this.plugins.entries()).map(([name, plugin]) => ({
      name,
      version: plugin.instance.meta.version,
      enabled: plugin.enabled,
    }));
  }

  /**
   * Get all registered commands
   */
  getCommands(): Command[] {
    const commands: Command[] = [];
    for (const [, plugin] of this.plugins) {
      if (plugin.enabled) {
        commands.push(...plugin.commands.values());
      }
    }
    return commands;
  }
}
