/**
 * Notification Service
 *
 * Push notifications for desktop and mobile
 * Features:
 * - Desktop notifications
 * - Push notifications (via web push)
 * - Notification history
 * - Priority levels
 */

import { Logger } from '../utils/logger';
import { EventEmitter } from 'events';

export interface Notification {
  id: string;
  title: string;
  message: string;
  icon?: string;
  image?: string;
  priority: 'low' | 'normal' | 'high' | 'urgent';
  category: string;
  data?: Record<string, any>;
  actions?: NotificationAction[];
  timestamp: Date;
  read: boolean;
  dismissed: boolean;
}

export interface NotificationAction {
  id: string;
  label: string;
  url?: string;
}

export interface PushSubscription {
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
  userId?: string;
}

export interface NotificationSettings {
  enabled: boolean;
  desktopEnabled: boolean;
  pushEnabled: boolean;
  soundEnabled: boolean;
  maxHistory: number;
  quietHoursStart?: number; // Hour (0-23)
  quietHoursEnd?: number;
  allowedCategories: string[];
  blockedCategories: string[];
}

const DEFAULT_SETTINGS: NotificationSettings = {
  enabled: true,
  desktopEnabled: true,
  pushEnabled: false,
  soundEnabled: true,
  maxHistory: 100,
  allowedCategories: [],
  blockedCategories: [],
};

export class NotificationService extends EventEmitter {
  private log = new Logger('NotificationService');
  private settings: NotificationSettings;
  private history: Notification[] = [];
  private pushSubscriptions: Map<string, PushSubscription> = new Map();

  constructor(settings: Partial<NotificationSettings> = {}) {
    super();
    this.settings = { ...DEFAULT_SETTINGS, ...settings };
    this.log.info('Notification Service initialized');
  }

