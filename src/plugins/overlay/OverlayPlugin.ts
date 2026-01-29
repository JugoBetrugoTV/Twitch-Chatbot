/**
 * Overlay Plugin
 *
 * WebSocket server for OBS browser sources
 * Features:
 * - Real-time event streaming
 * - Custom overlays
 * - Alert overlays
 * - Chat overlay
 */

import { Plugin } from '../base/Plugin';
import { PluginMeta, Permission } from '../../types/plugins';
import { getDatabase, DatabaseService } from '../../services/Database';
import { WebSocketServer, WebSocket } from 'ws';
import * as http from 'http';

interface OverlayClient {
  ws: WebSocket;
  id: string;
  type: string;
  connectedAt: Date;
}

interface OverlayEvent {
  type: string;
  data: any;
  timestamp: number;
}

interface OverlaySettings {
  enabled: boolean;
  port: number;
  allowedOrigins: string[];
  pingInterval: number;
  maxClients: number;
}

const DEFAULT_SETTINGS: OverlaySettings = {
  enabled: true,
  port: 8080,
  allowedOrigins: ['*'],
  pingInterval: 30000,
  maxClients: 50,
};

export class OverlayPlugin extends Plugin {
  meta: PluginMeta = {
    name: 'overlay',
    version: '1.0.0',
    description: 'WebSocket server for OBS browser sources',
    author: 'StreamCore',
  };

  private db!: DatabaseService;
  private settings: OverlaySettings = DEFAULT_SETTINGS;
  private server: http.Server | null = null;
  private wss: WebSocketServer | null = null;
  private clients: Map<string, OverlayClient> = new Map();
  private pingInterval: ReturnType<typeof setInterval> | null = null;
  private eventHistory: OverlayEvent[] = [];
  private maxHistorySize = 100;

  protected async init(): Promise<void> {
    this.db = getDatabase();
    this.log.info('Initializing Overlay...');

    this.loadSettings();
    this.startServer();
    this.setupEventHandlers();
    this.registerCommands();

    this.log.info('Overlay initialized!');
  }

  protected async destroy(): Promise<void> {
    this.stopServer();
  }

  private loadSettings(): void {
    const saved = this.db.getSetting<OverlaySettings>('overlay_settings');
    if (saved) {
      this.settings = { ...DEFAULT_SETTINGS, ...saved };
    }
  }

  private saveSettings(): void {
    this.db.setSetting('overlay_settings', this.settings);
  }

  private startServer(): void {
    if (!this.settings.enabled) return;

    try {
      this.server = http.createServer((req, res) => {
        // Simple HTTP endpoint for health checks
        if (req.url === '/health') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'ok', clients: this.clients.size }));
          return;
        }

        // Serve overlay HTML templates
        if (req.url === '/alerts') {
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(this.getAlertsOverlayHTML());
          return;
        }

        if (req.url === '/chat') {
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(this.getChatOverlayHTML());
          return;
        }

