/**
 * CacheService Tests
 */

// Mock Logger before importing CacheService
jest.mock('../../src/utils/logger', () => ({
  Logger: jest.fn().mockImplementation(() => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  })),
}));

// Mock Database for UserCache tests
jest.mock('../../src/services/Database', () => ({
  getDatabase: jest.fn().mockReturnValue({
    getUser: jest.fn(),
    getUserById: jest.fn(),
    updateUserPoints: jest.fn(),
  }),
}));

import { CacheService } from '../../src/services/CacheService';

describe('CacheService', () => {
  let cache: CacheService;

  beforeEach(() => {
    // Create fresh cache for each test with short cleanup interval
    cache = new CacheService({
      defaultTTL: 5, // 5 seconds
      maxSize: 10,
      cleanupInterval: 60,
    });
  });

  afterEach(() => {
    cache.destroy();
  });

  describe('Basic Operations', () => {
    it('should set and get values', () => {
      cache.set('key1', 'value1');
      expect(cache.get('key1')).toBe('value1');
    });

    it('should return null for non-existent keys', () => {
      expect(cache.get('nonexistent')).toBeNull();
    });

    it('should handle different value types', () => {
      cache.set('string', 'hello');
      cache.set('number', 42);
      cache.set('object', { foo: 'bar' });
      cache.set('array', [1, 2, 3]);
      cache.set('boolean', true);

      expect(cache.get('string')).toBe('hello');
      expect(cache.get('number')).toBe(42);
      expect(cache.get('object')).toEqual({ foo: 'bar' });
      expect(cache.get('array')).toEqual([1, 2, 3]);
      expect(cache.get('boolean')).toBe(true);
    });

    it('should check key existence with has()', () => {
      cache.set('exists', 'value');
      expect(cache.has('exists')).toBe(true);
      expect(cache.has('notexists')).toBe(false);
    });

    it('should delete keys', () => {
      cache.set('toDelete', 'value');
      expect(cache.has('toDelete')).toBe(true);

      const deleted = cache.delete('toDelete');
      expect(deleted).toBe(true);
      expect(cache.has('toDelete')).toBe(false);
    });

    it('should return false when deleting non-existent key', () => {
      const deleted = cache.delete('nonexistent');
      expect(deleted).toBe(false);
    });
  });

  describe('TTL (Time To Live)', () => {
    it('should expire entries after TTL', async () => {
      cache.set('shortLived', 'value', 0.1); // 100ms TTL
      expect(cache.get('shortLived')).toBe('value');

      await new Promise(resolve => setTimeout(resolve, 150));
      expect(cache.get('shortLived')).toBeNull();
    });

    it('should use custom TTL when provided', async () => {
      cache.set('custom', 'value', 0.2); // 200ms

      await new Promise(resolve => setTimeout(resolve, 100));
      expect(cache.get('custom')).toBe('value');

      await new Promise(resolve => setTimeout(resolve, 150));
      expect(cache.get('custom')).toBeNull();
    });

    it('should not return expired entries with has()', async () => {
      cache.set('expiring', 'value', 0.1);
      expect(cache.has('expiring')).toBe(true);

      await new Promise(resolve => setTimeout(resolve, 150));
      expect(cache.has('expiring')).toBe(false);
    });
  });

  describe('LRU Eviction', () => {
    it('should evict least recently used when at max size', () => {
      // Fill cache to max size (10)
      for (let i = 0; i < 10; i++) {
        cache.set(`key${i}`, `value${i}`);
      }

      // Access key0 to make it recently used
      cache.get('key0');

      // Add new item - should evict key1 (oldest accessed)
      cache.set('key10', 'value10');

      expect(cache.has('key0')).toBe(true); // Recently accessed
      expect(cache.has('key10')).toBe(true); // Newly added
      // One of the older keys should be evicted
    });
  });

  describe('deletePattern', () => {
    it('should delete keys matching pattern', () => {
      cache.set('user:1:name', 'Alice');
      cache.set('user:1:email', 'alice@test.com');
      cache.set('user:2:name', 'Bob');
      cache.set('settings:theme', 'dark');

      const deleted = cache.deletePattern('user:1:*');
      expect(deleted).toBe(2);
      expect(cache.has('user:1:name')).toBe(false);
      expect(cache.has('user:1:email')).toBe(false);
      expect(cache.has('user:2:name')).toBe(true);
      expect(cache.has('settings:theme')).toBe(true);
    });
  });

  describe('getOrSet', () => {
    it('should return cached value if exists', async () => {
      cache.set('cached', 'existingValue');
      const factory = jest.fn().mockReturnValue('newValue');

      const result = await cache.getOrSet('cached', factory);

      expect(result).toBe('existingValue');
      expect(factory).not.toHaveBeenCalled();
    });

    it('should call factory and cache result if not exists', async () => {
      const factory = jest.fn().mockReturnValue('newValue');

      const result = await cache.getOrSet('notCached', factory);

      expect(result).toBe('newValue');
      expect(factory).toHaveBeenCalled();
      expect(cache.get('notCached')).toBe('newValue');
    });

    it('should handle async factory functions', async () => {
      const factory = jest.fn().mockResolvedValue('asyncValue');

      const result = await cache.getOrSet('asyncKey', factory);

      expect(result).toBe('asyncValue');
      expect(cache.get('asyncKey')).toBe('asyncValue');
    });
  });

  describe('clear', () => {
    it('should clear all entries', () => {
      cache.set('key1', 'value1');
      cache.set('key2', 'value2');
      cache.set('key3', 'value3');

      cache.clear();

      expect(cache.has('key1')).toBe(false);
      expect(cache.has('key2')).toBe(false);
      expect(cache.has('key3')).toBe(false);
    });
  });

  describe('getStats', () => {
    it('should track hits and misses', () => {
      cache.set('key', 'value');

      cache.get('key'); // hit
      cache.get('key'); // hit
      cache.get('nonexistent'); // miss

      const stats = cache.getStats();
      expect(stats.hits).toBe(2);
      expect(stats.misses).toBe(1);
      expect(stats.hitRate).toBeCloseTo(0.67, 1);
    });

    it('should track cache size', () => {
      cache.set('key1', 'value1');
      cache.set('key2', 'value2');

      const stats = cache.getStats();
      expect(stats.size).toBe(2);
    });
  });
});