  /**
   * Send a notification
   */
  async send(notification: Omit<Notification, 'id' | 'timestamp' | 'read' | 'dismissed'>): Promise<Notification | null> {
    if (!this.settings.enabled) {
      return null;
    }

    // Check quiet hours
    if (this.isQuietHours() && notification.priority !== 'urgent') {
      this.log.debug('Notification blocked: quiet hours');
      return null;
    }

    // Check category filters
    if (this.settings.blockedCategories.includes(notification.category)) {
      return null;
    }

    if (this.settings.allowedCategories.length > 0 &&
        !this.settings.allowedCategories.includes(notification.category)) {
      return null;
    }

    const fullNotification: Notification = {
      ...notification,
      id: `notif-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      timestamp: new Date(),
      read: false,
      dismissed: false,
    };

    // Add to history
    this.history.unshift(fullNotification);
    if (this.history.length > this.settings.maxHistory) {
      this.history.pop();
    }

    // Send to different channels
    if (this.settings.desktopEnabled) {
      this.sendDesktopNotification(fullNotification);
    }

    if (this.settings.pushEnabled) {
      await this.sendPushNotification(fullNotification);
    }

    this.emit('notification', fullNotification);
    return fullNotification;
  }

  /**
   * Send desktop notification (Electron)
   */
  private sendDesktopNotification(notification: Notification): void {
    // Emit event for Electron main process to handle
    this.emit('desktop-notification', {
      title: notification.title,
      body: notification.message,
      icon: notification.icon,
      silent: !this.settings.soundEnabled,
      urgency: notification.priority === 'urgent' ? 'critical' :
               notification.priority === 'high' ? 'normal' : 'low',
      data: notification.data,
    });

    this.log.debug(`Desktop notification sent: ${notification.title}`);
  }

  /**
   * Send push notification
   */
  private async sendPushNotification(notification: Notification): Promise<void> {
    // This would use web-push library in production
    // For now, emit event for external handler
    this.emit('push-notification', {
      title: notification.title,
      body: notification.message,
      icon: notification.icon,
      image: notification.image,
      data: notification.data,
      actions: notification.actions,
    });

    this.log.debug(`Push notification queued: ${notification.title}`);
  }

  /**
   * Check if currently in quiet hours
   */
  private isQuietHours(): boolean {
    if (this.settings.quietHoursStart === undefined ||
        this.settings.quietHoursEnd === undefined) {
      return false;
    }

    const now = new Date();
    const hour = now.getHours();

    if (this.settings.quietHoursStart <= this.settings.quietHoursEnd) {
      // Normal range (e.g., 22-06)
      return hour >= this.settings.quietHoursStart && hour < this.settings.quietHoursEnd;
    } else {
      // Overnight range (e.g., 22-06 -> 22-24 and 0-06)
      return hour >= this.settings.quietHoursStart || hour < this.settings.quietHoursEnd;
    }
  }

  /**
   * Add push subscription
   */
  addPushSubscription(id: string, subscription: PushSubscription): void {
    this.pushSubscriptions.set(id, subscription);
    this.log.debug(`Push subscription added: ${id}`);
  }

  /**
   * Remove push subscription
   */
  removePushSubscription(id: string): boolean {
    const removed = this.pushSubscriptions.delete(id);
    if (removed) {
      this.log.debug(`Push subscription removed: ${id}`);
    }
    return removed;
  }

  /**
   * Mark notification as read
   */
  markAsRead(id: string): boolean {
    const notification = this.history.find((n) => n.id === id);
    if (notification) {
      notification.read = true;
      this.emit('notification-read', notification);
      return true;
    }
    return false;
  }

  /**
   * Mark all notifications as read
   */
  markAllAsRead(): void {
    for (const notification of this.history) {
      notification.read = true;
    }
    this.emit('all-read');
  }

  /**
   * Dismiss notification
   */
  dismiss(id: string): boolean {
    const notification = this.history.find((n) => n.id === id);
    if (notification) {
      notification.dismissed = true;
      this.emit('notification-dismissed', notification);
      return true;
    }
    return false;
  }

  /**
   * Get notification by id
   */
  get(id: string): Notification | undefined {
    return this.history.find((n) => n.id === id);
  }

  /**
   * Get unread notifications
   */
  getUnread(): Notification[] {
    return this.history.filter((n) => !n.read && !n.dismissed);
  }

  /**
   * Get notification history
   */
  getHistory(limit?: number): Notification[] {
    const notifications = this.history.filter((n) => !n.dismissed);
    return limit ? notifications.slice(0, limit) : notifications;
  }

  /**
   * Get unread count
   */
  getUnreadCount(): number {
    return this.history.filter((n) => !n.read && !n.dismissed).length;
  }

  /**
   * Clear history
   */
  clearHistory(): void {
    this.history = [];
    this.emit('history-cleared');
  }

  /**
   * Update settings
   */
  updateSettings(settings: Partial<NotificationSettings>): void {
    this.settings = { ...this.settings, ...settings };
    this.emit('settings-updated', this.settings);
  }

  /**
   * Get current settings
   */
  getSettings(): NotificationSettings {
    return { ...this.settings };
  }

  /**
   * Quick notification methods
   */
  info(title: string, message: string, data?: Record<string, any>): Promise<Notification | null> {
    return this.send({ title, message, priority: 'normal', category: 'info', data });
  }

  success(title: string, message: string, data?: Record<string, any>): Promise<Notification | null> {
    return this.send({ title, message, priority: 'normal', category: 'success', icon: '✅', data });
  }

  warning(title: string, message: string, data?: Record<string, any>): Promise<Notification | null> {
    return this.send({ title, message, priority: 'high', category: 'warning', icon: '⚠️', data });
  }

  error(title: string, message: string, data?: Record<string, any>): Promise<Notification | null> {
    return this.send({ title, message, priority: 'urgent', category: 'error', icon: '❌', data });
  }

  // Stream-specific notifications
  newFollower(username: string): Promise<Notification | null> {
    return this.send({
      title: 'Neuer Follower!',
      message: `${username} folgt dir jetzt`,
      priority: 'normal',
      category: 'stream',
      icon: '❤️',
      data: { type: 'follow', username },
    });
  }

  newSubscriber(username: string, tier: string): Promise<Notification | null> {
    return this.send({
      title: 'Neuer Subscriber!',
      message: `${username} hat mit Tier ${tier} abonniert`,
      priority: 'high',
      category: 'stream',
      icon: '⭐',
      data: { type: 'sub', username, tier },
    });
  }

  newDonation(username: string, amount: number): Promise<Notification | null> {
    return this.send({
      title: 'Spende erhalten!',
      message: `${username} hat ${amount} Bits gespendet`,
      priority: 'high',
      category: 'stream',
      icon: '💎',
      data: { type: 'donation', username, amount },
    });
  }

  raid(username: string, viewers: number): Promise<Notification | null> {
    return this.send({
      title: 'Raid!',
      message: `${username} raidet mit ${viewers} Viewern`,
      priority: 'urgent',
      category: 'stream',
      icon: '🎯',
      data: { type: 'raid', username, viewers },
    });
  }
}

// Singleton instance
let notificationServiceInstance: NotificationService | null = null;

export function getNotificationService(settings?: Partial<NotificationSettings>): NotificationService {
  if (!notificationServiceInstance) {
    notificationServiceInstance = new NotificationService(settings);
  }
  return notificationServiceInstance;
}
