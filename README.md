# Twitch Chatbot - Desktop App

Eine eigenständige Desktop-Anwendung für Twitch Streamer - inspiriert von Deepbot und Streamlabs.

## Features

### Chat & Viewer Management
- Echtzeit Chat-Verbindung zu Twitch
- Viewer-Liste mit Online-Status
- **Punkte-System** (wie Deepbot)
- Watch-Time Tracking
- Subscriber/VIP/Mod Badges

### Song Requests
- `!sr <song>` - YouTube Songs anfordern
- Song-Queue im Dashboard verwalten
- Skip, Remove, Clear Funktionen
- Max. Song-Länge einstellbar

### Text-to-Speech
- `!tts <nachricht>` - Nachrichten vorlesen lassen
- Google TTS (wie speechchat.com)
- Mehrsprachig (DE, EN, ES, FR)
- Lautstärke regelbar
- Wortfilter

### Desktop Dashboard
- Modernes Twitch-Style Interface
- Live Chat-Anzeige
- Song Queue Management
- TTS Kontrolle ein/aus
- System Tray (minimiert in Taskleiste)

## Installation

### Schnellstart

1. Lade die neueste Version aus den [Releases](../../releases)
2. Führe die `.exe` Datei aus
3. Gib deine Twitch-Credentials in den Einstellungen ein
4. Klicke auf "Verbinden"

### Development Setup

```bash
# Repository klonen
git clone https://github.com/yourusername/Twitch-Chatbot.git
cd Twitch-Chatbot

# Dependencies installieren
npm install

# App starten (Development)
npm run dev

# Windows .exe bauen
npm run dist:win
```

## Twitch Credentials

Du brauchst:

1. **Bot Username** - Ein Twitch-Account für den Bot (kann dein eigener sein)
2. **OAuth Token** - Hol dir einen von [twitchapps.com/tmi](https://twitchapps.com/tmi/)
3. **Channel Name** - Dein Twitch-Kanal

**Optional** (für Viewer-Liste):
- Client ID & Secret von [dev.twitch.tv/console/apps](https://dev.twitch.tv/console/apps)

## Chat Commands

### Song Requests
| Command | Beschreibung |
|---------|-------------|
| `!sr <song>` | Song zur Queue hinzufügen |
| `!queue` | Queue anzeigen |
| `!currentsong` | Aktueller Song |
| `!skip` | Skip (Mod only) |
| `!wrongsong` | Eigenen Song entfernen |
| `!clearqueue` | Queue leeren (Mod) |

### Text-to-Speech
| Command | Beschreibung |
|---------|-------------|
| `!tts <text>` | TTS Nachricht senden |
| `!skiptts` | TTS überspringen (Mod) |
| `!ttson` / `!ttsoff` | TTS an/aus (Mod) |

### Viewer & Points
| Command | Beschreibung |
|---------|-------------|
| `!points` | Punkte anzeigen |
| `!watchtime` | Watch-Time anzeigen |
| `!top` | Top 5 Leaderboard |
| `!viewers` | Viewer-Anzahl |
| `!givepoints <user> <amount>` | Punkte geben (Mod) |

## Projektstruktur

```
Twitch-Chatbot/
├── app/
│   └── index.html          # Desktop UI
├── src/
│   ├── electron/
│   │   ├── main.ts         # Electron Main Process
│   │   └── preload.ts      # IPC Bridge
│   ├── bot/
│   │   └── TwitchBot.ts    # TMI.js Bot
│   ├── features/
│   │   ├── ViewerManager.ts
│   │   ├── SongRequestManager.ts
│   │   └── TTSManager.ts
│   ├── commands/
│   │   └── index.ts
│   ├── utils/
│   │   └── Database.ts
│   ├── types/
│   │   └── index.ts
│   └── config.ts
├── assets/                  # Icons
├── data/                    # User Data (auto-created)
└── package.json
```

## Building

```bash
# Windows Installer erstellen
npm run dist:win

# Output in ./release/
```

## Lizenz

MIT License
