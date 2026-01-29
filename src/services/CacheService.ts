/**
 * Cache Service
 *
 * High-performance in-memory caching with:
 * - TTL (Time To Live) support
 * - Automatic cleanup
 * - LRU eviction when max size reached
 * - Type-safe getters
 */

import { Logger } from '../utils/logger';

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
  lastAccessed: number;
}

interface CacheOptions {
  defaultTTL: number; // seconds
  maxSize: number;
  cleanupInterval: number; // seconds
}

const DEFAULT_OPTIONS: CacheOptions = {
  defaultTTL: 300, // 5 minutes
  maxSize: 10000,
  cleanupInterval: 60, // 1 minute
};

export class CacheService {
  private cache: Map<string, CacheEntry<any>> = new Map();
  private options: CacheOptions;
  private cleanupTimer?: NodeJS.Timeout;
  private logger = new Logger('Cache');
  private stats = {
    hits: 0,
    misses: 0,
    evictions: 0,
  };

  constructor(options?: Partial<CacheOptions>) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.startCleanup();
    this.logger.info('Cache initialized');
  }

  /**
   * Get a value from cache
   */
  get<T>(key: string): T | null {
    const entry = this.cache.get(key);

    if (!entry) {
      this.stats.misses++;
      return null;
    }

    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      this.stats.misses++;
      return null;
    }

    entry.lastAccessed = Date.now();
    this.stats.hits++;
    return entry.value as T;
  }

  /**
   * Set a value in cache
   */
  set<T>(key: string, value: T, ttlSeconds?: number): void {
    // Evict oldest entries if at max size
    if (this.cache.size >= this.options.maxSize) {
      this.evictLRU();
    }

    const ttl = ttlSeconds ?? this.options.defaultTTL;
    const now = Date.now();

    this.cache.set(key, {
      value,
      expiresAt: now + ttl * 1000,
      lastAccessed: now,
    });
  }

  /**
   * Check if key exists and is not expired
   */
  has(key: string): boolean {
    const entry = this.cache.get(key);
    if (!entry) return false;
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return false;
    }
    return true;
  }

  /**
   * Delete a key from cache
   */
  delete(key: string): boolean {
    return this.cache.delete(key);
  }

  /**
   * Delete keys matching a pattern
   */
  deletePattern(pattern: string): number {
    const regex = new RegExp(pattern.replace('*', '.*'));
    let count = 0;

    for (const key of this.cache.keys()) {
      if (regex.test(key)) {
        this.cache.delete(key);
        count++;
      }
    }

    return count;
  }

  /**
   * Get or set (with factory function)
   */
  async getOrSet<T>(
    key: string,
    factory: () => T | Promise<T>,
    ttlSeconds?: number
  ): Promise<T> {
    const cached = this.get<T>(key);
    if (cached !== null) {
      return cached;
    }

    const value = await factory();
    this.set(key, value, ttlSeconds);
    return value;
  }

  /**
   * Clear all cache entries
   */
  clear(): void {
    this.cache.clear();
    this.logger.info('Cache cleared');
  }

  /**
   * Get cache statistics
   */
  getStats(): {
    size: number;
    hits: number;
    misses: number;
    hitRate: number;
    evictions: number;
  } {
    const total = this.stats.hits + this.stats.misses;
    return {
      size: this.cache.size,
      hits: this.stats.hits,
      misses: this.stats.misses,
      hitRate: total > 0 ? this.stats.hits / total : 0,
      evictions: this.stats.evictions,
    };
  }

  /**
   * Evict least recently used entries
   */
  private evictLRU(): void {
    let oldest: { key: string; time: number } | null = null;

    for (const [key, entry] of this.cache.entries()) {
      if (!oldest || entry.lastAccessed < oldest.time) {
        oldest = { key, time: entry.lastAccessed };
      }
    }

    if (oldest) {
      this.cache.delete(oldest.key);
      this.stats.evictions++;
    }
  }

  /**
   * Start automatic cleanup of expired entries
   */
  private startCleanup(): void {
    this.cleanupTimer = setInterval(() => {
      const now = Date.now();
      let cleaned = 0;

      for (const [key, entry] of this.cache.entries()) {
        if (now > entry.expiresAt) {
          this.cache.delete(key);
          cleaned++;
        }
      }

      if (cleaned > 0) {
        this.logger.debug(`Cleaned ${cleaned} expired cache entries`);
      }
    }, this.options.cleanupInterval * 1000);
  }

  /**
   * Stop cleanup timer
   */
  destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
    }
  }
}

// ==========================================
// User Cache - Specialized for user data
// ==========================================

import { DBUser, getDatabase } from './Database';

export class UserCache {
  private cache: CacheService;
  private db = getDatabase();
  private logger = new Logger('UserCache');

  constructor(ttlSeconds: number = 300) {
    this.cache = new CacheService({
      defaultTTL: ttlSeconds,
      maxSize: 5000,
    });
    this.logger.info('User cache initialized');
  }

  /**
   * Get user from cache or database
   */
  async getUser(platform: string, username: string): Promise<DBUser | null> {
    const key = `user:${platform}:${username.toLowerCase()}`;

    return this.cache.getOrSet(key, () => {
      return this.db.getUser(platform, username);
    });
  }

  /**
   * Get user by ID from cache or database
   */
  async getUserById(id: string): Promise<DBUser | null> {
    const key = `user:id:${id}`;

    return this.cache.getOrSet(key, () => {
      return this.db.getUserById(id);
    });
  }

  /**
   * Invalidate user cache (after updates)
   */
  invalidateUser(platform: string, username: string): void {
    const key = `user:${platform}:${username.toLowerCase()}`;
    this.cache.delete(key);
  }

  /**
   * Invalidate all cache for a platform
   */
  invalidatePlatform(platform: string): void {
    this.cache.deletePattern(`user:${platform}:*`);
  }

  /**
   * Update user and invalidate cache
   */
  updateUserPoints(platform: string, username: string, delta: number): void {
    this.db.updateUserPoints(platform, username, delta);
    this.invalidateUser(platform, username);
  }

  /**
   * Get cache stats
   */
  getStats() {
    return this.cache.getStats();
  }

  destroy(): void {
    this.cache.destroy();
  }
}

// Singleton instances
let cacheInstance: CacheService | null = null;
let userCacheInstance: UserCache | null = null;

export function getCache(): CacheService {
  if (!cacheInstance) {
    cacheInstance = new CacheService();
  }
  return cacheInstance;
}

export function getUserCache(): UserCache {
  if (!userCacheInstance) {
    userCacheInstance = new UserCache();
  }
  return userCacheInstance;
}
