/**
 * EncryptionService Tests
 */

// Mock Logger
jest.mock('../../src/utils/logger', () => ({
  Logger: jest.fn().mockImplementation(() => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  })),
}));

import { EncryptionService } from '../../src/services/EncryptionService';

describe('EncryptionService', () => {
  let encryption: EncryptionService;

  beforeEach(async () => {
    encryption = new EncryptionService();
    await encryption.initialize('test-password-123', 'a'.repeat(64));
  });

  describe('Encryption and Decryption', () => {
    it('should encrypt and decrypt strings', () => {
      const plaintext = 'Hello, World!';
      const encrypted = encryption.encrypt(plaintext);
      const decrypted = encryption.decrypt(encrypted);

      expect(decrypted).toBe(plaintext);
    });

    it('should produce different ciphertexts for same plaintext', () => {
      const plaintext = 'Same message';
      const encrypted1 = encryption.encrypt(plaintext);
      const encrypted2 = encryption.encrypt(plaintext);

      // IVs should be different
      expect(encrypted1.iv).not.toBe(encrypted2.iv);
      // Data should be different due to different IVs
      expect(encrypted1.data).not.toBe(encrypted2.data);
    });

    it('should handle empty strings', () => {
      const encrypted = encryption.encrypt('');
      const decrypted = encryption.decrypt(encrypted);
      expect(decrypted).toBe('');
    });

    it('should handle unicode characters', () => {
      const plaintext = 'Hello 世界 🌍 مرحبا';
      const encrypted = encryption.encrypt(plaintext);
      const decrypted = encryption.decrypt(encrypted);
      expect(decrypted).toBe(plaintext);
    });

    it('should handle long strings', () => {
      const plaintext = 'x'.repeat(10000);
      const encrypted = encryption.encrypt(plaintext);
      const decrypted = encryption.decrypt(encrypted);
      expect(decrypted).toBe(plaintext);
    });

    it('should throw when key not initialized', () => {
      const uninitializedService = new EncryptionService();
      expect(() => uninitializedService.encrypt('test')).toThrow(
        'Encryption key not initialized'
      );
    });
  });

  describe('Object Encryption', () => {
    it('should encrypt and decrypt objects', () => {
      const obj = {
        name: 'Test User',
        age: 25,
        settings: { theme: 'dark', notifications: true },
      };

      const encrypted = encryption.encryptObject(obj);
      const decrypted = encryption.decryptObject(encrypted);

      expect(decrypted).toEqual(obj);
    });

    it('should handle arrays', () => {
      const arr = [1, 2, 3, { nested: 'value' }];
      const encrypted = encryption.encryptObject(arr);
      const decrypted = encryption.decryptObject(encrypted);

      expect(decrypted).toEqual(arr);
    });
  });

  describe('Random Generation', () => {
    it('should generate random bytes', () => {
      const bytes = encryption.randomBytes(32);
      expect(bytes).toBeInstanceOf(Buffer);
      expect(bytes.length).toBe(32);
    });

    it('should generate unique values', () => {
      const values = new Set();
      for (let i = 0; i < 100; i++) {
        values.add(encryption.randomHex(16));
      }
      expect(values.size).toBe(100);
    });

    it('should generate hex strings', () => {
      const hex = encryption.randomHex(16);
      expect(hex).toMatch(/^[a-f0-9]+$/);
      expect(hex.length).toBe(32); // 16 bytes = 32 hex chars
    });

    it('should generate base64 strings', () => {
      const base64 = encryption.randomBase64(16);
      expect(base64).toMatch(/^[A-Za-z0-9+/=]+$/);
    });
  });

  describe('Token Generation', () => {
    it('should generate tokens with default length', () => {
      const token = encryption.generateToken();
      expect(token.length).toBeGreaterThan(0);
    });

    it('should generate tokens with custom length', () => {
      const token = encryption.generateToken(64);
      // Base64url encoding makes the string longer
      expect(token.length).toBeGreaterThan(64);
    });

    it('should generate unique tokens', () => {
      const tokens = new Set();
      for (let i = 0; i < 100; i++) {
        tokens.add(encryption.generateToken());
      }
      expect(tokens.size).toBe(100);
    });
  });

  describe('API Key Generation', () => {
    it('should generate API keys with default prefix', () => {
      const apiKey = encryption.generateApiKey();
      expect(apiKey).toMatch(/^sk_[A-Za-z0-9_-]+$/);
    });

    it('should generate API keys with custom prefix', () => {
      const apiKey = encryption.generateApiKey('pk');
      expect(apiKey).toMatch(/^pk_[A-Za-z0-9_-]+$/);
    });
  });

  describe('Password Hashing', () => {
    it('should hash and verify passwords', async () => {
      const password = 'secure-password-123';
      const hash = await encryption.hashPassword(password);

      expect(await encryption.verifyPassword(password, hash)).toBe(true);
      expect(await encryption.verifyPassword('wrong-password', hash)).toBe(false);
    });

    it('should produce different hashes for same password', async () => {
      const password = 'test-password';
      const hash1 = await encryption.hashPassword(password);
      const hash2 = await encryption.hashPassword(password);

      expect(hash1).not.toBe(hash2);

      // Both should still verify
      expect(await encryption.verifyPassword(password, hash1)).toBe(true);
      expect(await encryption.verifyPassword(password, hash2)).toBe(true);
    });

    it('should return false for invalid hash format', async () => {
      expect(await encryption.verifyPassword('password', 'invalid')).toBe(false);
      expect(await encryption.verifyPassword('password', '')).toBe(false);
    });
  });

  describe('HMAC', () => {
    it('should create HMAC signatures', () => {
      const signature = encryption.createHmac('data', 'secret');
      expect(signature).toMatch(/^[a-f0-9]{64}$/); // SHA-256 = 64 hex chars
    });

    it('should verify HMAC signatures', () => {
      const data = 'important-data';
      const secret = 'shared-secret';
      const signature = encryption.createHmac(data, secret);

      expect(encryption.verifyHmac(data, signature, secret)).toBe(true);
      expect(encryption.verifyHmac('tampered-data', signature, secret)).toBe(false);
      expect(encryption.verifyHmac(data, 'wrong-signature'.padEnd(64, '0'), secret)).toBe(false);
    });

    it('should produce consistent signatures', () => {
      const sig1 = encryption.createHmac('data', 'secret');
      const sig2 = encryption.createHmac('data', 'secret');
      expect(sig1).toBe(sig2);
    });
  });

  describe('Hashing', () => {
    it('should hash data with SHA-256', () => {
      const hash = encryption.hash('test');
      expect(hash).toMatch(/^[a-f0-9]{64}$/);
    });

    it('should produce consistent hashes', () => {
      expect(encryption.hash('data')).toBe(encryption.hash('data'));
    });

    it('should produce different hashes for different data', () => {
      expect(encryption.hash('data1')).not.toBe(encryption.hash('data2'));
    });
  });

  describe('UUID Generation', () => {
    it('should generate valid UUIDs', () => {
      const uuid = encryption.uuid();
      expect(uuid).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
      );
    });

    it('should generate unique UUIDs', () => {
      const uuids = new Set();
      for (let i = 0; i < 100; i++) {
        uuids.add(encryption.uuid());
      }
      expect(uuids.size).toBe(100);
    });
  });

  describe('Field Encryption', () => {
    it('should encrypt fields for database storage', () => {
      const value = 'sensitive-data';
      const encrypted = encryption.encryptField(value);

      expect(encrypted).toMatch(/^ENC:/);
      expect(encryption.isEncrypted(encrypted)).toBe(true);
    });

    it('should decrypt fields from database', () => {
      const value = 'sensitive-data';
      const encrypted = encryption.encryptField(value);
      const decrypted = encryption.decryptField(encrypted);

      expect(decrypted).toBe(value);
    });

    it('should pass through non-encrypted values', () => {
      expect(encryption.decryptField('plain-text')).toBe('plain-text');
      expect(encryption.decryptField('')).toBe('');
    });

    it('should handle empty values', () => {
      expect(encryption.encryptField('')).toBe('');
    });
  });

  describe('Data Masking', () => {
    it('should mask data showing last characters', () => {
      expect(encryption.mask('1234567890')).toBe('***7890');
      expect(encryption.mask('secret', 2)).toBe('***et');
    });

    it('should handle short strings', () => {
      expect(encryption.mask('ab')).toBe('***');
      expect(encryption.mask('')).toBe('***');
    });
  });

  describe('Secure Compare', () => {
    it('should return true for equal strings', () => {
      expect(encryption.secureCompare('abc', 'abc')).toBe(true);
    });

    it('should return false for different strings', () => {
      expect(encryption.secureCompare('abc', 'abd')).toBe(false);
      expect(encryption.secureCompare('abc', 'abcd')).toBe(false);
    });

    it('should return false for different lengths', () => {
      expect(encryption.secureCompare('short', 'longer')).toBe(false);
    });
  });
});
