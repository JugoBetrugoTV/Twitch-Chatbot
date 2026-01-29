/**
 * REST API Service
 *
 * Features:
 * - HTTP endpoints for external apps
 * - Bot status and statistics
 * - Command execution
 * - Plugin management
 * - WebSocket for real-time updates
 */

import { createServer, Server, IncomingMessage, ServerResponse } from 'http';
import { URL } from 'url';
import { Logger } from '../utils/logger';

interface APIRequest {
  method: string;
  path: string;
  params: Record<string, string>;
  query: URLSearchParams;
  body: any;
  headers: Record<string, string>;
}

interface APIResponse {
  status: number;
  data?: any;
  error?: string;
}

type RouteHandler = (req: APIRequest) => Promise<APIResponse> | APIResponse;

interface Route {
  method: string;
  pattern: RegExp;
  paramNames: string[];
  handler: RouteHandler;
}

export interface RestAPIConfig {
  port: number;
  host: string;
  apiKey?: string;
  enableCORS: boolean;
  rateLimitPerMinute: number;
}

const DEFAULT_CONFIG: RestAPIConfig = {
  port: 3000,
  host: '127.0.0.1',
  enableCORS: true,
  rateLimitPerMinute: 60,
};

export class RestAPIService {
  private log = new Logger('RestAPI');
  private server?: Server;
  private config: RestAPIConfig;
  private routes: Route[] = [];
  private rateLimitMap: Map<string, number[]> = new Map();
  private botContext?: any;

