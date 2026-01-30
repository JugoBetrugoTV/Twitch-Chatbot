import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import play from 'play-dl';
import { SongRequest } from '../types';
import { config } from '../config';
import { Database } from '../utils/Database';

export class SongRequestManager extends EventEmitter {
  private queue: SongRequest[] = [];
  private currentSong: SongRequest | null = null;
  private history: SongRequest[] = [];
  private isPlaying: boolean = false;
  private db: Database;
  private blacklist: Set<string> = new Set();
  private userRequestCount: Map<string, number> = new Map();

  constructor(db: Database) {
    super();
    this.db = db;
    this.loadData();
  }

  private async loadData(): Promise<void> {
    const savedQueue = await this.db.get<SongRequest[]>('songQueue') || [];
    this.queue = savedQueue.map((s) => ({
      ...s,
      requestedAt: new Date(s.requestedAt),
    }));

    const savedBlacklist = await this.db.get<string[]>('songBlacklist') || [];
    this.blacklist = new Set(savedBlacklist);

    console.log(`🎵 Loaded ${this.queue.length} songs in queue`);
  }

  private async saveQueue(): Promise<void> {
    await this.db.set('songQueue', this.queue);
  }

  private async saveBlacklist(): Promise<void> {
    await this.db.set('songBlacklist', Array.from(this.blacklist));
  }

  public async searchYouTube(query: string): Promise<{
    title: string;
    url: string;
    duration: number;
  } | null> {
    try {
      const searchResults = await play.search(query, { limit: 5, source: { youtube: 'video' } });
      const video = searchResults.find(v => v.type === 'video' && v.durationInSec && v.durationInSec > 0);

      if (!video) {
        return null;
      }

      return {
        title: video.title || 'Unknown Title',
        url: video.url,
        duration: video.durationInSec || 0,
      };
    } catch (error) {
      console.error('YouTube search failed:', error);
      return null;
    }
  }

  public async getVideoInfo(url: string): Promise<{
    title: string;
    url: string;
    duration: number;
  } | null> {
    try {
      const info = await play.video_basic_info(url);
      return {
        title: info.video_details.title || 'Unknown Title',
        url: info.video_details.url,
        duration: info.video_details.durationInSec || 0,
      };
    } catch (error) {
      console.error('Failed to get video info:', error);
      return null;
    }
  }

  public async addRequest(
    query: string,
    requestedBy: string
  ): Promise<{ success: boolean; message: string; song?: SongRequest }> {
    if (!config.songRequest.enabled) {
      return { success: false, message: 'Song requests are currently disabled.' };
    }

    if (this.queue.length >= config.songRequest.maxQueue) {
      return { success: false, message: 'The song queue is full. Please try again later.' };
    }

    // Check if it's a YouTube URL or a search query
    let videoInfo: { title: string; url: string; duration: number } | null = null;

    if (query.includes('youtube.com') || query.includes('youtu.be')) {
      videoInfo = await this.getVideoInfo(query);
    } else {
      videoInfo = await this.searchYouTube(query);
    }

    if (!videoInfo) {
      return { success: false, message: 'Could not find that song. Please try a different search.' };
    }

    // Check duration
    if (videoInfo.duration > config.songRequest.maxDuration) {
      const maxMin = Math.floor(config.songRequest.maxDuration / 60);
      return {
        success: false,
        message: `Song is too long. Maximum duration is ${maxMin} minutes.`,
      };
    }

    // Check blacklist
    if (this.blacklist.has(videoInfo.url)) {
      return { success: false, message: 'This song is blacklisted.' };
    }

    // Check if already in queue
    if (this.queue.some((s) => s.url === videoInfo!.url)) {
      return { success: false, message: 'This song is already in the queue.' };
    }

    const song: SongRequest = {
      id: uuidv4(),
      title: videoInfo.title,
      url: videoInfo.url,
      duration: videoInfo.duration,
      requestedBy,
      requestedAt: new Date(),
      platform: 'youtube',
    };

    this.queue.push(song);
    await this.saveQueue();

    this.emit('songAdded', song);

    return {
      success: true,
      message: `Added "${song.title}" to the queue at position #${this.queue.length}`,
      song,
    };
  }

  public async skip(): Promise<SongRequest | null> {
    const skipped = this.currentSong;
    this.currentSong = null;
    this.isPlaying = false;

    this.emit('songSkipped', skipped);

    // Auto-play next song
    await this.playNext();

    return skipped;
  }

  public async playNext(): Promise<SongRequest | null> {
    if (this.queue.length === 0) {
      this.currentSong = null;
      this.isPlaying = false;
      this.emit('queueEmpty');
      return null;
    }

    const nextSong = this.queue.shift()!;
    this.currentSong = nextSong;
    this.isPlaying = true;

    await this.saveQueue();

    this.history.push(nextSong);
    if (this.history.length > 50) {
      this.history.shift();
    }

    this.emit('songStarted', nextSong);

    return nextSong;
  }

  public pause(): void {
    this.isPlaying = false;
    this.emit('paused');
  }

  public resume(): void {
    if (this.currentSong) {
      this.isPlaying = true;
      this.emit('resumed');
    }
  }

  public removeFromQueue(index: number): SongRequest | null {
    if (index < 0 || index >= this.queue.length) {
      return null;
    }

    const [removed] = this.queue.splice(index, 1);
    this.saveQueue();
    this.emit('songRemoved', removed);

    return removed;
  }

  public removeSongByUser(username: string): SongRequest | null {
    const index = this.queue.findIndex(
      (s) => s.requestedBy.toLowerCase() === username.toLowerCase()
    );

    if (index === -1) {
      return null;
    }

    return this.removeFromQueue(index);
  }

  public clearQueue(): void {
    this.queue = [];
    this.saveQueue();
    this.emit('queueCleared');
  }

  public addToBlacklist(url: string): void {
    this.blacklist.add(url);
    this.saveBlacklist();
  }

  public removeFromBlacklist(url: string): void {
    this.blacklist.delete(url);
    this.saveBlacklist();
  }

  public getQueue(): SongRequest[] {
    return [...this.queue];
  }

  public getCurrentSong(): SongRequest | null {
    return this.currentSong;
  }

  public getQueueLength(): number {
    return this.queue.length;
  }

  public getHistory(): SongRequest[] {
    return [...this.history];
  }

  public isCurrentlyPlaying(): boolean {
    return this.isPlaying;
  }

  public getQueuePosition(songId: string): number {
    return this.queue.findIndex((s) => s.id === songId) + 1;
  }

  public getUserRequestsInQueue(username: string): SongRequest[] {
    return this.queue.filter(
      (s) => s.requestedBy.toLowerCase() === username.toLowerCase()
    );
  }

  public moveInQueue(fromIndex: number, toIndex: number): boolean {
    if (
      fromIndex < 0 ||
      fromIndex >= this.queue.length ||
      toIndex < 0 ||
      toIndex >= this.queue.length
    ) {
      return false;
    }

    const [song] = this.queue.splice(fromIndex, 1);
    this.queue.splice(toIndex, 0, song);
    this.saveQueue();
    this.emit('queueReordered');

    return true;
  }

  public promoteToTop(index: number): boolean {
    return this.moveInQueue(index, 0);
  }
}
