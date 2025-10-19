/**
 * Integration Tests: POST /api/v1/care-plans - Create/Update Care Plan
 *
 * Tests care plan creation and update endpoint with versioning and validation.
 *
 * Test Coverage:
 * - ✅ Create care plan successfully (coordinator in same zone)
 * - ✅ Create care plan successfully (admin any zone)
 * - ✅ Update existing care plan (version increments)
 * - ✅ Reject caregiver user (403)
 * - ✅ Reject coordinator managing care plan in different zone (403)
 * - ✅ Reject invalid client ID format (400)
 * - ✅ Reject client not found (404)
 * - ✅ Reject missing required fields (400)
 * - ✅ Reject invalid medications structure (400)
 * - ✅ Reject invalid allergies structure (400)
 * - ✅ Handle empty medications array
 * - ✅ Handle empty allergies array
 * - ✅ Validate version increments on update
 *
 * Reference: docs/C7-care-plan-endpoint.md
 */

import crypto from 'crypto';

import { Express } from 'express';
import { Pool } from 'pg';
import request from 'supertest';

import { generateAccessToken } from '@berthcare/shared';

import { RedisClient } from '../src/cache/redis-client';

import { createTestApp, setupTestConnections, teardownTestConnections } from './test-helpers';

let app: Express;
let pgPool: Pool;
let redisClient: RedisClient;
let schemaName: string;

