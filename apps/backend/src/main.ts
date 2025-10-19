/**
 * BerthCare Backend Server - Main Entry Point
 *
 * Task B1: Initialize Express.js backend
 * Set up Express.js 4.x with TypeScript; configure middleware (helmet, cors, compression);
 * create health check endpoint GET /health; configure logging (Winston);
 * set up error handling middleware.
 *
 * Task B2: Configure database connection (PostgreSQL with connection pooling)
 * Task B3: Configure Redis connection (with retry logic)
 *
 * Reference: project-documentation/task-plan.md - Phase B – Backend Core Infrastructure
 */

import compression from 'compression';
import cors from 'cors';
import dotenv from 'dotenv';
import express, { NextFunction, Request, Response, Router } from 'express';
import helmet from 'helmet';

import { initializeJwtKeyStore } from '@berthcare/shared';

import { redisClient } from './cache/redis-client';
import { logError, logInfo, logWarn } from './config/logger';
import { getReadPool, primaryPool, replicaPool } from './db/pool';
import { createGlobalRateLimiter } from './middleware/global-rate-limiter';
import { createAuthRoutes } from './routes/auth.routes';
import { createCarePlanRoutes } from './routes/care-plans.routes';
import { createClientRoutes } from './routes/clients.routes';
import { createVisitsRouter } from './routes/visits.routes';

// Load environment variables
dotenv.config({ path: '../../.env' });

export function validateEnvironment() {
  if (process.env.NODE_ENV === 'test') {
    return;
  }

  if (!process.env.AWS_REGION) {
    throw new Error(
      'AWS_REGION is required for S3 URL construction. Set AWS_REGION in your environment or .env file.'
    );
  }
}

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(helmet());
app.use(cors());
app.use(compression());
app.use(express.json());

const RATE_LIMIT_WINDOW_MS_DEFAULT = 900000;
const RATE_LIMIT_MAX_REQUESTS_DEFAULT = 100;

const rateLimitWindowMsEnv = process.env.RATE_LIMIT_WINDOW_MS;
const parsedRateLimitWindowMs = rateLimitWindowMsEnv
  ? Number.parseInt(rateLimitWindowMsEnv, 10)
  : RATE_LIMIT_WINDOW_MS_DEFAULT;
let rateLimitWindowMs = parsedRateLimitWindowMs;

if (!Number.isInteger(rateLimitWindowMs) || rateLimitWindowMs <= 0) {
  logWarn('Invalid RATE_LIMIT_WINDOW_MS value; falling back to default', {
    providedValue: rateLimitWindowMsEnv,
    defaultValue: RATE_LIMIT_WINDOW_MS_DEFAULT,
  });
  rateLimitWindowMs = RATE_LIMIT_WINDOW_MS_DEFAULT;
}

const rateLimitMaxRequestsEnv = process.env.RATE_LIMIT_MAX_REQUESTS;
const parsedRateLimitMaxRequests = rateLimitMaxRequestsEnv
  ? Number.parseInt(rateLimitMaxRequestsEnv, 10)
  : RATE_LIMIT_MAX_REQUESTS_DEFAULT;
let rateLimitMaxRequests = parsedRateLimitMaxRequests;

if (!Number.isInteger(rateLimitMaxRequests) || rateLimitMaxRequests <= 0) {
  logWarn('Invalid RATE_LIMIT_MAX_REQUESTS value; falling back to default', {
    providedValue: rateLimitMaxRequestsEnv,
    defaultValue: RATE_LIMIT_MAX_REQUESTS_DEFAULT,
  });
  rateLimitMaxRequests = RATE_LIMIT_MAX_REQUESTS_DEFAULT;
}

app.use(
  createGlobalRateLimiter({
    windowMs: rateLimitWindowMs,
    maxRequests: rateLimitMaxRequests,
  })
);

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
  }

  // Check Redis
  try {
    await redisClient.ping();
    health.services.redis = 'connected';
  } catch (error) {
    health.services.redis = 'disconnected';
    health.status = 'degraded';
  }

  const statusCode = health.status === 'ok' ? 200 : 503;
  res.status(statusCode).json(health);
});

// API info endpoint
app.get('/api/v1', (_req, res) => {
  res.json({
    name: 'BerthCare API',
    version: '1.0.0',
    environment: process.env.NODE_ENV || 'development',
    endpoints: {
      health: '/health',
      api: '/api/v1',
      auth: '/api/v1/auth',
      clients: '/api/v1/clients',
      carePlans: '/api/v1/care-plans',
      visits: '/api/v1/visits',
    },
  });
});

