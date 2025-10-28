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
  rateLimitUnavailable?: boolean; // true when Redis is unavailable
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
  private static readonly MIN_RECONNECT_DELAY_MS = 1000;
  private static readonly MAX_RECONNECT_DELAY_MS = 60000;

  private redisClient: RedisClientType | null = null;
  private redisInitialized = false;
  private redisConnecting = false;
  private readonly initializationPromise: Promise<void>;
  private memoryStore: Map<string, MemoryRateLimitEntry>;
  private config: Required<RateLimiterConfig>;
  private cleanupTimer: NodeJS.Timeout | null = null;
  private checkCounter = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private reconnectAttempts = 0;
  private isShuttingDown = false;

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

    this.validateConfig(this.config);
    this.memoryStore = new Map();

    if (this.config.useRedis) {
      this.initializationPromise = this.initializeRedis();
    } else {
      this.initializationPromise = Promise.resolve();
    }

    // Start periodic cleanup of expired entries (every 60 seconds)
    this.cleanupTimer = setInterval(() => {
      this.cleanupExpiredEntries();
    }, 60000);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private scheduleReconnect(reason: string, error?: unknown): void {
    if (!this.config.useRedis || this.isShuttingDown) {
      return;
    }

    if (this.reconnectTimer) {
      return;
    }

    const delay = Math.min(
      RedisRateLimiter.MIN_RECONNECT_DELAY_MS * Math.pow(2, this.reconnectAttempts),
      RedisRateLimiter.MAX_RECONNECT_DELAY_MS
    );
    const attempt = this.reconnectAttempts + 1;

    logWarn('Redis rate limiter scheduling reconnect', {
      reason,
      attempt,
      delayMs: delay,
      strategy: this.config.failOpen ? 'fail-open' : 'fail-closed',
      action: this.config.failOpen ? 'allowing requests' : 'blocking requests',
      keyPrefix: this.config.keyPrefix,
      error: error instanceof Error ? error.message : error ? String(error) : undefined,
    });

    this.reconnectAttempts = attempt;

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      logInfo('Redis rate limiter reconnect attempt starting', {
        attempt: this.reconnectAttempts,
        keyPrefix: this.config.keyPrefix,
      });
      void this.initializeRedis();
    }, delay);
  }

  private handleRedisDisconnection(reason: string, error?: unknown): void {
    if (this.isShuttingDown || !this.redisClient) {
      return;
    }

    const client = this.redisClient;

    logWarn('Redis rate limiter connection lost', {
      reason,
      keyPrefix: this.config.keyPrefix,
      strategy: this.config.failOpen ? 'fail-open' : 'fail-closed',
      action: this.config.failOpen ? 'allowing requests' : 'blocking requests',
      error: error instanceof Error ? error.message : error ? String(error) : undefined,
    });

    this.redisClient = null;
    this.redisInitialized = false;
    this.redisConnecting = false;

    this.removeClientListeners(client);

    this.scheduleReconnect(`disconnected (${reason})`, error);
  }

  private removeClientListeners(client: RedisClientType): void {
    const maybeEmitter = client as unknown as { removeAllListeners?: () => void };
    if (typeof maybeEmitter.removeAllListeners === 'function') {
      maybeEmitter.removeAllListeners();
    }
  }

  private validateConfig(config: Required<RateLimiterConfig>): void {
    if (typeof config.limit !== 'number' || !Number.isFinite(config.limit) || config.limit <= 0) {
      throw new Error('Invalid rate limiter config: limit must be a positive number');
    }

    if (!Number.isInteger(config.limit)) {
      throw new Error('Invalid rate limiter config: limit must be an integer');
    }

    if (
      typeof config.windowMs !== 'number' ||
      !Number.isFinite(config.windowMs) ||
      config.windowMs <= 0
    ) {
      throw new Error('Invalid rate limiter config: windowMs must be a positive number');
    }
  }

  /**
   * Wait until initialization completes (Redis connected or fallback active)
   */
  async waitForReady(): Promise<void> {
    await this.initializationPromise;
  }

  /**
   * Initialize Redis client
   */
  private async initializeRedis(): Promise<void> {
    if (
      !this.config.useRedis ||
      this.redisInitialized ||
      this.redisConnecting ||
      this.isShuttingDown
    ) {
      return;
    }

    this.redisConnecting = true;
    let client: RedisClientType | null = null;

    try {
      client = createClient(getRedisClientConfig()) as RedisClientType;

      client.on('error', (err) => {
        logError('Redis rate limiter error', err instanceof Error ? err : undefined, {
          message: 'Rate limiting may fall back to in-memory store',
        });

        if (!client || !client.isOpen) {
          this.handleRedisDisconnection('error', err);
        }
      });

      client.on('end', () => this.handleRedisDisconnection('end'));
      client.on('close', () => this.handleRedisDisconnection('close'));

      await client.connect();
      this.redisClient = client;
      this.redisInitialized = true;
      const previousAttempts = this.reconnectAttempts;
      this.reconnectAttempts = 0;
      this.clearReconnectTimer();

      const logContext: Record<string, unknown> = {
        keyPrefix: this.config.keyPrefix,
      };

      if (previousAttempts > 0) {
        logContext.retries = previousAttempts;
        logInfo('Redis rate limiter reconnected', logContext);
      } else {
        logInfo('Redis rate limiter initialized', logContext);
      }
    } catch (error) {
      if (client) {
        try {
          this.removeClientListeners(client);
          await client.disconnect();
        } catch {
          // ignore cleanup errors during retry
        }
      }

      this.redisClient = null;
      this.redisInitialized = false;

      logWarn('Redis rate limiter initialization failed', {
        error: error instanceof Error ? error.message : String(error),
        strategy: this.config.failOpen ? 'fail-open' : 'fail-closed',
        action: this.config.failOpen ? 'allowing requests' : 'blocking requests',
        keyPrefix: this.config.keyPrefix,
      });

      this.scheduleReconnect('initialization failed', error);
    } finally {
      this.redisConnecting = false;
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

        return this.handleRedisFailure();
      }
    }

    if (this.config.useRedis) {
      return this.handleRedisFailure();
    }

    // Use in-memory store only when Redis is disabled
    return this.checkAndIncrementMemory(fullKey);
  }

  /**
   * Generate a result when Redis is unavailable based on fail-open/closed mode.
   */
  private handleRedisFailure(): RateLimitResult {
    if (this.config.failOpen) {
      return this.createUnavailableResult(true);
    }
    return this.createUnavailableResult(false);
  }

  private createUnavailableResult(allowed: boolean): RateLimitResult {
    return {
      allowed,
      current: null,
      limit: this.config.limit,
      resetAt: new Date(Date.now() + this.config.windowMs),
      rateLimitUnavailable: true,
    };
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
      if (entry) {
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

    this.isShuttingDown = true;
    this.clearReconnectTimer();

    if (this.redisClient) {
      try {
        const client = this.redisClient;
        this.redisClient = null;
        this.redisInitialized = false;
        this.redisConnecting = false;

        this.removeClientListeners(client);

        await client.quit();
        logInfo('Redis rate limiter closed');
      } catch (error) {
        logError('Error closing Redis rate limiter', error instanceof Error ? error : undefined);
      }
    }

    // Allow reuse after shutdown cleanup if needed
    setImmediate(() => {
      this.isShuttingDown = false;
      this.reconnectAttempts = 0;
    });
  }
}
