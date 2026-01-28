import axios from 'axios';
import { EventEmitter } from 'events';
import { Viewer } from '../types';
import { config } from '../config';
import { Database } from '../utils/Database';

export class ViewerManager extends EventEmitter {
  private viewers: Map<string, Viewer> = new Map();
  private onlineViewers: Set<string> = new Set();
  private db: Database;
  private accessToken: string | null = null;
  private tokenExpiry: number = 0;
  private updateInterval: NodeJS.Timeout | null = null;

  constructor(db: Database) {
    super();
    this.db = db;
    this.loadViewers();
  }

  private async loadViewers(): Promise<void> {
    const savedViewers = await this.db.get<Record<string, Viewer>>('viewers') || {};
    for (const [username, viewer] of Object.entries(savedViewers)) {
      this.viewers.set(username, {
        ...viewer,
        lastSeen: new Date(viewer.lastSeen),
      });
    }
    console.log(`📊 Loaded ${this.viewers.size} viewers from database`);
  }

  private async saveViewers(): Promise<void> {
    const viewersObj: Record<string, Viewer> = {};
    for (const [username, viewer] of this.viewers) {
      viewersObj[username] = viewer;
    }
    await this.db.set('viewers', viewersObj);
  }

  private async getAccessToken(): Promise<string | null> {
    if (this.accessToken && Date.now() < this.tokenExpiry) {
      return this.accessToken;
    }

    if (!config.twitch.clientId || !config.twitch.clientSecret) {
      console.warn('⚠️ Twitch API credentials not configured');
      return null;
    }

    try {
      const response = await axios.post(
        'https://id.twitch.tv/oauth2/token',
        new URLSearchParams({
          client_id: config.twitch.clientId,
          client_secret: config.twitch.clientSecret,
          grant_type: 'client_credentials',
        }),
        {
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        }
      );

      this.accessToken = response.data.access_token;
      this.tokenExpiry = Date.now() + (response.data.expires_in - 60) * 1000;
      return this.accessToken;
    } catch (error) {
      console.error('Failed to get Twitch access token:', error);
      return null;
    }
  }

  public async fetchOnlineViewers(): Promise<string[]> {
    const token = await this.getAccessToken();
    if (!token) return [];

    try {
      // First get the broadcaster ID
      const userResponse = await axios.get(
        `https://api.twitch.tv/helix/users?login=${config.twitch.channel}`,
        {
          headers: {
            'Client-ID': config.twitch.clientId,
            Authorization: `Bearer ${token}`,
          },
        }
      );

      if (!userResponse.data.data?.[0]) {
        return [];
      }

      const broadcasterId = userResponse.data.data[0].id;

      // Get chatters list
      const chattersResponse = await axios.get(
        `https://api.twitch.tv/helix/chat/chatters?broadcaster_id=${broadcasterId}&moderator_id=${broadcasterId}`,
        {
          headers: {
            'Client-ID': config.twitch.clientId,
            Authorization: `Bearer ${token}`,
          },
        }
      );

      const chatters = chattersResponse.data.data || [];
      const usernames = chatters.map((c: { user_login: string }) => c.user_login);

      this.onlineViewers = new Set(usernames);
      this.emit('viewersUpdated', usernames);

      return usernames;
    } catch (error) {
      console.error('Failed to fetch viewers:', error);
      return [];
    }
  }

  public startAutoUpdate(intervalMs: number = 60000): void {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
    }

    this.updateInterval = setInterval(async () => {
      await this.fetchOnlineViewers();
      await this.updateWatchTime();
    }, intervalMs);

    // Initial fetch
    this.fetchOnlineViewers();
  }

  public stopAutoUpdate(): void {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }
  }

  private async updateWatchTime(): Promise<void> {
    for (const username of this.onlineViewers) {
      const viewer = this.viewers.get(username);
      if (viewer) {
        viewer.watchTime += 1; // Add 1 minute
        viewer.lastSeen = new Date();
      }
    }
    await this.saveViewers();
  }

  public getOrCreateViewer(username: string, displayName?: string): Viewer {
    let viewer = this.viewers.get(username.toLowerCase());

    if (!viewer) {
      viewer = {
        username: username.toLowerCase(),
        displayName: displayName || username,
        points: 0,
        watchTime: 0,
        lastSeen: new Date(),
        isSubscriber: false,
        isModerator: false,
        isVip: false,
        messageCount: 0,
      };
      this.viewers.set(username.toLowerCase(), viewer);
    }

    return viewer;
  }

  public updateViewer(username: string, updates: Partial<Viewer>): void {
    const viewer = this.getOrCreateViewer(username);
    Object.assign(viewer, updates, { lastSeen: new Date() });
    this.saveViewers();
  }

  public incrementMessageCount(username: string): void {
    const viewer = this.getOrCreateViewer(username);
    viewer.messageCount++;
    viewer.lastSeen = new Date();
  }

  public addPoints(username: string, amount: number): void {
    const viewer = this.getOrCreateViewer(username);
    viewer.points += amount;
    this.emit('pointsChanged', { username, points: viewer.points, change: amount });
  }

  public removePoints(username: string, amount: number): boolean {
    const viewer = this.getOrCreateViewer(username);
    if (viewer.points < amount) {
      return false;
    }
    viewer.points -= amount;
    this.emit('pointsChanged', { username, points: viewer.points, change: -amount });
    return true;
  }

  public getViewer(username: string): Viewer | undefined {
    return this.viewers.get(username.toLowerCase());
  }

  public getAllViewers(): Viewer[] {
    return Array.from(this.viewers.values());
  }

  public getOnlineViewers(): string[] {
    return Array.from(this.onlineViewers);
  }

  public getOnlineViewerCount(): number {
    return this.onlineViewers.size;
  }

  public getTopViewersByPoints(limit: number = 10): Viewer[] {
    return this.getAllViewers()
      .sort((a, b) => b.points - a.points)
      .slice(0, limit);
  }

  public getTopViewersByWatchTime(limit: number = 10): Viewer[] {
    return this.getAllViewers()
      .sort((a, b) => b.watchTime - a.watchTime)
      .slice(0, limit);
  }

  public userJoined(username: string): void {
    this.onlineViewers.add(username.toLowerCase());
    this.getOrCreateViewer(username);
    this.emit('userJoined', username);
  }

  public userLeft(username: string): void {
    this.onlineViewers.delete(username.toLowerCase());
    const viewer = this.viewers.get(username.toLowerCase());
    if (viewer) {
      viewer.lastSeen = new Date();
    }
    this.emit('userLeft', username);
  }
}
