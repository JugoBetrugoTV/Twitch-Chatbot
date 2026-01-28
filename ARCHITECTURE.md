# 🚀 StreamCore - Next-Gen Twitch Chatbot Architecture

## Vision
A modular, event-driven chatbot that's **fast, fun, and extensible**.
Built for streamers who want control AND simplicity.

---

## 🏗️ System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        DASHBOARD (Web UI)                        │
│                    React + Vite + TailwindCSS                    │
└─────────────────────────────────────────────────────────────────┘
                                │
                          WebSocket/REST
                                │
┌─────────────────────────────────────────────────────────────────┐
│                         API SERVER                               │
│                    Express + Socket.IO                           │
└─────────────────────────────────────────────────────────────────┘
                                │
        ┌───────────────────────┼───────────────────────┐
        │                       │                       │
        ▼                       ▼                       ▼
┌───────────────┐     ┌─────────────────┐     ┌───────────────┐
│  EVENT BUS    │────▶│  PLUGIN ENGINE  │◀────│   DATABASE    │
│  (EventEmitter)│     │  (Hook System)   │     │   (SQLite)    │
└───────────────┘     └─────────────────┘     └───────────────┘
        │                       │
        │              ┌────────┴────────┐
        │              │                 │
        ▼              ▼                 ▼
┌───────────────┐ ┌─────────┐     ┌─────────────┐
│   PLATFORM    │ │ PLUGINS │     │   SERVICES  │
│   ADAPTERS    │ │         │     │             │
├───────────────┤ ├─────────┤     ├─────────────┤
│ • Twitch IRC  │ │ Commands│     │ • AI Engine │
│ • Twitch API  │ │ Loyalty │     │ • TTS       │
│ • EventSub    │ │ Timers  │     │ • OBS       │
│ • YouTube*    │ │ Mod     │     │ • Sounds    │
│ • Kick*       │ │ Sounds  │     │ • Alerts    │
│ • Discord*    │ │ Games   │     │             │
└───────────────┘ └─────────┘     └─────────────┘
      (* = future)
```

---

## 📁 Folder Structure

```
streamcore/
├── src/
│   ├── core/                    # 🧠 Core Engine
│   │   ├── EventBus.ts          # Central event emitter
│   │   ├── PluginEngine.ts      # Plugin loader & hook system
│   │   ├── ConfigManager.ts     # Config handling
│   │   └── index.ts
│   │
│   ├── platforms/               # 🌐 Platform Adapters
│   │   ├── base/
│   │   │   └── PlatformAdapter.ts
│   │   ├── twitch/
│   │   │   ├── TwitchAdapter.ts
│   │   │   ├── TwitchAPI.ts
│   │   │   ├── TwitchEventSub.ts
│   │   │   └── index.ts
│   │   └── index.ts
│   │
│   ├── plugins/                 # 🔌 Built-in Plugins
│   │   ├── base/
│   │   │   └── Plugin.ts        # Base plugin class
│   │   ├── commands/
│   │   │   ├── CommandPlugin.ts
│   │   │   └── CommandParser.ts
│   │   ├── loyalty/
│   │   │   └── LoyaltyPlugin.ts
│   │   ├── timers/
│   │   │   └── TimerPlugin.ts
│   │   ├── moderation/
│   │   │   └── ModerationPlugin.ts
│   │   ├── sounds/
│   │   │   └── SoundsPlugin.ts
│   │   ├── obs/
│   │   │   └── OBSPlugin.ts
│   │   ├── ai/
│   │   │   └── AIPlugin.ts
│   │   └── index.ts
│   │
│   ├── services/                # 🛠️ Shared Services
│   │   ├── Database.ts
│   │   ├── TTSService.ts
│   │   ├── SoundService.ts
│   │   ├── OBSService.ts
│   │   ├── AIService.ts
│   │   └── index.ts
│   │
│   ├── api/                     # 🌍 REST & WebSocket API
│   │   ├── server.ts
│   │   ├── routes/
│   │   │   ├── commands.ts
│   │   │   ├── users.ts
│   │   │   ├── settings.ts
│   │   │   └── index.ts
│   │   └── websocket/
│   │       └── handlers.ts
│   │
│   ├── types/                   # 📝 TypeScript Types
│   │   ├── events.ts
│   │   ├── plugins.ts
│   │   ├── platforms.ts
│   │   └── index.ts
│   │
│   ├── utils/                   # 🔧 Utilities
│   │   ├── logger.ts
│   │   ├── variables.ts
│   │   └── index.ts
│   │
│   └── index.ts                 # Entry point
│
├── dashboard/                   # 💻 Web Dashboard
│   ├── src/
│   │   ├── components/
│   │   ├── pages/
│   │   ├── hooks/
│   │   ├── stores/
│   │   └── App.tsx
│   ├── package.json
│   └── vite.config.ts
│
├── plugins/                     # 📦 External/Custom Plugins
│   └── example-plugin/
│
├── sounds/                      # 🔊 Sound Files
├── data/                        # 💾 Database & Runtime Data
├── config/
│   └── default.json
│
├── package.json
├── tsconfig.json
└── README.md
```

---

## 🎯 Core Concepts

### 1. Event Bus (Heart of the System)
Everything is an event. Plugins subscribe to events they care about.

```typescript
// Events flow through the system
eventBus.emit('chat:message', { user, message, platform: 'twitch' });
eventBus.emit('chat:command', { command: 'sr', args: ['song'], user });
eventBus.emit('twitch:follow', { user, timestamp });
eventBus.emit('twitch:subscription', { user, tier, months });
```

### 2. Plugin System (Extensibility)
Plugins are self-contained modules that:
- Register hooks (before/after events)
- Add commands
- Store their own data
- Can be enabled/disabled

```typescript
class MyPlugin extends Plugin {
  name = 'my-plugin';

