/**
 * Care Plans Routes
 *
 * Handles care plan management endpoints:
 * - POST /v1/care-plans - Create or update care plan
 *
 * Task C7: Implement POST /v1/care-plans endpoint
 * Create endpoint to create/update care plan for client; support versioning
 * (increment version on each update); validate medications and allergies format;
 * require coordinator or admin role.
 *
 * Reference: project-documentation/task-plan.md - Phase C – Client Management API
 * Reference: Architecture Blueprint - Care Plan Management
 *
 * Philosophy: "Start with the user experience, work backwards to the technology"
 * - Simple upsert pattern (create or update)
 * - Automatic version tracking
 * - Comprehensive validation
 * - Zone-based access control
 */

import { Request, Response, Router } from 'express';
import { Pool } from 'pg';

import { deleteKeysMatchingPattern } from '../cache/cache-utils';
import { RedisClient } from '../cache/redis-client';
import { logError, logInfo } from '../config/logger';
import { authenticateJWT, AuthenticatedRequest, requireRole } from '../middleware/auth';
import { validateCarePlan } from '../middleware/validation';

export function createCarePlanRoutes(pgPool: Pool, redisClient: RedisClient): Router {
  const router = Router();

  /**
   * POST /v1/care-plans
   *
   * Create or update care plan for a client
   *
   * Request Body:
   * - clientId: string (UUID, required)
   * - summary: string (required)
   * - medications: Array<{name, dosage, frequency}> (required, can be empty)
   * - allergies: string[] (required, can be empty)
   * - specialInstructions: string (optional)
   *
   * Response (200 for update, 201 for create):
   * - Care plan with version number
   *
   * Errors:
   * - 400: Validation error
   * - 403: Insufficient permissions (caregiver, wrong zone)
   * - 404: Client not found
   * - 500: Server error
   *
   * Security:
   * - Requires authentication (JWT token)
   * - Requires coordinator or admin role
   * - Coordinators can only manage care plans for clients in their zone
   *
   * Performance:
   * - Upsert pattern (single query)
   * - Database validation functions
   * - Transaction support
   *
   * Philosophy: "Obsess over details"
   * - Comprehensive validation
   * - Automatic version tracking
   * - Clear error messages
   * - Audit trail logging
   */
  router.post(
    '/',
    authenticateJWT(redisClient),
    requireRole(['coordinator', 'admin']),
    validateCarePlan,
    async (req: Request, res: Response) => {
      const client = await pgPool.connect();

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

        // Extract request body
        const { clientId, summary, medications, allergies, specialInstructions } = req.body;

        // Check if client exists and get zone
        const clientQuery = `
          SELECT id, zone_id
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

        // Authorization check: Coordinators can only manage care plans for clients in their zone
        if (user.role === 'coordinator') {
          if (clientData.zone_id !== user.zoneId) {
            res.status(403).json({
              error: {
                code: 'AUTH_ZONE_ACCESS_DENIED',
                message: 'You do not have access to this client',
                details: {
                  requestedZoneId: clientData.zone_id,
                  userZoneId: user.zoneId,
                },
                timestamp: new Date().toISOString(),
                requestId: req.headers['x-request-id'] || 'unknown',
              },
            });
            return;
          }
        }

        // Validate medications structure using database function
        const medicationsJson = JSON.stringify(medications);
        const validateMedicationsQuery = `
          SELECT validate_medication_structure($1::jsonb) as valid
        `;

        const medicationsValidation = await client.query(validateMedicationsQuery, [
          medicationsJson,
        ]);

        if (!medicationsValidation.rows[0].valid) {
          res.status(400).json({
            error: {
              code: 'VALIDATION_ERROR',
              message:
                'Invalid medications structure. Each medication must have name, dosage, and frequency',
              details: { field: 'medications' },
              timestamp: new Date().toISOString(),
              requestId: req.headers['x-request-id'] || 'unknown',
            },
          });
          return;
        }

        // Validate allergies structure using database function
        const allergiesJson = JSON.stringify(allergies);
        const validateAllergiesQuery = `
          SELECT validate_allergies_structure($1::jsonb) as valid
        `;

        const allergiesValidation = await client.query(validateAllergiesQuery, [allergiesJson]);

        if (!allergiesValidation.rows[0].valid) {
          res.status(400).json({
            error: {
              code: 'VALIDATION_ERROR',
              message: 'Invalid allergies structure. Must be array of strings',
              details: { field: 'allergies' },
              timestamp: new Date().toISOString(),
              requestId: req.headers['x-request-id'] || 'unknown',
            },
          });
          return;
        }

        // Check if care plan exists to determine if this is create or update
        const existingCarePlanQuery = `
          SELECT id, version
          FROM care_plans
          WHERE client_id = $1 AND deleted_at IS NULL
        `;

        const existingCarePlan = await client.query(existingCarePlanQuery, [clientId]);
        const isUpdate = existingCarePlan.rows.length > 0;

        // Upsert care plan (create or update)
        const upsertQuery = `
          INSERT INTO care_plans (
            client_id,
            summary,
            medications,
            allergies,
            special_instructions,
            created_at,
            updated_at
          ) VALUES (
            $1, $2, $3::jsonb, $4::jsonb, $5, NOW(), NOW()
          )
          ON CONFLICT (client_id) WHERE deleted_at IS NULL
          DO UPDATE SET
            summary = EXCLUDED.summary,
            medications = EXCLUDED.medications,
            allergies = EXCLUDED.allergies,
            special_instructions = EXCLUDED.special_instructions,
            updated_at = NOW()
          RETURNING *
        `;

        const result = await client.query(upsertQuery, [
          clientId,
          summary,
          medicationsJson,
          allergiesJson,
          specialInstructions || null,
        ]);

        const carePlan = result.rows[0];

        // Invalidate related caches to ensure fresh data
        try {
          // Client detail cache
          await redisClient.del(`client:detail:${clientId}`);

          // Client list caches (all zones + specific zone) removed in batches to avoid blocking calls
          await deleteKeysMatchingPattern(redisClient, `clients:list:zone=${clientData.zone_id}:*`);
          await deleteKeysMatchingPattern(redisClient, 'clients:list:zone=all:*');
        } catch (cacheError) {
          logError(
            'Care plan cache invalidation error',
            cacheError instanceof Error ? cacheError : new Error(String(cacheError)),
            {
              clientId,
              userId: user.userId,
              requestId: req.headers['x-request-id'] || 'unknown',
            }
          );
        }

        // Log the operation
        logInfo(isUpdate ? 'Care plan updated' : 'Care plan created', {
          carePlanId: carePlan.id,
          clientId: carePlan.client_id,
          userId: user.userId,
          version: carePlan.version,
          timestamp: new Date().toISOString(),
          requestId: req.headers['x-request-id'] || 'unknown',
        });

        // Build response
        const responseData = {
          id: carePlan.id,
          clientId: carePlan.client_id,
          summary: carePlan.summary,
          medications: carePlan.medications,
          allergies: carePlan.allergies,
          specialInstructions: carePlan.special_instructions,
          version: carePlan.version,
          createdAt: carePlan.created_at.toISOString(),
          updatedAt: carePlan.updated_at.toISOString(),
        };

        // Return appropriate status code (201 for create, 200 for update)
        const statusCode = isUpdate ? 200 : 201;

        res.status(statusCode).json({
          data: responseData,
        });
      } catch (error) {
        logError(
          'Create/update care plan error',
          error instanceof Error ? error : new Error(String(error)),
          {
            userId: (req as AuthenticatedRequest).user?.userId,
            clientId: req.body?.clientId,
            requestId: req.headers['x-request-id'] || 'unknown',
          }
        );
        res.status(500).json({
          error: {
            code: 'INTERNAL_SERVER_ERROR',
            message: 'An error occurred while saving care plan',
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
