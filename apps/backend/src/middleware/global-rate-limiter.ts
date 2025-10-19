import { NextFunction, Request, Response } from 'express';

import { logWarn } from '../config/logger';

interface GlobalRateLimiterOptions {
  windowMs: number;
  maxRequests: number;
  keyGenerator?: (req: Request) => string;
}

interface RateLimitEntry {
  count: number;
  resetTime: number;
}

export interface GlobalRateLimiterMiddleware {
  (req: Request, res: Response, next: NextFunction): void;
  stopCleanup: () => void;
}

const DEFAULT_STATUS_CODE = 429;
const DEFAULT_MESSAGE = 'Too many requests. Please try again later.';
const CLEANUP_INTERVAL_MS = 10 * 60 * 1000;
const MIN_WINDOW_MS = 1000;
const MAX_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const MIN_REQUESTS = 1;
const MAX_REQUESTS = 10_000;

/**
 * Lightweight in-memory rate limiter used as a drop-in replacement for express-rate-limit.
 * This implementation is single-process only and keeps counters in local memory, so limits
 * are not enforced across multiple Node.js processes, clusters, or containers. For horizontal
 * scaling, back the limiter with a shared data store (Redis or similar using INCR/TTL) or use
 * an external rate-limiting service. The architecture blueprint calls for express-rate-limit;
 * this implementation mirrors the behaviour and configuration surface while keeping dependencies
 * minimal.
 */
export function createGlobalRateLimiter(
  options: GlobalRateLimiterOptions
): GlobalRateLimiterMiddleware {
  const windowMs = Math.min(Math.max(options.windowMs, MIN_WINDOW_MS), MAX_WINDOW_MS);
  const maxRequests = Math.min(Math.max(options.maxRequests, MIN_REQUESTS), MAX_REQUESTS);

  if (options.windowMs !== windowMs) {
    logWarn('global-rate-limiter windowMs clamped to safe bounds', {
      requested: options.windowMs,
      applied: windowMs,
      min: MIN_WINDOW_MS,
      max: MAX_WINDOW_MS,
    });
  }

  if (options.maxRequests !== maxRequests) {
    logWarn('global-rate-limiter maxRequests clamped to safe bounds', {
      requested: options.maxRequests,
      applied: maxRequests,
      min: MIN_REQUESTS,
      max: MAX_REQUESTS,
    });
  }

  const keyGenerator =
    options.keyGenerator ||
    ((req: Request) => {
      const remoteAddr = req.ip || req.socket.remoteAddress || 'unknown';
      return remoteAddr === '::1' ? '127.0.0.1' : remoteAddr;
    });

  const store = new Map<string, RateLimitEntry>();
  const cleanupExpiredEntries = () => {
    const now = Date.now();
    for (const [key, entry] of store.entries()) {
      if (entry.resetTime <= now) {
        store.delete(key);
      }
    }
  };

  let cleanupInterval: ReturnType<typeof setInterval> | undefined;
  const startCleanup = () => {
    if (cleanupInterval) {
      return;
    }
    cleanupInterval = setInterval(cleanupExpiredEntries, CLEANUP_INTERVAL_MS);
    if (
      cleanupInterval &&
      typeof cleanupInterval === 'object' &&
      'unref' in cleanupInterval &&
      typeof (cleanupInterval as { unref?: () => void }).unref === 'function'
    ) {
      cleanupInterval.unref();
    }
  };

  const stopCleanup = () => {
    if (!cleanupInterval) {
      return;
    }
    clearInterval(cleanupInterval);
    cleanupInterval = undefined;
  };

  startCleanup();

  const globalRateLimiter: GlobalRateLimiterMiddleware = ((
    req: Request,
    res: Response,
    next: NextFunction
  ) => {
    const key = keyGenerator(req);
    const now = Date.now();

    const existing = store.get(key);
    const windowActive = !!existing && existing.resetTime > now;
    const resetTime = windowActive ? existing!.resetTime : now + windowMs;
    const previousCount = windowActive ? existing!.count : 0;
    const newCount = previousCount + 1;

    const updatedEntry: RateLimitEntry = {
      count: newCount,
      resetTime,
    };

    store.set(key, updatedEntry);

    res.setHeader('X-RateLimit-Limit', String(maxRequests));
    res.setHeader('X-RateLimit-Reset', new Date(resetTime).toISOString());

    if (newCount > maxRequests) {
      const retryAfterSeconds = Math.max(1, Math.ceil((resetTime - now) / 1000));
      res.setHeader('X-RateLimit-Remaining', '0');
      res.setHeader('Retry-After', String(retryAfterSeconds));
      res.status(DEFAULT_STATUS_CODE).json({
        error: {
          code: 'RATE_LIMIT_EXCEEDED',
          message: DEFAULT_MESSAGE,
          retryAfterSeconds,
          timestamp: new Date().toISOString(),
        },
      });
      return;
    }

    res.setHeader('X-RateLimit-Remaining', String(Math.max(0, maxRequests - newCount)));
    next();
  }) as GlobalRateLimiterMiddleware;

  globalRateLimiter.stopCleanup = stopCleanup;

  return globalRateLimiter;
}
