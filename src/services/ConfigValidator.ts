/**
 * Configuration Validator Service
 *
 * Validates environment variables and configuration
 * Features:
 * - Required env validation
 * - Type checking
 * - Default values
 * - Warnings for missing optional config
 */

import { Logger } from '../utils/logger';

export interface ConfigSchema {
  [key: string]: ConfigField;
}

export interface ConfigField {
  required: boolean;
  type: 'string' | 'number' | 'boolean' | 'url' | 'email';
  default?: any;
  description?: string;
  validator?: (value: any) => boolean;
  transform?: (value: string) => any;
  minLength?: number;
  maxLength?: number;
  min?: number;
  max?: number;
  pattern?: RegExp;
  enum?: any[];
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
  config: Record<string, any>;
}

export interface ValidationError {
  field: string;
  message: string;
  value?: any;
}

export interface ValidationWarning {
  field: string;
  message: string;
}

// Default schema for StreamCore
export const STREAMCORE_CONFIG_SCHEMA: ConfigSchema = {
  // Twitch Configuration
  TWITCH_USERNAME: {
    required: true,
    type: 'string',
    description: 'Twitch bot username',
    minLength: 1,
  },
  TWITCH_OAUTH: {
    required: true,
    type: 'string',
    description: 'Twitch OAuth token (oauth:xxxxx)',
    pattern: /^oauth:[a-z0-9]+$/i,
  },
  TWITCH_CHANNEL: {
    required: true,
    type: 'string',
    description: 'Twitch channel to join',
    minLength: 1,
  },
  TWITCH_CLIENT_ID: {
    required: false,
    type: 'string',
    description: 'Twitch API Client ID (for extended features)',
  },
  TWITCH_CLIENT_SECRET: {
    required: false,
    type: 'string',
    description: 'Twitch API Client Secret',
  },

  // Database
  DATABASE_PATH: {
    required: false,
    type: 'string',
    description: 'Path to SQLite database file',
    default: './data/bot.db',
  },

  // Web Dashboard
  WEB_PORT: {
    required: false,
    type: 'number',
    description: 'Web dashboard port',
    default: 3000,
    min: 1,
    max: 65535,
  },
  WEB_SECRET: {
    required: false,
    type: 'string',
    description: 'Secret for web authentication',
    minLength: 16,
  },

  // REST API
  API_PORT: {
    required: false,
    type: 'number',
    description: 'REST API port',
    default: 3001,
    min: 1,
    max: 65535,
  },
  API_KEY: {
    required: false,
    type: 'string',
    description: 'API key for authentication',
  },

  // External Services
  OPENAI_API_KEY: {
    required: false,
    type: 'string',
    description: 'OpenAI API key for AI chat features',
  },
  SPOTIFY_CLIENT_ID: {
    required: false,
    type: 'string',
    description: 'Spotify API Client ID',
  },
  SPOTIFY_CLIENT_SECRET: {
    required: false,
    type: 'string',
    description: 'Spotify API Client Secret',
  },
  DISCORD_WEBHOOK_URL: {
    required: false,
    type: 'url',
    description: 'Discord webhook URL for notifications',
  },
  OBS_WEBSOCKET_URL: {
    required: false,
    type: 'url',
    description: 'OBS WebSocket URL',
    default: 'ws://localhost:4455',
  },
  OBS_WEBSOCKET_PASSWORD: {
    required: false,
    type: 'string',
    description: 'OBS WebSocket password',
  },

  // Logging
  LOG_LEVEL: {
    required: false,
    type: 'string',
    description: 'Logging level',
    default: 'info',
    enum: ['debug', 'info', 'warn', 'error'],
  },

  // Bot Settings
  COMMAND_PREFIX: {
    required: false,
    type: 'string',
    description: 'Command prefix',
    default: '!',
    minLength: 1,
    maxLength: 3,
  },
  BOT_LANGUAGE: {
    required: false,
    type: 'string',
    description: 'Bot language',
    default: 'de',
    enum: ['de', 'en'],
  },
};

export class ConfigValidator {
  private log = new Logger('ConfigValidator');
  private schema: ConfigSchema;

  constructor(schema: ConfigSchema = STREAMCORE_CONFIG_SCHEMA) {
    this.schema = schema;
  }

  validate(env: Record<string, string | undefined> = process.env): ValidationResult {
    const errors: ValidationError[] = [];
    const warnings: ValidationWarning[] = [];
    const config: Record<string, any> = {};

    for (const [key, field] of Object.entries(this.schema)) {
      const rawValue = env[key];
      const hasValue = rawValue !== undefined && rawValue !== '';

      // Check required fields
      if (field.required && !hasValue) {
        errors.push({
          field: key,
          message: `Required field is missing${field.description ? `: ${field.description}` : ''}`,
        });
        continue;
      }

      // Use default value if not provided
      if (!hasValue && field.default !== undefined) {
        config[key] = field.default;
        continue;
      }

      // Skip optional fields without value
      if (!hasValue) {
        if (!field.required) {
          warnings.push({
            field: key,
            message: `Optional field not configured${field.description ? `: ${field.description}` : ''}`,
          });
        }
        continue;
      }

      // Validate and transform value
      const validationError = this.validateField(key, rawValue!, field);
      if (validationError) {
        errors.push(validationError);
        continue;
      }

      // Transform value
      config[key] = this.transformValue(rawValue!, field);
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
      config,
    };
  }

