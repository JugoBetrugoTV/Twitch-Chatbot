/**
 * Stream Notes Plugin
 *
 * Features:
 * - Add notes during stream
 * - Timestamp notes
 * - Categories/tags
 * - Export notes
 * - Session summaries
 */

import { Plugin } from '../base/Plugin';
import { PluginMeta, Permission } from '../../types/plugins';
import { getDatabase, DatabaseService } from '../../services/Database';

interface StreamNote {
  id: number;
  sessionId: string;
  content: string;
  category: string;
  author: string;
  timestamp: Date;
  streamTime: number;
  highlighted: boolean;
}

interface StreamSession {
  id: string;
  startTime: Date;
  endTime?: Date;
  title?: string;
  game?: string;
  noteCount: number;
}

interface StreamNotesSettings {
  enabled: boolean;
  allowModNotes: boolean;
  autoHighlightKeywords: string[];
  defaultCategory: string;
  notifyOnNote: boolean;
}

const DEFAULT_SETTINGS: StreamNotesSettings = {
  enabled: true,
  allowModNotes: true,
  autoHighlightKeywords: ['bug', 'clip', 'highlight', 'remember', 'TODO'],
  defaultCategory: 'general',
  notifyOnNote: false,
};

export class StreamNotesPlugin extends Plugin {
  meta: PluginMeta = {
    name: 'streamnotes',
    version: '1.0.0',
    description: 'Stream notes and markers',
    author: 'StreamCore',
  };

  private db!: DatabaseService;
  private settings: StreamNotesSettings = DEFAULT_SETTINGS;
  private currentSession?: StreamSession;
  private streamStartTime?: Date;

  protected async init(): Promise<void> {
    this.db = getDatabase();
    this.log.info('Initializing Stream Notes...');

    this.initTables();
    this.loadSettings();
    this.setupEventHandlers();
    this.registerCommands();

    this.log.info('Stream Notes initialized!');
  }

  protected async destroy(): Promise<void> {
    if (this.currentSession) {
      this.endSession();
    }
  }

  private initTables(): void {
    const db = this.db.raw();
    db.exec(`
      CREATE TABLE IF NOT EXISTS stream_sessions (
        id TEXT PRIMARY KEY,
        start_time DATETIME NOT NULL,
        end_time DATETIME,
        title TEXT,
        game TEXT,
        note_count INTEGER DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS stream_notes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        content TEXT NOT NULL,
        category TEXT DEFAULT 'general',
        author TEXT NOT NULL,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        stream_time INTEGER DEFAULT 0,
        highlighted INTEGER DEFAULT 0,
        FOREIGN KEY (session_id) REFERENCES stream_sessions(id)
      );

      CREATE INDEX IF NOT EXISTS idx_notes_session ON stream_notes(session_id);
      CREATE INDEX IF NOT EXISTS idx_notes_category ON stream_notes(category);
    `);
  }

  private loadSettings(): void {
    const saved = this.db.getSetting<StreamNotesSettings>('streamnotes_settings');
    if (saved) {
      this.settings = { ...DEFAULT_SETTINGS, ...saved };
    }
  }

  private saveSettings(): void {
    this.db.setSetting('streamnotes_settings', this.settings);
  }

  private setupEventHandlers(): void {
    // Auto-start session when stream goes live
    this.ctx.events.on('stream:online', (event: any) => {
      this.startSession(event.title, event.game);
    });

    // Auto-end session when stream goes offline
    this.ctx.events.on('stream:offline', () => {
      this.endSession();
    });
  }

  private startSession(title?: string, game?: string): void {
    const sessionId = `session_${Date.now()}`;
    this.streamStartTime = new Date();

    this.currentSession = {
      id: sessionId,
      startTime: this.streamStartTime,
      title,
      game,
      noteCount: 0,
    };

    const db = this.db.raw();
    db.prepare(`
      INSERT INTO stream_sessions (id, start_time, title, game)
      VALUES (?, ?, ?, ?)
    `).run(sessionId, this.streamStartTime.toISOString(), title, game);

    this.log.info(`Stream session started: ${sessionId}`);
  }

