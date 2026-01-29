/**
 * Queue Service
 *
 * Universal queue management
 * Features:
 * - Priority queues
 * - FIFO/LIFO modes
 * - Queue persistence
 * - Event notifications
 */

import { Logger } from '../utils/logger';
import { EventEmitter } from 'events';

export interface QueueItem<T = any> {
  id: string;
  data: T;
  priority: number;
  createdAt: Date;
  metadata?: Record<string, any>;
}

export interface QueueConfig {
  name: string;
  maxSize: number;
  mode: 'fifo' | 'lifo' | 'priority';
  persistent: boolean;
  ttl?: number; // Time to live in ms
}

export interface QueueStats {
  name: string;
  size: number;
  maxSize: number;
  mode: string;
  processed: number;
  dropped: number;
}

const DEFAULT_CONFIG: Omit<QueueConfig, 'name'> = {
  maxSize: 1000,
  mode: 'fifo',
  persistent: false,
};

export class Queue<T = any> extends EventEmitter {
  private items: QueueItem<T>[] = [];
  private config: QueueConfig;
  private processed = 0;
  private dropped = 0;
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;

  constructor(config: Partial<QueueConfig> & { name: string }) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };

    if (this.config.ttl) {
      this.startCleanup();
    }
  }

  private startCleanup(): void {
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, Math.min(this.config.ttl! / 2, 60000));
  }

  private cleanup(): void {
    if (!this.config.ttl) return;

    const now = Date.now();
    const expired = this.items.filter(
      (item) => now - item.createdAt.getTime() > this.config.ttl!
    );

    for (const item of expired) {
      this.remove(item.id);
      this.emit('expired', item);
    }
  }

  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.items = [];
  }

  /**
   * Add item to queue
   */
  enqueue(data: T, priority: number = 0, metadata?: Record<string, any>): QueueItem<T> | null {
    if (this.items.length >= this.config.maxSize) {
      this.dropped++;
      this.emit('dropped', data);
      return null;
    }

    const item: QueueItem<T> = {
      id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      data,
      priority,
      createdAt: new Date(),
      metadata,
    };

    if (this.config.mode === 'priority') {
      // Insert in priority order (higher priority first)
      const index = this.items.findIndex((i) => i.priority < priority);
      if (index === -1) {
        this.items.push(item);
      } else {
        this.items.splice(index, 0, item);
      }
    } else {
      this.items.push(item);
    }

    this.emit('enqueue', item);
    return item;
  }

  /**
   * Remove and return item from queue
   */
  dequeue(): QueueItem<T> | null {
    if (this.items.length === 0) {
      return null;
    }

    let item: QueueItem<T>;

    if (this.config.mode === 'lifo') {
      item = this.items.pop()!;
    } else {
      item = this.items.shift()!;
    }

    this.processed++;
    this.emit('dequeue', item);
    return item;
  }

  /**
   * Peek at next item without removing
   */
  peek(): QueueItem<T> | null {
    if (this.items.length === 0) {
      return null;
    }

    if (this.config.mode === 'lifo') {
      return this.items[this.items.length - 1];
    }
    return this.items[0];
  }

  /**
   * Remove specific item by id
   */
  remove(id: string): boolean {
    const index = this.items.findIndex((item) => item.id === id);
    if (index === -1) {
      return false;
    }

    const [item] = this.items.splice(index, 1);
    this.emit('remove', item);
    return true;
  }

  /**
   * Find item by predicate
   */
  find(predicate: (item: QueueItem<T>) => boolean): QueueItem<T> | undefined {
    return this.items.find(predicate);
  }

  /**
   * Filter items by predicate
   */
  filter(predicate: (item: QueueItem<T>) => boolean): QueueItem<T>[] {
    return this.items.filter(predicate);
  }

  /**
   * Get item by id
   */
  get(id: string): QueueItem<T> | undefined {
    return this.items.find((item) => item.id === id);
  }

  /**
   * Check if queue contains item
   */
  has(id: string): boolean {
    return this.items.some((item) => item.id === id);
  }

  /**
   * Get queue size
   */
  size(): number {
    return this.items.length;
  }

  /**
   * Check if queue is empty
   */
  isEmpty(): boolean {
    return this.items.length === 0;
  }

  /**
   * Check if queue is full
   */
  isFull(): boolean {
    return this.items.length >= this.config.maxSize;
  }

  /**
   * Clear all items
   */
  clear(): void {
    this.items = [];
    this.emit('clear');
  }

  /**
   * Get all items
   */
  getAll(): QueueItem<T>[] {
    return [...this.items];
  }

  /**
   * Get queue statistics
   */
  getStats(): QueueStats {
    return {
      name: this.config.name,
      size: this.items.length,
      maxSize: this.config.maxSize,
      mode: this.config.mode,
      processed: this.processed,
      dropped: this.dropped,
    };
  }

  /**
   * Move item to front (for priority override)
   */
  moveToFront(id: string): boolean {
    const index = this.items.findIndex((item) => item.id === id);
    if (index === -1 || index === 0) {
      return false;
    }

    const [item] = this.items.splice(index, 1);
    this.items.unshift(item);
    return true;
  }

  /**
   * Move item to back
   */
  moveToBack(id: string): boolean {
    const index = this.items.findIndex((item) => item.id === id);
    if (index === -1 || index === this.items.length - 1) {
      return false;
    }

    const [item] = this.items.splice(index, 1);
    this.items.push(item);
    return true;
  }
}

export class QueueService {
  private log = new Logger('QueueService');
  private queues: Map<string, Queue> = new Map();

  constructor() {
    this.log.info('Queue Service initialized');
  }

  /**
   * Create a new queue
   */
  create<T = any>(config: Partial<QueueConfig> & { name: string }): Queue<T> {
    if (this.queues.has(config.name)) {
      throw new Error(`Queue "${config.name}" already exists`);
    }

    const queue = new Queue<T>(config);
    this.queues.set(config.name, queue);
    this.log.debug(`Created queue: ${config.name}`);
    return queue;
  }

  /**
   * Get existing queue or create new one
   */
  getOrCreate<T = any>(config: Partial<QueueConfig> & { name: string }): Queue<T> {
    const existing = this.queues.get(config.name);
    if (existing) {
      return existing as Queue<T>;
    }
    return this.create<T>(config);
  }

  /**
   * Get queue by name
   */
  get<T = any>(name: string): Queue<T> | undefined {
    return this.queues.get(name) as Queue<T> | undefined;
  }

  /**
   * Delete queue
   */
  delete(name: string): boolean {
    const queue = this.queues.get(name);
    if (queue) {
      queue.destroy();
      this.queues.delete(name);
      this.log.debug(`Deleted queue: ${name}`);
      return true;
    }
    return false;
  }

  /**
   * Get all queue names
   */
  getQueueNames(): string[] {
    return Array.from(this.queues.keys());
  }

  /**
   * Get statistics for all queues
   */
  getAllStats(): QueueStats[] {
    return Array.from(this.queues.values()).map((q) => q.getStats());
  }

  /**
   * Destroy all queues
   */
  destroy(): void {
    for (const queue of this.queues.values()) {
      queue.destroy();
    }
    this.queues.clear();
  }
}

// Singleton instance
let queueServiceInstance: QueueService | null = null;

export function getQueueService(): QueueService {
  if (!queueServiceInstance) {
    queueServiceInstance = new QueueService();
  }
  return queueServiceInstance;
}
