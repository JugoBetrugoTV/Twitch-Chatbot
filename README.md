# Twitch Chatbot

Ein Feature-reicher Twitch Chatbot inspiriert von Deepbot und Streamlabs. Enthält Song Requests, Text-to-Speech, Viewer-Tracking, Points-System und ein Web-Dashboard.

## Features

### Chat & Viewer Management
- Echtzeit Chat-Verbindung via TMI.js
- Viewer-Liste mit Online-Status
- Punkte-System (wie Deepbot)
- Watch-Time Tracking
- Subscriber/VIP/Mod Erkennung

### Song Requests
- YouTube Song Requests via Chat (`!sr`)
- Song-Queue Management
- Skip, Remove, Clear Funktionen
- OBS Overlay für aktuelle Songs
- Maximale Song-Länge konfigurierbar

### Text-to-Speech (TTS)
- Google TTS Integration (wie speechchat.com)
- Chat-Nachrichten vorlesen lassen
- Wortfilter & User-Blacklist
- OBS Overlay für TTS-Anzeige
- Mehrsprachig (Standard: Deutsch)

### Web-Dashboard
- Live Chat-Ansicht
- Song Queue Management
- TTS Kontrolle
- Viewer-Statistiken
- OBS Browser Source Overlays

## Installation

### Voraussetzungen
- Node.js 18+
- npm oder yarn

### Setup

1. **Repository klonen**
```bash
git clone https://github.com/yourusername/Twitch-Chatbot.git
cd Twitch-Chatbot
```

2. **Dependencies installieren**
```bash
npm install
```

3. **Konfiguration erstellen**
```bash
cp .env.example .env
```

4. **`.env` Datei ausfüllen**

```env
# Twitch Bot Credentials
# OAuth Token von: https://twitchapps.com/tmi/
TWITCH_BOT_USERNAME=dein_bot_name
TWITCH_OAUTH_TOKEN=oauth:dein_token_hier
TWITCH_CHANNEL=dein_kanal_name

# Twitch API (für Viewer-Liste)
# App erstellen: https://dev.twitch.tv/console/apps
TWITCH_CLIENT_ID=deine_client_id
TWITCH_CLIENT_SECRET=dein_client_secret

# Web Dashboard
WEB_PORT=3000

# TTS Einstellungen
TTS_ENABLED=true
TTS_LANGUAGE=de

# Song Request Einstellungen
SONGREQUEST_ENABLED=true
SONGREQUEST_MAX_DURATION=600
```

5. **Bot starten**
```bash
# Development (mit Hot-Reload)
npm run dev

# Production
npm run build
npm start
```

## Chat Commands

### Song Requests
| Command | Beschreibung |
|---------|-------------|
| `!sr <song>` | Song zur Queue hinzufügen |
| `!queue` | Aktuelle Queue anzeigen |
| `!currentsong` | Aktuellen Song anzeigen |
| `!skip` | Song überspringen (Mod) |
| `!wrongsong` | Eigenen Request entfernen |
| `!clearqueue` | Queue leeren (Mod) |

### Text-to-Speech
| Command | Beschreibung |
|---------|-------------|
| `!tts <text>` | TTS Nachricht senden |
| `!skiptts` | TTS überspringen (Mod) |
| `!ttson` / `!ttsoff` | TTS aktivieren/deaktivieren (Mod) |

### Viewer & Points
| Command | Beschreibung |
|---------|-------------|
| `!points` | Eigene Punkte anzeigen |
| `!watchtime` | Eigene Watch-Time anzeigen |
| `!top` | Top 5 Viewer anzeigen |
| `!viewers` | Aktuelle Viewer-Anzahl |
| `!givepoints <user> <amount>` | Punkte vergeben (Mod) |

### Allgemein
| Command | Beschreibung |
|---------|-------------|
| `!commands` | Alle Commands anzeigen |
| `!uptime` | Bot Uptime anzeigen |

## OBS Integration

### TTS Overlay
1. In OBS eine Browser Source hinzufügen
2. URL: `http://localhost:3000/overlay/tts`
3. Breite: 800, Höhe: 200
4. Transparenter Hintergrund aktivieren

### Song Request Overlay
1. In OBS eine Browser Source hinzufügen
2. URL: `http://localhost:3000/overlay/songs`
3. Breite: 400, Höhe: 300
4. Transparenter Hintergrund aktivieren

## Dashboard

Das Web-Dashboard ist erreichbar unter `http://localhost:3000`

Features:
- Live Chat Monitor
- Song Queue Verwaltung
- TTS Ein/Aus Schalter
- Viewer Liste
- Bot Statistiken

## Projektstruktur

```
Twitch-Chatbot/
├── src/
│   ├── bot/
│   │   └── TwitchBot.ts       # Haupt-Bot Klasse
│   ├── commands/
│   │   └── index.ts           # Chat Commands
│   ├── features/
│   │   ├── ViewerManager.ts   # Viewer Tracking
│   │   ├── SongRequestManager.ts
│   │   └── TTSManager.ts
│   ├── utils/
│   │   └── Database.ts        # JSON Datenbank
│   ├── web/
│   │   └── server.ts          # Express + Socket.IO
│   ├── types/
│   │   └── index.ts           # TypeScript Types
│   ├── config.ts              # Konfiguration
│   └── index.ts               # Entry Point
├── public/
│   ├── index.html             # Dashboard
│   ├── overlay-tts.html       # TTS Overlay
│   └── overlay-songs.html     # Song Overlay
├── data/                      # Datenbank Dateien
├── .env.example
├── package.json
└── tsconfig.json
```

## Lizenz

MIT License