  private endSession(): void {
    if (!this.currentSession) return;

    const endTime = new Date();
    const db = this.db.raw();

    db.prepare(`
      UPDATE stream_sessions
      SET end_time = ?, note_count = ?
      WHERE id = ?
    `).run(endTime.toISOString(), this.currentSession.noteCount, this.currentSession.id);

    this.log.info(`Stream session ended: ${this.currentSession.id} (${this.currentSession.noteCount} notes)`);
    this.currentSession = undefined;
    this.streamStartTime = undefined;
  }

  private getStreamTime(): number {
    if (!this.streamStartTime) return 0;
    return Math.floor((Date.now() - this.streamStartTime.getTime()) / 1000);
  }

  private formatStreamTime(seconds: number): string {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;

    if (hours > 0) {
      return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${minutes}:${secs.toString().padStart(2, '0')}`;
  }

  private addNote(content: string, author: string, category?: string, highlighted?: boolean): StreamNote {
    // Auto-start session if not active
    if (!this.currentSession) {
      this.startSession();
    }

    const streamTime = this.getStreamTime();
    const noteCategory = category || this.settings.defaultCategory;

    // Check for auto-highlight keywords
    const shouldHighlight = highlighted ??
      this.settings.autoHighlightKeywords.some((kw) =>
        content.toLowerCase().includes(kw.toLowerCase())
      );

    const db = this.db.raw();
    const result = db.prepare(`
      INSERT INTO stream_notes (session_id, content, category, author, stream_time, highlighted)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      this.currentSession!.id,
      content,
      noteCategory,
      author,
      streamTime,
      shouldHighlight ? 1 : 0
    );

    this.currentSession!.noteCount++;

    // Update session note count
    db.prepare('UPDATE stream_sessions SET note_count = ? WHERE id = ?')
      .run(this.currentSession!.noteCount, this.currentSession!.id);

    const note: StreamNote = {
      id: result.lastInsertRowid as number,
      sessionId: this.currentSession!.id,
      content,
      category: noteCategory,
      author,
      timestamp: new Date(),
      streamTime,
      highlighted: shouldHighlight,
    };

    this.ctx.events.emit('streamnotes:added', note);

    return note;
  }

