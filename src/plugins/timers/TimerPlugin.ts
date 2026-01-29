/**
 * Timer Plugin
 *
 * Features:
 * - Time-based automated messages
 * - Minimum chat activity requirement
 * - Multiple messages per timer (rotation)
 * - Enable/disable timers
 */

import { Plugin } from '../base/Plugin';
import { PluginMeta, Permission } from '../../types/plugins';
import { ChatMessageEvent } from '../../types/events';
import { getDatabase, DatabaseService, DBTimer } from '../../services/Database';
import { v4 as uuidv4 } from 'uuid';

interface ActiveTimer {
  id: string;
  interval: NodeJS.Timeout;
  messageIndex: number;
  messagesSinceLastTrigger: number;
}

export class TimerPlugin extends Plugin {
  meta: PluginMeta = {
    name: 'timers',
    version: '1.0.0',
    description: 'Automated timed messages',
    author: 'StreamCore',
  };

  private db!: DatabaseService;
  private activeTimers: Map<string, ActiveTimer> = new Map();
  private globalMessageCount: number = 0;
  private channel: string = '';

  protected async init(): Promise<void> {
    this.db = getDatabase();
    this.log.info('Initializing Timer system...');

    // Get channel from settings or env
    this.channel = process.env.TWITCH_CHANNEL || '';

    // Load and start all enabled timers
    this.loadTimers();

    // Register commands
    this.registerCommands();

    // Track message count
    this.trackMessages();

    this.log.info('Timer system initialized!');
  }

  protected async destroy(): Promise<void> {
    // Stop all active timers
    for (const [id, timer] of this.activeTimers) {
      clearInterval(timer.interval);
    }
    this.activeTimers.clear();
  }

  private trackMessages(): void {
    // We'll hook into chat messages to track activity
    // This is a simplified approach - in production you'd use the event bus
  }

  public incrementMessageCount(): void {
    this.globalMessageCount++;
  }

  private loadTimers(): void {
    const timers = this.db.getAllTimers();

    for (const timer of timers) {
      if (timer.enabled) {
        this.startTimer(timer);
      }
    }

    this.log.info(`Loaded ${timers.length} timers (${this.activeTimers.size} active)`);
  }

  private startTimer(timer: DBTimer): void {
    if (this.activeTimers.has(timer.id)) {
      return; // Already running
    }

    const messages = JSON.parse(timer.messages) as string[];

    const activeTimer: ActiveTimer = {
      id: timer.id,
      messageIndex: 0,
      messagesSinceLastTrigger: 0,
      interval: setInterval(() => {
        this.triggerTimer(timer.id);
      }, timer.interval_minutes * 60 * 1000),
    };

    this.activeTimers.set(timer.id, activeTimer);
    this.log.debug(`Timer started: ${timer.name} (every ${timer.interval_minutes}min)`);
  }

  private stopTimer(id: string): void {
    const timer = this.activeTimers.get(id);
    if (timer) {
      clearInterval(timer.interval);
      this.activeTimers.delete(id);
    }
  }

  private triggerTimer(id: string): void {
    const dbTimer = this.db.getTimer(id);
    const activeTimer = this.activeTimers.get(id);

    if (!dbTimer || !activeTimer) {
      return;
    }

    // Check minimum message requirement
    if (this.globalMessageCount < dbTimer.min_messages) {
      this.log.debug(`Timer ${dbTimer.name} skipped: not enough chat activity`);
      return;
    }

    const messages = JSON.parse(dbTimer.messages) as string[];
    if (messages.length === 0) {
      return;
    }

    // Get current message
    const message = messages[activeTimer.messageIndex];

    // Send message
    this.sendMessage(this.channel, message);

    // Update index for next time (rotate through messages)
    activeTimer.messageIndex = (activeTimer.messageIndex + 1) % messages.length;

    // Update last triggered
    this.db.updateTimerLastTriggered(id);

    // Reset message count
    this.globalMessageCount = 0;

    this.log.debug(`Timer triggered: ${dbTimer.name}`);
  }

