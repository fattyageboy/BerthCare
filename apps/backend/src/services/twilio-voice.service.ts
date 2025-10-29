/**
 * Twilio Voice Service
 *
 * Handles voice call initiation and webhook processing for care coordination alerts.
 * Designed for simplicity and reliability - voice calls work, no messaging complexity.
 */

import { Twilio } from 'twilio';
import { validateRequest } from 'twilio/lib/webhooks/webhooks';

import { env } from '../config/env';
import { logDebug, logError, logInfo } from '../config/logger';
import { fetchJsonSecret } from '../utils/aws-secrets-manager';

/**
 * Call status from Twilio webhooks
 */
export type CallStatus =
  | 'queued'
  | 'ringing'
  | 'answered'
  | 'in-progress'
  | 'completed'
  | 'busy'
  | 'failed'
  | 'no-answer'
  | 'canceled';

/**
 * Call initiation result
 */
export interface CallResult {
  callSid: string;
  status: CallStatus;
  to: string;
  from: string;
  initiatedAt: Date;
}

/**
 * Call event for logging
 */
export interface CallEvent {
  callSid: string;
  status: CallStatus;
  to: string;
  from: string;
  duration?: number;
  timestamp: Date;
  errorCode?: string;
  errorMessage?: string;
}

/**
 * Options for call initiation
 */
export interface InitiateCallOptions {
  alertId?: string;
}

/**
 * Twilio Voice Service error
 */
export class TwilioVoiceError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = 'TwilioVoiceError';
  }
}

interface TwilioVoiceCredentials {
  accountSid: string;
  authToken: string;
  phoneNumber: string;
}

interface TwilioVoiceSecretPayload {
  account_sid?: string;
  auth_token?: string;
  phone_number?: string;
  accountSid?: string;
  authToken?: string;
  phoneNumber?: string;
}

type TwilioSecretLoader = (
  secretId: string,
  cacheTtlMs?: number
) => Promise<TwilioVoiceSecretPayload>;

/**
 * Configuration options for TwilioVoiceService
 *
 * Credential Resolution Strategy:
 * 1. Direct credentials (accountSid, authToken, fromNumber) - used if all provided
 * 2. AWS Secrets Manager (secretId) - fetched on first use if direct credentials incomplete
 * 3. Environment variables - fallback for missing secret fields
 *
 * Credential Caching Behavior:
 * - Credentials are cached indefinitely after first successful fetch
 * - secretCacheTtlMs controls the secrets loader's cache duration (default: 5 minutes)
 * - Service-level credentials do NOT auto-refresh based on secretCacheTtlMs
 * - To rotate credentials, call forceRefreshClient() explicitly
 * - Mixed sources (partial secret + env fallback) are allowed for flexibility
 *
 * @example
 * // Direct credentials (no rotation)
 * new TwilioVoiceService({
 *   accountSid: 'AC...',
 *   authToken: 'token',
 *   fromNumber: '+1234567890'
 * });
 *
 * @example
 * // Secrets Manager with custom TTL
 * const service = new TwilioVoiceService({
 *   secretId: 'prod/twilio',
 *   secretCacheTtlMs: 10 * 60 * 1000 // 10 minutes
 * });
 * // Later, to rotate credentials:
 * service.forceRefreshClient();
 */
export interface TwilioVoiceServiceOptions {
  /** Twilio Account SID (overrides secrets/env) */
  accountSid?: string;
  /** Twilio Auth Token (overrides secrets/env) */
  authToken?: string;
  /** Twilio phone number to call from (overrides secrets/env) */
  fromNumber?: string;
  /** Base URL for webhook callbacks */
  webhookBaseUrl?: string;
  /** AWS Secrets Manager secret ID for credential fetching */
  secretId?: string;
  /** Custom secrets loader function (for testing or alternative secret stores) */
  secretsLoader?: TwilioSecretLoader;
  /** TTL for secrets loader cache (NOT service credential refresh interval) */
  secretCacheTtlMs?: number;
}

const DEFAULT_SECRET_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

const defaultSecretsLoader: TwilioSecretLoader = (secretId, cacheTtlMs) =>
  fetchJsonSecret<TwilioVoiceSecretPayload>(secretId, cacheTtlMs);

/**
 * Twilio Voice Service
 *
 * Manages voice call operations for care coordination alerts.
 */
