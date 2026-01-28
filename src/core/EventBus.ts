/**
 * EventBus - The heart of StreamCore
 *
 * A typed event emitter that supports:
 * - Strongly typed events
 * - Wildcard listeners (*)
 * - Before/after hooks
 * - Event history for debugging
 */

import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import { EventName, EventMap, StreamCoreEvent } from '../types/events';
import { HookContext, HookHandler, HookStage } from '../types/plugins';
import { Logger } from '../utils/logger';

type EventListener<T> = (event: T) => void | Promise<void>;

interface Hook {
  stage: HookStage;
  eventName: EventName;
  handler: HookHandler;
  priority: number;
}

export class EventBus {
  private emitter = new EventEmitter();
  private hooks: Hook[] = [];
  private eventHistory: StreamCoreEvent[] = [];
  private readonly maxHistory = 100;
  private logger = new Logger('EventBus');

  constructor() {
    // Increase max listeners for busy systems
    this.emitter.setMaxListeners(100);
  }

  /**
   * Subscribe to an event
   */
  on<K extends EventName>(
    eventName: K,
    listener: EventListener<EventMap[K]>
  ): () => void {
    this.emitter.on(eventName, listener);
    this.logger.debug(`Listener added for: ${eventName}`);

    // Return unsubscribe function
    return () => {
      this.emitter.off(eventName, listener);
    };
  }

  /**
   * Subscribe to an event (once)
   */
  once<K extends EventName>(
    eventName: K,
    listener: EventListener<EventMap[K]>
  ): void {
    this.emitter.once(eventName, listener);
  }

  /**
   * Unsubscribe from an event
   */
  off<K extends EventName>(
    eventName: K,
    listener: EventListener<EventMap[K]>
  ): void {
    this.emitter.off(eventName, listener);
  }

  /**
   * Emit an event
   * Runs through before hooks, emits, then after hooks
   */
  async emit<K extends EventName>(
    eventName: K,
    eventData: Omit<EventMap[K], 'id' | 'timestamp'>
  ): Promise<boolean> {
    const event = {
      ...eventData,
      id: uuidv4(),
      timestamp: new Date(),
    } as EventMap[K];

    // Store in history
    this.addToHistory(event as StreamCoreEvent);

    // Create hook context
    const ctx: HookContext = {
      event: event as StreamCoreEvent,
      cancelled: false,
      cancel: () => { ctx.cancelled = true; },
      data: {},
    };

    // Run before hooks
    await this.runHooks('before', eventName, ctx);

    if (ctx.cancelled) {
      this.logger.debug(`Event cancelled: ${eventName}`);
      return false;
    }

    // Emit the event
    this.emitter.emit(eventName, event);

    // Also emit to wildcard listeners
    this.emitter.emit('*', event);

    // Run after hooks
    await this.runHooks('after', eventName, ctx);

    return true;
  }

  /**
   * Register a hook
   */
  hook<K extends EventName>(
    stage: HookStage,
    eventName: K,
    handler: HookHandler<EventMap[K]>,
    priority: number = 10
  ): () => void {
    const hook: Hook = {
      stage,
      eventName,
      handler: handler as HookHandler,
      priority,
    };

    this.hooks.push(hook);
    // Sort by priority (lower = runs first)
    this.hooks.sort((a, b) => a.priority - b.priority);

    this.logger.debug(`Hook registered: ${stage}:${eventName} (priority: ${priority})`);

    // Return unregister function
    return () => {
      const index = this.hooks.indexOf(hook);
      if (index > -1) {
        this.hooks.splice(index, 1);
      }
    };
  }

  /**
   * Run hooks for a specific stage and event
   */
  private async runHooks(
    stage: HookStage,
    eventName: EventName,
    ctx: HookContext
  ): Promise<void> {
    const relevantHooks = this.hooks.filter(
      h => h.stage === stage && (h.eventName === eventName || h.eventName === '*')
    );

    for (const hook of relevantHooks) {
      if (ctx.cancelled && stage === 'before') {
        break;
      }

      try {
        await hook.handler(ctx);
      } catch (error) {
        this.logger.error(`Hook error (${stage}:${eventName}):`, error);
      }
    }
  }

  /**
   * Add event to history
   */
  private addToHistory(event: StreamCoreEvent): void {
    this.eventHistory.push(event);
    if (this.eventHistory.length > this.maxHistory) {
      this.eventHistory.shift();
    }
  }

  /**
   * Get event history (for debugging/dashboard)
   */
  getHistory(limit?: number): StreamCoreEvent[] {
    if (limit) {
      return this.eventHistory.slice(-limit);
    }
    return [...this.eventHistory];
  }

  /**
   * Clear all listeners and hooks
   */
  clear(): void {
    this.emitter.removeAllListeners();
    this.hooks = [];
    this.logger.info('EventBus cleared');
  }

  /**
   * Get listener count for an event
   */
  listenerCount(eventName: EventName): number {
    return this.emitter.listenerCount(eventName);
  }
}

// Singleton instance
export const eventBus = new EventBus();
