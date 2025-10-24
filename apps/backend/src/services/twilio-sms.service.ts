/**
 * Twilio SMS Service
 *
 * Handles SMS messaging for family portal and backup alerts.
 * Designed for simplicity and reliability - SMS works, no complex messaging platform.
 *
 * Features:
 * - SMS sending to family members and coordinators
 * - Delivery status webhook handling
 * - Comprehensive event logging
 * - Rate limiting (100 SMS per hour per user)
 *
 * Credentials Management:
 * - Development: Loaded from environment variables via env.ts
 * - Production: Retrieved from AWS Secrets Manager via environment variables
 * - Secrets stored at: berthcare/{environment}/twilio
 * - See: scripts/setup-twilio-secrets.sh for secret management
 *
 * Rate Limiting Behavior:
 * - Uses Redis-backed rate limiter for multi-instance deployments
 * - Default: Fail-closed (blocks SMS when Redis unavailable) - prioritizes security
 * - Configurable: Set SMS_RATE_LIMITER_FAIL_OPEN=true for fail-open behavior
 * - Fail-open mode: Allows SMS when Redis fails - prioritizes availability for critical alerts
 * - See: docs/twilio-quick-reference.md for production configuration recommendations
 *
 * Philosophy alignment:
 * - Simplicity: SMS messages, not messaging platform
 * - Reliability: Comprehensive logging and error handling
 * - Performance: <30 second message delivery
 */

import { Twilio } from 'twilio';
import { validateRequest } from 'twilio/lib/webhooks/webhooks';

import { env } from '../config/env';
import { logError, logInfo, logDebug } from '../config/logger';
import { RedisRateLimiter } from '../utils/redis-rate-limiter';

/**
 * SMS delivery status from Twilio webhooks
 */
export type SMSStatus = 'queued' | 'sending' | 'sent' | 'delivered' | 'undelivered' | 'failed';

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

/**
 * Twilio SMS Service
 *
 * Manages SMS operations for family portal and backup alerts.
 */
export class TwilioSMSService {
  private client: Twilio;
  private authToken: string;
  private fromNumber: string;
  private webhookBaseUrl: string;
  private rateLimiter: RedisRateLimiter;
  private readonly MAX_SMS_PER_HOUR = 100;