export class TwilioVoiceService {
  private client: Twilio | null = null;
  private authToken?: string;
  private accountSid?: string;
  private fromNumber?: string;
  private webhookBaseUrl: string;
  private readonly secretId?: string;
  private readonly secretsLoader: TwilioSecretLoader;
  private readonly secretCacheTtlMs: number;
  private credentials?: TwilioVoiceCredentials;
  private credentialsPromise?: Promise<TwilioVoiceCredentials>;

  constructor(options: TwilioVoiceServiceOptions = {}) {
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
   * Force refresh the Twilio client and credentials
   *
   * Clears all cached credentials and client instances. The next API call
   * will trigger a fresh credential fetch from the configured source.
   *
   * Use cases:
   * - Manual credential rotation after updating secrets in AWS Secrets Manager
   * - Recovering from authentication errors
   * - Testing credential refresh behavior
   *
   * Important notes:
   * - This is the ONLY way to trigger credential refresh in this service
   * - secretCacheTtlMs does NOT automatically refresh service credentials
   * - Credentials are cached indefinitely until this method is called
   * - In-flight credential fetches are also cleared
   *
   * @example
   * // After rotating credentials in AWS Secrets Manager
   * twilioVoiceService.forceRefreshClient();
   * // Next call will use new credentials
   * await twilioVoiceService.initiateCall(...);
   */
  forceRefreshClient(): void {
    this.client = null;
    this.credentials = undefined;
    this.credentialsPromise = undefined;
  }

  /**
   * Initiate a voice call to a coordinator.
   */
  async initiateCall(
    to: string,
    voiceMessageUrl: string,
    options: InitiateCallOptions = {}
  ): Promise<CallResult> {
    // Validate phone number format (basic E.164 check)
    if (!to || !to.match(/^\+[1-9]\d{1,14}$/)) {
      throw new TwilioVoiceError(
        'Invalid phone number format (must be E.164)',
        'INVALID_PHONE_NUMBER',
        { to }
      );
    }

    // Validate voice message URL
    if (!voiceMessageUrl) {
      throw new TwilioVoiceError('Invalid voice message URL', 'INVALID_VOICE_MESSAGE_URL', {
        voiceMessageUrl,
      });
    }

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(voiceMessageUrl);
    } catch (error) {
      throw new TwilioVoiceError('Invalid voice message URL', 'INVALID_VOICE_MESSAGE_URL', {
        voiceMessageUrl,
      });
    }

    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
      throw new TwilioVoiceError('Invalid voice message URL', 'INVALID_VOICE_MESSAGE_URL', {
        voiceMessageUrl,
      });
    }

    if (!this.secretId && (!this.accountSid || !this.authToken || !this.fromNumber)) {
      throw new TwilioVoiceError('Twilio credentials not configured', 'CONFIGURATION_ERROR', {
        accountSid: !!this.accountSid,
        authToken: !!this.authToken,
        phoneNumber: !!this.fromNumber,
        secretId: false,
      });
    }