  private registerCommands(): void {
    // !timer add - Add a new timer
    this.registerCommand({
      name: 'timer',
      description: 'Manage timers',
      usage: '!timer <add|remove|list|enable|disable>',
      permission: Permission.MODERATOR,
      cooldown: { user: 0, global: 0 },
      handler: async (ctx) => {
        if (ctx.args.length === 0) {
          ctx.reply('Verwendung: !timer <add|remove|list|enable|disable> [name] [optionen]');
          return;
        }

        const action = ctx.args[0].toLowerCase();

        switch (action) {
          case 'add':
            await this.handleAddTimer(ctx);
            break;
          case 'remove':
          case 'delete':
            await this.handleRemoveTimer(ctx);
            break;
          case 'list':
            await this.handleListTimers(ctx);
            break;
          case 'enable':
            await this.handleToggleTimer(ctx, true);
            break;
          case 'disable':
            await this.handleToggleTimer(ctx, false);
            break;
          default:
            ctx.reply('❌ Unbekannte Aktion. Verwende: add, remove, list, enable, disable');
        }
      },
    });

    // !timers - List all timers
    this.registerCommand({
      name: 'timers',
      description: 'List all timers',
      permission: Permission.MODERATOR,
      cooldown: { user: 5, global: 0 },
      handler: async (ctx) => {
        await this.handleListTimers({ ...ctx, args: [] });
      },
    });
  }

  private async handleAddTimer(ctx: any): Promise<void> {
    // Format: !timer add <name> <interval_min> <message>
    if (ctx.args.length < 4) {
      ctx.reply('Verwendung: !timer add <name> <minuten> <nachricht>');
      return;
    }

    const name = ctx.args[1];
    const intervalMinutes = parseInt(ctx.args[2]);
    const message = ctx.args.slice(3).join(' ');

    if (isNaN(intervalMinutes) || intervalMinutes < 1) {
      ctx.reply('❌ Intervall muss mindestens 1 Minute sein!');
      return;
    }

    const id = uuidv4();
    const timer = this.db.createTimer(id, name, [message], intervalMinutes, 5);

    // Start the timer
    this.startTimer(timer);

    ctx.reply(`✅ Timer "${name}" erstellt! Intervall: ${intervalMinutes} Minuten`);
  }

  private async handleRemoveTimer(ctx: any): Promise<void> {
    if (ctx.args.length < 2) {
      ctx.reply('Verwendung: !timer remove <name>');
      return;
    }

    const name = ctx.args[1];
    const timers = this.db.getAllTimers();
    const timer = timers.find(t => t.name.toLowerCase() === name.toLowerCase());

    if (!timer) {
      ctx.reply(`❌ Timer "${name}" nicht gefunden!`);
      return;
    }

    this.stopTimer(timer.id);
    this.db.deleteTimer(timer.id);

    ctx.reply(`✅ Timer "${name}" gelöscht!`);
  }

  private async handleListTimers(ctx: any): Promise<void> {
    const timers = this.db.getAllTimers();

    if (timers.length === 0) {
      ctx.reply('📋 Keine Timer vorhanden.');
      return;
    }

    const list = timers
      .map(t => `${t.enabled ? '✅' : '❌'} ${t.name} (${t.interval_minutes}min)`)
      .join(' | ');

    ctx.reply(`📋 Timer: ${list}`);
  }

  private async handleToggleTimer(ctx: any, enabled: boolean): Promise<void> {
    if (ctx.args.length < 2) {
      ctx.reply(`Verwendung: !timer ${enabled ? 'enable' : 'disable'} <name>`);
      return;
    }

    const name = ctx.args[1];
    const timers = this.db.getAllTimers();
    const timer = timers.find(t => t.name.toLowerCase() === name.toLowerCase());

    if (!timer) {
      ctx.reply(`❌ Timer "${name}" nicht gefunden!`);
      return;
    }

    // Update in database (would need a proper update method)
    if (enabled) {
      const dbTimer = this.db.getTimer(timer.id);
      if (dbTimer) {
        this.startTimer(dbTimer);
      }
    } else {
      this.stopTimer(timer.id);
    }

    ctx.reply(`✅ Timer "${name}" ${enabled ? 'aktiviert' : 'deaktiviert'}!`);
  }

  // Public API - convert DBTimer to Timer format
  getTimers() {
    return this.db.getAllTimers().map((t) => ({
      id: t.id,
      name: t.name,
      messages: JSON.parse(t.messages),
      intervalMinutes: t.interval_minutes,
      minChatMessages: t.min_messages,
      enabled: t.enabled,
      lastTriggered: t.last_triggered ? new Date(t.last_triggered) : undefined,
    }));
  }

  addTimer(name: string, messages: string[], intervalMinutes: number, minMessages: number = 5): DBTimer {
    const id = uuidv4();
    const timer = this.db.createTimer(id, name, messages, intervalMinutes, minMessages);
    this.startTimer(timer);
    return timer;
  }

  removeTimer(id: string): void {
    this.stopTimer(id);
    this.db.deleteTimer(id);
  }
}
