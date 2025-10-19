/**
 * Integration Tests: GET /v1/visits/:visitId
 *
 * Tests for visit detail endpoint
 *
 * Test Coverage:
 * - Successful visit detail retrieval with all related data
 * - Authorization (caregiver owns visit, coordinator in same zone)
 * - Redis caching
 * - Error handling (404, 403, 400)
 *
 * Reference: Architecture Blueprint - Visit Documentation Endpoints
 * Task: V7 - Implement GET /v1/visits/:visitId endpoint
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

describe('GET /api/v1/visits/:visitId', () => {
  let pgPool: Pool;
  let redisClient: RedisClient;
  let app: Express;
  let schemaName: string;

  // Test users
  let caregiverId: string;
  let caregiver2Id: string;
  let coordinatorId: string;
  let zoneId: string;
  let zone2Id: string;

  // Test clients
  let client1Id: string;

  // Test visits
  let visit1Id: string;
  let visit2Id: string;

  beforeAll(async () => {
    const connections = await setupTestConnections();
    pgPool = connections.pgPool;
    redisClient = connections.redisClient;
    schemaName = connections.schemaName;
    app = createTestApp(pgPool, redisClient);

    // Create test zones
    zoneId = crypto.randomUUID();
    zone2Id = crypto.randomUUID();

    await pgPool.query(
      'INSERT INTO zones (id, name, region, created_at, updated_at) VALUES ($1, $2, $3, NOW(), NOW())',
      [zoneId, 'Test Zone 1', 'Test Region']
    );

    await pgPool.query(
      'INSERT INTO zones (id, name, region, created_at, updated_at) VALUES ($1, $2, $3, NOW(), NOW())',
      [zone2Id, 'Test Zone 2', 'Test Region']
    );

    // Create test users
    caregiverId = crypto.randomUUID();
    caregiver2Id = crypto.randomUUID();
    coordinatorId = crypto.randomUUID();

    await pgPool.query(
      `INSERT INTO users (id, email, password_hash, first_name, last_name, role, zone_id, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())`,
      [
        caregiverId,
        generateTestEmail('caregiver1'),
        'hash',
        'John',
        'Caregiver',
        'caregiver',
        zoneId,
      ]
    );

    await pgPool.query(
      `INSERT INTO users (id, email, password_hash, first_name, last_name, role, zone_id, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())`,
      [
        caregiver2Id,
        generateTestEmail('caregiver2'),
        'hash',
        'Jane',
        'Caregiver',
        'caregiver',
        zone2Id,
      ]
    );

    await pgPool.query(
      `INSERT INTO users (id, email, password_hash, first_name, last_name, role, zone_id, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())`,
      [
        coordinatorId,
        generateTestEmail('coordinator'),
        'hash',
        'Mike',
        'Coordinator',
        'coordinator',
        zoneId,
      ]
    );

    // Create test client
    client1Id = await createTestClient(pgPool, {
      firstName: 'Alice',
      lastName: 'Johnson',
      dateOfBirth: '1950-01-15',
      address: '123 Main St',
      latitude: 43.6532,
      longitude: -79.3832,
      zoneId,
      emergencyContactName: 'Bob Johnson',
      emergencyContactPhone: '555-0001',
      emergencyContactRelationship: 'Son',
    });

    // Create test visits
    const now = new Date();
    visit1Id = await createTestVisit(pgPool, {
      clientId: client1Id,
      staffId: caregiverId,
      scheduledStartTime: now.toISOString(),
      checkInTime: now.toISOString(),
      status: 'in_progress',
    });

    visit2Id = await createTestVisit(pgPool, {
      clientId: client1Id,
      staffId: caregiverId,
      scheduledStartTime: new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString(),
      checkInTime: new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString(),
      checkOutTime: new Date(now.getTime() - 23 * 60 * 60 * 1000).toISOString(),
      status: 'completed',
      durationMinutes: 60,
    });

    // Add documentation to visit2
    await pgPool.query(
      `INSERT INTO visit_documentation (visit_id, vital_signs, activities, observations, concerns)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        visit2Id,
        JSON.stringify({ bloodPressure: '120/80', heartRate: 72 }),
        JSON.stringify({ personalCare: true, medication: true }),
        'Client doing well',
        'None',
      ]
    );

    // Add photos to visit2
    const photoS3Key = `photos/test-${crypto.randomUUID()}.jpg`;
    await pgPool.query(
      `INSERT INTO visit_photos (visit_id, s3_key, s3_url, thumbnail_s3_key, uploaded_at)
       VALUES ($1, $2, $3, $4, NOW())`,
      [
        visit2Id,
        photoS3Key,
        `https://s3.example.com/${photoS3Key}`,
        `photos/test-${crypto.randomUUID()}_thumb.jpg`,
      ]
    );
  });

  afterAll(async () => {
    await cleanAllTestData(pgPool, redisClient);
    await teardownTestConnections(pgPool, redisClient, { schemaName, dropSchema: true });
  });

  beforeEach(async () => {
    // Clear Redis cache before each test
    await redisClient.flushDb();
  });

  describe('Authentication', () => {
    it('should return 401 without token', async () => {
      const response = await request(app).get(`/api/v1/visits/${visit1Id}`);

      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe('MISSING_TOKEN');
    });

    it('should return 401 with invalid token', async () => {
      const response = await request(app)
        .get(`/api/v1/visits/${visit1Id}`)
        .set('Authorization', 'Bearer invalid-token');

      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe('INVALID_TOKEN');
    });
  });

  describe('Authorization', () => {
    it('should allow caregiver to view their own visit', async () => {
      const token = generateAccessToken({ userId: caregiverId, role: 'caregiver', zoneId });

      const response = await request(app)
        .get(`/api/v1/visits/${visit1Id}`)
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body.data.id).toBe(visit1Id);
      expect(response.body.data.staffId).toBe(caregiverId);
    });

    it('should deny caregiver from viewing another caregiver visit', async () => {
      const token = generateAccessToken({
        userId: caregiver2Id,
        role: 'caregiver',
        zoneId: zone2Id,
      });

      const response = await request(app)
        .get(`/api/v1/visits/${visit1Id}`)
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(403);
      expect(response.body.message).toContain('your own visits');
    });

    it('should allow coordinator to view visits in their zone', async () => {
      const token = generateAccessToken({ userId: coordinatorId, role: 'coordinator', zoneId });

      const response = await request(app)
        .get(`/api/v1/visits/${visit1Id}`)
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body.data.id).toBe(visit1Id);
    });

    it('should deny coordinator from viewing visits in different zone', async () => {
      // Create coordinator in zone2
      const coordinator2Id = crypto.randomUUID();
      await pgPool.query(
        `INSERT INTO users (id, email, password_hash, first_name, last_name, role, zone_id, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())`,
        [
          coordinator2Id,
          generateTestEmail('coordinator2'),
          'hash',
          'Sarah',
          'Coordinator',
          'coordinator',
          zone2Id,
        ]
      );

      const token = generateAccessToken({
        userId: coordinator2Id,
        role: 'coordinator',
        zoneId: zone2Id,
      });

      const response = await request(app)
        .get(`/api/v1/visits/${visit1Id}`)
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(403);
      expect(response.body.message).toContain('your zone');

      // Cleanup
      await pgPool.query('DELETE FROM users WHERE id = $1', [coordinator2Id]);
    });
  });

  describe('Response Format', () => {
    it('should return complete visit data with client info', async () => {
      const token = generateAccessToken({ userId: caregiverId, role: 'caregiver', zoneId });

      const response = await request(app)
        .get(`/api/v1/visits/${visit1Id}`)
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body.data).toMatchObject({
        id: visit1Id,
        clientId: client1Id,
        staffId: caregiverId,
        status: 'in_progress',
        client: {
          id: client1Id,
          firstName: 'Alice',
          lastName: 'Johnson',
          address: '123 Main St',
          emergencyContact: {
            name: 'Bob Johnson',
            phone: '555-0001',
            relationship: 'Son',
          },
          zoneId,
        },
        staff: {
          id: caregiverId,
          firstName: 'John',
          lastName: 'Caregiver',
        },
      });
    });

    it('should return visit with documentation and photos', async () => {
      const token = generateAccessToken({ userId: caregiverId, role: 'caregiver', zoneId });

      const response = await request(app)
        .get(`/api/v1/visits/${visit2Id}`)
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body.data.documentation).toMatchObject({
        vitalSigns: { bloodPressure: '120/80', heartRate: 72 },
        activities: { personalCare: true, medication: true },
        observations: 'Client doing well',
        concerns: 'None',
      });
      expect(response.body.data.photos).toHaveLength(1);
      expect(response.body.data.photos[0]).toHaveProperty('s3Key');
      expect(response.body.data.photos[0]).toHaveProperty('s3Url');
      expect(response.body.data.photos[0].s3Key).toMatch(/^photos\/test-.*\.jpg$/);
      expect(response.body.data.photos[0].s3Url).toMatch(
        /^https:\/\/s3\.example\.com\/photos\/test-.*\.jpg$/
      );
    });

    it('should return null documentation if none exists', async () => {
      const token = generateAccessToken({ userId: caregiverId, role: 'caregiver', zoneId });

      const response = await request(app)
        .get(`/api/v1/visits/${visit1Id}`)
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body.data.documentation).toBeNull();
      expect(response.body.data.photos).toEqual([]);
    });
  });

  describe('Validation', () => {
    it('should return 400 for invalid visitId format', async () => {
      const token = generateAccessToken({ userId: caregiverId, role: 'caregiver', zoneId });

      const response = await request(app)
        .get('/api/v1/visits/invalid-uuid')
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('Invalid visitId format');
    });

    it('should return 404 for non-existent visit', async () => {
      const token = generateAccessToken({ userId: caregiverId, role: 'caregiver', zoneId });
      const nonExistentId = crypto.randomUUID();

      const response = await request(app)
        .get(`/api/v1/visits/${nonExistentId}`)
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(404);
      expect(response.body.message).toBe('Visit not found');
    });
  });

  describe('Caching', () => {
    it('should cache visit details', async () => {
      const token = generateAccessToken({ userId: caregiverId, role: 'caregiver', zoneId });

      // First request - cache miss
      const response1 = await request(app)
        .get(`/api/v1/visits/${visit1Id}`)
        .set('Authorization', `Bearer ${token}`);

      expect(response1.status).toBe(200);
      expect(response1.body.meta?.cached).toBeUndefined();

      // Second request - cache hit
      const response2 = await request(app)
        .get(`/api/v1/visits/${visit1Id}`)
        .set('Authorization', `Bearer ${token}`);

      expect(response2.status).toBe(200);
      expect(response2.body.meta?.cached).toBe(true);
      expect(response2.body.data.id).toBe(visit1Id);
    });

    it('should still enforce authorization with cached data', async () => {
      const token1 = generateAccessToken({ userId: caregiverId, role: 'caregiver', zoneId });
      const token2 = generateAccessToken({
        userId: caregiver2Id,
        role: 'caregiver',
        zoneId: zone2Id,
      });

      // First request by caregiver1 - cache the data
      const response1 = await request(app)
        .get(`/api/v1/visits/${visit1Id}`)
        .set('Authorization', `Bearer ${token1}`);

      expect(response1.status).toBe(200);

      // Second request by caregiver2 - should be denied even with cached data
      const response2 = await request(app)
        .get(`/api/v1/visits/${visit1Id}`)
        .set('Authorization', `Bearer ${token2}`);

      expect(response2.status).toBe(403);
    });
  });
});
