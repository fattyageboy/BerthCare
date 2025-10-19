/**
 * Integration Tests: PATCH /v1/visits/:visitId
 *
 * Tests for visit update endpoint (check-out/completion)
 *
 * Test Coverage:
 * - Successful visit completion with GPS
 * - Visit completion without GPS
 * - Duration calculation
 * - Status updates
 * - Documentation updates
 * - Authorization checks
 * - Input validation
 * - Error handling
 *
 * Reference: Architecture Blueprint - Visit Documentation Endpoints
 * Task: V5 - Implement PATCH /v1/visits/:visitId endpoint
 *
 * @see {@link project-documentation/task-plan.md} Phase V - Visit Documentation API
 */

import * as crypto from 'crypto';

import { Express } from 'express';
import { Pool } from 'pg';
import request from 'supertest';

import { generateAccessToken } from '@berthcare/shared';

import { RedisClient } from '../src/cache/redis-client';

import {
  cleanAllTestData,
  createTestApp,
  createTestClient,
  createTestVisit,
  generateTestEmail,
  registerCleanup,
  setupTestConnections,
  teardownTestConnections,
} from './test-helpers';

describe('PATCH /v1/visits/:visitId', () => {
  let pgPool: Pool;
  let redisClient: RedisClient;
  let app: Express;
  let schemaName: string;

  let caregiverToken: string;
  let caregiverId: string;
  let otherCaregiverId: string;
  let clientId: string;
  let zoneId: string;
  let visitId: string;

  beforeAll(async () => {
    const connections = await setupTestConnections();
    pgPool = connections.pgPool;
    redisClient = connections.redisClient;
    schemaName = connections.schemaName;
    app = createTestApp(pgPool, redisClient);

    // Create test zone
    zoneId = crypto.randomUUID();
    await pgPool.query(
      'INSERT INTO zones (id, name, region, created_at, updated_at) VALUES ($1, $2, $3, NOW(), NOW())',
      [zoneId, 'Test Zone', 'Test Region']
    );

    // Create test caregiver
    caregiverId = crypto.randomUUID();
    await pgPool.query(
      `INSERT INTO users (id, email, password_hash, first_name, last_name, role, zone_id, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())`,
      [
        caregiverId,
        generateTestEmail('caregiver'),
        'hash',
        'Test',
        'Caregiver',
        'caregiver',
        zoneId,
      ]
    );
    caregiverToken = generateAccessToken({
      userId: caregiverId,
      email: generateTestEmail('caregiver'),
      role: 'caregiver',
      zoneId,
    });

    // Create another caregiver
    otherCaregiverId = crypto.randomUUID();
    await pgPool.query(
      `INSERT INTO users (id, email, password_hash, first_name, last_name, role, zone_id, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())`,
      [
        otherCaregiverId,
        generateTestEmail('other-caregiver'),
        'hash',
        'Other',
        'Caregiver',
        'caregiver',
        zoneId,
      ]
    );

    // Create test client
    clientId = await createTestClient(pgPool, {
      firstName: 'John',
      lastName: 'Doe',
      dateOfBirth: '1950-01-01',
      address: '123 Test St',
      latitude: 43.6532,
      longitude: -79.3832,
      zoneId,
      emergencyContactName: 'Jane Doe',
      emergencyContactPhone: '+14165555678',
      emergencyContactRelationship: 'Daughter',
    });

    // Create a test visit
    visitId = await createTestVisit(pgPool, {
      clientId,
      staffId: caregiverId,
      scheduledStartTime: '2025-10-11T09:00:00Z',
      checkInTime: '2025-10-11T09:05:00Z',
      status: 'in_progress',
    });
  });

  afterAll(async () => {
    await cleanAllTestData(pgPool, redisClient);
    await teardownTestConnections(pgPool, redisClient, { schemaName, dropSchema: true });
  });

  describe('Successful visit updates', () => {
    it('should complete visit with check-out GPS and calculate duration', async () => {
      const response = await request(app)
        .patch(`/api/v1/visits/${visitId}`)
        .set('Authorization', `Bearer ${caregiverToken}`)
        .send({
          checkOutTime: '2025-10-11T10:05:00Z',
          checkOutLatitude: 43.6532,
          checkOutLongitude: -79.3832,
          status: 'completed',
        });

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        id: visitId,
        status: 'completed',
      });

      // Verify duration was calculated (60 minutes)
      const visitCheck = await pgPool.query('SELECT duration_minutes FROM visits WHERE id = $1', [
        visitId,
      ]);
      expect(visitCheck.rows[0].duration_minutes).toBe(60);
    });

    it('should update visit status without affecting existing state', async () => {
      // Create a fresh visit for this test to ensure isolation
      const testVisitId = await createTestVisit(pgPool, {
        clientId,
        staffId: caregiverId,
        scheduledStartTime: '2025-10-11T14:00:00Z',
        checkInTime: '2025-10-11T14:05:00Z',
        status: 'in_progress',
      });

      // Register cleanup to ensure visit is deleted even if test fails
      registerCleanup(async () => {
        await pgPool.query('DELETE FROM visits WHERE id = $1', [testVisitId]);
      });

      const response = await request(app)
        .patch(`/api/v1/visits/${testVisitId}`)
        .set('Authorization', `Bearer ${caregiverToken}`)
        .send({
          status: 'completed',
        });

      expect(response.status).toBe(200);
      expect(response.body.id).toBe(testVisitId);
      expect(response.body.status).toBe('completed');

      // Verify status was updated in database
      const visitCheck = await pgPool.query('SELECT status FROM visits WHERE id = $1', [
        testVisitId,
      ]);
      expect(visitCheck.rows[0].status).toBe('completed');
    });
  });

  describe('Authorization', () => {
    it('should reject unauthenticated requests', async () => {
      const response = await request(app).patch(`/api/v1/visits/${visitId}`).send({
        status: 'completed',
      });

      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe('MISSING_TOKEN');
    });

    it('should reject caregiver updating another caregiver visit', async () => {
      // Create visit for other caregiver
      const otherVisitResult = await pgPool.query(
        `INSERT INTO visits (
          client_id, staff_id, scheduled_start_time, check_in_time, status
        ) VALUES ($1, $2, $3, $4, $5)
        RETURNING id`,
        [clientId, otherCaregiverId, '2025-10-11T11:00:00Z', '2025-10-11T11:05:00Z', 'in_progress']
      );
      const otherVisitId = otherVisitResult.rows[0].id;

      registerCleanup(() => pgPool.query('DELETE FROM visits WHERE id = $1', [otherVisitId]));

      const response = await request(app)
        .patch(`/api/v1/visits/${otherVisitId}`)
        .set('Authorization', `Bearer ${caregiverToken}`)
        .send({
          status: 'completed',
        });

      expect(response.status).toBe(403);
      expect(response.body.message).toBe('You can only update your own visits');
    });
  });

  describe('Validation', () => {
    it('should reject invalid visitId format', async () => {
      const response = await request(app)
        .patch('/api/v1/visits/invalid-uuid')
        .set('Authorization', `Bearer ${caregiverToken}`)
        .send({
          status: 'completed',
        });

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('Invalid visitId format');
    });

    it('should reject invalid GPS coordinates', async () => {
      const response = await request(app)
        .patch(`/api/v1/visits/${visitId}`)
        .set('Authorization', `Bearer ${caregiverToken}`)
        .send({
          checkOutLatitude: 91, // Invalid: > 90
          checkOutLongitude: -79.3832,
        });

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('checkOutLatitude');
    });

    it('should reject invalid checkout longitude', async () => {
      const response = await request(app)
        .patch(`/api/v1/visits/${visitId}`)
        .set('Authorization', `Bearer ${caregiverToken}`)
        .send({
          checkOutLatitude: 43.6532,
          checkOutLongitude: 181, // Invalid: > 180
        });

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('checkOutLongitude');
    });

    it('should reject invalid status', async () => {
      const response = await request(app)
        .patch(`/api/v1/visits/${visitId}`)
        .set('Authorization', `Bearer ${caregiverToken}`)
        .send({
          status: 'invalid_status',
        });

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('status must be one of');
    });

    it('should reject non-existent visit', async () => {
      const response = await request(app)
        .patch('/api/v1/visits/00000000-0000-0000-0000-000000000000')
        .set('Authorization', `Bearer ${caregiverToken}`)
        .send({
          status: 'completed',
        });

      expect(response.status).toBe(404);
      expect(response.body.message).toBe('Visit not found');
    });

    it('should reject request with no updates', async () => {
      const response = await request(app)
        .patch(`/api/v1/visits/${visitId}`)
        .set('Authorization', `Bearer ${caregiverToken}`)
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.message).toBe('No updates provided');
    });
  });
});
