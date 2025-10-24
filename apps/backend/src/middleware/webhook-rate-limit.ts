/**
 * Webhook Rate Limiting Middleware
 *
 * Protects webhook endpoints from abuse and DoS attacks
 * Uses Redis for multi-instance production deployments
 */

import { Request, Response, NextFunction } from 'express';
import rateLimit from 'express-rate-limit';
import RedisStore from 'rate-limit-redis';
import { createClient } from 'redis';

import { env, getRedisClientConfig } from '../config/env';
import { logError, logInfo, logWarn } from '../config/logger';

/**
 * Rate limit response constants
 * Centralized for consistency and maintainability
 */
const WEBHOOK_RATE_LIMIT_STATUS = 429;
const WEBHOOK_RATE_LIMIT_CODE = 'RATE_LIMIT_EXCEEDED';
const WEBHOOK_RATE_LIMIT_MESSAGE = 'Too many webhook requests, please try again later';

/**
 * Shared Redis client for rate limiting
 * Initialized once and reused across all rate limiters
 */
let redisStoreClient: ReturnType<typeof createClient> | null = null;
let redisStoreInitialized = false;

/**
 * Initialize Redis client for rate limiting
 * Separate from main Redis client to isolate rate limiting failures
 */
async function initializeRedisStore(): Promise<ReturnType<typeof createClient> | null> {
  if (redisStoreInitialized) {
    return redisStoreClient;
  }

  try {
    const client = createClient(getRedisClientConfig());

    client.on('error', (err) => {
      logError('Redis rate limit store error', err instanceof Error ? err : undefined, {
        message: 'Rate limiting will fall back to in-memory store',
      });
    });

    await client.connect();
    redisStoreClient = client;
    redisStoreInitialized = true;

    logInfo('Redis rate limit store initialized', {
      url: env.redis.url.replace(/:[^:@]+@/, ':***@'), // Mask password in logs
    });

    return client;
  } catch (error) {
    logWarn('Failed to initialize Redis rate limit store, using in-memory fallback', {
      error: error instanceof Error ? error.message : String(error),
      message: 'Rate limiting will work but not be shared across instances',
    });
    redisStoreInitialized = true; // Don't retry
    return null;
  }
}

/**
 * Create rate limiter with Redis store (production) or in-memory (fallback)
 */
async function createWebhookRateLimiterStore() {
  const redisClient = await initializeRedisStore();

  if (redisClient) {
    // Production: Redis-backed store (shared across instances)
    return new RedisStore({
      sendCommand: (...args: string[]) => redisClient.sendCommand(args),
      prefix: 'rl:webhook:', // Namespace for webhook rate limits
    });
  }

  // Fallback: In-memory store (single instance only)
  logWarn('Using in-memory rate limit store', {
    message: 'Not suitable for multi-instance production deployments',
  });
  return undefined; // express-rate-limit will use default MemoryStore
}

/**
 * Rate limiter for webhook endpoints
 *
 * Configuration:
 * - Window: 1 minute
 * - Max requests: 100 per window per IP
 * - Response: HTTP 429 Too Many Requests
 * - Store: Redis (production) or in-memory (fallback)
 *
 * Rationale:
 * - Twilio typically sends 4-6 webhooks per call (initiated, ringing, answered, completed)
 * - With 100 requests/minute, this supports ~16-25 concurrent calls per IP
 * - Conservative enough to prevent abuse while allowing legitimate traffic
 * - Twilio webhooks come from their IP ranges, so this protects against:
 *   - Misconfigured webhook URLs causing loops
 *   - Malicious actors attempting to flood the endpoint
 *   - Accidental DoS from buggy integrations
 *
 * Production:
 * - Uses Redis store for multi-instance deployments
 * - Rate limits are shared across all instances
 * - Survives instance restarts
 *
 * Fallback:
 * - If Redis unavailable, uses in-memory store
 * - Rate limits are per-instance (not shared)
 * - Resets on instance restart
 */
let webhookRateLimiterInstance: ReturnType<typeof rateLimit> | null = null;

export async function getWebhookRateLimiter(): Promise<ReturnType<typeof rateLimit>> {
  if (webhookRateLimiterInstance) {
    return webhookRateLimiterInstance;
  }

  const store = await createWebhookRateLimiterStore();

  webhookRateLimiterInstance = rateLimit({
    windowMs: 1 * 60 * 1000, // 1 minute
    max: 100, // Max 100 requests per window per IP
    standardHeaders: true, // Return rate limit info in `RateLimit-*` headers
    legacyHeaders: false, // Disable `X-RateLimit-*` headers
    store, // Redis store (production) or undefined (in-memory fallback)
    message: {
      error: {
        code: WEBHOOK_RATE_LIMIT_CODE,
        message: WEBHOOK_RATE_LIMIT_MESSAGE,
      },
    },
    handler: (req, res) => {
      // Log rate limit events for monitoring
      logError('Webhook rate limit exceeded', undefined, {
        ip: req.ip,
        path: req.path,
        method: req.method,
        headers: {
          'user-agent': req.headers['user-agent'],
          'x-forwarded-for': req.headers['x-forwarded-for'],
        },
      });

      res.status(WEBHOOK_RATE_LIMIT_STATUS).json({
        error: {
          code: WEBHOOK_RATE_LIMIT_CODE,
          message: WEBHOOK_RATE_LIMIT_MESSAGE,
          timestamp: new Date().toISOString(),
        },
      });
    },
    skip: (req) => {
      // Don't rate limit health checks
      return req.path === '/health';
    },
  });

  return webhookRateLimiterInstance;
}

/**
 * Cleanup function for graceful shutdown
 */
export async function closeWebhookRateLimiter(): Promise<void> {
  if (redisStoreClient) {
    try {
      await redisStoreClient.quit();
      logInfo('Redis rate limit store closed');
    } catch (error) {
      logError('Error closing Redis rate limit store', error instanceof Error ? error : undefined);
    }
  }
}

/**
 * Log successful webhook requests that pass rate limiting
 */
export const logWebhookRequest = (req: Request, _res: Response, next: NextFunction) => {
  logInfo('Webhook request received', {
    ip: req.ip,
    path: req.path,
    method: req.method,
    userAgent: req.headers['user-agent'],
  });
  next();
};
