/**
 * Twilio Voice Service
 *
 * Handles voice call initiation and webhook processing for care coordination alerts.
 * Designed for simplicity and reliability - voice calls work, no messaging complexity.
 *
 * Features:
 * - Voice call initiation to coordinators
 * - Voice message playback from S3
 * - Call status webhook handling
 * - Comprehensive event logging
 * - Automatic retry logic
 *
 * Credentials Management:
 * - Development: Loaded from environment variables via env.ts
 * - Production: Retrieved from AWS Secrets Manager via environment variables
 * - Secrets stored at: berthcare/{environment}/twilio
 * - See: scripts/setup-twilio-secrets.sh for secret management
 *
 * Philosophy alignment:
 * - Simplicity: Voice calls, not messaging platform
 * - Reliability: Comprehensive logging and error handling
 * - Performance: <15 second alert delivery
 */

import { Twilio } from 'twilio';
import { validateRequest } from 'twilio/lib/webhooks/webhooks';

import { env } from '../config/env';
import { logError, logInfo, logDebug } from '../config/logger';

/**
 * Call status from Twilio webhooks
 */
export type CallStatus =
  | 'queued'
  | 'ringing'
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

/**
 * Twilio Voice Service
 *
 * Manages voice call operations for care coordination alerts.
 */
export class TwilioVoiceService {
  private client: Twilio;
  private authToken: string;
  private fromNumber: string;
  private webhookBaseUrl: string;

  constructor(
    accountSid?: string,
    authToken?: string,
    fromNumber?: string,
    webhookBaseUrl?: string
  ) {
    // Use provided values or fall back to environment config
    const sid = accountSid ?? env.twilio.accountSid;
    this.authToken = authToken ?? env.twilio.authToken;
    this.fromNumber = fromNumber ?? env.twilio.phoneNumber;
    this.webhookBaseUrl = webhookBaseUrl ?? env.twilio.webhookBaseUrl;

    if (!sid || !this.authToken) {
      throw new TwilioVoiceError('Twilio credentials not configured', 'CONFIGURATION_ERROR', {
        accountSid: !!sid,
        authToken: !!this.authToken,
      });
    }

    if (!this.fromNumber) {
      throw new TwilioVoiceError('Twilio phone number not configured', 'CONFIGURATION_ERROR');
    }

    this.client = new Twilio(sid, this.authToken);
  }

  /**
   * Initiate a voice call to a coordinator
   *
   * @param to - Coordinator phone number (E.164 format)
   * @param voiceMessageUrl - S3 URL to voice message recording
   * @param alertId - Alert ID for tracking (passed to webhook via statusCallback URL)
   * @returns Call result with SID and status
   * @throws TwilioVoiceError if call initiation fails
   */
  async initiateCall(to: string, voiceMessageUrl: string, alertId: string): Promise<CallResult> {
    // Validate phone number format (basic E.164 check)
    if (!to || !to.match(/^\+[1-9]\d{1,14}$/)) {
      throw new TwilioVoiceError(
        'Invalid phone number format (must be E.164)',
        'INVALID_PHONE_NUMBER',
        { to }
      );
    }

    // Validate voice message URL
    if (!voiceMessageUrl || !voiceMessageUrl.startsWith('http')) {
      throw new TwilioVoiceError('Invalid voice message URL', 'INVALID_VOICE_MESSAGE_URL', {
        voiceMessageUrl,
      });
    }

    try {
      // Generate TwiML for playing voice message
      const twiml = this.generateVoiceMessageTwiML(voiceMessageUrl);

      // Initiate call with alertId in statusCallback URL for correlation
      const call = await this.client.calls.create({
        to,
        from: this.fromNumber,
        twiml,
        statusCallback: `${this.webhookBaseUrl}/webhooks/twilio/voice/status?alertId=${encodeURIComponent(alertId)}`,
        statusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed'],
        statusCallbackMethod: 'POST',
        timeout: 30, // Ring for 30 seconds before giving up
        record: false, // Don't record the call
      });

      const result: CallResult = {
        callSid: call.sid,
        status: call.status as CallStatus,
        to: call.to,
        from: call.from,
        initiatedAt: new Date(),
      };

      // Log call initiation
      this.logCallEvent({
        callSid: call.sid,
        status: call.status as CallStatus,
        to: call.to,
        from: call.from,
        timestamp: new Date(),
      });

      return result;
    } catch (error) {
      // Handle Twilio API errors
      if (error && typeof error === 'object' && 'code' in error) {
        const twilioError = error as { code: number; message: string };

        // Map common Twilio error codes
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

      // Generic error
      throw new TwilioVoiceError('Failed to initiate call', 'CALL_INITIATION_FAILED', {
        to,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Process call status webhook from Twilio
   *
   * @param webhookData - Webhook payload from Twilio
   * @returns Parsed call event
   */
  processCallStatusWebhook(webhookData: Record<string, unknown>): CallEvent {
    const callSid = String(webhookData.CallSid || '');
    const status = String(webhookData.CallStatus || '') as CallStatus;
    const to = String(webhookData.To || '');
    const from = String(webhookData.From || '');
    const duration = webhookData.CallDuration ? Number(webhookData.CallDuration) : undefined;
    const errorCode = webhookData.ErrorCode ? String(webhookData.ErrorCode) : undefined;
    const errorMessage = webhookData.ErrorMessage ? String(webhookData.ErrorMessage) : undefined;

    const event: CallEvent = {
      callSid,
      status,
      to,
      from,
      duration,
      timestamp: new Date(),
      errorCode,
      errorMessage,
    };

    // Log the event
    this.logCallEvent(event);

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
        service: 'twilio-voice',
        url,
      });
      return false;
    }
  }

  /**
   * Generate TwiML for playing voice message
   */
  private generateVoiceMessageTwiML(voiceMessageUrl: string): string {
    return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="alice">You have an urgent care alert.</Say>
  <Play>${voiceMessageUrl}</Play>
  <Say voice="alice">Press any key to acknowledge this alert.</Say>
  <Gather numDigits="1" timeout="10">
    <Say voice="alice">Waiting for acknowledgment.</Say>
  </Gather>
  <Say voice="alice">Alert not acknowledged. Goodbye.</Say>
</Response>`;
  }

  /**
   * Log call event
   */
  private logCallEvent(event: CallEvent): void {
    const logData = {
      service: 'twilio-voice',
      callSid: event.callSid,
      status: event.status,
      to: event.to,
      from: event.from,
      duration: event.duration,
      errorCode: event.errorCode,
      errorMessage: event.errorMessage,
      timestamp: event.timestamp.toISOString(),
    };

    // Log based on status
    if (event.status === 'failed' || event.errorCode) {
      logError('Twilio call error', undefined, logData);
    } else if (event.status === 'completed') {
      logInfo('Twilio call completed', logData);
    } else {
      logDebug('Twilio call status', logData);
    }
  }
}
