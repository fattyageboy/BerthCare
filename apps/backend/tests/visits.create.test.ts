/**
 * Integration Tests: POST /v1/visits
 *
 * Tests for visit creation endpoint (check-in)
 *
 * Test Coverage:
 * - Successful visit creation with GPS
 * - Visit creation without GPS
 * - Smart data reuse (copy from previous visit)
 * - Zone-based authorization
 * - Input validation
 * - Error handling
 *
 * Reference: Architecture Blueprint - Visit Documentation Endpoints
 * Task: V4 - Implement POST /v1/visits endpoint
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
  setupTestConnections,
  teardownTestConnections,
} from './test-helpers';

describe('POST /v1/visits', () => {
  let pgPool: Pool;
  let redisClient: RedisClient;
  let app: Express;
  let schemaName: string;

  let caregiverToken: string;
  let caregiverId: string;
  let clientId: string;
  let zoneId: string;
  let previousVisitId: string;

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

    // Create a previous visit for smart data reuse testing
    previousVisitId = await createTestVisit(pgPool, {
      clientId,
      staffId: caregiverId,
      scheduledStartTime: '2025-10-10T09:00:00Z',
      checkInTime: '2025-10-10T09:05:00Z',
      status: 'completed',
    });

    // Add documentation to previous visit
    await pgPool.query(
      `INSERT INTO visit_documentation (
        visit_id, vital_signs, activities, observations
      ) VALUES ($1, $2, $3, $4)`,
      [
        previousVisitId,
        JSON.stringify({ blood_pressure: '120/80', heart_rate: 72 }),
        JSON.stringify([{ activity: 'Medication', completed: true }]),
        'Client doing well',
      ]
    );
  });

  afterAll(async () => {
    await cleanAllTestData(pgPool, redisClient);
    await teardownTestConnections(pgPool, redisClient, { schemaName, dropSchema: true });
  });

  describe('Successful visit creation', () => {
    it('should create visit with GPS coordinates', async () => {
      const response = await request(app)
        .post('/api/v1/visits')
        .set('Authorization', `Bearer ${caregiverToken}`)
        .send({
          clientId,
          scheduledStartTime: '2025-10-11T09:00:00Z',
          checkInTime: '2025-10-11T09:05:00Z',
          checkInLatitude: 43.6532,
          checkInLongitude: -79.3832,
        });

      expect(response.status).toBe(201);
      expect(response.body).toMatchObject({
        clientId,
        staffId: caregiverId,
        status: 'in_progress',
      });
      expect(parseFloat(response.body.checkInLatitude)).toBeCloseTo(43.6532, 4);
      expect(parseFloat(response.body.checkInLongitude)).toBeCloseTo(-79.3832, 4);
    });

    it('should create visit without GPS coordinates', async () => {
      const response = await request(app)
        .post('/api/v1/visits')
        .set('Authorization', `Bearer ${caregiverToken}`)
        .send({
          clientId,
          scheduledStartTime: '2025-10-12T09:00:00Z',
        });

      expect(response.status).toBe(201);
      expect(response.body.clientId).toBe(clientId);
      expect(response.body.status).toBe('in_progress');
      expect(response.body.checkInLatitude).toBeNull();
      expect(response.body.checkInLongitude).toBeNull();
    });
  });

  describe('Authorization', () => {
    it('should reject unauthenticated requests', async () => {
      const response = await request(app).post('/api/v1/visits').send({
        clientId,
        scheduledStartTime: '2025-10-11T10:00:00Z',
      });

      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe('MISSING_TOKEN');
    });
  });

  describe('Validation', () => {
    it('should reject missing clientId', async () => {
      const response = await request(app)
        .post('/api/v1/visits')
        .set('Authorization', `Bearer ${caregiverToken}`)
        .send({
          scheduledStartTime: '2025-10-11T10:00:00Z',
        });

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('clientId');
    });

    it('should reject invalid GPS coordinates', async () => {
      const response = await request(app)
        .post('/api/v1/visits')
        .set('Authorization', `Bearer ${caregiverToken}`)
        .send({
          clientId,
          scheduledStartTime: '2025-10-11T10:00:00Z',
          checkInLatitude: 91, // Invalid: > 90
          checkInLongitude: -79.3832,
        });

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('checkInLatitude');
    });

    it('should reject invalid check-in longitude', async () => {
      const response = await request(app)
        .post('/api/v1/visits')
        .set('Authorization', `Bearer ${caregiverToken}`)
        .send({
          clientId,
          scheduledStartTime: '2025-10-11T10:00:00Z',
          checkInLatitude: 43.6532,
          checkInLongitude: 181, // Invalid: > 180
        });

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('checkInLongitude');
    });

    it('should reject invalid clientId format', async () => {
      const response = await request(app)
        .post('/api/v1/visits')
        .set('Authorization', `Bearer ${caregiverToken}`)
        .send({
          clientId: 'invalid-uuid',
          scheduledStartTime: '2025-10-11T10:00:00Z',
        });

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('Invalid clientId format');
    });

    it('should reject invalid copiedFromVisitId format', async () => {
      const response = await request(app)
        .post('/api/v1/visits')
        .set('Authorization', `Bearer ${caregiverToken}`)
        .send({
          clientId,
          scheduledStartTime: '2025-10-11T10:00:00Z',
          copiedFromVisitId: 'invalid-uuid',
        });

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('Invalid copiedFromVisitId format');
    });

    it('should reject missing scheduledStartTime', async () => {
      const response = await request(app)
        .post('/api/v1/visits')
        .set('Authorization', `Bearer ${caregiverToken}`)
        .send({
          clientId,
        });

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('scheduledStartTime');
    });
  });

  describe('Conflict handling', () => {
    it('should return 409 when an overlapping visit exists for the same client', async () => {
      const scheduledStartTime = '2025-10-15T09:00:00Z';

      const firstResponse = await request(app)
        .post('/api/v1/visits')
        .set('Authorization', `Bearer ${caregiverToken}`)
        .send({
          clientId,
          scheduledStartTime,
          checkInTime: '2025-10-15T09:05:00Z',
        });

      expect(firstResponse.status).toBe(201);

      const conflictResponse = await request(app)
        .post('/api/v1/visits')
        .set('Authorization', `Bearer ${caregiverToken}`)
        .send({
          clientId,
          scheduledStartTime,
          checkInTime: '2025-10-15T09:10:00Z',
        });

      expect(conflictResponse.status).toBe(409);
      expect(conflictResponse.body.error).toBe('Conflict');
      expect(conflictResponse.body.message).toContain('time slot');
    });

    it('should return 409 when the scheduled slots overlap for the same client', async () => {
      const firstVisit = {
        clientId,
        scheduledStartTime: '2025-10-16T09:00:00Z',
        scheduledEndTime: '2025-10-16T10:00:00Z',
      };

      const secondVisit = {
        clientId,
        scheduledStartTime: '2025-10-16T09:30:00Z',
        scheduledEndTime: '2025-10-16T10:30:00Z',
      };

      const firstResponse = await request(app)
        .post('/api/v1/visits')
        .set('Authorization', `Bearer ${caregiverToken}`)
        .send(firstVisit);

      expect(firstResponse.status).toBe(201);

      const conflictResponse = await request(app)
        .post('/api/v1/visits')
        .set('Authorization', `Bearer ${caregiverToken}`)
        .send(secondVisit);

      expect(conflictResponse.status).toBe(409);
      expect(conflictResponse.body.error).toBe('Conflict');
      expect(conflictResponse.body.message).toContain('time slot');
    });
  });
});