        res.writeHead(404);
        res.end('Not found');
      });

      this.wss = new WebSocketServer({ server: this.server });

      this.wss.on('connection', (ws, req) => {
        this.handleConnection(ws, req);
      });

      this.server.listen(this.settings.port, () => {
        this.log.info(`Overlay WebSocket server started on port ${this.settings.port}`);
      });

      // Start ping interval
      this.pingInterval = setInterval(() => {
        this.pingClients();
      }, this.settings.pingInterval);

    } catch (error) {
      this.log.error(`Failed to start overlay server: ${error}`);
    }
  }

  private stopServer(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }

    for (const client of this.clients.values()) {
      client.ws.close();
    }
    this.clients.clear();

    if (this.wss) {
      this.wss.close();
      this.wss = null;
    }

    if (this.server) {
      this.server.close();
      this.server = null;
    }

    this.log.info('Overlay server stopped');
  }

  private handleConnection(ws: WebSocket, req: http.IncomingMessage): void {
    if (this.clients.size >= this.settings.maxClients) {
      ws.close(1013, 'Max clients reached');
      return;
    }

    const clientId = `client-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const overlayType = new URL(req.url || '', `http://localhost`).searchParams.get('type') || 'general';

    const client: OverlayClient = {
      ws,
      id: clientId,
      type: overlayType,
      connectedAt: new Date(),
    };

    this.clients.set(clientId, client);
    this.log.debug(`Overlay client connected: ${clientId} (${overlayType})`);

    // Send welcome message
    this.sendToClient(client, {
      type: 'connected',
      data: { clientId, serverTime: Date.now() },
      timestamp: Date.now(),
    });

    // Send recent events
    for (const event of this.eventHistory.slice(-10)) {
      this.sendToClient(client, event);
    }

    ws.on('message', (message) => {
      try {
        const data = JSON.parse(message.toString());
        this.handleClientMessage(client, data);
      } catch (error) {
        this.log.debug(`Invalid message from client ${clientId}`);
      }
    });

    ws.on('close', () => {
      this.clients.delete(clientId);
      this.log.debug(`Overlay client disconnected: ${clientId}`);
    });

    ws.on('error', (error) => {
      this.log.error(`WebSocket error for ${clientId}: ${error}`);
      this.clients.delete(clientId);
    });
  }

  private handleClientMessage(client: OverlayClient, data: any): void {
    switch (data.type) {
      case 'ping':
        this.sendToClient(client, { type: 'pong', data: {}, timestamp: Date.now() });
        break;

      case 'subscribe':
        // Could implement per-client event filtering here
        break;

      case 'test':
        // Send test event
        this.broadcast({
          type: 'test',
          data: { message: 'Test event from client' },
          timestamp: Date.now(),
        });
        break;
    }
  }

  private pingClients(): void {
    const now = Date.now();
    for (const [id, client] of this.clients) {
      if (client.ws.readyState === WebSocket.OPEN) {
        client.ws.ping();
      } else {
        this.clients.delete(id);
      }
    }
  }

  private sendToClient(client: OverlayClient, event: OverlayEvent): void {
    if (client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(JSON.stringify(event));
    }
  }

  private broadcast(event: OverlayEvent, filter?: (client: OverlayClient) => boolean): void {
    // Add to history
    this.eventHistory.push(event);
    if (this.eventHistory.length > this.maxHistorySize) {
      this.eventHistory.shift();
    }

    // Send to clients
    for (const client of this.clients.values()) {
      if (filter && !filter(client)) continue;
      this.sendToClient(client, event);
    }
  }

  private setupEventHandlers(): void {
    // Stream events
    const streamEvents = [
      'twitch:follow',
      'twitch:sub',
      'twitch:subgift',
      'twitch:submysterygift',
      'twitch:cheer',
      'twitch:raid',
      'chat:message',
      'sound:play',
      'hypetrain:start',
      'hypetrain:progress',
      'hypetrain:end',
      'poll:start',
      'poll:end',
      'prediction:start',
      'prediction:end',
      'achievement:unlocked',
      'level:up',
    ];

    for (const eventName of streamEvents) {
      this.ctx.events.on(eventName, (data: any) => {
        this.broadcast({
          type: eventName,
          data,
          timestamp: Date.now(),
        });
      });
    }
  }

  private getAlertsOverlayHTML(): string {
    const port = this.settings.port;
    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>StreamCore Alerts</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      background: transparent;
      font-family: 'Segoe UI', sans-serif;
      overflow: hidden;
    }
    .alert {
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%) scale(0);
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      padding: 30px 50px;
      border-radius: 20px;
      color: white;
      text-align: center;
      animation: alertIn 0.5s ease forwards;
      box-shadow: 0 20px 60px rgba(0,0,0,0.3);
    }
    .alert.hide { animation: alertOut 0.5s ease forwards; }
    .alert-icon { font-size: 48px; margin-bottom: 10px; }
    .alert-title { font-size: 28px; font-weight: bold; margin-bottom: 5px; }
    .alert-message { font-size: 18px; opacity: 0.9; }
    @keyframes alertIn {
      0% { transform: translate(-50%, -50%) scale(0) rotate(-10deg); opacity: 0; }
      100% { transform: translate(-50%, -50%) scale(1) rotate(0deg); opacity: 1; }
    }
    @keyframes alertOut {
      0% { transform: translate(-50%, -50%) scale(1); opacity: 1; }
      100% { transform: translate(-50%, -50%) scale(0); opacity: 0; }
    }
  </style>
