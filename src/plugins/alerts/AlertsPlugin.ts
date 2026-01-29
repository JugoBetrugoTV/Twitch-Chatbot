/**
 * Alerts Plugin (OBS Browser Source)
 *
 * Features:
 * - Follow/Sub/Raid/Cheer alerts
 * - Customizable alert styles
 * - WebSocket server for OBS
 * - Alert queue with sounds
 */

import { Plugin } from '../base/Plugin';
import { PluginMeta, Permission } from '../../types/plugins';
import { getDatabase, DatabaseService } from '../../services/Database';
import { createServer, Server as HTTPServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';

interface Alert {
  id: string;
  type: 'follow' | 'sub' | 'resub' | 'giftsub' | 'raid' | 'cheer' | 'custom';
  username: string;
  message?: string;
  amount?: number;
  tier?: number;
  duration: number;
  sound?: string;
  image?: string;
  timestamp: Date;
}

interface AlertSettings {
  enabled: boolean;
  port: number;
  followAlert: {
    enabled: boolean;
    message: string;
    sound: string;
    duration: number;
    minFollowerCount: number;
  };
  subAlert: {
    enabled: boolean;
    message: string;
    sound: string;
    duration: number;
  };
  raidAlert: {
    enabled: boolean;
    message: string;
    sound: string;
    duration: number;
    minViewers: number;
  };
  cheerAlert: {
    enabled: boolean;
    message: string;
    sound: string;
    duration: number;
    minBits: number;
  };
}

const DEFAULT_SETTINGS: AlertSettings = {
  enabled: true,
  port: 8765,
  followAlert: {
    enabled: true,
    message: '{user} folgt jetzt!',
    sound: 'follow.mp3',
    duration: 5,
    minFollowerCount: 0,
  },
  subAlert: {
    enabled: true,
    message: '{user} hat abonniert!',
    sound: 'sub.mp3',
    duration: 7,
  },
  raidAlert: {
    enabled: true,
    message: '{user} raidet mit {amount} Zuschauern!',
    sound: 'raid.mp3',
    duration: 10,
    minViewers: 1,
  },
  cheerAlert: {
    enabled: true,
    message: '{user} cheert {amount} Bits!',
    sound: 'cheer.mp3',
    duration: 5,
    minBits: 1,
  },
};

export class AlertsPlugin extends Plugin {
  meta: PluginMeta = {
    name: 'alerts',
    version: '1.0.0',
    description: 'OBS alerts via WebSocket',
    author: 'StreamCore',
  };

  private db!: DatabaseService;
  private settings: AlertSettings = DEFAULT_SETTINGS;
  private httpServer?: HTTPServer;
  private wss?: WebSocketServer;
  private clients: Set<WebSocket> = new Set();
  private alertQueue: Alert[] = [];
  private isProcessing = false;

  protected async init(): Promise<void> {
    this.db = getDatabase();
    this.log.info('Initializing Alerts...');

    this.loadSettings();
    this.setupEventHandlers();
    this.registerCommands();

    if (this.settings.enabled) {
      this.startServer();
    }

    this.log.info('Alerts initialized!');
  }

  protected async destroy(): Promise<void> {
    this.stopServer();
  }

  private loadSettings(): void {
    const saved = this.db.getSetting<AlertSettings>('alerts_settings');
    if (saved) {
      this.settings = { ...DEFAULT_SETTINGS, ...saved };
    }
  }

  private saveSettings(): void {
    this.db.setSetting('alerts_settings', this.settings);
  }

  private startServer(): void {
    try {
      this.httpServer = createServer();
      this.wss = new WebSocketServer({ server: this.httpServer });

      this.wss.on('connection', (ws) => {
        this.clients.add(ws);
        this.log.info(`Alert client connected (${this.clients.size} total)`);

        ws.on('close', () => {
          this.clients.delete(ws);
          this.log.info(`Alert client disconnected (${this.clients.size} total)`);
        });

        // Send current settings
        ws.send(JSON.stringify({ type: 'settings', data: this.settings }));
      });

      this.httpServer.listen(this.settings.port, () => {
        this.log.info(`Alert server listening on port ${this.settings.port}`);
      });
    } catch (error) {
      this.log.error(`Failed to start alert server: ${error}`);
    }
  }

  private stopServer(): void {
    for (const client of this.clients) {
      client.close();
    }
    this.clients.clear();

    if (this.wss) {
      this.wss.close();
    }
    if (this.httpServer) {
      this.httpServer.close();
    }
  }

  private setupEventHandlers(): void {
    // Follow alerts
    this.ctx.events.on('twitch:follow', (event: any) => {
      if (this.settings.followAlert.enabled) {
        this.queueAlert({
          id: `alert_${Date.now()}`,
          type: 'follow',
          username: event.user.displayName,
          duration: this.settings.followAlert.duration,
          sound: this.settings.followAlert.sound,
          timestamp: new Date(),
        });
      }
    });

    // Subscription alerts
    this.ctx.events.on('twitch:subscription', (event: any) => {
      if (this.settings.subAlert.enabled) {
        this.queueAlert({
          id: `alert_${Date.now()}`,
          type: event.months > 1 ? 'resub' : 'sub',
          username: event.user.displayName,
          message: event.message,
          amount: event.months,
          tier: event.tier,
          duration: this.settings.subAlert.duration,
          sound: this.settings.subAlert.sound,
          timestamp: new Date(),
        });
      }
    });

    // Gift sub alerts
    this.ctx.events.on('twitch:gift', (event: any) => {
      if (this.settings.subAlert.enabled) {
        this.queueAlert({
          id: `alert_${Date.now()}`,
          type: 'giftsub',
          username: event.user.displayName,
          amount: event.amount,
          tier: event.tier,
          duration: this.settings.subAlert.duration,
          sound: this.settings.subAlert.sound,
          timestamp: new Date(),
        });
      }
    });

    // Raid alerts
    this.ctx.events.on('twitch:raid', (event: any) => {
      if (this.settings.raidAlert.enabled && event.viewers >= this.settings.raidAlert.minViewers) {
        this.queueAlert({
          id: `alert_${Date.now()}`,
          type: 'raid',
          username: event.user.displayName || event.user.username,
          amount: event.viewers,
          duration: this.settings.raidAlert.duration,
          sound: this.settings.raidAlert.sound,
          timestamp: new Date(),
        });
      }
    });

    // Cheer alerts
    this.ctx.events.on('twitch:cheer', (event: any) => {
      if (this.settings.cheerAlert.enabled && event.bits >= this.settings.cheerAlert.minBits) {
        this.queueAlert({
          id: `alert_${Date.now()}`,
          type: 'cheer',
          username: event.user.displayName,
          message: event.message,
          amount: event.bits,
          duration: this.settings.cheerAlert.duration,
          sound: this.settings.cheerAlert.sound,
          timestamp: new Date(),
        });
      }
    });
  }

  private queueAlert(alert: Alert): void {
    this.alertQueue.push(alert);
    this.processQueue();
  }

  private async processQueue(): Promise<void> {
    if (this.isProcessing || this.alertQueue.length === 0) return;

    this.isProcessing = true;

    while (this.alertQueue.length > 0) {
      const alert = this.alertQueue.shift()!;
      await this.sendAlert(alert);

      // Wait for alert duration
      await new Promise((resolve) => setTimeout(resolve, alert.duration * 1000));
    }

    this.isProcessing = false;
  }

  private sendAlert(alert: Alert): Promise<void> {
    const message = JSON.stringify({
      type: 'alert',
      data: {
        ...alert,
        formattedMessage: this.formatAlertMessage(alert),
      },
    });

    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    }

    this.log.info(`Alert sent: ${alert.type} - ${alert.username}`);
    this.db.logEvent('alert', alert);

    return Promise.resolve();
  }

  private formatAlertMessage(alert: Alert): string {
    let template: string;

    switch (alert.type) {
      case 'follow':
        template = this.settings.followAlert.message;
        break;
      case 'sub':
      case 'resub':
      case 'giftsub':
        template = this.settings.subAlert.message;
        break;
      case 'raid':
        template = this.settings.raidAlert.message;
        break;
      case 'cheer':
        template = this.settings.cheerAlert.message;
        break;
      default:
        template = '{user}';
    }

    return template
      .replace('{user}', alert.username)
      .replace('{amount}', String(alert.amount || 0))
      .replace('{message}', alert.message || '')
      .replace('{tier}', String(alert.tier || 1));
  }

  private registerCommands(): void {
    // !testalert - Test an alert (mod)
    this.registerCommand({
      name: 'testalert',
      description: 'Send a test alert',
      usage: '!testalert <follow|sub|raid|cheer>',
      permission: Permission.MODERATOR,
      cooldown: { user: 10, global: 5 },
      handler: async (ctx) => {
        const type = (ctx.args[0]?.toLowerCase() || 'follow') as Alert['type'];

        const testAlert: Alert = {
          id: `test_${Date.now()}`,
          type,
          username: ctx.user.displayName,
          amount: type === 'raid' ? 50 : type === 'cheer' ? 100 : 1,
          message: 'Test alert message!',
          duration: 5,
          timestamp: new Date(),
        };

        this.queueAlert(testAlert);
        ctx.reply(`📣 Test-Alert gesendet: ${type}`);
      },
    });

    // !alerttoggle - Toggle alerts
    this.registerCommand({
      name: 'alerttoggle',
      description: 'Toggle alerts on/off',
      usage: '!alerttoggle [type]',
      permission: Permission.MODERATOR,
      cooldown: { user: 5, global: 0 },
      handler: async (ctx) => {
        const type = ctx.args[0]?.toLowerCase();

        if (!type) {
          this.settings.enabled = !this.settings.enabled;

          if (this.settings.enabled && !this.wss) {
            this.startServer();
          } else if (!this.settings.enabled && this.wss) {
            this.stopServer();
          }

          this.saveSettings();
          ctx.reply(`📣 Alerts: ${this.settings.enabled ? 'An' : 'Aus'}`);
          return;
        }

        switch (type) {
          case 'follow':
            this.settings.followAlert.enabled = !this.settings.followAlert.enabled;
            ctx.reply(`📣 Follow-Alerts: ${this.settings.followAlert.enabled ? 'An' : 'Aus'}`);
            break;
          case 'sub':
            this.settings.subAlert.enabled = !this.settings.subAlert.enabled;
            ctx.reply(`📣 Sub-Alerts: ${this.settings.subAlert.enabled ? 'An' : 'Aus'}`);
            break;
          case 'raid':
            this.settings.raidAlert.enabled = !this.settings.raidAlert.enabled;
            ctx.reply(`📣 Raid-Alerts: ${this.settings.raidAlert.enabled ? 'An' : 'Aus'}`);
            break;
          case 'cheer':
            this.settings.cheerAlert.enabled = !this.settings.cheerAlert.enabled;
            ctx.reply(`📣 Cheer-Alerts: ${this.settings.cheerAlert.enabled ? 'An' : 'Aus'}`);
            break;
          default:
            ctx.reply('❌ Unbekannter Typ (follow, sub, raid, cheer)');
            return;
        }

        this.saveSettings();
      },
    });

    // !alertstatus - Show alert status
    this.registerCommand({
      name: 'alertstatus',
      description: 'Show alert system status',
      permission: Permission.MODERATOR,
      cooldown: { user: 10, global: 5 },
      handler: async (ctx) => {
        const status = [
          `Global: ${this.settings.enabled ? '✅' : '❌'}`,
          `Follow: ${this.settings.followAlert.enabled ? '✅' : '❌'}`,
          `Sub: ${this.settings.subAlert.enabled ? '✅' : '❌'}`,
          `Raid: ${this.settings.raidAlert.enabled ? '✅' : '❌'}`,
          `Cheer: ${this.settings.cheerAlert.enabled ? '✅' : '❌'}`,
          `Clients: ${this.clients.size}`,
        ].join(' | ');

        ctx.reply(`📣 ${status}`);
      },
    });

    // !skipalert - Skip current alert
    this.registerCommand({
      name: 'skipalert',
      description: 'Skip current alert',
      permission: Permission.MODERATOR,
      cooldown: { user: 5, global: 0 },
      handler: async (ctx) => {
        for (const client of this.clients) {
          if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({ type: 'skip' }));
          }
        }
        ctx.reply('⏭️ Alert übersprungen');
      },
    });
  }

  // Public API
  sendCustomAlert(alert: Partial<Alert> & { username: string }): void {
    this.queueAlert({
      id: `custom_${Date.now()}`,
      type: 'custom',
      duration: 5,
      timestamp: new Date(),
      ...alert,
    });
  }

  getConnectedClients(): number {
    return this.clients.size;
  }

  getAlertUrl(): string {
    return `http://localhost:${this.settings.port}`;
  }
}