  async onLoad() {
    this.on('chat:message', this.handleMessage);
    this.registerCommand('hello', this.helloCommand);
  }
}
```

### 3. Platform Adapters (Multi-Platform Ready)
Each platform implements the same interface:

```typescript
interface PlatformAdapter {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  sendMessage(channel: string, message: string): void;
  // Events are normalized to common format
}
```

### 4. Streamer Mood System
Affects bot personality globally:

```typescript
type StreamerMood = 'chill' | 'competitive' | 'chaos';

// Mood affects:
// - Command cooldowns (chaos = shorter)
// - Response style (chill = relaxed, chaos = CAPS)
// - Random events frequency
// - AI personality
```

---

## 🔌 Hook System

Plugins can hook into any event at different stages:

```typescript
// BEFORE hooks can modify or cancel events
pluginEngine.hook('before:chat:command', async (ctx) => {
  if (ctx.user.isBanned) {
    ctx.cancel(); // Prevent command execution
  }
});

// AFTER hooks react to completed events
pluginEngine.hook('after:chat:command', async (ctx) => {
  await analytics.logCommand(ctx.command);
});
```

---

## 📊 Database Schema (SQLite)

```sql
-- Users
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  platform TEXT NOT NULL,
  username TEXT NOT NULL,
  display_name TEXT,
  points INTEGER DEFAULT 0,
  watch_time INTEGER DEFAULT 0,
  first_seen DATETIME,
  last_seen DATETIME,
  is_regular BOOLEAN DEFAULT FALSE,
  custom_data JSON
);

-- Commands
CREATE TABLE commands (
  id TEXT PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  response TEXT NOT NULL,
  cooldown_user INTEGER DEFAULT 5,
  cooldown_global INTEGER DEFAULT 0,
  permission TEXT DEFAULT 'everyone',
  enabled BOOLEAN DEFAULT TRUE,
  use_count INTEGER DEFAULT 0,
  variables JSON,
  conditions JSON
);

-- Timers
CREATE TABLE timers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  message TEXT NOT NULL,
  interval_minutes INTEGER,
  min_messages INTEGER,
  enabled BOOLEAN DEFAULT TRUE,
  last_triggered DATETIME
);

-- Event Log
CREATE TABLE events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,
  data JSON,
  timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

---

## 🚦 Event Types

```typescript
// Chat Events
'chat:message'      // Any chat message
'chat:command'      // Command detected
'chat:action'       // /me action

// Platform Events (Twitch)
'twitch:follow'
'twitch:subscription'
'twitch:gift'
'twitch:raid'
'twitch:cheer'
'twitch:redemption' // Channel points

// System Events
'bot:ready'
'bot:connected'
'bot:disconnected'
'plugin:loaded'
'plugin:error'

// Action Events
'action:sound'
'action:tts'
'action:obs'
'action:alert'
```

---

## 🎮 Command Variables

Commands support dynamic variables:

```
$(user)          → Username
$(target)        → First argument or sender
$(count)         → Command use count
$(random 1-100)  → Random number
$(randomuser)    → Random chatter
$(time)          → Current time
$(uptime)        → Stream uptime
$(game)          → Current game
$(title)         → Stream title
$(followers)     → Follower count
$(subs)          → Sub count
$(points)        → User's points
$(watchtime)     → User's watch time
$(ai prompt)     → AI-generated response
```

---

## 🛡️ Permission Levels

```typescript
enum Permission {
  EVERYONE = 0,
  FOLLOWER = 1,
  REGULAR = 2,    // Custom status
  SUBSCRIBER = 3,
  VIP = 4,
  MODERATOR = 5,
  BROADCASTER = 6
}
```

---

## 🎭 Mood System Effects

| Feature | Chill | Competitive | Chaos |
|---------|-------|-------------|-------|
| Cooldowns | 1.5x | 1x | 0.5x |
| Random Events | Low | Medium | High |
| Bot Responses | Relaxed 😎 | Focused 🎯 | HYPE 🔥 |
| AI Personality | Laid-back | Strategic | Unhinged |
| Sound Volume | 70% | 100% | 120% |

---

## 🔄 Data Flow Example

```
User types: !sr never gonna give you up

1. TwitchAdapter receives message
2. EventBus emits 'chat:message'
3. CommandPlugin catches message, detects command
4. EventBus emits 'chat:command' { cmd: 'sr', args: [...] }
5. SongRequestPlugin handles command
6. Adds song to queue
7. EventBus emits 'action:sound' or 'song:queued'
8. Dashboard receives update via WebSocket
9. Bot sends confirmation to chat
```

---

## 🚀 MVP Features (Phase 1)

1. ✅ Core event system
2. ✅ Twitch IRC connection
3. ✅ Basic command system with variables
4. ✅ SQLite database
5. ✅ WebSocket API for dashboard
6. ⬜ Simple web dashboard

## Phase 2
- Loyalty points system
- Timers
- Moderation
- OBS integration

## Phase 3
- AI features
- Mood system
- Advanced commands (conditions)
- Sound/video triggers

## Phase 4
- Plugin marketplace
- Multi-platform
- Mobile app
