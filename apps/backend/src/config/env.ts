/**export const env = { * Environment Configuration
 *
 * Centralized, type-safe access to environment variables with sensible defaults
 * for development while still allowing production overrides. This is the single
 * source of truth for configuration across the backend.
 */

import fs from 'fs';
import path from 'path';

import dotenv from 'dotenv';
import type { PoolConfig } from 'pg';

type Optional<T> = T | undefined | null;

/**
 * Load environment variables once, searching common locations so developers
 * never have to fiddle with relative paths. First match wins.
 */
function loadEnvFiles(): void {
  if (process.env.__BERTHCARE_ENV_LOADED === 'true') {
    return;
  }

  const candidatePaths = [
    process.env.BERTHCARE_ENV_PATH,
    path.resolve(process.cwd(), '.env.local'),
    path.resolve(process.cwd(), '.env'),
    path.resolve(__dirname, '../../../.env.local'),
    path.resolve(__dirname, '../../../.env'),
    path.resolve(__dirname, '../../../../.env'),
  ].filter((candidate): candidate is string => Boolean(candidate));

  for (const candidate of candidatePaths) {
    if (fs.existsSync(candidate)) {
      dotenv.config({ path: candidate });
      process.env.__BERTHCARE_ENV_LOADED = 'true';
      return;
    }
  }

  // Fallback to default lookup if nothing matched
  dotenv.config();
  process.env.__BERTHCARE_ENV_LOADED = 'true';
}

loadEnvFiles();

