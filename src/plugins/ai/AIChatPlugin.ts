/**
 * AI Chat Plugin
 *
 * Features:
 * - GPT/Claude powered responses
 * - Customizable personality
 * - Context awareness
 * - Rate limiting
 */

import { Plugin } from '../base/Plugin';
import { PluginMeta, Permission } from '../../types/plugins';
import { ChatMessageEvent } from '../../types/events';
import { getDatabase, DatabaseService } from '../../services/Database';

interface AISettings {
  enabled: boolean;
  provider: 'openai' | 'anthropic';
  apiKey: string;
  model: string;
  personality: string;
  maxTokens: number;
  temperature: number;
  triggerWord: string;
  cooldownSeconds: number;
  maxMessagesPerMinute: number;
}

const DEFAULT_SETTINGS: AISettings = {
  enabled: false,
  provider: 'openai',
  apiKey: '',
  model: 'gpt-3.5-turbo',
  personality: 'Du bist ein freundlicher und witziger Chatbot für einen Twitch-Stream. Halte deine Antworten kurz und unterhaltsam.',
  maxTokens: 150,
  temperature: 0.8,
  triggerWord: '!ai',
  cooldownSeconds: 10,
  maxMessagesPerMinute: 10,
};

interface ConversationMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export class AIChatPlugin extends Plugin {
  meta: PluginMeta = {
    name: 'aichat',
    version: '1.0.0',
    description: 'AI-powered chat responses',
    author: 'StreamCore',
  };

  private db!: DatabaseService;
  private settings: AISettings = DEFAULT_SETTINGS;
  private cooldowns: Map<string, number> = new Map();
  private messageCount = 0;
  private messageCountReset = Date.now();
  private conversationHistory: ConversationMessage[] = [];

  protected async init(): Promise<void> {
    this.db = getDatabase();
    this.log.info('Initializing AI Chat...');

    this.loadSettings();
    this.registerCommands();

    // Reset message count every minute
    setInterval(() => {
      this.messageCount = 0;
      this.messageCountReset = Date.now();
    }, 60000);

    if (!this.settings.apiKey) {
      this.log.warn('AI Chat not configured. Use !setaikey to set up.');
    }

    this.log.info('AI Chat initialized!');
  }

  protected async destroy(): Promise<void> {}

  private loadSettings(): void {
    const saved = this.db.getSetting<AISettings>('ai_settings');
    if (saved) {
      this.settings = { ...DEFAULT_SETTINGS, ...saved };
    }
  }

  private saveSettings(): void {
    // Don't save API key in logs
    const toSave = { ...this.settings };
    this.db.setSetting('ai_settings', toSave);
  }

  private async generateResponse(prompt: string, username: string): Promise<string | null> {
    if (!this.settings.apiKey) {
      return 'AI nicht konfiguriert';
    }

    // Rate limiting
    if (this.messageCount >= this.settings.maxMessagesPerMinute) {
      return 'Rate-Limit erreicht, bitte warte einen Moment';
    }

    this.messageCount++;

    // Add to conversation history
    this.conversationHistory.push({
      role: 'user',
      content: `${username}: ${prompt}`,
    });

    // Keep only last 10 messages for context
    if (this.conversationHistory.length > 10) {
      this.conversationHistory = this.conversationHistory.slice(-10);
    }

    try {
      if (this.settings.provider === 'openai') {
        return await this.callOpenAI(prompt);
      } else {
        return await this.callAnthropic(prompt);
      }
    } catch (error) {
      this.log.error(`AI Error: ${error}`);
      return 'Fehler bei der AI-Antwort';
    }
  }

