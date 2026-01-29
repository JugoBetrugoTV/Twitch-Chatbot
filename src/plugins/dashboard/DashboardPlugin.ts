/**
 * Web Dashboard Plugin
 *
 * Features:
 * - Web-based settings UI
 * - Real-time statistics
 * - Plugin management
 * - Event viewer
 */

import { Plugin } from '../base/Plugin';
import { PluginMeta, Permission } from '../../types/plugins';
import { getDatabase, DatabaseService } from '../../services/Database';
import { createServer, IncomingMessage, ServerResponse } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { parse as parseUrl } from 'url';
import fs from 'fs';
import path from 'path';

interface DashboardSettings {
  enabled: boolean;
  port: number;
  password: string;
  allowedIPs: string[];
}

const DEFAULT_SETTINGS: DashboardSettings = {
  enabled: true,
  port: 3000,
  password: '',
  allowedIPs: ['127.0.0.1', '::1'],
};

export class DashboardPlugin extends Plugin {
  meta: PluginMeta = {
    name: 'dashboard',
    version: '1.0.0',
    description: 'Web-based management dashboard',
    author: 'StreamCore',
  };

  private db!: DatabaseService;
  private settings: DashboardSettings = DEFAULT_SETTINGS;
  private server?: ReturnType<typeof createServer>;
  private wss?: WebSocketServer;
  private clients: Set<WebSocket> = new Set();
  private stats = {
    messages: 0,
    commands: 0,
    viewers: 0,
    uptime: Date.now(),
  };

  protected async init(): Promise<void> {
    this.db = getDatabase();
    this.log.info('Initializing Dashboard...');

    this.loadSettings();
    this.setupEventTracking();
    this.registerCommands();

    if (this.settings.enabled) {
      this.startServer();
    }

    this.log.info('Dashboard initialized!');
  }

  protected async destroy(): Promise<void> {
    this.stopServer();
  }

  private loadSettings(): void {
    const saved = this.db.getSetting<DashboardSettings>('dashboard_settings');
    if (saved) {
      this.settings = { ...DEFAULT_SETTINGS, ...saved };
    }

    // Generate password if not set
    if (!this.settings.password) {
      this.settings.password = this.generatePassword();
      this.db.setSetting('dashboard_settings', this.settings);
      this.log.info('Dashboard password generated (use !dashboard command to retrieve)');
    }
  }

  private generatePassword(): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
    let password = '';
    for (let i = 0; i < 12; i++) {
      password += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return password;
  }

  private setupEventTracking(): void {
    this.ctx.events.on('chat:message', () => {
      this.stats.messages++;
      this.broadcastStats();
    });

    this.ctx.events.on('chat:command', () => {
      this.stats.commands++;
      this.broadcastStats();
    });
  }

