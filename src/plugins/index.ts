/**
 * StreamCore Plugin Registry
 *
 * Organized plugin exports by category for better maintainability.
 * Import individual plugins or entire categories as needed.
 */

// =============================================================================
// BASE CLASS
// =============================================================================
export { Plugin } from './base/Plugin';

// =============================================================================
// COMMAND PLUGINS - Core command handling
// =============================================================================
export { CoreCommandsPlugin } from './commands/CoreCommandsPlugin';
export { CustomCommandsPlugin } from './commands/CustomCommandsPlugin';

// =============================================================================
// CHAT PLUGINS - Chat features and logging
// =============================================================================
export { ChatLogsPlugin } from './chatlogs/ChatLogsPlugin';
export { ChatModesPlugin } from './chatmodes/ChatModesPlugin';
export { WelcomePlugin } from './welcome/WelcomePlugin';
export { LurkPlugin } from './lurk/LurkPlugin';
export { EmoteStatsPlugin } from './emotestats/EmoteStatsPlugin';

// =============================================================================
// MODERATION PLUGINS - Chat moderation and protection
// =============================================================================
export { ModerationPlugin } from './moderation/ModerationPlugin';
export { RaidProtectionPlugin } from './raidprotection/RaidProtectionPlugin';
export { WatchlistPlugin } from './watchlist/WatchlistPlugin';

// =============================================================================
// ENGAGEMENT PLUGINS - User interaction and games
// =============================================================================
export { PollsPlugin } from './polls/PollsPlugin';
export { GiveawayPlugin } from './giveaway/GiveawayPlugin';
export { BettingPlugin } from './betting/BettingPlugin';
export { GamesPlugin } from './games/GamesPlugin';
export { PredictionsPlugin } from './predictions/PredictionsPlugin';
export { QueuePlugin } from './queue/QueuePlugin';

// =============================================================================
// LOYALTY PLUGINS - Points, ranks and rewards
// =============================================================================
export { LoyaltyPlugin } from './loyalty/LoyaltyPlugin';
export { ShopPlugin } from './shop/ShopPlugin';
export { RanksPlugin } from './ranks/RanksPlugin';

// =============================================================================
// ENTERTAINMENT PLUGINS - Music, TTS, sounds
// =============================================================================
export { SongRequestPlugin } from './songrequest/SongRequestPlugin';
export { TTSPlugin } from './tts/TTSPlugin';
export { SoundAlertsPlugin } from './sounds/SoundAlertsPlugin';
export { QuotesPlugin } from './quotes/QuotesPlugin';

// =============================================================================
// ALERT PLUGINS - Stream alerts and notifications
// =============================================================================
export { AlertsPlugin } from './alerts/AlertsPlugin';
export { HypeTrainPlugin } from './hypetrain/HypeTrainPlugin';
export { SubGoalsPlugin } from './subgoals/SubGoalsPlugin';
export { BitsLeaderboardPlugin } from './bitsleaderboard/BitsLeaderboardPlugin';

// =============================================================================
// AUTOMATION PLUGINS - Timers, schedules, auto-actions
// =============================================================================
export { TimerPlugin } from './timers/TimerPlugin';
export { ScheduledPlugin } from './scheduled/ScheduledPlugin';
export { AutoShoutoutPlugin } from './autoshoutout/AutoShoutoutPlugin';
export { CountersPlugin } from './counters/CountersPlugin';

// =============================================================================
// INTEGRATION PLUGINS - External services
// =============================================================================
export { SpotifyPlugin } from './spotify/SpotifyPlugin';
export { DiscordPlugin } from './discord/DiscordPlugin';
export { TwitterPlugin } from './twitter/TwitterPlugin';
export { OBSControlPlugin } from './obscontrol/OBSControlPlugin';
export { TwitchInfoPlugin } from './twitchinfo/TwitchInfoPlugin';
export { EventSubPlugin } from './eventsub/EventSubPlugin';
export { ChannelPointsPlugin } from './channelpoints/ChannelPointsPlugin';
export { ClipsPlugin } from './clips/ClipsPlugin';

