/**
 * Twitch Platform Adapter
 *
 * Handles all Twitch-specific functionality:
 * - IRC Chat via tmi.js
 * - Twitch API calls
 * - EventSub webhooks (future)
 */

import tmi from 'tmi.js';
import {
  PlatformAdapter,
  PlatformConfig,
  ChannelInfo,
} from '../base/PlatformAdapter';
import { EventBus } from '../../core/EventBus';
import {
  ChatUser,
  ChatMessageEvent,
  ChatCommandEvent,
  SubscriptionEvent,
  RaidEvent,
  CheerEvent,
} from '../../types/events';
import { Permission } from '../../types/plugins';
import { v4 as uuidv4 } from 'uuid';

export interface TwitchConfig extends PlatformConfig {
  username: string;
  oauthToken: string;
  channels: string[];
  clientId?: string;
  clientSecret?: string;
  commandPrefix: string;
}

export class TwitchAdapter extends PlatformAdapter {
  readonly platform = 'twitch' as const;
  readonly name = 'Twitch';

  private client: tmi.Client;
  private eventBus: EventBus;
  private twitchConfig: TwitchConfig;

  constructor(config: TwitchConfig, eventBus: EventBus) {
    super(config);
    this.twitchConfig = config;
    this.eventBus = eventBus;

    this.client = new tmi.Client({
      options: { debug: false },
      connection: {
        secure: true,
        reconnect: true,
      },
      identity: {
        username: config.username,
        password: config.oauthToken,
      },
      channels: config.channels,
    });

    this.setupEventHandlers();
  }

  private setupEventHandlers(): void {
    // Connection events
    this.client.on('connected', (address, port) => {
      this.connected = true;
      this.logger.info(`Connected to Twitch IRC: ${address}:${port}`);

      for (const channel of this.twitchConfig.channels) {
        this.eventBus.emit('bot:connected', {
          platform: 'twitch',
          channel: channel.replace('#', ''),
        });
      }
    });

    this.client.on('disconnected', (reason) => {
      this.connected = false;
      this.logger.warn(`Disconnected: ${reason}`);

      this.eventBus.emit('bot:disconnected', {
        platform: 'twitch',
        reason,
      });
    });

    // Chat messages
    this.client.on('message', (channel, userstate, message, self) => {
      if (self) return;

      const user = this.parseUser(userstate);
      const channelName = channel.replace('#', '');

      // Check if it's a command
      if (message.startsWith(this.twitchConfig.commandPrefix)) {
        const args = message
          .slice(this.twitchConfig.commandPrefix.length)
          .trim()
          .split(/\s+/);
        const command = args.shift()?.toLowerCase();

        if (command) {
          this.eventBus.emit('chat:command', {
            type: 'chat:command',
            platform: 'twitch',
            user,
            channel: channelName,
            command,
            args,
            rawMessage: message,
          });
        }
      }

      // Always emit the message event
      this.eventBus.emit('chat:message', {
        type: 'chat:message',
        platform: 'twitch',
        user,
        channel: channelName,
        message,
        isAction: userstate['message-type'] === 'action',
        emotes: this.parseEmotes(userstate.emotes, message),
        replyTo: userstate['reply-parent-msg-id']
          ? {
              messageId: userstate['reply-parent-msg-id'],
              username: userstate['reply-parent-user-login'] || '',
            }
          : undefined,
      });
    });

    // Subscription events
    this.client.on(
      'subscription',
      (channel, username, method, message, userstate) => {
        const user = this.parseUser(userstate);
        const channelName = channel.replace('#', '');

        this.eventBus.emit('twitch:subscription', {
          type: 'twitch:subscription',
          platform: 'twitch',
          user,
          channel: channelName,
          tier: this.parseTier(method.plan),
          months: 1,
          isGift: false,
          message: message || undefined,
        });
      }
    );

    this.client.on(
      'resub',
      (channel, username, months, message, userstate, methods) => {
        const user = this.parseUser(userstate);
        const channelName = channel.replace('#', '');

        this.eventBus.emit('twitch:subscription', {
          type: 'twitch:subscription',
          platform: 'twitch',
          user,
          channel: channelName,
          tier: this.parseTier(methods.plan),
          months: months,
          isGift: false,
          message: message || undefined,
        });
      }
    );

    // Gift subs
    this.client.on(
      'subgift',
      (channel, username, streakMonths, recipient, methods, userstate) => {
        const user = this.parseUser(userstate);
        const channelName = channel.replace('#', '');

        this.eventBus.emit('twitch:gift', {
          type: 'twitch:gift',
          platform: 'twitch',
          user,
          channel: channelName,
          tier: this.parseTier(methods.plan),
          amount: 1,
          totalGifted: parseInt(userstate['msg-param-sender-count'] || '0', 10),
        });
      }
    );

    // Raid
    this.client.on('raided', (channel, username, viewers) => {
      const channelName = channel.replace('#', '');

      this.eventBus.emit('twitch:raid', {
        type: 'twitch:raid',
        platform: 'twitch',
        user: {
          id: '',
          username: username,
          displayName: username,
        },
        channel: channelName,
        viewers: viewers,
      });
    });

    // Cheer/Bits
    this.client.on('cheer', (channel, userstate, message) => {
      const user = this.parseUser(userstate);
      const channelName = channel.replace('#', '');

      this.eventBus.emit('twitch:cheer', {
        type: 'twitch:cheer',
        platform: 'twitch',
        user,
        channel: channelName,
        bits: parseInt(userstate.bits || '0', 10),
        message,
      });
    });
  }

