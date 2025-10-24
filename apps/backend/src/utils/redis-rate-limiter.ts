/**
 * Redis-backed Rate Limiter
 *
 * Provides atomic rate limiting using Redis INCR with TTL.
 * Suitable for multi-instance deployments where limits must be shared.
 *
 * Features:
 * - Atomic increment operations
 * - Automatic TTL management
 * - Fallback to in-memory for development
 * - Configurable fail-open/fail-closed on Redis errors
 *
 * Fail-Open vs Fail-Closed Trade-offs:
 *
 * FAIL-CLOSED (failOpen: false) - Default for production
 * - Security: Enforces rate limits even when Redis is unavailable
 * - Behavior: Blocks all requests when Redis fails
 * - Use case: Standard operations where rate limiting is critical
 * - Risk: Service unavailability during Redis outages
 *
 * FAIL-OPEN (failOpen: true) - For critical paths
 * - Availability: Allows requests to proceed when Redis is unavailable
 * - Behavior: Bypasses rate limiting when Redis fails (logs warning)
 * - Use case: Critical alerts, emergency notifications
 * - Risk: Potential rate limit bypass during Redis outages
 *
 * Configuration:
 * Set failOpen in constructor options based on your availability vs security requirements.
 * For SMS: Use SMS_RATE_LIMITER_FAIL_OPEN environment variable.
 */

import { createClient, RedisClientType } from 'redis';

import { getRedisClientConfig } from '../config/env';
import { logError, logWarn, logInfo } from '../config/logger';

/**
 * Rate limit result
 */
export interface RateLimitResult {
  allowed: boolean;
  current: number | null; // null when rate limit is unavailable (fail-open mode)
  limit: number;
  resetAt: Date;
  rateLimitUnavailable?: boolean; // true when Redis fails and fail-open is enabled
}

/**
 * Rate limiter configuration
 */
export interface RateLimiterConfig {
  keyPrefix: string;
  limit: number;
  windowMs: number;
  useRedis?: boolean;
  /**
   * Fail-open behavior when Redis is unavailable
   *
   * false (default): Fail-closed - Block requests when Redis fails (prioritizes security)
   * true: Fail-open - Allow requests when Redis fails (prioritizes availability)
   *
   * Choose based on your requirements:
   * - Standard operations: false (enforce rate limits)
   * - Critical alerts: true (ensure delivery)
   */
  failOpen?: boolean;
}

/**
 * In-memory rate limit entry
 */
interface MemoryRateLimitEntry {
  count: number;
  resetAt: Date;
}

/**
 * Redis-backed rate limiter with in-memory fallback
 */
export class RedisRateLimiter {
  private redisClient: RedisClientType | null = null;
  private redisInitialized = false;
  private memoryStore: Map<string, MemoryRateLimitEntry>;
  private config: Required<RateLimiterConfig>;
  private cleanupTimer: NodeJS.Timeout | null = null;
  private checkCounter = 0;

  /**
   * Create a new rate limiter
   *
   * @param config - Rate limiter configuration
   * @param config.failOpen - Fail-open behavior (default: false)
   *   - false: Fail-closed - Block requests when Redis fails (security priority)
   *   - true: Fail-open - Allow requests when Redis fails (availability priority)
   */
  constructor(config: RateLimiterConfig) {
    this.config = {
      useRedis: true,
      failOpen: false, // Default to fail-closed for security
      ...config,
    };
    this.memoryStore = new Map();

    if (this.config.useRedis) {
      this.initializeRedis().catch((error) => {
        logWarn('Failed to initialize Redis rate limiter, using in-memory fallback', {
          error: error instanceof Error ? error.message : String(error),
        });
      });
    }

    // Start periodic cleanup of expired entries (every 60 seconds)
    this.cleanupTimer = setInterval(() => {
      this.cleanupExpiredEntries();
    }, 60000);
  }

  /**
   * Initialize Redis client
   */
  private async initializeRedis(): Promise<void> {
    if (this.redisInitialized) {
      return;
    }

    try {
      const client = createClient(getRedisClientConfig()) as RedisClientType;

      client.on('error', (err) => {
        logError('Redis rate limiter error', err instanceof Error ? err : undefined, {
          message: 'Rate limiting may fall back to in-memory store',
        });
      });

      await client.connect();
      this.redisClient = client;
      this.redisInitialized = true;

      logInfo('Redis rate limiter initialized', {
        keyPrefix: this.config.keyPrefix,
      });
    } catch (error) {
      this.redisInitialized = true; // Don't retry
      logWarn('Redis rate limiter initialization failed', {
        error: error instanceof Error ? error.message : String(error),
        fallback: 'in-memory',
      });
    }
  }

