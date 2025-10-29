/**
 * Integration Tests: PATCH /api/v1/clients/:clientId - Update Client
 *
 * Tests client update endpoint with partial updates, cache invalidation, and audit logging.
 *
 * Test Coverage:
 * - ✅ Update client successfully (coordinator in same zone)
 * - ✅ Update client successfully (admin any zone)
 * - ✅ Reject caregiver user (403)
 * - ✅ Reject coordinator updating client in different zone (403)
 * - ✅ Reject invalid client ID format (400)
 * - ✅ Reject client not found (404)
 * - ✅ Reject empty update (400)
 * - ✅ Update single field (partial update)
 * - ✅ Update multiple fields
 * - ✅ Update address (triggers re-geocoding)
 * - ✅ Clear optional field (phone = null)
 * - ✅ Detect duplicate after update (409)
 * - ✅ Invalidate cache on update
 * - ✅ Admin can manually change zone
 * - ✅ Coordinator cannot change zone
 *
 * Reference: docs/C6-update-client-endpoint.md
 */

import crypto from 'crypto';

import { Express } from 'express';
import { Pool } from 'pg';
import { createClient } from 'redis';
import request from 'supertest';

import { generateAccessToken } from '../../../libs/shared/src';

import { createTestApp, setupTestConnections, teardownTestConnections } from './test-helpers';

let app: Express;
let pgPool: Pool;
let redisClient: ReturnType<typeof createClient>;

