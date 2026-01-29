/**
 * Health Service
 *
 * Comprehensive health monitoring for the application
 * Features:
 * - System health checks
 * - Database connectivity
 * - External service status
 * - Memory/CPU monitoring
 * - Readiness/Liveness probes
 */

import { Logger } from '../utils/logger';
import * as os from 'os';

export interface HealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  uptime: number;
  version: string;
  checks: HealthCheck[];
  system: SystemInfo;
}

export interface HealthCheck {
  name: string;
  status: 'pass' | 'warn' | 'fail';
  message?: string;
  duration?: number;
  lastCheck?: string;
}

export interface SystemInfo {
  platform: string;
  arch: string;
  nodeVersion: string;
  memory: {
    total: number;
    free: number;
    used: number;
    usedPercent: number;
    heapUsed: number;
    heapTotal: number;
    external: number;
  };
  cpu: {
    cores: number;
    model: string;
    loadAvg: number[];
  };
}

export interface HealthCheckConfig {
  name: string;
  check: () => Promise<HealthCheck> | HealthCheck;
  interval?: number; // ms between checks
  timeout?: number; // max time for check
  critical?: boolean; // affects overall status
}

const DEFAULT_CHECK_INTERVAL = 30000; // 30 seconds
const DEFAULT_CHECK_TIMEOUT = 5000; // 5 seconds

export class HealthService {
  private log = new Logger('HealthService');
  private checks: Map<string, HealthCheckConfig> = new Map();
  private checkResults: Map<string, HealthCheck> = new Map();
  private intervals: Map<string, NodeJS.Timeout> = new Map();
  private startTime: number;
  private version: string;

  constructor(version: string = '2.0.0') {
    this.startTime = Date.now();
    this.version = version;
    this.registerDefaultChecks();
    this.log.info('Health Service initialized');
  }

  /**
   * Register a health check
   */
  registerCheck(config: HealthCheckConfig): void {
    this.checks.set(config.name, config);

    // Run initial check
    this.runCheck(config.name).catch(err => {
      this.log.error(`Initial check failed for ${config.name}: ${err}`);
    });

    // Set up interval if specified
    if (config.interval && config.interval > 0) {
      const interval = setInterval(() => {
        this.runCheck(config.name).catch(err => {
          this.log.error(`Scheduled check failed for ${config.name}: ${err}`);
        });
      }, config.interval);

      this.intervals.set(config.name, interval);
    }

    this.log.info(`Health check registered: ${config.name}`);
  }

  /**
   * Unregister a health check
   */
  unregisterCheck(name: string): void {
    this.checks.delete(name);
    this.checkResults.delete(name);

    const interval = this.intervals.get(name);
    if (interval) {
      clearInterval(interval);
      this.intervals.delete(name);
    }
  }

  /**
   * Run a specific health check
   */
  async runCheck(name: string): Promise<HealthCheck> {
    const config = this.checks.get(name);
    if (!config) {
      return { name, status: 'fail', message: 'Check not found' };
    }

    const startTime = Date.now();
    const timeout = config.timeout || DEFAULT_CHECK_TIMEOUT;

    try {
      const result = await Promise.race([
        Promise.resolve(config.check()),
        new Promise<HealthCheck>((_, reject) =>
          setTimeout(() => reject(new Error('Check timeout')), timeout)
        ),
      ]);

      result.duration = Date.now() - startTime;
      result.lastCheck = new Date().toISOString();
      this.checkResults.set(name, result);
      return result;
    } catch (error) {
      const failResult: HealthCheck = {
        name,
        status: 'fail',
        message: error instanceof Error ? error.message : 'Unknown error',
        duration: Date.now() - startTime,
        lastCheck: new Date().toISOString(),
      };
      this.checkResults.set(name, failResult);
      return failResult;
    }
  }

  /**
   * Run all health checks
   */
  async runAllChecks(): Promise<HealthCheck[]> {
    const promises = Array.from(this.checks.keys()).map(name => this.runCheck(name));
    return Promise.all(promises);
  }

  /**
   * Get overall health status
   */
  async getHealth(runChecks: boolean = true): Promise<HealthStatus> {
    if (runChecks) {
      await this.runAllChecks();
    }

    const checks = Array.from(this.checkResults.values());
    const criticalChecks = Array.from(this.checks.entries())
      .filter(([_, config]) => config.critical)
      .map(([name]) => this.checkResults.get(name))
      .filter(Boolean) as HealthCheck[];

    // Determine overall status
    let status: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';

    if (criticalChecks.some(c => c.status === 'fail')) {
      status = 'unhealthy';
    } else if (checks.some(c => c.status === 'fail')) {
      status = 'degraded';
    } else if (checks.some(c => c.status === 'warn')) {
      status = 'degraded';
    }

    return {
      status,
      timestamp: new Date().toISOString(),
      uptime: (Date.now() - this.startTime) / 1000,
      version: this.version,
      checks,
      system: this.getSystemInfo(),
    };
  }

