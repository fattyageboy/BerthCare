/**
 * Rate Limiting Middleware
 *
 * Provides IP-based rate limiting using Redis for distributed rate limiting.
 *
 * Features:
 * - Per-IP rate limiting
 * - Configurable time windows and max attempts
 * - Redis-backed for multi-instance support
 * - Clear error messages with retry information
 *
 * Reference: Architecture Blueprint - Security section
 * Task: A4 - Registration endpoint rate limiting (5 attempts per hour per IP)
 *
 * Philosophy: "Uncompromising Security"
 * - Prevent brute force attacks
 * - Protect against abuse
 * - Graceful degradation if Redis unavailable
 */

import { Request, Response, NextFunction } from 'express';

import { RedisClient } from '../cache/redis-client';
import { logError } from '../config/logger';

interface RateLimitConfig {
  windowMs: number; // Time window in milliseconds
  maxAttempts: number; // Maximum attempts per window
  keyPrefix: string; // Redis key prefix for this limiter
}

export function createRateLimiter(redisClient: RedisClient, config: RateLimitConfig) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      // Get client IP address - handle test environment
      // In tests, req.ip might be undefined, so we use a combination of sources
      let ip = req.ip || req.socket.remoteAddress || 'unknown';

      // Normalize IPv6 localhost to IPv4 for consistency
      if (ip === '::1' || ip === '::ffff:127.0.0.1') {
        ip = '127.0.0.1';
      }

      const key = `${config.keyPrefix}:${ip}`;

      // Get current count
      const current = await redisClient.get(key);
      const count = current ? parseInt(current, 10) : 0;

      // Check if limit exceeded
      if (count >= config.maxAttempts) {
        const ttl = await redisClient.ttl(key);
        const retryAfter = ttl > 0 ? ttl : Math.floor(config.windowMs / 1000);

        res.status(429).json({
          error: {
            code: 'RATE_LIMIT_EXCEEDED',
            message: 'Too many attempts. Please try again later.',
            details: {
              maxAttempts: config.maxAttempts,
              windowMs: config.windowMs,
              retryAfter: retryAfter,
            },
            timestamp: new Date().toISOString(),
            requestId: req.headers['x-request-id'] || 'unknown',
          },
        });
        return;
      }

      // Increment counter
      if (count === 0) {
        // First attempt - set with expiry
        await redisClient.setEx(key, Math.floor(config.windowMs / 1000), '1');
      } else {
        // Subsequent attempt - increment
        await redisClient.incr(key);
      }

      // Add rate limit headers
      res.setHeader('X-RateLimit-Limit', config.maxAttempts.toString());
      res.setHeader('X-RateLimit-Remaining', (config.maxAttempts - count - 1).toString());
      res.setHeader('X-RateLimit-Reset', new Date(Date.now() + config.windowMs).toISOString());

      next();
    } catch (error) {
      // If Redis fails, log error but allow request through
      // (graceful degradation - don't block users if rate limiting fails)
      logError('Rate limiter error', error instanceof Error ? error : new Error(String(error)), {
        keyPrefix: config.keyPrefix,
      });
      next();
    }
  };
}

/**
 * Registration rate limiter: 5 attempts per hour per IP
 */
export function createRegistrationRateLimiter(redisClient: RedisClient) {
  return createRateLimiter(redisClient, {
    windowMs: 60 * 60 * 1000, // 1 hour
    maxAttempts: 5,
    keyPrefix: 'ratelimit:register',
  });
}

/**
 * Login rate limiter: 10 attempts per 15 minutes per IP
 */
export function createLoginRateLimiter(redisClient: RedisClient) {
  return createRateLimiter(redisClient, {
    windowMs: 15 * 60 * 1000, // 15 minutes
    maxAttempts: 10,
    keyPrefix: 'ratelimit:login',
  });
}