  constructor(config: Partial<RestAPIConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  setBotContext(ctx: any): void {
    this.botContext = ctx;
  }

  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = createServer((req, res) => this.handleRequest(req, res));

      this.server.on('error', (error) => {
        this.log.error(`Server error: ${error}`);
        reject(error);
      });

      this.server.listen(this.config.port, this.config.host, () => {
        this.log.info(`REST API listening on http://${this.config.host}:${this.config.port}`);
        this.registerDefaultRoutes();
        resolve();
      });
    });
  }

  stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => {
          this.log.info('REST API server stopped');
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const startTime = Date.now();

    // CORS - restrict to localhost only for security
    if (this.config.enableCORS) {
      const origin = req.headers.origin;
      const allowedOrigins = [
        `http://localhost:${this.config.port}`,
        `http://127.0.0.1:${this.config.port}`,
        'http://localhost:3000',
        'http://127.0.0.1:3000',
      ];
      if (origin && allowedOrigins.includes(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
      }
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-API-Key');
    }

    // Handle preflight
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    try {
      // Parse request
      const url = new URL(req.url || '/', `http://${req.headers.host}`);
      const clientIP = req.socket.remoteAddress || 'unknown';

      // Rate limiting
      if (!this.checkRateLimit(clientIP)) {
        this.sendResponse(res, { status: 429, error: 'Rate limit exceeded' });
        return;
      }

      // API Key check
      if (this.config.apiKey) {
        const providedKey = req.headers['x-api-key'] || url.searchParams.get('api_key');
        if (providedKey !== this.config.apiKey) {
          this.sendResponse(res, { status: 401, error: 'Invalid API key' });
          return;
        }
      }

      // Parse body
      let body: any = null;
      if (req.method === 'POST' || req.method === 'PUT') {
        body = await this.parseBody(req);
      }

      // Find route
      const apiRequest: APIRequest = {
        method: req.method || 'GET',
        path: url.pathname,
        params: {},
        query: url.searchParams,
        body,
        headers: req.headers as Record<string, string>,
      };

      const route = this.findRoute(apiRequest);

      if (!route) {
        this.sendResponse(res, { status: 404, error: 'Not found' });
        return;
      }

      // Execute handler
      const response = await route.handler(apiRequest);
      this.sendResponse(res, response);

      // Log request
      const duration = Date.now() - startTime;
      this.log.info(`${apiRequest.method} ${apiRequest.path} - ${response.status} (${duration}ms)`);

    } catch (error) {
      this.log.error(`Request error: ${error}`);
      this.sendResponse(res, { status: 500, error: 'Internal server error' });
    }
  }

  private parseBody(req: IncomingMessage): Promise<any> {
    return new Promise((resolve, reject) => {
      let data = '';

      req.on('data', (chunk) => {
        data += chunk;
        // Limit body size
        if (data.length > 1024 * 1024) {
          reject(new Error('Request body too large'));
        }
      });

      req.on('end', () => {
        try {
          resolve(data ? JSON.parse(data) : null);
        } catch {
          resolve(data);
        }
      });

      req.on('error', reject);
    });
  }

  private findRoute(req: APIRequest): { handler: RouteHandler; params: Record<string, string> } | null {
    for (const route of this.routes) {
      if (route.method !== req.method && route.method !== '*') continue;

      const match = req.path.match(route.pattern);
      if (match) {
        const params: Record<string, string> = {};
        route.paramNames.forEach((name, index) => {
          params[name] = match[index + 1];
        });
        req.params = params;
        return { handler: route.handler, params };
      }
    }
    return null;
  }

  private sendResponse(res: ServerResponse, response: APIResponse): void {
    res.setHeader('Content-Type', 'application/json');
    res.writeHead(response.status);
    res.end(JSON.stringify(response.error ? { error: response.error } : response.data));
  }

  private checkRateLimit(ip: string): boolean {
    const now = Date.now();
    const windowMs = 60000;

    let timestamps = this.rateLimitMap.get(ip) || [];
    timestamps = timestamps.filter((t) => now - t < windowMs);

    if (timestamps.length >= this.config.rateLimitPerMinute) {
      return false;
    }

    timestamps.push(now);
    this.rateLimitMap.set(ip, timestamps);
    return true;
  }

  // Route registration
  addRoute(method: string, path: string, handler: RouteHandler): void {
    const paramNames: string[] = [];
    const patternStr = path.replace(/:(\w+)/g, (_, name) => {
      paramNames.push(name);
      return '([^/]+)';
    });

    this.routes.push({
      method: method.toUpperCase(),
      pattern: new RegExp(`^${patternStr}$`),
      paramNames,
      handler,
    });

    this.log.info(`Route registered: ${method.toUpperCase()} ${path}`);
  }

  get(path: string, handler: RouteHandler): void {
    this.addRoute('GET', path, handler);
  }

  post(path: string, handler: RouteHandler): void {
    this.addRoute('POST', path, handler);
  }

  put(path: string, handler: RouteHandler): void {
    this.addRoute('PUT', path, handler);
  }

  delete(path: string, handler: RouteHandler): void {
    this.addRoute('DELETE', path, handler);
  }

  private registerDefaultRoutes(): void {
    // Health check
    this.get('/api/health', () => ({
      status: 200,
      data: { status: 'ok', timestamp: new Date().toISOString() },
    }));

    // Bot status
    this.get('/api/status', () => {
      if (!this.botContext) {
        return { status: 503, error: 'Bot not initialized' };
      }

      return {
        status: 200,
        data: {
          online: true,
          uptime: process.uptime(),
          memory: process.memoryUsage(),
          plugins: this.botContext.getPlugins?.()?.length || 0,
          commands: this.botContext.getCommands?.()?.length || 0,
        },
      };
    });

    // List plugins
    this.get('/api/plugins', () => {
      if (!this.botContext) {
        return { status: 503, error: 'Bot not initialized' };
      }

      const plugins = this.botContext.getPlugins?.() || [];
      return {
        status: 200,
        data: plugins.map((p: any) => ({
          name: p.meta?.name,
          version: p.meta?.version,
          description: p.meta?.description,
        })),
      };
    });

    // List commands
    this.get('/api/commands', () => {
      if (!this.botContext) {
        return { status: 503, error: 'Bot not initialized' };
      }

      const commands = this.botContext.getCommands?.() || [];
      return {
        status: 200,
        data: commands.map((c: any) => ({
          name: c.name,
          aliases: c.aliases,
          description: c.description,
          usage: c.usage,
          permission: c.permission,
        })),
      };
    });

    // Execute command
    this.post('/api/command', (req) => {
      if (!this.botContext) {
        return { status: 503, error: 'Bot not initialized' };
      }

      const { command, args, channel } = req.body || {};

      if (!command) {
        return { status: 400, error: 'Command required' };
      }

      // Emit command event
      this.botContext.events?.emit('api:command', {
        command,
        args: args || [],
        channel: channel || process.env.TWITCH_CHANNEL,
        source: 'api',
      });

      return {
        status: 200,
        data: { message: 'Command queued', command, args },
      };
    });

    // Send chat message
    this.post('/api/chat', (req) => {
      if (!this.botContext) {
        return { status: 503, error: 'Bot not initialized' };
      }

      const { message, channel } = req.body || {};

      if (!message) {
        return { status: 400, error: 'Message required' };
      }

      this.botContext.chat?.send(message, channel);

      return {
        status: 200,
        data: { message: 'Message sent' },
      };
    });

    // Get settings
    this.get('/api/settings/:key', (req) => {
      if (!this.botContext) {
        return { status: 503, error: 'Bot not initialized' };
      }

      const value = this.botContext.db?.getSetting(req.params.key);

      if (value === undefined) {
        return { status: 404, error: 'Setting not found' };
      }

      return {
        status: 200,
        data: { key: req.params.key, value },
      };
    });

    // Update settings
    this.put('/api/settings/:key', (req) => {
      if (!this.botContext) {
        return { status: 503, error: 'Bot not initialized' };
      }

      const { value } = req.body || {};

      if (value === undefined) {
        return { status: 400, error: 'Value required' };
      }

      this.botContext.db?.setSetting(req.params.key, value);

      return {
        status: 200,
        data: { key: req.params.key, value, updated: true },
      };
    });

    // Get statistics
    this.get('/api/stats', () => {
      if (!this.botContext) {
        return { status: 503, error: 'Bot not initialized' };
      }

      return {
        status: 200,
        data: {
          uptime: process.uptime(),
          memoryUsage: process.memoryUsage(),
          cpuUsage: process.cpuUsage(),
        },
      };
    });

    // Events endpoint (for polling)
    this.get('/api/events', () => {
      // In a full implementation, this would return recent events
      return {
        status: 200,
        data: {
          events: [],
          message: 'Use WebSocket for real-time events',
        },
      };
    });

    this.log.info('Default routes registered');
  }

  // Utility to register plugin-specific routes
  registerPluginRoute(plugin: string, method: string, path: string, handler: RouteHandler): void {
    this.addRoute(method, `/api/plugins/${plugin}${path}`, handler);
  }
}

// Singleton instance
let apiInstance: RestAPIService | null = null;

export function getRestAPI(config?: Partial<RestAPIConfig>): RestAPIService {
  if (!apiInstance) {
    apiInstance = new RestAPIService(config);
  }
  return apiInstance;
}

export function createRestAPI(config?: Partial<RestAPIConfig>): RestAPIService {
  return new RestAPIService(config);
}
