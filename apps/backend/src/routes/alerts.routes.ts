/**
 * Care Alert Routes
 *
 * Handles voice alert endpoints for care coordination:
 * - POST /v1/alerts/voice - Send voice alert to coordinator
 * - PATCH /v1/alerts/:alertId - Update alert outcome and mark as resolved
 *
 * Reference: Architecture Blueprint - Voice Alert Service
 * Tasks:
 * - T3: Implement POST /v1/alerts/voice endpoint
 * - T6: Implement alert resolution tracking
 *
 * Philosophy: "One button. One call. Problem solved."
 * - Voice-first communication (no messaging platform)
 * - <15 second alert delivery
 * - Automatic escalation if no answer
 * - Comprehensive audit trail
 * - Simple resolution workflow
 */

import * as crypto from 'crypto';

import { Request, Response, Router } from 'express';
import { Pool } from 'pg';
import { createClient } from 'redis';

import { logError, logInfo } from '../config/logger';
import { authenticateJWT, AuthenticatedRequest, requireRole } from '../middleware/auth';
import { TwilioSMSService } from '../services/twilio-sms.service';
import { TwilioVoiceService, TwilioVoiceError } from '../services/twilio-voice.service';

/**
 * Voice alert request body
 */
interface VoiceAlertRequest {
  clientId: string;
  voiceMessageUrl: string;
  alertType?:
    | 'medical_concern'
    | 'medication_issue'
    | 'behavioral_change'
    | 'safety_concern'
    | 'family_request'
    | 'equipment_issue'
    | 'other';
}

/**
 * Maximum length for alert outcome text
 * Reasonable limit to prevent abuse while allowing detailed documentation
 */
const MAX_OUTCOME_LENGTH = 2000;

/**
 * Maximum length for outcome in SMS messages
 * Keep SMS concise to avoid truncation and ensure readability
 */
const MAX_SMS_OUTCOME_LENGTH = 140;

/**
 * Sanitize and truncate outcome text for SMS
 * Removes newlines, collapses whitespace, and truncates to safe length
 *
 * @param outcome - The full outcome text
 * @returns Sanitized and truncated outcome suitable for SMS
 */
function sanitizeOutcomeForSMS(outcome: string): string {
  // Remove newlines and collapse multiple spaces into single space
  const sanitized = outcome
    .replace(/[\r\n]+/g, ' ') // Replace newlines with space
    .replace(/\s+/g, ' ') // Collapse multiple spaces
    .trim();

  // Truncate if needed and add ellipsis
  if (sanitized.length > MAX_SMS_OUTCOME_LENGTH) {
    return sanitized.substring(0, MAX_SMS_OUTCOME_LENGTH - 1) + '…';
  }

  return sanitized;
}

/**
 * Voice alert response
 */
interface VoiceAlertResponse {
  id: string;
  status: string;
  coordinatorName: string;
  callSid: string;
  initiatedAt: string;
}