  constructor(
    accountSid?: string,
    authToken?: string,
    fromNumber?: string,
    webhookBaseUrl?: string,
    rateLimiterOptions?: SMSRateLimiterOptions
  ) {
    // Use provided values or fall back to environment config
    const sid = accountSid ?? env.twilio.accountSid;
    this.authToken = authToken ?? env.twilio.authToken;
    this.fromNumber = fromNumber ?? env.twilio.phoneNumber;
    const rawWebhookUrl = webhookBaseUrl ?? env.twilio.webhookBaseUrl;

    // Validate and normalize webhook base URL
    if (!rawWebhookUrl || rawWebhookUrl.trim().length === 0) {
      throw new TwilioSMSError('Webhook base URL not configured', 'CONFIGURATION_ERROR');
    }

    try {
      // Validate URL format
      const url = new URL(rawWebhookUrl.trim());
      // Normalize: remove trailing slash for consistent callback construction
      this.webhookBaseUrl = url.toString().replace(/\/$/, '');
    } catch (error) {
      throw new TwilioSMSError('Invalid webhook base URL format', 'CONFIGURATION_ERROR', {
        webhookBaseUrl: rawWebhookUrl,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    // Initialize Redis-backed rate limiter
    // failOpen behavior (when Redis is unavailable):
    // - false (default): Fail-closed - blocks all SMS (security priority)
    // - true: Fail-open - allows SMS to proceed (availability priority)
    // Configure via SMS_RATE_LIMITER_FAIL_OPEN environment variable
    this.rateLimiter = new RedisRateLimiter({
      keyPrefix: 'sms:ratelimit',
      limit: this.MAX_SMS_PER_HOUR,
      windowMs: 60 * 60 * 1000, // 1 hour
      useRedis: rateLimiterOptions?.useRedis ?? env.app.nodeEnv === 'production',
      failOpen: rateLimiterOptions?.failOpen ?? env.twilio.smsRateLimiterFailOpen,
    });

    if (!sid || !this.authToken) {
      throw new TwilioSMSError('Twilio credentials not configured', 'CONFIGURATION_ERROR', {
        accountSid: !!sid,
        authToken: !!this.authToken,
      });
    }

    if (!this.fromNumber) {
      throw new TwilioSMSError('Twilio phone number not configured', 'CONFIGURATION_ERROR');
    }

    this.client = new Twilio(sid, this.authToken);
  }

  /**
   * Send SMS message
   *
   * @param to - Recipient phone number (E.164 format)
   * @param message - Message body (max 1600 characters)
   * @param userId - User ID for rate limiting (optional)
   * @returns SMS result with SID and status
   * @throws TwilioSMSError if send fails or rate limit exceeded
   */
  async sendSMS(to: string, message: string, userId?: string): Promise<SMSResult> {
    // Validate phone number format (basic E.164 check)
    if (!to || !to.match(/^\+[1-9]\d{1,14}$/)) {
      throw new TwilioSMSError(
        'Invalid phone number format (must be E.164)',
        'INVALID_PHONE_NUMBER',
        { to }
      );
    }

    // Validate message
    if (!message || message.trim().length === 0) {
      throw new TwilioSMSError('Message body cannot be empty', 'INVALID_MESSAGE_BODY');
    }

    if (message.length > 1600) {
      throw new TwilioSMSError('Message body too long (max 1600 characters)', 'MESSAGE_TOO_LONG', {
        length: message.length,
      });
    }

    // Check and increment rate limit if userId provided
    if (userId) {
      await this.checkAndIncrementRateLimit(userId);
    }

    try {
      // Send SMS with status callback
      const sms = await this.client.messages.create({
        to,
        from: this.fromNumber,
        body: message,
        statusCallback: `${this.webhookBaseUrl}/webhooks/twilio/sms/status`,
      });

      const result: SMSResult = {
        messageSid: sms.sid,
        status: sms.status as SMSStatus,
        to: sms.to,
        from: sms.from,
        body: message,
        sentAt: new Date(),
      };

      // Log SMS send
      this.logSMSEvent({
        messageSid: sms.sid,
        status: sms.status as SMSStatus,
        to: sms.to,
        from: sms.from,
        body: message,
        timestamp: new Date(),
      });

      // Rate limit already incremented in checkAndIncrementRateLimit

      return result;
    } catch (error) {
      // Handle Twilio API errors
      if (error && typeof error === 'object' && 'code' in error) {
        const twilioError = error as { code: number; message: string };

        // Map common Twilio error codes
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

      // Generic error
      throw new TwilioSMSError('Failed to send SMS', 'SMS_SEND_FAILED', {
        to,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Process SMS delivery status webhook from Twilio
   *
   * @param webhookData - Webhook payload from Twilio
   * @returns Parsed SMS event
   * @throws TwilioSMSError if required fields are missing or invalid
   */
  processSMSStatusWebhook(webhookData: Record<string, unknown>): SMSEvent {
    const messageSid = String(webhookData.MessageSid || webhookData.SmsSid || '');
    const status = String(webhookData.MessageStatus || webhookData.SmsStatus || '') as SMSStatus;
    const to = String(webhookData.To || '');
    const from = String(webhookData.From || '');
    const body = webhookData.Body ? String(webhookData.Body) : undefined;
    const errorCode = webhookData.ErrorCode ? String(webhookData.ErrorCode) : undefined;
    const errorMessage = webhookData.ErrorMessage ? String(webhookData.ErrorMessage) : undefined;

    // Validate required fields
    if (messageSid.trim() === '') {
      logError('Invalid SMS webhook: missing messageSid', undefined, {
        service: 'twilio-sms',
        webhookData,
      });
      throw new TwilioSMSError(
        'Invalid SMS webhook: messageSid is required',
        'INVALID_WEBHOOK_DATA',
        { webhookData }
      );
    }

    if (status.trim() === '') {
      logError('Invalid SMS webhook: missing status', undefined, {
        service: 'twilio-sms',
        messageSid,
        webhookData,
      });
      throw new TwilioSMSError('Invalid SMS webhook: status is required', 'INVALID_WEBHOOK_DATA', {
        messageSid,
        webhookData,
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

    // Log the event
    this.logSMSEvent(event);

    return event;
  }

  /**
   * Validate Twilio webhook signature
   *
   * @param signature - X-Twilio-Signature header value
   * @param url - Full webhook URL
   * @param params - Webhook parameters
   * @returns true if signature is valid
   */
  validateWebhookSignature(
    signature: string,
    url: string,
    params: Record<string, string>
  ): boolean {
    try {
      return validateRequest(this.authToken, signature, url, params);
    } catch (error) {
      logError('Webhook signature validation error', error instanceof Error ? error : undefined, {
        service: 'twilio-sms',
        url,
      });
      return false;
    }
  }

  /**
   * Check and increment rate limit for user
   *
   * Uses Redis-backed atomic counter with TTL for multi-instance deployments.
   * Falls back to in-memory store if Redis is unavailable.
   *
   * @param userId - User ID to check
   * @throws TwilioSMSError if rate limit exceeded
   */
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

  /**
   * Get current SMS count for user
   *
   * @param userId - User ID to check
   * @returns Current SMS count in the window
   */
  async getSMSCount(userId: string): Promise<number> {
    return this.rateLimiter.getCount(userId);
  }

  /**
   * Reset rate limit for user (admin/testing use)
   *
   * @param userId - User ID to reset
   */
  async resetRateLimit(userId: string): Promise<void> {
    await this.rateLimiter.reset(userId);
    logInfo('SMS rate limit reset', { userId });
  }

  /**
   * Log SMS event
   */
  private logSMSEvent(event: SMSEvent): void {
    const logData = {
      service: 'twilio-sms',
      messageSid: event.messageSid,
      status: event.status,
      to: event.to,
      from: event.from,
      bodyLength: event.body?.length,
      errorCode: event.errorCode,
      errorMessage: event.errorMessage,
      timestamp: event.timestamp.toISOString(),
    };

    // Log based on status
    if (event.status === 'failed' || event.status === 'undelivered' || event.errorCode) {
      logError('Twilio SMS error', undefined, logData);
    } else if (event.status === 'delivered') {
      logInfo('Twilio SMS delivered', logData);
    } else {
      logDebug('Twilio SMS status', logData);
    }
  }

  /**
   * Close rate limiter connections (for graceful shutdown)
   */
  async close(): Promise<void> {
    await this.rateLimiter.close();
  }
}
