/**
 * BerthCare Backend Server with Monitoring & Observability
 *
 * Features:
 * - Sentry error tracking and performance monitoring
 * - Structured logging with Winston
 * - CloudWatch log integration
 * - Request/response logging
 * - Health checks with service status
 */

import compression from 'compression';
import cors from 'cors';
import express, { json } from 'express';
import type { Request, Response, NextFunction } from 'express';
import helmet from 'helmet';
import { Pool } from 'pg';
import { createClient } from 'redis';

import { env, getPostgresPoolConfig, getRedisClientConfig } from './config/env';
import { logInfo, logError, logRequest } from './config/logger';
import {
  initSentry,
  configureSentryMiddleware,
  configureSentryErrorHandler,
} from './config/sentry';
import { startSecretCacheCleanup, stopSecretCacheCleanup } from './utils/aws-secrets-manager';

const app = express();
const PORT = env.app.port;
const NODE_ENV = env.app.nodeEnv;

// Initialize Sentry (must be first)
initSentry({
  dsn: env.sentry.dsn || '',
  environment: NODE_ENV,
  release: env.app.version,
  tracesSampleRate: env.sentry.tracesSampleRate,
  profilesSampleRate: env.sentry.profilesSampleRate,
});

// Sentry request handler (must be first middleware)
configureSentryMiddleware(app);

// Standard middleware
app.use(helmet());
app.use(cors());
app.use(compression());
app.use(json());

// Request logging middleware
app.use((req, res, next) => {
  const startTime = Date.now();

  res.on('finish', () => {
    const duration = Date.now() - startTime;
    logRequest(req.method, req.path, res.statusCode, duration, {
      requestId: req.headers['x-request-id'],
      userAgent: req.headers['user-agent'],
      ip: req.ip,
    });
  });

  next();
});

// PostgreSQL connection
const pgPool = new Pool({
  ...getPostgresPoolConfig(),
});

// Redis connection
const redisClient = createClient(getRedisClientConfig());

// Health check endpoint
app.get('/health', async (_req, res) => {
  const health = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: env.app.version,
    environment: NODE_ENV,
    services: {
      postgres: 'unknown',
      redis: 'unknown',
    },
  };

  // Check PostgreSQL
  try {
    await pgPool.query('SELECT 1');
    health.services.postgres = 'connected';
  } catch (error) {
    health.services.postgres = 'disconnected';
    health.status = 'degraded';
    logError('PostgreSQL health check failed', error as Error);
  }

  // Check Redis
  try {
    await redisClient.ping();
    health.services.redis = 'connected';
  } catch (error) {
    health.services.redis = 'disconnected';
    health.status = 'degraded';
    logError('Redis health check failed', error as Error);
  }

  const statusCode = health.status === 'ok' ? 200 : 503;
  res.status(statusCode).json(health);
});

// API info endpoint
app.get('/api/v1', (_req, res) => {
  res.json({
    name: 'BerthCare API',
    version: env.app.version,
    environment: NODE_ENV,
    endpoints: {
      health: '/health',
      api: '/api/v1',
    },
  });
});

// Test endpoint for Sentry (development only)
if (NODE_ENV === 'development') {
  app.get('/test/sentry', (_req, res) => {
    try {
      throw new Error('Test error for Sentry');
    } catch (error) {
      logError('Test error triggered', error as Error, {
        source: 'test-endpoint',
      });
      res.status(500).json({ error: 'Test error sent to Sentry' });
    }
  });
}

// Sentry error handler (must be before other error handlers)
configureSentryErrorHandler(app);

// Global error handler
app.use((err: Error, req: Request, res: Response, _next: NextFunction) => {
  logError('Unhandled error', err, {
    path: req.path,
    method: req.method,
    requestId: req.headers['x-request-id'],
  });

  res.status(500).json({
    error: {
      code: 'INTERNAL_SERVER_ERROR',
      message: NODE_ENV === 'production' ? 'An unexpected error occurred' : err.message,
      timestamp: new Date().toISOString(),
      requestId: req.headers['x-request-id'],
    },
  });
});

// Initialize connections and start server
async function startServer() {
  try {
    // Test PostgreSQL connection
    logInfo('Connecting to PostgreSQL...');
    const pgResult = await pgPool.query('SELECT NOW() as time, version() as version');
    logInfo('Connected to PostgreSQL', {
      time: pgResult.rows[0].time,
      version: pgResult.rows[0].version.split(',')[0],
    });

    // Connect to Redis
    logInfo('Connecting to Redis...');
    await redisClient.connect();
    const redisInfo = await redisClient.info('server');
    const redisVersion = redisInfo.match(/redis_version:([^\r\n]+)/)?.[1] || 'unknown';
    logInfo('Connected to Redis', {
      version: redisVersion,
    });

    // Start Express server
    app.listen(PORT, () => {
      logInfo('BerthCare Backend Server started', {
        port: PORT,
        environment: NODE_ENV,
        version: env.app.version,
        healthEndpoint: `http://localhost:${PORT}/health`,
        apiEndpoint: `http://localhost:${PORT}/api/v1`,
      });
    });
  } catch (error) {
    logError('Failed to start server', error as Error);
    process.exit(1);
  }
}

// Graceful shutdown
async function shutdown(signal: string) {
  logInfo(`${signal} received, shutting down gracefully...`);

  try {
    await pgPool.end();
    logInfo('PostgreSQL connection closed');

    await redisClient.quit();
    logInfo('Redis connection closed');

    logInfo('Stopping secret cache cleanup');
    try {
      stopSecretCacheCleanup();
      logInfo('Secret cache cleanup stopped');
    } catch (error) {
      logError('Error stopping secret cache cleanup', error as Error, {
        context: 'graceful-shutdown',
      });
      // Continue shutdown even if cache cleanup fails
    }

    logInfo('Shutdown complete');
    process.exit(0);
  } catch (error) {
    logError('Error during shutdown', error as Error);
    process.exit(1);
  }
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Unhandled promise rejection handler
process.on('unhandledRejection', (reason: unknown) => {
  logError('Unhandled Promise Rejection', new Error(String(reason)));
});

// Uncaught exception handler
process.on('uncaughtException', (error: Error) => {
  logError('Uncaught Exception', error);
  process.exit(1);
});

// Start the server
startSecretCacheCleanup();
startServer();
