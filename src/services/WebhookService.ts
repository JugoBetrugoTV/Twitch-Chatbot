/**
 * Webhook Service
 *
 * Send notifications to external services
 * Features:
 * - Discord webhooks
 * - Custom HTTP webhooks
 * - Event-based triggers
 * - Retry logic
 * - Rate limiting
 */

import { Logger } from '../utils/logger';
import { getDatabase, DatabaseService } from './Database';

export interface Webhook {
  id: string;
  name: string;
  url: string;
  type: 'discord' | 'slack' | 'custom';
  events: string[];
  enabled: boolean;
  secret?: string;
  headers?: Record<string, string>;
  template?: string;
  createdAt: Date;
  lastTriggered?: Date;
  failCount: number;
}

export interface WebhookPayload {
  event: string;
  data: Record<string, any>;
  timestamp: Date;
  botName?: string;
}

interface WebhookServiceConfig {
  maxRetries: number;
  retryDelayMs: number;
  rateLimitPerMinute: number;
  defaultTimeout: number;
}

const DEFAULT_CONFIG: WebhookServiceConfig = {
  maxRetries: 3,
  retryDelayMs: 1000,
  rateLimitPerMinute: 30,
  defaultTimeout: 10000,
};

export class WebhookService {
  private log = new Logger('Webhook');
  private db: DatabaseService;
  private config: WebhookServiceConfig;
  private webhooks: Map<string, Webhook> = new Map();
  private rateLimitMap: Map<string, number[]> = new Map();
  private eventListeners: Map<string, Set<string>> = new Map(); // event -> webhook ids

  constructor(config: Partial<WebhookServiceConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.db = getDatabase();
    this.initTables();
    this.loadWebhooks();
  }

  private initTables(): void {
    const db = this.db.raw();
    db.exec(`
      CREATE TABLE IF NOT EXISTS webhooks (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        url TEXT NOT NULL,
        type TEXT DEFAULT 'custom',
        events TEXT NOT NULL,
        enabled INTEGER DEFAULT 1,
        secret TEXT,
        headers TEXT,
        template TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        last_triggered DATETIME,
        fail_count INTEGER DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS webhook_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        webhook_id TEXT NOT NULL,
        event TEXT NOT NULL,
        status INTEGER,
        response TEXT,
        error TEXT,
        triggered_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_webhook_logs_webhook ON webhook_logs(webhook_id);
      CREATE INDEX IF NOT EXISTS idx_webhook_logs_date ON webhook_logs(triggered_at);
    `);
  }

  private loadWebhooks(): void {
    const db = this.db.raw();
    const rows = db.prepare('SELECT * FROM webhooks WHERE enabled = 1').all() as any[];

    for (const row of rows) {
      const webhook: Webhook = {
        id: row.id,
        name: row.name,
        url: row.url,
        type: row.type,
        events: JSON.parse(row.events),
        enabled: !!row.enabled,
        secret: row.secret,
        headers: row.headers ? JSON.parse(row.headers) : undefined,
        template: row.template,
        createdAt: new Date(row.created_at),
        lastTriggered: row.last_triggered ? new Date(row.last_triggered) : undefined,
        failCount: row.fail_count,
      };

      this.webhooks.set(webhook.id, webhook);

      // Register event listeners
      for (const event of webhook.events) {
        if (!this.eventListeners.has(event)) {
          this.eventListeners.set(event, new Set());
        }
        this.eventListeners.get(event)!.add(webhook.id);
      }
    }

    this.log.info(`Loaded ${this.webhooks.size} webhooks`);
  }

  async trigger(event: string, data: Record<string, any>): Promise<void> {
    const webhookIds = this.eventListeners.get(event) || new Set();

    // Also check wildcard listeners
    const wildcardIds = this.eventListeners.get('*') || new Set();

    const allIds = new Set([...webhookIds, ...wildcardIds]);

    for (const webhookId of allIds) {
      const webhook = this.webhooks.get(webhookId);
      if (webhook && webhook.enabled) {
        // Don't await - fire and forget
        this.send(webhook, { event, data, timestamp: new Date() }).catch((err) => {
          this.log.error(`Webhook ${webhook.name} failed: ${err}`);
        });
      }
    }
  }

  async send(webhook: Webhook, payload: WebhookPayload): Promise<boolean> {
    // Check rate limit
    if (!this.checkRateLimit(webhook.id)) {
      this.log.warn(`Webhook ${webhook.name} rate limited`);
      return false;
    }

    // Build the request body based on webhook type
    const body = this.buildBody(webhook, payload);

    // Build headers
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'User-Agent': 'StreamCore-Bot/1.0',
      ...webhook.headers,
    };

