/**
 * Structured Logging Configuration
 *
 * Task B1: Configure logging (Winston)
 * Set up Winston logger with JSON formatting for CloudWatch parsing.
 *
 * Features:
 * - JSON formatted logs for CloudWatch parsing
 * - Multiple log levels (error, warn, info, debug)
 * - Request ID tracking
 * - User context
 * - Performance metrics
 *
 * Reference: project-documentation/task-plan.md - Phase B – Backend Core Infrastructure
 */

import winston from 'winston';

import { captureException } from './sentry';

// Define log levels
const levels = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
};

// Define colors for console output
const colors = {
  error: 'red',
  warn: 'yellow',
  info: 'green',
  debug: 'blue',
};

winston.addColors(colors);

// Custom format for structured logging
const structuredFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DDTHH:mm:ss.SSSZ' }),
  winston.format.errors({ stack: true }),
  winston.format.json()
);

// Console format for development
const consoleFormat = winston.format.combine(
  winston.format.timestamp({ format: 'HH:mm:ss' }),
  winston.format.colorize(),
  winston.format.printf(
    ({ timestamp, level, message, ...meta }: winston.Logform.TransformableInfo) => {
      let msg = `${timestamp} [${level}] ${message}`;
      if (Object.keys(meta).length > 0) {
        msg += ` ${JSON.stringify(meta)}`;
      }
      return msg;
    }
  )
);

// Create logger instance
const logger = winston.createLogger({
  levels,
  level: process.env.LOG_LEVEL || 'info',
  format: structuredFormat,
  defaultMeta: {
    service: 'berthcare-api',
    environment: process.env.NODE_ENV || 'development',
  },
  transports: [
    // Console transport (always enabled)
    new winston.transports.Console({
      format: process.env.NODE_ENV === 'production' ? structuredFormat : consoleFormat,
    }),
  ],
});

// Add CloudWatch transport for production
if (process.env.NODE_ENV === 'production' && process.env.CLOUDWATCH_LOG_GROUP) {
  // CloudWatch logs are handled by ECS/Fargate automatically
  // Just ensure we're using JSON format
  logger.info('CloudWatch logging enabled', {
    logGroup: process.env.CLOUDWATCH_LOG_GROUP,
  });
}

/**
 * Log error and send to Sentry
 */
export function logError(message: string, error?: Error, context?: Record<string, unknown>): void {
  logger.error(message, {
    error: error
      ? {
          name: error.name,
          message: error.message,
          stack: error.stack,
        }
      : undefined,
    ...context,
  });

  // Send to Sentry
  if (error) {
    captureException(error, context);
  }
}

/**
 * Log warning
 */
export function logWarn(message: string, context?: Record<string, unknown>): void {
  logger.warn(message, context);
}

/**
 * Log info
 */
export function logInfo(message: string, context?: Record<string, unknown>): void {
  logger.info(message, context);
}

/**
 * Log debug (only in development)
 */
export function logDebug(message: string, context?: Record<string, unknown>): void {
  logger.debug(message, context);
}

/**
 * Log API request
 */
export function logRequest(
  method: string,
  path: string,
  statusCode: number,
  duration: number,
  context?: Record<string, unknown>
): void {
  const level = statusCode >= 500 ? 'error' : statusCode >= 400 ? 'warn' : 'info';

  logger.log(level, 'API Request', {
    method,
    path,
    statusCode,
    duration,
    ...context,
  });
}

/**
 * Log database query
 */
export function logQuery(query: string, duration: number, context?: Record<string, unknown>): void {
  logger.debug('Database Query', {
    query: query.substring(0, 200), // Truncate long queries
    duration,
    ...context,
  });

  // Warn on slow queries
  if (duration > 1000) {
    logger.warn('Slow Database Query', {
      query: query.substring(0, 200),
      duration,
      ...context,
    });
  }
}

/**
 * Log authentication event
 */
export function logAuth(
  event: 'login' | 'logout' | 'register' | 'refresh' | 'failed',
  userId?: string,
  context?: Record<string, unknown>
): void {
  logger.info('Authentication Event', {
    event,
    userId,
    ...context,
  });
}

/**
 * Log business event
 */
export function logBusinessEvent(event: string, context?: Record<string, unknown>): void {
  logger.info('Business Event', {
    event,
    ...context,
  });
}

export default logger;
