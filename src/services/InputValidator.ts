/**
 * Input Validator Service
 *
 * Comprehensive input validation for security and data integrity
 * Features:
 * - Type validation
 * - String sanitization
 * - Pattern matching
 * - Range checking
 * - Custom validators
 */

import { Logger } from '../utils/logger';

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  sanitized?: any;
}

export interface ValidationRule {
  type?: 'string' | 'number' | 'boolean' | 'array' | 'object' | 'email' | 'url';
  required?: boolean;
  minLength?: number;
  maxLength?: number;
  min?: number;
  max?: number;
  pattern?: RegExp;
  enum?: any[];
  custom?: (value: any) => string | null; // Returns error message or null
  sanitize?: boolean;
  trim?: boolean;
  toLowerCase?: boolean;
  toUpperCase?: boolean;
}

export interface ValidationSchema {
  [field: string]: ValidationRule;
}

// Common patterns
export const Patterns = {
  USERNAME: /^[a-zA-Z0-9_]{3,25}$/,
  TWITCH_USERNAME: /^[a-zA-Z0-9_]{4,25}$/,
  EMAIL: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
  URL: /^https?:\/\/[^\s]+$/,
  ALPHANUMERIC: /^[a-zA-Z0-9]+$/,
  SLUG: /^[a-z0-9-]+$/,
  HEX_COLOR: /^#[0-9A-Fa-f]{6}$/,
  UUID: /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  COMMAND_NAME: /^![a-zA-Z][a-zA-Z0-9_-]{0,24}$/,
  NO_SPECIAL_CHARS: /^[^<>&"'`\\]+$/,
  SAFE_HTML: /^[^<>]+$/,
};

// Dangerous patterns to reject
const DANGEROUS_PATTERNS = [
  /<script/i,
  /javascript:/i,
  /data:/i,
  /on\w+\s*=/i, // onclick, onerror, etc.
  /eval\s*\(/i,
  /expression\s*\(/i,
  /url\s*\(/i,
];

// SQL injection patterns
const SQL_INJECTION_PATTERNS = [
  /(\b(SELECT|INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|EXEC|UNION)\b)/i,
  /('|"|;|--|\*|\/\*|\*\/)/,
  /(\bOR\b|\bAND\b)\s*\d+\s*=\s*\d+/i,
];

export class InputValidator {
  private log = new Logger('InputValidator');

  /**
   * Validate a single value against rules
   */
  validate(value: any, rules: ValidationRule): ValidationResult {
    const errors: string[] = [];
    let sanitized = value;

    // Required check
    if (rules.required && (value === undefined || value === null || value === '')) {
      return { valid: false, errors: ['Field is required'] };
    }

    // Skip further validation if empty and not required
    if (value === undefined || value === null || value === '') {
      return { valid: true, errors: [], sanitized: value };
    }

    // Type validation
    if (rules.type) {
      const typeError = this.validateType(value, rules.type);
      if (typeError) {
        errors.push(typeError);
        return { valid: false, errors };
      }
    }

    // String-specific validations
    if (typeof value === 'string') {
      // Sanitization
      if (rules.trim !== false) {
        sanitized = value.trim();
      }
      if (rules.toLowerCase) {
        sanitized = sanitized.toLowerCase();
      }
      if (rules.toUpperCase) {
        sanitized = sanitized.toUpperCase();
      }
      if (rules.sanitize) {
        sanitized = this.sanitizeString(sanitized);
      }

      // Length checks
      if (rules.minLength !== undefined && sanitized.length < rules.minLength) {
        errors.push(`Must be at least ${rules.minLength} characters`);
      }
      if (rules.maxLength !== undefined && sanitized.length > rules.maxLength) {
        errors.push(`Must be at most ${rules.maxLength} characters`);
      }

      // Pattern check
      if (rules.pattern && !rules.pattern.test(sanitized)) {
        errors.push('Invalid format');
      }
    }

    // Number-specific validations
    if (typeof value === 'number') {
      if (rules.min !== undefined && value < rules.min) {
        errors.push(`Must be at least ${rules.min}`);
      }
      if (rules.max !== undefined && value > rules.max) {
        errors.push(`Must be at most ${rules.max}`);
      }
    }

    // Array validation
    if (Array.isArray(value)) {
      if (rules.minLength !== undefined && value.length < rules.minLength) {
        errors.push(`Must have at least ${rules.minLength} items`);
      }
      if (rules.maxLength !== undefined && value.length > rules.maxLength) {
        errors.push(`Must have at most ${rules.maxLength} items`);
      }
    }

    // Enum check
    if (rules.enum && !rules.enum.includes(sanitized)) {
      errors.push(`Must be one of: ${rules.enum.join(', ')}`);
    }

    // Custom validator
    if (rules.custom) {
      const customError = rules.custom(sanitized);
      if (customError) {
        errors.push(customError);
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      sanitized,
    };
  }

  /**
   * Validate an object against a schema
   */
  validateSchema(data: Record<string, any>, schema: ValidationSchema): ValidationResult {
    const errors: string[] = [];
    const sanitized: Record<string, any> = {};

    for (const [field, rules] of Object.entries(schema)) {
      const result = this.validate(data[field], rules);
      if (!result.valid) {
        errors.push(...result.errors.map(e => `${field}: ${e}`));
      } else {
        sanitized[field] = result.sanitized;
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      sanitized,
    };
  }

  /**
   * Validate type
   */
  private validateType(value: any, type: string): string | null {
    switch (type) {
      case 'string':
        if (typeof value !== 'string') return 'Must be a string';
        break;
      case 'number':
        if (typeof value !== 'number' || isNaN(value)) return 'Must be a number';
        break;
      case 'boolean':
        if (typeof value !== 'boolean') return 'Must be a boolean';
        break;
      case 'array':
        if (!Array.isArray(value)) return 'Must be an array';
        break;
      case 'object':
        if (typeof value !== 'object' || value === null || Array.isArray(value)) {
          return 'Must be an object';
        }
        break;
      case 'email':
        if (typeof value !== 'string' || !Patterns.EMAIL.test(value)) {
          return 'Must be a valid email address';
        }
        break;
      case 'url':
        if (typeof value !== 'string' || !Patterns.URL.test(value)) {
          return 'Must be a valid URL';
        }
        break;
    }
    return null;
  }

  /**
   * Sanitize string for safe use
   */
  sanitizeString(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#x27;')
      .replace(/`/g, '&#x60;');
  }

  /**
   * Check for XSS patterns
   */
  containsXSS(str: string): boolean {
    return DANGEROUS_PATTERNS.some(pattern => pattern.test(str));
  }

  /**
   * Check for SQL injection patterns
   */
  containsSQLInjection(str: string): boolean {
    return SQL_INJECTION_PATTERNS.some(pattern => pattern.test(str));
  }

  /**
   * Validate and sanitize user input (general purpose)
   */
  sanitizeUserInput(input: string, maxLength: number = 500): ValidationResult {
    if (typeof input !== 'string') {
      return { valid: false, errors: ['Input must be a string'] };
    }

    const trimmed = input.trim();
    const errors: string[] = [];

    if (trimmed.length > maxLength) {
      errors.push(`Input exceeds maximum length of ${maxLength}`);
    }

    if (this.containsXSS(trimmed)) {
      errors.push('Input contains potentially dangerous content');
    }

    return {
      valid: errors.length === 0,
      errors,
      sanitized: this.sanitizeString(trimmed).slice(0, maxLength),
    };
  }

  /**
   * Validate Twitch username
   */
  validateTwitchUsername(username: string): ValidationResult {
    return this.validate(username, {
      type: 'string',
      required: true,
      pattern: Patterns.TWITCH_USERNAME,
      trim: true,
      toLowerCase: true,
    });
  }

  /**
   * Validate command name
   */
  validateCommandName(name: string): ValidationResult {
    return this.validate(name, {
      type: 'string',
      required: true,
      pattern: Patterns.COMMAND_NAME,
      trim: true,
      toLowerCase: true,
    });
  }

  /**
   * Validate positive integer
   */
  validatePositiveInt(value: any): ValidationResult {
    const num = typeof value === 'string' ? parseInt(value, 10) : value;

    if (typeof num !== 'number' || isNaN(num)) {
      return { valid: false, errors: ['Must be a number'] };
    }

    if (!Number.isInteger(num)) {
      return { valid: false, errors: ['Must be an integer'] };
    }

    if (num < 0) {
      return { valid: false, errors: ['Must be positive'] };
    }

    return { valid: true, errors: [], sanitized: num };
  }

  /**
   * Validate points amount
   */
  validatePoints(points: any, min: number = 0, max: number = 1000000): ValidationResult {
    const result = this.validatePositiveInt(points);
    if (!result.valid) return result;

    if (result.sanitized < min || result.sanitized > max) {
      return { valid: false, errors: [`Must be between ${min} and ${max}`] };
    }

    return result;
  }

  /**
   * Validate duration string (e.g., "5m", "2h", "1d")
   */
  validateDuration(duration: string): ValidationResult {
    const pattern = /^(\d+)(s|m|h|d|w)$/;
    const match = duration.trim().toLowerCase().match(pattern);

    if (!match) {
      return { valid: false, errors: ['Invalid duration format. Use: 5s, 10m, 2h, 1d, 1w'] };
    }

    const value = parseInt(match[1], 10);
    const unit = match[2];
    const multipliers: Record<string, number> = {
      s: 1,
      m: 60,
      h: 3600,
      d: 86400,
      w: 604800,
    };

    const seconds = value * multipliers[unit];

    return { valid: true, errors: [], sanitized: seconds };
  }

  /**
   * Validate JSON string
   */
  validateJSON(str: string): ValidationResult {
    try {
      const parsed = JSON.parse(str);
      return { valid: true, errors: [], sanitized: parsed };
    } catch (e) {
      return { valid: false, errors: ['Invalid JSON'] };
    }
  }

  /**
   * Validate URL is safe (not javascript:, data:, etc.)
   */
  validateSafeURL(url: string): ValidationResult {
    if (typeof url !== 'string') {
      return { valid: false, errors: ['URL must be a string'] };
    }

    const trimmed = url.trim();

    if (!/^https?:\/\//i.test(trimmed)) {
      return { valid: false, errors: ['URL must start with http:// or https://'] };
    }

    if (this.containsXSS(trimmed)) {
      return { valid: false, errors: ['URL contains potentially dangerous content'] };
    }

    try {
      new URL(trimmed);
    } catch {
      return { valid: false, errors: ['Invalid URL format'] };
    }

    return { valid: true, errors: [], sanitized: trimmed };
  }
}

// Singleton instance
let validatorInstance: InputValidator | null = null;

export function getValidator(): InputValidator {
  if (!validatorInstance) {
    validatorInstance = new InputValidator();
  }
  return validatorInstance;
}

// Export patterns for external use
export { Patterns as ValidationPatterns };
