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
  initDatabase,
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
  BackupConfig,
  getBackupService,
  createBackupService,
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

// =============================================================================
// RATE LIMITER SERVICE
// =============================================================================
export {
  RateLimiterService,
  RateLimitConfig,
  RateLimitBucket,
  getRateLimiter,
  TwitchAPILimiter,
} from './RateLimiterService';

// =============================================================================
// QUEUE SERVICE
// =============================================================================
export {
  Queue,
  QueueService,
  QueueItem,
  QueueConfig,
  QueueStats,
  getQueueService,
} from './QueueService';

// =============================================================================
// NOTIFICATION SERVICE
// =============================================================================
export {
  NotificationService,
  Notification,
  NotificationAction,
  NotificationSettings,
  getNotificationService,
} from './NotificationService';

// =============================================================================
// METRICS SERVICE
// =============================================================================
export {
  MetricsService,
  MetricType,
  MetricConfig,
  MetricsSettings,
  getMetricsService,
  createStreamMetrics,
} from './MetricsService';

// =============================================================================
// ENCRYPTION SERVICE
// =============================================================================
export {
  EncryptionService,
  EncryptedData,
  EncryptionSettings,
  getEncryptionService,
  initializeEncryption,
} from './EncryptionService';

// =============================================================================
// INPUT VALIDATOR SERVICE
// =============================================================================
export {
  InputValidator,
  ValidationResult as InputValidationResult,
  ValidationRule,
  ValidationSchema,
  ValidationPatterns,
  Patterns,
  getValidator,
} from './InputValidator';

// =============================================================================
// HEALTH SERVICE
// =============================================================================
export {
  HealthService,
  HealthStatus,
  HealthCheck,
  SystemInfo,
  HealthCheckConfig,
  getHealthService,
  formatBytes,
  formatUptime,
} from './HealthService';

// =============================================================================
// AUDIT LOGGER SERVICE
// =============================================================================
export {
  AuditLogger,
  AuditEntry,
  AuditEventType,
  AuditSeverity,
  AuditConfig,
  AuditQuery,
  getAuditLogger,
  createAuditLogger,
} from './AuditLogger';
