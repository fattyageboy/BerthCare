import { NextFunction, Request, Response } from 'express';

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

/**
 * Lightweight in-memory rate limiter used as a drop-in replacement for express-rate-limit.
 * The architecture blueprint calls for express-rate-limit; this implementation mirrors
 * the behaviour and configuration surface while keeping dependencies minimal.
 */
export function createGlobalRateLimiter(
  options: GlobalRateLimiterOptions
): GlobalRateLimiterMiddleware {
  const windowMs = Math.max(options.windowMs, 1000);
  const maxRequests = Math.max(options.maxRequests, 1);
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

    if (!existing || existing.resetTime <= now) {
      store.set(key, { count: 1, resetTime: now + windowMs });
      res.setHeader('X-RateLimit-Limit', String(maxRequests));
      res.setHeader('X-RateLimit-Remaining', String(maxRequests - 1));
      res.setHeader('X-RateLimit-Reset', new Date(now + windowMs).toISOString());
      next();
      return;
    }

    existing.count += 1;

    if (existing.count > maxRequests) {
      const retryAfterSeconds = Math.max(1, Math.ceil((existing.resetTime - now) / 1000));
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

    store.set(key, existing);
    res.setHeader('X-RateLimit-Limit', String(maxRequests));
    res.setHeader('X-RateLimit-Remaining', String(maxRequests - existing.count));
    res.setHeader('X-RateLimit-Reset', new Date(existing.resetTime).toISOString());
    next();
  }) as GlobalRateLimiterMiddleware;

  globalRateLimiter.stopCleanup = stopCleanup;

  return globalRateLimiter;
}
