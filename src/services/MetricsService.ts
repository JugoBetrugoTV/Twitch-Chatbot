/**
 * Metrics Service
 *
 * Prometheus-compatible metrics collection
 * Features:
 * - Counter, Gauge, Histogram metrics
 * - Labels support
 * - Prometheus export format
 * - HTTP endpoint
 */

import { Logger } from '../utils/logger';
import * as http from 'http';

export type MetricType = 'counter' | 'gauge' | 'histogram';

export interface MetricConfig {
  name: string;
  help: string;
  type: MetricType;
  labels?: string[];
  buckets?: number[]; // For histograms
}

export interface MetricValue {
  value: number;
  labels: Record<string, string>;
  timestamp?: number;
}

export interface Metric {
  config: MetricConfig;
  values: Map<string, MetricValue>;
}

export interface MetricsSettings {
  enabled: boolean;
  port: number;
  path: string;
  prefix: string;
  defaultLabels: Record<string, string>;
  collectInterval: number;
}

const DEFAULT_SETTINGS: MetricsSettings = {
  enabled: true,
  port: 9090,
  path: '/metrics',
  prefix: 'streamcore_',
  defaultLabels: {},
  collectInterval: 15000,
};

const DEFAULT_HISTOGRAM_BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];

export class MetricsService {
  private log = new Logger('MetricsService');
  private settings: MetricsSettings;
  private metrics: Map<string, Metric> = new Map();
  private server: http.Server | null = null;
  private collectInterval: ReturnType<typeof setInterval> | null = null;
  private collectors: (() => void)[] = [];

  constructor(settings: Partial<MetricsSettings> = {}) {
    this.settings = { ...DEFAULT_SETTINGS, ...settings };

    if (this.settings.enabled) {
      this.startServer();
      this.startCollecting();
    }

    this.registerDefaultMetrics();
    this.log.info('Metrics Service initialized');
  }

  private startServer(): void {
    this.server = http.createServer((req, res) => {
      if (req.url === this.settings.path && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end(this.export());
      } else {
        res.writeHead(404);
        res.end('Not found');
      }
    });

    this.server.listen(this.settings.port, () => {
      this.log.info(`Metrics server started on port ${this.settings.port}`);
    });
  }

  private startCollecting(): void {
    this.collectInterval = setInterval(() => {
      for (const collector of this.collectors) {
        try {
          collector();
        } catch (error) {
          this.log.error(`Collector error: ${error}`);
        }
      }
    }, this.settings.collectInterval);
  }

  destroy(): void {
    if (this.collectInterval) {
      clearInterval(this.collectInterval);
      this.collectInterval = null;
    }

    if (this.server) {
      this.server.close();
      this.server = null;
    }
  }

  private registerDefaultMetrics(): void {
    // Process metrics
    this.register({
      name: 'process_uptime_seconds',
      help: 'Process uptime in seconds',
      type: 'gauge',
    });

    this.register({
      name: 'nodejs_heap_size_bytes',
      help: 'Node.js heap size in bytes',
      type: 'gauge',
      labels: ['type'],
    });

    // Add collector for default metrics
    this.addCollector(() => {
      this.set('process_uptime_seconds', process.uptime());

      const mem = process.memoryUsage();
      this.set('nodejs_heap_size_bytes', mem.heapUsed, { type: 'used' });
      this.set('nodejs_heap_size_bytes', mem.heapTotal, { type: 'total' });
    });
  }

  /**
   * Register a new metric
   */
  register(config: MetricConfig): void {
    const fullName = this.settings.prefix + config.name;
    this.metrics.set(fullName, {
      config: { ...config, name: fullName },
      values: new Map(),
    });
    this.log.debug(`Registered metric: ${fullName}`);
  }

