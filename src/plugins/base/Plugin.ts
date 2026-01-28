/**
 * Base Plugin Class
 *
 * All plugins should extend this class for consistency.
 * Provides helper methods and lifecycle management.
 */

import {
  IPlugin,
  PluginMeta,
  PluginContext,
  Command,
  Timer,
  Permission,
  CommandHandler,
} from '../../types/plugins';
import { EventName, EventMap, StreamCoreEvent } from '../../types/events';

type EventHandler<T> = (event: T) => void | Promise<void>;

export abstract class Plugin implements IPlugin {
  abstract meta: PluginMeta;

  protected ctx!: PluginContext;
  private eventHandlers: Array<{ event: EventName; handler: EventHandler<any> }> = [];
  private commands: Command[] = [];
  private timers: Timer[] = [];

  /**
   * Called when plugin is loaded
   * Override this to initialize your plugin
   */
  async onLoad(ctx: PluginContext): Promise<void> {
    this.ctx = ctx;
    await this.init();
  }

  /**
   * Called when plugin is unloaded
   * Override this to cleanup resources
   */
  async onUnload(): Promise<void> {
    await this.destroy();
  }

  /**
   * Initialize the plugin (override this)
   */
  protected async init(): Promise<void> {}

  /**
   * Cleanup the plugin (override this)
   */
  protected async destroy(): Promise<void> {}

  /**
   * Get commands registered by this plugin
   */
  getCommands(): Command[] {
    return this.commands;
  }

  /**
   * Get timers registered by this plugin
   */
  getTimers(): Timer[] {
    return this.timers;
  }

  // ==========================================
  // Helper Methods
  // ==========================================

  /**
   * Subscribe to an event
   */
  protected on<K extends EventName>(
    event: K,
    handler: EventHandler<EventMap[K]>
  ): void {
    this.eventHandlers.push({ event, handler });
  }

  /**
   * Register a command
   */
  protected registerCommand(options: {
    name: string;
    aliases?: string[];
    description?: string;
    usage?: string;
    permission?: Permission;
    cooldown?: { user?: number; global?: number };
    handler: CommandHandler;
  }): void {
    const command: Command = {
      name: options.name,
      aliases: options.aliases || [],
      description: options.description,
      usage: options.usage,
      permission: options.permission ?? Permission.EVERYONE,
      cooldown: {
        user: options.cooldown?.user ?? 5,
        global: options.cooldown?.global ?? 0,
      },
      enabled: true,
      handler: options.handler,
    };

    this.commands.push(command);
    this.ctx?.logger.debug(`Command registered: !${command.name}`);
  }

  /**
   * Register a timer
   */
  protected registerTimer(options: {
    name: string;
    messages: string[];
    intervalMinutes: number;
    minChatMessages?: number;
  }): void {
    const timer: Timer = {
      id: `${this.meta.name}:${options.name}`,
      name: options.name,
      messages: options.messages,
      intervalMinutes: options.intervalMinutes,
      minChatMessages: options.minChatMessages ?? 0,
      enabled: true,
    };

    this.timers.push(timer);
    this.ctx?.logger.debug(`Timer registered: ${timer.name}`);
  }

  /**
   * Emit an event
   */
  protected emit<K extends EventName>(event: K, data: any): void {
    this.ctx?.emit(event, data);
  }

  /**
   * Send a chat message
   */
  protected sendMessage(channel: string, message: string): void {
    this.ctx?.sendMessage(channel, message);
  }

  /**
   * Get data from plugin storage
   */
  protected getData<T>(key: string): T | undefined {
    return this.ctx?.db.get<T>(key);
  }

  /**
   * Set data in plugin storage
   */
  protected setData<T>(key: string, value: T): void {
    this.ctx?.db.set(key, value);
  }

  /**
   * Delete data from plugin storage
   */
  protected deleteData(key: string): void {
    this.ctx?.db.delete(key);
  }

  /**
   * Log helper
   */
  protected get log() {
    return this.ctx?.logger ?? console;
  }
}