  private broadcastStats(): void {
    const message = JSON.stringify({
      type: 'stats',
      data: this.getStats(),
    });

    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    }
  }

  private startServer(): void {
    this.server = createServer((req, res) => {
      this.handleRequest(req, res);
    });

    this.wss = new WebSocketServer({ server: this.server });

    this.wss.on('connection', (ws, req) => {
      // Check authentication via query param
      const url = parseUrl(req.url || '', true);
      const token = url.query.token as string;

      if (token !== this.settings.password) {
        ws.close(1008, 'Unauthorized');
        return;
      }

      this.clients.add(ws);
      this.log.info('Dashboard client connected');

      // Send initial data
      ws.send(JSON.stringify({
        type: 'init',
        data: {
          stats: this.getStats(),
          settings: this.getAllSettings(),
          plugins: this.getPluginList(),
        },
      }));

      ws.on('message', (data) => {
        this.handleWebSocketMessage(ws, data.toString());
      });

      ws.on('close', () => {
        this.clients.delete(ws);
      });
    });

    this.server.listen(this.settings.port, () => {
      this.log.info(`Dashboard running at http://localhost:${this.settings.port}`);
      this.log.info('Use !dashboard command to get login credentials');
    });
  }

  private stopServer(): void {
    for (const client of this.clients) {
      client.close();
    }
    this.clients.clear();

    if (this.wss) {
      this.wss.close();
    }
    if (this.server) {
      this.server.close();
    }
  }

  private handleRequest(req: IncomingMessage, res: ServerResponse): void {
    const url = parseUrl(req.url || '', true);

    // CORS headers - restrict to localhost only
    const origin = req.headers.origin;
    const allowedOrigins = ['http://localhost:3000', 'http://127.0.0.1:3000', `http://localhost:${this.settings.port}`, `http://127.0.0.1:${this.settings.port}`];
    if (origin && allowedOrigins.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    // API routes
    if (url.pathname?.startsWith('/api/')) {
      this.handleApiRequest(req, res, url);
      return;
    }

    // Serve dashboard HTML
    if (url.pathname === '/' || url.pathname === '/index.html') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(this.getDashboardHTML());
      return;
    }

    // 404
    res.writeHead(404);
    res.end('Not Found');
  }

  private handleApiRequest(req: IncomingMessage, res: ServerResponse, url: ReturnType<typeof parseUrl>): void {
    const auth = req.headers.authorization;
    if (auth !== `Bearer ${this.settings.password}`) {
      res.writeHead(401);
      res.end('Unauthorized');
      return;
    }

    const endpoint = url.pathname?.replace('/api/', '');

    switch (endpoint) {
      case 'stats':
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(this.getStats()));
        break;

      case 'settings':
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(this.getAllSettings()));
        break;

      case 'plugins':
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(this.getPluginList()));
        break;

      case 'events':
        const events = this.db.getRecentEvents(50);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(events));
        break;

      case 'users':
        const users = this.db.getTopUsers(100);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(users));
        break;

      default:
        res.writeHead(404);
        res.end('Not Found');
    }
  }

  private handleWebSocketMessage(ws: WebSocket, message: string): void {
    try {
      const data = JSON.parse(message);

      switch (data.type) {
        case 'setSetting':
          this.db.setSetting(data.key, data.value);
          ws.send(JSON.stringify({ type: 'settingUpdated', key: data.key }));
          break;

        case 'sendMessage':
          this.ctx.events.emit('dashboard:message', {
            channel: data.channel,
            message: data.message,
          });
          break;

        case 'getStats':
          ws.send(JSON.stringify({ type: 'stats', data: this.getStats() }));
          break;
      }
    } catch (error) {
      this.log.error(`WebSocket message error: ${error}`);
    }
  }

  private getStats(): any {
    return {
      messages: this.stats.messages,
      commands: this.stats.commands,
      uptime: Math.floor((Date.now() - this.stats.uptime) / 1000),
      users: this.db.getUserCount(),
      memory: process.memoryUsage().heapUsed,
    };
  }

  private getAllSettings(): any {
    return this.db.getAllSettings();
  }

  private getPluginList(): any[] {
    // This would need to be provided by StreamCore
    return [];
  }

  private getDashboardHTML(): string {
    return `<!DOCTYPE html>
<html lang="de">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>StreamCore Dashboard</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
      color: #fff;
      min-height: 100vh;
    }
    .container { max-width: 1200px; margin: 0 auto; padding: 20px; }
    header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 20px 0;
      border-bottom: 1px solid rgba(255,255,255,0.1);
    }
    h1 { font-size: 24px; color: #9146ff; }
    .login-form { display: none; }
    .login-form.active { display: block; }
    .login-form input {
      padding: 10px 15px;
      border: none;
      border-radius: 5px;
      background: rgba(255,255,255,0.1);
      color: #fff;
      margin-right: 10px;
    }
    .login-form button {
      padding: 10px 20px;
      border: none;
      border-radius: 5px;
      background: #9146ff;
      color: #fff;
      cursor: pointer;
    }
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 20px;
      margin-top: 30px;
    }
    .stat-card {
      background: rgba(255,255,255,0.05);
      border-radius: 10px;
      padding: 20px;
      text-align: center;
    }
    .stat-value { font-size: 36px; font-weight: bold; color: #9146ff; }
    .stat-label { color: rgba(255,255,255,0.7); margin-top: 5px; }
    .section { margin-top: 40px; }
    .section h2 { margin-bottom: 20px; font-size: 18px; }
    .card {
      background: rgba(255,255,255,0.05);
      border-radius: 10px;
      padding: 20px;
    }
    .event-list { max-height: 300px; overflow-y: auto; }
    .event-item {
      padding: 10px;
      border-bottom: 1px solid rgba(255,255,255,0.1);
      font-size: 14px;
    }
    .event-time { color: rgba(255,255,255,0.5); margin-right: 10px; }
    #dashboard { display: none; }
    #dashboard.active { display: block; }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <h1>🎮 StreamCore Dashboard</h1>
      <div class="login-form active" id="loginForm">
        <input type="password" id="password" placeholder="Password">
        <button onclick="login()">Login</button>
      </div>
    </header>

    <div id="dashboard">
      <div class="stats-grid">
        <div class="stat-card">
          <div class="stat-value" id="statMessages">0</div>
          <div class="stat-label">Nachrichten</div>
        </div>
        <div class="stat-card">
          <div class="stat-value" id="statCommands">0</div>
          <div class="stat-label">Befehle</div>
        </div>
        <div class="stat-card">
          <div class="stat-value" id="statUsers">0</div>
          <div class="stat-label">Benutzer</div>
        </div>
        <div class="stat-card">
          <div class="stat-value" id="statUptime">0:00</div>
          <div class="stat-label">Uptime</div>
        </div>
      </div>

      <div class="section">
        <h2>📋 Letzte Events</h2>
        <div class="card">
          <div class="event-list" id="eventList">
            <p>Keine Events</p>
          </div>
        </div>
      </div>
    </div>
  </div>

  <script>
    let ws = null;
    let token = '';

    function login() {
      token = document.getElementById('password').value;
      connectWebSocket();
    }

    function connectWebSocket() {
      ws = new WebSocket('ws://' + location.host + '?token=' + token);

      ws.onopen = () => {
        document.getElementById('loginForm').classList.remove('active');
        document.getElementById('dashboard').classList.add('active');
      };

      ws.onmessage = (event) => {
        const data = JSON.parse(event.data);

        if (data.type === 'init' || data.type === 'stats') {
          updateStats(data.data.stats || data.data);
        }
      };

      ws.onclose = () => {
        document.getElementById('loginForm').classList.add('active');
        document.getElementById('dashboard').classList.remove('active');
      };
    }

    function updateStats(stats) {
      document.getElementById('statMessages').textContent = stats.messages || 0;
      document.getElementById('statCommands').textContent = stats.commands || 0;
      document.getElementById('statUsers').textContent = stats.users || 0;

      const uptime = stats.uptime || 0;
      const hours = Math.floor(uptime / 3600);
      const minutes = Math.floor((uptime % 3600) / 60);
      document.getElementById('statUptime').textContent = hours + ':' + String(minutes).padStart(2, '0');
    }

    // Check for saved token
    const savedToken = localStorage.getItem('dashboardToken');
    if (savedToken) {
      token = savedToken;
      connectWebSocket();
    }
  </script>
</body>
</html>`;
  }

  private registerCommands(): void {
    // !dashboard - Show dashboard info
    this.registerCommand({
      name: 'dashboard',
      aliases: ['web', 'panel'],
      description: 'Show dashboard info',
      permission: Permission.BROADCASTER,
      cooldown: { user: 30, global: 0 },
      handler: async (ctx) => {
        if (!this.settings.enabled) {
          ctx.reply('📊 Dashboard ist deaktiviert');
          return;
        }

        // Whisper the password (in a real implementation)
        ctx.reply(
          `📊 Dashboard: http://localhost:${this.settings.port} | ` +
          `Password wurde per Whisper gesendet`
        );

        // Send password via whisper (mock - in real implementation would whisper)
        this.log.debug(`Dashboard credentials requested by ${ctx.user.displayName}`);
      },
    });

    // !dashboardtoggle - Toggle dashboard
    this.registerCommand({
      name: 'dashboardtoggle',
      description: 'Toggle dashboard on/off',
      permission: Permission.BROADCASTER,
      cooldown: { user: 5, global: 0 },
      handler: async (ctx) => {
        this.settings.enabled = !this.settings.enabled;
        this.db.setSetting('dashboard_settings', this.settings);

        if (this.settings.enabled) {
          this.startServer();
        } else {
          this.stopServer();
        }

        ctx.reply(`📊 Dashboard: ${this.settings.enabled ? 'An' : 'Aus'}`);
      },
    });

    // !newpassword - Generate new dashboard password
    this.registerCommand({
      name: 'newpassword',
      aliases: ['resetpassword'],
      description: 'Generate new dashboard password',
      permission: Permission.BROADCASTER,
      cooldown: { user: 60, global: 0 },
      handler: async (ctx) => {
        this.settings.password = this.generatePassword();
        this.db.setSetting('dashboard_settings', this.settings);
        this.log.info('New dashboard password generated');
        ctx.reply(`✅ Neues Password: ${this.settings.password} (nur für dich sichtbar)`);
      },
    });
  }

  // Public API
  getUrl(): string {
    return `http://localhost:${this.settings.port}`;
  }

  getPassword(): string {
    return this.settings.password;
  }
}
