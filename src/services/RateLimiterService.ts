/**
 * Rate Limiter Service
 *
 * Global rate limiting for API calls
 * Features:
 * - Token bucket algorithm
 * - Per-endpoint limits
 * - Automatic retry with backoff
 * - Queue management
 */

import { Logger } from '../utils/logger';

export interface RateLimitConfig {
  maxTokens: number;
  refillRate: number; // tokens per second
  refillInterval: number; // ms
}

export interface RateLimitBucket {
  tokens: number;
  lastRefill: number;
  config: RateLimitConfig;
  queue: QueuedRequest[];
}

export interface QueuedRequest {
  id: string;
  resolve: (value: boolean) => void;
  reject: (reason: any) => void;
  timestamp: number;
  priority: number;
}

export interface RateLimiterSettings {
  defaultMaxTokens: number;
  defaultRefillRate: number;
  maxQueueSize: number;
  maxQueueWait: number;
}

const DEFAULT_SETTINGS: RateLimiterSettings = {
  defaultMaxTokens: 100,
  defaultRefillRate: 10,
  maxQueueSize: 100,
  maxQueueWait: 30000, // 30 seconds
};

export class RateLimiterService {
  private log = new Logger('RateLimiter');
  private settings: RateLimiterSettings;
  private buckets: Map<string, RateLimitBucket> = new Map();
  private processingInterval: ReturnType<typeof setInterval> | null = null;

  constructor(settings: Partial<RateLimiterSettings> = {}) {
    this.settings = { ...DEFAULT_SETTINGS, ...settings };
    this.startProcessing();
    this.log.info('Rate Limiter initialized');
  }

  private startProcessing(): void {
    // Process queues every 100ms
    this.processingInterval = setInterval(() => {
      this.processQueues();
    }, 100);
  }

  destroy(): void {
    if (this.processingInterval) {
      clearInterval(this.processingInterval);
      this.processingInterval = null;
    }

    // Reject all queued requests
    for (const bucket of this.buckets.values()) {
      for (const request of bucket.queue) {
        request.reject(new Error('Rate limiter destroyed'));
      }
      bucket.queue = [];
    }
  }

  /**
   * Configure a rate limit bucket for a specific endpoint
   */
  configure(endpoint: string, config: Partial<RateLimitConfig>): void {
    const bucket = this.getBucket(endpoint);
    bucket.config = {
      ...bucket.config,
      ...config,
    };
    this.log.debug(`Configured rate limit for ${endpoint}: ${JSON.stringify(bucket.config)}`);
  }

  /**
   * Try to acquire a token for the endpoint
   * Returns true if token acquired, false if rate limited
   */
  tryAcquire(endpoint: string): boolean {
    const bucket = this.getBucket(endpoint);
    this.refillBucket(bucket);

    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      return true;
    }