function toNumber(value: Optional<string>, fallback: number): number {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toBoolean(value: Optional<string>, fallback: boolean): boolean {
  if (value === undefined || value === null) {
    return fallback;
  }
  const normalized = String(value).toLowerCase().trim();
  if (['true', '1', 'yes', 'y'].includes(normalized)) return true;
  if (['false', '0', 'no', 'n'].includes(normalized)) return false;
  return fallback;
}

const SENSITIVE_PLACEHOLDER = '<redacted>';

interface MaskOptions {
  showStart?: number;
  showEnd?: number;
  minLength?: number;
  placeholder?: string;
  maskCharCount?: number;
}

function maskSensitive(value: Optional<string>, options: MaskOptions = {}): string {
  const {
    showStart = 0,
    showEnd = 4,
    minLength = 6,
    placeholder = SENSITIVE_PLACEHOLDER,
    maskCharCount,
  } = options;

  if (!value) {
    return placeholder;
  }

  const trimmed = value.trim();
  if (!trimmed || trimmed.length < minLength || trimmed.length <= showStart + showEnd) {
    return placeholder;
  }

  const prefix = showStart > 0 ? trimmed.slice(0, showStart) : '';
  const suffix = showEnd > 0 ? trimmed.slice(-showEnd) : '';
  const maskedLength = Math.max(3, maskCharCount ?? 3);

  return `${prefix}${'*'.repeat(maskedLength)}${suffix}`;
}

export const env = {
  app: {
    nodeEnv: process.env.NODE_ENV || 'development',
    port: toNumber(process.env.PORT, 3000),
    version: process.env.APP_VERSION || '1.0.0',
    logLevel: process.env.LOG_LEVEL || 'info',
  },
  logging: {
    cloudwatchLogGroup: process.env.CLOUDWATCH_LOG_GROUP,
  },
  postgres: {
    url: process.env.DATABASE_URL,
    host: process.env.POSTGRES_HOST || 'localhost',
    port: toNumber(process.env.POSTGRES_PORT, 5432),
    database: process.env.POSTGRES_DB || 'berthcare_dev',
    user: process.env.POSTGRES_USER || 'berthcare',
    password: process.env.POSTGRES_PASSWORD || 'berthcare_dev_password',
    max: toNumber(process.env.DB_POOL_MAX, 10),
    min: toNumber(process.env.DB_POOL_MIN, 2),
    idleTimeoutMillis: toNumber(process.env.DB_IDLE_TIMEOUT_MS, 30000),
    connectionTimeoutMillis: toNumber(process.env.DB_CONNECTION_TIMEOUT_MS, 2000),
  },
  redis: {
    url: process.env.REDIS_URL || 'redis://localhost:6379',
    tls: toBoolean(process.env.REDIS_TLS_ENABLED, false),
  },
  geocoding: {
    apiKey: process.env.GOOGLE_MAPS_API_KEY,
    mode: process.env.GEOCODING_MODE || (process.env.GOOGLE_MAPS_API_KEY ? 'google' : 'local'),
  },
  aws: {
    region: process.env.AWS_REGION || 'ca-central-1',
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || 'test',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || 'test',
    endpoint: process.env.AWS_ENDPOINT,
    buckets: {
      photos: process.env.S3_BUCKET_PHOTOS || 'berthcare-photos-dev',
      documents: process.env.S3_BUCKET_DOCUMENTS || 'berthcare-documents-dev',
      signatures: process.env.S3_BUCKET_SIGNATURES || 'berthcare-signatures-dev',
    },
  },
  sentry: {
    dsn: process.env.SENTRY_DSN,
    tracesSampleRate: toNumber(process.env.SENTRY_TRACES_SAMPLE_RATE, 0.1),
    profilesSampleRate: toNumber(process.env.SENTRY_PROFILES_SAMPLE_RATE, 0.1),
  },
  twilio: {
    accountSid: process.env.TWILIO_ACCOUNT_SID || '',
    authToken: process.env.TWILIO_AUTH_TOKEN || '',
    phoneNumber: process.env.TWILIO_PHONE_NUMBER || '',
    // Default to http://localhost for local development, but production must use https
    webhookBaseUrl: process.env.TWILIO_WEBHOOK_BASE_URL || 'http://localhost:3000',
    secretId: process.env.TWILIO_SECRET_ID || '',
    // SMS rate limiter fail-open behavior
    // When true: Allow SMS when Redis is unavailable (prioritizes availability)
    // When false: Block SMS when Redis is unavailable (prioritizes security/rate limiting)
    // Production default: false (fail-closed) for standard SMS
    // Override to true for critical alerts where availability is paramount
    smsRateLimiterFailOpen: toBoolean(process.env.SMS_RATE_LIMITER_FAIL_OPEN, false),
  },
};

/**
 * Validate Twilio configuration
 * Ensures required credentials are present and webhook URLs use HTTPS in production
 */
function validateTwilioConfig(): void {
  const { accountSid, authToken, phoneNumber, webhookBaseUrl, secretId } = env.twilio;

  // Skip validation in test environment
  if (env.app.nodeEnv === 'test') {
    return;
  }

  // Check if Twilio is configured (at least one credential provided)
  const isDefaultWebhook =
    webhookBaseUrl === 'http://localhost:3000' ||
    webhookBaseUrl.includes('localhost') ||
    webhookBaseUrl.includes('127.0.0.1');

  const hasSecret = Boolean(secretId);
  const isTwilioConfigured = accountSid || authToken || phoneNumber || !isDefaultWebhook;
  const shouldValidate = hasSecret || isTwilioConfigured;

  if (shouldValidate) {
    if (!hasSecret) {
      // If any Twilio config is provided, all required fields must be present
      const missingFields: string[] = [];

      if (!accountSid) missingFields.push('TWILIO_ACCOUNT_SID');
      if (!authToken) missingFields.push('TWILIO_AUTH_TOKEN');
      if (!phoneNumber) missingFields.push('TWILIO_PHONE_NUMBER');

      if (missingFields.length > 0) {
        throw new Error(
          `Twilio integration is partially configured but missing required environment variables: ${missingFields.join(', ')}. ` +
            `Either provide all Twilio credentials or remove them to disable Twilio integration.`
        );
      }

      if (env.app.nodeEnv === 'development') {
        // eslint-disable-next-line no-console
        console.log('✅ Twilio integration configured:', {
          accountSid: maskSensitive(accountSid, { showStart: 4, showEnd: 2, minLength: 10 }),
          phoneNumber: maskSensitive(phoneNumber, { showEnd: 4, minLength: 8 }),
          webhookBaseUrlConfigured: Boolean(webhookBaseUrl),
        });
      }
    } else if (env.app.nodeEnv === 'development') {
      // eslint-disable-next-line no-console
      console.log('✅ Twilio integration configured via AWS Secrets Manager:', {
        secretId,
        webhookBaseUrlConfigured: Boolean(webhookBaseUrl),
      });
    }

    // Validate webhook URL uses HTTPS in non-local environments
    const isLocalhost =
      webhookBaseUrl.includes('localhost') || webhookBaseUrl.includes('127.0.0.1');

    if (!isLocalhost && !webhookBaseUrl.startsWith('https://')) {
      throw new Error(
        `TWILIO_WEBHOOK_BASE_URL must use HTTPS in production environments. ` +
          `Current value: ${webhookBaseUrl}. ` +
          `Use HTTPS or set to localhost for development.`
      );
    }
  } else if (env.app.nodeEnv === 'development') {
    // Twilio not configured - this is OK for development
    // eslint-disable-next-line no-console
    console.log('ℹ️  Twilio integration not configured (optional for development)');
  }
}

// Run validation on module load
validateTwilioConfig();

/**
 * Generate a pg Pool configuration that respects either DATABASE_URL or
 * discrete host credentials.
 */
export function getPostgresPoolConfig(overrides: Partial<PoolConfig> = {}): PoolConfig {
  const base: PoolConfig = {
    max: env.postgres.max,
    min: env.postgres.min,
    idleTimeoutMillis: env.postgres.idleTimeoutMillis,
    connectionTimeoutMillis: env.postgres.connectionTimeoutMillis,
    ...overrides,
  };

  if (env.postgres.url) {
    return {
      connectionString: env.postgres.url,
      ...base,
    };
  }

  return {
    host: env.postgres.host,
    port: env.postgres.port,
    database: env.postgres.database,
    user: env.postgres.user,
    password: env.postgres.password,
    ...base,
  };
}

export function getRedisClientConfig(): { url: string; socket?: { tls: boolean } } {
  const url = env.redis.url;
  if (!url) {
    throw new Error('Redis URL is required. Set REDIS_URL or TEST_REDIS_URL.');
  }

  const config: { url: string; socket?: { tls: boolean } } = { url };

  if (env.redis.tls) {
    config.socket = { tls: true };
  }

  return config;
}
