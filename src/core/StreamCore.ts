/**
 * StreamCore - Main Application Class
 *
 * The central orchestrator that brings together:
 * - Event Bus
 * - Plugin Engine
 * - Platform Adapters
 * - Services
 */

import { EventBus } from './EventBus';
import { PluginEngine } from './PluginEngine';
import { TwitchAdapter, TwitchConfig } from '../platforms/twitch/TwitchAdapter';
import { IPlugin, StreamerMood, MoodPresets } from '../types/plugins';
import { Logger } from '../utils/logger';

export interface StreamCoreConfig {
  twitch?: TwitchConfig;
  mood?: StreamerMood;
  debug?: boolean;
}

export class StreamCore {
  private eventBus: EventBus;
  private pluginEngine: PluginEngine;
  private twitchAdapter?: TwitchAdapter;
  private logger = new Logger('StreamCore');
  private config: StreamCoreConfig;
  private currentMood: StreamerMood = 'competitive';
  private startTime = Date.now();

  constructor(config: StreamCoreConfig) {
    this.config = config;
    this.currentMood = config.mood || 'competitive';

    // Configure logger
    if (config.debug) {
      Logger.configure({ minLevel: 'debug' });
    } else {
      Logger.configure({ minLevel: 'info' });
    }

    // Initialize core components
    this.eventBus = new EventBus();
    this.pluginEngine = new PluginEngine(this.eventBus);

    // Setup platform adapters
    if (config.twitch?.enabled) {
      this.twitchAdapter = new TwitchAdapter(config.twitch, this.eventBus);
      this.pluginEngine.registerPlatform(this.twitchAdapter);
    }

    this.logger.info('StreamCore initialized');
  }

  /**
   * Start the bot
   */
  async start(): Promise<void> {
    this.logger.info('Starting StreamCore...');

    // Connect to platforms
    if (this.twitchAdapter) {
      await this.twitchAdapter.connect();
    }

    // Emit ready event
    this.eventBus.emit('bot:ready', {
      type: 'bot:ready',
      platform: 'system',
      startTime: new Date(this.startTime),
    });

    this.logger.info('🚀 StreamCore is ready!');
  }

  /**
   * Stop the bot
   */
  async stop(): Promise<void> {
    this.logger.info('Stopping StreamCore...');

    if (this.twitchAdapter) {
      await this.twitchAdapter.disconnect();
    }

    this.eventBus.clear();
    this.logger.info('StreamCore stopped');
  }

  /**
   * Load a plugin
   */
  async loadPlugin(plugin: IPlugin): Promise<void> {
    await this.pluginEngine.loadPlugin(plugin);
  }

  /**
   * Unload a plugin
   */
  async unloadPlugin(name: string): Promise<void> {
    await this.pluginEngine.unloadPlugin(name);
  }

  /**
   * Get loaded plugins
   */
  getPlugins() {
    return this.pluginEngine.getPlugins();
  }

  /**
   * Get all commands
   */
  getCommands() {
    return this.pluginEngine.getCommands();
  }

  /**
   * Set streamer mood
   */
  setMood(mood: StreamerMood): void {
    this.currentMood = mood;
    const settings = MoodPresets[mood];
    this.logger.info(`Mood changed to: ${mood}`, settings);
  }

  /**
   * Get current mood
   */
  getMood(): StreamerMood {
    return this.currentMood;
  }

  /**
   * Get mood settings
   */
  getMoodSettings() {
    return MoodPresets[this.currentMood];
  }

  /**
   * Get event bus (for advanced use)
   */
  getEventBus(): EventBus {
    return this.eventBus;
  }

  /**
   * Get plugin engine (for advanced use)
   */
  getPluginEngine(): PluginEngine {
    return this.pluginEngine;
  }

  /**
   * Get Twitch adapter (for advanced use)
   */
  getTwitchAdapter(): TwitchAdapter | undefined {
    return this.twitchAdapter;
  }

  /**
   * Get uptime in milliseconds
   */
  getUptime(): number {
    return Date.now() - this.startTime;
  }

  /**
   * Send a message (convenience method)
   */
  sendMessage(channel: string, message: string): void {
    if (this.twitchAdapter) {
      this.twitchAdapter.sendMessage(channel, message);
    }
  }
}
