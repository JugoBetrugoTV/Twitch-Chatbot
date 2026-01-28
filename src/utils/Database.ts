import fs from 'fs/promises';
import path from 'path';

export class Database {
  private data: Record<string, any> = {};
  private filePath: string;
  private saveTimeout: NodeJS.Timeout | null = null;
  private readonly saveDelay = 1000; // Debounce saves by 1 second

  constructor(filename: string = 'data.json') {
    const dataDir = path.join(process.cwd(), 'data');
    this.filePath = path.join(dataDir, filename);
  }

  public async init(): Promise<void> {
    try {
      // Ensure data directory exists
      const dataDir = path.dirname(this.filePath);
      await fs.mkdir(dataDir, { recursive: true });

      // Try to load existing data
      const content = await fs.readFile(this.filePath, 'utf-8');
      this.data = JSON.parse(content);
      console.log(`💾 Database loaded from ${this.filePath}`);
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        // File doesn't exist, start with empty data
        this.data = {};
        await this.save();
        console.log(`💾 Database created at ${this.filePath}`);
      } else {
        console.error('Failed to load database:', error);
        this.data = {};
      }
    }
  }

  private async save(): Promise<void> {
    try {
      await fs.writeFile(this.filePath, JSON.stringify(this.data, null, 2));
    } catch (error) {
      console.error('Failed to save database:', error);
    }
  }

  private scheduleSave(): void {
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
    }
    this.saveTimeout = setTimeout(() => this.save(), this.saveDelay);
  }

  public async get<T>(key: string): Promise<T | undefined> {
    return this.data[key] as T | undefined;
  }

  public async set<T>(key: string, value: T): Promise<void> {
    this.data[key] = value;
    this.scheduleSave();
  }

  public async delete(key: string): Promise<void> {
    delete this.data[key];
    this.scheduleSave();
  }

  public async has(key: string): Promise<boolean> {
    return key in this.data;
  }

  public async keys(): Promise<string[]> {
    return Object.keys(this.data);
  }

  public async getAll(): Promise<Record<string, any>> {
    return { ...this.data };
  }

  public async forceSave(): Promise<void> {
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
      this.saveTimeout = null;
    }
    await this.save();
  }
}
