/**
 * AWS Secrets Manager Utilities
 *
 * Lightweight helper for fetching and caching secrets. Keeps the implementation
 * focused on clarity: fetch secret → parse JSON → cache. No magic, just
 * invisible plumbing so the product stays simple for developers.
 */

import type { SecretsManagerClientConfig } from '@aws-sdk/client-secrets-manager';
import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';

import { env } from '../config/env';
import { logDebug, logError } from '../config/logger';

const SECRET_CACHE_DEFAULT_TTL_MS = 5 * 60 * 1000; // 5 minutes
const SECRET_CACHE_MAX_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const SECRET_CACHE_CLEANUP_DEFAULT_INTERVAL_MS = 60 * 1000; // 1 minute
const SECRET_CACHE_MAX_SIZE = 100;

interface SecretCacheEntry<T> {
  value: T;
  expiresAt: number;
}

const secretCache = new Map<string, SecretCacheEntry<unknown>>();
const pendingRequests = new Map<string, Promise<unknown>>();
let secretsManagerClient: SecretsManagerClient | null = null;
let cacheCleanupTimer: NodeJS.Timeout | null = null;

function touchCacheEntry(secretId: string): void {
  const entry = secretCache.get(secretId);
  if (!entry) {
    return;
  }
  secretCache.delete(secretId);
  secretCache.set(secretId, entry);
}

function setCacheEntry<T>(secretId: string, entry: SecretCacheEntry<T>): void {
  if (!secretCache.has(secretId) && secretCache.size >= SECRET_CACHE_MAX_SIZE) {
    const lruKey = secretCache.keys().next().value as string | undefined;
    if (lruKey) {
      secretCache.delete(lruKey);
      logDebug('Secrets Manager cache eviction (LRU)', {
        service: 'secrets-manager',
        evictedSecretId: lruKey,
      });
    }
  }

  secretCache.set(secretId, entry);
}

function getSecretsManagerClient(): SecretsManagerClient {
  if (secretsManagerClient) {
    return secretsManagerClient;
  }

  const config: SecretsManagerClientConfig = {
    region: env.aws.region,
  };

  if (env.aws.endpoint) {
    config.endpoint = env.aws.endpoint;
  }

  const { accessKeyId, secretAccessKey, sessionToken } = env.aws;

  if (accessKeyId && secretAccessKey) {
    config.credentials = {
      accessKeyId,
      secretAccessKey,
      sessionToken: sessionToken || undefined,
    };
  }

  secretsManagerClient = new SecretsManagerClient(config);
  return secretsManagerClient;
}

/**
 * Fetch a JSON secret from AWS Secrets Manager with simple in-memory caching.
 */
export async function fetchJsonSecret<T = Record<string, unknown>>(
  secretId: string,
  cacheTtlMs: number = SECRET_CACHE_DEFAULT_TTL_MS
): Promise<T> {
  if (!secretId) {
    throw new Error('Secret ID is required');
  }

  // Validate and sanitize cacheTtlMs
  if (typeof cacheTtlMs !== 'number' || !Number.isFinite(cacheTtlMs) || cacheTtlMs <= 0) {
    logDebug('Invalid cacheTtlMs provided, using default', {
      service: 'secrets-manager',
      providedValue: cacheTtlMs,
      defaultValue: SECRET_CACHE_DEFAULT_TTL_MS,
    });
    cacheTtlMs = SECRET_CACHE_DEFAULT_TTL_MS;
  } else {
    // Round to nearest integer for consistency
    cacheTtlMs = Math.round(cacheTtlMs);

    // Clamp to maximum TTL
    if (cacheTtlMs > SECRET_CACHE_MAX_TTL_MS) {
      logDebug('cacheTtlMs exceeds maximum, clamping to max', {
        service: 'secrets-manager',
        providedValue: cacheTtlMs,
        maxValue: SECRET_CACHE_MAX_TTL_MS,
      });
      cacheTtlMs = SECRET_CACHE_MAX_TTL_MS;
    }
  }

  const cached = secretCache.get(secretId) as SecretCacheEntry<T> | undefined;
  if (cached && cached.expiresAt > Date.now()) {
    logDebug('Secrets Manager cache hit', {
      service: 'secrets-manager',
      secretId,
    });
    touchCacheEntry(secretId);
    return cached.value;
  }

  // Check if there's already a pending request for this secret
  const pending = pendingRequests.get(secretId);
  if (pending) {
    logDebug('Secrets Manager request deduplication', {
      service: 'secrets-manager',
      secretId,
    });
    return pending as Promise<T>;
  }

  logDebug('Fetching secret from AWS Secrets Manager', {
    service: 'secrets-manager',
    secretId,
  });

  // Create and store the fetch promise to deduplicate concurrent requests
  const fetchPromise = (async () => {
    try {
      const client = getSecretsManagerClient();
      const response = await client.send(new GetSecretValueCommand({ SecretId: secretId }));

      if (!response.SecretString) {
        throw new Error(`Secret ${secretId} does not contain a SecretString`);
      }

      const parsed = JSON.parse(response.SecretString) as T;
      setCacheEntry(secretId, {
        value: parsed,
        expiresAt: Date.now() + cacheTtlMs,
      });

      return parsed;
    } catch (error) {
      logError(
        'Failed to fetch secret from AWS Secrets Manager',
        error instanceof Error ? error : undefined,
        { secretId }
      );
      throw error instanceof Error
        ? error
        : new Error(`Failed to fetch secret ${secretId}: ${String(error)}`);
    } finally {
      // Clean up pending request after completion (success or failure)
      pendingRequests.delete(secretId);
    }
  })();

  pendingRequests.set(secretId, fetchPromise);
  return fetchPromise;
}

/**
 * Clear cached secrets. Useful for tests.
 */
export function clearSecretCache(secretId?: string): void {
  if (secretId) {
    secretCache.delete(secretId);
    pendingRequests.delete(secretId);
  } else {
    secretCache.clear();
    pendingRequests.clear();
  }
}

/**
 * Start periodic cleanup of expired cache entries.
 *
 * Idempotent: calling multiple times will only register one interval.
 */
export function startSecretCacheCleanup(
  intervalMs: number = SECRET_CACHE_CLEANUP_DEFAULT_INTERVAL_MS
): void {
  if (cacheCleanupTimer) {
    return;
  }

  // Validate intervalMs
  if (typeof intervalMs !== 'number' || !Number.isFinite(intervalMs) || intervalMs <= 0) {
    logDebug('Invalid intervalMs provided, using default', {
      service: 'secrets-manager',
      providedValue: intervalMs,
      defaultValue: SECRET_CACHE_CLEANUP_DEFAULT_INTERVAL_MS,
    });
    intervalMs = SECRET_CACHE_CLEANUP_DEFAULT_INTERVAL_MS;
  }

  cacheCleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [secretId, entry] of secretCache.entries()) {
      if (entry.expiresAt <= now) {
        secretCache.delete(secretId);
      }
    }
  }, intervalMs);

  // Allow process to exit naturally if this is the only pending timer.
  if (typeof cacheCleanupTimer.unref === 'function') {
    cacheCleanupTimer.unref();
  }
}

/**
 * Stop the cache cleanup interval if it is running.
 */
export function stopSecretCacheCleanup(): void {
  if (cacheCleanupTimer) {
    clearInterval(cacheCleanupTimer);
    cacheCleanupTimer = null;
  }
}
