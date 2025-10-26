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

interface SecretCacheEntry<T> {
  value: T;
  expiresAt: number;
}

const secretCache = new Map<string, SecretCacheEntry<unknown>>();
let secretsManagerClient: SecretsManagerClient | null = null;

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

  const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
  const sessionToken = process.env.AWS_SESSION_TOKEN;

  if (accessKeyId && secretAccessKey && accessKeyId !== 'test' && secretAccessKey !== 'test') {
    config.credentials = {
      accessKeyId,
      secretAccessKey,
      sessionToken,
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

  const cached = secretCache.get(secretId) as SecretCacheEntry<T> | undefined;
  if (cached && cached.expiresAt > Date.now()) {
    logDebug('Secrets Manager cache hit', {
      service: 'secrets-manager',
      secretId,
    });
    return cached.value;
  }

  logDebug('Fetching secret from AWS Secrets Manager', {
    service: 'secrets-manager',
    secretId,
  });

  try {
    const client = getSecretsManagerClient();
    const response = await client.send(new GetSecretValueCommand({ SecretId: secretId }));

    if (!response.SecretString) {
      throw new Error(`Secret ${secretId} does not contain a SecretString`);
    }

    const parsed = JSON.parse(response.SecretString) as T;
    secretCache.set(secretId, {
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
  }
}

/**
 * Clear cached secrets. Useful for tests.
 */
export function clearSecretCache(secretId?: string): void {
  if (secretId) {
    secretCache.delete(secretId);
  } else {
    secretCache.clear();
  }
}