  private registerCommands(): void {
    // !note - Add a stream note
    this.registerCommand({
      name: 'note',
      aliases: ['addnote', 'marker'],
      description: 'Add a stream note',
      usage: '!note [category:] <content>',
      permission: Permission.MODERATOR,
      cooldown: { user: 3, global: 0 },
      handler: async (ctx) => {
        if (!this.settings.enabled) {
          ctx.reply('❌ Stream Notes deaktiviert');
          return;
        }

        if (ctx.args.length === 0) {
          ctx.reply('Verwendung: !note [kategorie:] <inhalt>');
          return;
        }

        let category: string | undefined;
        let content: string;

        // Check for category prefix
        if (ctx.args[0].endsWith(':')) {
          category = ctx.args[0].slice(0, -1).toLowerCase();
          content = ctx.args.slice(1).join(' ');
        } else {
          content = ctx.args.join(' ');
        }

        if (!content) {
          ctx.reply('❌ Bitte gib einen Notiz-Inhalt an');
          return;
        }

        const note = this.addNote(content, ctx.user.username, category);
        const timeStamp = this.formatStreamTime(note.streamTime);

        ctx.reply(`📝 Notiz #${note.id} @ ${timeStamp}${note.highlighted ? ' ⭐' : ''}`);
      },
    });

    // !highlight - Add highlighted note
    this.registerCommand({
      name: 'highlight',
      aliases: ['hl', 'important'],
      description: 'Add a highlighted stream note',
      usage: '!highlight <content>',
      permission: Permission.MODERATOR,
      cooldown: { user: 3, global: 0 },
      handler: async (ctx) => {
        if (ctx.args.length === 0) {
          ctx.reply('Verwendung: !highlight <inhalt>');
          return;
        }

        const content = ctx.args.join(' ');
        const note = this.addNote(content, ctx.user.username, 'highlight', true);
        const timeStamp = this.formatStreamTime(note.streamTime);

        ctx.reply(`⭐ Highlight #${note.id} @ ${timeStamp}`);
      },
    });

    // !notes - View recent notes
    this.registerCommand({
      name: 'notes',
      aliases: ['viewnotes', 'listnotes'],
      description: 'View recent stream notes',
      usage: '!notes [count|category]',
      permission: Permission.MODERATOR,
      cooldown: { user: 10, global: 5 },
      handler: async (ctx) => {
        if (!this.currentSession) {
          ctx.reply('📝 Keine aktive Stream-Session');
          return;
        }

        const arg = ctx.args[0]?.toLowerCase();
        const limit = parseInt(arg) || 5;
        const category = isNaN(parseInt(arg)) ? arg : undefined;

        const db = this.db.raw();
        let query = 'SELECT * FROM stream_notes WHERE session_id = ?';
        const params: any[] = [this.currentSession.id];

        if (category) {
          query += ' AND category = ?';
          params.push(category);
        }

        query += ' ORDER BY id DESC LIMIT ?';
        params.push(limit);

        const notes = db.prepare(query).all(...params) as any[];

        if (notes.length === 0) {
          ctx.reply(`📝 Keine Notizen${category ? ` in "${category}"` : ''} gefunden`);
          return;
        }

        const list = notes
          .reverse()
          .map((n) => `#${n.id} [${this.formatStreamTime(n.stream_time)}] ${n.content.slice(0, 30)}${n.content.length > 30 ? '...' : ''}`)
          .join(' | ');

        ctx.reply(`📝 Notizen: ${list}`);
      },
    });

    // !highlights - View highlighted notes only
    this.registerCommand({
      name: 'highlights',
      description: 'View highlighted notes',
      permission: Permission.MODERATOR,
      cooldown: { user: 10, global: 5 },
      handler: async (ctx) => {
        if (!this.currentSession) {
          ctx.reply('📝 Keine aktive Stream-Session');
          return;
        }

        const db = this.db.raw();
        const notes = db.prepare(`
          SELECT * FROM stream_notes
          WHERE session_id = ? AND highlighted = 1
          ORDER BY id DESC LIMIT 10
        `).all(this.currentSession.id) as any[];

        if (notes.length === 0) {
          ctx.reply('⭐ Keine Highlights gefunden');
          return;
        }

        const list = notes
          .reverse()
          .map((n) => `[${this.formatStreamTime(n.stream_time)}] ${n.content.slice(0, 25)}`)
          .join(' | ');

        ctx.reply(`⭐ Highlights: ${list}`);
      },
    });

    // !notecount - Show note statistics
    this.registerCommand({
      name: 'notecount',
      aliases: ['notestats'],
      description: 'Show note statistics',
      permission: Permission.MODERATOR,
      cooldown: { user: 10, global: 5 },
      handler: async (ctx) => {
        if (!this.currentSession) {
          ctx.reply('📝 Keine aktive Stream-Session');
          return;
        }

        const db = this.db.raw();

        const total = this.currentSession.noteCount;
        const highlighted = db.prepare(
          'SELECT COUNT(*) as count FROM stream_notes WHERE session_id = ? AND highlighted = 1'
        ).get(this.currentSession.id) as any;

        const categories = db.prepare(`
          SELECT category, COUNT(*) as count
          FROM stream_notes
          WHERE session_id = ?
          GROUP BY category
        `).all(this.currentSession.id) as any[];

        const categoryList = categories.map((c) => `${c.category}: ${c.count}`).join(', ');

        ctx.reply(`📊 Notizen: ${total} | Highlights: ${highlighted?.count || 0} | ${categoryList}`);
      },
    });

    // !deletenote - Delete a note
    this.registerCommand({
      name: 'deletenote',
      aliases: ['remnote', 'delnote'],
      description: 'Delete a stream note',
      usage: '!deletenote <id>',
      permission: Permission.MODERATOR,
      cooldown: { user: 5, global: 0 },
      handler: async (ctx) => {
        if (ctx.args.length === 0) {
          ctx.reply('Verwendung: !deletenote <id>');
          return;
        }

        const noteId = parseInt(ctx.args[0]);

        if (isNaN(noteId)) {
          ctx.reply('❌ Ungültige Notiz-ID');
          return;
        }

        const db = this.db.raw();
        const result = db.prepare('DELETE FROM stream_notes WHERE id = ?').run(noteId);

        if (result.changes > 0) {
          if (this.currentSession) {
            this.currentSession.noteCount--;
          }
          ctx.reply(`✅ Notiz #${noteId} gelöscht`);
        } else {
          ctx.reply(`❌ Notiz #${noteId} nicht gefunden`);
        }
      },
    });

    // !exportnotes - Export session notes
    this.registerCommand({
      name: 'exportnotes',
      description: 'Export notes (shows summary)',
      permission: Permission.BROADCASTER,
      cooldown: { user: 30, global: 15 },
      handler: async (ctx) => {
        const sessionId = ctx.args[0] || this.currentSession?.id;

        if (!sessionId) {
          ctx.reply('❌ Keine Session angegeben und keine aktive Session');
          return;
        }

        const db = this.db.raw();

        const session = db.prepare('SELECT * FROM stream_sessions WHERE id = ?').get(sessionId) as any;
        if (!session) {
          ctx.reply('❌ Session nicht gefunden');
          return;
        }

        const notes = db.prepare(`
          SELECT * FROM stream_notes WHERE session_id = ? ORDER BY stream_time
        `).all(sessionId) as any[];

        // In a real implementation, this would generate a file
        ctx.reply(
          `📄 Export: ${session.title || 'Stream'} | ` +
          `${notes.length} Notizen | ` +
          `${notes.filter((n: any) => n.highlighted).length} Highlights`
        );

        this.ctx.events.emit('streamnotes:export', {
          session,
          notes,
          exportedBy: ctx.user.username,
        });
      },
    });

    // !lastsession - View last session summary
    this.registerCommand({
      name: 'lastsession',
      description: 'View last stream session notes',
      permission: Permission.MODERATOR,
      cooldown: { user: 30, global: 15 },
      handler: async (ctx) => {
        const db = this.db.raw();

        const session = db.prepare(`
          SELECT * FROM stream_sessions
          WHERE end_time IS NOT NULL
          ORDER BY start_time DESC
          LIMIT 1
        `).get() as any;

        if (!session) {
          ctx.reply('📝 Keine vorherige Session gefunden');
          return;
        }

        const startDate = new Date(session.start_time).toLocaleDateString('de-DE');

        ctx.reply(
          `📝 Letzte Session: ${startDate} | ` +
          `${session.title || 'Kein Titel'} | ` +
          `${session.note_count} Notizen`
        );
      },
    });

    // !startsession - Manually start a notes session
    this.registerCommand({
      name: 'startsession',
      description: 'Manually start a notes session',
      usage: '!startsession [title]',
      permission: Permission.BROADCASTER,
      cooldown: { user: 60, global: 30 },
      handler: async (ctx) => {
        if (this.currentSession) {
          ctx.reply('ℹ️ Session bereits aktiv. Nutze !endsession zum Beenden.');
          return;
        }

        const title = ctx.args.join(' ') || undefined;
        this.startSession(title);

        ctx.reply(`📝 Neue Notes-Session gestartet${title ? `: ${title}` : ''}`);
      },
    });

    // !endsession - Manually end notes session
    this.registerCommand({
      name: 'endsession',
      description: 'Manually end notes session',
      permission: Permission.BROADCASTER,
      cooldown: { user: 30, global: 15 },
      handler: async (ctx) => {
        if (!this.currentSession) {
          ctx.reply('ℹ️ Keine aktive Session');
          return;
        }

        const noteCount = this.currentSession.noteCount;
        this.endSession();

        ctx.reply(`📝 Session beendet. ${noteCount} Notizen gespeichert.`);
      },
    });
  }

  // Public API
  getCurrentSession(): StreamSession | undefined {
    return this.currentSession ? { ...this.currentSession } : undefined;
  }

  getNotes(sessionId?: string): StreamNote[] {
    const id = sessionId || this.currentSession?.id;
    if (!id) return [];

    const db = this.db.raw();
    const rows = db.prepare('SELECT * FROM stream_notes WHERE session_id = ? ORDER BY stream_time').all(id) as any[];

    return rows.map((row) => ({
      id: row.id,
      sessionId: row.session_id,
      content: row.content,
      category: row.category,
      author: row.author,
      timestamp: new Date(row.timestamp),
      streamTime: row.stream_time,
      highlighted: row.highlighted === 1,
    }));
  }

  addNoteFromAPI(content: string, category?: string, highlighted?: boolean): StreamNote | null {
    if (!this.settings.enabled) return null;
    return this.addNote(content, 'API', category, highlighted);
  }
}
