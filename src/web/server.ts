import express from 'express';
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import path from 'path';
import { config } from '../config';
import { TwitchBot } from '../bot/TwitchBot';
import { SongRequestManager } from '../features/SongRequestManager';
import { TTSManager } from '../features/TTSManager';
import { ViewerManager } from '../features/ViewerManager';

export class WebServer {
  private app: express.Application;
  private httpServer: ReturnType<typeof createServer>;
  private io: SocketIOServer;
  private bot: TwitchBot;
  private songManager: SongRequestManager;
  private ttsManager: TTSManager;
  private viewerManager: ViewerManager;

  constructor(
    bot: TwitchBot,
    songManager: SongRequestManager,
    ttsManager: TTSManager,
    viewerManager: ViewerManager
  ) {
    this.bot = bot;
    this.songManager = songManager;
    this.ttsManager = ttsManager;
    this.viewerManager = viewerManager;

    this.app = express();
    this.httpServer = createServer(this.app);
    this.io = new SocketIOServer(this.httpServer, {
      cors: {
        origin: '*',
        methods: ['GET', 'POST'],
      },
    });

    this.setupMiddleware();
    this.setupRoutes();
    this.setupSocketEvents();
    this.setupBotEvents();
  }

  private setupMiddleware(): void {
    this.app.use(express.json());
    this.app.use(express.static(path.join(__dirname, '../../public')));
  }

  private setupRoutes(): void {
    // API Routes
    this.app.get('/api/stats', (req, res) => {
      res.json(this.bot.getStats());
    });

    this.app.get('/api/viewers', (req, res) => {
      res.json({
        online: this.viewerManager.getOnlineViewers(),
        count: this.viewerManager.getOnlineViewerCount(),
        all: this.viewerManager.getAllViewers(),
      });
    });

    this.app.get('/api/songs/queue', (req, res) => {
      res.json({
        queue: this.songManager.getQueue(),
        current: this.songManager.getCurrentSong(),
        isPlaying: this.songManager.isCurrentlyPlaying(),
      });
    });

    this.app.post('/api/songs/skip', (req, res) => {
      const skipped = this.songManager.skip();
      res.json({ success: true, skipped });
    });

    this.app.post('/api/songs/play', async (req, res) => {
      const song = await this.songManager.playNext();
      res.json({ success: true, song });
    });

    this.app.delete('/api/songs/queue/:index', (req, res) => {
      const index = parseInt(req.params.index, 10);
      const removed = this.songManager.removeFromQueue(index);
      res.json({ success: !!removed, removed });
    });

    this.app.get('/api/tts/queue', (req, res) => {
      res.json({
        queue: this.ttsManager.getQueue(),
        current: this.ttsManager.getCurrentMessage(),
        enabled: this.ttsManager.isEnabled(),
      });
    });

    this.app.post('/api/tts/skip', (req, res) => {
      this.ttsManager.skip();
      res.json({ success: true });
    });

    this.app.post('/api/tts/toggle', (req, res) => {
      const enabled = !this.ttsManager.isEnabled();
      this.ttsManager.setEnabled(enabled);
      res.json({ success: true, enabled });
    });

    this.app.get('/api/tts/audio', async (req, res) => {
      const text = req.query.text as string;
      if (!text) {
        res.status(400).json({ error: 'Text parameter required' });
        return;
      }

      const base64 = await this.ttsManager.getAudioBase64(text);
      if (base64) {
        res.json({ audio: base64 });
      } else {
        res.status(500).json({ error: 'Failed to generate audio' });
      }
    });

    this.app.get('/api/messages', (req, res) => {
      res.json(this.bot.getRecentMessages());
    });

    this.app.get('/api/commands', (req, res) => {
      res.json(
        this.bot.getCommands().map((c) => ({
          name: c.name,
          aliases: c.aliases,
          description: c.description,
          usage: c.usage,
          modOnly: c.modOnly,
          enabled: c.enabled,
        }))
      );
    });

    // Serve dashboard
    this.app.get('/', (req, res) => {
      res.sendFile(path.join(__dirname, '../../public/index.html'));
    });

    // TTS overlay page (for OBS browser source)
    this.app.get('/overlay/tts', (req, res) => {
      res.sendFile(path.join(__dirname, '../../public/overlay-tts.html'));
    });

    // Song request overlay
    this.app.get('/overlay/songs', (req, res) => {
      res.sendFile(path.join(__dirname, '../../public/overlay-songs.html'));
    });
  }