  /**
   * Get labels key for storage
   */
  private getLabelsKey(labels: Record<string, string> = {}): string {
    const allLabels = { ...this.settings.defaultLabels, ...labels };
    return Object.entries(allLabels)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}="${v}"`)
      .join(',');
  }

  /**
   * Increment a counter
   */
  inc(name: string, value: number = 1, labels: Record<string, string> = {}): void {
    const fullName = this.settings.prefix + name;
    const metric = this.metrics.get(fullName);

    if (!metric || metric.config.type !== 'counter') {
      return;
    }

    const key = this.getLabelsKey(labels);
    const current = metric.values.get(key);

    if (current) {
      current.value += value;
    } else {
      metric.values.set(key, { value, labels, timestamp: Date.now() });
    }
  }

  /**
   * Set a gauge value
   */
  set(name: string, value: number, labels: Record<string, string> = {}): void {
    const fullName = this.settings.prefix + name;
    const metric = this.metrics.get(fullName);

    if (!metric || metric.config.type !== 'gauge') {
      return;
    }

    const key = this.getLabelsKey(labels);
    metric.values.set(key, { value, labels, timestamp: Date.now() });
  }

  /**
   * Observe a histogram value
   */
  observe(name: string, value: number, labels: Record<string, string> = {}): void {
    const fullName = this.settings.prefix + name;
    const metric = this.metrics.get(fullName);

    if (!metric || metric.config.type !== 'histogram') {
      return;
    }

    const buckets = metric.config.buckets || DEFAULT_HISTOGRAM_BUCKETS;
    const key = this.getLabelsKey(labels);

    // Get or create histogram data
    let histData = metric.values.get(key);
    if (!histData) {
      histData = {
        value: 0,
        labels: { ...labels, _sum: '0', _count: '0' },
        timestamp: Date.now(),
      };
      metric.values.set(key, histData);

      // Initialize buckets
      for (const bucket of buckets) {
        const bucketKey = this.getLabelsKey({ ...labels, le: bucket.toString() });
        metric.values.set(bucketKey, { value: 0, labels: { ...labels, le: bucket.toString() } });
      }
      const infKey = this.getLabelsKey({ ...labels, le: '+Inf' });
      metric.values.set(infKey, { value: 0, labels: { ...labels, le: '+Inf' } });
    }

    // Update sum and count
    const sumKey = this.getLabelsKey({ ...labels, _type: 'sum' });
    const countKey = this.getLabelsKey({ ...labels, _type: 'count' });

    const sum = metric.values.get(sumKey) || { value: 0, labels: { ...labels, _type: 'sum' } };
    const count = metric.values.get(countKey) || { value: 0, labels: { ...labels, _type: 'count' } };

    sum.value += value;
    count.value += 1;

    metric.values.set(sumKey, sum);
    metric.values.set(countKey, count);

    // Update buckets
    for (const bucket of buckets) {
      if (value <= bucket) {
        const bucketKey = this.getLabelsKey({ ...labels, le: bucket.toString() });
        const bucketVal = metric.values.get(bucketKey);
        if (bucketVal) {
          bucketVal.value += 1;
        }
      }
    }

    // Always increment +Inf
    const infKey = this.getLabelsKey({ ...labels, le: '+Inf' });
    const infVal = metric.values.get(infKey);
    if (infVal) {
      infVal.value += 1;
    }
  }

  /**
   * Time a function execution
   */
  async time<T>(name: string, fn: () => Promise<T>, labels: Record<string, string> = {}): Promise<T> {
    const start = process.hrtime.bigint();
    try {
      return await fn();
    } finally {
      const end = process.hrtime.bigint();
      const duration = Number(end - start) / 1e9; // Convert to seconds
      this.observe(name, duration, labels);
    }
  }

  /**
   * Add a collector function
   */
  addCollector(collector: () => void): void {
    this.collectors.push(collector);
  }

  /**
   * Get metric value
   */
  getValue(name: string, labels: Record<string, string> = {}): number | undefined {
    const fullName = this.settings.prefix + name;
    const metric = this.metrics.get(fullName);

    if (!metric) {
      return undefined;
    }

    const key = this.getLabelsKey(labels);
    return metric.values.get(key)?.value;
  }

  /**
   * Reset a metric
   */
  reset(name: string): void {
    const fullName = this.settings.prefix + name;
    const metric = this.metrics.get(fullName);

    if (metric) {
      metric.values.clear();
    }
  }

  /**
   * Export metrics in Prometheus format
   */
  export(): string {
    const lines: string[] = [];

    for (const metric of this.metrics.values()) {
      // Add HELP and TYPE
      lines.push(`# HELP ${metric.config.name} ${metric.config.help}`);
      lines.push(`# TYPE ${metric.config.name} ${metric.config.type}`);

      // Add values
      for (const [key, data] of metric.values) {
        const labelsStr = key ? `{${key}}` : '';
        lines.push(`${metric.config.name}${labelsStr} ${data.value}`);
      }

      lines.push('');
    }

    return lines.join('\n');
  }

  /**
   * Get all metrics as object
   */
  getAll(): Record<string, any> {
    const result: Record<string, any> = {};

    for (const [name, metric] of this.metrics) {
      result[name] = {
        type: metric.config.type,
        help: metric.config.help,
        values: Object.fromEntries(metric.values),
      };
    }

    return result;
  }
}

// Singleton instance
let metricsServiceInstance: MetricsService | null = null;

export function getMetricsService(settings?: Partial<MetricsSettings>): MetricsService {
  if (!metricsServiceInstance) {
    metricsServiceInstance = new MetricsService(settings);
  }
  return metricsServiceInstance;
}

// Pre-defined metric helpers
export function createStreamMetrics(metrics: MetricsService): void {
  // Stream metrics
  metrics.register({ name: 'stream_viewers', help: 'Current viewer count', type: 'gauge' });
  metrics.register({ name: 'stream_followers_total', help: 'Total follower count', type: 'gauge' });
  metrics.register({ name: 'stream_subscribers_total', help: 'Total subscriber count', type: 'gauge' });

  // Chat metrics
  metrics.register({ name: 'chat_messages_total', help: 'Total chat messages', type: 'counter' });
  metrics.register({ name: 'commands_executed_total', help: 'Total commands executed', type: 'counter', labels: ['command'] });

  // Event metrics
  metrics.register({ name: 'events_total', help: 'Total events', type: 'counter', labels: ['type'] });

  // Performance metrics
  metrics.register({ name: 'command_duration_seconds', help: 'Command execution duration', type: 'histogram', labels: ['command'] });
  metrics.register({ name: 'api_request_duration_seconds', help: 'API request duration', type: 'histogram', labels: ['endpoint'] });
}
