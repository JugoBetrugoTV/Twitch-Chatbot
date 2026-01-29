/**
 * Sound Alerts Plugin
 *
 * Features:
 * - Play sound effects via commands
 * - Configurable sound library
 * - Cooldowns per sound
 * - Volume control
 * - Event-based sounds (follows, subs, etc.)
 */

import { Plugin } from '../base/Plugin';
import { PluginMeta, Permission } from '../../types/plugins';
import { getDatabase, DatabaseService } from '../../services/Database';
import path from 'path';
import fs from 'fs';

interface SoundEffect {
  id: string;
  name: string;
  filename: string;
  volume: number;
  cooldownSeconds: number;
  cost: number; // Points cost, 0 = free
  permission: Permission;
  enabled: boolean;
}

interface SoundSettings {
  enabled: boolean;
  globalVolume: number;
  soundsPath: string;
  globalCooldown: number;
}

const DEFAULT_SETTINGS: SoundSettings = {
  enabled: true,
  globalVolume: 0.5,
  soundsPath: './sounds',
  globalCooldown: 5,
};

export class SoundAlertsPlugin extends Plugin {
  meta: PluginMeta = {
    name: 'sounds',
    version: '1.0.0',
    description: 'Sound effects and alerts',
    author: 'StreamCore',
  };

  private db!: DatabaseService;
  private settings: SoundSettings = DEFAULT_SETTINGS;
  private sounds: Map<string, SoundEffect> = new Map();
  private cooldowns: Map<string, number> = new Map();
  private lastGlobalSound: number = 0;

  protected async init(): Promise<void> {
    this.db = getDatabase();
    this.log.info('Initializing Sound Alerts...');

    this.initTables();
    this.loadSettings();
    this.loadSounds();
    this.ensureSoundsDirectory();
    this.registerCommands();

    this.log.info('Sound Alerts initialized!');
  }

  protected async destroy(): Promise<void> {}

  private initTables(): void {
    const db = this.db.raw();
    db.exec(`
      CREATE TABLE IF NOT EXISTS sound_effects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        filename TEXT NOT NULL,
        volume REAL DEFAULT 1.0,
        cooldown_seconds INTEGER DEFAULT 30,
        cost INTEGER DEFAULT 0,
        permission TEXT DEFAULT 'everyone',
        enabled BOOLEAN DEFAULT TRUE
      );
    `);
  }

  private loadSettings(): void {
    const saved = this.db.getSetting<SoundSettings>('sound_settings');
    if (saved) {
      this.settings = { ...DEFAULT_SETTINGS, ...saved };
    }
  }

  private loadSounds(): void {
    const db = this.db.raw();
    const stmt = db.prepare('SELECT * FROM sound_effects');
    const rows = stmt.all() as any[];

    for (const row of rows) {
      this.sounds.set(row.id, {
        id: row.id,
        name: row.name,
        filename: row.filename,
        volume: row.volume,
        cooldownSeconds: row.cooldown_seconds,
        cost: row.cost,
        permission: row.permission as Permission,
        enabled: !!row.enabled,
      });
    }

    // Add default sounds if none exist
    if (this.sounds.size === 0) {
      this.addDefaultSounds();
    }

    this.log.info(`Loaded ${this.sounds.size} sound effects`);
  }

  private addDefaultSounds(): void {
    const defaults: SoundEffect[] = [
      { id: 'airhorn', name: 'Airhorn', filename: 'airhorn.mp3', volume: 0.7, cooldownSeconds: 60, cost: 100, permission: Permission.EVERYONE, enabled: true },
      { id: 'sad', name: 'Sad Trombone', filename: 'sad.mp3', volume: 0.8, cooldownSeconds: 30, cost: 50, permission: Permission.EVERYONE, enabled: true },
      { id: 'victory', name: 'Victory', filename: 'victory.mp3', volume: 0.8, cooldownSeconds: 60, cost: 100, permission: Permission.EVERYONE, enabled: true },
      { id: 'bruh', name: 'Bruh', filename: 'bruh.mp3', volume: 0.8, cooldownSeconds: 30, cost: 50, permission: Permission.EVERYONE, enabled: true },
      { id: 'oof', name: 'Oof', filename: 'oof.mp3', volume: 0.8, cooldownSeconds: 20, cost: 25, permission: Permission.EVERYONE, enabled: true },
    ];

    for (const sound of defaults) {
      this.sounds.set(sound.id, sound);
      this.saveSound(sound);
    }
  }

