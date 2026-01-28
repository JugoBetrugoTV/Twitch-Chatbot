/**
 * StreamCore Type Exports
 */

// New modular types
export * from './events';
export * from './plugins';

// Legacy types (for backwards compatibility)
export interface Viewer {
  username: string;
  displayName: string;
  points: number;
  watchTime: number; // in minutes
  lastSeen: Date;
  isSubscriber: boolean;
  isModerator: boolean;
  isVip: boolean;
  messageCount: number;
}

export interface SongRequest {
  id: string;
  title: string;
  url: string;
  duration: number; // in seconds
  requestedBy: string;
  requestedAt: Date;
  platform: 'youtube' | 'spotify' | 'soundcloud';
}

export interface ChatMessage {
  id: string;
  username: string;
  displayName: string;
  message: string;
  timestamp: Date;
  isMod: boolean;
  isSub: boolean;
  isVip: boolean;
  badges: Map<string, string>;
  color: string;
}

export interface BotCommand {
  name: string;
  aliases: string[];
  description: string;
  usage: string;
  cooldown: number; // in seconds
  modOnly: boolean;
  subOnly: boolean;
  enabled: boolean;
  execute: (context: CommandContext) => Promise<void>;
}

export interface CommandContext {
  channel: string;
  user: {
    username: string;
    displayName: string;
    isMod: boolean;
    isSub: boolean;
    isVip: boolean;
    isBroadcaster: boolean;
  };
  message: string;
  args: string[];
  reply: (message: string) => void;
}

export interface TTSMessage {
  id: string;
  username: string;
  text: string;
  timestamp: Date;
  priority: number;
}

export interface BotStats {
  messagesReceived: number;
  commandsExecuted: number;
  songsPlayed: number;
  ttsMessagesRead: number;
  uptime: number;
  peakViewers: number;
}

export interface DashboardData {
  stats: BotStats;
  viewers: Viewer[];
  songQueue: SongRequest[];
  currentSong: SongRequest | null;
  ttsQueue: TTSMessage[];
  recentMessages: ChatMessage[];
}