</head>
<body>
  <div id="alerts"></div>
  <script>
    const ws = new WebSocket('ws://localhost:${port}?type=alerts');
    const container = document.getElementById('alerts');

    ws.onmessage = (e) => {
      const event = JSON.parse(e.data);
      handleEvent(event);
    };

    function handleEvent(event) {
      let icon = '', title = '', message = '';

      switch(event.type) {
        case 'twitch:follow':
          icon = '❤️'; title = 'Neuer Follower!'; message = event.data.displayName;
          break;
        case 'twitch:sub':
          icon = '⭐'; title = 'Neuer Sub!'; message = event.data.displayName;
          break;
        case 'twitch:subgift':
          icon = '🎁'; title = 'Gift Sub!';
          message = event.data.gifterDisplayName + ' → ' + event.data.displayName;
          break;
        case 'twitch:cheer':
          icon = '💎'; title = event.data.bits + ' Bits!'; message = event.data.displayName;
          break;
        case 'twitch:raid':
          icon = '🎯'; title = 'Raid!';
          message = event.data.displayName + ' mit ' + event.data.viewers + ' Viewern';
          break;
        default:
          return;
      }

      showAlert(icon, title, message);
    }

    function escapeHtml(text) {
      const div = document.createElement('div');
      div.textContent = text;
      return div.innerHTML;
    }

    function showAlert(icon, title, message) {
      const alert = document.createElement('div');
      alert.className = 'alert';
      alert.innerHTML = \`
        <div class="alert-icon">\${escapeHtml(icon)}</div>
        <div class="alert-title">\${escapeHtml(title)}</div>
        <div class="alert-message">\${escapeHtml(message)}</div>
      \`;
      container.appendChild(alert);

      setTimeout(() => {
        alert.classList.add('hide');
        setTimeout(() => alert.remove(), 500);
      }, 5000);
    }
  </script>
</body>
</html>`;
  }

  private getChatOverlayHTML(): string {
    const port = this.settings.port;
    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>StreamCore Chat</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      background: transparent;
      font-family: 'Segoe UI', sans-serif;
    }
    #chat {
      position: fixed;
      bottom: 0;
      left: 0;
      width: 100%;
      max-height: 100vh;
      overflow: hidden;
      display: flex;
      flex-direction: column-reverse;
    }
    .message {
      padding: 8px 12px;
      margin: 4px;
      background: rgba(0,0,0,0.6);
      border-radius: 8px;
      color: white;
      animation: fadeIn 0.3s ease;
    }
    .message-user { font-weight: bold; margin-right: 8px; }
    .message-text { word-wrap: break-word; }
    @keyframes fadeIn {
      from { opacity: 0; transform: translateY(10px); }
      to { opacity: 1; transform: translateY(0); }
    }
  </style>