  private ensureSoundsDirectory(): void {
    const soundsPath = path.resolve(this.settings.soundsPath);
    if (!fs.existsSync(soundsPath)) {
      fs.mkdirSync(soundsPath, { recursive: true });
      this.log.info(`Created sounds directory: ${soundsPath}`);
    }
  }

  private saveSound(sound: SoundEffect): void {
    const db = this.db.raw();
    const stmt = db.prepare(`
      INSERT OR REPLACE INTO sound_effects
      (id, name, filename, volume, cooldown_seconds, cost, permission, enabled)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      sound.id,
      sound.name,
      sound.filename,
      sound.volume,
      sound.cooldownSeconds,
      sound.cost,
      sound.permission,
      sound.enabled ? 1 : 0
    );
  }

  private registerCommands(): void {
    // !sound - Play a sound
    this.registerCommand({
      name: 'sound',
      aliases: ['play', 'sfx'],
      description: 'Play a sound effect',
      usage: '!sound <name>',
      cooldown: { user: 5, global: 0 },
      handler: async (ctx) => {
        if (!this.settings.enabled) {
          ctx.reply('🔇 Sound-Effekte sind deaktiviert');
          return;
        }

        if (ctx.args.length === 0) {
          const available = Array.from(this.sounds.values())
            .filter((s) => s.enabled)
            .slice(0, 10)
            .map((s) => s.id)
            .join(', ');
          ctx.reply(`🔊 Verfügbare Sounds: ${available} | !sound <name>`);
          return;
        }

        const soundId = ctx.args[0].toLowerCase();
        const sound = this.sounds.get(soundId);

        if (!sound || !sound.enabled) {
          ctx.reply('❌ Sound nicht gefunden');
          return;
        }

        // Check global cooldown
        if (Date.now() - this.lastGlobalSound < this.settings.globalCooldown * 1000) {
          ctx.reply('⏳ Bitte warte einen Moment');
          return;
        }

        // Check sound-specific cooldown
        const lastPlay = this.cooldowns.get(soundId) || 0;
        if (Date.now() - lastPlay < sound.cooldownSeconds * 1000) {
          const remaining = Math.ceil((sound.cooldownSeconds * 1000 - (Date.now() - lastPlay)) / 1000);
          ctx.reply(`⏳ Cooldown: ${remaining}s`);
          return;
        }

        // Check cost
        if (sound.cost > 0) {
          const user = this.db.getUser('twitch', ctx.user.username);
          if (!user || user.points < sound.cost) {
            ctx.reply(`❌ Nicht genug Punkte (${sound.cost} benötigt)`);
            return;
          }
          this.db.updateUserPoints('twitch', ctx.user.username, -sound.cost);
        }

        // Play sound (emit event for external player)
        this.playSound(sound);
        this.cooldowns.set(soundId, Date.now());
        this.lastGlobalSound = Date.now();

        ctx.reply(`🔊 ${sound.name} (${ctx.user.displayName})`);
      },
    });

    // !sounds - List all sounds
    this.registerCommand({
      name: 'sounds',
      aliases: ['soundlist'],
      description: 'List all sound effects',
      cooldown: { user: 30, global: 10 },
      handler: async (ctx) => {
        const available = Array.from(this.sounds.values())
          .filter((s) => s.enabled)
          .map((s) => `${s.id}${s.cost > 0 ? ` (${s.cost}P)` : ''}`)
          .join(', ');

        ctx.reply(`🔊 Sounds: ${available}`);
      },
    });

    // !addsound - Add a sound (mod)
    this.registerCommand({
      name: 'addsound',
      description: 'Add a new sound effect',
      usage: '!addsound <id> <filename> <name>',
      permission: Permission.MODERATOR,
      cooldown: { user: 5, global: 0 },
      handler: async (ctx) => {
        if (ctx.args.length < 3) {
          ctx.reply('Verwendung: !addsound <id> <datei.mp3> <name>');
          return;
        }

        const [id, filename, ...nameParts] = ctx.args;
        const name = nameParts.join(' ');

        if (this.sounds.has(id.toLowerCase())) {
          ctx.reply('❌ Sound-ID existiert bereits');
          return;
        }

        const sound: SoundEffect = {
          id: id.toLowerCase(),
          name,
          filename,
          volume: 1.0,
          cooldownSeconds: 30,
          cost: 0,
          permission: Permission.EVERYONE,
          enabled: true,
        };

        this.sounds.set(sound.id, sound);
        this.saveSound(sound);

        ctx.reply(`✅ Sound "${name}" (${id}) hinzugefügt`);
      },
    });

    // !soundconfig - Configure a sound
    this.registerCommand({
      name: 'soundconfig',
      description: 'Configure sound settings',
      usage: '!soundconfig <id> <cost|cooldown|volume> <value>',
      permission: Permission.MODERATOR,
      cooldown: { user: 5, global: 0 },
      handler: async (ctx) => {
        if (ctx.args.length < 3) {
          ctx.reply('Verwendung: !soundconfig <id> <cost|cooldown|volume> <wert>');
          return;
        }

        const [id, setting, value] = ctx.args;
        const sound = this.sounds.get(id.toLowerCase());

        if (!sound) {
          ctx.reply('❌ Sound nicht gefunden');
          return;
        }

        switch (setting.toLowerCase()) {
          case 'cost':
            sound.cost = Math.max(0, parseInt(value) || 0);
            break;
          case 'cooldown':
            sound.cooldownSeconds = Math.max(0, parseInt(value) || 30);
            break;
          case 'volume':
            sound.volume = Math.max(0, Math.min(1, parseFloat(value) || 1));
            break;
          default:
            ctx.reply('❌ Ungültige Einstellung (cost, cooldown, volume)');
            return;
        }

        this.saveSound(sound);
        ctx.reply(`✅ ${sound.name}: ${setting} = ${value}`);
      },
    });

    // !togglesound - Enable/disable sound
    this.registerCommand({
      name: 'togglesound',
      description: 'Enable/disable a sound',
      usage: '!togglesound <id>',
      permission: Permission.MODERATOR,
      cooldown: { user: 5, global: 0 },
      handler: async (ctx) => {
        if (ctx.args.length === 0) {
          ctx.reply('Verwendung: !togglesound <id>');
          return;
        }

        const sound = this.sounds.get(ctx.args[0].toLowerCase());
        if (!sound) {
          ctx.reply('❌ Sound nicht gefunden');
          return;
        }

        sound.enabled = !sound.enabled;
        this.saveSound(sound);
        ctx.reply(`✅ ${sound.name}: ${sound.enabled ? 'aktiviert' : 'deaktiviert'}`);
      },
    });

    // !soundvolume - Set global volume
    this.registerCommand({
      name: 'soundvolume',
      aliases: ['volume'],
      description: 'Set global sound volume',
      usage: '!soundvolume <0-100>',
      permission: Permission.MODERATOR,
      cooldown: { user: 5, global: 0 },
      handler: async (ctx) => {
        if (ctx.args.length === 0) {
          ctx.reply(`🔊 Lautstärke: ${Math.round(this.settings.globalVolume * 100)}%`);
          return;
        }

        const volume = parseInt(ctx.args[0]);
        if (isNaN(volume) || volume < 0 || volume > 100) {
          ctx.reply('❌ Lautstärke muss zwischen 0-100 sein');
          return;
        }

        this.settings.globalVolume = volume / 100;
        this.db.setSetting('sound_settings', this.settings);
        ctx.reply(`🔊 Lautstärke auf ${volume}% gesetzt`);

        // Emit volume change event
        this.ctx.events.emit('sound:volumeChange', { volume: this.settings.globalVolume });
      },
    });
  }

  private playSound(sound: SoundEffect): void {
    const volume = sound.volume * this.settings.globalVolume;
    const filePath = path.join(this.settings.soundsPath, sound.filename);

    // Emit event for external audio player
    this.ctx.events.emit('sound:play', {
      id: sound.id,
      name: sound.name,
      file: filePath,
      volume,
    });

    this.log.info(`Playing sound: ${sound.name} (${volume * 100}%)`);
  }

  // Public API
  getSounds(): SoundEffect[] {
    return Array.from(this.sounds.values());
  }

  getSound(id: string): SoundEffect | undefined {
    return this.sounds.get(id);
  }

  triggerSound(id: string): boolean {
    const sound = this.sounds.get(id);
    if (!sound || !sound.enabled) return false;

    this.playSound(sound);
    return true;
  }
}
