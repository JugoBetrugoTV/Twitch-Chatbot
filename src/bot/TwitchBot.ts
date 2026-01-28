import tmi from 'tmi.js';
import { EventEmitter } from 'events';
import { config } from '../config';
import { BotCommand, CommandContext, ChatMessage, BotStats } from '../types';
import { v4 as uuidv4 } from 'uuid';

export class TwitchBot extends EventEmitter {
  private client: tmi.Client;
  private commands: Map<string, BotCommand> = new Map();
  private commandAliases: Map<string, string> = new Map();
  private cooldowns: Map<string, Map<string, number>> = new Map();
  private stats: BotStats = {
    messagesReceived: 0,
    commandsExecuted: 0,
    songsPlayed: 0,
    ttsMessagesRead: 0,
    uptime: Date.now(),
    peakViewers: 0,
  };
  private recentMessages: ChatMessage[] = [];
  private readonly maxRecentMessages = 100;

  constructor() {
    super();

    this.client = new tmi.Client({
      options: { debug: true },
      connection: {
        secure: true,
        reconnect: true,
      },
      identity: {
        username: config.twitch.botUsername,
        password: config.twitch.oauthToken,
      },
      channels: [config.twitch.channel],
    });

    this.setupEventHandlers();
  }

  private setupEventHandlers(): void {
    this.client.on('connected', (address, port) => {
      console.log(`✅ Connected to Twitch IRC: ${address}:${port}`);
      this.emit('connected', { address, port });
    });

    this.client.on('disconnected', (reason) => {
      console.log(`❌ Disconnected from Twitch: ${reason}`);
      this.emit('disconnected', reason);
    });

    this.client.on('message', (channel, userstate, message, self) => {
      if (self) return;

      this.stats.messagesReceived++;

      const chatMessage: ChatMessage = {
        id: userstate.id || uuidv4(),
        username: userstate.username || '',
        displayName: userstate['display-name'] || userstate.username || '',
        message,
        timestamp: new Date(),
        isMod: userstate.mod || false,
        isSub: userstate.subscriber || false,
        isVip: userstate.badges?.vip === '1',
        badges: new Map(
          Object.entries(userstate.badges || {}).filter((entry): entry is [string, string] => entry[1] !== undefined)
        ),
        color: userstate.color || '#FFFFFF',
      };

      this.addRecentMessage(chatMessage);
      this.emit('message', chatMessage);

      // Check for commands
      if (message.startsWith(config.commandPrefix)) {
        this.handleCommand(channel, userstate, message);
      }
    });

    this.client.on('join', (channel, username, self) => {
      if (!self) {
        this.emit('userJoin', { channel, username });
      }
    });

    this.client.on('part', (channel, username, self) => {
      if (!self) {
        this.emit('userPart', { channel, username });
      }
    });

    this.client.on('subscription', (channel, username, method, message, userstate) => {
      this.emit('subscription', { channel, username, method, message, userstate });
    });

    this.client.on('cheer', (channel, userstate, message) => {
      this.emit('cheer', { channel, userstate, message });
    });

    this.client.on('raided', (channel, username, viewers) => {
      this.emit('raid', { channel, username, viewers });
    });
  }

  private addRecentMessage(message: ChatMessage): void {
    this.recentMessages.push(message);
    if (this.recentMessages.length > this.maxRecentMessages) {
      this.recentMessages.shift();
    }
  }

  private async handleCommand(
    channel: string,
    userstate: tmi.ChatUserstate,
    message: string
  ): Promise<void> {
    const args = message.slice(config.commandPrefix.length).trim().split(/\s+/);
    const commandName = args.shift()?.toLowerCase();

    if (!commandName) return;

    // Check for alias
    const actualCommandName = this.commandAliases.get(commandName) || commandName;
    const command = this.commands.get(actualCommandName);

    if (!command || !command.enabled) return;

    const username = userstate.username || '';
    const isBroadcaster = username.toLowerCase() === config.twitch.channel.toLowerCase();
    const isMod = userstate.mod || isBroadcaster;
    const isSub = userstate.subscriber || false;

    // Check permissions
    if (command.modOnly && !isMod) {
      return;
    }

    if (command.subOnly && !isSub && !isMod) {
      return;
    }

    // Check cooldown
    if (!this.checkCooldown(actualCommandName, username, command.cooldown)) {
      return;
    }

    const context: CommandContext = {
      channel,
      user: {
        username,
        displayName: userstate['display-name'] || username,
        isMod,
        isSub,
        isVip: userstate.badges?.vip === '1',
        isBroadcaster,
      },
      message,
      args,
      reply: (msg: string) => this.say(channel, msg),
    };

    try {
      await command.execute(context);
      this.stats.commandsExecuted++;
      this.emit('commandExecuted', { command: actualCommandName, context });
    } catch (error) {
      console.error(`Error executing command ${actualCommandName}:`, error);
      this.emit('commandError', { command: actualCommandName, error });
    }
  }

  private checkCooldown(command: string, username: string, cooldownSeconds: number): boolean {
    if (cooldownSeconds <= 0) return true;

    const now = Date.now();
    const cooldownKey = `${command}:${username}`;

    if (!this.cooldowns.has(command)) {
      this.cooldowns.set(command, new Map());
    }

    const commandCooldowns = this.cooldowns.get(command)!;
    const lastUsed = commandCooldowns.get(username) || 0;

    if (now - lastUsed < cooldownSeconds * 1000) {
      return false;
    }

    commandCooldowns.set(username, now);
    return true;
  }

  public registerCommand(command: BotCommand): void {
    this.commands.set(command.name, command);

    // Register aliases
    for (const alias of command.aliases) {
      this.commandAliases.set(alias, command.name);
    }

    console.log(`📝 Registered command: !${command.name}`);
  }

  public unregisterCommand(name: string): void {
    const command = this.commands.get(name);
    if (command) {
      for (const alias of command.aliases) {
        this.commandAliases.delete(alias);
      }
      this.commands.delete(name);
    }
  }

  public async connect(): Promise<void> {
    try {
      await this.client.connect();
    } catch (error) {
      console.error('Failed to connect:', error);
      throw error;
    }
  }

  public async disconnect(): Promise<void> {
    await this.client.disconnect();
  }

  public say(channel: string, message: string): void {
    this.client.say(channel, message).catch(console.error);
  }

  public getStats(): BotStats {
    return { ...this.stats, uptime: Date.now() - this.stats.uptime };
  }

  public getRecentMessages(): ChatMessage[] {
    return [...this.recentMessages];
  }

  public getCommands(): BotCommand[] {
    return Array.from(this.commands.values());
  }

  public incrementStat(stat: keyof Omit<BotStats, 'uptime'>): void {
    if (stat in this.stats) {
      (this.stats as any)[stat]++;
    }
  }

  public updatePeakViewers(count: number): void {
    if (count > this.stats.peakViewers) {
      this.stats.peakViewers = count;
    }
  }
}
