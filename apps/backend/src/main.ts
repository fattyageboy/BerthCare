import compression from 'compression';
import cors from 'cors';
import express, { type Application, Router, json } from 'express';
import helmet from 'helmet';
import { Pool } from 'pg';
import { createClient, type RedisClientType } from 'redis';

import { env, getPostgresPoolConfig, getRedisClientConfig } from './config/env';
import { logError, logInfo, logWarn } from './config/logger';
import { closeWebhookRateLimiter } from './middleware/webhook-rate-limit';
import { createAlertRoutes } from './routes/alerts.routes';
import { createAuthRoutes } from './routes/auth.routes';
import { createCarePlanRoutes } from './routes/care-plans.routes';
import { createClientRoutes } from './routes/clients.routes';
import { createWebhookRoutes } from './routes/webhooks.routes';
import { AlertEscalationService } from './services/alert-escalation.service';
import { TwilioSMSService } from './services/twilio-sms.service';
import { TwilioVoiceService } from './services/twilio-voice.service';
import { startSecretCacheCleanup, stopSecretCacheCleanup } from './utils/aws-secrets-manager';

const app: Application = express();
const PORT = env.app.port;

// Middleware
app.use(helmet());
app.use(cors());
app.use(compression());
app.use(json());

// PostgreSQL connection
const pgPool = new Pool({
  ...getPostgresPoolConfig(),
});

// Redis connection
const redisClient: RedisClientType = createClient(getRedisClientConfig());

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
    logError(
      'Health check PostgreSQL error',
      error instanceof Error ? error : new Error(String(error)),
      {
        service: 'postgres',
        healthCheck: true,
      }
    );
    health.services.postgres = 'disconnected';
    health.status = 'degraded';
  }

  // Check Redis
  try {
    await redisClient.ping();
    health.services.redis = 'connected';
  } catch (error) {
    logError(
      'Health check Redis error',
      error instanceof Error ? error : new Error(String(error)),
      {
        service: 'redis',
        healthCheck: true,
      }
    );
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
    version: env.app.version,
    environment: env.app.nodeEnv,
    endpoints: {
      health: '/health',
      api: '/api/v1',
      auth: '/api/v1/auth',
      clients: '/api/v1/clients',
      carePlans: '/api/v1/care-plans',
      alerts: '/api/v1/alerts',
      webhooks: '/webhooks',
    },
  });
});

// Mount routes (will be initialized after Redis connection)
let authRoutes: Router | null = null;
let clientRoutes: Router | null = null;
let carePlanRoutes: Router | null = null;
let alertRoutes: Router | null = null;
let webhookRoutes: Router | null = null;
let alertEscalationService: AlertEscalationService | null = null;
let httpServer: ReturnType<Application['listen']> | null = null;

// Initialize connections and start server
async function startServer() {
  try {
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

    // Initialize routes after Redis connection
    authRoutes = createAuthRoutes(pgPool, redisClient);
    app.use('/api/v1/auth', authRoutes);

    clientRoutes = createClientRoutes(pgPool, redisClient);
    app.use('/api/v1/clients', clientRoutes);

    carePlanRoutes = createCarePlanRoutes(pgPool, redisClient);
    app.use('/api/v1/care-plans', carePlanRoutes);

    alertRoutes = createAlertRoutes(pgPool, redisClient);
    app.use('/api/v1/alerts', alertRoutes);

    webhookRoutes = await createWebhookRoutes(pgPool, {
      twilioVoiceService: new TwilioVoiceService(),
      twilioSMSService: new TwilioSMSService(),
    });
    app.use('/webhooks', webhookRoutes);

    if (env.app.nodeEnv !== 'test') {
      alertEscalationService = new AlertEscalationService(pgPool);
      alertEscalationService.start();
    } else {
      logInfo('Alert escalation service disabled in test environment');
    }

    // Start Express server
    httpServer = app.listen(PORT, () => {
      logInfo('BerthCare Backend Server started', {
        environment: env.app.nodeEnv,
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

async function shutdown(signal: NodeJS.Signals) {
  logInfo(`${signal} received, shutting down gracefully...`);

  let encounteredErrors = false;

  // Global shutdown timeout (30 seconds)
  const globalTimeout = setTimeout(() => {
    logError('Shutdown grace period exceeded, forcing exit', new Error('Shutdown timeout'));
    process.exit(1);
  }, 30000);

  // Helper to wrap actions with timeout
  const withTimeout = <T>(promise: Promise<T>, timeoutMs: number, taskName: string): Promise<T> => {
    return Promise.race([
      promise,
      new Promise<T>((_, reject) =>
        setTimeout(() => reject(new Error(`${taskName} timeout after ${timeoutMs}ms`)), timeoutMs)
      ),
    ]);
  };

  const cleanupTasks: Array<{ name: string; action: () => Promise<unknown>; timeout: number }> = [
    {
      name: 'HTTP server',
      timeout: 5000,
      action: () =>
        new Promise<void>((resolve, reject) => {
          if (!httpServer) {
            logInfo('HTTP server already stopped');
            resolve();
            return;
          }

          // Force-close timeout for HTTP server
          const forceCloseTimeout = setTimeout(() => {
            logWarn('HTTP server graceful close timeout, forcing connection termination');
            // Destroy all active connections
            httpServer?.closeAllConnections?.();
            httpServer = null;
            resolve();
          }, 5000);

          httpServer.close((err) => {
            clearTimeout(forceCloseTimeout);
            if (err) {
              reject(err);
            } else {
              httpServer = null;
              resolve();
            }
          });
        }),
    },
    {
      name: 'webhook rate limiter',
      timeout: 3000,
      action: () => closeWebhookRateLimiter(),
    },
  ];

  if (alertEscalationService) {
    cleanupTasks.push({
      name: 'alert escalation service',
      timeout: 10000,
      action: () => alertEscalationService!.stop(),
    });
  }

  cleanupTasks.push(
    {
      name: 'PostgreSQL pool',
      timeout: 5000,
      action: () => pgPool.end(),
    },
    {
      name: 'Redis client',
      timeout: 3000,
      action: () => redisClient.quit(),
    },
    {
      name: 'secret cache cleanup',
      timeout: 1000,
      action: () => Promise.resolve(stopSecretCacheCleanup()),
    }
  );

  await Promise.allSettled(
    cleanupTasks.map(async ({ name, action, timeout }) => {
      try {
        await withTimeout(action(), timeout, name);
        logInfo(`${name} shutdown complete`);
      } catch (error) {
        encounteredErrors = true;
        const err = error instanceof Error ? error : new Error(String(error));
        logError(`Error during ${name} shutdown`, err);
      }
    })
  );

  // Clear global timeout since we completed successfully
  clearTimeout(globalTimeout);

  if (encounteredErrors) {
    logError('Shutdown completed with errors');
    process.exit(1);
  } else {
    logInfo('Shutdown complete');
    process.exit(0);
  }
}

process.on('SIGTERM', () => {
  void shutdown('SIGTERM');
});

process.on('SIGINT', () => {
  void shutdown('SIGINT');
});

// Start the server
startSecretCacheCleanup();
startServer();

// Export for testing
export { app, pgPool, redisClient };
