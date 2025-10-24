/**
 * Redis Rate Limiter Tests
 *
 * Tests atomic increment, TTL behavior, and error handling
 */

import { RedisRateLimiter } from '../src/utils/redis-rate-limiter';

// Mock Redis client
const mockRedisClient = {
  connect: jest.fn().mockResolvedValue(undefined),
  quit: jest.fn().mockResolvedValue(undefined),
  eval: jest.fn(),
  get: jest.fn(),
  del: jest.fn(),
  on: jest.fn(),
};

jest.mock('redis', () => ({
  createClient: jest.fn(() => mockRedisClient),
}));

describe('RedisRateLimiter', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Atomic Increments', () => {
    it('should increment counter atomically', async () => {
      // Mock Redis eval to return [count, ttl]
      mockRedisClient.eval.mockResolvedValueOnce([1, 3600000]); // First call
      mockRedisClient.eval.mockResolvedValueOnce([2, 3600000]); // Second call

      const limiter = new RedisRateLimiter({
        keyPrefix: 'test',
        limit: 10,
        windowMs: 3600000,
        useRedis: true,
      });

      // Wait for Redis to initialize
      await new Promise((resolve) => setTimeout(resolve, 100));

      const result1 = await limiter.checkAndIncrement('user1');
      expect(result1.allowed).toBe(true);
      expect(result1.current).toBe(1);

      const result2 = await limiter.checkAndIncrement('user1');
      expect(result2.allowed).toBe(true);
      expect(result2.current).toBe(2);

      await limiter.close();
    });

    it('should enforce limit after max requests', async () => {
      // Mock reaching the limit
      mockRedisClient.eval.mockResolvedValueOnce([10, 3600000]);
      mockRedisClient.eval.mockResolvedValueOnce([11, 3600000]); // Over limit

      const limiter = new RedisRateLimiter({
        keyPrefix: 'test',
        limit: 10,
        windowMs: 3600000,
        useRedis: true,
      });

      await new Promise((resolve) => setTimeout(resolve, 100));

      const result1 = await limiter.checkAndIncrement('user2');
      expect(result1.allowed).toBe(true);
      expect(result1.current).toBe(10);

      const result2 = await limiter.checkAndIncrement('user2');
      expect(result2.allowed).toBe(false);
      expect(result2.current).toBe(11);

      await limiter.close();
    });

    it('should maintain separate counters for different keys', async () => {
      mockRedisClient.eval
        .mockResolvedValueOnce([1, 3600000]) // user1
        .mockResolvedValueOnce([1, 3600000]) // user2
        .mockResolvedValueOnce([2, 3600000]) // user1
        .mockResolvedValueOnce([2, 3600000]); // user2

      const limiter = new RedisRateLimiter({
        keyPrefix: 'test',
        limit: 10,
        windowMs: 3600000,
        useRedis: true,
      });

      await new Promise((resolve) => setTimeout(resolve, 100));

      const result1a = await limiter.checkAndIncrement('user1');
      const result2a = await limiter.checkAndIncrement('user2');
      const result1b = await limiter.checkAndIncrement('user1');
      const result2b = await limiter.checkAndIncrement('user2');

      expect(result1a.current).toBe(1);
      expect(result2a.current).toBe(1);
      expect(result1b.current).toBe(2);
      expect(result2b.current).toBe(2);

      await limiter.close();
    });
  });

  describe('TTL Behavior', () => {
    it('should set TTL on first increment', async () => {
      // Mock Lua script execution
      mockRedisClient.eval.mockResolvedValueOnce([1, 3600000]);

      const limiter = new RedisRateLimiter({
        keyPrefix: 'test',
        limit: 10,
        windowMs: 3600000,
        useRedis: true,
      });

      await new Promise((resolve) => setTimeout(resolve, 100));

      const result = await limiter.checkAndIncrement('user3');

      expect(result.allowed).toBe(true);
      expect(result.current).toBe(1);
      expect(mockRedisClient.eval).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          keys: ['test:user3'],
          arguments: ['10', '3600000'],
        })
      );

      await limiter.close();
    });

    it('should return correct resetAt time based on TTL', async () => {
      const ttl = 1800000; // 30 minutes
      mockRedisClient.eval.mockResolvedValueOnce([5, ttl]);

      const limiter = new RedisRateLimiter({
        keyPrefix: 'test',
        limit: 10,
        windowMs: 3600000,
        useRedis: true,
      });

      await new Promise((resolve) => setTimeout(resolve, 100));

      const before = Date.now();
      const result = await limiter.checkAndIncrement('user4');
      const after = Date.now();

      const expectedResetMin = new Date(before + ttl);
      const expectedResetMax = new Date(after + ttl);

      expect(result.resetAt.getTime()).toBeGreaterThanOrEqual(expectedResetMin.getTime());
      expect(result.resetAt.getTime()).toBeLessThanOrEqual(expectedResetMax.getTime());

      await limiter.close();
    });
  });

  describe('Error Handling', () => {
    it('should fall back to in-memory when Redis fails to connect', async () => {
      const failingClient = {
        ...mockRedisClient,
        connect: jest.fn().mockRejectedValue(new Error('Connection failed')),
      };

      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const redis = require('redis');
      redis.createClient.mockReturnValueOnce(failingClient);

      const limiter = new RedisRateLimiter({
        keyPrefix: 'test',
        limit: 5,
        windowMs: 3600000,
        useRedis: true,
      });

      await new Promise((resolve) => setTimeout(resolve, 100));

      // Should use in-memory store
      const result1 = await limiter.checkAndIncrement('user5');
      expect(result1.allowed).toBe(true);
      expect(result1.current).toBe(1);

      const result2 = await limiter.checkAndIncrement('user5');
      expect(result2.allowed).toBe(true);
      expect(result2.current).toBe(2);

      await limiter.close();
    });

    it('should fall back to in-memory when Redis eval fails', async () => {
      mockRedisClient.eval.mockRejectedValueOnce(new Error('Redis error'));

      const limiter = new RedisRateLimiter({
        keyPrefix: 'test',
        limit: 5,
        windowMs: 3600000,
        useRedis: true,
        failOpen: false,
      });

      await new Promise((resolve) => setTimeout(resolve, 100));

      // First call fails, falls back to memory
      const result1 = await limiter.checkAndIncrement('user6');
      expect(result1.allowed).toBe(true);
      expect(result1.current).toBe(1);

      // Second call uses memory
      const result2 = await limiter.checkAndIncrement('user6');
      expect(result2.allowed).toBe(true);
      expect(result2.current).toBe(2);

      await limiter.close();
    });

    it('should fail open when configured and Redis fails', async () => {
      mockRedisClient.eval.mockRejectedValueOnce(new Error('Redis error'));

      const limiter = new RedisRateLimiter({
        keyPrefix: 'test',
        limit: 5,
        windowMs: 3600000,
        useRedis: true,
        failOpen: true,
      });

      await new Promise((resolve) => setTimeout(resolve, 100));

      const result = await limiter.checkAndIncrement('user7');

      // Should allow request even though Redis failed
      expect(result.allowed).toBe(true);
      expect(result.current).toBe(null); // Count is unknown when Redis fails
      expect(result.rateLimitUnavailable).toBe(true);

      await limiter.close();
    });
  });

  describe('In-Memory Fallback', () => {
    it('should use in-memory store when useRedis is false', async () => {
      const limiter = new RedisRateLimiter({
        keyPrefix: 'test',
        limit: 3,
        windowMs: 3600000,
        useRedis: false,
      });

      const result1 = await limiter.checkAndIncrement('user8');
      expect(result1.allowed).toBe(true);
      expect(result1.current).toBe(1);

      const result2 = await limiter.checkAndIncrement('user8');
      expect(result2.allowed).toBe(true);
      expect(result2.current).toBe(2);

      const result3 = await limiter.checkAndIncrement('user8');
      expect(result3.allowed).toBe(true);
      expect(result3.current).toBe(3);

      const result4 = await limiter.checkAndIncrement('user8');
      expect(result4.allowed).toBe(false);
      expect(result4.current).toBe(4);

      // Redis should never be called
      expect(mockRedisClient.connect).not.toHaveBeenCalled();

      await limiter.close();
    });

    it('should reset in-memory counter after window expires', async () => {
      jest.useFakeTimers();

      const limiter = new RedisRateLimiter({
        keyPrefix: 'test',
        limit: 5,
        windowMs: 60000, // 1 minute
        useRedis: false,
      });

      // Make 5 requests
      for (let i = 0; i < 5; i++) {
        await limiter.checkAndIncrement('user9');
      }

      // 6th should be blocked
      const blocked = await limiter.checkAndIncrement('user9');
      expect(blocked.allowed).toBe(false);

      // Advance time past window
      jest.advanceTimersByTime(61000);

      // Should be allowed again
      const allowed = await limiter.checkAndIncrement('user9');
      expect(allowed.allowed).toBe(true);
      expect(allowed.current).toBe(1);

      jest.useRealTimers();
      await limiter.close();
    });
  });

  describe('Utility Methods', () => {
    it('should get current count', async () => {
      mockRedisClient.get.mockResolvedValueOnce('5');

      const limiter = new RedisRateLimiter({
        keyPrefix: 'test',
        limit: 10,
        windowMs: 3600000,
        useRedis: true,
      });

      await new Promise((resolve) => setTimeout(resolve, 100));

      const count = await limiter.getCount('user10');
      expect(count).toBe(5);

      await limiter.close();
    });

    it('should reset counter', async () => {
      mockRedisClient.del.mockResolvedValueOnce(1);

      const limiter = new RedisRateLimiter({
        keyPrefix: 'test',
        limit: 10,
        windowMs: 3600000,
        useRedis: true,
      });

      await new Promise((resolve) => setTimeout(resolve, 100));

      await limiter.reset('user11');

      expect(mockRedisClient.del).toHaveBeenCalledWith('test:user11');

      await limiter.close();
    });
  });
});