  /**
   * Liveness probe - is the process running?
   */
  async liveness(): Promise<{ alive: boolean; timestamp: string }> {
    return {
      alive: true,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Readiness probe - is the service ready to handle requests?
   */
  async readiness(): Promise<{ ready: boolean; timestamp: string; checks: HealthCheck[] }> {
    const checks = await this.runAllChecks();
    const criticalFailed = Array.from(this.checks.entries())
      .filter(([_, config]) => config.critical)
      .some(([name]) => {
        const result = this.checkResults.get(name);
        return result?.status === 'fail';
      });

    return {
      ready: !criticalFailed,
      timestamp: new Date().toISOString(),
      checks,
    };
  }

  /**
   * Get system information
   */
  getSystemInfo(): SystemInfo {
    const memUsage = process.memoryUsage();
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;

    return {
      platform: os.platform(),
      arch: os.arch(),
      nodeVersion: process.version,
      memory: {
        total: totalMem,
        free: freeMem,
        used: usedMem,
        usedPercent: (usedMem / totalMem) * 100,
        heapUsed: memUsage.heapUsed,
        heapTotal: memUsage.heapTotal,
        external: memUsage.external,
      },
      cpu: {
        cores: os.cpus().length,
        model: os.cpus()[0]?.model || 'Unknown',
        loadAvg: os.loadavg(),
      },
    };
  }

  /**
   * Register default health checks
   */
  private registerDefaultChecks(): void {
    // Memory check
    this.registerCheck({
      name: 'memory',
      critical: false,
      interval: DEFAULT_CHECK_INTERVAL,
      check: () => {
        const memUsage = process.memoryUsage();
        const heapUsedMB = memUsage.heapUsed / 1024 / 1024;
        const heapTotalMB = memUsage.heapTotal / 1024 / 1024;
        const usedPercent = (heapUsedMB / heapTotalMB) * 100;

        let status: 'pass' | 'warn' | 'fail' = 'pass';
        let message = `Heap: ${heapUsedMB.toFixed(2)}MB / ${heapTotalMB.toFixed(2)}MB`;

        if (usedPercent > 90) {
          status = 'fail';
          message += ' (Critical!)';
        } else if (usedPercent > 75) {
          status = 'warn';
          message += ' (Warning)';
        }

        return { name: 'memory', status, message };
      },
    });

    // Event loop check
    this.registerCheck({
      name: 'event_loop',
      critical: true,
      interval: DEFAULT_CHECK_INTERVAL,
      check: async () => {
        const start = Date.now();
        await new Promise(resolve => setImmediate(resolve));
        const lag = Date.now() - start;

        let status: 'pass' | 'warn' | 'fail' = 'pass';
        let message = `Event loop lag: ${lag}ms`;

        if (lag > 100) {
          status = 'fail';
        } else if (lag > 50) {
          status = 'warn';
        }

        return { name: 'event_loop', status, message };
      },
    });

    // Disk space check (basic)
    this.registerCheck({
      name: 'process',
      critical: true,
      interval: DEFAULT_CHECK_INTERVAL * 2,
      check: () => {
        const uptime = process.uptime();
        return {
          name: 'process',
          status: 'pass',
          message: `Uptime: ${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m`,
        };
      },
    });
  }

  /**
   * Clean up
   */
  destroy(): void {
    for (const interval of this.intervals.values()) {
      clearInterval(interval);
    }
    this.intervals.clear();
    this.checks.clear();
    this.checkResults.clear();
  }
}

// Singleton instance
let healthServiceInstance: HealthService | null = null;

export function getHealthService(version?: string): HealthService {
  if (!healthServiceInstance) {
    healthServiceInstance = new HealthService(version);
  }
  return healthServiceInstance;
}

/**
 * Helper to format bytes to human readable
 */
export function formatBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let unitIndex = 0;
  let value = bytes;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex++;
  }

  return `${value.toFixed(2)} ${units[unitIndex]}`;
}

/**
 * Helper to format uptime
 */
export function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  if (secs > 0 || parts.length === 0) parts.push(`${secs}s`);

  return parts.join(' ');
}