export function createAlertRoutes(
  pgPool: Pool,
  redisClient: ReturnType<typeof createClient>
): Router {
  const router = Router();
  const twilioService = new TwilioVoiceService();

  /**
   * POST /v1/alerts/voice
   *
   * Send voice alert to coordinator for urgent care issues
   *
   * Request Body:
   * - clientId: string (required, UUID)
   * - voiceMessageUrl: string (required, S3 URL to voice recording)
   * - alertType: string (optional, defaults to 'other')
   *
   * Response (201):
   * - id: Alert ID
   * - status: 'initiated'
   * - coordinatorName: Name of coordinator who will receive call
   * - callSid: Twilio call SID for tracking
   * - initiatedAt: ISO 8601 timestamp
   *
   * Errors:
   * - 400: Invalid request (missing fields, invalid format)
   * - 401: Unauthorized (no JWT token)
   * - 403: Forbidden (not a caregiver)
   * - 404: Client not found or no coordinator available
   * - 500: Server error or Twilio error
   *
   * Security:
   * - Requires authentication (JWT token)
   * - Requires caregiver role
   * - Caregivers can only alert for clients in their zone
   *
   * Performance:
   * - <15 second alert delivery target
   * - Async call initiation (doesn't wait for answer)
   * - Webhook handles call status updates
   *
   * Philosophy: "Simplicity is the ultimate sophistication"
   * - One endpoint, one purpose
   * - Voice call initiated immediately
   * - Escalation handled automatically by webhooks
   */
  router.post(
    '/voice',
    authenticateJWT(redisClient),
    requireRole(['caregiver']),
    async (req: Request, res: Response) => {
      const client = await pgPool.connect();
      let transactionActive = false;

      try {
        // Extract authenticated user
        const user = (req as AuthenticatedRequest).user;

        if (!user) {
          res.status(401).json({
            error: {
              code: 'UNAUTHORIZED',
              message: 'Authentication required',
              timestamp: new Date().toISOString(),
              requestId: req.headers['x-request-id'] || 'unknown',
            },
          });
          return;
        }

        // Validate request body
        const { clientId, voiceMessageUrl, alertType = 'other' } = req.body as VoiceAlertRequest;

        if (!clientId) {
          res.status(400).json({
            error: {
              code: 'MISSING_CLIENT_ID',
              message: 'Client ID is required',
              timestamp: new Date().toISOString(),
              requestId: req.headers['x-request-id'] || 'unknown',
            },
          });
          return;
        }

        if (!voiceMessageUrl) {
          res.status(400).json({
            error: {
              code: 'MISSING_VOICE_MESSAGE',
              message: 'Voice message URL is required',
              timestamp: new Date().toISOString(),
              requestId: req.headers['x-request-id'] || 'unknown',
            },
          });
          return;
        }

        // Validate UUID format
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        if (!uuidRegex.test(clientId)) {
          res.status(400).json({
            error: {
              code: 'INVALID_CLIENT_ID',
              message: 'Invalid client ID format',
              timestamp: new Date().toISOString(),
              requestId: req.headers['x-request-id'] || 'unknown',
            },
          });
          return;
        }

        // Validate voice message URL format and enforce HTTPS
        let parsedUrl: URL;
        try {
          parsedUrl = new URL(voiceMessageUrl);
        } catch {
          res.status(400).json({
            error: {
              code: 'INVALID_VOICE_MESSAGE_URL',
              message: 'Voice message URL must be a valid URL',
              timestamp: new Date().toISOString(),
              requestId: req.headers['x-request-id'] || 'unknown',
            },
          });
          return;
        }

        if (parsedUrl.protocol !== 'https:') {
          res.status(400).json({
            error: {
              code: 'INVALID_VOICE_MESSAGE_URL',
              message: 'Voice message URL must use HTTPS protocol',
              timestamp: new Date().toISOString(),
              requestId: req.headers['x-request-id'] || 'unknown',
            },
          });
          return;
        }

        // Fetch client and verify zone access
        const clientQuery = `
          SELECT id, first_name, last_name, zone_id
          FROM clients
          WHERE id = $1 AND deleted_at IS NULL
        `;

        const clientResult = await client.query(clientQuery, [clientId]);

        if (clientResult.rows.length === 0) {
          res.status(404).json({
            error: {
              code: 'CLIENT_NOT_FOUND',
              message: 'Client not found',
              timestamp: new Date().toISOString(),
              requestId: req.headers['x-request-id'] || 'unknown',
            },
          });
          return;
        }

        const clientData = clientResult.rows[0];

        // Verify caregiver has access to this client's zone
        if (clientData.zone_id !== user.zoneId) {
          res.status(403).json({
            error: {
              code: 'FORBIDDEN',
              message: 'You can only send alerts for clients in your zone',
              timestamp: new Date().toISOString(),
              requestId: req.headers['x-request-id'] || 'unknown',
            },
          });
          return;
        }

        // Find coordinator for this zone
        const coordinatorQuery = `
          SELECT c.id, c.user_id, c.phone_number, u.first_name, u.last_name
          FROM coordinators c
          JOIN users u ON c.user_id = u.id
          WHERE c.zone_id = $1
            AND c.is_active = true
            AND c.deleted_at IS NULL
            AND u.deleted_at IS NULL
          ORDER BY c.created_at ASC
          LIMIT 1
        `;

        const coordinatorResult = await client.query(coordinatorQuery, [clientData.zone_id]);

        if (coordinatorResult.rows.length === 0) {
          res.status(404).json({
            error: {
              code: 'NO_COORDINATOR_AVAILABLE',
              message: 'No active coordinator found for this zone',
              timestamp: new Date().toISOString(),
              requestId: req.headers['x-request-id'] || 'unknown',
            },
          });
          return;
        }

        const coordinator = coordinatorResult.rows[0];

        // Generate alert ID
        const alertId = crypto.randomUUID();

        // Create alert record with pending status before initiating the call
        await client.query('BEGIN');
        transactionActive = true;

        const insertAlertQuery = `
          INSERT INTO care_alerts (
            id,
            client_id,
            staff_id,
            coordinator_id,
            alert_type,
            voice_message_url,
            status,
            initiated_at,
            created_at,
            updated_at
          ) VALUES (
            $1, $2, $3, $4, $5, $6, 'pending', NOW(), NOW(), NOW()
          )
        `;

        await client.query(insertAlertQuery, [
          alertId,
          clientId,
          user.userId,
          coordinator.user_id,
          alertType,
          voiceMessageUrl,
        ]);

        // Initiate Twilio voice call
        let callResult;
        try {
          callResult = await twilioService.initiateCall(coordinator.phone_number, voiceMessageUrl, {
            alertId,
          });
        } catch (error) {
          await client.query(
            `UPDATE care_alerts SET status = 'failed', updated_at = NOW() WHERE id = $1`,
            [alertId]
          );

          await client.query('COMMIT');
          transactionActive = false;

          if (error instanceof TwilioVoiceError) {
            logError('Twilio voice call failed', error, {
              alertId,
              clientId,
              coordinatorId: coordinator.id,
              errorCode: error.code,
            });

            res.status(500).json({
              error: {
                code: 'VOICE_CALL_FAILED',
                message: 'Failed to initiate voice call',
                details: {
                  twilioError: error.message,
                  errorCode: error.code,
                },
                timestamp: new Date().toISOString(),
                requestId: req.headers['x-request-id'] || 'unknown',
              },
            });
            return;
          }
          throw error;
        }

        // Update alert record in database with call SID and initiated status
        const updateAlertQuery = `
          UPDATE care_alerts
          SET call_sid = $1,
              status = 'initiated',
              updated_at = NOW()
          WHERE id = $2
          RETURNING *
        `;

        const alertResult = await client.query(updateAlertQuery, [callResult.callSid, alertId]);

        const alert = alertResult.rows[0];

        await client.query('COMMIT');
        transactionActive = false;

        // Log successful alert initiation
        logInfo('Voice alert initiated', {
          alertId: alert.id,
          clientId: clientData.id,
          clientName: `${clientData.first_name} ${clientData.last_name}`,
          staffId: user.userId,
          coordinatorId: coordinator.id,
          coordinatorName: `${coordinator.first_name} ${coordinator.last_name}`,
          callSid: callResult.callSid,
          alertType,
        });

        // Build response
        const response: VoiceAlertResponse = {
          id: alert.id,
          status: 'initiated',
          coordinatorName: `${coordinator.first_name} ${coordinator.last_name}`,
          callSid: callResult.callSid,
          initiatedAt: alert.initiated_at.toISOString(),
        };

        res.status(201).json({
          data: response,
        });
      } catch (error) {
        if (transactionActive) {
          await client.query('ROLLBACK').catch(() => undefined);
          transactionActive = false;
        }
        const authRequest = req as AuthenticatedRequest;
        const requestIdHeader = req.headers['x-request-id'];
        logError('Voice alert error', error instanceof Error ? error : new Error(String(error)), {
          userId: authRequest.user?.userId,
          requestId: typeof requestIdHeader === 'string' ? requestIdHeader : undefined,
        });

        res.status(500).json({
          error: {
            code: 'INTERNAL_SERVER_ERROR',
            message: 'An error occurred while creating voice alert',
            timestamp: new Date().toISOString(),
            requestId: req.headers['x-request-id'] || 'unknown',
          },
        });
      } finally {
        client.release();
      }
    }
  );

  /**
   * PATCH /v1/alerts/:alertId
   *
   * Update alert outcome and mark as resolved
   *
   * Request Body:
   * - outcome: string (required, resolution details)
   *
   * Response (200):
   * - id: Alert ID
   * - status: 'resolved'
   * - outcome: Resolution details
   * - resolvedAt: ISO 8601 timestamp
   *
   * Errors:
   * - 400: Invalid request (missing outcome)
   * - 401: Unauthorized (no JWT token)
   * - 403: Forbidden (not a coordinator)
   * - 404: Alert not found
   * - 409: Alert already resolved
   * - 500: Server error
   *
   * Security:
   * - Requires authentication (JWT token)
   * - Requires coordinator role
   * - Coordinators can only resolve alerts in their zone
   *
   * Philosophy: "Simplicity is the ultimate sophistication"
   * - One endpoint to resolve alerts
   * - Automatic caregiver notification
   * - Comprehensive audit trail
   */
  router.patch(
    '/:alertId',
    authenticateJWT(redisClient),
    requireRole(['coordinator']),
    async (req: Request, res: Response) => {
      const client = await pgPool.connect();

      try {
        const user = (req as AuthenticatedRequest).user;
        const { alertId } = req.params;
        const { outcome } = req.body;

        if (!user) {
          res.status(401).json({
            error: {
              code: 'UNAUTHORIZED',
              message: 'Authentication required',
              timestamp: new Date().toISOString(),
              requestId: req.headers['x-request-id'] || 'unknown',
            },
          });
          return;
        }

        // Validate outcome
        if (!outcome || typeof outcome !== 'string' || outcome.trim().length === 0) {
          res.status(400).json({
            error: {
              code: 'MISSING_OUTCOME',
              message: 'Outcome is required',
              timestamp: new Date().toISOString(),
              requestId: req.headers['x-request-id'] || 'unknown',
            },
          });
          return;
        }

        // Validate outcome length
        if (outcome.trim().length > MAX_OUTCOME_LENGTH) {
          res.status(400).json({
            error: {
              code: 'OUTCOME_TOO_LONG',
              message: `Outcome exceeds maximum length of ${MAX_OUTCOME_LENGTH} characters`,
              details: {
                maxLength: MAX_OUTCOME_LENGTH,
                actualLength: outcome.trim().length,
              },
              timestamp: new Date().toISOString(),
              requestId: req.headers['x-request-id'] || 'unknown',
            },
          });
          return;
        }

        // Validate UUID format
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        if (!uuidRegex.test(alertId)) {
          res.status(400).json({
            error: {
              code: 'INVALID_ALERT_ID',
              message: 'Invalid alert ID format',
              timestamp: new Date().toISOString(),
              requestId: req.headers['x-request-id'] || 'unknown',
            },
          });
          return;
        }

        const outcomeTrimmed = outcome.trim();

        await client.query('BEGIN');
        let transactionActive = true;

        let alert;
        let updatedAlert;

        try {
          const alertQuery = `
            SELECT 
              ca.id,
              ca.status,
              ca.coordinator_id,
              ca.staff_id,
              ca.client_id,
              c.zone_id,
              c.first_name as client_first_name,
              c.last_name as client_last_name,
              u.phone_number as caregiver_phone
            FROM care_alerts ca
            JOIN clients c ON ca.client_id = c.id
            LEFT JOIN users u ON ca.staff_id = u.id
            WHERE ca.id = $1 AND ca.deleted_at IS NULL
            FOR UPDATE
          `;

          const alertResult = await client.query(alertQuery, [alertId]);

          if (alertResult.rows.length === 0) {
            await client.query('ROLLBACK');
            transactionActive = false;
            res.status(404).json({
              error: {
                code: 'ALERT_NOT_FOUND',
                message: 'Alert not found',
                timestamp: new Date().toISOString(),
                requestId: req.headers['x-request-id'] || 'unknown',
              },
            });
            return;
          }

          alert = alertResult.rows[0];

          if (alert.zone_id !== user.zoneId) {
            await client.query('ROLLBACK');
            transactionActive = false;
            res.status(403).json({
              error: {
                code: 'FORBIDDEN',
                message: 'You can only resolve alerts in your zone',
                timestamp: new Date().toISOString(),
                requestId: req.headers['x-request-id'] || 'unknown',
              },
            });
            return;
          }

          if (alert.status === 'resolved') {
            await client.query('ROLLBACK');
            transactionActive = false;
            res.status(409).json({
              error: {
                code: 'ALERT_ALREADY_RESOLVED',
                message: 'Alert has already been resolved',
                timestamp: new Date().toISOString(),
                requestId: req.headers['x-request-id'] || 'unknown',
              },
            });
            return;
          }

          const updateQuery = `
            UPDATE care_alerts
            SET 
              outcome = $1,
              status = 'resolved',
              resolved_at = NOW(),
              updated_at = NOW()
            WHERE id = $2 AND status != 'resolved'
            RETURNING id, status, outcome, resolved_at
          `;

          const updateResult = await client.query(updateQuery, [outcomeTrimmed, alertId]);

          if (updateResult.rowCount === 0) {
            await client.query('ROLLBACK');
            transactionActive = false;
            res.status(409).json({
              error: {
                code: 'ALERT_ALREADY_RESOLVED',
                message: 'Alert has already been resolved',
                timestamp: new Date().toISOString(),
                requestId: req.headers['x-request-id'] || 'unknown',
              },
            });
            return;
          }

          updatedAlert = updateResult.rows[0];

          await client.query('COMMIT');
          transactionActive = false;
        } catch (error) {
          if (transactionActive) {
            await client.query('ROLLBACK').catch(() => undefined);
            transactionActive = false;
          }
          throw error;
        }

        // Notify caregiver via SMS if phone number available
        if (alert?.caregiver_phone) {
          try {
            const twilioSMSService = new TwilioSMSService();
            const clientName = `${alert.client_first_name} ${alert.client_last_name}`;
            const truncatedOutcome = sanitizeOutcomeForSMS(outcomeTrimmed);
            const message = `Alert resolved for ${clientName}. Outcome: ${truncatedOutcome}`;

            await twilioSMSService.sendSMS(alert.caregiver_phone, message);

            logInfo('Caregiver notified of alert resolution', {
              alertId,
              caregiverId: alert.staff_id,
              clientName,
            });
          } catch (error) {
            // Log error but don't fail the request
            logError(
              'Failed to notify caregiver of alert resolution',
              error instanceof Error ? error : new Error(String(error)),
              {
                alertId,
                caregiverId: alert.staff_id,
                caregiverPhone: alert.caregiver_phone,
              }
            );
          }
        }

        // Log successful resolution
        logInfo('Alert resolved', {
          alertId: updatedAlert.id,
          coordinatorId: user.userId,
          clientId: alert.client_id,
          outcome: outcomeTrimmed,
        });

        res.status(200).json({
          data: {
            id: updatedAlert.id,
            status: updatedAlert.status,
            outcome: updatedAlert.outcome,
            resolvedAt: updatedAlert.resolved_at.toISOString(),
          },
        });
      } catch (error) {
        const authRequest = req as AuthenticatedRequest;
        const requestIdHeader = req.headers['x-request-id'];
        const outcomeValue =
          typeof req.body?.outcome === 'string' ? req.body.outcome : undefined;
        const sanitizedBody = {
          outcomePresent: outcomeValue ? outcomeValue.length > 0 : Boolean(req.body?.outcome),
          outcomeLength: outcomeValue?.length,
        };
        logError(
          'Alert resolution error',
          error instanceof Error ? error : new Error(String(error)),
          {
            userId: authRequest.user?.userId,
            alertId: req.params.alertId,
            sanitizedBody,
            requestId: typeof requestIdHeader === 'string' ? requestIdHeader : undefined,
          }
        );

        res.status(500).json({
          error: {
            code: 'INTERNAL_SERVER_ERROR',
            message: 'An error occurred while resolving alert',
            timestamp: new Date().toISOString(),
            requestId: req.headers['x-request-id'] || 'unknown',
          },
        });
      } finally {
        client.release();
      }
    }
  );

  return router;
}
