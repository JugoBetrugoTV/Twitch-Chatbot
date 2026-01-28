/**
 * StreamCore Event Types
 * All events that flow through the system
 */

// ============================================
// Base Event Types
// ============================================

export interface BaseEvent {
  id: string;
  timestamp: Date;
  platform: Platform;
}

export type Platform = 'twitch' | 'youtube' | 'kick' | 'discord' | 'system';

// ============================================
// Chat Events
// ============================================

export interface ChatUser {
  id: string;
  username: string;
  displayName: string;
  platform: Platform;
  color?: string;
  badges: Map<string, string>;
  isMod: boolean;
  isVip: boolean;
  isSub: boolean;
  isFollower: boolean;
  isBroadcaster: boolean;
  subTier?: 1 | 2 | 3;
  subMonths?: number;
}

export interface ChatMessageEvent extends BaseEvent {
  type: 'chat:message';
  user: ChatUser;
  channel: string;
  message: string;
  isAction: boolean; // /me message
  emotes: EmoteData[];
  replyTo?: {
    messageId: string;
    username: string;
  };
}

export interface EmoteData {
  id: string;
  name: string;
  positions: [number, number][];
}

export interface ChatCommandEvent extends BaseEvent {
  type: 'chat:command';
  user: ChatUser;
  channel: string;
  command: string;
  args: string[];
  rawMessage: string;
}

// ============================================
// Platform Events (Twitch-specific)
// ============================================

export interface FollowEvent extends BaseEvent {
  type: 'twitch:follow';
  user: {
    id: string;
    username: string;
    displayName: string;
  };
  channel: string;
}

export interface SubscriptionEvent extends BaseEvent {
  type: 'twitch:subscription';
  user: ChatUser;
  channel: string;
  tier: 1 | 2 | 3;
  months: number;
  isGift: boolean;
  giftedBy?: string;
  message?: string;
}

export interface GiftSubEvent extends BaseEvent {
  type: 'twitch:gift';
  user: ChatUser;
  channel: string;
  tier: 1 | 2 | 3;
  amount: number;
  totalGifted: number;
}

export interface RaidEvent extends BaseEvent {
  type: 'twitch:raid';
  user: {
    id: string;
    username: string;
    displayName: string;
  };
  channel: string;
  viewers: number;
}

export interface CheerEvent extends BaseEvent {
  type: 'twitch:cheer';
  user: ChatUser;
  channel: string;
  bits: number;
  message: string;
}

export interface RedemptionEvent extends BaseEvent {
  type: 'twitch:redemption';
  user: ChatUser;
  channel: string;
  rewardId: string;
  rewardTitle: string;
  rewardCost: number;
  userInput?: string;
}

// ============================================
// Bot/System Events
// ============================================

export interface BotReadyEvent extends BaseEvent {
  type: 'bot:ready';
  startTime: Date;
}

export interface BotConnectedEvent extends BaseEvent {
  type: 'bot:connected';
  platform: Platform;
  channel: string;
}

export interface BotDisconnectedEvent extends BaseEvent {
  type: 'bot:disconnected';
  platform: Platform;
  reason?: string;
}

export interface PluginLoadedEvent extends BaseEvent {
  type: 'plugin:loaded';
  pluginName: string;
}

export interface PluginErrorEvent extends BaseEvent {
  type: 'plugin:error';
  pluginName: string;
  error: Error;
}

// ============================================
// Action Events
// ============================================

export interface SoundActionEvent extends BaseEvent {
  type: 'action:sound';
  soundFile: string;
  volume?: number;
  triggeredBy: string;
}

export interface TTSActionEvent extends BaseEvent {
  type: 'action:tts';
  text: string;
  voice?: string;
  triggeredBy: string;
}

export interface OBSActionEvent extends BaseEvent {
  type: 'action:obs';
  action: 'scene' | 'source' | 'filter';
  target: string;
  value?: any;
  triggeredBy: string;
}

export interface AlertActionEvent extends BaseEvent {
  type: 'action:alert';
  alertType: 'follow' | 'sub' | 'raid' | 'cheer' | 'custom';
  data: Record<string, any>;
}

// ============================================
// Union Types
// ============================================

export type ChatEvent = ChatMessageEvent | ChatCommandEvent;

export type TwitchEvent =
  | FollowEvent
  | SubscriptionEvent
  | GiftSubEvent
  | RaidEvent
  | CheerEvent
  | RedemptionEvent;

export type SystemEvent =
  | BotReadyEvent
  | BotConnectedEvent
  | BotDisconnectedEvent
  | PluginLoadedEvent
  | PluginErrorEvent;

export type ActionEvent =
  | SoundActionEvent
  | TTSActionEvent
  | OBSActionEvent
  | AlertActionEvent;

export type StreamCoreEvent =
  | ChatEvent
  | TwitchEvent
  | SystemEvent
  | ActionEvent;

// ============================================
// Event Names
// ============================================

export type EventName =
  // Chat
  | 'chat:message'
  | 'chat:command'
  // Twitch
  | 'twitch:follow'
  | 'twitch:subscription'
  | 'twitch:gift'
  | 'twitch:raid'
  | 'twitch:cheer'
  | 'twitch:redemption'
  // System
  | 'bot:ready'
  | 'bot:connected'
  | 'bot:disconnected'
  | 'plugin:loaded'
  | 'plugin:error'
  // Actions
  | 'action:sound'
  | 'action:tts'
  | 'action:obs'
  | 'action:alert'
  // Wildcard
  | '*';

// ============================================
// Event Map for Type Safety
// ============================================

export interface EventMap {
  'chat:message': ChatMessageEvent;
  'chat:command': ChatCommandEvent;
  'twitch:follow': FollowEvent;
  'twitch:subscription': SubscriptionEvent;
  'twitch:gift': GiftSubEvent;
  'twitch:raid': RaidEvent;
  'twitch:cheer': CheerEvent;
  'twitch:redemption': RedemptionEvent;
  'bot:ready': BotReadyEvent;
  'bot:connected': BotConnectedEvent;
  'bot:disconnected': BotDisconnectedEvent;
  'plugin:loaded': PluginLoadedEvent;
  'plugin:error': PluginErrorEvent;
  'action:sound': SoundActionEvent;
  'action:tts': TTSActionEvent;
  'action:obs': OBSActionEvent;
  'action:alert': AlertActionEvent;
  '*': StreamCoreEvent;
}