  private parseUser(userstate: tmi.ChatUserstate): ChatUser {
    const badges = userstate.badges || {};

    return {
      id: userstate['user-id'] || '',
      username: userstate.username || '',
      displayName: userstate['display-name'] || userstate.username || '',
      platform: 'twitch',
      color: userstate.color || '#FFFFFF',
      badges: new Map(
        Object.entries(badges).filter(
          (entry): entry is [string, string] => entry[1] !== undefined
        )
      ),
      isMod: userstate.mod || !!badges.moderator,
      isVip: !!badges.vip,
      isSub: userstate.subscriber || !!badges.subscriber,
      isFollower: true, // Can't determine from chat alone
      isBroadcaster: !!badges.broadcaster,
      subTier: badges.subscriber
        ? this.parseTier(badges.subscriber)
        : undefined,
      subMonths: userstate['badge-info']?.subscriber
        ? parseInt(userstate['badge-info'].subscriber, 10)
        : undefined,
    };
  }

  private parseTier(plan: string | undefined): 1 | 2 | 3 {
    if (!plan) return 1;
    if (plan === 'Prime' || plan === '1000') return 1;
    if (plan === '2000') return 2;
    if (plan === '3000') return 3;
    return 1;
  }

  private parseEmotes(
    emotes: { [emoteid: string]: string[] } | undefined,
    message: string
  ): { id: string; name: string; positions: [number, number][] }[] {
    if (!emotes) return [];

    return Object.entries(emotes).map(([id, positions]) => ({
      id,
      name: this.extractEmoteName(message, positions[0]),
      positions: positions.map((pos) => {
        const [start, end] = pos.split('-').map(Number);
        return [start, end] as [number, number];
      }),
    }));
  }

  private extractEmoteName(message: string, position: string): string {
    const [start, end] = position.split('-').map(Number);
    return message.substring(start, end + 1);
  }

  // ==========================================
  // Public API
  // ==========================================

  async connect(): Promise<void> {
    this.logger.info('Connecting to Twitch...');
    await this.client.connect();
  }

  async disconnect(): Promise<void> {
    this.logger.info('Disconnecting from Twitch...');
    await this.client.disconnect();
    this.connected = false;
  }

  async sendMessage(channel: string, message: string): Promise<void> {
    const channelName = channel.startsWith('#') ? channel : `#${channel}`;
    await this.client.say(channelName, message);
  }

  async sendReply(
    channel: string,
    message: string,
    replyToId: string
  ): Promise<void> {
    const channelName = channel.startsWith('#') ? channel : `#${channel}`;
    // tmi.js doesn't have native reply support, use /reply workaround
    await this.client.say(channelName, message);
  }

  async getChannelInfo(channel: string): Promise<ChannelInfo | null> {
    // Would need Twitch API for this
    return {
      id: '',
      name: channel,
      displayName: channel,
    };
  }

  async getChatters(channel: string): Promise<string[]> {
    // Would need Twitch API for this
    return [];
  }

  hasPermission(user: ChatUser, permission: Permission): boolean {
    if (user.isBroadcaster) return true;

    switch (permission) {
      case Permission.EVERYONE:
        return true;
      case Permission.FOLLOWER:
        return user.isFollower;
      case Permission.SUBSCRIBER:
        return user.isSub;
      case Permission.VIP:
        return user.isVip || user.isMod;
      case Permission.MODERATOR:
        return user.isMod;
      case Permission.BROADCASTER:
        return user.isBroadcaster;
      default:
        return true;
    }
  }

  /**
   * Get the underlying tmi.js client (for advanced use)
   */
  getClient(): tmi.Client {
    return this.client;
  }
}
