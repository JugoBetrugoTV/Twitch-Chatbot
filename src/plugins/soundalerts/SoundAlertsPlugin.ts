/**
 * Sound Alerts Plugin
 *
 * Play sounds on stream events
 * Features:
 * - Event-based sound triggers
 * - Custom sound commands
 * - Volume control
 * - Sound queue
 */

import { Plugin } from '../base/Plugin';
import { PluginMeta, Permission } from '../../types/plugins';
import { getDatabase, DatabaseService } from '../../services/Database';

interface Sound {
  id: string;
  name: string;
  file: string;
  volume: number;
  cooldown: number;
  cost: number;
  enabled: boolean;
}

interface SoundTrigger {
  event: string;
  soundId: string;
  enabled: boolean;
  minValue?: number;
}

interface QueuedSound {
  sound: Sound;
  username?: string;
  timestamp: number;
}

interface SoundAlertsSettings {
  enabled: boolean;
  globalVolume: number;
  maxQueueSize: number;
  defaultCooldown: number;
  soundsPath: string;
}

const DEFAULT_SETTINGS: SoundAlertsSettings = {
  enabled: true,
  globalVolume: 50,
  maxQueueSize: 10,
  defaultCooldown: 30,
  soundsPath: './sounds',
};

export class SoundAlertsPlugin extends Plugin {
  meta: PluginMeta = {
    name: 'soundalerts',
    version: '1.0.0',
    description: 'Play sounds on stream events',
    author: 'StreamCore',
  };

  private db!: DatabaseService;
  private settings: SoundAlertsSettings = DEFAULT_SETTINGS;
  private sounds: Map<string, Sound> = new Map();
  private triggers: SoundTrigger[] = [];
  private queue: QueuedSound[] = [];
  private cooldowns: Map<string, number> = new Map();
  private isPlaying = false;

  protected async init(): Promise<void> {
    this.db = getDatabase();
    this.log.info('Initializing Sound Alerts...');

    this.initTables();
    this.loadSettings();
    this.loadSounds();
    this.loadTriggers();
    this.setupEventHandlers();
    this.registerCommands();

    this.log.info('Sound Alerts initialized!');
  }

  protected async destroy(): Promise<void> {
    this.queue = [];
  }

  private initTables(): void {
    const db = this.db.raw();
    db.exec(`
      CREATE TABLE IF NOT EXISTS sounds (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        file TEXT NOT NULL,
        volume INTEGER DEFAULT 100,
        cooldown INTEGER DEFAULT 30,
        cost INTEGER DEFAULT 0,
        enabled INTEGER DEFAULT 1
      );

      CREATE TABLE IF NOT EXISTS sound_triggers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event TEXT NOT NULL,
        sound_id TEXT NOT NULL,
        enabled INTEGER DEFAULT 1,
        min_value INTEGER,
        FOREIGN KEY (sound_id) REFERENCES sounds(id)
      );
    `);
  }

  private loadSettings(): void {
    const saved = this.db.getSetting<SoundAlertsSettings>('soundalerts_settings');
    if (saved) {
      this.settings = { ...DEFAULT_SETTINGS, ...saved };
    }
  }

  private saveSettings(): void {
    this.db.setSetting('soundalerts_settings', this.settings);
  }

  private loadSounds(): void {
    const db = this.db.raw();
    const rows = db.prepare('SELECT * FROM sounds WHERE enabled = 1').all() as any[];

    for (const row of rows) {
      this.sounds.set(row.id, {
        id: row.id,
        name: row.name,
        file: row.file,
        volume: row.volume,
        cooldown: row.cooldown,
        cost: row.cost,
        enabled: row.enabled === 1,
      });
    }
  }

  private loadTriggers(): void {
    const db = this.db.raw();
    const rows = db.prepare('SELECT * FROM sound_triggers WHERE enabled = 1').all() as any[];

    this.triggers = rows.map((row) => ({
      event: row.event,
      soundId: row.sound_id,
      enabled: row.enabled === 1,
      minValue: row.min_value,
    }));
  }