// =============================================================================
// GAMBLING PLUGINS - Casino games
// =============================================================================
export { CasinoPlugin } from './casino/CasinoPlugin';

// =============================================================================
// TRACKING PLUGINS - User tracking
// =============================================================================
export { WatchtimePlugin } from './watchtime/WatchtimePlugin';
export { LeaderboardPlugin } from './leaderboard/LeaderboardPlugin';
export { AchievementsPlugin } from './achievements/AchievementsPlugin';
export { UserLevelsPlugin } from './userlevels/UserLevelsPlugin';

// =============================================================================
// GOALS PLUGINS - Stream goals
// =============================================================================
export { BitGoalsPlugin } from './goals/BitGoalsPlugin';

// =============================================================================
// SCHEDULE PLUGINS - Stream scheduling
// =============================================================================
export { StreamSchedulePlugin } from './schedule/StreamSchedulePlugin';

// =============================================================================
// RAID PLUGINS - Raid management
// =============================================================================
export { RaidManagerPlugin } from './raidmanager/RaidManagerPlugin';

// =============================================================================
// GAME PLUGINS - Chat games
// =============================================================================
export { TriviaPlugin } from './trivia/TriviaPlugin';
export { WordGamesPlugin } from './wordgames/WordGamesPlugin';

// =============================================================================
// OVERLAY PLUGINS - Stream overlays
// =============================================================================
export { OverlayPlugin } from './overlay/OverlayPlugin';

// =============================================================================
// UTILITY PLUGINS - Tools and management
// =============================================================================
export { DashboardPlugin } from './dashboard/DashboardPlugin';
export { AnalyticsPlugin } from './analytics/AnalyticsPlugin';
export { StreamNotesPlugin } from './streamnotes/StreamNotesPlugin';
export { StreamControlPlugin } from './streamcontrol/StreamControlPlugin';
export { HydrationPlugin } from './hydration/HydrationPlugin';
export { VIPManagementPlugin } from './vip/VIPManagementPlugin';

// =============================================================================
// AI PLUGINS - Artificial intelligence features
// =============================================================================
export { AIChatPlugin } from './ai/AIChatPlugin';