    // Add signature if secret is set
    if (webhook.secret) {
      const crypto = require('crypto');
      const signature = crypto
        .createHmac('sha256', webhook.secret)
        .update(JSON.stringify(body))
        .digest('hex');
      headers['X-Webhook-Signature'] = `sha256=${signature}`;
    }

    // Try sending with retries
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < this.config.maxRetries; attempt++) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), this.config.defaultTimeout);

        const response = await fetch(webhook.url, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
          signal: controller.signal,
        });

        clearTimeout(timeout);

        // Log the request
        this.logWebhookCall(webhook.id, payload.event, response.status);

        if (response.ok) {
          // Update last triggered
          this.updateWebhookStatus(webhook.id, true);
          return true;
        }

        // Handle rate limiting from the server
        if (response.status === 429) {
          const retryAfter = parseInt(response.headers.get('Retry-After') || '5');
          await this.delay(retryAfter * 1000);
          continue;
        }

        lastError = new Error(`HTTP ${response.status}: ${await response.text()}`);
      } catch (error) {
        lastError = error as Error;
      }

      // Wait before retry
      if (attempt < this.config.maxRetries - 1) {
        await this.delay(this.config.retryDelayMs * (attempt + 1));
      }
    }

    // All retries failed
    this.logWebhookCall(webhook.id, payload.event, 0, lastError?.message);
    this.updateWebhookStatus(webhook.id, false);

    throw lastError;
  }

  private buildBody(webhook: Webhook, payload: WebhookPayload): any {
    switch (webhook.type) {
      case 'discord':
        return this.buildDiscordBody(webhook, payload);
      case 'slack':
        return this.buildSlackBody(webhook, payload);
      default:
        return this.buildCustomBody(webhook, payload);
    }
  }

  private buildDiscordBody(webhook: Webhook, payload: WebhookPayload): any {
    // Discord webhook format
    const embed = {
      title: `Event: ${payload.event}`,
      color: this.getEventColor(payload.event),
      fields: Object.entries(payload.data).slice(0, 25).map(([key, value]) => ({
        name: key,
        value: String(value).substring(0, 1024),
        inline: true,
      })),
      timestamp: payload.timestamp.toISOString(),
      footer: {
        text: 'StreamCore Bot',
      },
    };

    if (webhook.template) {
      // Custom template
      return {
        content: this.applyTemplate(webhook.template, payload),
        embeds: [embed],
      };
    }

    return {
      embeds: [embed],
    };
  }

  private buildSlackBody(webhook: Webhook, payload: WebhookPayload): any {
    // Slack webhook format
    return {
      text: webhook.template ? this.applyTemplate(webhook.template, payload) : `Event: ${payload.event}`,
      attachments: [
        {
          color: this.getEventColorHex(payload.event),
          fields: Object.entries(payload.data).slice(0, 10).map(([key, value]) => ({
            title: key,
            value: String(value),
            short: true,
          })),
          ts: Math.floor(payload.timestamp.getTime() / 1000),
        },
      ],
    };
  }

  private buildCustomBody(webhook: Webhook, payload: WebhookPayload): any {
    if (webhook.template) {
      try {
        // Template can be a JSON template
        return JSON.parse(this.applyTemplate(webhook.template, payload));
      } catch {
        // Or just a message
        return {
          message: this.applyTemplate(webhook.template, payload),
          ...payload,
        };
      }
    }

    return payload;
  }

  private applyTemplate(template: string, payload: WebhookPayload): string {
    let result = template;

    // Replace event placeholder
    result = result.replace(/{event}/g, payload.event);
    result = result.replace(/{timestamp}/g, payload.timestamp.toISOString());

    // Replace data placeholders
    for (const [key, value] of Object.entries(payload.data)) {
      result = result.replace(new RegExp(`{${key}}`, 'g'), String(value));
    }

    return result;
  }

  private getEventColor(event: string): number {
    const colors: Record<string, number> = {
      follow: 0x00ff00,
      subscribe: 0x9146ff,
      cheer: 0xffd700,
      raid: 0xff6b6b,
      redemption: 0x00bfff,
      default: 0x7289da,
    };

    for (const [key, color] of Object.entries(colors)) {
      if (event.includes(key)) return color;
    }

    return colors.default;
  }

  private getEventColorHex(event: string): string {
    return '#' + this.getEventColor(event).toString(16).padStart(6, '0');
  }

  private checkRateLimit(webhookId: string): boolean {
    const now = Date.now();
    const windowMs = 60000;

    let timestamps = this.rateLimitMap.get(webhookId) || [];
    timestamps = timestamps.filter((t) => now - t < windowMs);

    if (timestamps.length >= this.config.rateLimitPerMinute) {
      return false;
    }

    timestamps.push(now);
    this.rateLimitMap.set(webhookId, timestamps);
    return true;
  }

  private logWebhookCall(webhookId: string, event: string, status: number, error?: string): void {
    const db = this.db.raw();
    db.prepare(`
      INSERT INTO webhook_logs (webhook_id, event, status, error)
      VALUES (?, ?, ?, ?)
    `).run(webhookId, event, status, error || null);
  }

  private updateWebhookStatus(webhookId: string, success: boolean): void {
    const db = this.db.raw();
    const webhook = this.webhooks.get(webhookId);

    if (webhook) {
      if (success) {
        webhook.lastTriggered = new Date();
        webhook.failCount = 0;
        db.prepare('UPDATE webhooks SET last_triggered = ?, fail_count = 0 WHERE id = ?')
          .run(webhook.lastTriggered.toISOString(), webhookId);
      } else {
        webhook.failCount++;
        db.prepare('UPDATE webhooks SET fail_count = fail_count + 1 WHERE id = ?')
          .run(webhookId);

        // Disable webhook after too many failures
        if (webhook.failCount >= 10) {
          webhook.enabled = false;
          db.prepare('UPDATE webhooks SET enabled = 0 WHERE id = ?').run(webhookId);
          this.log.warn(`Webhook ${webhook.name} disabled after ${webhook.failCount} failures`);
        }
      }
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // Public API
  addWebhook(webhook: Omit<Webhook, 'id' | 'createdAt' | 'failCount'>): Webhook {
    const id = `webhook_${Date.now()}`;
    const newWebhook: Webhook = {
      ...webhook,
      id,
      createdAt: new Date(),
      failCount: 0,
    };

    const db = this.db.raw();
    db.prepare(`
      INSERT INTO webhooks (id, name, url, type, events, enabled, secret, headers, template)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      newWebhook.name,
      newWebhook.url,
      newWebhook.type,
      JSON.stringify(newWebhook.events),
      newWebhook.enabled ? 1 : 0,
      newWebhook.secret,
      newWebhook.headers ? JSON.stringify(newWebhook.headers) : null,
      newWebhook.template
    );

    this.webhooks.set(id, newWebhook);

    // Register event listeners
    for (const event of newWebhook.events) {
      if (!this.eventListeners.has(event)) {
        this.eventListeners.set(event, new Set());
      }
      this.eventListeners.get(event)!.add(id);
    }

    this.log.info(`Added webhook: ${newWebhook.name}`);
    return newWebhook;
  }

  removeWebhook(id: string): boolean {
    const webhook = this.webhooks.get(id);
    if (!webhook) return false;

    const db = this.db.raw();
    db.prepare('DELETE FROM webhooks WHERE id = ?').run(id);

    // Remove from event listeners
    for (const event of webhook.events) {
      this.eventListeners.get(event)?.delete(id);
    }

    this.webhooks.delete(id);
    this.log.info(`Removed webhook: ${webhook.name}`);
    return true;
  }

  getWebhooks(): Webhook[] {
    return Array.from(this.webhooks.values());
  }

  getWebhook(id: string): Webhook | undefined {
    return this.webhooks.get(id);
  }

  toggleWebhook(id: string, enabled: boolean): boolean {
    const webhook = this.webhooks.get(id);
    if (!webhook) return false;

    webhook.enabled = enabled;
    this.db.raw().prepare('UPDATE webhooks SET enabled = ? WHERE id = ?')
      .run(enabled ? 1 : 0, id);

    return true;
  }

  getWebhookLogs(webhookId: string, limit = 50): any[] {
    const db = this.db.raw();
    return db.prepare(`
      SELECT * FROM webhook_logs
      WHERE webhook_id = ?
      ORDER BY triggered_at DESC
      LIMIT ?
    `).all(webhookId, limit);
  }
}

// Singleton instance
let webhookInstance: WebhookService | null = null;

export function getWebhookService(config?: Partial<WebhookServiceConfig>): WebhookService {
  if (!webhookInstance) {
    webhookInstance = new WebhookService(config);
  }
  return webhookInstance;
}
