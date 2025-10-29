/**
 * Twilio SMS Service
 *
 * Handles SMS messaging for family portal and backup alerts.
 * Keeps credentials invisible (AWS Secrets) and enforces per-user rate limits.
 */

import { Twilio } from 'twilio';
import { validateRequest } from 'twilio/lib/webhooks/webhooks';

import { env } from '../config/env';
import { logDebug, logError, logInfo } from '../config/logger';
import { fetchJsonSecret } from '../utils/aws-secrets-manager';
import { RedisRateLimiter } from '../utils/redis-rate-limiter';

/**
 * SMS delivery status from Twilio webhooks.
 * Includes full set of documented statuses for robustness.
 */
export type SMSStatus =
  | 'accepted'
  | 'queued'
  | 'sending'
  | 'sent'
  | 'delivered'
  | 'undelivered'
  | 'failed'
  | 'receiving'
  | 'received'
  | 'read'
  | 'canceled'
  | 'scheduled'
  | 'partially_delivered';

/**
 * SMS send result
 */
export interface SMSResult {
  messageSid: string;
  status: SMSStatus;
  to: string;
  from: string;
  body: string;
  sentAt: Date;
}

/**
 * SMS event for logging
 */
export interface SMSEvent {
  messageSid: string;
  status: SMSStatus;
  to: string;
  from: string;
  body?: string;
  bodyLength?: number;
  timestamp: Date;
  errorCode?: string;
  errorMessage?: string;
}

/**
 * Rate limiter configuration options
 */
export interface SMSRateLimiterOptions {
  useRedis?: boolean;
  failOpen?: boolean;
}

/**
 * Twilio SMS Service error
 */
export class TwilioSMSError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = 'TwilioSMSError';
  }
}

const DEFAULT_SECRET_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

interface TwilioSMSCredentials {
  accountSid: string;
  authToken: string;
  phoneNumber: string;
}

interface TwilioSMSSecretPayload {
  account_sid?: string;
  auth_token?: string;
  phone_number?: string;
  accountSid?: string;
  authToken?: string;
  phoneNumber?: string;
}

export type TwilioSecretLoader = (
  secretId: string,
  cacheTtlMs?: number
) => Promise<TwilioSMSSecretPayload>;

export interface TwilioSMSServiceOptions {
  accountSid?: string;
  authToken?: string;
  fromNumber?: string;
  webhookBaseUrl?: string;
  secretId?: string;
  secretsLoader?: TwilioSecretLoader;
  secretCacheTtlMs?: number;
  rateLimiter?: SMSRateLimiterOptions;
}

const defaultSecretsLoader: TwilioSecretLoader = (secretId, cacheTtlMs) =>
  fetchJsonSecret<TwilioSMSSecretPayload>(secretId, cacheTtlMs);

/**
 * Twilio SMS Service
 *
 * Manages SMS operations for family portal and backup alerts.
 * - Initializes Twilio client lazily (loads credentials from env or AWS Secrets Manager)
 * - Enforces 100 SMS/hour/user via Redis-backed rate limiter
 * - Logs every SMS lifecycle event for observability
 */
export class TwilioSMSService {
  private client: Twilio | null = null;
  private authToken?: string;
  private accountSid?: string;
  private fromNumber?: string;
  private webhookBaseUrl: string;
  private readonly secretId?: string;
  private readonly secretsLoader: TwilioSecretLoader;
  private readonly secretCacheTtlMs: number;
  private credentials?: TwilioSMSCredentials;
  private credentialsPromise?: Promise<TwilioSMSCredentials>;
  private readonly rateLimiter: RedisRateLimiter;
  private readonly MAX_SMS_PER_HOUR = 100;

  constructor(options: TwilioSMSServiceOptions = {}) {
    const defaults = env.twilio;

    this.accountSid = options.accountSid ?? (defaults.accountSid || undefined);
    this.authToken = options.authToken ?? (defaults.authToken || undefined);
    this.fromNumber = options.fromNumber ?? (defaults.phoneNumber || undefined);
    this.webhookBaseUrl = this.normalizeWebhookBaseUrl(
      options.webhookBaseUrl ?? defaults.webhookBaseUrl
    );
    this.secretId = options.secretId ?? (defaults.secretId || undefined);
    this.secretsLoader = options.secretsLoader ?? defaultSecretsLoader;
    this.secretCacheTtlMs = options.secretCacheTtlMs ?? DEFAULT_SECRET_CACHE_TTL_MS;

    const limiterOptions = options.rateLimiter ?? {};

    this.rateLimiter = new RedisRateLimiter({
      keyPrefix: 'sms:ratelimit',
      limit: this.MAX_SMS_PER_HOUR,
      windowMs: 60 * 60 * 1000,
      useRedis: limiterOptions.useRedis ?? env.app.nodeEnv === 'production',
      failOpen: limiterOptions.failOpen ?? env.twilio.smsRateLimiterFailOpen,
    });

    // If credentials are provided directly, initialize Twilio client immediately.
    if (this.accountSid && this.authToken && this.fromNumber) {
      this.credentials = {
        accountSid: this.accountSid,
        authToken: this.authToken,
        phoneNumber: this.fromNumber,
      };
      this.client = new Twilio(this.accountSid, this.authToken);
    }
  }

