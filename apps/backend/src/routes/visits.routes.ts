/**
 * Visit Documentation Routes
 *
 * Handles visit documentation endpoints:
 * - POST /v1/visits - Start a visit (check-in)
 * - PATCH /v1/visits/:visitId - Update/complete visit
 * - GET /v1/visits - List visits with filtering
 * - GET /v1/visits/:visitId - Get visit details
 *
 * Reference: Architecture Blueprint - Visit Documentation Endpoints
 * Task: V4 - Implement POST /v1/visits endpoint
 *
 * Philosophy: "Offline-first everything"
 * - Instant local operations
 * - GPS auto-check-in
 * - Smart data reuse from previous visits
 * - Auto-save documentation
 */

import Ajv, { ValidateFunction } from 'ajv';
import { HeadObjectCommand } from '@aws-sdk/client-s3';
import { Request, Response, Router } from 'express';
import { Pool } from 'pg';

import { RedisClient } from '../cache/redis-client';
import { logError, logInfo } from '../config/logger';
import { authenticateJWT, AuthenticatedRequest } from '../middleware/auth';
import {
  generatePhotoUploadUrl,
  generateSignatureUploadUrl,
  S3_BUCKETS,
  s3Client,
} from '../storage/s3-client';

const parsedDefaultVisitDuration = Number.parseInt(
  process.env.DEFAULT_VISIT_DURATION_MINUTES ?? '',
  10
);
const DEFAULT_VISIT_DURATION_MINUTES = Math.min(
  480,
  Math.max(15, Number.isNaN(parsedDefaultVisitDuration) ? 60 : parsedDefaultVisitDuration)
);
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_VISIT_DURATION_MINUTES = 720;

/**
 * Create visit request body
 */
interface CreateVisitRequest {
  clientId: string;
  scheduledStartTime: string;
  checkInTime?: string;
  checkInLatitude?: number;
  checkInLongitude?: number;
  copiedFromVisitId?: string;
}

/**
 * Visit response
 */
interface VisitResponse {
  id: string;
  clientId: string;
  staffId: string;
  scheduledStartTime: string;
  checkInTime: string | null;
  checkInLatitude: number | null;
  checkInLongitude: number | null;
  status: string;
  createdAt: string;
}

type DocumentationPayload = {
  vitalSigns?: Record<string, unknown> | null;
  activities?: Record<string, unknown> | null;
  observations?: string | null;
  concerns?: string | null;
};

const ajv = new Ajv({ allErrors: true, allowUnionTypes: true });

const vitalSignsSchema = {
  type: 'object',
  properties: {
    bloodPressure: {
      type: 'object',
      properties: {
        systolic: { type: 'number' },
        diastolic: { type: 'number' },
      },
      required: ['systolic', 'diastolic'],
      additionalProperties: true,
    },
    heartRate: { type: 'number' },
    temperature: { type: 'number' },
    respiratoryRate: { type: 'number' },
    oxygenSaturation: { type: 'number' },
    bloodSugar: { type: 'number' },
  },
  additionalProperties: true,
} as const;

const activitiesSchema = {
  type: 'object',
  properties: {
    tasksCompleted: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          completed: { type: 'boolean' },
          notes: { type: 'string' },
        },
        additionalProperties: true,
      },
    },
    mealPreparation: { type: 'boolean' },
    mobilitySupport: { type: 'boolean' },
    companionship: { type: 'boolean' },
    notes: { type: 'string' },
  },
  additionalProperties: true,
} as const;

const validateVitalSigns = ajv.compile(vitalSignsSchema);
const validateActivities = ajv.compile(activitiesSchema);

/**
 * Invalidate all cached visit list queries
 *
 * Deletes all Redis keys matching the visits:list:* pattern to ensure
 * subsequent list requests fetch fresh data from the database after
 * visits are created or updated.
 *
 * @param redisClient - Redis client instance
 */
async function invalidateVisitListCache(redisClient: RedisClient): Promise<void> {
  try {
    // Use incremental SCAN to avoid blocking Redis
    const keysToDelete: string[] = [];
    let cursor = '0';

    do {
      const [nextCursor, keys] = await redisClient.scan(
        cursor,
        'MATCH',
        'visits:list:*',
        'COUNT',
        100
      );
      if (keys.length > 0) {
        keysToDelete.push(...keys);
      }
      cursor = nextCursor;
    } while (cursor !== '0');

    if (keysToDelete.length > 0) {
      // Delete in manageable chunks to respect command argument limits
      const chunkSize = 100;
      for (let i = 0; i < keysToDelete.length; i += chunkSize) {
        const chunk = keysToDelete.slice(i, i + chunkSize);
        await redisClient.del(...chunk);
      }
      logInfo('Visit list cache invalidated', { keysDeleted: keysToDelete.length });
    }
  } catch (error) {
    // Log error but don't fail the request - cache invalidation is not critical
    logError('Failed to invalidate visit list cache', error as Error);
  }
}

/**
 * Invalidate cached visit detail responses for a given visit
 *
 * Deletes all Redis keys matching the visit:detail:{visitId}:* pattern to ensure
 * cached visit detail responses stay consistent across authorization scopes.
 *
 * @param redisClient - Redis client instance
 * @param visitId - Visit identifier
 */
async function invalidateVisitDetailCache(
  redisClient: RedisClient,
  visitId: string
): Promise<void> {
  const cacheKeyPattern = `visit:detail:${visitId}:*`;
  const legacyCacheKey = `visit:detail:${visitId}`;

  try {
    const scopedKeys: string[] = [];
    let cursor = '0';

    do {
      const [nextCursor, keys] = await redisClient.scan(
        cursor,
        'MATCH',
        cacheKeyPattern,
        'COUNT',
        100
      );
      if (keys.length > 0) {
        scopedKeys.push(...keys);
      }
      cursor = nextCursor;
    } while (cursor !== '0');

    if (scopedKeys.length > 0) {
      const chunkSize = 100;
      for (let i = 0; i < scopedKeys.length; i += chunkSize) {
        const chunk = scopedKeys.slice(i, i + chunkSize);
        await redisClient.del(...chunk);
      }
      logInfo('Visit detail cache invalidated', {
        visitId,
        keysDeleted: scopedKeys.length,
      });
    }

    // Clean up potential legacy cache entries without scope
    await redisClient.del(legacyCacheKey);
  } catch (error) {
    logError('Failed to invalidate visit detail cache', error as Error, { visitId });
  }
}

/**
 * Create visits router
 */
