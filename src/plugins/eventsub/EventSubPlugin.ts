/**
 * Twitch EventSub Plugin
 *
 * Modern event handling via Twitch EventSub API
 * Features:
 * - Channel point redemptions
 * - Follows, subs, bits, raids
 * - Stream online/offline
 * - Hype train events
 * - Polls and predictions
 */

import { Plugin } from '../base/Plugin';
import { PluginMeta, Permission } from '../../types/plugins';
import { getDatabase, DatabaseService } from '../../services/Database';
import { createServer, IncomingMessage, ServerResponse } from 'http';
import crypto from 'crypto';

interface EventSubSubscription {
  id: string;
  type: string;
  version: string;
  status: string;
  condition: Record<string, string>;
  createdAt: Date;
}

interface EventSubSettings {
  enabled: boolean;
  callbackUrl: string;
  port: number;
  secret: string;
  clientId: string;
  clientSecret: string;
  accessToken: string;
  broadcasterId: string;
}

const DEFAULT_SETTINGS: EventSubSettings = {
  enabled: false,
  callbackUrl: '',
  port: 8080,
  secret: '',
  clientId: '',
  clientSecret: '',
  accessToken: '',
  broadcasterId: '',
};

// EventSub subscription types
const SUBSCRIPTION_TYPES = {
  'channel.follow': '2',
  'channel.subscribe': '1',
  'channel.subscription.gift': '1',
  'channel.subscription.message': '1',
  'channel.cheer': '1',
  'channel.raid': '1',
  'channel.channel_points_custom_reward_redemption.add': '1',
  'channel.poll.begin': '1',
  'channel.poll.end': '1',
  'channel.prediction.begin': '1',
  'channel.prediction.end': '1',
  'channel.hype_train.begin': '1',
  'channel.hype_train.end': '1',
  'stream.online': '1',
  'stream.offline': '1',
};

export class EventSubPlugin extends Plugin {
  meta: PluginMeta = {
    name: 'eventsub',
    version: '1.0.0',
    description: 'Twitch EventSub integration for modern event handling',
    author: 'StreamCore',
  };

  private db!: DatabaseService;
  private settings: EventSubSettings = DEFAULT_SETTINGS;
  private server?: ReturnType<typeof createServer>;
  private subscriptions: Map<string, EventSubSubscription> = new Map();

  protected async init(): Promise<void> {
    this.db = getDatabase();
    this.log.info('Initializing EventSub...');

    this.loadSettings();
    this.registerCommands();

    if (this.settings.enabled && this.settings.callbackUrl) {
      await this.startWebhookServer();
    }

    this.log.info('EventSub initialized!');
  }

  protected async destroy(): Promise<void> {
    if (this.server) {
      this.server.close();
    }
  }

  private loadSettings(): void {
    const saved = this.db.getSetting<EventSubSettings>('eventsub_settings');
    if (saved) {
      this.settings = { ...DEFAULT_SETTINGS, ...saved };
    }

    // Generate secret if not set
    if (!this.settings.secret) {
      this.settings.secret = crypto.randomBytes(32).toString('hex');
      this.saveSettings();
    }
  }

  private saveSettings(): void {
    this.db.setSetting('eventsub_settings', this.settings);
  }

  private async startWebhookServer(): Promise<void> {
    this.server = createServer((req, res) => {
      this.handleWebhook(req, res);
    });

    this.server.listen(this.settings.port, () => {
      this.log.info(`EventSub webhook server listening on port ${this.settings.port}`);
    });
  }

  private async handleWebhook(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.method !== 'POST') {
      res.writeHead(405);
      res.end();
      return;
    }

    const chunks: Buffer[] = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', async () => {
      const body = Buffer.concat(chunks).toString();

      // Verify signature
      const messageId = req.headers['twitch-eventsub-message-id'] as string;
      const timestamp = req.headers['twitch-eventsub-message-timestamp'] as string;
      const signature = req.headers['twitch-eventsub-message-signature'] as string;
      const messageType = req.headers['twitch-eventsub-message-type'] as string;

      if (!this.verifySignature(messageId, timestamp, body, signature)) {
        this.log.warn('Invalid EventSub signature');
        res.writeHead(403);
        res.end();
        return;
      }

      let data: any;
      try {
        data = JSON.parse(body);
      } catch (parseError) {
        this.log.error(`Invalid JSON in EventSub webhook: ${parseError}`);
        res.writeHead(400);
        res.end();
        return;
      }