</head>
<body>
  <div id="chat"></div>
  <script>
    const ws = new WebSocket('ws://localhost:${port}?type=chat');
    const chat = document.getElementById('chat');
    const maxMessages = 20;

    ws.onmessage = (e) => {
      const event = JSON.parse(e.data);
      if (event.type === 'chat:message') {
        addMessage(event.data);
      }
    };

    function addMessage(data) {
      const msg = document.createElement('div');
      msg.className = 'message';
      msg.innerHTML = \`
        <span class="message-user" style="color: \${data.color || '#fff'}">\${data.displayName}:</span>
        <span class="message-text">\${escapeHtml(data.message)}</span>
      \`;
      chat.insertBefore(msg, chat.firstChild);

      while (chat.children.length > maxMessages) {
        chat.removeChild(chat.lastChild);
      }
    }

    function escapeHtml(text) {
      const div = document.createElement('div');
      div.textContent = text;
      return div.innerHTML;
    }
  </script>
</body>
</html>`;
  }

  private registerCommands(): void {
    // !overlay - Show overlay info
    this.registerCommand({
      name: 'overlay',
      description: 'Show overlay connection info',
      permission: Permission.MODERATOR,
      cooldown: { user: 10, global: 5 },
      handler: async (ctx) => {
        ctx.reply(
          `📺 Overlay: Port ${this.settings.port} | ` +
          `${this.clients.size} Clients verbunden | ` +
          `Alerts: /alerts | Chat: /chat`
        );
      },
    });

    // !testoverlay - Send test event
    this.registerCommand({
      name: 'testoverlay',
      aliases: ['testalert'],
      description: 'Send test overlay event',
      permission: Permission.MODERATOR,
      cooldown: { user: 10, global: 5 },
      handler: async (ctx) => {
        const eventType = ctx.args[0] || 'follow';

        const testEvents: Record<string, any> = {
          follow: { type: 'twitch:follow', data: { displayName: 'TestUser', username: 'testuser' } },
          sub: { type: 'twitch:sub', data: { displayName: 'TestUser', tier: '1000' } },
          bits: { type: 'twitch:cheer', data: { displayName: 'TestUser', bits: 100 } },
          raid: { type: 'twitch:raid', data: { displayName: 'TestRaider', viewers: 50 } },
        };

        const event = testEvents[eventType];
        if (!event) {
          ctx.reply(`❌ Unbekannter Event-Typ. Verfügbar: ${Object.keys(testEvents).join(', ')}`);
          return;
        }

        this.broadcast({
          type: event.type,
          data: event.data,
          timestamp: Date.now(),
        });

        ctx.reply(`✅ Test-Event "${eventType}" gesendet`);
      },
    });

    // !overlayclients - Show connected clients
    this.registerCommand({
      name: 'overlayclients',
      description: 'Show connected overlay clients',
      permission: Permission.BROADCASTER,
      cooldown: { user: 0, global: 0 },
      handler: async (ctx) => {
        if (this.clients.size === 0) {
          ctx.reply('📺 Keine Overlay-Clients verbunden');
          return;
        }

        const types = new Map<string, number>();
        for (const client of this.clients.values()) {
          types.set(client.type, (types.get(client.type) || 0) + 1);
        }

        const list = Array.from(types.entries())
          .map(([type, count]) => `${type}: ${count}`)
          .join(', ');

        ctx.reply(`📺 Overlay Clients (${this.clients.size}): ${list}`);
      },
    });

    // !overlayport - Change port
    this.registerCommand({
      name: 'overlayport',
      description: 'Change overlay server port',
      usage: '!overlayport <port>',
      permission: Permission.BROADCASTER,
      cooldown: { user: 0, global: 0 },
      handler: async (ctx) => {
        const port = parseInt(ctx.args[0]);

        if (isNaN(port) || port < 1024 || port > 65535) {
          ctx.reply(`📺 Aktueller Port: ${this.settings.port}`);
          return;
        }

        this.settings.port = port;
        this.saveSettings();

        // Restart server
        this.stopServer();
        this.startServer();

        ctx.reply(`✅ Overlay-Port auf ${port} geändert (Server neugestartet)`);
      },
    });
  }

  // Public API
  getClientCount(): number {
    return this.clients.size;
  }

  sendEvent(type: string, data: any): void {
    this.broadcast({
      type,
      data,
      timestamp: Date.now(),
    });
  }

  getServerUrl(): string {
    return `ws://localhost:${this.settings.port}`;
  }
}
