import type { RedisClient } from './redis-client';

/**
 * Delete Redis keys matching a pattern in batches.
 * Uses SCAN to avoid blocking Redis and handles non-string key responses defensively.
 *
 * @param redisClient Redis client instance
 * @param pattern SCAN match pattern (e.g., `clients:list:zone=*`)
 * @param batchSize Number of keys to delete per batch (default 500)
 */
export async function deleteKeysMatchingPattern(
  redisClient: RedisClient,
  pattern: string,
  batchSize: number = 500
): Promise<void> {
  const keysBatch: string[] = [];

  for await (const key of redisClient.scanIterator({
    MATCH: pattern,
    COUNT: batchSize,
  })) {
    const normalizedKey = typeof key === 'string' ? key : key.toString();
    keysBatch.push(normalizedKey);

    if (keysBatch.length >= batchSize) {
      await redisClient.del(...keysBatch);
      keysBatch.length = 0;
    }
  }

  if (keysBatch.length > 0) {
    await redisClient.del(...keysBatch);
  }
}
