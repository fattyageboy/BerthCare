/**
 * Webhook Rate Limiting Middleware
 *
 * Protects webhook endpoints from abuse and DoS attacks
 * Uses Redis for multi-instance production deployments
 */

import { createHash } from 'crypto';
import { Request, Response, NextFunction } from 'express';
import { rateLimit } from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';
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

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 100;

const REDACTED_VALUE = '<redacted>';

function normalizeIp(ip: string): string {
  const trimmed = ip.trim();
  const withoutZone = trimmed.split('%')[0];
  if (withoutZone.startsWith('::ffff:')) {
    return withoutZone.slice(7);
  }
  return withoutZone;
}

function maskIp(ip: string): string {
  const normalized = normalizeIp(ip);
  const ipv4Match = normalized.match(/^\d{1,3}(?:\.\d{1,3}){3}$/);
  if (ipv4Match) {
    const parts = normalized.split('.');
    parts[3] = '0';
    return `${parts.join('.')}\/24`;
  }

  if (normalized.includes(':')) {
    const segments = normalized.split(':');
    return `${segments.slice(0, 4).join(':')}::/64`;
  }

  return REDACTED_VALUE;
}

function anonymizeIp(ip: string): string {
  const secret = env.logging.webhookIpHashSecret;
  if (secret) {
    return createHash('sha256').update(`${secret}:${normalizeIp(ip)}`).digest('hex').slice(0, 32);
  }
  return maskIp(ip);
}

function formatIpForLogging(ip?: string | string[]): string | undefined {
  if (!ip) {
    return undefined;
  }

  const value = Array.isArray(ip) ? ip[0] : ip;
  if (!value) {
    return undefined;
  }

  return env.logging.logWebhookClientIp ? normalizeIp(value) : anonymizeIp(value);
}

function formatForwardedForForLogging(raw?: string | string[]): string | undefined {
  if (!raw) {
    return undefined;
  }

  const value = Array.isArray(raw) ? raw.join(',') : raw;
  if (!value) {
    return undefined;
  }

  const parts = value
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);

  if (parts.length === 0) {
    return undefined;
  }

  return parts
    .map((part) => (env.logging.logWebhookClientIp ? normalizeIp(part) : anonymizeIp(part)))
    .join(', ');
}

const maskRedisUrl = (value: string): string => {
  if (!value) {
    return REDACTED_VALUE;
  }

  try {
    const parsed = new URL(value);
    if (parsed.password) {
      parsed.password = '***';
    }
    if (parsed.username) {
      parsed.username = '***';
    }
    return parsed.toString();
  } catch (error) {
    return REDACTED_VALUE;
  }
};

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
      url: maskRedisUrl(env.redis.url),
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
      sendCommand: async (...args: string[]) => redisClient.sendCommand(args),
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
let webhookRateLimiterInitPromise: Promise<ReturnType<typeof rateLimit>> | null = null;

export async function getWebhookRateLimiter(): Promise<ReturnType<typeof rateLimit>> {
  if (webhookRateLimiterInstance) {
    return webhookRateLimiterInstance;
  }

  if (webhookRateLimiterInitPromise) {
    return webhookRateLimiterInitPromise;
  }

  webhookRateLimiterInitPromise = (async () => {
    try {
      const store = await createWebhookRateLimiterStore();

      webhookRateLimiterInstance = rateLimit({
        windowMs: RATE_LIMIT_WINDOW_MS, // 1 minute
        max: RATE_LIMIT_MAX_REQUESTS, // Max 100 requests per window per IP
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
          const clientIp = formatIpForLogging(req.ip);
          const forwardedFor = formatForwardedForForLogging(req.headers['x-forwarded-for']);

          const context: Record<string, unknown> = {
            path: req.path,
            method: req.method,
            userAgent: req.headers['user-agent'],
          };

          if (clientIp) {
            context.clientIp = clientIp;
          }

          if (forwardedFor) {
            context.forwardedFor = forwardedFor;
          }

          logError('Webhook rate limit exceeded', undefined, context);

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
    } catch (error) {
      webhookRateLimiterInitPromise = null;
      throw error;
    } finally {
      webhookRateLimiterInitPromise = null;
    }
  })();

  return webhookRateLimiterInitPromise;
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
    } finally {
      redisStoreClient = null;
      redisStoreInitialized = false;
    }
  }

  webhookRateLimiterInstance = null;
  webhookRateLimiterInitPromise = null;
}

/**
 * Log successful webhook requests that pass rate limiting
 */
export const logWebhookRequest = (req: Request, _res: Response, next: NextFunction) => {
  const clientIp = formatIpForLogging(req.ip);
  const forwardedFor = formatForwardedForForLogging(req.headers['x-forwarded-for']);

  const context: Record<string, unknown> = {
    path: req.path,
    method: req.method,
    userAgent: req.headers['user-agent'],
  };

  if (clientIp) {
    context.clientIp = clientIp;
  }

  if (forwardedFor) {
    context.forwardedFor = forwardedFor;
  }

  logInfo('Webhook request received', context);
  next();
};
