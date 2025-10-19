/**
 * Integration Tests: Photo Upload Endpoints
 *
 * Tests for photo upload endpoints:
 * - POST /v1/visits/:visitId/photos/upload-url - Generate pre-signed S3 URL
 * - POST /v1/visits/:visitId/photos - Record photo metadata
 *
 * Test Coverage:
 * - Successful pre-signed URL generation
 * - Successful photo metadata recording
 * - File size validation (max 2MB)
 * - MIME type validation
 * - Authorization checks
 * - Input validation
 * - Error handling
 *
 * Reference: Architecture Blueprint - Photo Management, S3 pre-signed URLs
 * Task: V8 - Implement photo upload flow
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

describe('Photo Upload Endpoints', () => {
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

  describe('POST /v1/visits/:visitId/photos/upload-url', () => {
    describe('Success Cases', () => {
      it('should generate pre-signed URL for valid photo upload request', async () => {
        const response = await request(app)
          .post(`/api/v1/visits/${visitId}/photos/upload-url`)
          .set('Authorization', `Bearer ${caregiverToken}`)
          .send({
            fileName: 'wound-photo.jpg',
            mimeType: 'image/jpeg',
            fileSize: 1024 * 1024, // 1MB
          })
          .expect(200);

        expect(response.body).toHaveProperty('uploadUrl');
        expect(response.body).toHaveProperty('photoKey');
        expect(response.body).toHaveProperty('expiresAt');

        // Verify URL format
        expect(response.body.uploadUrl).toContain('visits/');
        expect(response.body.uploadUrl).toContain(visitId);
        expect(response.body.uploadUrl).toContain('photos/');

        // Verify photoKey format
        expect(response.body.photoKey).toMatch(
          new RegExp(`^visits/${visitId}/photos/\\d+-wound-photo\\.jpg$`)
        );

        // Verify expiration is in the future
        const expiresAt = new Date(response.body.expiresAt);
        expect(expiresAt.getTime()).toBeGreaterThan(Date.now());
      });

      it('should accept PNG images', async () => {
        const response = await request(app)
          .post(`/api/v1/visits/${visitId}/photos/upload-url`)
          .set('Authorization', `Bearer ${caregiverToken}`)
          .send({
            fileName: 'condition-photo.png',
            mimeType: 'image/png',
            fileSize: 500 * 1024, // 500KB
          })
          .expect(200);

        expect(response.body).toHaveProperty('uploadUrl');
        expect(response.body.photoKey).toContain('.png');
      });

      it('should accept WebP images', async () => {
        const response = await request(app)
          .post(`/api/v1/visits/${visitId}/photos/upload-url`)
          .set('Authorization', `Bearer ${caregiverToken}`)
          .send({
            fileName: 'photo.webp',
            mimeType: 'image/webp',
            fileSize: 800 * 1024, // 800KB
          })
          .expect(200);

        expect(response.body).toHaveProperty('uploadUrl');
      });

      it('should reject HEIC images (requires client-side conversion)', async () => {
        const response = await request(app)
          .post(`/api/v1/visits/${visitId}/photos/upload-url`)
          .set('Authorization', `Bearer ${caregiverToken}`)
          .send({
            fileName: 'photo.heic',
            mimeType: 'image/heic',
            fileSize: 1.5 * 1024 * 1024, // 1.5MB
          })
          .expect(400);

        expect(response.body.message).toContain('Invalid MIME type');
      });

      it('should allow coordinator to generate upload URL for any visit', async () => {
        const response = await request(app)
          .post(`/api/v1/visits/${visitId}/photos/upload-url`)
          .set('Authorization', `Bearer ${coordinatorToken}`)
          .send({
            fileName: 'coordinator-photo.jpg',
            mimeType: 'image/jpeg',
            fileSize: 1024 * 1024,
          })
          .expect(200);

        expect(response.body).toHaveProperty('uploadUrl');
      });

      it('should sanitize file names with special characters', async () => {
        const response = await request(app)
          .post(`/api/v1/visits/${visitId}/photos/upload-url`)
          .set('Authorization', `Bearer ${caregiverToken}`)
          .send({
            fileName: 'photo with spaces & special!chars.jpg',
            mimeType: 'image/jpeg',
            fileSize: 1024 * 1024,
          })
          .expect(200);

        // Special characters should be replaced with underscores
        expect(response.body.photoKey).toMatch(/photo_with_spaces___special_chars\.jpg$/);
      });
    });

    describe('Validation Errors', () => {
      it('should reject file size exceeding 2MB', async () => {
        const response = await request(app)
          .post(`/api/v1/visits/${visitId}/photos/upload-url`)
          .set('Authorization', `Bearer ${caregiverToken}`)
          .send({
            fileName: 'large-photo.jpg',
            mimeType: 'image/jpeg',
            fileSize: 3 * 1024 * 1024, // 3MB
          })
          .expect(400);

        expect(response.body.error).toBe('Bad Request');
        expect(response.body.message).toContain('exceeds maximum of 2MB');
      });

      it('should reject invalid MIME type', async () => {
        const response = await request(app)
          .post(`/api/v1/visits/${visitId}/photos/upload-url`)
          .set('Authorization', `Bearer ${caregiverToken}`)
          .send({
            fileName: 'document.pdf',
            mimeType: 'application/pdf',
            fileSize: 1024 * 1024,
          })
          .expect(400);

        expect(response.body.error).toBe('Bad Request');
        expect(response.body.message).toContain('Invalid MIME type');
      });

      it('should reject missing fileName', async () => {
        const response = await request(app)
          .post(`/api/v1/visits/${visitId}/photos/upload-url`)
          .set('Authorization', `Bearer ${caregiverToken}`)
          .send({
            mimeType: 'image/jpeg',
            fileSize: 1024 * 1024,
          })
          .expect(400);

        expect(response.body.error).toBe('Bad Request');
        expect(response.body.message).toContain('fileName');
      });

      it('should reject missing mimeType', async () => {
        const response = await request(app)
          .post(`/api/v1/visits/${visitId}/photos/upload-url`)
          .set('Authorization', `Bearer ${caregiverToken}`)
          .send({
            fileName: 'photo.jpg',
            fileSize: 1024 * 1024,
          })
          .expect(400);

        expect(response.body.error).toBe('Bad Request');
        expect(response.body.message).toContain('mimeType');
      });

      it('should reject missing fileSize', async () => {
        const response = await request(app)
          .post(`/api/v1/visits/${visitId}/photos/upload-url`)
          .set('Authorization', `Bearer ${caregiverToken}`)
          .send({
            fileName: 'photo.jpg',
            mimeType: 'image/jpeg',
          })
          .expect(400);

        expect(response.body.error).toBe('Bad Request');
        expect(response.body.message).toContain('fileSize');
      });

      it('should reject invalid visitId format', async () => {
        const response = await request(app)
          .post('/api/v1/visits/invalid-uuid/photos/upload-url')
          .set('Authorization', `Bearer ${caregiverToken}`)
          .send({
            fileName: 'photo.jpg',
            mimeType: 'image/jpeg',
            fileSize: 1024 * 1024,
          })
          .expect(400);

        expect(response.body.error).toBe('Bad Request');
        expect(response.body.message).toContain('Invalid visitId format');
      });
    });

    describe('Authorization Errors', () => {
      it('should reject request without authentication', async () => {
        const response = await request(app)
          .post(`/api/v1/visits/${visitId}/photos/upload-url`)
          .send({
            fileName: 'photo.jpg',
            mimeType: 'image/jpeg',
            fileSize: 1024 * 1024,
          })
          .expect(401);

        // Auth middleware returns error object with code and message
        expect(response.body.error).toHaveProperty('code');
        expect(response.body.error).toHaveProperty('message');
      });

      it("should reject caregiver uploading to another caregiver's visit", async () => {
        const response = await request(app)
          .post(`/api/v1/visits/${visitId}/photos/upload-url`)
          .set('Authorization', `Bearer ${otherCaregiverToken}`)
          .send({
            fileName: 'photo.jpg',
            mimeType: 'image/jpeg',
            fileSize: 1024 * 1024,
          })
          .expect(403);

        expect(response.body.error).toBe('Forbidden');
        expect(response.body.message).toContain('your own visits');
      });

      it('should return 404 for non-existent visit', async () => {
        const nonExistentVisitId = crypto.randomUUID();

        const response = await request(app)
          .post(`/api/v1/visits/${nonExistentVisitId}/photos/upload-url`)
          .set('Authorization', `Bearer ${caregiverToken}`)
          .send({
            fileName: 'photo.jpg',
            mimeType: 'image/jpeg',
            fileSize: 1024 * 1024,
          })
          .expect(404);

        expect(response.body.error).toBe('Not Found');
        expect(response.body.message).toBe('Visit not found');
      });
    });
  });

  describe('POST /v1/visits/:visitId/photos', () => {
    let photoKey: string;

    beforeEach(async () => {
      // Generate a photo key for testing
      const timestamp = Date.now();
      photoKey = `visits/${visitId}/photos/${timestamp}-test-photo.jpg`;
    });

    describe('Success Cases', () => {
      it('should record photo metadata after successful upload', async () => {
        const response = await request(app)
          .post(`/api/v1/visits/${visitId}/photos`)
          .set('Authorization', `Bearer ${caregiverToken}`)
          .send({
            photoKey,
            fileName: 'test-photo.jpg',
            fileSize: 1024 * 1024,
            mimeType: 'image/jpeg',
          })
          .expect(201);

        expect(response.body).toHaveProperty('id');
        expect(response.body.photoKey).toBe(photoKey);
        expect(response.body).toHaveProperty('photoUrl');
        expect(response.body).toHaveProperty('uploadedAt');

        // Verify photo was saved to database
        const photoResult = await pgPool.query('SELECT * FROM visit_photos WHERE s3_key = $1', [
          photoKey,
        ]);

        expect(photoResult.rows.length).toBe(1);
        expect(photoResult.rows[0].visit_id).toBe(visitId);
        expect(photoResult.rows[0].file_name).toBe('test-photo.jpg');
        expect(photoResult.rows[0].file_size).toBe(1024 * 1024);
        expect(photoResult.rows[0].mime_type).toBe('image/jpeg');
      });

      it('should record photo with thumbnail key', async () => {
        const thumbnailKey = `visits/${visitId}/photos/${Date.now()}-test-photo-thumb.jpg`;

        const response = await request(app)
          .post(`/api/v1/visits/${visitId}/photos`)
          .set('Authorization', `Bearer ${caregiverToken}`)
          .send({
            photoKey,
            fileName: 'test-photo.jpg',
            fileSize: 1024 * 1024,
            mimeType: 'image/jpeg',
            thumbnailKey,
          })
          .expect(201);

        expect(response.body.thumbnailKey).toBe(thumbnailKey);

        // Verify thumbnail key was saved
        const photoResult = await pgPool.query(
          'SELECT thumbnail_s3_key FROM visit_photos WHERE s3_key = $1',
          [photoKey]
        );

        expect(photoResult.rows[0].thumbnail_s3_key).toBe(thumbnailKey);
      });

      it('should allow coordinator to record photo for any visit', async () => {
        const coordinatorPhotoKey = `visits/${visitId}/photos/${Date.now()}-coordinator-photo.jpg`;

        const response = await request(app)
          .post(`/api/v1/visits/${visitId}/photos`)
          .set('Authorization', `Bearer ${coordinatorToken}`)
          .send({
            photoKey: coordinatorPhotoKey,
            fileName: 'coordinator-photo.jpg',
            fileSize: 500 * 1024,
            mimeType: 'image/jpeg',
          })
          .expect(201);

        expect(response.body).toHaveProperty('id');
      });

      it('should generate correct S3 URL', async () => {
        const response = await request(app)
          .post(`/api/v1/visits/${visitId}/photos`)
          .set('Authorization', `Bearer ${caregiverToken}`)
          .send({
            photoKey,
            fileName: 'test-photo.jpg',
            fileSize: 1024 * 1024,
            mimeType: 'image/jpeg',
          })
          .expect(201);

        // URL should contain bucket name and region
        expect(response.body.photoUrl).toContain('.s3.');
        expect(response.body.photoUrl).toContain(photoKey);
      });
    });

    describe('Validation Errors', () => {
      it('should reject missing photoKey', async () => {
        const response = await request(app)
          .post(`/api/v1/visits/${visitId}/photos`)
          .set('Authorization', `Bearer ${caregiverToken}`)
          .send({
            fileName: 'test-photo.jpg',
            fileSize: 1024 * 1024,
            mimeType: 'image/jpeg',
          })
          .expect(400);

        expect(response.body.error).toBe('Bad Request');
        expect(response.body.message).toContain('photoKey');
      });

      it('should reject missing fileName', async () => {
        const response = await request(app)
          .post(`/api/v1/visits/${visitId}/photos`)
          .set('Authorization', `Bearer ${caregiverToken}`)
          .send({
            photoKey,
            fileSize: 1024 * 1024,
            mimeType: 'image/jpeg',
          })
          .expect(400);

        expect(response.body.error).toBe('Bad Request');
        expect(response.body.message).toContain('fileName');
      });

      it('should reject missing fileSize', async () => {
        const response = await request(app)
          .post(`/api/v1/visits/${visitId}/photos`)
          .set('Authorization', `Bearer ${caregiverToken}`)
          .send({
            photoKey,
            fileName: 'test-photo.jpg',
            mimeType: 'image/jpeg',
          })
          .expect(400);

        expect(response.body.error).toBe('Bad Request');
        expect(response.body.message).toContain('fileSize');
      });

      it('should reject missing mimeType', async () => {
        const response = await request(app)
          .post(`/api/v1/visits/${visitId}/photos`)
          .set('Authorization', `Bearer ${caregiverToken}`)
          .send({
            photoKey,
            fileName: 'test-photo.jpg',
            fileSize: 1024 * 1024,
          })
          .expect(400);

        expect(response.body.error).toBe('Bad Request');
        expect(response.body.message).toContain('mimeType');
      });

      it('should reject photoKey with wrong visit ID', async () => {
        const wrongVisitId = crypto.randomUUID();
        const wrongPhotoKey = `visits/${wrongVisitId}/photos/${Date.now()}-photo.jpg`;

        const response = await request(app)
          .post(`/api/v1/visits/${visitId}/photos`)
          .set('Authorization', `Bearer ${caregiverToken}`)
          .send({
            photoKey: wrongPhotoKey,
            fileName: 'test-photo.jpg',
            fileSize: 1024 * 1024,
            mimeType: 'image/jpeg',
          })
          .expect(400);

        expect(response.body.error).toBe('Bad Request');
        expect(response.body.message).toContain('Invalid photoKey format');
      });

      it('should reject invalid visitId format', async () => {
        const response = await request(app)
          .post('/api/v1/visits/invalid-uuid/photos')
          .set('Authorization', `Bearer ${caregiverToken}`)
          .send({
            photoKey,
            fileName: 'test-photo.jpg',
            fileSize: 1024 * 1024,
            mimeType: 'image/jpeg',
          })
          .expect(400);

        expect(response.body.error).toBe('Bad Request');
        expect(response.body.message).toContain('Invalid visitId format');
      });
    });

    describe('Authorization Errors', () => {
      it('should reject request without authentication', async () => {
        const response = await request(app)
          .post(`/api/v1/visits/${visitId}/photos`)
          .send({
            photoKey,
            fileName: 'test-photo.jpg',
            fileSize: 1024 * 1024,
            mimeType: 'image/jpeg',
          })
          .expect(401);

        // Auth middleware returns error object with code and message
        expect(response.body.error).toHaveProperty('code');
        expect(response.body.error).toHaveProperty('message');
      });

      it("should reject caregiver adding photo to another caregiver's visit", async () => {
        const response = await request(app)
          .post(`/api/v1/visits/${visitId}/photos`)
          .set('Authorization', `Bearer ${otherCaregiverToken}`)
          .send({
            photoKey,
            fileName: 'test-photo.jpg',
            fileSize: 1024 * 1024,
            mimeType: 'image/jpeg',
          })
          .expect(403);

        expect(response.body.error).toBe('Forbidden');
        expect(response.body.message).toContain('your own visits');
      });

      it('should return 404 for non-existent visit', async () => {
        const nonExistentVisitId = crypto.randomUUID();
        const nonExistentPhotoKey = `visits/${nonExistentVisitId}/photos/${Date.now()}-photo.jpg`;

        const response = await request(app)
          .post(`/api/v1/visits/${nonExistentVisitId}/photos`)
          .set('Authorization', `Bearer ${caregiverToken}`)
          .send({
            photoKey: nonExistentPhotoKey,
            fileName: 'test-photo.jpg',
            fileSize: 1024 * 1024,
            mimeType: 'image/jpeg',
          })
          .expect(404);

        expect(response.body.error).toBe('Not Found');
        expect(response.body.message).toBe('Visit not found');
      });
    });

    describe('Cache Invalidation', () => {
      it('should invalidate visit cache after adding photo', async () => {
        // Create a new visit for this test to avoid interference from other tests
        const testVisitId = await createTestVisit(pgPool, {
          clientId,
          staffId: caregiverId,
          scheduledStartTime: new Date().toISOString(),
          checkInTime: new Date().toISOString(),
          status: 'in_progress',
        });

        // First, fetch visit details to populate cache
        const firstResponse = await request(app)
          .get(`/api/v1/visits/${testVisitId}`)
          .set('Authorization', `Bearer ${caregiverToken}`)
          .expect(200);

        const initialPhotoCount = firstResponse.body.data?.photos?.length || 0;

        // Add a photo with unique key
        const uniquePhotoKey = `visits/${testVisitId}/photos/${Date.now()}-cache-test-photo.jpg`;
        await request(app)
          .post(`/api/v1/visits/${testVisitId}/photos`)
          .set('Authorization', `Bearer ${caregiverToken}`)
          .send({
            photoKey: uniquePhotoKey,
            fileName: 'cache-test-photo.jpg',
            fileSize: 1024 * 1024,
            mimeType: 'image/jpeg',
          })
          .expect(201);

        // Small delay to ensure cache invalidation completes
        await new Promise((resolve) => setTimeout(resolve, 100));

        // Fetch visit details again - should have updated photo count
        const response = await request(app)
          .get(`/api/v1/visits/${testVisitId}`)
          .set('Authorization', `Bearer ${caregiverToken}`)
          .expect(200);

        // Photo count should have increased (cache was invalidated)
        const newPhotoCount = response.body.data?.photos?.length || 0;
        expect(newPhotoCount).toBe(initialPhotoCount + 1);
      });
    });
  });
});