      // Handle different message types
      switch (messageType) {
        case 'webhook_callback_verification':
          // Respond to verification challenge
          res.writeHead(200, { 'Content-Type': 'text/plain' });
          res.end(data.challenge);
          this.log.info(`EventSub subscription verified: ${data.subscription.type}`);
          break;

        case 'notification':
          // Process the event
          await this.handleEvent(data.subscription.type, data.event);
          res.writeHead(204);
          res.end();
          break;

        case 'revocation':
          // Subscription was revoked
          this.log.warn(`EventSub subscription revoked: ${data.subscription.type}`);
          this.subscriptions.delete(data.subscription.id);
          res.writeHead(204);
          res.end();
          break;

        default:
          res.writeHead(400);
          res.end();
      }
    });
  }

  private verifySignature(messageId: string, timestamp: string, body: string, signature: string): boolean {
    const message = messageId + timestamp + body;
    const expectedSignature = 'sha256=' + crypto
      .createHmac('sha256', this.settings.secret)
      .update(message)
      .digest('hex');

    return crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expectedSignature)
    );
  }

  private async handleEvent(type: string, event: any): Promise<void> {
    this.log.info(`EventSub event: ${type}`);

    switch (type) {
      case 'channel.follow':
        this.ctx.events.emit('twitch:follow', {
          userId: event.user_id,
          userName: event.user_name,
          userLogin: event.user_login,
          followedAt: new Date(event.followed_at),
        });
        break;

      case 'channel.subscribe':
        this.ctx.events.emit('twitch:subscription', {
          userId: event.user_id,
          userName: event.user_name,
          tier: event.tier,
          isGift: event.is_gift,
        });
        break;

      case 'channel.subscription.gift':
        this.ctx.events.emit('twitch:gift', {
          userId: event.user_id,
          userName: event.user_name,
          total: event.total,
          tier: event.tier,
          cumulativeTotal: event.cumulative_total,
        });
        break;

      case 'channel.cheer':
        this.ctx.events.emit('twitch:cheer', {
          userId: event.user_id,
          userName: event.user_name,
          bits: event.bits,
          message: event.message,
        });
        break;

      case 'channel.raid':
        this.ctx.events.emit('twitch:raid', {
          fromUserId: event.from_broadcaster_user_id,
          fromUserName: event.from_broadcaster_user_name,
          viewers: event.viewers,
        });
        break;

      case 'channel.channel_points_custom_reward_redemption.add':
        this.ctx.events.emit('twitch:redemption', {
          id: event.id,
          userId: event.user_id,
          userName: event.user_name,
          userInput: event.user_input,
          rewardId: event.reward.id,
          rewardTitle: event.reward.title,
          rewardCost: event.reward.cost,
          status: event.status,
        });
        break;

      case 'channel.poll.begin':
        this.ctx.events.emit('twitch:poll:start', {
          id: event.id,
          title: event.title,
          choices: event.choices,
          startedAt: new Date(event.started_at),
          endsAt: new Date(event.ends_at),
        });
        break;

      case 'channel.poll.end':
        this.ctx.events.emit('twitch:poll:end', {
          id: event.id,
          title: event.title,
          choices: event.choices,
          status: event.status,
          endedAt: new Date(event.ended_at),
        });
        break;

      case 'channel.prediction.begin':
        this.ctx.events.emit('twitch:prediction:start', {
          id: event.id,
          title: event.title,
          outcomes: event.outcomes,
          startedAt: new Date(event.started_at),
          locksAt: new Date(event.locks_at),
        });
        break;

      case 'channel.prediction.end':
        this.ctx.events.emit('twitch:prediction:end', {
          id: event.id,
          title: event.title,
          winningOutcome: event.winning_outcome_id,
          status: event.status,
          endedAt: new Date(event.ended_at),
        });
        break;

      case 'channel.hype_train.begin':
        this.ctx.events.emit('twitch:hypetrain:start', {
          id: event.id,
          level: event.level,
          total: event.total,
          goal: event.goal,
          startedAt: new Date(event.started_at),
          expiresAt: new Date(event.expires_at),
        });
        break;

      case 'channel.hype_train.end':
        this.ctx.events.emit('twitch:hypetrain:end', {
          id: event.id,
          level: event.level,
          total: event.total,
          topContributions: event.top_contributions,
          endedAt: new Date(event.ended_at),
        });
        break;

      case 'stream.online':
        this.ctx.events.emit('twitch:stream:online', {
          id: event.id,
          type: event.type,
          startedAt: new Date(event.started_at),
        });
        break;

      case 'stream.offline':
        this.ctx.events.emit('twitch:stream:offline', {});
        break;

      default:
        this.log.warn(`Unhandled EventSub type: ${type}`);
    }

    // Log event to database
    this.db.logEvent('eventsub', { type, event });
  }

  private async createSubscription(type: string): Promise<boolean> {
    if (!this.settings.accessToken || !this.settings.broadcasterId) {
      this.log.error('Missing access token or broadcaster ID');
      return false;
    }

    const version = SUBSCRIPTION_TYPES[type as keyof typeof SUBSCRIPTION_TYPES];
    if (!version) {
      this.log.error(`Unknown subscription type: ${type}`);
      return false;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    try {
      const response = await fetch('https://api.twitch.tv/helix/eventsub/subscriptions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.settings.accessToken}`,
          'Client-Id': this.settings.clientId,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          type,
          version,
          condition: {
            broadcaster_user_id: this.settings.broadcasterId,
          },
          transport: {
            method: 'webhook',
            callback: this.settings.callbackUrl,
            secret: this.settings.secret,
          },
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const error = await response.text();
        this.log.error(`Failed to create subscription: ${error}`);
        return false;
      }

      const data = await response.json() as { data: any[] };
      if (!data.data || data.data.length === 0) {
        this.log.error('No subscription data returned');
        return false;
      }
      const subscription = data.data[0];

      this.subscriptions.set(subscription.id, {
        id: subscription.id,
        type: subscription.type,
        version: subscription.version,
        status: subscription.status,
        condition: subscription.condition,
        createdAt: new Date(subscription.created_at),
      });

      this.log.info(`Created EventSub subscription: ${type}`);
      return true;
    } catch (error) {
      if ((error as Error).name === 'AbortError') {
        this.log.error(`Subscription request timed out: ${type}`);
      } else {
        this.log.error(`Error creating subscription: ${error}`);
      }
      return false;
    } finally {
      clearTimeout(timeout);
    }
  }

  private async deleteSubscription(id: string): Promise<boolean> {
    try {
      const response = await fetch(`https://api.twitch.tv/helix/eventsub/subscriptions?id=${id}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${this.settings.accessToken}`,
          'Client-Id': this.settings.clientId,
        },
      });

      if (response.ok) {
        this.subscriptions.delete(id);
        return true;
      }

      return false;
    } catch (error) {
      this.log.error(`Error deleting subscription: ${error}`);
      return false;
    }
  }

  private registerCommands(): void {
    // !eventsub - Manage EventSub
    this.registerCommand({
      name: 'eventsub',
      description: 'Manage EventSub subscriptions',
      usage: '!eventsub <status|subscribe|unsubscribe> [type]',
      permission: Permission.BROADCASTER,
      cooldown: { user: 5, global: 0 },
      handler: async (ctx) => {
        const action = ctx.args[0]?.toLowerCase();

        if (!action || action === 'status') {
          const status = this.settings.enabled ? 'aktiviert' : 'deaktiviert';
          ctx.reply(`📡 EventSub: ${status} | Subscriptions: ${this.subscriptions.size}`);
          return;
        }

        if (action === 'subscribe') {
          const type = ctx.args[1];
          if (!type) {
            const types = Object.keys(SUBSCRIPTION_TYPES).join(', ');
            ctx.reply(`Verfügbare Typen: ${types}`);
            return;
          }

          const success = await this.createSubscription(type);
          ctx.reply(success ? `✅ Subscribed: ${type}` : `❌ Fehler beim Subscriben`);
        } else if (action === 'unsubscribe') {
          const id = ctx.args[1];
          if (!id) {
            ctx.reply('Verwendung: !eventsub unsubscribe <id>');
            return;
          }

          const success = await this.deleteSubscription(id);
          ctx.reply(success ? '✅ Unsubscribed' : '❌ Fehler');
        } else if (action === 'list') {
          if (this.subscriptions.size === 0) {
            ctx.reply('📡 Keine aktiven Subscriptions');
            return;
          }

          const list = Array.from(this.subscriptions.values())
            .map((s) => `${s.type} (${s.status})`)
            .join(', ');
          ctx.reply(`📡 Subscriptions: ${list}`);
        }
      },
    });
  }

  // Public API
  getSubscriptions(): EventSubSubscription[] {
    return Array.from(this.subscriptions.values());
  }

  async subscribeToAll(): Promise<void> {
    for (const type of Object.keys(SUBSCRIPTION_TYPES)) {
      await this.createSubscription(type);
    }
  }
}