// =============================================================================
// PLUGIN CATEGORIES (for grouped imports)
// =============================================================================
import { Plugin } from './base/Plugin';
import { CoreCommandsPlugin } from './commands/CoreCommandsPlugin';
import { CustomCommandsPlugin } from './commands/CustomCommandsPlugin';
import { ChatLogsPlugin } from './chatlogs/ChatLogsPlugin';
import { ChatModesPlugin } from './chatmodes/ChatModesPlugin';
import { WelcomePlugin } from './welcome/WelcomePlugin';
import { LurkPlugin } from './lurk/LurkPlugin';
import { EmoteStatsPlugin } from './emotestats/EmoteStatsPlugin';
import { ModerationPlugin } from './moderation/ModerationPlugin';
import { RaidProtectionPlugin } from './raidprotection/RaidProtectionPlugin';
import { WatchlistPlugin } from './watchlist/WatchlistPlugin';
import { PollsPlugin } from './polls/PollsPlugin';
import { GiveawayPlugin } from './giveaway/GiveawayPlugin';
import { BettingPlugin } from './betting/BettingPlugin';
import { GamesPlugin } from './games/GamesPlugin';
import { PredictionsPlugin } from './predictions/PredictionsPlugin';
import { QueuePlugin } from './queue/QueuePlugin';
import { LoyaltyPlugin } from './loyalty/LoyaltyPlugin';
import { ShopPlugin } from './shop/ShopPlugin';
import { RanksPlugin } from './ranks/RanksPlugin';
import { SongRequestPlugin } from './songrequest/SongRequestPlugin';
import { TTSPlugin } from './tts/TTSPlugin';
import { SoundAlertsPlugin } from './sounds/SoundAlertsPlugin';
import { QuotesPlugin } from './quotes/QuotesPlugin';
import { AlertsPlugin } from './alerts/AlertsPlugin';
import { HypeTrainPlugin } from './hypetrain/HypeTrainPlugin';
import { SubGoalsPlugin } from './subgoals/SubGoalsPlugin';
import { BitsLeaderboardPlugin } from './bitsleaderboard/BitsLeaderboardPlugin';
import { TimerPlugin } from './timers/TimerPlugin';
import { ScheduledPlugin } from './scheduled/ScheduledPlugin';
import { AutoShoutoutPlugin } from './autoshoutout/AutoShoutoutPlugin';
import { CountersPlugin } from './counters/CountersPlugin';
import { SpotifyPlugin } from './spotify/SpotifyPlugin';
import { DiscordPlugin } from './discord/DiscordPlugin';
import { TwitterPlugin } from './twitter/TwitterPlugin';
import { OBSControlPlugin } from './obscontrol/OBSControlPlugin';
import { TwitchInfoPlugin } from './twitchinfo/TwitchInfoPlugin';
import { EventSubPlugin } from './eventsub/EventSubPlugin';
import { ChannelPointsPlugin } from './channelpoints/ChannelPointsPlugin';
import { ClipsPlugin } from './clips/ClipsPlugin';
import { CasinoPlugin } from './casino/CasinoPlugin';
import { WatchtimePlugin } from './watchtime/WatchtimePlugin';
import { DashboardPlugin } from './dashboard/DashboardPlugin';
import { AnalyticsPlugin } from './analytics/AnalyticsPlugin';
import { StreamNotesPlugin } from './streamnotes/StreamNotesPlugin';
import { StreamControlPlugin } from './streamcontrol/StreamControlPlugin';
import { HydrationPlugin } from './hydration/HydrationPlugin';
import { VIPManagementPlugin } from './vip/VIPManagementPlugin';
import { AIChatPlugin } from './ai/AIChatPlugin';
import { LeaderboardPlugin } from './leaderboard/LeaderboardPlugin';
import { AchievementsPlugin } from './achievements/AchievementsPlugin';
import { UserLevelsPlugin } from './userlevels/UserLevelsPlugin';
import { BitGoalsPlugin } from './goals/BitGoalsPlugin';
import { StreamSchedulePlugin } from './schedule/StreamSchedulePlugin';
import { RaidManagerPlugin } from './raidmanager/RaidManagerPlugin';
import { TriviaPlugin } from './trivia/TriviaPlugin';
import { WordGamesPlugin } from './wordgames/WordGamesPlugin';
import { OverlayPlugin } from './overlay/OverlayPlugin';

/** Command plugins for core bot functionality */
export const CommandPlugins = {
  CoreCommandsPlugin,
  CustomCommandsPlugin,
};

/** Chat plugins for chat features */
export const ChatPlugins = {
  ChatLogsPlugin,
  ChatModesPlugin,
  WelcomePlugin,
  LurkPlugin,
  EmoteStatsPlugin,
};

/** Moderation plugins for chat safety */
export const ModerationPlugins = {
  ModerationPlugin,
  RaidProtectionPlugin,
  WatchlistPlugin,
};

/** Engagement plugins for user interaction */
export const EngagementPlugins = {
  PollsPlugin,
  GiveawayPlugin,
  BettingPlugin,
  GamesPlugin,
  PredictionsPlugin,
  QueuePlugin,
};

/** Loyalty plugins for points and rewards */
export const LoyaltyPlugins = {
  LoyaltyPlugin,
  ShopPlugin,
  RanksPlugin,
};

/** Entertainment plugins for music and sounds */
export const EntertainmentPlugins = {
  SongRequestPlugin,
  TTSPlugin,
  SoundAlertsPlugin,
  QuotesPlugin,
};

/** Alert plugins for stream notifications */
export const AlertPlugins = {
  AlertsPlugin,
  HypeTrainPlugin,
  SubGoalsPlugin,
  BitsLeaderboardPlugin,
};

/** Automation plugins for scheduled tasks */
export const AutomationPlugins = {
  TimerPlugin,
  ScheduledPlugin,
  AutoShoutoutPlugin,
  CountersPlugin,
};

/** Integration plugins for external services */
export const IntegrationPlugins = {
  SpotifyPlugin,
  DiscordPlugin,
  TwitterPlugin,
  OBSControlPlugin,
  TwitchInfoPlugin,
  EventSubPlugin,
  ChannelPointsPlugin,
  ClipsPlugin,
};