  /**
   * Force refresh the Twilio client and credentials.
   * Clears cached client and credentials so the next call will recreate them.
   * Useful for forcing credential rotation without waiting for automatic detection.
   */
  forceRefreshClient(): void {
    this.client = null;
    this.credentials = undefined;
    this.credentialsPromise = undefined;
  }

  /**
   * Send SMS message.
   * @param to Recipient number (E.164)
   * @param message Message body (<=1600 chars)
   * @param userId Optional ID used for per-user rate limiting
   */
  async sendSMS(to: string, message: string, userId?: string): Promise<SMSResult> {
    if (!to || !to.match(/^\+[1-9]\d{0,14}$/)) {
      throw new TwilioSMSError(
        'Invalid phone number format (must be E.164)',
        'INVALID_PHONE_NUMBER',
        { to }
      );
    }

    if (!message || message.trim().length === 0) {
      throw new TwilioSMSError('Message body cannot be empty', 'INVALID_MESSAGE_BODY');
    }

    if (message.length > 1600) {
      throw new TwilioSMSError('Message body too long (max 1600 characters)', 'MESSAGE_TOO_LONG', {
        length: message.length,
      });
    }

    // Validate configuration before consuming rate limit slot
    const client = await this.ensureClient();
    const fromNumber = this.fromNumber;
    if (!fromNumber) {
      throw new TwilioSMSError('Twilio phone number not configured', 'CONFIGURATION_ERROR');
    }

    // Only consume rate limit slot after configuration validation passes
    if (userId) {
      await this.checkAndIncrementRateLimit(userId);
    }

    try {
      const sms = await client.messages.create({
        to,
        from: fromNumber,
        body: message,
        statusCallback: this.buildStatusCallbackUrl(),
      });

      const status = this.normalizeStatus(sms.status);
      const result: SMSResult = {
        messageSid: sms.sid,
        status,
        to: sms.to ?? to,
        from: sms.from ?? fromNumber,
        body: message,
        sentAt: new Date(),
      };

      this.logSMSEvent({
        messageSid: result.messageSid,
        status: result.status,
        to: this.maskPhoneNumber(result.to),
        from: this.maskPhoneNumber(result.from),
        bodyLength: message?.length ?? 0,
        timestamp: result.sentAt,
      });

      return result;
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error) {
        const twilioError = error as { code: number; message: string };

        if (twilioError.code === 21211) {
          throw new TwilioSMSError('Invalid phone number', 'INVALID_PHONE_NUMBER', {
            to,
            error: twilioError.message,
          });
        }

        if (twilioError.code === 21608) {
          throw new TwilioSMSError(
            'Phone number not verified (sandbox mode)',
            'UNVERIFIED_NUMBER',
            {
              to,
              error: twilioError.message,
            }
          );
        }

        if (twilioError.code === 21610) {
          throw new TwilioSMSError('Phone number has opted out', 'OPTED_OUT', {
            to,
            error: twilioError.message,
          });
        }

        throw new TwilioSMSError('Twilio API error', 'TWILIO_API_ERROR', {
          code: twilioError.code,
          message: twilioError.message,
          to,
        });
      }

      throw new TwilioSMSError('Failed to send SMS', 'SMS_SEND_FAILED', {
        to,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Process SMS delivery status webhook from Twilio.
   */
  processSMSStatusWebhook(webhookData: Record<string, unknown>): SMSEvent {
    const messageSid = String(webhookData.MessageSid || webhookData.SmsSid || '');
    const statusRaw = String(webhookData.MessageStatus || webhookData.SmsStatus || '');
    const status = this.normalizeStatus(statusRaw);
    const to = String(webhookData.To || '');
    const from = String(webhookData.From || '');
    const body = webhookData.Body ? String(webhookData.Body) : undefined;
    const errorCode = webhookData.ErrorCode ? String(webhookData.ErrorCode) : undefined;
    const errorMessage = webhookData.ErrorMessage ? String(webhookData.ErrorMessage) : undefined;

    if (messageSid.trim() === '') {
      logError('Invalid SMS webhook: missing messageSid', undefined, {
        service: 'twilio-sms',
        to: this.maskPhoneNumber(to),
        from: this.maskPhoneNumber(from),
        hasBody: !!body,
      });
      throw new TwilioSMSError(
        'Invalid SMS webhook: messageSid is required',
        'INVALID_WEBHOOK_DATA',
        { to: this.maskPhoneNumber(to), from: this.maskPhoneNumber(from) }
      );
    }

    if (statusRaw.trim() === '') {
      logError('Invalid SMS webhook: missing status', undefined, {
        service: 'twilio-sms',
        messageSid,
        to: this.maskPhoneNumber(to),
        from: this.maskPhoneNumber(from),
        hasBody: !!body,
      });
      throw new TwilioSMSError('Invalid SMS webhook: status is required', 'INVALID_WEBHOOK_DATA', {
        messageSid,
        to: this.maskPhoneNumber(to),
        from: this.maskPhoneNumber(from),
      });
    }

    const event: SMSEvent = {
      messageSid,
      status,
      to,
      from,
      body,
      timestamp: new Date(),
      errorCode,
      errorMessage,
    };

    const maskedEvent: SMSEvent = {
      ...event,
      to: this.maskPhoneNumber(event.to),
      from: this.maskPhoneNumber(event.from),
      body: undefined,
    };

    this.logSMSEvent(maskedEvent);
    return event;
  }

  /**
   * Validate Twilio webhook signature.
   */
  async validateWebhookSignature(
    signature: string,
    url: string,
    params: Record<string, string>
  ): Promise<boolean> {
    try {
      const credentials = await this.ensureCredentials();
      return validateRequest(credentials.authToken, signature, url, params);
    } catch (error) {
      logError('Webhook signature validation error', error instanceof Error ? error : undefined, {
        service: 'twilio-sms',
        url,
      });
      return false;
    }
  }

  /**
   * Get current SMS count for user.
   */
  async getSMSCount(userId: string): Promise<number> {
    return this.rateLimiter.getCount(userId);
  }

  /**
   * Reset rate limit for user (admin/testing use).
   */
  async resetRateLimit(userId: string): Promise<void> {
    await this.rateLimiter.reset(userId);
    logInfo('SMS rate limit reset', { userId });
  }

  /**
   * Close rate limiter connections (for graceful shutdown).
   */
  async close(): Promise<void> {
    await this.rateLimiter.close();
  }

  private async checkAndIncrementRateLimit(userId: string): Promise<void> {
    const result = await this.rateLimiter.checkAndIncrement(userId);

    if (!result.allowed) {
      const now = new Date();
      const minutesRemaining = Math.ceil((result.resetAt.getTime() - now.getTime()) / 60000);

      throw new TwilioSMSError(
        `Rate limit exceeded: ${this.MAX_SMS_PER_HOUR} SMS per hour`,
        'RATE_LIMIT_EXCEEDED',
        {
          userId,
          count: result.current ?? 'unknown',
          limit: result.limit,
          resetInMinutes: minutesRemaining,
          resetAt: result.resetAt.toISOString(),
          rateLimitUnavailable: result.rateLimitUnavailable,
        }
      );
    }

    logDebug('SMS rate limit check passed', {
      userId,
      current: result.current ?? 'unknown',
      limit: result.limit,
      resetAt: result.resetAt.toISOString(),
      rateLimitUnavailable: result.rateLimitUnavailable,
    });
  }

  private logSMSEvent(event: SMSEvent): void {
    const logData = {
      service: 'twilio-sms',
      messageSid: event.messageSid,
      status: event.status,
      to: this.maskPhoneNumber(event.to),
      from: this.maskPhoneNumber(event.from),
      bodyLength: event.body?.length,
      errorCode: event.errorCode,
      errorMessage: event.errorMessage,
      timestamp: event.timestamp.toISOString(),
    };

    if (event.status === 'failed' || event.status === 'undelivered' || event.errorCode) {
      logError('Twilio SMS error', undefined, logData);
    } else if (
      event.status === 'delivered' ||
      event.status === 'received' ||
      event.status === 'read'
    ) {
      logInfo('Twilio SMS delivered', logData);
    } else {
      logDebug('Twilio SMS status', logData);
    }
  }

  private maskPhoneNumber(phone: string | null | undefined): string {
    if (!phone) {
      return 'unknown';
    }

    const trimmed = phone.trim();
    if (trimmed === '') {
      return 'unknown';
    }

    const hasPlus = trimmed.startsWith('+');
    const digits = trimmed.replace(/\D/g, '');
    if (digits.length === 0) {
      return 'unknown';
    }

    const visibleCount = Math.min(4, digits.length);
    const visible = digits.slice(-visibleCount);
    const maskedPrefix = '*'.repeat(Math.max(digits.length - visibleCount, 0));
    const maskedDigits = `${maskedPrefix}${visible}`;

    return hasPlus ? `+${maskedDigits}` : maskedDigits;
  }

  private normalizeWebhookBaseUrl(raw?: string): string {
    const value = raw?.trim();
    if (!value) {
      throw new TwilioSMSError('Webhook base URL not configured', 'CONFIGURATION_ERROR');
    }

    try {
      const parsed = new URL(value);
      return parsed.toString().replace(/\/$/, '');
    } catch (error) {
      throw new TwilioSMSError('Invalid webhook base URL format', 'CONFIGURATION_ERROR', {
        webhookBaseUrl: raw,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private buildStatusCallbackUrl(): string {
    return `${this.ensureTrailingSlash(this.webhookBaseUrl)}webhooks/twilio/sms/status`;
  }

  private ensureTrailingSlash(value: string): string {
    return value.endsWith('/') ? value : `${value}/`;
  }

  private normalizeStatus(status?: string | null): SMSStatus {
    const normalized = (status ?? 'queued').toLowerCase();
    const allowed: SMSStatus[] = [
      'accepted',
      'queued',
      'sending',
      'sent',
      'delivered',
      'undelivered',
      'failed',
      'receiving',
      'received',
      'read',
      'canceled',
      'scheduled',
      'partially_delivered',
    ];

    return (allowed.find((value) => value === normalized) ?? 'queued') as SMSStatus;
  }

  private async ensureClient(): Promise<Twilio> {
    const credentials = await this.ensureCredentials();

    // Check if credentials have changed and recreate client if needed
    if (
      !this.client ||
      !this.credentials ||
      this.credentials.accountSid !== credentials.accountSid ||
      this.credentials.authToken !== credentials.authToken
    ) {
      this.client = new Twilio(credentials.accountSid, credentials.authToken);
      this.credentials = credentials;
    }

    return this.client;
  }

  private async ensureCredentials(): Promise<TwilioSMSCredentials> {
    if (this.credentialsPromise) {
      return this.credentialsPromise;
    }

    this.credentialsPromise = this.resolveCredentials().finally(() => {
      this.credentialsPromise = undefined;
    });

    const credentials = await this.credentialsPromise;
    this.authToken = credentials.authToken;
    this.accountSid = credentials.accountSid;
    this.fromNumber = credentials.phoneNumber;
    return credentials;
  }

  private async resolveCredentials(): Promise<TwilioSMSCredentials> {
    if (this.accountSid && this.authToken && this.fromNumber) {
      return {
        accountSid: this.accountSid,
        authToken: this.authToken,
        phoneNumber: this.fromNumber,
      };
    }

    if (!this.secretId) {
      throw new TwilioSMSError('Twilio credentials not configured', 'CONFIGURATION_ERROR', {
        accountSid: !!this.accountSid,
        authToken: !!this.authToken,
        phoneNumber: !!this.fromNumber,
        secretId: false,
      });
    }

    const secret = await this.secretsLoader(this.secretId, this.secretCacheTtlMs);
    const accountSid =
      secret.account_sid ?? secret.accountSid ?? (env.twilio.accountSid || undefined);
    const authToken = secret.auth_token ?? secret.authToken ?? (env.twilio.authToken || undefined);
    const phoneNumber =
      secret.phone_number ?? secret.phoneNumber ?? (env.twilio.phoneNumber || undefined);

    if (!accountSid || !authToken || !phoneNumber) {
      throw new TwilioSMSError('Twilio secret missing required fields', 'CONFIGURATION_ERROR', {
        secretId: this.secretId,
        hasAccountSid: !!accountSid,
        hasAuthToken: !!authToken,
        hasPhoneNumber: !!phoneNumber,
      });
    }

    return {
      accountSid,
      authToken,
      phoneNumber,
    };
  }
}