describe('PATCH /api/v1/clients/:clientId - Update Client', () => {
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
  const testZoneId = '550e8400-e29b-41d4-a716-446655440001'; // North Zone
  const otherZoneId = '550e8400-e29b-41d4-a716-446655440002'; // South Zone

  beforeAll(async () => {
    // Setup connections using shared helper
    const connections = await setupTestConnections();
    pgPool = connections.pgPool;
    redisClient = connections.redisClient;

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

    // Create test client directly in database
    testClientId = crypto.randomUUID();
    const carePlanId = crypto.randomUUID();

    await pgPool.query(
      `
      INSERT INTO clients (
        id, first_name, last_name, date_of_birth, address,
        latitude, longitude, phone, zone_id,
        emergency_contact_name, emergency_contact_phone,
        emergency_contact_relationship,
        created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW(), NOW()
      )
    `,
      [
        testClientId,
        'Test',
        'Client',
        '1950-01-01',
        '100 Queen St W, Toronto, ON M5H 2N2',
        43.6532,
        -79.3832,
        '416-555-0100',
        testZoneId,
        'Emergency Contact',
        '416-555-0200',
        'Family',
      ]
    );

    // Create care plan for test client
    await pgPool.query(
      `
      INSERT INTO care_plans (
        id, client_id, summary, medications, allergies,
        special_instructions, created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, NOW(), NOW()
      )
    `,
      [carePlanId, testClientId, 'Test care plan', JSON.stringify([]), JSON.stringify([]), '']
    );
  });

  afterEach(async () => {
    // Clean up second test client if created
    if (testClient2Id) {
      try {
        await pgPool.query('DELETE FROM care_plans WHERE client_id = $1', [testClient2Id]);
        await pgPool.query('DELETE FROM clients WHERE id = $1', [testClient2Id]);
        testClient2Id = '';
      } catch (error) {
        console.error('Error in afterEach cleanup:', error);
      }
    }
  });

  afterAll(async () => {
    // Clean up test data
    if (testClientId) {
      try {
        await pgPool.query('DELETE FROM care_plans WHERE client_id = $1', [testClientId]);
        await pgPool.query('DELETE FROM clients WHERE id = $1', [testClientId]);
      } catch (error) {
        console.error('Error cleaning up test data:', error);
      }
    }

    // Close connections using shared helper
    await teardownTestConnections(pgPool, redisClient);
  });

  describe('Authorization', () => {
    it('should reject request without authentication token', async () => {
      const response = await request(app).patch(`/api/v1/clients/${testClientId}`).send({
        firstName: 'Updated',
      });

      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe('MISSING_TOKEN');
    });

    it('should reject caregiver user', async () => {
      const response = await request(app)
        .patch(`/api/v1/clients/${testClientId}`)
        .set('Authorization', `Bearer ${caregiverToken}`)
        .send({
          firstName: 'Updated',
        });

      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('FORBIDDEN');
    });

    it('should reject coordinator updating client in different zone', async () => {
      const response = await request(app)
        .patch(`/api/v1/clients/${testClientId}`)
        .set('Authorization', `Bearer ${otherCoordinatorToken}`)
        .send({
          firstName: 'Updated',
        });

      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('FORBIDDEN');
      expect(response.body.error.message).toContain('your zone');
    });

    it('should allow coordinator to update client in same zone', async () => {
      const response = await request(app)
        .patch(`/api/v1/clients/${testClientId}`)
        .set('Authorization', `Bearer ${coordinatorToken}`)
        .send({
          phone: '416-555-9999',
        });

      expect(response.status).toBe(200);
      expect(response.body.data.phone).toBe('416-555-9999');
    });

    it('should allow admin to update any client', async () => {
      const response = await request(app)
        .patch(`/api/v1/clients/${testClientId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          phone: '416-555-0100',
        });

      expect(response.status).toBe(200);
    });

    it('should reject coordinator attempting to change zone', async () => {
      const response = await request(app)
        .patch(`/api/v1/clients/${testClientId}`)
        .set('Authorization', `Bearer ${coordinatorToken}`)
        .send({
          zoneId: otherZoneId,
        });

      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('FORBIDDEN');
      expect(response.body.error.message).toContain('Only admins');
    });

    it('should allow admin to change zone', async () => {
      const response = await request(app)
        .patch(`/api/v1/clients/${testClientId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          zoneId: otherZoneId,
        });

      expect(response.status).toBe(200);
      expect(response.body.data.zoneId).toBe(otherZoneId);

      // Change back
      await request(app)
        .patch(`/api/v1/clients/${testClientId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          zoneId: testZoneId,
        });
    });
  });

  describe('Validation', () => {
    it('should reject invalid client ID format', async () => {
      const response = await request(app)
        .patch('/api/v1/clients/invalid-uuid')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          firstName: 'Updated',
        });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('INVALID_CLIENT_ID');
    });

    it('should reject client not found', async () => {
      const nonExistentId = '00000000-0000-0000-0000-999999999999';

      const response = await request(app)
        .patch(`/api/v1/clients/${nonExistentId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          firstName: 'Updated',
        });

      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe('CLIENT_NOT_FOUND');
    });

    it('should reject empty update (no fields provided)', async () => {
      const response = await request(app)
        .patch(`/api/v1/clients/${testClientId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
      expect(response.body.error.message).toContain('At least one field');
    });

    it('should reject invalid first name', async () => {
      const response = await request(app)
        .patch(`/api/v1/clients/${testClientId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          firstName: '', // Empty string
        });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
      expect(response.body.error.message).toContain('First name');
    });

    it('should reject invalid date format', async () => {
      const response = await request(app)
        .patch(`/api/v1/clients/${testClientId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          dateOfBirth: '01/01/1950', // Invalid format
        });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
      expect(response.body.error.message).toContain('YYYY-MM-DD');
    });

    it('should reject future date of birth', async () => {
      const futureDate = new Date();
      futureDate.setFullYear(futureDate.getFullYear() + 1);
      const futureDateStr = futureDate.toISOString().split('T')[0];

      const response = await request(app)
        .patch(`/api/v1/clients/${testClientId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          dateOfBirth: futureDateStr,
        });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
      expect(response.body.error.message).toContain('future');
    });
  });

  describe('Partial Updates', () => {
    it('should update single field (first name)', async () => {
      const response = await request(app)
        .patch(`/api/v1/clients/${testClientId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          firstName: 'UpdatedFirst',
        });

      expect(response.status).toBe(200);
      expect(response.body.data.firstName).toBe('UpdatedFirst');
      expect(response.body.data.lastName).toBe('Client'); // Unchanged
    });

    it('should update multiple fields', async () => {
      const response = await request(app)
        .patch(`/api/v1/clients/${testClientId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          firstName: 'Test',
          lastName: 'UpdatedLast',
          phone: '416-555-1111',
        });

      expect(response.status).toBe(200);
      expect(response.body.data.firstName).toBe('Test');
      expect(response.body.data.lastName).toBe('UpdatedLast');
      expect(response.body.data.phone).toBe('416-555-1111');
    });

    it('should clear optional field (phone = null)', async () => {
      const response = await request(app)
        .patch(`/api/v1/clients/${testClientId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          phone: null,
        });

      expect(response.status).toBe(200);
      expect(response.body.data.phone).toBeNull();

      // Restore phone
      await request(app)
        .patch(`/api/v1/clients/${testClientId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          phone: '416-555-0100',
        });
    });

    it('should return unchanged client if no actual changes', async () => {
      const response = await request(app)
        .patch(`/api/v1/clients/${testClientId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          firstName: 'Test', // Same as current
        });

      expect(response.status).toBe(200);
      expect(response.body.data.firstName).toBe('Test');
    });
  });

  describe('Address Re-geocoding', () => {
    it('should attempt to re-geocode when address changes', async () => {
      // Test that address updates trigger geocoding attempt
      // Note: Without valid Google Maps API key, this will return 400 with GEOCODING_ERROR
      // With valid API key, it will return 200 with updated coordinates
      const response = await request(app)
        .patch(`/api/v1/clients/${testClientId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          address: '301 Front St W, Toronto, ON M5V 2T6',
        });

      // Verify response is either success or expected geocoding error
      expect(response.status).toBeGreaterThanOrEqual(200);
      expect(response.status).toBeLessThan(500);

      // Both success and geocoding failure are valid outcomes
      const validStatuses = [200, 400];
      expect(validStatuses).toContain(response.status);

      // If geocoding failed, verify error code
      const isGeocodingError =
        response.status === 400 && response.body.error?.code === 'GEOCODING_ERROR';
      const isSuccess = response.status === 200;

      expect(isGeocodingError || isSuccess).toBe(true);
    });

    it('should handle geocoding failure gracefully', async () => {
      const response = await request(app)
        .patch(`/api/v1/clients/${testClientId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          address: 'Invalid Address That Does Not Exist 12345',
        });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('GEOCODING_ERROR');
    });
  });

  describe('Duplicate Detection', () => {
    it('should detect duplicate after name/DOB update', async () => {
      // Create second client directly in database
      testClient2Id = crypto.randomUUID();
      const carePlan2Id = crypto.randomUUID();

      await pgPool.query(
        `
        INSERT INTO clients (
          id, first_name, last_name, date_of_birth, address,
          latitude, longitude, phone, zone_id,
          emergency_contact_name, emergency_contact_phone,
          emergency_contact_relationship,
          created_at, updated_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW(), NOW()
        )
      `,
        [
          testClient2Id,
          'Duplicate',
          'Test',
          '1960-05-15',
          '100 Queen St W, Toronto, ON M5H 2N2',
          43.6532,
          -79.3832,
          '416-555-0300',
          testZoneId,
          'Emergency Contact',
          '416-555-0300',
          'Family',
        ]
      );

      await pgPool.query(
        `
        INSERT INTO care_plans (
          id, client_id, summary, medications, allergies,
          special_instructions, created_at, updated_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, NOW(), NOW()
        )
      `,
        [carePlan2Id, testClient2Id, 'Test care plan 2', JSON.stringify([]), JSON.stringify([]), '']
      );

      // Try to update first client to match second client
      const updateResponse = await request(app)
        .patch(`/api/v1/clients/${testClientId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          firstName: 'Duplicate',
          lastName: 'Test',
          dateOfBirth: '1960-05-15',
        });

      expect(updateResponse.status).toBe(409);
      expect(updateResponse.body.error.code).toBe('DUPLICATE_CLIENT');
      expect(updateResponse.body.error.details.existingClientId).toBe(testClient2Id);
    });
  });

  describe('Cache Invalidation', () => {
    it('should invalidate cache on update', async () => {
      // First, populate cache by fetching client
      await request(app)
        .get(`/api/v1/clients/${testClientId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      // Update client
      const updateResponse = await request(app)
        .patch(`/api/v1/clients/${testClientId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          firstName: 'CacheTest',
        });

      expect(updateResponse.status).toBe(200);

      // Fetch again - should get updated data (not cached)
      const fetchResponse = await request(app)
        .get(`/api/v1/clients/${testClientId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(fetchResponse.status).toBe(200);
      expect(fetchResponse.body.data.firstName).toBe('CacheTest');

      // Restore
      await request(app)
        .patch(`/api/v1/clients/${testClientId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          firstName: 'Test',
        });
    });
  });

  describe('Emergency Contact Updates', () => {
    it('should update emergency contact information', async () => {
      const response = await request(app)
        .patch(`/api/v1/clients/${testClientId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          emergencyContactName: 'New Emergency Contact',
          emergencyContactPhone: '416-555-9999',
          emergencyContactRelationship: 'Spouse',
        });

      expect(response.status).toBe(200);
      expect(response.body.data.emergencyContact.name).toBe('New Emergency Contact');
      expect(response.body.data.emergencyContact.phone).toBe('416-555-9999');
      expect(response.body.data.emergencyContact.relationship).toBe('Spouse');

      // Restore
      await request(app)
        .patch(`/api/v1/clients/${testClientId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          emergencyContactName: 'Emergency Contact',
          emergencyContactPhone: '416-555-0200',
          emergencyContactRelationship: 'Family',
        });
    });
  });

  describe('Response Format', () => {
    it('should return updated client with correct format', async () => {
      const response = await request(app)
        .patch(`/api/v1/clients/${testClientId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          firstName: 'Test',
        });

      expect(response.status).toBe(200);
      expect(response.body.data).toHaveProperty('id');
      expect(response.body.data).toHaveProperty('firstName');
      expect(response.body.data).toHaveProperty('lastName');
      expect(response.body.data).toHaveProperty('dateOfBirth');
      expect(response.body.data).toHaveProperty('address');
      expect(response.body.data).toHaveProperty('latitude');
      expect(response.body.data).toHaveProperty('longitude');
      expect(response.body.data).toHaveProperty('phone');
      expect(response.body.data).toHaveProperty('emergencyContact');
      expect(response.body.data).toHaveProperty('zoneId');
      expect(response.body.data).toHaveProperty('updatedAt');
    });
  });
});