  /**
   * Check and increment rate limit
   *
   * @param key - Unique identifier (e.g., userId)
   * @returns Rate limit result
   */
  async checkAndIncrement(key: string): Promise<RateLimitResult> {
    const fullKey = `${this.config.keyPrefix}:${key}`;

    // Try Redis first if available
    if (this.redisClient) {
      try {
        return await this.checkAndIncrementRedis(fullKey);
      } catch (error) {
        logError('Redis rate limit check failed', error instanceof Error ? error : undefined, {
          key: fullKey,
          failOpen: this.config.failOpen,
        });

        // Fail open or closed based on config
        if (this.config.failOpen) {
          return {
            allowed: true,
            current: null, // Count is unknown when Redis fails
            limit: this.config.limit,
            resetAt: new Date(Date.now() + this.config.windowMs),
            rateLimitUnavailable: true,
          };
        }
      }
    }

    // Fallback to in-memory
    return this.checkAndIncrementMemory(fullKey);
  }

  /**
   * Check and increment using Redis
   */
  private async checkAndIncrementRedis(key: string): Promise<RateLimitResult> {
    if (!this.redisClient) {
      throw new Error('Redis client not initialized');
    }

    // Use Lua script for atomic check-and-increment with TTL
    const script = `
      local key = KEYS[1]
      local limit = tonumber(ARGV[1])
      local window = tonumber(ARGV[2])
      
      local current = redis.call('INCR', key)
      
      if current == 1 then
        redis.call('PEXPIRE', key, window)
      end
      
      local ttl = redis.call('PTTL', key)
      if ttl == -1 then
        redis.call('PEXPIRE', key, window)
        ttl = window
      end
      
      return {current, ttl}
    `;

    const result = (await this.redisClient.eval(script, {
      keys: [key],
      arguments: [this.config.limit.toString(), this.config.windowMs.toString()],
    })) as [number, number];

    const [current, ttl] = result;
    const resetAt = new Date(Date.now() + ttl);

    return {
      allowed: current <= this.config.limit,
      current,
      limit: this.config.limit,
      resetAt,
    };
  }

  /**
   * Check and increment using in-memory store
   */
  private checkAndIncrementMemory(key: string): RateLimitResult {
    const now = new Date();
    const entry = this.memoryStore.get(key);

    if (!entry || now >= entry.resetAt) {
      // Delete expired entry immediately if it exists
      if (entry && now >= entry.resetAt) {
        this.memoryStore.delete(key);
      }

      // Create new entry
      const resetAt = new Date(now.getTime() + this.config.windowMs);
      this.memoryStore.set(key, { count: 1, resetAt });

      return {
        allowed: true,
        current: 1,
        limit: this.config.limit,
        resetAt,
      };
    }

    // Increment existing entry
    entry.count++;

    // Deterministic cleanup: triggers every 100 checks (~1% of operations)
    this.checkCounter++;
    if (this.checkCounter % 100 === 0) {
      // Run cleanup asynchronously to not block the current check
      setImmediate(() => this.cleanupExpiredEntries());
    }

    return {
      allowed: entry.count <= this.config.limit,
      current: entry.count,
      limit: this.config.limit,
      resetAt: entry.resetAt,
    };
  }

  /**
   * Get current count for a key
   */
  async getCount(key: string): Promise<number> {
    const fullKey = `${this.config.keyPrefix}:${key}`;

    if (this.redisClient) {
      try {
        const count = await this.redisClient.get(fullKey);
        return count ? parseInt(count, 10) : 0;
      } catch (error) {
        logError('Redis get count failed', error instanceof Error ? error : undefined);
      }
    }

    // Fallback to memory
    const entry = this.memoryStore.get(fullKey);
    if (!entry || new Date() >= entry.resetAt) {
      return 0;
    }
    return entry.count;
  }

  /**
   * Reset rate limit for a key
   */
  async reset(key: string): Promise<void> {
    const fullKey = `${this.config.keyPrefix}:${key}`;

    if (this.redisClient) {
      try {
        await this.redisClient.del(fullKey);
      } catch (error) {
        logError('Redis reset failed', error instanceof Error ? error : undefined);
      }
    }

    this.memoryStore.delete(fullKey);
  }

  /**
   * Clean up expired entries from in-memory store
   */
  private cleanupExpiredEntries(): void {
    const now = new Date();
    let deletedCount = 0;

    for (const [key, entry] of this.memoryStore.entries()) {
      if (now >= entry.resetAt) {
        this.memoryStore.delete(key);
        deletedCount++;
      }
    }

    if (deletedCount > 0) {
      logInfo('Cleaned up expired rate limit entries', {
        deletedCount,
        remainingCount: this.memoryStore.size,
      });
    }
  }

  /**
   * Close Redis connection
   */
  async close(): Promise<void> {
    // Clear cleanup timer
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }

    if (this.redisClient) {
      try {
        await this.redisClient.quit();
        logInfo('Redis rate limiter closed');
      } catch (error) {
        logError('Error closing Redis rate limiter', error instanceof Error ? error : undefined);
      }
    }
  }
}