  private validateField(key: string, value: string, field: ConfigField): ValidationError | null {
    // Type validation
    switch (field.type) {
      case 'number':
        if (isNaN(Number(value))) {
          return { field: key, message: 'Must be a number', value };
        }
        const numValue = Number(value);
        if (field.min !== undefined && numValue < field.min) {
          return { field: key, message: `Must be at least ${field.min}`, value };
        }
        if (field.max !== undefined && numValue > field.max) {
          return { field: key, message: `Must be at most ${field.max}`, value };
        }
        break;

      case 'boolean':
        if (!['true', 'false', '1', '0', 'yes', 'no'].includes(value.toLowerCase())) {
          return { field: key, message: 'Must be a boolean (true/false)', value };
        }
        break;

      case 'url':
        try {
          new URL(value);
        } catch {
          return { field: key, message: 'Must be a valid URL', value };
        }
        break;

      case 'email':
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
          return { field: key, message: 'Must be a valid email', value };
        }
        break;
    }

    // Length validation
    if (field.minLength !== undefined && value.length < field.minLength) {
      return { field: key, message: `Must be at least ${field.minLength} characters`, value };
    }
    if (field.maxLength !== undefined && value.length > field.maxLength) {
      return { field: key, message: `Must be at most ${field.maxLength} characters`, value };
    }

    // Pattern validation
    if (field.pattern && !field.pattern.test(value)) {
      return { field: key, message: 'Invalid format', value };
    }

    // Enum validation
    if (field.enum && !field.enum.includes(value)) {
      return { field: key, message: `Must be one of: ${field.enum.join(', ')}`, value };
    }

    // Custom validation
    if (field.validator && !field.validator(value)) {
      return { field: key, message: 'Custom validation failed', value };
    }

    return null;
  }

  private transformValue(value: string, field: ConfigField): any {
    // Custom transform
    if (field.transform) {
      return field.transform(value);
    }

    // Type-based transform
    switch (field.type) {
      case 'number':
        return Number(value);
      case 'boolean':
        return ['true', '1', 'yes'].includes(value.toLowerCase());
      default:
        return value;
    }
  }

  printReport(result: ValidationResult): void {
    console.log('\n' + '='.repeat(60));
    console.log('  StreamCore Configuration Report');
    console.log('='.repeat(60) + '\n');

    if (result.valid) {
      console.log('✅ Configuration is valid!\n');
    } else {
      console.log('❌ Configuration has errors!\n');
    }

    if (result.errors.length > 0) {
      console.log('ERRORS:');
      console.log('-'.repeat(40));
      for (const error of result.errors) {
        console.log(`  ❌ ${error.field}: ${error.message}`);
      }
      console.log('');
    }

    if (result.warnings.length > 0) {
      console.log('WARNINGS:');
      console.log('-'.repeat(40));
      for (const warning of result.warnings) {
        console.log(`  ⚠️  ${warning.field}: ${warning.message}`);
      }
      console.log('');
    }

    console.log('CONFIGURED VALUES:');
    console.log('-'.repeat(40));
    for (const [key, value] of Object.entries(result.config)) {
      // Mask sensitive values
      const displayValue = this.isSensitive(key)
        ? '***' + String(value).slice(-4)
        : String(value);
      console.log(`  ${key}: ${displayValue}`);
    }

    console.log('\n' + '='.repeat(60) + '\n');
  }

  private isSensitive(key: string): boolean {
    const sensitivePatterns = [
      /oauth/i,
      /secret/i,
      /password/i,
      /key/i,
      /token/i,
    ];
    return sensitivePatterns.some((pattern) => pattern.test(key));
  }

  // Helper to generate .env.example
  generateEnvExample(): string {
    const lines: string[] = [
      '# StreamCore Bot Configuration',
      '# Copy this file to .env and fill in your values',
      '',
    ];

    const categories: Record<string, string[]> = {
      'Twitch': [],
      'Database': [],
      'Web': [],
      'API': [],
      'External Services': [],
      'Logging': [],
      'Bot Settings': [],
    };

    for (const [key, field] of Object.entries(this.schema)) {
      let category = 'Bot Settings';
      if (key.startsWith('TWITCH')) category = 'Twitch';
      else if (key.startsWith('DATABASE')) category = 'Database';
      else if (key.startsWith('WEB')) category = 'Web';
      else if (key.startsWith('API')) category = 'API';
      else if (key.startsWith('LOG')) category = 'Logging';
      else if (['OPENAI', 'SPOTIFY', 'DISCORD', 'OBS'].some((s) => key.startsWith(s))) {
        category = 'External Services';
      }

      const required = field.required ? '(required)' : '(optional)';
      const defaultVal = field.default ? ` [default: ${field.default}]` : '';
      const enumVals = field.enum ? ` [options: ${field.enum.join('|')}]` : '';

      categories[category].push(
        `# ${field.description || key} ${required}${defaultVal}${enumVals}`,
        `${key}=`,
        ''
      );
    }

    for (const [category, entries] of Object.entries(categories)) {
      if (entries.length > 0) {
        lines.push(`# ${'='.repeat(50)}`);
        lines.push(`# ${category}`);
        lines.push(`# ${'='.repeat(50)}`);
        lines.push('');
        lines.push(...entries);
      }
    }

    return lines.join('\n');
  }
}

// Singleton
let validatorInstance: ConfigValidator | null = null;

export function getConfigValidator(schema?: ConfigSchema): ConfigValidator {
  if (!validatorInstance) {
    validatorInstance = new ConfigValidator(schema);
  }
  return validatorInstance;
}

// Quick validation function
export function validateConfig(env: Record<string, string | undefined> = process.env): ValidationResult {
  return getConfigValidator().validate(env);
}

// Startup validation with exit on error
export function validateConfigOrExit(): Record<string, any> {
  const validator = getConfigValidator();
  const result = validator.validate();

  validator.printReport(result);

  if (!result.valid) {
    console.error('❌ Cannot start bot with invalid configuration.');
    console.error('   Please fix the errors above and try again.\n');
    process.exit(1);
  }

  return result.config;
}