    return false;
  }

  /**
   * Acquire a token, waiting in queue if necessary
   * Returns a promise that resolves when token is acquired
   */
  async acquire(endpoint: string, priority: number = 0): Promise<boolean> {
    // Try immediate acquisition
    if (this.tryAcquire(endpoint)) {
      return true;
    }

    const bucket = this.getBucket(endpoint);

    // Check queue size
    if (bucket.queue.length >= this.settings.maxQueueSize) {
      throw new Error(`Rate limit queue full for ${endpoint}`);
    }

    // Add to queue
    return new Promise((resolve, reject) => {
      const request: QueuedRequest = {
        id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        resolve,
        reject,
        timestamp: Date.now(),
        priority,
      };

      bucket.queue.push(request);
      bucket.queue.sort((a, b) => b.priority - a.priority);

      // Set timeout for max wait
      setTimeout(() => {
        const index = bucket.queue.findIndex((r) => r.id === request.id);
        if (index !== -1) {
          bucket.queue.splice(index, 1);
          reject(new Error(`Rate limit timeout for ${endpoint}`));
        }
      }, this.settings.maxQueueWait);
    });
  }

  /**
   * Get remaining tokens for an endpoint
   */
  getRemaining(endpoint: string): number {
    const bucket = this.getBucket(endpoint);
    this.refillBucket(bucket);
    return Math.floor(bucket.tokens);
  }

  /**
   * Get time until next token is available (in ms)
   */
  getWaitTime(endpoint: string): number {
    const bucket = this.getBucket(endpoint);
    this.refillBucket(bucket);

    if (bucket.tokens >= 1) {
      return 0;
    }

    const tokensNeeded = 1 - bucket.tokens;
    const timePerToken = 1000 / bucket.config.refillRate;
    return Math.ceil(tokensNeeded * timePerToken);
  }

  /**
   * Check if endpoint is rate limited
   */
  isLimited(endpoint: string): boolean {
    const bucket = this.getBucket(endpoint);
    this.refillBucket(bucket);
    return bucket.tokens < 1;
  }

  /**
   * Reset a bucket to full tokens
   */
  reset(endpoint: string): void {
    const bucket = this.getBucket(endpoint);
    bucket.tokens = bucket.config.maxTokens;
    bucket.lastRefill = Date.now();
    this.log.debug(`Reset rate limit for ${endpoint}`);
  }

  /**
   * Get bucket statistics
   */
  getStats(endpoint: string): {
    tokens: number;
    maxTokens: number;
    queueSize: number;
    refillRate: number;
  } {
    const bucket = this.getBucket(endpoint);
    this.refillBucket(bucket);

    return {
      tokens: Math.floor(bucket.tokens),
      maxTokens: bucket.config.maxTokens,
      queueSize: bucket.queue.length,
      refillRate: bucket.config.refillRate,
    };
  }

  /**
   * Get all bucket names
   */
  getBucketNames(): string[] {
    return Array.from(this.buckets.keys());
  }

  private getBucket(endpoint: string): RateLimitBucket {
    let bucket = this.buckets.get(endpoint);

    if (!bucket) {
      bucket = {
        tokens: this.settings.defaultMaxTokens,
        lastRefill: Date.now(),
        config: {
          maxTokens: this.settings.defaultMaxTokens,
          refillRate: this.settings.defaultRefillRate,
          refillInterval: 1000,
        },
        queue: [],
      };
      this.buckets.set(endpoint, bucket);
    }

    return bucket;
  }

  private refillBucket(bucket: RateLimitBucket): void {
    const now = Date.now();
    const elapsed = now - bucket.lastRefill;
    const tokensToAdd = (elapsed / 1000) * bucket.config.refillRate;

    bucket.tokens = Math.min(bucket.config.maxTokens, bucket.tokens + tokensToAdd);
    bucket.lastRefill = now;
  }

  private processQueues(): void {
    for (const bucket of this.buckets.values()) {
      this.refillBucket(bucket);

      // Process queue while we have tokens
      while (bucket.queue.length > 0 && bucket.tokens >= 1) {
        const request = bucket.queue.shift()!;

        // Check if request has timed out
        if (Date.now() - request.timestamp > this.settings.maxQueueWait) {
          request.reject(new Error('Rate limit timeout'));
          continue;
        }

        bucket.tokens -= 1;
        request.resolve(true);
      }
    }
  }
}

// Singleton instance
let rateLimiterInstance: RateLimiterService | null = null;

export function getRateLimiter(settings?: Partial<RateLimiterSettings>): RateLimiterService {
  if (!rateLimiterInstance) {
    rateLimiterInstance = new RateLimiterService(settings);
  }
  return rateLimiterInstance;
}

// Pre-configured limiters for common APIs
export const TwitchAPILimiter = {
  configure: () => {
    const limiter = getRateLimiter();
    // Twitch API has 800 requests per minute
    limiter.configure('twitch:api', { maxTokens: 800, refillRate: 13.33 });
    // Twitch chat has 20 messages per 30 seconds for regular users
    limiter.configure('twitch:chat', { maxTokens: 20, refillRate: 0.67 });
    // Moderators get 100 messages per 30 seconds
    limiter.configure('twitch:chat:mod', { maxTokens: 100, refillRate: 3.33 });
  },
};