export function createVisitsRouter(pool: Pool, redisClient: RedisClient): Router {
  const router = Router();

  /**
   * GET /v1/visits
   * List visits with filtering and pagination
   *
   * Returns a paginated list of visits with optional filtering by staff, client,
   * date range, and status. Supports Redis caching for performance.
   *
   * Authentication: Required
   * Authorization: Caregivers see only their visits, coordinators/admins see all in zone
   *
   * Security: Cache keys are scoped per user/zone to prevent cross-user data leakage.
   * User validation occurs BEFORE cache lookup to ensure proper authorization.
   *
   * Query Parameters:
   * - staffId: UUID (optional) - Filter by staff member
   * - clientId: UUID (optional) - Filter by client
   * - startDate: ISO 8601 (optional) - Filter visits from this date
   * - endDate: ISO 8601 (optional) - Filter visits until this date
   * - status: string (optional) - Filter by status (scheduled, in_progress, completed, cancelled)
   * - page: number (optional, default: 1) - Page number
   * - limit: number (optional, default: 50, max: 100) - Results per page
   *
   * Response: 200 OK
   * - Array of visit summaries with client names
   * - Pagination metadata
   *
   * Errors:
   * - 400: Invalid query parameters
   * - 401: Unauthorized
   * - 403: Forbidden (access denied)
   */
  router.get('/', authenticateJWT(redisClient), async (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    const userId = authReq.user?.userId;

    if (!userId) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Authentication required',
      });
    }

    // Parse query parameters
    const { staffId, clientId, startDate, endDate, status, page = '1', limit = '50' } = req.query;

    // Validate and parse pagination
    const pageNum = Math.max(1, parseInt(page as string, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit as string, 10) || 50));
    const offset = (pageNum - 1) * limitNum;

    // Validate UUID formats if provided
    if (staffId && !UUID_REGEX.test(staffId as string)) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Invalid staffId format',
      });
    }

    if (clientId && !UUID_REGEX.test(clientId as string)) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Invalid clientId format',
      });
    }

    // Validate status if provided
    const validStatuses = ['scheduled', 'in_progress', 'completed', 'cancelled'];
    if (status && !validStatuses.includes(status as string)) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Invalid status. Must be one of: scheduled, in_progress, completed, cancelled',
      });
    }

    // Validate dates if provided
    if (startDate && isNaN(Date.parse(startDate as string))) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Invalid startDate format. Must be ISO 8601',
      });
    }

    if (endDate && isNaN(Date.parse(endDate as string))) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Invalid endDate format. Must be ISO 8601',
      });
    }

    try {
      // Get user's zone and role for authorization BEFORE checking cache
      const userResult = await pool.query('SELECT zone_id, role FROM users WHERE id = $1', [
        userId,
      ]);

      if (userResult.rows.length === 0) {
        return res.status(403).json({
          error: 'Forbidden',
          message: 'User not found',
        });
      }

      const userZoneId = userResult.rows[0].zone_id;
      const userRoleFromDb = userResult.rows[0].role;

      // Build cache key with user-specific scope to prevent cross-user data leakage
      // For caregivers: include userId (they only see their own visits)
      // For coordinators/admins: include zoneId (they see all visits in their zone)
      const principalScope =
        userRoleFromDb === 'caregiver' ? `user:${userId}` : `zone:${userZoneId}`;
      const cacheKey = `visits:list:${principalScope}:staff=${staffId || 'all'}:client=${clientId || 'all'}:start=${startDate || 'all'}:end=${endDate || 'all'}:status=${status || 'all'}:page=${pageNum}:limit=${limitNum}`;

      // Try to get from cache AFTER building user-scoped cache key
      const cached = await redisClient.get(cacheKey);
      if (cached) {
        try {
          const cachedData = JSON.parse(cached);
          logInfo('Visits list cache hit', { cacheKey, userId, principalScope });
          return res.status(200).json({
            ...cachedData,
            meta: { cached: true },
          });
        } catch (error) {
          // Corrupted cache entry - log and continue to fetch fresh data
          logError('Failed to parse cached visits list', error as Error, { cacheKey });
          await redisClient.del(cacheKey).catch((err) => {
            logError('Failed to delete corrupted cache entry', err as Error, { cacheKey });
          });
        }
      }

      // Build WHERE clause based on filters and authorization
      const conditions: string[] = [];
      const values: (string | number)[] = [];
      let paramCount = 1;

      // Authorization: caregivers can only see their own visits
      if (userRoleFromDb === 'caregiver') {
        conditions.push(`v.staff_id = $${paramCount}`);
        values.push(userId);
        paramCount++;
      } else {
        // Coordinators and admins see visits in their zone
        conditions.push(`c.zone_id = $${paramCount}`);
        values.push(userZoneId);
        paramCount++;
      }

      // Apply filters
      if (staffId) {
        conditions.push(`v.staff_id = $${paramCount}`);
        values.push(staffId as string);
        paramCount++;
      }

      if (clientId) {
        conditions.push(`v.client_id = $${paramCount}`);
        values.push(clientId as string);
        paramCount++;
      }

      if (startDate) {
        conditions.push(`v.scheduled_start_time >= $${paramCount}`);
        values.push(startDate as string);
        paramCount++;
      }

      if (endDate) {
        conditions.push(`v.scheduled_start_time <= $${paramCount}`);
        values.push(endDate as string);
        paramCount++;
      }

      if (status) {
        conditions.push(`v.status = $${paramCount}`);
        values.push(status as string);
        paramCount++;
      }

      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

      // Get total count
      const countQuery = `
        SELECT COUNT(*) as total
        FROM visits v
        INNER JOIN clients c ON v.client_id = c.id
        ${whereClause}
      `;

      const countResult = await pool.query(countQuery, values);
      const total = parseInt(countResult.rows[0].total, 10);
      const totalPages = Math.ceil(total / limitNum);

      // Get paginated visits
      const visitsQuery = `
        SELECT 
          v.id,
          v.client_id,
          c.first_name || ' ' || c.last_name as client_name,
          v.staff_id,
          u.first_name || ' ' || u.last_name as staff_name,
          v.scheduled_start_time,
          v.check_in_time,
          v.check_out_time,
          v.duration_minutes,
          v.status,
          v.created_at
        FROM visits v
        INNER JOIN clients c ON v.client_id = c.id
        INNER JOIN users u ON v.staff_id = u.id
        ${whereClause}
        ORDER BY v.scheduled_start_time DESC
        LIMIT $${paramCount} OFFSET $${paramCount + 1}
      `;

      const visitsResult = await pool.query(visitsQuery, [...values, limitNum, offset]);

      const response = {
        data: {
          visits: visitsResult.rows.map((row) => ({
            id: row.id,
            clientId: row.client_id,
            clientName: row.client_name,
            staffId: row.staff_id,
            staffName: row.staff_name,
            scheduledStartTime: row.scheduled_start_time,
            checkInTime: row.check_in_time,
            checkOutTime: row.check_out_time,
            duration: row.duration_minutes,
            status: row.status,
            createdAt: row.created_at,
          })),
          pagination: {
            page: pageNum,
            limit: limitNum,
            total,
            totalPages,
          },
        },
      };

      // Cache the response for 5 minutes
      await redisClient.setEx(cacheKey, 300, JSON.stringify(response));

      logInfo('Visits list fetched successfully', {
        userId,
        userRole: userRoleFromDb,
        principalScope,
        total,
        page: pageNum,
        filters: { staffId, clientId, startDate, endDate, status },
      });

      return res.status(200).json(response);
    } catch (error) {
      logError('Error fetching visits list', error as Error, {
        userId,
        filters: { staffId, clientId, startDate, endDate, status },
      });

      return res.status(500).json({
        error: 'Internal Server Error',
        message: 'Failed to fetch visits',
      });
    }
  });

  /**
   * POST /v1/visits
   * Start a visit (check-in)
   *
   * Creates a new visit record with check-in time and GPS coordinates.
   * Supports smart data reuse by copying documentation from a previous visit.
   *
   * Authentication: Required (caregiver role)
   * Authorization: Caregiver can only create visits for clients in their zone
   *
   * Request Body:
   * - clientId: UUID of the client being visited
   * - scheduledStartTime: ISO 8601 timestamp
   * - checkInTime: ISO 8601 timestamp (optional, defaults to now)
   * - checkInLatitude: GPS latitude (optional)
   * - checkInLongitude: GPS longitude (optional)
   * - copiedFromVisitId: UUID of previous visit to copy documentation from (optional)
   *
   * Response: 201 Created
   * - Visit object with id, status 'in_progress'
   *
   * Errors:
   * - 400: Invalid request data
   * - 404: Client not found
   * - 403: Caregiver not authorized for this client's zone
   * - 409: Visit already exists for this time slot
   */
  router.post('/', authenticateJWT(redisClient), async (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    const userId = authReq.user?.userId;
    const userRole = authReq.user?.role;

    if (!userId) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Authentication required',
      });
    }

    // Only caregivers can create visits
    if (userRole !== 'caregiver') {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Only caregivers can create visits',
      });
    }

    const {
      clientId,
      scheduledStartTime,
      checkInTime,
      checkInLatitude,
      checkInLongitude,
      copiedFromVisitId,
    } = req.body as CreateVisitRequest;

    // Validate required fields
    if (!clientId || !scheduledStartTime) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'clientId and scheduledStartTime are required',
      });
    }

    // Validate UUID format
    if (!UUID_REGEX.test(clientId)) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Invalid clientId format',
      });
    }

    if (copiedFromVisitId && !UUID_REGEX.test(copiedFromVisitId)) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Invalid copiedFromVisitId format',
      });
    }

    // Validate GPS coordinates if provided
    if (checkInLatitude !== undefined && (checkInLatitude < -90 || checkInLatitude > 90)) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'checkInLatitude must be between -90 and 90',
      });
    }

    if (checkInLongitude !== undefined && (checkInLongitude < -180 || checkInLongitude > 180)) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'checkInLongitude must be between -180 and 180',
      });
    }

    const newVisitStart = new Date(scheduledStartTime);
    if (Number.isNaN(newVisitStart.getTime())) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'scheduledStartTime must be a valid ISO 8601 timestamp',
      });
    }

    const expectedDurationMinutes = DEFAULT_VISIT_DURATION_MINUTES;
    const newVisitEnd = new Date(newVisitStart.getTime() + expectedDurationMinutes * 60 * 1000);

    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      // Check if client exists and get their zone
      const clientResult = await client.query(
        `SELECT id, zone_id, first_name, last_name 
         FROM clients 
         WHERE id = $1 AND deleted_at IS NULL`,
        [clientId]
      );

      if (clientResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({
          error: 'Not Found',
          message: 'Client not found',
        });
      }

      const clientData = clientResult.rows[0];
      const clientZoneId = clientData.zone_id;

      // Check if caregiver is in the same zone as the client
      const caregiverResult = await client.query(`SELECT zone_id FROM users WHERE id = $1`, [
        userId,
      ]);

      if (caregiverResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(403).json({
          error: 'Forbidden',
          message: 'Caregiver not found',
        });
      }

      const caregiverZoneId = caregiverResult.rows[0].zone_id;

      if (caregiverZoneId !== clientZoneId) {
        await client.query('ROLLBACK');
        logInfo('Visit creation denied: zone mismatch', {
          userId,
          clientId,
          caregiverZone: caregiverZoneId,
          clientZone: clientZoneId,
        });
        return res.status(403).json({
          error: 'Forbidden',
          message: 'Cannot create visit for client in different zone',
        });
      }

      // Check for overlapping visits (same client, overlapping time)
      const overlapCheck = await client.query(
        `SELECT id FROM visits
         WHERE client_id = $1
           AND status IN ('scheduled', 'in_progress')
           AND COALESCE(check_in_time, scheduled_start_time) < $3
           AND COALESCE(
             check_out_time,
             CASE
               WHEN duration_minutes IS NOT NULL THEN scheduled_start_time + (duration_minutes * INTERVAL '1 minute')
               ELSE COALESCE(check_in_time, scheduled_start_time) + ($4 * INTERVAL '1 minute')
             END
           ) > $2`,
        [clientId, newVisitStart.toISOString(), newVisitEnd.toISOString(), expectedDurationMinutes]
      );

      if (overlapCheck.rows.length > 0) {
        await client.query('ROLLBACK');
        return res.status(409).json({
          error: 'Conflict',
          message: 'Visit already exists for this time slot',
        });
      }

      // Use provided check-in time or current time
      const actualCheckInTime = checkInTime || new Date().toISOString();

      // Create the visit
      const visitResult = await client.query(
        `INSERT INTO visits (
          client_id,
          staff_id,
          scheduled_start_time,
          check_in_time,
          check_in_latitude,
          check_in_longitude,
          status,
          copied_from_visit_id
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING 
          id,
          client_id,
          staff_id,
          scheduled_start_time,
          check_in_time,
          check_in_latitude,
          check_in_longitude,
          status,
          created_at`,
        [
          clientId,
          userId,
          scheduledStartTime,
          actualCheckInTime,
          checkInLatitude ?? null,
          checkInLongitude ?? null,
          'in_progress',
          copiedFromVisitId ?? null,
        ]
      );

      const visit = visitResult.rows[0];

      // If copiedFromVisitId is provided, copy documentation
      if (copiedFromVisitId) {
        // Verify the source visit exists and belongs to the same client
        const sourceVisitResult = await client.query(
          `SELECT id, client_id FROM visits WHERE id = $1`,
          [copiedFromVisitId]
        );

        if (sourceVisitResult.rows.length > 0) {
          const sourceVisit = sourceVisitResult.rows[0];

          // Only copy if it's for the same client
          if (sourceVisit.client_id === clientId) {
            // Copy documentation from previous visit
            const sourceDocResult = await client.query(
              `SELECT vital_signs, activities, observations 
               FROM visit_documentation 
               WHERE visit_id = $1`,
              [copiedFromVisitId]
            );

            if (sourceDocResult.rows.length > 0) {
              const sourceDoc = sourceDocResult.rows[0];

              // Create documentation for new visit with copied data
              await client.query(
                `INSERT INTO visit_documentation (
                  visit_id,
                  vital_signs,
                  activities,
                  observations
                ) VALUES ($1, $2, $3, $4)`,
                [visit.id, sourceDoc.vital_signs, sourceDoc.activities, sourceDoc.observations]
              );

              logInfo('Documentation copied from previous visit', {
                newVisitId: visit.id,
                sourceVisitId: copiedFromVisitId,
                clientId,
              });
            }
          } else {
            logInfo('Documentation copy skipped: different client', {
              newVisitId: visit.id,
              sourceVisitId: copiedFromVisitId,
              sourceClientId: sourceVisit.client_id,
              targetClientId: clientId,
            });
          }
        }
      }

      await client.query('COMMIT');

      // Invalidate cached visit lists after successful creation
      await invalidateVisitListCache(redisClient);

      logInfo('Visit created successfully', {
        visitId: visit.id,
        clientId,
        staffId: userId,
        checkInTime: actualCheckInTime,
        hasGPS: checkInLatitude !== undefined && checkInLongitude !== undefined,
        copiedFromVisit: !!copiedFromVisitId,
      });

      // Return visit data
      const response: VisitResponse = {
        id: visit.id,
        clientId: visit.client_id,
        staffId: visit.staff_id,
        scheduledStartTime: visit.scheduled_start_time,
        checkInTime: visit.check_in_time,
        checkInLatitude: visit.check_in_latitude,
        checkInLongitude: visit.check_in_longitude,
        status: visit.status,
        createdAt: visit.created_at,
      };

      return res.status(201).json(response);
    } catch (error) {
      await client.query('ROLLBACK');
      logError('Error creating visit', error as Error, {
        clientId,
        userId,
      });

      return res.status(500).json({
        error: 'Internal Server Error',
        message: 'Failed to create visit',
      });
    } finally {
      client.release();
    }
  });

  /**
   * PATCH /v1/visits/:visitId
   * Update a visit (including check-out/completion)
   *
   * Updates visit details, records check-out time and GPS, calculates duration,
   * and changes status to 'completed'. Supports partial updates to documentation.
   *
   * Authentication: Required (caregiver role)
   * Authorization: Caregiver must own the visit (or be coordinator/admin)
   *
   * Request Body:
   * - checkOutTime: ISO 8601 timestamp (optional)
   * - checkOutLatitude: GPS latitude (optional)
   * - checkOutLongitude: GPS longitude (optional)
   * - status: 'completed' | 'cancelled' (optional)
   * - documentation: Partial documentation updates (optional)
   *
   * Response: 200 OK
   * - Updated visit object with calculated duration
   *
   * Errors:
   * - 400: Invalid request data
   * - 404: Visit not found
   * - 403: Not authorized to update this visit
   */
  router.patch('/:visitId', authenticateJWT(redisClient), async (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    const userId = authReq.user?.userId;
    const userRole = authReq.user?.role;
    const { visitId } = req.params;

    if (!userId) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Authentication required',
      });
    }

    // Validate UUID format
    if (!UUID_REGEX.test(visitId)) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Invalid visitId format',
      });
    }

    const { checkOutTime, checkOutLatitude, checkOutLongitude, status, documentation } = req.body;

    // Validate GPS coordinates if provided
    if (checkOutLatitude !== undefined && (checkOutLatitude < -90 || checkOutLatitude > 90)) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'checkOutLatitude must be between -90 and 90',
      });
    }

    if (checkOutLongitude !== undefined && (checkOutLongitude < -180 || checkOutLongitude > 180)) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'checkOutLongitude must be between -180 and 180',
      });
    }

    if (documentation !== undefined) {
      if (documentation === null || typeof documentation !== 'object') {
        return res.status(400).json({
          error: 'Bad Request',
          message: 'documentation must be an object when provided',
        });
      }

      const docPayload = documentation as DocumentationPayload;

      const structuredFieldValidators: Record<
        keyof Pick<DocumentationPayload, 'vitalSigns' | 'activities'>,
        ValidateFunction
      > = {
        vitalSigns: validateVitalSigns,
        activities: validateActivities,
      };

      const labelMap: Record<keyof typeof structuredFieldValidators, string> = {
        vitalSigns: 'documentation.vitalSigns',
        activities: 'documentation.activities',
      };

      const structuredFields: Array<keyof typeof structuredFieldValidators> = [
        'vitalSigns',
        'activities',
      ];

      for (const key of structuredFields) {
        const value = docPayload[key];
        if (value === undefined || value === null) {
          continue;
        }

        const validator = structuredFieldValidators[key];

        if (!validator(value)) {
          return res.status(400).json({
            error: 'Bad Request',
            message: `${labelMap[key]} failed validation`,
            details: validator.errors ?? [],
          });
        }
      }
    }

    // Validate status if provided
    if (status && !['completed', 'cancelled', 'in_progress'].includes(status)) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'status must be one of: completed, cancelled, in_progress',
      });
    }

    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      // Get visit and verify ownership
      const visitResult = await client.query(
        `SELECT id, staff_id, client_id, check_in_time, check_out_time, status
         FROM visits 
         WHERE id = $1`,
        [visitId]
      );

      if (visitResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({
          error: 'Not Found',
          message: 'Visit not found',
        });
      }

      const visit = visitResult.rows[0];

      // Authorization check: caregiver must own the visit, or be coordinator/admin
      if (userRole === 'caregiver' && visit.staff_id !== userId) {
        await client.query('ROLLBACK');
        return res.status(403).json({
          error: 'Forbidden',
          message: 'You can only update your own visits',
        });
      }

      // Build update query dynamically based on provided fields
      const updates: string[] = [];
      const values: (string | number | null)[] = [];
      let paramCount = 1;

      if (checkOutTime !== undefined) {
        updates.push(`check_out_time = $${paramCount}`);
        values.push(checkOutTime);
        paramCount++;
      }

      if (checkOutLatitude !== undefined) {
        updates.push(`check_out_latitude = $${paramCount}`);
        values.push(checkOutLatitude ?? null);
        paramCount++;
      }

      if (checkOutLongitude !== undefined) {
        updates.push(`check_out_longitude = $${paramCount}`);
        values.push(checkOutLongitude ?? null);
        paramCount++;
      }

      if (status !== undefined) {
        updates.push(`status = $${paramCount}`);
        values.push(status);
        paramCount++;
      }

      // Calculate duration if check-out time is provided
      if (checkOutTime && visit.check_in_time) {
        const checkInTime = new Date(visit.check_in_time);
        const checkOutTimeDate = new Date(checkOutTime);
        const durationMinutes = Math.round(
          (checkOutTimeDate.getTime() - checkInTime.getTime()) / (1000 * 60)
        );

        if (!Number.isFinite(durationMinutes)) {
          await client.query('ROLLBACK');
          return res.status(400).json({
            error: 'Bad Request',
            message: 'Unable to calculate visit duration',
          });
        }

        if (durationMinutes < 0) {
          await client.query('ROLLBACK');
          return res.status(400).json({
            error: 'Bad Request',
            message: 'Check-out time cannot be before check-in time',
          });
        }

        if (durationMinutes > MAX_VISIT_DURATION_MINUTES) {
          await client.query('ROLLBACK');
          return res.status(400).json({
            error: 'Bad Request',
            message: `Visit duration exceeds maximum allowed of ${MAX_VISIT_DURATION_MINUTES} minutes`,
          });
        }

        updates.push(`duration_minutes = $${paramCount}`);
        values.push(durationMinutes);
        paramCount++;
      }

      // Validate that at least one update is provided
      if (updates.length === 0 && !documentation) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          error: 'Bad Request',
          message: 'No updates provided',
        });
      }

      // Variable to store updated visit data
      let updatedVisit = visit;

      // Update visit if there are changes
      if (updates.length > 0) {
        values.push(visitId);
        const updateQuery = `
          UPDATE visits 
          SET ${updates.join(', ')}, updated_at = CURRENT_TIMESTAMP
          WHERE id = $${paramCount}
          RETURNING *
        `;

        const updatedVisitResult = await client.query(updateQuery, values);
        updatedVisit = updatedVisitResult.rows[0];
      }

      // Update documentation if provided
      if (documentation) {
        const docPayload = documentation as DocumentationPayload;

        // Check if documentation exists
        const docResult = await client.query(
          'SELECT id FROM visit_documentation WHERE visit_id = $1',
          [visitId]
        );

        if (docResult.rows.length > 0) {
          // Update existing documentation
          const docUpdates: string[] = [];
          const docValues: (string | null)[] = [];
          let docParamCount = 1;

          if (docPayload.vitalSigns !== undefined) {
            const vitalSignsValue =
              docPayload.vitalSigns === null ? null : JSON.stringify(docPayload.vitalSigns);
            docUpdates.push(`vital_signs = $${docParamCount}`);
            docValues.push(vitalSignsValue);
            docParamCount++;
          }

          if (docPayload.activities !== undefined) {
            const activitiesValue =
              docPayload.activities === null ? null : JSON.stringify(docPayload.activities);
            docUpdates.push(`activities = $${docParamCount}`);
            docValues.push(activitiesValue);
            docParamCount++;
          }

          if (docPayload.observations !== undefined) {
            docUpdates.push(`observations = $${docParamCount}`);
            docValues.push(docPayload.observations ?? null);
            docParamCount++;
          }

          if (docPayload.concerns !== undefined) {
            docUpdates.push(`concerns = $${docParamCount}`);
            docValues.push(docPayload.concerns ?? null);
            docParamCount++;
          }

          if (docUpdates.length > 0) {
            docValues.push(visitId);
            await client.query(
              `UPDATE visit_documentation 
               SET ${docUpdates.join(', ')}, updated_at = CURRENT_TIMESTAMP
               WHERE visit_id = $${docParamCount}`,
              docValues
            );
          }
        } else {
          // Create new documentation
          await client.query(
            `INSERT INTO visit_documentation (
              visit_id, vital_signs, activities, observations, concerns
            ) VALUES ($1, $2, $3, $4, $5)`,
            [
              visitId,
              docPayload.vitalSigns === undefined || docPayload.vitalSigns === null
                ? null
                : JSON.stringify(docPayload.vitalSigns),
              docPayload.activities === undefined || docPayload.activities === null
                ? null
                : JSON.stringify(docPayload.activities),
              docPayload.observations ?? null,
              docPayload.concerns ?? null,
            ]
          );
        }
      }

      // Commit transaction after all updates succeed
      await client.query('COMMIT');

      // Invalidate cached visit lists after successful update
      await invalidateVisitListCache(redisClient);

      // Invalidate cached visit detail after successful update
      await invalidateVisitDetailCache(redisClient, visitId);

      logInfo('Visit updated successfully', {
        visitId,
        userId,
        status: updatedVisit.status,
        duration: updatedVisit.duration_minutes,
        hasCheckOut: !!checkOutTime,
        hasDocumentation: !!documentation,
      });

      // Return updated visit data
      const response: VisitResponse = {
        id: updatedVisit.id,
        clientId: updatedVisit.client_id,
        staffId: updatedVisit.staff_id,
        scheduledStartTime: updatedVisit.scheduled_start_time,
        checkInTime: updatedVisit.check_in_time,
        checkInLatitude: updatedVisit.check_in_latitude,
        checkInLongitude: updatedVisit.check_in_longitude,
        status: updatedVisit.status,
        createdAt: updatedVisit.created_at,
      };

      return res.status(200).json(response);
    } catch (error) {
      await client.query('ROLLBACK');
      logError('Error updating visit', error as Error, {
        visitId,
        userId,
      });

      return res.status(500).json({
        error: 'Internal Server Error',
        message: 'Failed to update visit',
      });
    } finally {
      client.release();
    }
  });

  /**
   * GET /v1/visits/:visitId
   * Get visit details
   *
   * Returns complete visit information including documentation, photos, and client details.
   * Supports Redis caching for performance.
   *
   * Authentication: Required
   * Authorization: Caregiver must own the visit, or coordinator/admin in same zone
   *
   * Response: 200 OK
   * - Complete visit object with all related data
   * - Client information
   * - Visit documentation (vital signs, activities, observations, concerns)
   * - Photos with S3 URLs
   *
   * Errors:
   * - 400: Invalid visitId format
   * - 401: Unauthorized
   * - 403: Forbidden (access denied)
   * - 404: Visit not found
   */
  router.get('/:visitId', authenticateJWT(redisClient), async (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    const userId = authReq.user?.userId;
    const { visitId } = req.params;

    if (!userId) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Authentication required',
      });
    }

    // Validate UUID format
    if (!UUID_REGEX.test(visitId)) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Invalid visitId format',
      });
    }

    try {
      // Get user's zone and role for authorization
      const userResult = await pool.query('SELECT zone_id, role FROM users WHERE id = $1', [
        userId,
      ]);

      if (userResult.rows.length === 0) {
        return res.status(403).json({
          error: 'Forbidden',
          message: 'User not found',
        });
      }

      const userZoneId = userResult.rows[0].zone_id;
      const userRoleFromDb = userResult.rows[0].role;

      // Build cache key scoped to user/zone to reduce cross-user inference
      const principalScope =
        userRoleFromDb === 'caregiver' ? `user:${userId}` : `zone:${userZoneId}`;
      const cacheKey = `visit:detail:${visitId}:${principalScope}`;

      // Try to get from cache
      const cached = await redisClient.get(cacheKey);
      if (cached) {
        try {
          const cachedData = JSON.parse(cached);

          // Authorization check before returning cached data
          if (userRoleFromDb === 'caregiver' && cachedData.data.staffId !== userId) {
            return res.status(403).json({
              error: 'Forbidden',
              message: 'You can only view your own visits',
            });
          }

          if (
            (userRoleFromDb === 'coordinator' || userRoleFromDb === 'admin') &&
            cachedData.data.client.zoneId !== userZoneId
          ) {
            return res.status(403).json({
              error: 'Forbidden',
              message: 'You can only view visits in your zone',
            });
          }

          logInfo('Visit detail cache hit', { visitId, userId, principalScope });
          return res.status(200).json({
            ...cachedData,
            meta: { cached: true },
          });
        } catch (error) {
          // Corrupted cache entry - log and continue to fetch fresh data
          logError('Failed to parse cached visit detail', error as Error, { visitId });
          await redisClient.del(cacheKey).catch(() => {});
        }
      }

      // Get visit with client and staff information
      const visitQuery = `
        SELECT 
          v.id,
          v.client_id,
          v.staff_id,
          v.scheduled_start_time,
          v.check_in_time,
          v.check_in_latitude,
          v.check_in_longitude,
          v.check_out_time,
          v.check_out_latitude,
          v.check_out_longitude,
          v.status,
          v.duration_minutes,
          v.copied_from_visit_id,
          v.created_at,
          v.updated_at,
          c.first_name as client_first_name,
          c.last_name as client_last_name,
          c.date_of_birth as client_date_of_birth,
          c.address as client_address,
          c.latitude as client_latitude,
          c.longitude as client_longitude,
          c.phone as client_phone,
          c.emergency_contact_name,
          c.emergency_contact_phone,
          c.emergency_contact_relationship,
          c.zone_id as client_zone_id,
          u.first_name as staff_first_name,
          u.last_name as staff_last_name,
          u.email as staff_email
        FROM visits v
        INNER JOIN clients c ON v.client_id = c.id
        INNER JOIN users u ON v.staff_id = u.id
        WHERE v.id = $1
      `;

      const visitResult = await pool.query(visitQuery, [visitId]);

      if (visitResult.rows.length === 0) {
        return res.status(404).json({
          error: 'Not Found',
          message: 'Visit not found',
        });
      }

      const visit = visitResult.rows[0];

      // Authorization check: caregiver must own the visit
      if (userRoleFromDb === 'caregiver' && visit.staff_id !== userId) {
        return res.status(403).json({
          error: 'Forbidden',
          message: 'You can only view your own visits',
        });
      }

      // Authorization check: coordinator/admin must be in same zone as client
      if (
        (userRoleFromDb === 'coordinator' || userRoleFromDb === 'admin') &&
        visit.client_zone_id !== userZoneId
      ) {
        return res.status(403).json({
          error: 'Forbidden',
          message: 'You can only view visits in your zone',
        });
      }

      // Get visit documentation
      const docQuery = `
        SELECT 
          vital_signs,
          activities,
          observations,
          concerns,
          signature_url,
          created_at,
          updated_at
        FROM visit_documentation
        WHERE visit_id = $1
      `;

      const docResult = await pool.query(docQuery, [visitId]);
      const documentation = docResult.rows.length > 0 ? docResult.rows[0] : null;

      // Get visit photos
      const photosQuery = `
        SELECT 
          id,
          s3_key,
          s3_url,
          thumbnail_s3_key,
          uploaded_at
        FROM visit_photos
        WHERE visit_id = $1
        ORDER BY uploaded_at ASC
      `;

      const photosResult = await pool.query(photosQuery, [visitId]);

      // Build response
      const response = {
        data: {
          id: visit.id,
          clientId: visit.client_id,
          staffId: visit.staff_id,
          scheduledStartTime: visit.scheduled_start_time,
          checkInTime: visit.check_in_time,
          checkInLatitude: visit.check_in_latitude,
          checkInLongitude: visit.check_in_longitude,
          checkOutTime: visit.check_out_time,
          checkOutLatitude: visit.check_out_latitude,
          checkOutLongitude: visit.check_out_longitude,
          status: visit.status,
          duration: visit.duration_minutes,
          copiedFromVisitId: visit.copied_from_visit_id,
          createdAt: visit.created_at,
          updatedAt: visit.updated_at,
          client: {
            id: visit.client_id,
            firstName: visit.client_first_name,
            lastName: visit.client_last_name,
            dateOfBirth: visit.client_date_of_birth,
            address: visit.client_address,
            latitude: visit.client_latitude,
            longitude: visit.client_longitude,
            phone: visit.client_phone,
            emergencyContact: {
              name: visit.emergency_contact_name,
              phone: visit.emergency_contact_phone,
              relationship: visit.emergency_contact_relationship,
            },
            zoneId: visit.client_zone_id,
          },
          staff: {
            id: visit.staff_id,
            firstName: visit.staff_first_name,
            lastName: visit.staff_last_name,
            email: visit.staff_email,
          },
          documentation: documentation
            ? {
                vitalSigns: documentation.vital_signs,
                activities: documentation.activities,
                observations: documentation.observations,
                concerns: documentation.concerns,
                signatureUrl: documentation.signature_url,
                createdAt: documentation.created_at,
                updatedAt: documentation.updated_at,
              }
            : null,
          photos: photosResult.rows.map((photo) => ({
            id: photo.id,
            s3Key: photo.s3_key,
            s3Url: photo.s3_url,
            thumbnailS3Key: photo.thumbnail_s3_key,
            uploadedAt: photo.uploaded_at,
          })),
        },
      };

      // Cache the response for 5 minutes
      await redisClient.setEx(cacheKey, 300, JSON.stringify(response));

      logInfo('Visit detail fetched successfully', {
        visitId,
        userId,
        userRole: userRoleFromDb,
        principalScope,
        hasDocumentation: !!documentation,
        photoCount: photosResult.rows.length,
      });

      return res.status(200).json(response);
    } catch (error) {
      logError('Error fetching visit detail', error as Error, {
        visitId,
        userId,
      });

      return res.status(500).json({
        error: 'Internal Server Error',
        message: 'Failed to fetch visit details',
      });
    }
  });

  /**
   * POST /v1/visits/:visitId/photos/upload-url
   * Generate pre-signed S3 URL for photo upload
   *
   * Generates a pre-signed URL that allows the mobile app to upload photos
   * directly to S3, bypassing the backend server for better performance.
   *
   * Authentication: Required (caregiver role)
   * Authorization: Caregiver must own the visit
   *
   * Request Body:
   * - fileName: string - Original file name
   * - mimeType: string - MIME type (image/jpeg, image/png, image/webp)
   * - fileSize: number - File size in bytes (max 2MB after compression)
   *
   * Response: 200 OK
   * - uploadUrl: Pre-signed S3 URL (expires in 1 hour)
   * - photoKey: S3 object key for later reference
   * - expiresAt: ISO 8601 timestamp when URL expires
   *
   * Errors:
   * - 400: Invalid request data or file too large
   * - 403: Not authorized to upload photos for this visit
   * - 404: Visit not found
   */
  router.post(
    '/:visitId/photos/upload-url',
    authenticateJWT(redisClient),
    async (req: Request, res: Response) => {
      const authReq = req as AuthenticatedRequest;
      const userId = authReq.user?.userId;
      const userRole = authReq.user?.role;
      const { visitId } = req.params;
      const { fileName, mimeType, fileSize } = req.body;

      if (!userId) {
        return res.status(401).json({
          error: 'Unauthorized',
          message: 'Authentication required',
        });
      }

      // Validate UUID format
      if (!UUID_REGEX.test(visitId)) {
        return res.status(400).json({
          error: 'Bad Request',
          message: 'Invalid visitId format',
        });
      }

      // Validate required fields
      if (!fileName || !mimeType || !fileSize) {
        return res.status(400).json({
          error: 'Bad Request',
          message: 'fileName, mimeType, and fileSize are required',
        });
      }

      // Validate MIME type
      const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
      if (!allowedTypes.includes(mimeType)) {
        return res.status(400).json({
          error: 'Bad Request',
          message: `Invalid MIME type. Allowed types: ${allowedTypes.join(', ')}`,
        });
      }

      // Validate file size (max 2MB after compression)
      const maxSize = 2 * 1024 * 1024; // 2MB
      if (fileSize > maxSize) {
        return res.status(400).json({
          error: 'Bad Request',
          message: `File size exceeds maximum of 2MB. Please compress the image before upload.`,
        });
      }

      try {
        // Get visit and verify ownership
        const visitResult = await pool.query(
          `SELECT id, staff_id, client_id, status
           FROM visits 
           WHERE id = $1`,
          [visitId]
        );

        if (visitResult.rows.length === 0) {
          return res.status(404).json({
            error: 'Not Found',
            message: 'Visit not found',
          });
        }

        const visit = visitResult.rows[0];

        // Authorization check: caregiver must own the visit, or be coordinator/admin
        if (userRole === 'caregiver' && visit.staff_id !== userId) {
          return res.status(403).json({
            error: 'Forbidden',
            message: 'You can only upload photos for your own visits',
          });
        }

        // Generate pre-signed URL
        const timestamp = Date.now();
        const sanitizedFileName = fileName.replace(/[^a-zA-Z0-9.-]/g, '_');
        const photoKey = `visits/${visitId}/photos/${timestamp}-${sanitizedFileName}`;

        const metadata = {
          originalName: fileName,
          mimeType,
          size: fileSize,
          uploadedBy: userId,
          uploadedAt: new Date().toISOString(),
          visitId,
          clientId: visit.client_id,
        };

        const { url } = await generatePhotoUploadUrl(visitId, fileName, metadata);

        const expiresAt = new Date(Date.now() + 3600 * 1000); // 1 hour

        logInfo('Photo upload URL generated', {
          visitId,
          photoKey,
          userId,
          fileName,
          fileSize,
        });

        return res.status(200).json({
          uploadUrl: url,
          photoKey,
          expiresAt: expiresAt.toISOString(),
        });
      } catch (error) {
        logError('Error generating photo upload URL', error as Error, {
          visitId,
          userId,
          fileName,
        });

        return res.status(500).json({
          error: 'Internal Server Error',
          message: 'Failed to generate upload URL',
        });
      }
    }
  );

  /**
   * POST /v1/visits/:visitId/photos
   * Record photo metadata after successful upload
   *
   * After the mobile app successfully uploads a photo to S3 using the
   * pre-signed URL, it calls this endpoint to record the photo metadata
   * in the database for later retrieval.
   *
   * Authentication: Required (caregiver role)
   * Authorization: Caregiver must own the visit
   *
   * Request Body:
   * - photoKey: string - S3 object key returned from upload-url endpoint
   * - fileName: string - Original file name
   * - fileSize: number - File size in bytes
   * - mimeType: string - MIME type
   * - thumbnailKey: string (optional) - S3 key for thumbnail (320px width)
   *
   * Response: 201 Created
   * - id: Photo record ID
   * - photoKey: S3 object key
   * - uploadedAt: ISO 8601 timestamp
   *
   * Errors:
   * - 400: Invalid request data
   * - 403: Not authorized to add photos to this visit
   * - 404: Visit not found
   */
  router.post(
    '/:visitId/photos',
    authenticateJWT(redisClient),
    async (req: Request, res: Response) => {
      const authReq = req as AuthenticatedRequest;
      const userId = authReq.user?.userId;
      const userRole = authReq.user?.role;
      const { visitId } = req.params;
      const { photoKey, fileName, fileSize, mimeType, thumbnailKey } = req.body;

      if (!userId) {
        return res.status(401).json({
          error: 'Unauthorized',
          message: 'Authentication required',
        });
      }

      // Validate UUID format
      if (!UUID_REGEX.test(visitId)) {
        return res.status(400).json({
          error: 'Bad Request',
          message: 'Invalid visitId format',
        });
      }

      // Validate required fields
      if (!photoKey || !fileName || !fileSize || !mimeType) {
        return res.status(400).json({
          error: 'Bad Request',
          message: 'photoKey, fileName, fileSize, and mimeType are required',
        });
      }

      const declaredFileSize = typeof fileSize === 'number' ? fileSize : Number(fileSize);
      if (!Number.isFinite(declaredFileSize) || declaredFileSize <= 0) {
        return res.status(400).json({
          error: 'Bad Request',
          message: 'fileSize must be a positive number',
        });
      }

      // Validate photoKey format (should start with visits/{visitId}/photos/)
      const expectedPrefix = `visits/${visitId}/photos/`;
      if (!photoKey.startsWith(expectedPrefix)) {
        return res.status(400).json({
          error: 'Bad Request',
          message: 'Invalid photoKey format',
        });
      }

      const client = await pool.connect();

      try {
        await client.query('BEGIN');

        // Get visit and verify ownership
        const visitResult = await client.query(
          `SELECT id, staff_id, status
           FROM visits 
           WHERE id = $1`,
          [visitId]
        );

        if (visitResult.rows.length === 0) {
          await client.query('ROLLBACK');
          return res.status(404).json({
            error: 'Not Found',
            message: 'Visit not found',
          });
        }

        const visit = visitResult.rows[0];

        // Authorization check: caregiver must own the visit, or be coordinator/admin
        if (userRole === 'caregiver' && visit.staff_id !== userId) {
          await client.query('ROLLBACK');
          return res.status(403).json({
            error: 'Forbidden',
            message: 'You can only add photos to your own visits',
          });
        }

        let s3ContentLength: number | undefined;
        try {
          const headResult = await s3Client.send(
            new HeadObjectCommand({
              Bucket: S3_BUCKETS.PHOTOS,
              Key: photoKey,
            })
          );
          s3ContentLength = headResult.ContentLength ?? undefined;
        } catch (s3Error) {
          await client.query('ROLLBACK');
          const name = (s3Error as { name?: string }).name;
          const code = (s3Error as { Code?: string }).Code;
          const statusCode = (s3Error as { $metadata?: { httpStatusCode?: number } }).$metadata
            ?.httpStatusCode;
          if (name === 'NotFound' || code === 'NotFound' || code === 'NoSuchKey' || statusCode === 404) {
            return res.status(400).json({
              error: 'Bad Request',
              message: 'Photo not found in S3',
            });
          }

          logError('Failed to verify photo in S3', s3Error as Error, {
            visitId,
            userId,
            photoKey,
          });

          return res.status(500).json({
            error: 'Internal Server Error',
            message: 'Failed to verify photo in S3',
          });
        }

        const sizeToleranceBytes = 1024; // Allow 1KB variance between declared and actual size
        if (
          typeof s3ContentLength === 'number' &&
          Math.abs(s3ContentLength - declaredFileSize) > sizeToleranceBytes
        ) {
          await client.query('ROLLBACK');
          return res.status(400).json({
            error: 'Bad Request',
            message: 'Declared fileSize does not match the S3 object size',
          });
        }

        // Construct S3 URL (use configured AWS region only)
        const s3Url = `https://${S3_BUCKETS.PHOTOS}.s3.${process.env.AWS_REGION}.amazonaws.com/${photoKey}`;

        // Insert photo metadata
        const photoResult = await client.query(
          `INSERT INTO visit_photos (
            visit_id,
            s3_key,
            s3_url,
            thumbnail_s3_key,
            file_name,
            file_size,
            mime_type,
            uploaded_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP)
          RETURNING id, s3_key, s3_url, thumbnail_s3_key, uploaded_at`,
          [visitId, photoKey, s3Url, thumbnailKey || null, fileName, declaredFileSize, mimeType]
        );

        const photo = photoResult.rows[0];

        await client.query('COMMIT');

        // Invalidate cached visit details
        await invalidateVisitDetailCache(redisClient, visitId);

        logInfo('Photo metadata recorded', {
          visitId,
          photoId: photo.id,
          photoKey,
          userId,
          fileSize: declaredFileSize,
        });

        return res.status(201).json({
          id: photo.id,
          photoKey: photo.s3_key,
          photoUrl: photo.s3_url,
          thumbnailKey: photo.thumbnail_s3_key,
          uploadedAt: photo.uploaded_at,
        });
      } catch (error) {
        await client.query('ROLLBACK');
        logError('Error recording photo metadata', error as Error, {
          visitId,
          userId,
          photoKey,
        });

        return res.status(500).json({
          error: 'Internal Server Error',
          message: 'Failed to record photo metadata',
        });
      } finally {
        client.release();
      }
    }
  );

  /**
   * POST /v1/visits/:visitId/signature/upload-url
   * Generate pre-signed S3 URL for signature upload
   *
   * Generates a pre-signed URL that allows the mobile app to upload signatures
   * directly to S3. Signatures are PNG images captured from signature pad.
   *
   * Authentication: Required (caregiver role)
   * Authorization: Caregiver must own the visit
   *
   * Request Body:
   * - signatureType: string - Type of signature ('caregiver', 'client', 'family')
   * - fileSize: number - File size in bytes (max 1MB)
   *
   * Response: 200 OK
   * - uploadUrl: Pre-signed S3 URL (expires in 10 minutes)
   * - signatureKey: S3 object key for later reference
   * - expiresAt: ISO 8601 timestamp when URL expires
   *
   * Errors:
   * - 400: Invalid request data or file too large
   * - 403: Not authorized to upload signature for this visit
   * - 404: Visit not found
   */
  router.post(
    '/:visitId/signature/upload-url',
    authenticateJWT(redisClient),
    async (req: Request, res: Response) => {
      const authReq = req as AuthenticatedRequest;
      const userId = authReq.user?.userId;
      const userRole = authReq.user?.role;
      const { visitId } = req.params;
      const { signatureType, fileSize } = req.body;

      if (!userId) {
        return res.status(401).json({
          error: 'Unauthorized',
          message: 'Authentication required',
        });
      }

      // Validate UUID format
      if (!UUID_REGEX.test(visitId)) {
        return res.status(400).json({
          error: 'Bad Request',
          message: 'Invalid visitId format',
        });
      }

      // Validate required fields
      if (!signatureType || !fileSize) {
        return res.status(400).json({
          error: 'Bad Request',
          message: 'signatureType and fileSize are required',
        });
      }

      // Validate signature type
      const validTypes = ['caregiver', 'client', 'family'];
      if (!validTypes.includes(signatureType)) {
        return res.status(400).json({
          error: 'Bad Request',
          message: `Invalid signatureType. Allowed types: ${validTypes.join(', ')}`,
        });
      }

      // Validate file size (max 1MB)
      const maxSize = 1 * 1024 * 1024; // 1MB
      if (fileSize > maxSize) {
        return res.status(400).json({
          error: 'Bad Request',
          message: 'File size exceeds maximum of 1MB.',
        });
      }

      try {
        // Get visit and verify ownership
        const visitResult = await pool.query(
          `SELECT id, staff_id, client_id, status
           FROM visits 
           WHERE id = $1`,
          [visitId]
        );

        if (visitResult.rows.length === 0) {
          return res.status(404).json({
            error: 'Not Found',
            message: 'Visit not found',
          });
        }

        const visit = visitResult.rows[0];

        // Authorization check: caregiver must own the visit, or be coordinator/admin
        if (userRole === 'caregiver' && visit.staff_id !== userId) {
          return res.status(403).json({
            error: 'Forbidden',
            message: 'You can only upload signatures for your own visits',
          });
        }

        // Generate pre-signed URL
        const { url, key } = await generateSignatureUploadUrl(visitId, signatureType, userId);

        const expiresAt = new Date(Date.now() + 600 * 1000); // 10 minutes

        logInfo('Signature upload URL generated', {
          visitId,
          signatureKey: key,
          userId,
          signatureType,
          fileSize,
        });

        return res.status(200).json({
          uploadUrl: url,
          signatureKey: key,
          expiresAt: expiresAt.toISOString(),
        });
      } catch (error) {
        logError('Error generating signature upload URL', error as Error, {
          visitId,
          userId,
          signatureType,
        });

        return res.status(500).json({
          error: 'Internal Server Error',
          message: 'Failed to generate upload URL',
        });
      }
    }
  );

  /**
   * POST /v1/visits/:visitId/signature
   * Record signature metadata after successful upload
   *
   * After the mobile app successfully uploads a signature to S3 using the
   * pre-signed URL, it calls this endpoint to record the signature URL
   * in the visit documentation.
   *
   * Authentication: Required (caregiver role)
   * Authorization: Caregiver must own the visit
   *
   * Request Body:
   * - signatureKey: string - S3 object key returned from upload-url endpoint
   * - signatureType: string - Type of signature ('caregiver', 'client', 'family')
   *
   * Response: 200 OK
   * - signatureUrl: Full S3 URL
   * - signatureType: Type of signature
   * - uploadedAt: ISO 8601 timestamp
   *
   * Errors:
   * - 400: Invalid request data
   * - 403: Not authorized to add signature to this visit
   * - 404: Visit not found
   */
  router.post(
    '/:visitId/signature',
    authenticateJWT(redisClient),
    async (req: Request, res: Response) => {
      const authReq = req as AuthenticatedRequest;
      const userId = authReq.user?.userId;
      const userRole = authReq.user?.role;
      const { visitId } = req.params;
      const { signatureKey, signatureType } = req.body;

      if (!userId) {
        return res.status(401).json({
          error: 'Unauthorized',
          message: 'Authentication required',
        });
      }

      // Validate UUID format
      if (!UUID_REGEX.test(visitId)) {
        return res.status(400).json({
          error: 'Bad Request',
          message: 'Invalid visitId format',
        });
      }

      // Validate required fields
      if (!signatureKey || !signatureType) {
        return res.status(400).json({
          error: 'Bad Request',
          message: 'signatureKey and signatureType are required',
        });
      }

      // Validate signature type
      const validTypes = ['caregiver', 'client', 'family'];
      if (!validTypes.includes(signatureType)) {
        return res.status(400).json({
          error: 'Bad Request',
          message: `Invalid signatureType. Allowed types: ${validTypes.join(', ')}`,
        });
      }

      // Validate signatureKey format (should start with visits/{visitId}/signatures/)
      const expectedPrefix = `visits/${visitId}/signatures/`;
      if (!signatureKey.startsWith(expectedPrefix)) {
        return res.status(400).json({
          error: 'Bad Request',
          message: 'Invalid signatureKey format',
        });
      }

      const client = await pool.connect();

      try {
        await client.query('BEGIN');

        // Get visit and verify ownership
        const visitResult = await client.query(
          `SELECT id, staff_id, status
           FROM visits 
           WHERE id = $1`,
          [visitId]
        );

        if (visitResult.rows.length === 0) {
          await client.query('ROLLBACK');
          return res.status(404).json({
            error: 'Not Found',
            message: 'Visit not found',
          });
        }

        const visit = visitResult.rows[0];

        // Authorization check: caregiver must own the visit, or be coordinator/admin
        if (userRole === 'caregiver' && visit.staff_id !== userId) {
          await client.query('ROLLBACK');
          return res.status(403).json({
            error: 'Forbidden',
            message: 'You can only add signatures to your own visits',
          });
        }

        try {
          await s3Client.send(
            new HeadObjectCommand({
              Bucket: S3_BUCKETS.SIGNATURES,
              Key: signatureKey,
            })
          );
        } catch (s3Error) {
          await client.query('ROLLBACK');
          const name = (s3Error as { name?: string }).name;
          const code = (s3Error as { Code?: string }).Code;
          const statusCode = (s3Error as { $metadata?: { httpStatusCode?: number } }).$metadata
            ?.httpStatusCode;

          if (name === 'NotFound' || code === 'NotFound' || code === 'NoSuchKey' || statusCode === 404) {
            return res.status(400).json({
              error: 'Bad Request',
              message: 'Signature not found in S3',
            });
          }

          logError('Failed to verify signature in S3', s3Error as Error, {
            visitId,
            userId,
            signatureKey,
          });

          return res.status(500).json({
            error: 'Internal Server Error',
            message: 'Failed to verify signature in S3',
          });
        }

        // Construct S3 URL (use configured AWS region only)
        const signatureUrl = `https://${S3_BUCKETS.SIGNATURES}.s3.${process.env.AWS_REGION}.amazonaws.com/${signatureKey}`;

        // Check if documentation exists
        const docResult = await client.query(
          'SELECT id FROM visit_documentation WHERE visit_id = $1',
          [visitId]
        );

        if (docResult.rows.length > 0) {
          // Single-signature design: replace existing signature_url regardless of signatureType.
          // Update existing documentation
          await client.query(
            `UPDATE visit_documentation 
             SET signature_url = $1, updated_at = CURRENT_TIMESTAMP
             WHERE visit_id = $2`,
            [signatureUrl, visitId]
          );
        } else {
          // Create new documentation with signature
          await client.query(
            `INSERT INTO visit_documentation (visit_id, signature_url)
             VALUES ($1, $2)`,
            [visitId, signatureUrl]
          );
        }

        await client.query('COMMIT');

        // Invalidate cached visit details
        await invalidateVisitDetailCache(redisClient, visitId);

        logInfo('Signature metadata recorded', {
          visitId,
          signatureKey,
          signatureType,
          userId,
        });

        return res.status(200).json({
          signatureUrl,
          signatureType,
          uploadedAt: new Date().toISOString(),
        });
      } catch (error) {
        await client.query('ROLLBACK');
        logError('Error recording signature metadata', error as Error, {
          visitId,
          userId,
          signatureKey,
        });

        return res.status(500).json({
          error: 'Internal Server Error',
          message: 'Failed to record signature metadata',
        });
      } finally {
        client.release();
      }
    }
  );

  return router;
}