  private saveSound(sound: Sound): void {
    const db = this.db.raw();
    db.prepare(`
      INSERT OR REPLACE INTO sounds (id, name, file, volume, cooldown, cost, enabled)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(sound.id, sound.name, sound.file, sound.volume, sound.cooldown, sound.cost, sound.enabled ? 1 : 0);

    this.sounds.set(sound.id, sound);
  }

  private deleteSound(id: string): void {
    const db = this.db.raw();
    db.prepare('DELETE FROM sounds WHERE id = ?').run(id);
    db.prepare('DELETE FROM sound_triggers WHERE sound_id = ?').run(id);
    this.sounds.delete(id);
    this.triggers = this.triggers.filter((t) => t.soundId !== id);
  }

  private saveTrigger(trigger: SoundTrigger): void {
    const db = this.db.raw();
    db.prepare(`
      INSERT INTO sound_triggers (event, sound_id, enabled, min_value)
      VALUES (?, ?, ?, ?)
    `).run(trigger.event, trigger.soundId, trigger.enabled ? 1 : 0, trigger.minValue || null);

    this.triggers.push(trigger);
  }

  private canPlaySound(soundId: string): boolean {
    const lastPlayed = this.cooldowns.get(soundId) || 0;
    const sound = this.sounds.get(soundId);
    if (!sound) return false;

    return Date.now() - lastPlayed >= sound.cooldown * 1000;
  }

  private queueSound(sound: Sound, username?: string): boolean {
    if (!this.settings.enabled) return false;
    if (this.queue.length >= this.settings.maxQueueSize) return false;
    if (!this.canPlaySound(sound.id)) return false;

    this.queue.push({
      sound,
      username,
      timestamp: Date.now(),
    });

    this.cooldowns.set(sound.id, Date.now());

    if (!this.isPlaying) {
      this.processQueue();
    }

    return true;
  }

  private async processQueue(): Promise<void> {
    if (this.queue.length === 0) {
      this.isPlaying = false;
      return;
    }

    this.isPlaying = true;
    const item = this.queue.shift()!;

    // Emit event for overlay/audio system to play the sound
    this.ctx.events.emit('sound:play', {
      file: item.sound.file,
      volume: (item.sound.volume * this.settings.globalVolume) / 100,
      name: item.sound.name,
      username: item.username,
    });

    this.log.debug(`Playing sound: ${item.sound.name}`);

    // Wait a bit before processing next (estimated sound duration)
    setTimeout(() => this.processQueue(), 3000);
  }

  private setupEventHandlers(): void {
    // Listen for events and trigger sounds
    const events = [
      'twitch:follow',
      'twitch:sub',
      'twitch:subgift',
      'twitch:cheer',
      'twitch:raid',
      'stream:start',
      'stream:end',
    ];

    for (const eventName of events) {
      this.ctx.events.on(eventName, (event: any) => {
        for (const trigger of this.triggers) {
          if (trigger.event !== eventName || !trigger.enabled) continue;

          // Check min value for bits/viewers
          if (trigger.minValue) {
            const value = event.bits || event.viewers || event.amount || 0;
            if (value < trigger.minValue) continue;
          }

          const sound = this.sounds.get(trigger.soundId);
          if (sound) {
            this.queueSound(sound, event.username);
          }
        }
      });
    }
  }

  private registerCommands(): void {
    // !sound - Play a sound
    this.registerCommand({
      name: 'sound',
      aliases: ['playsound', 'sfx'],
      description: 'Play a sound effect',
      usage: '!sound <name>',
      cooldown: { user: 10, global: 3 },
      handler: async (ctx) => {
        const soundName = ctx.args[0]?.toLowerCase();
        if (!soundName) {
          const available = Array.from(this.sounds.values())
            .filter((s) => s.cost === 0)
            .slice(0, 5)
            .map((s) => s.name)
            .join(', ');
          ctx.reply(`🔊 Sounds: ${available || 'Keine'}`);
          return;
        }

        const sound = Array.from(this.sounds.values()).find(
          (s) => s.id === soundName || s.name.toLowerCase() === soundName
        );

        if (!sound) {
          ctx.reply('❌ Sound nicht gefunden');
          return;
        }

        if (!sound.enabled) {
          ctx.reply('❌ Sound ist deaktiviert');
          return;
        }

        if (!this.canPlaySound(sound.id)) {
          ctx.reply('⏳ Sound ist noch im Cooldown');
          return;
        }

        // Check cost
        if (sound.cost > 0) {
          // Emit event to deduct points
          this.ctx.events.emit('points:remove', {
            username: ctx.user.username,
            amount: sound.cost,
            reason: `Sound: ${sound.name}`,
            callback: (success: boolean) => {
              if (success) {
                this.queueSound(sound, ctx.user.username);
                ctx.reply(`🔊 ${sound.name} wird abgespielt!`);
              } else {
                ctx.reply(`❌ Nicht genug Punkte (${sound.cost} benötigt)`);
              }
            },
          });
        } else {
          this.queueSound(sound, ctx.user.username);
          ctx.reply(`🔊 ${sound.name} wird abgespielt!`);
        }
      },
    });

    // !sounds - List all sounds
    this.registerCommand({
      name: 'sounds',
      aliases: ['soundlist'],
      description: 'List all available sounds',
      cooldown: { user: 15, global: 5 },
      handler: async (ctx) => {
        const sounds = Array.from(this.sounds.values()).filter((s) => s.enabled);

        if (sounds.length === 0) {
          ctx.reply('🔊 Keine Sounds verfügbar');
          return;
        }

        const list = sounds.slice(0, 10).map((s) => {
          const cost = s.cost > 0 ? ` (${s.cost}P)` : '';
          return `${s.name}${cost}`;
        }).join(', ');

        ctx.reply(`🔊 Sounds (${sounds.length}): ${list}`);
      },
    });

    // !addsound - Add a sound
    this.registerCommand({
      name: 'addsound',
      description: 'Add a new sound',
      usage: '!addsound <id> <name> <file> [cost]',
      permission: Permission.BROADCASTER,
      cooldown: { user: 0, global: 0 },
      handler: async (ctx) => {
        const [id, name, file, costStr] = ctx.args;

        if (!id || !name || !file) {
          ctx.reply('❌ Usage: !addsound <id> <name> <file> [cost]');
          return;
        }

        const sound: Sound = {
          id,
          name,
          file: file.startsWith('/') ? file : `${this.settings.soundsPath}/${file}`,
          volume: 100,
          cooldown: this.settings.defaultCooldown,
          cost: parseInt(costStr) || 0,
          enabled: true,
        };

        this.saveSound(sound);
        ctx.reply(`✅ Sound "${name}" hinzugefügt`);
      },
    });

    // !delsound - Delete a sound
    this.registerCommand({
      name: 'delsound',
      aliases: ['removesound'],
      description: 'Delete a sound',
      usage: '!delsound <id>',
      permission: Permission.BROADCASTER,
      cooldown: { user: 0, global: 0 },
      handler: async (ctx) => {
        const id = ctx.args[0];
        if (!id) {
          ctx.reply('❌ Usage: !delsound <id>');
          return;
        }

        if (!this.sounds.has(id)) {
          ctx.reply('❌ Sound nicht gefunden');
          return;
        }

        this.deleteSound(id);
        ctx.reply(`✅ Sound "${id}" gelöscht`);
      },
    });

    // !soundtrigger - Add sound trigger
    this.registerCommand({
      name: 'soundtrigger',
      description: 'Add event trigger for sound',
      usage: '!soundtrigger <event> <sound_id> [min_value]',
      permission: Permission.BROADCASTER,
      cooldown: { user: 0, global: 0 },
      handler: async (ctx) => {
        const [event, soundId, minValueStr] = ctx.args;

        if (!event || !soundId) {
          ctx.reply('❌ Usage: !soundtrigger <event> <sound_id> [min_value]');
          ctx.reply('Events: follow, sub, subgift, cheer, raid');
          return;
        }

        if (!this.sounds.has(soundId)) {
          ctx.reply('❌ Sound nicht gefunden');
          return;
        }

        const eventName = `twitch:${event}`;
        this.saveTrigger({
          event: eventName,
          soundId,
          enabled: true,
          minValue: parseInt(minValueStr) || undefined,
        });

        ctx.reply(`✅ Trigger für "${event}" → "${soundId}" erstellt`);
      },
    });

    // !soundvolume - Set global volume
    this.registerCommand({
      name: 'soundvolume',
      aliases: ['volume'],
      description: 'Set global sound volume',
      usage: '!soundvolume <0-100>',
      permission: Permission.MODERATOR,
      cooldown: { user: 0, global: 0 },
      handler: async (ctx) => {
        const volume = parseInt(ctx.args[0]);

        if (isNaN(volume) || volume < 0 || volume > 100) {
          ctx.reply(`🔊 Aktuelle Lautstärke: ${this.settings.globalVolume}%`);
          return;
        }

        this.settings.globalVolume = volume;
        this.saveSettings();
        ctx.reply(`🔊 Lautstärke auf ${volume}% gesetzt`);
      },
    });

    // !skipsound - Skip current sound
    this.registerCommand({
      name: 'skipsound',
      description: 'Skip current playing sound',
      permission: Permission.MODERATOR,
      cooldown: { user: 0, global: 0 },
      handler: async (ctx) => {
        this.ctx.events.emit('sound:skip', {});
        ctx.reply('⏭️ Sound übersprungen');
      },
    });

    // !clearsounds - Clear sound queue
    this.registerCommand({
      name: 'clearsounds',
      aliases: ['clearqueue'],
      description: 'Clear sound queue',
      permission: Permission.MODERATOR,
      cooldown: { user: 0, global: 0 },
      handler: async (ctx) => {
        const count = this.queue.length;
        this.queue = [];
        ctx.reply(`✅ ${count} Sounds aus der Warteschlange entfernt`);
      },
    });
  }

  // Public API
  getSounds(): Sound[] {
    return Array.from(this.sounds.values());
  }

  playSound(soundId: string, username?: string): boolean {
    const sound = this.sounds.get(soundId);
    if (!sound) return false;
    return this.queueSound(sound, username);
  }

  getQueueLength(): number {
    return this.queue.length;
  }
}
