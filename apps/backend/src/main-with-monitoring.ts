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
import dotenv from 'dotenv';
import express from 'express';
import helmet from 'helmet';

import { initializeJwtKeyStore } from '@berthcare/shared';

import { redisClient } from './cache/redis-client';
import { logInfo, logError, logRequest, logWarn } from './config/logger';
import {
  initSentry,
  configureSentryMiddleware,
  configureSentryErrorHandler,
  captureMessage,
} from './config/sentry';
import {
  primaryPool,
  replicaPool,
  getReplicaHealth,
  markReplicaHealthy,
  markReplicaUnhealthy,
} from './db/pool';

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const NODE_ENV = process.env.NODE_ENV || 'development';

// Initialize Sentry (must be first)
initSentry({
  dsn: process.env.SENTRY_DSN || '',
  environment: NODE_ENV,
  release: process.env.APP_VERSION || '1.0.0',
  tracesSampleRate: parseFloat(process.env.SENTRY_TRACES_SAMPLE_RATE || '0.1'),
  profilesSampleRate: parseFloat(process.env.SENTRY_PROFILES_SAMPLE_RATE || '0.1'),
});

// Sentry request handler (must be first middleware)
configureSentryMiddleware(app);

// Standard middleware
app.use(helmet());
app.use(cors());
app.use(compression());
app.use(express.json());

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
const pgPool = primaryPool;

if (replicaPool) {
  logInfo('Read replica connection pool initialised', {
    maxConnections: replicaPool.options?.max,
  });
} else {
  logInfo('Read replica not configured; routing read queries to primary database pool');
}

// Health check endpoint
app.get('/health', async (_req, res) => {
  const health = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: process.env.APP_VERSION || '1.0.0',
    environment: NODE_ENV,
    services: {
      postgres: 'unknown',
      redis: 'unknown',
      readReplica: replicaPool ? 'unknown' : 'not_configured',
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

  if (replicaPool) {
    health.services.readReplica = getReplicaHealth();
  }

  const statusCode = health.status === 'ok' ? 200 : 503;
  res.status(statusCode).json(health);
});

// API info endpoint
app.get('/api/v1', (_req, res) => {
  res.json({
    name: 'BerthCare API',
    version: process.env.APP_VERSION || '1.0.0',
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
app.use((err: Error, req: express.Request, res: express.Response, _next: express.NextFunction) => {
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
    try {
      await initializeJwtKeyStore();
      logInfo('JWT key store initialised', {
        source: process.env.JWT_KEYS_SECRET_ARN ? 'secrets-manager' : 'environment',
      });
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));

      if (process.env.JWT_KEYS_SECRET_ARN) {
        logError('Failed to initialise JWT key store from Secrets Manager', err, {
          secretArn: process.env.JWT_KEYS_SECRET_ARN,
        });
        throw err;
      }

      logWarn('JWT key store not initialised from Secrets Manager; using environment keys', {
        reason: err.message,
      });
    }

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

    if (replicaPool) {
      try {
        await replicaPool.query('SELECT 1');
        markReplicaHealthy();
        logInfo('Read replica connectivity verified');
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        markReplicaUnhealthy();
        logWarn('Read replica verification failed; routing read traffic to primary', {
          error: errorMessage,
        });
        captureMessage('Read replica connectivity verification failed', 'warning', {
          error: errorMessage,
        });
      }
    }

    // Start Express server
    app.listen(PORT, () => {
      logInfo('BerthCare Backend Server started', {
        port: PORT,
        environment: NODE_ENV,
        version: process.env.APP_VERSION || '1.0.0',
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
startServer();
