/**
 * Webhook Routes
 *
 * Handles incoming webhooks from external services (Twilio)
 */

import { Router, Request, Response } from 'express';
import { Pool } from 'pg';

import { env } from '../config/env';
import { logInfo, logError } from '../config/logger';
import { getWebhookRateLimiter } from '../middleware/webhook-rate-limit';
import { TwilioSMSService } from '../services/twilio-sms.service';
import { TwilioVoiceService } from '../services/twilio-voice.service';

/**
 * Services container for webhook routes
 */
export interface WebhookServices {
  twilioVoiceService: TwilioVoiceService;
  twilioSMSService: TwilioSMSService;
}

/**
 * Create webhook routes
 */
export async function createWebhookRoutes(
  pgPool: Pool,
  services: WebhookServices
): Promise<Router> {
  const router = Router();
  const { twilioVoiceService, twilioSMSService } = services;

  // Apply rate limiting to all webhook routes
  router.use(await getWebhookRateLimiter());

  // Health check endpoint
  router.get('/health', (_req: Request, res: Response) => {
    res.status(200).json({ status: 'ok' });
  });

  const buildTrustedWebhookUrl = (req: Request): string => {
    const baseUrl = env.twilio.webhookBaseUrl?.trim();

    if (!baseUrl) {
      throw new Error('Twilio webhook base URL not configured');
    }

    try {
      return new URL(req.originalUrl, baseUrl).toString();
    } catch (error) {
      throw new Error(
        `Failed to construct trusted webhook URL: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  };

  const sanitizeWebhookBody = (body: Record<string, unknown>): Record<string, unknown> => {
    const redactedFields = ['from', 'to', 'called', 'caller', 'phonenumber'];
    const visited = new WeakSet<object>();

    const sanitizeValue = (value: unknown): unknown => {
      // Handle primitives
      if (value === null || value === undefined) {
        return value;
      }

      if (typeof value !== 'object') {
        return value;
      }

      // Guard against circular references
      if (visited.has(value as object)) {
        return '[CIRCULAR]';
      }

      visited.add(value as object);

      // Handle arrays
      if (Array.isArray(value)) {
        return value.map((item) => sanitizeValue(item));
      }

      // Handle objects
      const sanitized: Record<string, unknown> = {};
      for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
        const lowerKey = key.toLowerCase();
        if (redactedFields.includes(lowerKey)) {
          sanitized[key] = '[REDACTED]';
        } else {
          sanitized[key] = sanitizeValue(val);
        }
      }

      return sanitized;
    };

    return sanitizeValue(body) as Record<string, unknown>;
  };

  const sanitizePhone = (phone: string | undefined): string => {
    if (!phone) return '[EMPTY]';
    // Redact phone number for PII protection
    return '[REDACTED]';
  };

  /**
   * POST /webhooks/twilio/voice/status
   * Handle Twilio voice call status updates
   *
   * Query Parameters:
   * - alertId: Alert ID passed from initiateCall for correlation
   */
  router.post('/twilio/voice/status', async (req: Request, res: Response) => {
    try {
      // Extract alertId from query parameter for tracking
      const alertId = req.query.alertId as string | undefined;

      // Validate webhook signature
      const signature = req.headers['x-twilio-signature'] as string;
      const url = buildTrustedWebhookUrl(req);
      const params = req.body;

      if (!signature) {
        logError('Missing Twilio webhook signature', undefined, {
          url,
          body: sanitizeWebhookBody(req.body),
          alertId,
        });
        return res.status(200).json({ error: 'Missing signature' });
      }

      const isValid = await twilioVoiceService.validateWebhookSignature(signature, url, params);

      if (!isValid) {
        logError('Invalid Twilio webhook signature', undefined, {
          url,
          hasSignature: true,
          alertId,
        });
        return res.status(200).json({ error: 'Invalid signature' });
      }

      // Process webhook
      const event = twilioVoiceService.processCallStatusWebhook(req.body);

      if (!event.callSid || !event.status) {
        logError('Missing required fields in Twilio webhook', undefined, {
          event,
          alertId,
        });
        return res.status(200).send('OK');
      }

      // Update care_alerts table based on call status
      const callSid = event.callSid;
      const status = event.status;

      // Map Twilio status to our alert status
      let alertStatus: string | null = null;
      let timestampField: string | null = null;

      switch (status) {
        case 'ringing':
          alertStatus = 'ringing';
          break;
        case 'answered':
        case 'in-progress':
          alertStatus = 'answered';
          timestampField = 'answered_at';
          break;
        case 'completed':
          alertStatus = 'resolved';
          timestampField = 'resolved_at';
          break;
        case 'no-answer':
        case 'busy':
          alertStatus = 'no_answer';
          break;
        case 'failed':
        case 'canceled':
          alertStatus = 'cancelled';
          break;
        default:
          logError('Received unexpected Twilio call status', undefined, {
            callSid,
            alertId,
            status,
            message: 'Unhandled Twilio status received; defaulting to unknown',
          });
          alertStatus = 'unknown';
          timestampField = null;
          break;
      }

      if (alertStatus) {
        const allowedTransitions: Record<string, string[]> = {
          pending: [
            'pending',
            'initiated',
            'ringing',
            'answered',
            'no_answer',
            'cancelled',
            'resolved',
            'failed',
            'unknown',
          ],
          initiated: [
            'initiated',
            'ringing',
            'answered',
            'no_answer',
            'cancelled',
            'resolved',
            'failed',
            'unknown',
          ],
          ringing: [
            'ringing',
            'answered',
            'no_answer',
            'cancelled',
            'resolved',
            'failed',
            'unknown',
          ],
          answered: ['answered', 'resolved', 'cancelled', 'no_answer', 'unknown'],
          no_answer: ['no_answer', 'resolved', 'cancelled', 'unknown'],
          cancelled: ['cancelled'],
          resolved: ['resolved'],
          failed: ['failed', 'cancelled', 'resolved'],
          unknown: ['unknown', 'answered', 'no_answer', 'cancelled', 'resolved'],
        };

        const currentStatusResult = await pgPool.query(
          `SELECT status FROM care_alerts WHERE call_sid = $1 AND deleted_at IS NULL`,
          [callSid]
        );

        if (currentStatusResult.rowCount === 0) {
          logError('No matching care alert found for Twilio webhook', undefined, {
            callSid,
            alertId,
            status,
            alertStatus,
            message: 'Webhook received for unknown call_sid',
          });
          return res.status(200).send('OK');
        }

        const currentStatus: string = currentStatusResult.rows[0].status;
        const allowedNextStatuses = allowedTransitions[currentStatus] ?? [];

        if (!allowedNextStatuses.includes(alertStatus)) {
          logError('Invalid care alert status transition from Twilio webhook', undefined, {
            callSid,
            alertId,
            currentStatus,
            attemptedStatus: alertStatus,
          });
          return res.status(200).send('OK');
        }

        // Use explicit prebuilt queries to avoid SQL injection risk
        let updateQuery: string;
        if (timestampField === 'answered_at') {
          updateQuery = `UPDATE care_alerts 
             SET status = $1, answered_at = COALESCE(answered_at, NOW()), updated_at = NOW()
             WHERE call_sid = $2 AND status = $3 AND deleted_at IS NULL`;
        } else if (timestampField === 'resolved_at') {
          updateQuery = `UPDATE care_alerts 
             SET status = $1, resolved_at = COALESCE(resolved_at, NOW()), updated_at = NOW()
             WHERE call_sid = $2 AND status = $3 AND deleted_at IS NULL`;
        } else if (timestampField === null) {
          updateQuery = `UPDATE care_alerts 
             SET status = $1, updated_at = NOW()
             WHERE call_sid = $2 AND status = $3 AND deleted_at IS NULL`;
        } else {
          // Invalid timestampField - log error and skip update
          logError('Invalid timestamp field in webhook processing', undefined, {
            callSid,
            alertId,
            timestampField,
            message: 'Unexpected timestamp field value',
          });
          return res.status(200).send('OK');
        }

        const result = await pgPool.query(updateQuery, [alertStatus, callSid, currentStatus]);

        if (result.rowCount === 0) {
          logError(
            'Failed to update care alert - status may have changed concurrently',
            undefined,
            {
              callSid,
              alertId,
              expectedStatus: currentStatus,
              attemptedStatus: alertStatus,
              message: 'Status transition rejected due to concurrent update or status mismatch',
            }
          );
        } else {
          logInfo('Updated care alert from Twilio webhook', {
            callSid,
            alertId,
            status,
            previousStatus: currentStatus,
            alertStatus,
            rowsUpdated: result.rowCount,
          });
        }
      }

      // Respond to Twilio (must respond with 200)
      return res.status(200).send('OK');
    } catch (error) {
      const alertId = req.query.alertId as string | undefined;
      logError('Error processing Twilio webhook', error instanceof Error ? error : undefined, {
        body: sanitizeWebhookBody(req.body),
        alertId,
      });

      // Still respond with 200 to prevent Twilio retries
      return res.status(200).send('OK');
    }
  });

  /**
   * POST /webhooks/twilio/sms/status
   * Handle Twilio SMS delivery status updates
   */
  router.post('/twilio/sms/status', async (req: Request, res: Response) => {
    try {
      // Validate webhook signature
      const signature = req.headers['x-twilio-signature'] as string;
      const url = buildTrustedWebhookUrl(req);
      const params = req.body;

      if (!signature) {
        logError('Missing Twilio webhook signature', undefined, {
          url,
          body: sanitizeWebhookBody(req.body),
        });
        return res.status(200).json({ error: 'Missing signature' });
      }

      const isValid = await twilioSMSService.validateWebhookSignature(signature, url, params);

      if (!isValid) {
        logError('Invalid Twilio webhook signature', undefined, {
          url,
          hasSignature: true,
        });
        return res.status(200).json({ error: 'Invalid signature' });
      }

      // Process webhook
      const event = twilioSMSService.processSMSStatusWebhook(req.body);

      logInfo('Processed SMS status webhook', {
        messageSid: event.messageSid,
        status: event.status,
        to: sanitizePhone(event.to),
      });

      // Respond to Twilio (must respond with 200)
      return res.status(200).send('OK');
    } catch (error) {
      logError('Error processing Twilio SMS webhook', error instanceof Error ? error : undefined, {
        body: sanitizeWebhookBody(req.body),
      });

      // Still respond with 200 to prevent Twilio retries
      return res.status(200).send('OK');
    }
  });

  return router;
}
