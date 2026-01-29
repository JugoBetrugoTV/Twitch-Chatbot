/**
 * Encryption Service
 *
 * Secure encryption for sensitive data
 * Features:
 * - AES-256-GCM encryption
 * - Key derivation (PBKDF2)
 * - Secure random generation
 * - Token generation
 */

import * as crypto from 'crypto';
import { Logger } from '../utils/logger';

export interface EncryptedData {
  iv: string;
  data: string;
  tag: string;
  version: number;
}

export interface EncryptionSettings {
  algorithm: string;
  keyLength: number;
  ivLength: number;
  tagLength: number;
  pbkdf2Iterations: number;
  saltLength: number;
}

const DEFAULT_SETTINGS: EncryptionSettings = {
  algorithm: 'aes-256-gcm',
  keyLength: 32, // 256 bits
  ivLength: 16, // 128 bits
  tagLength: 16, // 128 bits
  pbkdf2Iterations: 100000,
  saltLength: 32,
};

const CURRENT_VERSION = 1;

export class EncryptionService {
  private log = new Logger('EncryptionService');
  private settings: EncryptionSettings;
  private masterKey: Buffer | null = null;

  constructor(settings: Partial<EncryptionSettings> = {}) {
    this.settings = { ...DEFAULT_SETTINGS, ...settings };
    this.log.info('Encryption Service initialized');
  }

  /**
   * Initialize with a master password
   */
  async initialize(password: string, salt?: string): Promise<void> {
    const saltBuffer = salt
      ? Buffer.from(salt, 'hex')
      : crypto.randomBytes(this.settings.saltLength);

    this.masterKey = await this.deriveKey(password, saltBuffer);
    this.log.info('Master key derived');
  }