  private async callOpenAI(prompt: string): Promise<string | null> {
    const messages = [
      { role: 'system', content: this.settings.personality },
      ...this.conversationHistory,
    ];

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.settings.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.settings.model,
        messages,
        max_tokens: this.settings.maxTokens,
        temperature: this.settings.temperature,
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenAI API error: ${response.status}`);
    }

    const data = await response.json() as any;
    const reply = data.choices?.[0]?.message?.content;

    if (reply) {
      this.conversationHistory.push({
        role: 'assistant',
        content: reply,
      });
    }

    return reply || null;
  }

  private async callAnthropic(prompt: string): Promise<string | null> {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': this.settings.apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.settings.model || 'claude-3-haiku-20240307',
        max_tokens: this.settings.maxTokens,
        system: this.settings.personality,
        messages: this.conversationHistory.map((m) => ({
          role: m.role === 'system' ? 'user' : m.role,
          content: m.content,
        })),
      }),
    });

    if (!response.ok) {
      throw new Error(`Anthropic API error: ${response.status}`);
    }

    const data = await response.json() as any;
    const reply = data.content?.[0]?.text;

    if (reply) {
      this.conversationHistory.push({
        role: 'assistant',
        content: reply,
      });
    }

    return reply || null;
  }

  private registerCommands(): void {
    // !ai - Ask the AI
    this.registerCommand({
      name: 'ai',
      aliases: ['ask', 'chat', 'gpt'],
      description: 'Ask the AI a question',
      usage: '!ai <question>',
      cooldown: { user: this.settings.cooldownSeconds, global: 2 },
      handler: async (ctx) => {
        if (!this.settings.enabled) {
          ctx.reply('🤖 AI Chat ist deaktiviert');
          return;
        }

        if (ctx.args.length === 0) {
          ctx.reply('Verwendung: !ai <frage>');
          return;
        }

        const prompt = ctx.args.join(' ');

        // User cooldown
        const lastUse = this.cooldowns.get(ctx.user.username) || 0;
        if (Date.now() - lastUse < this.settings.cooldownSeconds * 1000) {
          return;
        }
        this.cooldowns.set(ctx.user.username, Date.now());

        const response = await this.generateResponse(prompt, ctx.user.displayName);

        if (response) {
          // Truncate if too long for chat
          const truncated = response.length > 450 ? response.slice(0, 447) + '...' : response;
          ctx.reply(`🤖 ${truncated}`);
        }
      },
    });

    // !setaikey - Set API key (broadcaster)
    this.registerCommand({
      name: 'setaikey',
      description: 'Set AI API key',
      usage: '!setaikey <provider> <key>',
      permission: Permission.BROADCASTER,
      cooldown: { user: 0, global: 0 },
      handler: async (ctx) => {
        if (ctx.args.length < 2) {
          ctx.reply('Verwendung: !setaikey <openai|anthropic> <api-key>');
          return;
        }

        const [provider, key] = ctx.args;

        if (!['openai', 'anthropic'].includes(provider.toLowerCase())) {
          ctx.reply('❌ Provider muss "openai" oder "anthropic" sein');
          return;
        }

        this.settings.provider = provider.toLowerCase() as 'openai' | 'anthropic';
        this.settings.apiKey = key;
        this.settings.enabled = true;

        // Set default model based on provider
        if (provider === 'anthropic') {
          this.settings.model = 'claude-3-haiku-20240307';
        } else {
          this.settings.model = 'gpt-3.5-turbo';
        }

        this.saveSettings();
        ctx.reply(`✅ AI (${provider}) konfiguriert und aktiviert!`);
      },
    });

    // !aitoggle - Toggle AI
    this.registerCommand({
      name: 'aitoggle',
      description: 'Toggle AI chat',
      permission: Permission.MODERATOR,
      cooldown: { user: 5, global: 0 },
      handler: async (ctx) => {
        this.settings.enabled = !this.settings.enabled;
        this.saveSettings();
        ctx.reply(`🤖 AI Chat: ${this.settings.enabled ? 'An' : 'Aus'}`);
      },
    });

    // !aipersonality - Set AI personality
    this.registerCommand({
      name: 'aipersonality',
      aliases: ['setpersonality'],
      description: 'Set AI personality',
      usage: '!aipersonality <description>',
      permission: Permission.MODERATOR,
      cooldown: { user: 5, global: 0 },
      handler: async (ctx) => {
        if (ctx.args.length === 0) {
          ctx.reply(`🤖 Aktuelle Persönlichkeit: ${this.settings.personality.slice(0, 100)}...`);
          return;
        }

        this.settings.personality = ctx.args.join(' ');
        this.conversationHistory = []; // Reset history
        this.saveSettings();
        ctx.reply('✅ AI Persönlichkeit aktualisiert');
      },
    });

    // !aimodel - Set AI model
    this.registerCommand({
      name: 'aimodel',
      description: 'Set AI model',
      usage: '!aimodel <model>',
      permission: Permission.BROADCASTER,
      cooldown: { user: 5, global: 0 },
      handler: async (ctx) => {
        if (ctx.args.length === 0) {
          ctx.reply(`🤖 Aktuelles Modell: ${this.settings.model}`);
          return;
        }

        this.settings.model = ctx.args[0];
        this.saveSettings();
        ctx.reply(`✅ AI Modell: ${this.settings.model}`);
      },
    });

    // !aireset - Reset conversation
    this.registerCommand({
      name: 'aireset',
      description: 'Reset AI conversation history',
      permission: Permission.MODERATOR,
      cooldown: { user: 5, global: 0 },
      handler: async (ctx) => {
        this.conversationHistory = [];
        ctx.reply('🤖 Konversation zurückgesetzt');
      },
    });
  }

  // Public API
  isEnabled(): boolean {
    return this.settings.enabled && !!this.settings.apiKey;
  }

  async ask(prompt: string, username: string = 'User'): Promise<string | null> {
    return this.generateResponse(prompt, username);
  }
}