describe('POST /api/v1/care-plans - Create/Update Care Plan', () => {
  let adminToken: string;
  let coordinatorToken: string;
  let caregiverToken: string;
  let otherCoordinatorToken: string;
  let testClientId: string;
  let testClient2Id: string;

  // Test user IDs
  const adminUserId = '00000000-0000-0000-0000-000000000001';
  const coordinatorUserId = '00000000-0000-0000-0000-000000000002';
  const caregiverUserId = '00000000-0000-0000-0000-000000000003';
  const otherCoordinatorUserId = '00000000-0000-0000-0000-000000000004';
  const testZoneId = '00000000-0000-0000-0000-000000000001';
  const otherZoneId = '00000000-0000-0000-0000-000000000002';

  beforeAll(async () => {
    // Setup connections using shared helper
    const connections = await setupTestConnections();
    pgPool = connections.pgPool;
    redisClient = connections.redisClient;
    schemaName = connections.schemaName;

    // Create app with all routes
    app = createTestApp(pgPool, redisClient);

    // Generate test tokens
    adminToken = generateAccessToken({
      userId: adminUserId,
      email: 'admin@test.com',
      role: 'admin',
      zoneId: testZoneId,
    });

    coordinatorToken = generateAccessToken({
      userId: coordinatorUserId,
      email: 'coordinator@test.com',
      role: 'coordinator',
      zoneId: testZoneId,
    });

    caregiverToken = generateAccessToken({
      userId: caregiverUserId,
      email: 'caregiver@test.com',
      role: 'caregiver',
      zoneId: testZoneId,
    });

    otherCoordinatorToken = generateAccessToken({
      userId: otherCoordinatorUserId,
      email: 'other-coordinator@test.com',
      role: 'coordinator',
      zoneId: otherZoneId,
    });

    // Create test clients directly in database
    testClientId = crypto.randomUUID();
    testClient2Id = crypto.randomUUID();

    await pgPool.query(
      `
      INSERT INTO clients (
        id, first_name, last_name, date_of_birth, address,
        latitude, longitude, phone, zone_id,
        emergency_contact_name, emergency_contact_phone,
        emergency_contact_relationship,
        created_at, updated_at
      ) VALUES
        ($1, 'Test', 'Client1', '1950-01-01', '100 Queen St W, Toronto, ON',
         43.6532, -79.3832, '416-555-0100', $3,
         'Emergency Contact', '416-555-0200', 'Family', NOW(), NOW()),
        ($2, 'Test', 'Client2', '1955-05-15', '200 King St W, Toronto, ON',
         43.6532, -79.3832, '416-555-0300', $4,
         'Emergency Contact', '416-555-0400', 'Family', NOW(), NOW())
    `,
      [testClientId, testClient2Id, testZoneId, otherZoneId]
    );
  });

  afterAll(async () => {
    // Clean up test data
    try {
      await pgPool.query('DELETE FROM care_plans WHERE client_id IN ($1, $2)', [
        testClientId,
        testClient2Id,
      ]);
      await pgPool.query('DELETE FROM clients WHERE id IN ($1, $2)', [testClientId, testClient2Id]);
    } catch (error) {
      console.error('Error cleaning up test data:', error);
    }

    // Close connections using shared helper
    await teardownTestConnections(pgPool, redisClient, { schemaName, dropSchema: true });
  });

  afterEach(async () => {
    // Clean up care plans after each test
    try {
      await pgPool.query('DELETE FROM care_plans WHERE client_id IN ($1, $2)', [
        testClientId,
        testClient2Id,
      ]);
    } catch (error) {
      // Ignore cleanup errors to prevent test failures
      console.error('Error in afterEach cleanup:', error);
    }
  });

  describe('Authorization', () => {
    it('should reject request without authentication token', async () => {
      const response = await request(app).post('/api/v1/care-plans').send({
        clientId: testClientId,
        summary: 'Test care plan',
        medications: [],
        allergies: [],
      });

      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe('MISSING_TOKEN');
    });

    it('should reject caregiver user', async () => {
      const response = await request(app)
        .post('/api/v1/care-plans')
        .set('Authorization', `Bearer ${caregiverToken}`)
        .send({
          clientId: testClientId,
          summary: 'Test care plan',
          medications: [],
          allergies: [],
        });

      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('AUTH_INSUFFICIENT_ROLE');
    });

    it('should reject coordinator managing care plan in different zone', async () => {
      const response = await request(app)
        .post('/api/v1/care-plans')
        .set('Authorization', `Bearer ${otherCoordinatorToken}`)
        .send({
          clientId: testClientId,
          summary: 'Test care plan',
          medications: [],
          allergies: [],
        });

      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('AUTH_ZONE_ACCESS_DENIED');
      expect(response.body.error.message).toContain('access to this client');
    });

    it('should allow coordinator to create care plan in same zone', async () => {
      const response = await request(app)
        .post('/api/v1/care-plans')
        .set('Authorization', `Bearer ${coordinatorToken}`)
        .send({
          clientId: testClientId,
          summary: 'Test care plan',
          medications: [],
          allergies: [],
        });

      expect(response.status).toBe(201);
      expect(response.body.data.clientId).toBe(testClientId);
    });

    it('should allow admin to create care plan for any client', async () => {
      const response = await request(app)
        .post('/api/v1/care-plans')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          clientId: testClient2Id,
          summary: 'Test care plan',
          medications: [],
          allergies: [],
        });

      expect(response.status).toBe(201);
      expect(response.body.data.clientId).toBe(testClient2Id);
    });
  });

  describe('Validation', () => {
    it('should reject invalid client ID format', async () => {
      const response = await request(app)
        .post('/api/v1/care-plans')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          clientId: 'invalid-uuid',
          summary: 'Test care plan',
          medications: [],
          allergies: [],
        });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
      expect(response.body.error.message).toContain('client ID format');
    });

    it('should reject client not found', async () => {
      const nonExistentId = '00000000-0000-0000-0000-999999999999';

      const response = await request(app)
        .post('/api/v1/care-plans')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          clientId: nonExistentId,
          summary: 'Test care plan',
          medications: [],
          allergies: [],
        });

      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe('CLIENT_NOT_FOUND');
    });

    it('should reject missing clientId', async () => {
      const response = await request(app)
        .post('/api/v1/care-plans')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          summary: 'Test care plan',
          medications: [],
          allergies: [],
        });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
      expect(response.body.error.message).toContain('Client ID');
    });

    it('should reject missing summary', async () => {
      const response = await request(app)
        .post('/api/v1/care-plans')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          clientId: testClientId,
          medications: [],
          allergies: [],
        });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
      expect(response.body.error.message).toContain('Summary');
    });

    it('should reject missing medications', async () => {
      const response = await request(app)
        .post('/api/v1/care-plans')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          clientId: testClientId,
          summary: 'Test care plan',
          allergies: [],
        });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
      expect(response.body.error.message).toContain('Medications');
    });

    it('should reject missing allergies', async () => {
      const response = await request(app)
        .post('/api/v1/care-plans')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          clientId: testClientId,
          summary: 'Test care plan',
          medications: [],
        });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
      expect(response.body.error.message).toContain('Allergies');
    });

    it('should reject invalid medications structure (not array)', async () => {
      const response = await request(app)
        .post('/api/v1/care-plans')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          clientId: testClientId,
          summary: 'Test care plan',
          medications: 'not an array',
          allergies: [],
        });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
      expect(response.body.error.message).toContain('medications');
    });

    it('should reject invalid medications structure (missing fields)', async () => {
      const response = await request(app)
        .post('/api/v1/care-plans')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          clientId: testClientId,
          summary: 'Test care plan',
          medications: [{ name: 'Aspirin' }], // Missing dosage and frequency
          allergies: [],
        });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
      expect(response.body.error.message).toContain('medications');
    });

    it('should reject invalid allergies structure (not array)', async () => {
      const response = await request(app)
        .post('/api/v1/care-plans')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          clientId: testClientId,
          summary: 'Test care plan',
          medications: [],
          allergies: 'not an array',
        });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
      expect(response.body.error.message).toContain('allergies');
    });

    it('should reject invalid allergies structure (non-string elements)', async () => {
      const response = await request(app)
        .post('/api/v1/care-plans')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          clientId: testClientId,
          summary: 'Test care plan',
          medications: [],
          allergies: [123, 456], // Numbers instead of strings
        });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
      expect(response.body.error.message).toContain('allergies');
    });
  });

  describe('Create Care Plan', () => {
    it('should create care plan with empty medications and allergies', async () => {
      const response = await request(app)
        .post('/api/v1/care-plans')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          clientId: testClientId,
          summary: 'Client requires basic assistance',
          medications: [],
          allergies: [],
        });

      expect(response.status).toBe(201);
      expect(response.body.data).toHaveProperty('id');
      expect(response.body.data.clientId).toBe(testClientId);
      expect(response.body.data.summary).toBe('Client requires basic assistance');
      expect(response.body.data.medications).toEqual([]);
      expect(response.body.data.allergies).toEqual([]);
      expect(response.body.data.version).toBe(1);
      expect(response.body.data).toHaveProperty('createdAt');
      expect(response.body.data).toHaveProperty('updatedAt');
    });

    it('should create care plan with medications', async () => {
      const response = await request(app)
        .post('/api/v1/care-plans')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          clientId: testClientId,
          summary: 'Client requires medication management',
          medications: [
            {
              name: 'Aspirin',
              dosage: '81mg',
              frequency: 'Daily',
            },
            {
              name: 'Metformin',
              dosage: '500mg',
              frequency: 'Twice daily with meals',
            },
          ],
          allergies: [],
        });

      expect(response.status).toBe(201);
      expect(response.body.data.medications).toHaveLength(2);
      expect(response.body.data.medications[0].name).toBe('Aspirin');
      expect(response.body.data.medications[1].name).toBe('Metformin');
    });

    it('should create care plan with allergies', async () => {
      const response = await request(app)
        .post('/api/v1/care-plans')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          clientId: testClientId,
          summary: 'Client has multiple allergies',
          medications: [],
          allergies: ['Penicillin', 'Latex', 'Shellfish'],
        });

      expect(response.status).toBe(201);
      expect(response.body.data.allergies).toHaveLength(3);
      expect(response.body.data.allergies).toContain('Penicillin');
      expect(response.body.data.allergies).toContain('Latex');
      expect(response.body.data.allergies).toContain('Shellfish');
    });

    it('should create care plan with special instructions', async () => {
      const response = await request(app)
        .post('/api/v1/care-plans')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          clientId: testClientId,
          summary: 'Client requires special care',
          medications: [],
          allergies: [],
          specialInstructions:
            'Client prefers morning visits. Ensure medication is taken with food.',
        });

      expect(response.status).toBe(201);
      expect(response.body.data.specialInstructions).toBe(
        'Client prefers morning visits. Ensure medication is taken with food.'
      );
    });
  });

  describe('Update Care Plan', () => {
    it('should update existing care plan and increment version', async () => {
      // Create initial care plan
      const createResponse = await request(app)
        .post('/api/v1/care-plans')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          clientId: testClientId,
          summary: 'Initial care plan',
          medications: [],
          allergies: [],
        });

      expect(createResponse.status).toBe(201);
      expect(createResponse.body.data.version).toBe(1);

      // Update care plan
      const updateResponse = await request(app)
        .post('/api/v1/care-plans')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          clientId: testClientId,
          summary: 'Updated care plan',
          medications: [
            {
              name: 'Aspirin',
              dosage: '81mg',
              frequency: 'Daily',
            },
          ],
          allergies: ['Penicillin'],
        });

      expect(updateResponse.status).toBe(200);
      expect(updateResponse.body.data.version).toBe(2);
      expect(updateResponse.body.data.summary).toBe('Updated care plan');
      expect(updateResponse.body.data.medications).toHaveLength(1);
      expect(updateResponse.body.data.allergies).toHaveLength(1);

      // Verify client detail reflects update
      const clientDetailResponse = await request(app)
        .get(`/api/v1/clients/${testClientId}`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(clientDetailResponse.status).toBe(200);
      expect(clientDetailResponse.body.data.carePlan.summary).toBe('Updated care plan');
      expect(clientDetailResponse.body.data.carePlan.medications).toHaveLength(1);
      expect(clientDetailResponse.body.data.carePlan.allergies).toHaveLength(1);
    });

    it('should increment version on multiple updates', async () => {
      // Create
      const create = await request(app)
        .post('/api/v1/care-plans')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          clientId: testClientId,
          summary: 'Version 1',
          medications: [],
          allergies: [],
        });

      expect(create.body.data.version).toBe(1);

      // Update 1
      const update1 = await request(app)
        .post('/api/v1/care-plans')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          clientId: testClientId,
          summary: 'Version 2',
          medications: [],
          allergies: [],
        });

      expect(update1.body.data.version).toBe(2);

      // Update 2
      const update2 = await request(app)
        .post('/api/v1/care-plans')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          clientId: testClientId,
          summary: 'Version 3',
          medications: [],
          allergies: [],
        });

      expect(update2.body.data.version).toBe(3);
    });
  });

  describe('Cache Invalidation', () => {
    it('should invalidate caches after care plan update', async () => {
      // Seed care plan
      await request(app)
        .post('/api/v1/care-plans')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          clientId: testClientId,
          summary: 'Cache Seed Summary',
          medications: [],
          allergies: [],
        });

      // Prime detail cache
      const detailPrime = await request(app)
        .get(`/api/v1/clients/${testClientId}`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(detailPrime.status).toBe(200);
      expect(detailPrime.body.data.carePlan.summary).toBe('Cache Seed Summary');

      // Prime list cache
      const listPrime = await request(app)
        .get('/api/v1/clients')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(listPrime.status).toBe(200);
      const primeClient = listPrime.body.data.clients.find(
        (client: { id: string }) => client.id === testClientId
      );
      if (!primeClient) {
        throw new Error('Expected client to appear in list response');
      }

      // Update care plan to trigger invalidation
      await request(app)
        .post('/api/v1/care-plans')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          clientId: testClientId,
          summary: 'Cache Updated Summary',
          medications: [
            {
              name: 'Vitamin D',
              dosage: '1000 IU',
              frequency: 'Daily',
            },
          ],
          allergies: ['Dust'],
        });

      // Fetch detail again - should reflect updated summary
      const detailFetch = await request(app)
        .get(`/api/v1/clients/${testClientId}`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(detailFetch.status).toBe(200);
      expect(detailFetch.body.data.carePlan.summary).toBe('Cache Updated Summary');
      expect(detailFetch.body.data.carePlan.medications).toHaveLength(1);
      expect(detailFetch.body.data.carePlan.allergies).toHaveLength(1);

      // Fetch list again - summary should match updated value
      const listFetch = await request(app)
        .get('/api/v1/clients')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(listFetch.status).toBe(200);
      const updatedListClient = listFetch.body.data.clients.find(
        (client: { id: string; carePlanSummary: string | null }) => client.id === testClientId
      );
      if (!updatedListClient) {
        throw new Error('Expected updated client in list response');
      }
      expect(updatedListClient.carePlanSummary).toBe('Cache Updated Summary');
    });
  });

  describe('Response Format', () => {
    it('should return correct response format', async () => {
      const response = await request(app)
        .post('/api/v1/care-plans')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          clientId: testClientId,
          summary: 'Complete care plan',
          medications: [
            {
              name: 'Aspirin',
              dosage: '81mg',
              frequency: 'Daily',
            },
          ],
          allergies: ['Penicillin'],
          specialInstructions: 'Take with food',
        });

      expect(response.status).toBe(201);
      expect(response.body.data).toHaveProperty('id');
      expect(response.body.data).toHaveProperty('clientId');
      expect(response.body.data).toHaveProperty('summary');
      expect(response.body.data).toHaveProperty('medications');
      expect(response.body.data).toHaveProperty('allergies');
      expect(response.body.data).toHaveProperty('specialInstructions');
      expect(response.body.data).toHaveProperty('version');
      expect(response.body.data).toHaveProperty('createdAt');
      expect(response.body.data).toHaveProperty('updatedAt');
    });
  });
});
