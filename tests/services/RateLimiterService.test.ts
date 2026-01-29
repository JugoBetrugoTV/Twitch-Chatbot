/**
 * RateLimiterService Tests
 */

// Mock Logger
jest.mock('../../src/utils/logger', () => ({
  Logger: jest.fn().mockImplementation(() => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  })),
}));

import { RateLimiterService } from '../../src/services/RateLimiterService';

describe('RateLimiterService', () => {
  let limiter: RateLimiterService;

  beforeEach(() => {
    limiter = new RateLimiterService({
      defaultMaxTokens: 10,
      defaultRefillRate: 10, // 10 tokens per second
      maxQueueSize: 5,
      maxQueueWait: 1000, // 1 second
    });
  });

  afterEach(() => {
    limiter.destroy();
  });

  describe('Basic Token Operations', () => {
    it('should allow requests when tokens available', () => {
      expect(limiter.tryAcquire('test-endpoint')).toBe(true);
    });

    it('should consume tokens on each request', () => {
      const endpoint = 'consume-test';
      const initialRemaining = limiter.getRemaining(endpoint);

      limiter.tryAcquire(endpoint);
      expect(limiter.getRemaining(endpoint)).toBe(initialRemaining - 1);
    });

    it('should deny requests when no tokens available', () => {
      const endpoint = 'no-tokens';
      // Consume all tokens
      for (let i = 0; i < 10; i++) {
        limiter.tryAcquire(endpoint);
      }

      expect(limiter.tryAcquire(endpoint)).toBe(false);
    });

    it('should check if endpoint is rate limited', () => {
      const endpoint = 'limited-check';

      expect(limiter.isLimited(endpoint)).toBe(false);

      // Consume all tokens
      for (let i = 0; i < 10; i++) {
        limiter.tryAcquire(endpoint);
      }

      expect(limiter.isLimited(endpoint)).toBe(true);
    });
  });

  describe('Token Refill', () => {
    it('should refill tokens over time', async () => {
      const endpoint = 'refill-test';

      // Consume all tokens
      for (let i = 0; i < 10; i++) {
        limiter.tryAcquire(endpoint);
      }
      expect(limiter.getRemaining(endpoint)).toBe(0);

      // Wait for refill (100ms should give us ~1 token at 10/sec rate)
      await new Promise(resolve => setTimeout(resolve, 200));

      expect(limiter.getRemaining(endpoint)).toBeGreaterThan(0);
    });

    it('should not exceed max tokens', async () => {
      const endpoint = 'max-test';
      const stats = limiter.getStats(endpoint);

      // Wait to ensure refill
      await new Promise(resolve => setTimeout(resolve, 100));

      expect(limiter.getRemaining(endpoint)).toBeLessThanOrEqual(stats.maxTokens);
    });
  });

  describe('Configuration', () => {
    it('should allow custom configuration per endpoint', () => {
      limiter.configure('custom-endpoint', {
        maxTokens: 5,
        refillRate: 1,
      });

      const stats = limiter.getStats('custom-endpoint');
      expect(stats.maxTokens).toBe(5);
      expect(stats.refillRate).toBe(1);
    });

    it('should use default configuration for new endpoints', () => {
      const stats = limiter.getStats('new-endpoint');
      expect(stats.maxTokens).toBe(10);
      expect(stats.refillRate).toBe(10);
    });
  });

  describe('Reset', () => {
    it('should reset bucket to full tokens', () => {
      const endpoint = 'reset-test';

      // Consume some tokens
      for (let i = 0; i < 5; i++) {
        limiter.tryAcquire(endpoint);
      }
      expect(limiter.getRemaining(endpoint)).toBe(5);

      // Reset
      limiter.reset(endpoint);
      expect(limiter.getRemaining(endpoint)).toBe(10);
    });
  });

  describe('Wait Time', () => {
    it('should return 0 when tokens available', () => {
      expect(limiter.getWaitTime('available')).toBe(0);
    });

    it('should return positive wait time when limited', () => {
      const endpoint = 'wait-test';

      // Consume all tokens
      for (let i = 0; i < 10; i++) {
        limiter.tryAcquire(endpoint);
      }

      const waitTime = limiter.getWaitTime(endpoint);
      expect(waitTime).toBeGreaterThan(0);
    });
  });

  describe('Async Acquire', () => {
    it('should acquire immediately when tokens available', async () => {
      const result = await limiter.acquire('async-test');
      expect(result).toBe(true);
    });

    it('should queue and wait when no tokens', async () => {
      const endpoint = 'queue-test';

      // Consume all tokens
      for (let i = 0; i < 10; i++) {
        limiter.tryAcquire(endpoint);
      }

      // Start async acquire - should queue
      const acquirePromise = limiter.acquire(endpoint);

      // Wait for refill
      await new Promise(resolve => setTimeout(resolve, 200));

      const result = await acquirePromise;
      expect(result).toBe(true);
    });

    it('should throw when queue is full', async () => {
      const endpoint = 'queue-full';

      // Consume all tokens
      for (let i = 0; i < 10; i++) {
        limiter.tryAcquire(endpoint);
      }

      // Fill up the queue (maxQueueSize = 5)
      const promises = [];
      for (let i = 0; i < 5; i++) {
        promises.push(limiter.acquire(endpoint).catch(() => {}));
      }

      // Next request should throw
      await expect(limiter.acquire(endpoint)).rejects.toThrow('Rate limit queue full');
    });

    it('should prioritize higher priority requests', async () => {
      const endpoint = 'priority-test';
      limiter.configure(endpoint, { maxTokens: 1, refillRate: 10 });

      // Consume the token
      limiter.tryAcquire(endpoint);

      // Queue low and high priority requests
      const results: number[] = [];
      const lowPriority = limiter.acquire(endpoint, 0).then(() => results.push(0));
      const highPriority = limiter.acquire(endpoint, 10).then(() => results.push(10));

      await Promise.all([lowPriority, highPriority]);

      // High priority should complete first
      expect(results[0]).toBe(10);
    });
  });

  describe('Statistics', () => {
    it('should track queue size', () => {
      const endpoint = 'stats-test';

      // Consume all tokens
      for (let i = 0; i < 10; i++) {
        limiter.tryAcquire(endpoint);
      }

      // Add to queue
      limiter.acquire(endpoint).catch(() => {});
      limiter.acquire(endpoint).catch(() => {});

      const stats = limiter.getStats(endpoint);
      expect(stats.queueSize).toBe(2);
    });

    it('should return list of bucket names', () => {
      limiter.tryAcquire('endpoint1');
      limiter.tryAcquire('endpoint2');
      limiter.tryAcquire('endpoint3');

      const names = limiter.getBucketNames();
      expect(names).toContain('endpoint1');
      expect(names).toContain('endpoint2');
      expect(names).toContain('endpoint3');
    });
  });

  describe('Destroy', () => {
    it('should reject queued requests on destroy', async () => {
      const endpoint = 'destroy-test';

      // Consume all tokens
      for (let i = 0; i < 10; i++) {
        limiter.tryAcquire(endpoint);
      }

      // Queue a request
      const promise = limiter.acquire(endpoint);

      // Destroy limiter
      limiter.destroy();

      await expect(promise).rejects.toThrow('Rate limiter destroyed');
    });
  });
});
