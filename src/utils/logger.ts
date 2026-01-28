/**
 * Simple but effective logger with colors and context
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LoggerOptions {
  minLevel?: LogLevel;
  enableColors?: boolean;
}

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const COLORS = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
};

const LEVEL_COLORS: Record<LogLevel, string> = {
  debug: COLORS.dim,
  info: COLORS.cyan,
  warn: COLORS.yellow,
  error: COLORS.red,
};

const LEVEL_ICONS: Record<LogLevel, string> = {
  debug: '🔍',
  info: '💡',
  warn: '⚠️',
  error: '❌',
};

export class Logger {
  private context: string;
  private static minLevel: LogLevel = 'debug';
  private static enableColors: boolean = true;

  constructor(context: string) {
    this.context = context;
  }

  static configure(options: LoggerOptions): void {
    if (options.minLevel !== undefined) {
      Logger.minLevel = options.minLevel;
    }
    if (options.enableColors !== undefined) {
      Logger.enableColors = options.enableColors;
    }
  }

  private shouldLog(level: LogLevel): boolean {
    return LEVEL_ORDER[level] >= LEVEL_ORDER[Logger.minLevel];
  }

  private formatMessage(level: LogLevel, message: string, args: any[]): string {
    const timestamp = new Date().toISOString().substring(11, 23);
    const icon = LEVEL_ICONS[level];

    if (Logger.enableColors) {
      const color = LEVEL_COLORS[level];
      return `${COLORS.dim}[${timestamp}]${COLORS.reset} ${icon} ${color}[${this.context}]${COLORS.reset} ${message}`;
    }

    return `[${timestamp}] ${icon} [${this.context}] ${message}`;
  }

  debug(message: string, ...args: any[]): void {
    if (this.shouldLog('debug')) {
      console.log(this.formatMessage('debug', message, args), ...args);
    }
  }

  info(message: string, ...args: any[]): void {
    if (this.shouldLog('info')) {
      console.log(this.formatMessage('info', message, args), ...args);
    }
  }

  warn(message: string, ...args: any[]): void {
    if (this.shouldLog('warn')) {
      console.warn(this.formatMessage('warn', message, args), ...args);
    }
  }

  error(message: string, ...args: any[]): void {
    if (this.shouldLog('error')) {
      console.error(this.formatMessage('error', message, args), ...args);
    }
  }
}

// Default export for quick usage
export const logger = new Logger('App');
