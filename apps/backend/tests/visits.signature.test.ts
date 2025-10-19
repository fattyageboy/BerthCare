/**
 * Integration Tests: Signature Upload Endpoints
 *
 * Tests for signature upload endpoints:
 * - POST /v1/visits/:visitId/signature/upload-url - Generate pre-signed S3 URL
 * - POST /v1/visits/:visitId/signature - Record signature metadata
 *
 * Test Coverage:
 * - Successful pre-signed URL generation
 * - Successful signature metadata recording
 * - File size validation (max 1MB)
 * - Signature type validation
 * - Authorization checks
 * - Input validation
 * - Error handling
 *
 * Reference: Architecture Blueprint - Visit Documentation, signature field
 * Task: V9 - Implement signature upload flow
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

describe('Signature Upload Endpoints', () => {
  let pgPool: Pool;
  let redisClient: RedisClient;
  let app: Express;
  let schemaName: string;

  let caregiverToken: string;
  let caregiverId: string;
  let otherCaregiverToken: string;
  let otherCaregiverId: string;
  let coordinatorToken: string;
  let coordinatorId: string;
  let clientId: string;
  let visitId: string;
  let zoneId: string;

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

    // Create test caregiver (owner of the visit)
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

    // Create another caregiver (not owner of the visit)
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

    otherCaregiverToken = generateAccessToken({
      userId: otherCaregiverId,
      email: generateTestEmail('other-caregiver'),
      role: 'caregiver',
      zoneId,
    });

    // Create test coordinator
    coordinatorId = crypto.randomUUID();
    await pgPool.query(
      `INSERT INTO users (id, email, password_hash, first_name, last_name, role, zone_id, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())`,
      [
        coordinatorId,
        generateTestEmail('coordinator'),
        'hash',
        'Test',
        'Coordinator',
        'coordinator',
        zoneId,
      ]
    );

    coordinatorToken = generateAccessToken({
      userId: coordinatorId,
      email: generateTestEmail('coordinator'),
      role: 'coordinator',
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

    // Create test visit
    visitId = await createTestVisit(pgPool, {
      clientId,
      staffId: caregiverId,
      scheduledStartTime: new Date().toISOString(),
      checkInTime: new Date().toISOString(),
      status: 'in_progress',
    });
  });

  afterAll(async () => {
    await cleanAllTestData(pgPool, redisClient);
    await teardownTestConnections(pgPool, redisClient, { schemaName, dropSchema: true });
  });

  describe('POST /v1/visits/:visitId/signature/upload-url', () => {
    describe('Success Cases', () => {
      it('should generate pre-signed URL for caregiver signature', async () => {
        const response = await request(app)
          .post(`/api/v1/visits/${visitId}/signature/upload-url`)
          .set('Authorization', `Bearer ${caregiverToken}`)
          .send({
            signatureType: 'caregiver',
            fileSize: 500 * 1024, // 500KB
          })
          .expect(200);

        expect(response.body).toHaveProperty('uploadUrl');
        expect(response.body).toHaveProperty('signatureKey');
        expect(response.body).toHaveProperty('expiresAt');

        // Verify URL format
        expect(response.body.uploadUrl).toContain('visits/');
        expect(response.body.uploadUrl).toContain(visitId);
        expect(response.body.uploadUrl).toContain('signatures/');

        // Verify signatureKey format
        expect(response.body.signatureKey).toMatch(
          new RegExp(`^visits/${visitId}/signatures/caregiver-\\d+\\.png$`)
        );

        // Verify expiration is in the future
        const expiresAt = new Date(response.body.expiresAt);
        expect(expiresAt.getTime()).toBeGreaterThan(Date.now());
      });

      it('should generate pre-signed URL for client signature', async () => {
        const response = await request(app)
          .post(`/api/v1/visits/${visitId}/signature/upload-url`)
          .set('Authorization', `Bearer ${caregiverToken}`)
          .send({
            signatureType: 'client',
            fileSize: 300 * 1024, // 300KB
          })
          .expect(200);

        expect(response.body).toHaveProperty('uploadUrl');
        expect(response.body.signatureKey).toContain('client-');
      });

      it('should generate pre-signed URL for family signature', async () => {
        const response = await request(app)
          .post(`/api/v1/visits/${visitId}/signature/upload-url`)
          .set('Authorization', `Bearer ${caregiverToken}`)
          .send({
            signatureType: 'family',
            fileSize: 400 * 1024, // 400KB
          })
          .expect(200);

        expect(response.body).toHaveProperty('uploadUrl');
        expect(response.body.signatureKey).toContain('family-');
      });

      it('should allow coordinator to generate upload URL for any visit', async () => {
        const response = await request(app)
          .post(`/api/v1/visits/${visitId}/signature/upload-url`)
          .set('Authorization', `Bearer ${coordinatorToken}`)
          .send({
            signatureType: 'caregiver',
            fileSize: 500 * 1024,
          })
          .expect(200);

        expect(response.body).toHaveProperty('uploadUrl');
      });
    });

    describe('Validation Errors', () => {
      it('should reject file size exceeding 1MB', async () => {
        const response = await request(app)
          .post(`/api/v1/visits/${visitId}/signature/upload-url`)
          .set('Authorization', `Bearer ${caregiverToken}`)
          .send({
            signatureType: 'caregiver',
            fileSize: 2 * 1024 * 1024, // 2MB
          })
          .expect(400);

        expect(response.body.error).toBe('Bad Request');
        expect(response.body.message).toContain('exceeds maximum of 1MB');
      });

      it('should reject invalid signature type', async () => {
        const response = await request(app)
          .post(`/api/v1/visits/${visitId}/signature/upload-url`)
          .set('Authorization', `Bearer ${caregiverToken}`)
          .send({
            signatureType: 'invalid',
            fileSize: 500 * 1024,
          })
          .expect(400);

        expect(response.body.error).toBe('Bad Request');
        expect(response.body.message).toContain('Invalid signatureType');
      });

      it('should reject missing signatureType', async () => {
        const response = await request(app)
          .post(`/api/v1/visits/${visitId}/signature/upload-url`)
          .set('Authorization', `Bearer ${caregiverToken}`)
          .send({
            fileSize: 500 * 1024,
          })
          .expect(400);

        expect(response.body.error).toBe('Bad Request');
        expect(response.body.message).toContain('signatureType');
      });

      it('should reject missing fileSize', async () => {
        const response = await request(app)
          .post(`/api/v1/visits/${visitId}/signature/upload-url`)
          .set('Authorization', `Bearer ${caregiverToken}`)
          .send({
            signatureType: 'caregiver',
          })
          .expect(400);

        expect(response.body.error).toBe('Bad Request');
        expect(response.body.message).toContain('fileSize');
      });

      it('should reject invalid visitId format', async () => {
        const response = await request(app)
          .post('/api/v1/visits/invalid-uuid/signature/upload-url')
          .set('Authorization', `Bearer ${caregiverToken}`)
          .send({
            signatureType: 'caregiver',
            fileSize: 500 * 1024,
          })
          .expect(400);

        expect(response.body.error).toBe('Bad Request');
        expect(response.body.message).toContain('Invalid visitId format');
      });
    });

    describe('Authorization Errors', () => {
      it('should reject request without authentication', async () => {
        const response = await request(app)
          .post(`/api/v1/visits/${visitId}/signature/upload-url`)
          .send({
            signatureType: 'caregiver',
            fileSize: 500 * 1024,
          })
          .expect(401);

        // Auth middleware returns error object with code and message
        expect(response.body.error).toHaveProperty('code');
        expect(response.body.error).toHaveProperty('message');
      });

      it("should reject caregiver uploading to another caregiver's visit", async () => {
        const response = await request(app)
          .post(`/api/v1/visits/${visitId}/signature/upload-url`)
          .set('Authorization', `Bearer ${otherCaregiverToken}`)
          .send({
            signatureType: 'caregiver',
            fileSize: 500 * 1024,
          })
          .expect(403);

        expect(response.body.error).toBe('Forbidden');
        expect(response.body.message).toContain('your own visits');
      });

      it('should return 404 for non-existent visit', async () => {
        const nonExistentVisitId = crypto.randomUUID();

        const response = await request(app)
          .post(`/api/v1/visits/${nonExistentVisitId}/signature/upload-url`)
          .set('Authorization', `Bearer ${caregiverToken}`)
          .send({
            signatureType: 'caregiver',
            fileSize: 500 * 1024,
          })
          .expect(404);

        expect(response.body.error).toBe('Not Found');
        expect(response.body.message).toBe('Visit not found');
      });
    });
  });

  describe('POST /v1/visits/:visitId/signature', () => {
    let signatureKey: string;

    beforeEach(async () => {
      // Generate a signature key for testing
      const timestamp = Date.now();
      signatureKey = `visits/${visitId}/signatures/caregiver-${timestamp}.png`;
    });

    describe('Success Cases', () => {
      it('should record signature metadata after successful upload', async () => {
        const response = await request(app)
          .post(`/api/v1/visits/${visitId}/signature`)
          .set('Authorization', `Bearer ${caregiverToken}`)
          .send({
            signatureKey,
            signatureType: 'caregiver',
          })
          .expect(200);

        expect(response.body).toHaveProperty('signatureUrl');
        expect(response.body).toHaveProperty('signatureType');
        expect(response.body).toHaveProperty('uploadedAt');
        expect(response.body.signatureType).toBe('caregiver');

        // Verify signature was saved to database
        const docResult = await pgPool.query(
          'SELECT signature_url FROM visit_documentation WHERE visit_id = $1',
          [visitId]
        );

        expect(docResult.rows.length).toBe(1);
        expect(docResult.rows[0].signature_url).toContain(signatureKey);
      });

      it('should update existing documentation with signature', async () => {
        // Create a new visit for this test
        const testVisitId = await createTestVisit(pgPool, {
          clientId,
          staffId: caregiverId,
          scheduledStartTime: new Date().toISOString(),
          checkInTime: new Date().toISOString(),
          status: 'in_progress',
        });

        // Create documentation first
        await pgPool.query(
          `INSERT INTO visit_documentation (visit_id, observations)
           VALUES ($1, $2)`,
          [testVisitId, 'Test observations']
        );

        const newSignatureKey = `visits/${testVisitId}/signatures/client-${Date.now()}.png`;

        const response = await request(app)
          .post(`/api/v1/visits/${testVisitId}/signature`)
          .set('Authorization', `Bearer ${caregiverToken}`)
          .send({
            signatureKey: newSignatureKey,
            signatureType: 'client',
          })
          .expect(200);

        expect(response.body.signatureType).toBe('client');

        // Verify signature was updated
        const docResult = await pgPool.query(
          'SELECT signature_url, observations FROM visit_documentation WHERE visit_id = $1',
          [testVisitId]
        );

        expect(docResult.rows[0].signature_url).toContain(newSignatureKey);
        expect(docResult.rows[0].observations).toBe('Test observations');
      });

      it('should allow coordinator to record signature for any visit', async () => {
        const coordinatorSignatureKey = `visits/${visitId}/signatures/coordinator-${Date.now()}.png`;

        const response = await request(app)
          .post(`/api/v1/visits/${visitId}/signature`)
          .set('Authorization', `Bearer ${coordinatorToken}`)
          .send({
            signatureKey: coordinatorSignatureKey,
            signatureType: 'family',
          })
          .expect(200);

        expect(response.body).toHaveProperty('signatureUrl');
      });

      it('should generate correct S3 URL', async () => {
        const testSignatureKey = `visits/${visitId}/signatures/test-${Date.now()}.png`;

        const response = await request(app)
          .post(`/api/v1/visits/${visitId}/signature`)
          .set('Authorization', `Bearer ${caregiverToken}`)
          .send({
            signatureKey: testSignatureKey,
            signatureType: 'caregiver',
          })
          .expect(200);

        // URL should contain bucket name and region
        expect(response.body.signatureUrl).toContain('.s3.');
        expect(response.body.signatureUrl).toContain(testSignatureKey);
      });
    });

    describe('Validation Errors', () => {
      it('should reject missing signatureKey', async () => {
        const response = await request(app)
          .post(`/api/v1/visits/${visitId}/signature`)
          .set('Authorization', `Bearer ${caregiverToken}`)
          .send({
            signatureType: 'caregiver',
          })
          .expect(400);

        expect(response.body.error).toBe('Bad Request');
        expect(response.body.message).toContain('signatureKey');
      });

      it('should reject missing signatureType', async () => {
        const response = await request(app)
          .post(`/api/v1/visits/${visitId}/signature`)
          .set('Authorization', `Bearer ${caregiverToken}`)
          .send({
            signatureKey,
          })
          .expect(400);

        expect(response.body.error).toBe('Bad Request');
        expect(response.body.message).toContain('signatureType');
      });

      it('should reject signatureKey with wrong visit ID', async () => {
        const wrongVisitId = crypto.randomUUID();
        const wrongSignatureKey = `visits/${wrongVisitId}/signatures/caregiver-${Date.now()}.png`;

        const response = await request(app)
          .post(`/api/v1/visits/${visitId}/signature`)
          .set('Authorization', `Bearer ${caregiverToken}`)
          .send({
            signatureKey: wrongSignatureKey,
            signatureType: 'caregiver',
          })
          .expect(400);

        expect(response.body.error).toBe('Bad Request');
        expect(response.body.message).toContain('Invalid signatureKey format');
      });

      it('should reject invalid visitId format', async () => {
        const response = await request(app)
          .post('/api/v1/visits/invalid-uuid/signature')
          .set('Authorization', `Bearer ${caregiverToken}`)
          .send({
            signatureKey,
            signatureType: 'caregiver',
          })
          .expect(400);

        expect(response.body.error).toBe('Bad Request');
        expect(response.body.message).toContain('Invalid visitId format');
      });
    });

    describe('Authorization Errors', () => {
      it('should reject request without authentication', async () => {
        const response = await request(app)
          .post(`/api/v1/visits/${visitId}/signature`)
          .send({
            signatureKey,
            signatureType: 'caregiver',
          })
          .expect(401);

        // Auth middleware returns error object with code and message
        expect(response.body.error).toHaveProperty('code');
        expect(response.body.error).toHaveProperty('message');
      });

      it("should reject caregiver adding signature to another caregiver's visit", async () => {
        const response = await request(app)
          .post(`/api/v1/visits/${visitId}/signature`)
          .set('Authorization', `Bearer ${otherCaregiverToken}`)
          .send({
            signatureKey,
            signatureType: 'caregiver',
          })
          .expect(403);

        expect(response.body.error).toBe('Forbidden');
        expect(response.body.message).toContain('your own visits');
      });

      it('should return 404 for non-existent visit', async () => {
        const nonExistentVisitId = crypto.randomUUID();
        const nonExistentSignatureKey = `visits/${nonExistentVisitId}/signatures/caregiver-${Date.now()}.png`;

        const response = await request(app)
          .post(`/api/v1/visits/${nonExistentVisitId}/signature`)
          .set('Authorization', `Bearer ${caregiverToken}`)
          .send({
            signatureKey: nonExistentSignatureKey,
            signatureType: 'caregiver',
          })
          .expect(404);

        expect(response.body.error).toBe('Not Found');
        expect(response.body.message).toBe('Visit not found');
      });
    });

    describe('Cache Invalidation', () => {
      const waitForCondition = async <T>(
        check: () => Promise<T | null | undefined>,
        { timeoutMs = 2000, intervalMs = 50 } = {}
      ): Promise<T> => {
        const start = Date.now();
        const deadline = start + timeoutMs;
        let lastError: Error | undefined;

        while (Date.now() <= deadline) {
          try {
            const result = await check();
            if (result !== null && result !== undefined) {
              return result;
            }
          } catch (error) {
            lastError = error as Error;
          }

          await new Promise((resolve) => setTimeout(resolve, intervalMs));
        }

        throw lastError ?? new Error('Condition not met within timeout');
      };

      it('should invalidate visit cache after adding signature', async () => {
        // Create a new visit for this test to avoid interference
        const testVisitId = await createTestVisit(pgPool, {
          clientId,
          staffId: caregiverId,
          scheduledStartTime: new Date().toISOString(),
          checkInTime: new Date().toISOString(),
          status: 'in_progress',
        });

        // First, fetch visit details to populate cache
        await request(app)
          .get(`/api/v1/visits/${testVisitId}`)
          .set('Authorization', `Bearer ${caregiverToken}`)
          .expect(200);

        // Add a signature
        const testSignatureKey = `visits/${testVisitId}/signatures/cache-test-${Date.now()}.png`;
        await request(app)
          .post(`/api/v1/visits/${testVisitId}/signature`)
          .set('Authorization', `Bearer ${caregiverToken}`)
          .send({
            signatureKey: testSignatureKey,
            signatureType: 'caregiver',
          })
          .expect(200);

        // Fetch visit details again - should have signature once cache invalidation completes
        const response = await waitForCondition(async () => {
          const visitResponse = await request(app)
            .get(`/api/v1/visits/${testVisitId}`)
            .set('Authorization', `Bearer ${caregiverToken}`)
            .expect(200);

          const signatureUrl = visitResponse.body.data?.documentation?.signatureUrl;
          if (signatureUrl && signatureUrl.includes(testSignatureKey)) {
            return visitResponse;
          }

          return null;
        });

        // Should have signature URL in documentation
        const signatureUrl = response.body.data?.documentation?.signatureUrl;
        expect(signatureUrl).toBeDefined();
        expect(signatureUrl).toContain(testSignatureKey);
      });
    });
  });
});