  private setupSocketEvents(): void {
    this.io.on('connection', (socket) => {
      console.log('🔌 Dashboard client connected');

      // Send initial state
      socket.emit('init', {
        stats: this.bot.getStats(),
        viewers: {
          online: this.viewerManager.getOnlineViewers(),
          count: this.viewerManager.getOnlineViewerCount(),
        },
        songs: {
          queue: this.songManager.getQueue(),
          current: this.songManager.getCurrentSong(),
        },
        tts: {
          queue: this.ttsManager.getQueue(),
          enabled: this.ttsManager.isEnabled(),
        },
        messages: this.bot.getRecentMessages(),
      });

      // Handle client events
      socket.on('song:skip', () => {
        this.songManager.skip();
      });

      socket.on('song:play', () => {
        this.songManager.playNext();
      });

      socket.on('song:remove', (index: number) => {
        this.songManager.removeFromQueue(index);
      });

      socket.on('tts:skip', () => {
        this.ttsManager.skip();
      });

      socket.on('tts:toggle', () => {
        this.ttsManager.setEnabled(!this.ttsManager.isEnabled());
      });

      socket.on('tts:playbackComplete', () => {
        this.ttsManager.notifyPlaybackComplete();
      });

      socket.on('disconnect', () => {
        console.log('🔌 Dashboard client disconnected');
      });
    });
  }

  private setupBotEvents(): void {
    // Chat messages
    this.bot.on('message', (message) => {
      this.io.emit('chat:message', message);
    });

    // Bot connection
    this.bot.on('connected', (data) => {
      this.io.emit('bot:connected', data);
    });

    this.bot.on('disconnected', (reason) => {
      this.io.emit('bot:disconnected', reason);
    });

    // Viewer events
    this.viewerManager.on('viewersUpdated', (viewers) => {
      this.io.emit('viewers:updated', {
        online: viewers,
        count: viewers.length,
      });
    });

    this.viewerManager.on('userJoined', (username) => {
      this.io.emit('viewers:joined', username);
    });

    this.viewerManager.on('userLeft', (username) => {
      this.io.emit('viewers:left', username);
    });

    // Song events
    this.songManager.on('songAdded', (song) => {
      this.io.emit('songs:added', song);
    });

    this.songManager.on('songStarted', (song) => {
      this.io.emit('songs:started', song);
    });

    this.songManager.on('songSkipped', (song) => {
      this.io.emit('songs:skipped', song);
    });

    this.songManager.on('songRemoved', (song) => {
      this.io.emit('songs:removed', song);
    });

    this.songManager.on('queueCleared', () => {
      this.io.emit('songs:queueCleared');
    });

    // TTS events
    this.ttsManager.on('messageQueued', (message) => {
      this.io.emit('tts:queued', message);
    });

    this.ttsManager.on('playMessage', (data) => {
      this.io.emit('tts:play', data);
    });

    this.ttsManager.on('messageComplete', (message) => {
      this.io.emit('tts:complete', message);
    });

    this.ttsManager.on('messageSkipped', (message) => {
      this.io.emit('tts:skipped', message);
    });

    this.ttsManager.on('enabledChanged', (enabled) => {
      this.io.emit('tts:enabledChanged', enabled);
    });
  }

  public start(): void {
    this.httpServer.listen(config.web.port, () => {
      console.log(`🌐 Web dashboard running at http://localhost:${config.web.port}`);
      console.log(`📺 TTS Overlay: http://localhost:${config.web.port}/overlay/tts`);
      console.log(`🎵 Song Overlay: http://localhost:${config.web.port}/overlay/songs`);
    });
  }

  public stop(): void {
    this.httpServer.close();
  }
}