/** Gambling plugins for casino games */
export const GamblingPlugins = {
  CasinoPlugin,
};

/** Tracking plugins for user metrics */
export const TrackingPlugins = {
  WatchtimePlugin,
  LeaderboardPlugin,
  AchievementsPlugin,
  UserLevelsPlugin,
};

/** Goals plugins for stream goals */
export const GoalsPlugins = {
  SubGoalsPlugin,
  BitGoalsPlugin,
};

/** Schedule plugins for stream scheduling */
export const SchedulePlugins = {
  StreamSchedulePlugin,
};

/** Raid plugins for raid management */
export const RaidPlugins = {
  RaidManagerPlugin,
};

/** Game plugins for chat games */
export const GamePlugins = {
  TriviaPlugin,
  WordGamesPlugin,
};

/** Overlay plugins for stream overlays */
export const OverlayPlugins = {
  OverlayPlugin,
};

/** Utility plugins for tools and management */
export const UtilityPlugins = {
  DashboardPlugin,
  AnalyticsPlugin,
  StreamNotesPlugin,
  StreamControlPlugin,
  HydrationPlugin,
  VIPManagementPlugin,
};

/** AI plugins for intelligent features */
export const AIPlugins = {
  AIChatPlugin,
};

// =============================================================================
// PLUGIN REGISTRY - All plugins for auto-loading
// =============================================================================

/** Complete list of all available plugins */
export const AllPlugins = {
  // Commands
  ...CommandPlugins,
  // Chat
  ...ChatPlugins,
  // Moderation
  ...ModerationPlugins,
  // Engagement
  ...EngagementPlugins,
  // Loyalty
  ...LoyaltyPlugins,
  // Entertainment
  ...EntertainmentPlugins,
  // Alerts
  ...AlertPlugins,
  // Automation
  ...AutomationPlugins,
  // Integrations
  ...IntegrationPlugins,
  // Gambling
  ...GamblingPlugins,
  // Tracking
  ...TrackingPlugins,
  // Utility
  ...UtilityPlugins,
  // AI
  ...AIPlugins,
  // Goals
  ...GoalsPlugins,
  // Schedule
  ...SchedulePlugins,
  // Raids
  ...RaidPlugins,
  // Games
  ...GamePlugins,
  // Overlays
  ...OverlayPlugins,
};

/** Plugin categories for UI/configuration */
export const PluginCategories = {
  commands: { name: 'Commands', plugins: CommandPlugins },
  chat: { name: 'Chat', plugins: ChatPlugins },
  moderation: { name: 'Moderation', plugins: ModerationPlugins },
  engagement: { name: 'Engagement', plugins: EngagementPlugins },
  loyalty: { name: 'Loyalty', plugins: LoyaltyPlugins },
  entertainment: { name: 'Entertainment', plugins: EntertainmentPlugins },
  alerts: { name: 'Alerts', plugins: AlertPlugins },
  automation: { name: 'Automation', plugins: AutomationPlugins },
  integrations: { name: 'Integrations', plugins: IntegrationPlugins },
  gambling: { name: 'Gambling', plugins: GamblingPlugins },
  tracking: { name: 'Tracking', plugins: TrackingPlugins },
  utility: { name: 'Utility', plugins: UtilityPlugins },
  ai: { name: 'AI', plugins: AIPlugins },
  goals: { name: 'Goals', plugins: GoalsPlugins },
  schedule: { name: 'Schedule', plugins: SchedulePlugins },
  raids: { name: 'Raids', plugins: RaidPlugins },
  games: { name: 'Games', plugins: GamePlugins },
  overlays: { name: 'Overlays', plugins: OverlayPlugins },
} as const;

/** Get plugin class by name */
export function getPluginByName(name: string): typeof Plugin | undefined {
  return (AllPlugins as Record<string, typeof Plugin>)[name];
}

/** Get all plugin names */
export function getPluginNames(): string[] {
  return Object.keys(AllPlugins);
}

/** Get plugins by category */
export function getPluginsByCategory(category: keyof typeof PluginCategories) {
  return PluginCategories[category]?.plugins || {};
}
