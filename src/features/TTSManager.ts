import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import googleTTS from 'google-tts-api';
import fs from 'fs/promises';
import path from 'path';
import { TTSMessage } from '../types';
import { config } from '../config';

export class TTSManager extends EventEmitter {
  private queue: TTSMessage[] = [];
  private isPlaying: boolean = false;
  private isPaused: boolean = false;
  private currentMessage: TTSMessage | null = null;
  private audioDir: string;
  private blockedWords: Set<string> = new Set();
  private blockedUsers: Set<string> = new Set();
  private minBits: number = 0;
  private subOnly: boolean = false;

  constructor() {
    super();
    this.audioDir = path.join(process.cwd(), 'audio_cache');
    this.init();
  }

  private async init(): Promise<void> {
    try {
      await fs.mkdir(this.audioDir, { recursive: true });
      console.log('🔊 TTS Manager initialized');
    } catch (error) {
      console.error('Failed to create audio cache directory:', error);
    }
  }

  public async addMessage(
    username: string,
    text: string,
    priority: number = 0
  ): Promise<{ success: boolean; message: string; ttsMessage?: TTSMessage }> {
    if (!config.tts.enabled) {
      return { success: false, message: 'TTS is currently disabled.' };
    }

    // Check blocked users
    if (this.blockedUsers.has(username.toLowerCase())) {
      return { success: false, message: 'User is blocked from TTS.' };
    }

    // Filter text
    let filteredText = this.filterText(text);

    if (filteredText.length === 0) {
      return { success: false, message: 'Message was filtered.' };
    }

    // Limit text length
    if (filteredText.length > 500) {
      filteredText = filteredText.substring(0, 500);
    }

    const ttsMessage: TTSMessage = {
      id: uuidv4(),
      username,
      text: filteredText,
      timestamp: new Date(),
      priority,
    };

    // Insert based on priority
    const insertIndex = this.queue.findIndex((m) => m.priority < priority);
    if (insertIndex === -1) {
      this.queue.push(ttsMessage);
    } else {
      this.queue.splice(insertIndex, 0, ttsMessage);
    }

    this.emit('messageQueued', ttsMessage);

    // Start playing if not already
    if (!this.isPlaying && !this.isPaused) {
      this.processQueue();
    }

    return {
      success: true,
      message: 'Message added to TTS queue.',
      ttsMessage,
    };
  }

  private filterText(text: string): string {
    let filtered = text;

    // Remove URLs
    filtered = filtered.replace(/https?:\/\/\S+/gi, '');

    // Remove blocked words
    for (const word of this.blockedWords) {
      const regex = new RegExp(word, 'gi');
      filtered = filtered.replace(regex, '');
    }

    // Remove excessive characters
    filtered = filtered.replace(/(.)\1{4,}/g, '$1$1$1');

    // Trim whitespace
    filtered = filtered.trim();

    return filtered;
  }

  public async generateAudio(text: string): Promise<string | null> {
    try {
      // For longer texts, we need to split into chunks
      const audioUrls = await googleTTS.getAllAudioUrls(text, {
        lang: config.tts.language,
        slow: config.tts.speed < 0.8,
        host: 'https://translate.google.com',
      });

      // Return the first audio URL (for simple implementation)
      // In production, you'd want to concatenate all audio chunks
      return audioUrls[0]?.url || null;
    } catch (error) {
      console.error('TTS generation failed:', error);
      return null;
    }
  }

  public async getAudioBase64(text: string): Promise<string | null> {
    try {
      const base64 = await googleTTS.getAudioBase64(text, {
        lang: config.tts.language,
        slow: config.tts.speed < 0.8,
        host: 'https://translate.google.com',
      });

      return base64;
    } catch (error) {
      console.error('TTS generation failed:', error);
      return null;
    }
  }

  private async processQueue(): Promise<void> {
    if (this.queue.length === 0 || this.isPaused) {
      this.isPlaying = false;
      return;
    }

    this.isPlaying = true;
    this.currentMessage = this.queue.shift()!;

    try {
      const audioUrl = await this.generateAudio(this.currentMessage.text);

      if (audioUrl) {
        // Emit event with audio URL - the web dashboard will handle playback
        this.emit('playMessage', {
          message: this.currentMessage,
          audioUrl,
        });

        // Wait for playback to complete (estimated based on text length)
        const estimatedDuration = Math.max(2000, this.currentMessage.text.length * 80);
        await new Promise((resolve) => setTimeout(resolve, estimatedDuration));
      }

      this.emit('messageComplete', this.currentMessage);
    } catch (error) {
      console.error('Error playing TTS message:', error);
      this.emit('messageError', { message: this.currentMessage, error });
    }

    this.currentMessage = null;

    // Process next message
    if (!this.isPaused) {
      this.processQueue();
    }
  }

  public notifyPlaybackComplete(): void {
    // Called by the web client when audio playback is done
    // This allows for more accurate timing
  }

  public skip(): TTSMessage | null {
    const skipped = this.currentMessage;
    this.emit('messageSkipped', skipped);
    // The timeout in processQueue will naturally move to next
    return skipped;
  }

  public pause(): void {
    this.isPaused = true;
    this.emit('paused');
  }

  public resume(): void {
    this.isPaused = false;
    this.emit('resumed');
    if (!this.isPlaying && this.queue.length > 0) {
      this.processQueue();
    }
  }

  public clearQueue(): void {
    this.queue = [];
    this.emit('queueCleared');
  }

  public getQueue(): TTSMessage[] {
    return [...this.queue];
  }

  public getCurrentMessage(): TTSMessage | null {
    return this.currentMessage;
  }

  public getQueueLength(): number {
    return this.queue.length;
  }

  public isEnabled(): boolean {
    return config.tts.enabled;
  }

  public setEnabled(enabled: boolean): void {
    (config.tts as any).enabled = enabled;
    this.emit('enabledChanged', enabled);
  }

  public blockWord(word: string): void {
    this.blockedWords.add(word.toLowerCase());
  }

  public unblockWord(word: string): void {
    this.blockedWords.delete(word.toLowerCase());
  }

  public blockUser(username: string): void {
    this.blockedUsers.add(username.toLowerCase());
  }

  public unblockUser(username: string): void {
    this.blockedUsers.delete(username.toLowerCase());
  }

  public getBlockedWords(): string[] {
    return Array.from(this.blockedWords);
  }

  public getBlockedUsers(): string[] {
    return Array.from(this.blockedUsers);
  }

  public setMinBits(bits: number): void {
    this.minBits = bits;
  }

  public setSubOnly(subOnly: boolean): void {
    this.subOnly = subOnly;
  }
}
