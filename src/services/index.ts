/**
 * StreamCore Services
 *
 * Central exports for all service modules.
 */

// =============================================================================
// DATABASE SERVICE
// =============================================================================
export {
  DatabaseService,
  getDatabase,
  DBUser,
  DBCommand,
  DBTimer,
  DBSettings,
  DBEvent,
} from './Database';

// =============================================================================
// CACHE SERVICE
// =============================================================================
export {
  CacheService,
  UserCache,
  getCache,
  getUserCache,
} from './CacheService';

// =============================================================================
// INTERNATIONALIZATION
// =============================================================================
export {
  I18nService,
  getI18n,
  t,
} from './i18n';

// =============================================================================
// BACKUP SERVICE
// =============================================================================
export {
  BackupService,
} from './Backup';

// =============================================================================
// REST API SERVICE
// =============================================================================
export {
  RestAPIService,
  RestAPIConfig,
  getRestAPI,
  createRestAPI,
} from './RestAPI';

// =============================================================================
// WEBHOOK SERVICE
// =============================================================================
export {
  WebhookService,
  Webhook,
  WebhookPayload,
  getWebhookService,
} from './WebhookService';

// =============================================================================
// CONFIG VALIDATOR
// =============================================================================
export {
  ConfigValidator,
  ConfigSchema,
  ConfigField,
  ValidationResult,
  STREAMCORE_CONFIG_SCHEMA,
  getConfigValidator,
  validateConfig,
  validateConfigOrExit,
} from './ConfigValidator';
