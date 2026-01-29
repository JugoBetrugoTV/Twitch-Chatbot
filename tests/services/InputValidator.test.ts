/**
 * InputValidator Tests
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

import { InputValidator, Patterns } from '../../src/services/InputValidator';

describe('InputValidator', () => {
  let validator: InputValidator;

  beforeEach(() => {
    validator = new InputValidator();
  });

  describe('Basic Validation', () => {
    it('should validate required fields', () => {
      const result = validator.validate('', { required: true });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Field is required');
    });

    it('should pass non-required empty fields', () => {
      const result = validator.validate('', { required: false });
      expect(result.valid).toBe(true);
    });

    it('should validate string type', () => {
      expect(validator.validate('hello', { type: 'string' }).valid).toBe(true);
      expect(validator.validate(123, { type: 'string' }).valid).toBe(false);
    });

    it('should validate number type', () => {
      expect(validator.validate(123, { type: 'number' }).valid).toBe(true);
      expect(validator.validate('abc', { type: 'number' }).valid).toBe(false);
      expect(validator.validate(NaN, { type: 'number' }).valid).toBe(false);
    });

    it('should validate boolean type', () => {
      expect(validator.validate(true, { type: 'boolean' }).valid).toBe(true);
      expect(validator.validate(false, { type: 'boolean' }).valid).toBe(true);
      expect(validator.validate('true', { type: 'boolean' }).valid).toBe(false);
    });

    it('should validate array type', () => {
      expect(validator.validate([1, 2, 3], { type: 'array' }).valid).toBe(true);
      expect(validator.validate('not array', { type: 'array' }).valid).toBe(false);
    });

    it('should validate object type', () => {
      expect(validator.validate({ foo: 'bar' }, { type: 'object' }).valid).toBe(true);
      expect(validator.validate([1, 2], { type: 'object' }).valid).toBe(false);
      expect(validator.validate(null, { type: 'object' }).valid).toBe(false);
    });

    it('should validate email type', () => {
      expect(validator.validate('test@example.com', { type: 'email' }).valid).toBe(true);
      expect(validator.validate('invalid-email', { type: 'email' }).valid).toBe(false);
    });

    it('should validate URL type', () => {
      expect(validator.validate('https://example.com', { type: 'url' }).valid).toBe(true);
      expect(validator.validate('not-a-url', { type: 'url' }).valid).toBe(false);
    });
  });

  describe('String Validation', () => {
    it('should validate minimum length', () => {
      const result = validator.validate('ab', { minLength: 3 });
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('at least 3 characters');
    });

    it('should validate maximum length', () => {
      const result = validator.validate('hello world', { maxLength: 5 });
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('at most 5 characters');
    });

    it('should trim strings by default', () => {
      const result = validator.validate('  hello  ', { type: 'string' });
      expect(result.sanitized).toBe('hello');
    });

    it('should not trim when disabled', () => {
      const result = validator.validate('  hello  ', { trim: false });
      expect(result.sanitized).toBe('  hello  ');
    });

    it('should convert to lowercase', () => {
      const result = validator.validate('HELLO', { toLowerCase: true });
      expect(result.sanitized).toBe('hello');
    });

    it('should convert to uppercase', () => {
      const result = validator.validate('hello', { toUpperCase: true });
      expect(result.sanitized).toBe('HELLO');
    });

    it('should validate against pattern', () => {
      expect(validator.validate('abc123', { pattern: /^[a-z0-9]+$/ }).valid).toBe(true);
      expect(validator.validate('ABC!@#', { pattern: /^[a-z0-9]+$/ }).valid).toBe(false);
    });
  });

  describe('Number Validation', () => {
    it('should validate minimum value', () => {
      expect(validator.validate(5, { min: 10 }).valid).toBe(false);
      expect(validator.validate(15, { min: 10 }).valid).toBe(true);
    });

    it('should validate maximum value', () => {
      expect(validator.validate(15, { max: 10 }).valid).toBe(false);
      expect(validator.validate(5, { max: 10 }).valid).toBe(true);
    });

    it('should validate range', () => {
      expect(validator.validate(5, { min: 1, max: 10 }).valid).toBe(true);
      expect(validator.validate(0, { min: 1, max: 10 }).valid).toBe(false);
      expect(validator.validate(11, { min: 1, max: 10 }).valid).toBe(false);
    });
  });

  describe('Array Validation', () => {
    it('should validate array length', () => {
      expect(validator.validate([1, 2], { minLength: 3 }).valid).toBe(false);
      expect(validator.validate([1, 2, 3, 4, 5], { maxLength: 3 }).valid).toBe(false);
      expect(validator.validate([1, 2, 3], { minLength: 2, maxLength: 5 }).valid).toBe(true);
    });
  });

  describe('Enum Validation', () => {
    it('should validate against enum values', () => {
      const rule = { enum: ['red', 'green', 'blue'] };
      expect(validator.validate('red', rule).valid).toBe(true);
      expect(validator.validate('yellow', rule).valid).toBe(false);
    });
  });

  describe('Custom Validation', () => {
    it('should support custom validators', () => {
      const customRule = {
        custom: (value: any) => (value % 2 === 0 ? null : 'Must be even'),
      };

      expect(validator.validate(4, customRule).valid).toBe(true);
      expect(validator.validate(3, customRule).valid).toBe(false);
    });
  });

  describe('Schema Validation', () => {
    it('should validate against schema', () => {
      const schema = {
        username: { type: 'string' as const, required: true, minLength: 3 },
        age: { type: 'number' as const, min: 0, max: 150 },
        email: { type: 'email' as const },
      };

      const validData = { username: 'john', age: 25, email: 'john@test.com' };
      expect(validator.validateSchema(validData, schema).valid).toBe(true);

      const invalidData = { username: 'ab', age: -5, email: 'invalid' };
      const result = validator.validateSchema(invalidData, schema);
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should return sanitized data', () => {
      const schema = {
        name: { type: 'string' as const, trim: true, toLowerCase: true },
      };

      const result = validator.validateSchema({ name: '  JOHN  ' }, schema);
      expect(result.sanitized.name).toBe('john');
    });
  });

  describe('XSS Detection', () => {
    it('should detect script tags', () => {
      expect(validator.containsXSS('<script>alert(1)</script>')).toBe(true);
      expect(validator.containsXSS('<SCRIPT>alert(1)</SCRIPT>')).toBe(true);
    });

    it('should detect javascript: protocol', () => {
      expect(validator.containsXSS('javascript:alert(1)')).toBe(true);
    });

    it('should detect event handlers', () => {
      expect(validator.containsXSS('onclick=alert(1)')).toBe(true);
      expect(validator.containsXSS('onerror = alert')).toBe(true);
    });

    it('should not flag safe strings', () => {
      expect(validator.containsXSS('Hello World!')).toBe(false);
      expect(validator.containsXSS('Normal text with numbers 123')).toBe(false);
    });
  });

  describe('SQL Injection Detection', () => {
    it('should detect SQL keywords', () => {
      expect(validator.containsSQLInjection("'; DROP TABLE users; --")).toBe(true);
      expect(validator.containsSQLInjection('SELECT * FROM users')).toBe(true);
      expect(validator.containsSQLInjection("' OR 1=1")).toBe(true);
    });

    it('should not flag safe strings', () => {
      expect(validator.containsSQLInjection('Normal username123')).toBe(false);
    });
  });

  describe('String Sanitization', () => {
    it('should escape HTML entities', () => {
      expect(validator.sanitizeString('<script>')).toBe('&lt;script&gt;');
      expect(validator.sanitizeString('a & b')).toBe('a &amp; b');
      expect(validator.sanitizeString('"quoted"')).toBe('&quot;quoted&quot;');
      expect(validator.sanitizeString("'quoted'")).toBe('&#x27;quoted&#x27;');
    });
  });

  describe('Twitch Username Validation', () => {
    it('should validate correct usernames', () => {
      expect(validator.validateTwitchUsername('nightbot').valid).toBe(true);
      expect(validator.validateTwitchUsername('user_123').valid).toBe(true);
    });

    it('should reject invalid usernames', () => {
      expect(validator.validateTwitchUsername('ab').valid).toBe(false); // too short
      expect(validator.validateTwitchUsername('user name').valid).toBe(false); // space
      expect(validator.validateTwitchUsername('user@name').valid).toBe(false); // special char
    });
  });

  describe('Command Name Validation', () => {
    it('should validate correct command names', () => {
      expect(validator.validateCommandName('!help').valid).toBe(true);
      expect(validator.validateCommandName('!song-request').valid).toBe(true);
      expect(validator.validateCommandName('!cmd_123').valid).toBe(true);
    });

    it('should reject invalid command names', () => {
      expect(validator.validateCommandName('help').valid).toBe(false); // no !
      expect(validator.validateCommandName('!123').valid).toBe(false); // starts with number
      expect(validator.validateCommandName('!').valid).toBe(false); // too short
    });
  });

  describe('Positive Integer Validation', () => {
    it('should validate positive integers', () => {
      expect(validator.validatePositiveInt(5).valid).toBe(true);
      expect(validator.validatePositiveInt(0).valid).toBe(true);
      expect(validator.validatePositiveInt('10').valid).toBe(true);
    });

    it('should reject invalid values', () => {
      expect(validator.validatePositiveInt(-5).valid).toBe(false);
      expect(validator.validatePositiveInt(3.5).valid).toBe(false);
      expect(validator.validatePositiveInt('abc').valid).toBe(false);
    });
  });

  describe('Points Validation', () => {
    it('should validate points within range', () => {
      expect(validator.validatePoints(100).valid).toBe(true);
      expect(validator.validatePoints(0).valid).toBe(true);
      expect(validator.validatePoints(1000000).valid).toBe(true);
    });

    it('should reject points outside range', () => {
      expect(validator.validatePoints(-1).valid).toBe(false);
      expect(validator.validatePoints(1000001).valid).toBe(false);
    });

    it('should accept custom range', () => {
      expect(validator.validatePoints(50, 0, 100).valid).toBe(true);
      expect(validator.validatePoints(150, 0, 100).valid).toBe(false);
    });
  });

  describe('Duration Validation', () => {
    it('should parse duration strings', () => {
      expect(validator.validateDuration('5s').sanitized).toBe(5);
      expect(validator.validateDuration('10m').sanitized).toBe(600);
      expect(validator.validateDuration('2h').sanitized).toBe(7200);
      expect(validator.validateDuration('1d').sanitized).toBe(86400);
      expect(validator.validateDuration('1w').sanitized).toBe(604800);
    });

    it('should reject invalid duration formats', () => {
      expect(validator.validateDuration('5').valid).toBe(false);
      expect(validator.validateDuration('minutes').valid).toBe(false);
      expect(validator.validateDuration('5x').valid).toBe(false);
    });
  });

  describe('JSON Validation', () => {
    it('should validate valid JSON', () => {
      const result = validator.validateJSON('{"foo": "bar"}');
      expect(result.valid).toBe(true);
      expect(result.sanitized).toEqual({ foo: 'bar' });
    });

    it('should reject invalid JSON', () => {
      expect(validator.validateJSON('not json').valid).toBe(false);
      expect(validator.validateJSON('{invalid}').valid).toBe(false);
    });
  });

  describe('Safe URL Validation', () => {
    it('should accept safe URLs', () => {
      expect(validator.validateSafeURL('https://example.com').valid).toBe(true);
      expect(validator.validateSafeURL('http://localhost:3000').valid).toBe(true);
    });

    it('should reject unsafe URLs', () => {
      expect(validator.validateSafeURL('javascript:alert(1)').valid).toBe(false);
      expect(validator.validateSafeURL('ftp://example.com').valid).toBe(false);
      expect(validator.validateSafeURL('not a url').valid).toBe(false);
    });
  });

  describe('Patterns', () => {
    it('should validate UUID pattern', () => {
      expect(Patterns.UUID.test('550e8400-e29b-41d4-a716-446655440000')).toBe(true);
      expect(Patterns.UUID.test('invalid-uuid')).toBe(false);
    });

    it('should validate hex color pattern', () => {
      expect(Patterns.HEX_COLOR.test('#FF0000')).toBe(true);
      expect(Patterns.HEX_COLOR.test('#ff0000')).toBe(true);
      expect(Patterns.HEX_COLOR.test('FF0000')).toBe(false);
    });
  });
});
