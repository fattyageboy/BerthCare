/**
 * Webhook Routes
 *
 * Handles incoming webhooks from external services (Twilio)
 */

import { Router, Request, Response } from 'express';
import { Pool } from 'pg';

import { logInfo, logError } from '../config/logger';
import { getWebhookRateLimiter } from '../middleware/webhook-rate-limit';
import { TwilioSMSService } from '../services/twilio-sms.service';
import { TwilioVoiceService } from '../services/twilio-voice.service';

/**
 * Create webhook routes
 */
export async function createWebhookRoutes(pgPool: Pool): Promise<Router> {
  const router = Router();
  const twilioVoiceService = new TwilioVoiceService();
  const twilioSMSService = new TwilioSMSService();

  // Apply rate limiting to all webhook routes
  router.use(await getWebhookRateLimiter());

  // Health check endpoint
  router.get('/health', (_req: Request, res: Response) => {
    res.status(200).json({ status: 'ok' });
  });

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
      const url = `${req.protocol}://${req.get('host')}${req.originalUrl}`;
      const params = req.body;

      if (!signature) {
        logError('Missing Twilio webhook signature', undefined, {
          url,
          body: req.body,
          alertId,
        });
        return res.status(401).json({ error: 'Missing signature' });
      }

      const isValid = twilioVoiceService.validateWebhookSignature(signature, url, params);

      if (!isValid) {
        logError('Invalid Twilio webhook signature', undefined, {
          url,
          signature,
          alertId,
        });
        return res.status(401).json({ error: 'Invalid signature' });
      }

      // Process webhook
      const event = twilioVoiceService.processCallStatusWebhook(req.body);

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
      }

      if (alertStatus) {
        // Update alert by call_sid to ensure we update the correct alert
        // This prevents race conditions when multiple alerts are active
        const updateQuery = timestampField
          ? `UPDATE care_alerts 
             SET status = $1, ${timestampField} = NOW(), updated_at = NOW()
             WHERE call_sid = $2 AND deleted_at IS NULL`
          : `UPDATE care_alerts 
             SET status = $1, updated_at = NOW()
             WHERE call_sid = $2 AND deleted_at IS NULL`;

        const result = await pgPool.query(updateQuery, [alertStatus, callSid]);

        if (result.rowCount === 0) {
          // No matching alert found - log warning but don't fail
          logError('No matching care alert found for Twilio webhook', undefined, {
            callSid,
            alertId,
            status,
            alertStatus,
            message: 'Webhook received for unknown call_sid',
          });
        } else {
          logInfo('Updated care alert from Twilio webhook', {
            callSid,
            alertId,
            status,
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
        body: req.body,
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
      const url = `${req.protocol}://${req.get('host')}${req.originalUrl}`;
      const params = req.body;

      if (!signature) {
        logError('Missing Twilio webhook signature', undefined, {
          url,
          body: req.body,
        });
        return res.status(401).json({ error: 'Missing signature' });
      }

      const isValid = twilioSMSService.validateWebhookSignature(signature, url, params);

      if (!isValid) {
        logError('Invalid Twilio webhook signature', undefined, {
          url,
          signature,
        });
        return res.status(401).json({ error: 'Invalid signature' });
      }

      // Process webhook
      const event = twilioSMSService.processSMSStatusWebhook(req.body);

      logInfo('Processed SMS status webhook', {
        messageSid: event.messageSid,
        status: event.status,
        to: event.to,
      });

      // Respond to Twilio (must respond with 200)
      return res.status(200).send('OK');
    } catch (error) {
      logError('Error processing Twilio SMS webhook', error instanceof Error ? error : undefined, {
        body: req.body,
      });

      // Still respond with 200 to prevent Twilio retries
      return res.status(200).send('OK');
    }
  });

  return router;
}