  /**
   * Derive key from password using PBKDF2
   */
  private deriveKey(password: string, salt: Buffer): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      crypto.pbkdf2(
        password,
        salt,
        this.settings.pbkdf2Iterations,
        this.settings.keyLength,
        'sha512',
        (err, derivedKey) => {
          if (err) reject(err);
          else resolve(derivedKey);
        }
      );
    });
  }

  /**
   * Encrypt data
   */
  encrypt(plaintext: string, key?: Buffer): EncryptedData {
    const encryptionKey = key || this.masterKey;
    if (!encryptionKey) {
      throw new Error('Encryption key not initialized');
    }

    const iv = crypto.randomBytes(this.settings.ivLength);
    const cipher = crypto.createCipheriv(
      this.settings.algorithm as crypto.CipherGCMTypes,
      encryptionKey,
      iv,
      { authTagLength: this.settings.tagLength }
    );

    let encrypted = cipher.update(plaintext, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    const tag = cipher.getAuthTag();

    return {
      iv: iv.toString('hex'),
      data: encrypted,
      tag: tag.toString('hex'),
      version: CURRENT_VERSION,
    };
  }

  /**
   * Decrypt data
   */
  decrypt(encryptedData: EncryptedData, key?: Buffer): string {
    const decryptionKey = key || this.masterKey;
    if (!decryptionKey) {
      throw new Error('Decryption key not initialized');
    }

    const iv = Buffer.from(encryptedData.iv, 'hex');
    const tag = Buffer.from(encryptedData.tag, 'hex');

    const decipher = crypto.createDecipheriv(
      this.settings.algorithm as crypto.CipherGCMTypes,
      decryptionKey,
      iv,
      { authTagLength: this.settings.tagLength }
    );

    decipher.setAuthTag(tag);

    let decrypted = decipher.update(encryptedData.data, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  }

  /**
   * Encrypt object to JSON
   */
  encryptObject(obj: any, key?: Buffer): string {
    const json = JSON.stringify(obj);
    const encrypted = this.encrypt(json, key);
    return JSON.stringify(encrypted);
  }

  /**
   * Decrypt JSON to object
   */
  decryptObject<T = any>(encryptedJson: string, key?: Buffer): T {
    const encrypted = JSON.parse(encryptedJson) as EncryptedData;
    const json = this.decrypt(encrypted, key);
    return JSON.parse(json);
  }

  /**
   * Generate secure random bytes
   */
  randomBytes(length: number): Buffer {
    return crypto.randomBytes(length);
  }

  /**
   * Generate random hex string
   */
  randomHex(length: number): string {
    return crypto.randomBytes(length).toString('hex');
  }

  /**
   * Generate random base64 string
   */
  randomBase64(length: number): string {
    return crypto.randomBytes(length).toString('base64');
  }

  /**
   * Generate secure token
   */
  generateToken(length: number = 32): string {
    return crypto.randomBytes(length).toString('base64url');
  }

  /**
   * Generate API key
   */
  generateApiKey(prefix: string = 'sk'): string {
    const random = crypto.randomBytes(24).toString('base64url');
    return `${prefix}_${random}`;
  }

  /**
   * Hash password (one-way)
   */
  async hashPassword(password: string): Promise<string> {
    const salt = crypto.randomBytes(this.settings.saltLength);
    const hash = await this.deriveKey(password, salt);
    return `${salt.toString('hex')}:${hash.toString('hex')}`;
  }

  /**
   * Verify password hash
   */
  async verifyPassword(password: string, storedHash: string): Promise<boolean> {
    const [saltHex, hashHex] = storedHash.split(':');
    if (!saltHex || !hashHex) {
      return false;
    }

    const salt = Buffer.from(saltHex, 'hex');
    const hash = await this.deriveKey(password, salt);
    return crypto.timingSafeEqual(hash, Buffer.from(hashHex, 'hex'));
  }

  /**
   * Create HMAC signature
   */
  createHmac(data: string, secret: string): string {
    return crypto.createHmac('sha256', secret).update(data).digest('hex');
  }

  /**
   * Verify HMAC signature
   */
  verifyHmac(data: string, signature: string, secret: string): boolean {
    const expected = this.createHmac(data, secret);
    return crypto.timingSafeEqual(
      Buffer.from(signature, 'hex'),
      Buffer.from(expected, 'hex')
    );
  }

  /**
   * Hash data (SHA-256)
   */
  hash(data: string): string {
    return crypto.createHash('sha256').update(data).digest('hex');
  }

  /**
   * Generate UUID v4
   */
  uuid(): string {
    return crypto.randomUUID();
  }

  /**
   * Encrypt field for database storage
   */
  encryptField(value: string): string {
    if (!value) return value;
    const encrypted = this.encrypt(value);
    return `ENC:${Buffer.from(JSON.stringify(encrypted)).toString('base64')}`;
  }

  /**
   * Decrypt field from database
   */
  decryptField(value: string): string {
    if (!value || !value.startsWith('ENC:')) return value;
    try {
      const base64 = value.slice(4);
      const encrypted = JSON.parse(Buffer.from(base64, 'base64').toString());
      return this.decrypt(encrypted);
    } catch {
      return value;
    }
  }

  /**
   * Check if field is encrypted
   */
  isEncrypted(value: string): boolean {
    return value?.startsWith('ENC:') ?? false;
  }

  /**
   * Mask sensitive data for logging
   */
  mask(value: string, visibleChars: number = 4): string {
    if (!value || value.length <= visibleChars) {
      return '***';
    }
    return '***' + value.slice(-visibleChars);
  }

  /**
   * Securely compare two strings (timing-safe)
   */
  secureCompare(a: string, b: string): boolean {
    if (a.length !== b.length) {
      return false;
    }
    return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
  }
}

// Singleton instance
let encryptionServiceInstance: EncryptionService | null = null;

export function getEncryptionService(settings?: Partial<EncryptionSettings>): EncryptionService {
  if (!encryptionServiceInstance) {
    encryptionServiceInstance = new EncryptionService(settings);
  }
  return encryptionServiceInstance;
}

/**
 * Initialize encryption service with password
 */
export async function initializeEncryption(password: string, salt?: string): Promise<EncryptionService> {
  const service = getEncryptionService();
  await service.initialize(password, salt);
  return service;
}