    let client: Twilio;
    try {
      client = await this.ensureClient();
    } catch (error) {
      if (error instanceof TwilioVoiceError) {
        throw error;
      }

      throw new TwilioVoiceError('Failed to initiate call', 'CALL_INITIATION_FAILED', {
        to,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    const fromNumber = this.fromNumber;

    if (!fromNumber) {
      throw new TwilioVoiceError('Twilio phone number not configured', 'CONFIGURATION_ERROR');
    }

    try {
      const twiml = this.generateVoiceMessageTwiML(voiceMessageUrl);
      const call = await client.calls.create({
        to,
        from: fromNumber,
        twiml,
        statusCallback: this.buildStatusCallbackUrl(options.alertId),
        // Note: statusCallbackEvent values are event names, not status values
        // When 'initiated' event fires, the CallStatus field will be 'queued'
        statusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed'],
        statusCallbackMethod: 'POST',
        timeout: 30,
        record: false,
      });

      const result: CallResult = {
        callSid: call.sid,
        status: this.normalizeStatus(String(call.status), call.sid),
        to: call.to ?? to,
        from: call.from ?? fromNumber,
        initiatedAt: new Date(),
      };

      this.logCallEvent({
        callSid: result.callSid,
        status: result.status,
        to: result.to,
        from: result.from,
        timestamp: result.initiatedAt,
      });

      return result;
    } catch (error) {
      if (
        error instanceof TwilioVoiceError ||
        (error instanceof Error && error.name === 'TwilioVoiceError')
      ) {
        throw error;
      }
      if (error && typeof error === 'object' && 'code' in error) {
        const twilioError = error as { code: number; message: string };

        if (twilioError.code === 21211) {
          throw new TwilioVoiceError('Invalid phone number', 'INVALID_PHONE_NUMBER', {
            to,
            error: twilioError.message,
          });
        }

        if (twilioError.code === 21608) {
          throw new TwilioVoiceError(
            'Phone number not verified (sandbox mode)',
            'UNVERIFIED_NUMBER',
            {
              to,
              error: twilioError.message,
            }
          );
        }

        throw new TwilioVoiceError('Twilio API error', 'TWILIO_API_ERROR', {
          code: twilioError.code,
          message: twilioError.message,
          to,
        });
      }

      throw new TwilioVoiceError('Failed to initiate call', 'CALL_INITIATION_FAILED', {
        to,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Process call status webhook from Twilio.
   */
  processCallStatusWebhook(webhookData: Record<string, unknown>): CallEvent {
    const callSid = String(webhookData.CallSid || '');
    const statusRaw = String(webhookData.CallStatus || '');
    const status = this.normalizeStatus(statusRaw, callSid);

    // Parse and validate CallDuration to avoid NaN
    let duration: number | undefined;
    if (webhookData.CallDuration !== undefined && webhookData.CallDuration !== null) {
      const durationStr = String(webhookData.CallDuration).trim();
      const parsedDuration = Number(durationStr);
      if (Number.isFinite(parsedDuration) && parsedDuration >= 0) {
        duration = parsedDuration;
      }
    }

    const event: CallEvent = {
      callSid,
      status,
      to: String(webhookData.To || ''),
      from: String(webhookData.From || ''),
      duration,
      timestamp: new Date(),
      errorCode: webhookData.ErrorCode ? String(webhookData.ErrorCode) : undefined,
      errorMessage: webhookData.ErrorMessage ? String(webhookData.ErrorMessage) : undefined,
    };

    this.logCallEvent(event);

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
      await this.ensureCredentials();

      if (!this.authToken) {
        throw new TwilioVoiceError(
          'Twilio auth token not available for signature validation',
          'CONFIGURATION_ERROR'
        );
      }

      return validateRequest(this.authToken, signature, url, params);
    } catch (error) {
      if (error instanceof TwilioVoiceError) {
        logError(
          'Webhook validation configuration error',
          error instanceof Error ? error : undefined,
          {
            service: 'twilio-voice',
            url,
          }
        );
      } else {
        logError('Webhook signature validation error', error instanceof Error ? error : undefined, {
          service: 'twilio-voice',
          url,
        });
      }
      return false;
    }
  }

  private normalizeStatus(status: string, callSid?: string): CallStatus {
    const allowedStatuses: CallStatus[] = [
      'queued',
      'ringing',
      'answered',
      'in-progress',
      'completed',
      'busy',
      'failed',
      'no-answer',
      'canceled',
    ];

    const normalized = allowedStatuses.find((value) => value === status);

    if (!normalized) {
      logError('Unexpected Twilio call status value', undefined, {
        service: 'twilio-voice',
        rawStatus: status,
        callSid,
        fallbackStatus: 'queued',
      });
      return 'queued';
    }

    return normalized;
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

  private async ensureCredentials(): Promise<TwilioVoiceCredentials> {
    if (this.credentialsPromise) {
      return this.credentialsPromise;
    }

    const pendingCredentials = this.resolveCredentials();
    this.credentialsPromise = pendingCredentials;

    try {
      const credentials = await pendingCredentials;
      this.authToken = credentials.authToken;
      this.accountSid = credentials.accountSid;
      this.fromNumber = credentials.phoneNumber;
      return credentials;
    } finally {
      // Clear cached promise only if it's still the one we created
      // This allows retries after failures
      if (this.credentialsPromise === pendingCredentials) {
        this.credentialsPromise = undefined;
      }
    }
  }

  /**
   * Resolve Twilio credentials from available sources
   *
   * Resolution order:
   * 1. Instance properties (if all three are set)
   * 2. AWS Secrets Manager (if secretId configured)
   * 3. Environment variables (fallback for missing secret fields)
   *
   * Note: This method allows mixing sources - if a secret is incomplete,
   * missing fields will fall back to environment variables. This provides
   * flexibility for partial configuration but means credentials may come
   * from multiple sources.
   *
   * @throws {TwilioVoiceError} If credentials cannot be resolved from any source
   * @private
   */
  private async resolveCredentials(): Promise<TwilioVoiceCredentials> {
    if (this.accountSid && this.authToken && this.fromNumber) {
      return {
        accountSid: this.accountSid,
        authToken: this.authToken,
        phoneNumber: this.fromNumber,
      };
    }

    if (!this.secretId) {
      throw new TwilioVoiceError('Twilio credentials not configured', 'CONFIGURATION_ERROR', {
        accountSid: !!this.accountSid,
        authToken: !!this.authToken,
        phoneNumber: !!this.fromNumber,
        secretId: false,
      });
    }

    const secret = await this.secretsLoader(this.secretId, this.secretCacheTtlMs);
    // Allow fallback to environment variables for missing secret fields
    // This enables partial configuration and gradual migration to secrets
    const accountSid =
      secret.account_sid ?? secret.accountSid ?? (env.twilio.accountSid || undefined);
    const authToken = secret.auth_token ?? secret.authToken ?? (env.twilio.authToken || undefined);
    const phoneNumber =
      secret.phone_number ?? secret.phoneNumber ?? (env.twilio.phoneNumber || undefined);

    if (!accountSid || !authToken || !phoneNumber) {
      throw new TwilioVoiceError('Twilio secret missing required fields', 'CONFIGURATION_ERROR', {
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

  private normalizeWebhookBaseUrl(raw?: string): string {
    const value = raw?.trim();
    if (!value) {
      throw new TwilioVoiceError('Twilio webhook base URL not configured', 'CONFIGURATION_ERROR');
    }

    try {
      const parsed = new URL(value);
      return parsed.toString().replace(/\/$/, '');
    } catch (error) {
      throw new TwilioVoiceError('Invalid webhook base URL format', 'CONFIGURATION_ERROR', {
        webhookBaseUrl: raw,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private buildStatusCallbackUrl(alertId?: string): string {
    const base = this.ensureTrailingSlash(this.webhookBaseUrl);
    const callback = new URL('./webhooks/twilio/voice/status', base);

    if (alertId) {
      callback.searchParams.set('alertId', alertId);
    }

    return callback.toString();
  }

  private ensureTrailingSlash(value: string): string {
    return value.endsWith('/') ? value : `${value}/`;
  }

  /**
   * Generate TwiML for playing voice message.
   */
  private generateVoiceMessageTwiML(voiceMessageUrl: string): string {
    const escapedUrl = this.escapeForXml(voiceMessageUrl);

    return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="alice">You have an urgent care alert.</Say>
  <Play>${escapedUrl}</Play>
  <Say voice="alice">Press any key to acknowledge this alert.</Say>
  <Gather numDigits="1" timeout="10">
    <Say voice="alice">Waiting for acknowledgment.</Say>
  </Gather>
  <Say voice="alice">Alert not acknowledged. Goodbye.</Say>
</Response>`;
  }

  private escapeForXml(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  private maskPhoneNumber(value?: string): string | undefined {
    if (!value) {
      return undefined;
    }

    const trimmed = value.trim();
    if (!trimmed) {
      return undefined;
    }

    return `***${trimmed.slice(-4)}`;
  }

  /**
   * Log call event with contextual messages for answered, no-answer, and completed.
   */
  private logCallEvent(event: CallEvent): void {
    const logData = {
      service: 'twilio-voice',
      callSid: event.callSid,
      status: event.status,
      to: this.maskPhoneNumber(event.to),
      from: this.maskPhoneNumber(event.from),
      duration: event.duration,
      errorCode: event.errorCode,
      errorMessage: event.errorMessage,
      timestamp: event.timestamp.toISOString(),
    };

    switch (event.status) {
      case 'failed':
      case 'busy':
      case 'no-answer':
      case 'canceled':
        logError('Twilio call did not reach coordinator', undefined, logData);
        break;
      case 'in-progress':
      case 'answered':
        logInfo('Coordinator answered voice alert call', logData);
        break;
      case 'completed':
        logInfo('Voice alert call completed', logData);
        break;
      default:
        logDebug('Twilio call status update', logData);
    }
  }
}