// Mount routes (will be initialized after Redis connection)
let authRoutes: Router | null = null;
let clientRoutes: Router | null = null;
let carePlanRoutes: Router | null = null;
let visitsRoutes: Router | null = null;

// Initialize connections and start server
async function startServer() {
  try {
    try {
      await initializeJwtKeyStore();
      logInfo('JWT key store initialised', {
        source: process.env.JWT_KEYS_SECRET_ARN ? 'secrets-manager' : 'environment',
      });
    } catch (error) {
      if (process.env.JWT_KEYS_SECRET_ARN) {
        logError(
          'Failed to initialise JWT key store from Secrets Manager',
          error instanceof Error ? error : new Error(String(error)),
          {
            secretArn: process.env.JWT_KEYS_SECRET_ARN,
          }
        );
        throw error;
      }

      logWarn('JWT key store not initialised from Secrets Manager; using environment keys', {
        reason: error instanceof Error ? error.message : String(error),
      });
    }

    // Test PostgreSQL connection
    logInfo('Connecting to PostgreSQL...');
    const pgResult = await pgPool.query('SELECT NOW() as time, version() as version');
    logInfo('Connected to PostgreSQL', {
      databaseTime: pgResult.rows[0].time,
      version: pgResult.rows[0].version.split(',')[0],
    });

    // Connect to Redis
    logInfo('Connecting to Redis...');
    await redisClient.connect();
    const redisInfo = await redisClient.info('server');
    const redisVersion = redisInfo.match(/redis_version:([^\r\n]+)/)?.[1] || 'unknown';
    logInfo('Connected to Redis', { version: redisVersion });

    if (replicaPool) {
      try {
        await getReadPool().query('SELECT 1');
        logInfo('Read replica connectivity verified');
      } catch (error) {
        logWarn('Read replica verification failed', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // Initialize routes after Redis connection
    authRoutes = createAuthRoutes(pgPool, redisClient);
    app.use('/api/v1/auth', authRoutes);

    clientRoutes = createClientRoutes(pgPool, redisClient);
    app.use('/api/v1/clients', clientRoutes);

    carePlanRoutes = createCarePlanRoutes(pgPool, redisClient);
    app.use('/api/v1/care-plans', carePlanRoutes);

    visitsRoutes = createVisitsRouter(pgPool, redisClient);
    app.use('/api/v1/visits', visitsRoutes);

    registerGlobalErrorHandler(app);

    // Start Express server
    app.listen(PORT, () => {
      logInfo('BerthCare Backend Server started', {
        environment: process.env.NODE_ENV || 'development',
        port: PORT,
        serverUrl: `http://localhost:${PORT}`,
        healthUrl: `http://localhost:${PORT}/health`,
        apiUrl: `http://localhost:${PORT}/api/v1`,
      });
    });
  } catch (error) {
    logError('Failed to start server', error instanceof Error ? error : new Error(String(error)));
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGTERM', async () => {
  logInfo('SIGTERM received, shutting down gracefully...');
  await pgPool.end();
  await redisClient.quit();
  process.exit(0);
});

process.on('SIGINT', async () => {
  logInfo('SIGINT received, shutting down gracefully...');
  await pgPool.end();
  await redisClient.quit();
  process.exit(0);
});

try {
  validateEnvironment();
} catch (error) {
  const envError = error instanceof Error ? error : new Error(String(error));
  logError('Environment validation failed', envError);

  if (process.env.NODE_ENV === 'test') {
    throw envError;
  }
  process.exit(1);
}

startServer();

// Export for testing
export { app, pgPool, redisClient };

function registerGlobalErrorHandler(server: express.Application) {
  server.use((err: Error, req: Request, res: Response, next: NextFunction) => {
    logError('Unhandled application error', err, {
      path: req.path,
      method: req.method,
      requestId: req.headers['x-request-id'] || 'unknown',
    });

    if (res.headersSent) {
      return next(err);
    }

    res.status(500).json({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message:
          process.env.NODE_ENV === 'production'
            ? 'An unexpected error occurred'
            : err.message || 'An unexpected error occurred',
        requestId: req.headers['x-request-id'] || 'unknown',
        timestamp: new Date().toISOString(),
      },
    });
  });
}
