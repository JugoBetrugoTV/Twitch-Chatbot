/**
 * StreamCore Plugin Types
 */

import { EventName, StreamCoreEvent, ChatUser } from './events';

// ============================================
// Plugin Base Types
// ============================================

export interface PluginMeta {
  name: string;
  version: string;
  description: string;
  author?: string;
}

export interface PluginConfig {
  enabled: boolean;
  [key: string]: any;
}

export interface PluginContext {
  config: PluginConfig;
  logger: PluginLogger;
  db: PluginDatabase;
  emit: (event: EventName, data: any) => void;
  sendMessage: (channel: string, message: string) => void;
}

export interface PluginLogger {
  info: (message: string, ...args: any[]) => void;
  warn: (message: string, ...args: any[]) => void;
  error: (message: string, ...args: any[]) => void;
  debug: (message: string, ...args: any[]) => void;
}

export interface PluginDatabase {
  get: <T>(key: string) => T | undefined;
  set: <T>(key: string, value: T) => void;
  delete: (key: string) => void;
  getAll: () => Record<string, any>;
}

// ============================================
// Hook System
// ============================================

export type HookStage = 'before' | 'after';
export type HookName = `${HookStage}:${EventName}`;

export interface HookContext<T extends StreamCoreEvent = StreamCoreEvent> {
  event: T;
  cancelled: boolean;
  cancel: () => void;
  data: Record<string, any>; // Shared data between hooks
}

export type HookHandler<T extends StreamCoreEvent = StreamCoreEvent> = (
  ctx: HookContext<T>
) => Promise<void> | void;

// ============================================
// Command System
// ============================================

export enum Permission {
  EVERYONE = 0,
  FOLLOWER = 1,
  REGULAR = 2,
  SUBSCRIBER = 3,
  VIP = 4,
  MODERATOR = 5,
  BROADCASTER = 6,
}

export interface Command {
  name: string;
  aliases?: string[];
  description?: string;
  usage?: string;
  permission: Permission;
  cooldown: {
    user: number;     // Seconds
    global: number;   // Seconds
  };
  enabled: boolean;
  handler: CommandHandler;
}

export interface CommandContext {
  command: string;
  args: string[];
  rawMessage: string;
  user: ChatUser;
  channel: string;
  reply: (message: string) => void;
  // Plugin can attach extra data
  data: Record<string, any>;
}

export type CommandHandler = (ctx: CommandContext) => Promise<void> | void;

// ============================================
// Timer System
// ============================================

export interface Timer {
  id: string;
  name: string;
  messages: string[];
  intervalMinutes: number;
  minChatMessages: number;
  enabled: boolean;
  lastTriggered?: Date;
}

// ============================================
// Streamer Mood System
// ============================================

export type StreamerMood = 'chill' | 'competitive' | 'chaos';

export interface MoodSettings {
  cooldownMultiplier: number;
  randomEventFrequency: 'low' | 'medium' | 'high';
  responseStyle: 'relaxed' | 'focused' | 'hype';
  soundVolume: number; // 0-150%
}

export const MoodPresets: Record<StreamerMood, MoodSettings> = {
  chill: {
    cooldownMultiplier: 1.5,
    randomEventFrequency: 'low',
    responseStyle: 'relaxed',
    soundVolume: 70,
  },
  competitive: {
    cooldownMultiplier: 1.0,
    randomEventFrequency: 'medium',
    responseStyle: 'focused',
    soundVolume: 100,
  },
  chaos: {
    cooldownMultiplier: 0.5,
    randomEventFrequency: 'high',
    responseStyle: 'hype',
    soundVolume: 120,
  },
};

// ============================================
// Plugin Instance Interface
// ============================================

export interface IPlugin {
  meta: PluginMeta;

  // Lifecycle
  onLoad(ctx: PluginContext): Promise<void> | void;
  onUnload(): Promise<void> | void;

  // Optional: Get commands provided by this plugin
  getCommands?(): Command[];

  // Optional: Get timers provided by this plugin
  getTimers?(): Timer[];
}
