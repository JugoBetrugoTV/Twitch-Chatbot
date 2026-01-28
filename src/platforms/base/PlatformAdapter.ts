/**
 * Base Platform Adapter
 *
 * All platform adapters must implement this interface.
 * This allows the bot to work with multiple platforms seamlessly.
 */

import { EventEmitter } from 'events';
import { Platform, ChatUser } from '../../types/events';
import { Logger } from '../../utils/logger';

export interface PlatformConfig {
  enabled: boolean;
  [key: string]: any;
}

export interface ChannelInfo {
  id: string;
  name: string;
  displayName: string;
  game?: string;
  title?: string;
  viewers?: number;
  isLive?: boolean;
}

export abstract class PlatformAdapter extends EventEmitter {
  abstract readonly platform: Platform;
  abstract readonly name: string;

  protected logger: Logger;
  protected connected: boolean = false;
  protected config: PlatformConfig;

  constructor(config: PlatformConfig) {
    super();
    this.config = config;
    this.logger = new Logger(`Platform:${this.constructor.name}`);
  }

  /**
   * Connect to the platform
   */
  abstract connect(): Promise<void>;

  /**
   * Disconnect from the platform
   */
  abstract disconnect(): Promise<void>;

  /**
   * Send a message to a channel
   */
  abstract sendMessage(channel: string, message: string): Promise<void>;

  /**
   * Send a reply to a specific message
   */
  abstract sendReply(
    channel: string,
    message: string,
    replyToId: string
  ): Promise<void>;

  /**
   * Get channel information
   */
  abstract getChannelInfo(channel: string): Promise<ChannelInfo | null>;

  /**
   * Get list of users in chat
   */
  abstract getChatters(channel: string): Promise<string[]>;

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.connected;
  }

  /**
   * Check if a user has a specific permission
   */
  abstract hasPermission(user: ChatUser, permission: number): boolean;
}
