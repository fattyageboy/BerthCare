/**
 * Integration Tests: GET /api/v1/clients
 *
 * Tests the client list endpoint according to specifications:
 * - Returns paginated list of clients
 * - Filters by zone_id
 * - Searches by name (first or last)
 * - Respects pagination parameters (page, limit)
 * - Requires authentication
 * - Enforces zone-based access control
 * - Redis caching works (5 min TTL)
 *
 * Reference: Task C3 - Implement GET /api/v1/clients endpoint
 * Architecture: project-documentation/architecture-output.md
 *
 * Test Strategy:
 * - Use real PostgreSQL and Redis connections
 * - Create test users and clients before each test
 * - Test happy path and error scenarios
 * - Verify pagination, filtering, and search
 * - Validate zone-based access control
 * - Test caching behavior
 */

import express from 'express';
import { Pool } from 'pg';
import request from 'supertest';

import { generateAccessToken } from '@berthcare/shared';

import { RedisClient } from '../src/cache/redis-client';
import { createClientRoutes } from '../src/routes/clients.routes';

import { setupTestConnections, teardownTestConnections } from './test-helpers';

const LAST_VISIT_COMPLETED_AT = '2025-01-01T10:05:00.000Z';
const NEXT_VISIT_SCHEDULED_AT = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

describe('GET /api/v1/clients', () => {
  let app: express.Application;
  let pgPool: Pool;
  let redisClient: RedisClient;
  let schemaName: string;

  // Test data
  let testZoneId1: string;
  let testZoneId2: string;
  let testUserId1: string; // Caregiver in zone 1
  let testAdminId: string; // Admin user
  let testClient1Id: string; // Client in zone 1
  let testClient2Id: string; // Client in zone 1
  let testClient3Id: string; // Client in zone 2

  // Setup: Create app and database connections
  beforeAll(async () => {
    const connections = await setupTestConnections();
    pgPool = connections.pgPool;
    redisClient = connections.redisClient;
    schemaName = connections.schemaName;

    // Create Express app with client routes
    app = express();
    app.use('/api/v1/clients', createClientRoutes(pgPool, redisClient));
  });

  // Cleanup: Close connections
  afterAll(async () => {
    await teardownTestConnections(pgPool, redisClient, { schemaName, dropSchema: true });
  });

  // Clean database and Redis before each test
  beforeEach(async () => {
    const client = await pgPool.connect();
    try {
      await client.query('BEGIN');
      // Clear database tables in correct order
      await client.query('DELETE FROM visits');
      await client.query('DELETE FROM care_plans');
      await client.query('DELETE FROM clients');
      await client.query(
        "DELETE FROM users WHERE email LIKE '%@test.com' OR email LIKE '%@example.com'"
      );
      await client.query('DELETE FROM zones');
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

    // Clear Redis cache
    await redisClient.flushDb();

    // Create test zones
    testZoneId1 = '11111111-1111-1111-1111-111111111111';
    testZoneId2 = '22222222-2222-2222-2222-222222222222';

    await pgPool.query(
      `INSERT INTO zones (id, name, region)
       VALUES ($1, $2, $3), ($4, $5, $6)`,
      [testZoneId1, 'Zone 1', 'Region 1', testZoneId2, 'Zone 2', 'Region 2']
    );

    // Create test users with unique emails
    const timestamp = Date.now();
    const user1Result = await pgPool.query(
      `INSERT INTO users (email, password_hash, first_name, last_name, role, zone_id)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [`caregiver1-${timestamp}@test.com`, 'hash', 'Test', 'Caregiver1', 'caregiver', testZoneId1]
    );
    testUserId1 = user1Result.rows[0].id;

    const adminResult = await pgPool.query(
      `INSERT INTO users (email, password_hash, first_name, last_name, role, zone_id)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [`admin-${timestamp}@test.com`, 'hash', 'Test', 'Admin', 'admin', null]
    );
    testAdminId = adminResult.rows[0].id;

    // Create test clients
    const client1Result = await pgPool.query(
      `INSERT INTO clients (first_name, last_name, date_of_birth, address, latitude, longitude, 
                            emergency_contact_name, emergency_contact_phone, emergency_contact_relationship, zone_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING id`,
      [
        'Alice',
        'Anderson',
        '1950-01-01',
        '123 Main St',
        45.5017,
        -73.5673,
        'Bob Anderson',
        '555-0001',
        'Spouse',
        testZoneId1,
      ]
    );
    testClient1Id = client1Result.rows[0].id;

    const client2Result = await pgPool.query(
      `INSERT INTO clients (first_name, last_name, date_of_birth, address, latitude, longitude, 
                            emergency_contact_name, emergency_contact_phone, emergency_contact_relationship, zone_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING id`,
      [
        'Bob',
        'Brown',
        '1955-02-02',
        '456 Oak Ave',
        45.5018,
        -73.5674,
        'Carol Brown',
        '555-0002',
        'Daughter',
        testZoneId1,
      ]
    );
    testClient2Id = client2Result.rows[0].id;

    const client3Result = await pgPool.query(
      `INSERT INTO clients (first_name, last_name, date_of_birth, address, latitude, longitude, 
                            emergency_contact_name, emergency_contact_phone, emergency_contact_relationship, zone_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING id`,
      [
        'Charlie',
        'Chen',
        '1960-03-03',
        '789 Pine Rd',
        45.5019,
        -73.5675,
        'Diana Chen',
        '555-0003',
        'Daughter',
        testZoneId2,
      ]
    );
    testClient3Id = client3Result.rows[0].id;

    // Create care plans for clients
    await pgPool.query(
      `INSERT INTO care_plans (client_id, summary)
       VALUES ($1, $2), ($3, $4), ($5, $6)`,
      [
        testClient1Id,
        'Requires assistance with daily activities',
        testClient2Id,
        'Medication management needed',
        testClient3Id,
        'Mobility assistance required',
      ]
    );

    // Create visits for last/next visit calculations
    await pgPool.query(
      `INSERT INTO visits (
         client_id,
         staff_id,
         scheduled_start_time,
         check_in_time,
         check_out_time,
         status
       )
       VALUES ($1, $2, $3, $4, $5, 'completed')`,
      [
        testClient1Id,
        testUserId1,
        '2025-01-01T09:00:00.000Z',
        '2025-01-01T09:05:00.000Z',
        LAST_VISIT_COMPLETED_AT,
      ]
    );

    await pgPool.query(
      `INSERT INTO visits (
         client_id,
         staff_id,
         scheduled_start_time,
         status
       )
       VALUES ($1, $2, $3, 'scheduled')`,
      [testClient1Id, testUserId1, NEXT_VISIT_SCHEDULED_AT]
    );
  });

  describe('Authentication', () => {
    it('should return 401 without authentication token', async () => {
      const response = await request(app).get('/api/v1/clients').expect(401);

      expect(response.body.error).toBeDefined();
      expect(response.body.error.code).toBe('MISSING_TOKEN');
    });

    it('should return 401 with invalid token', async () => {
      const response = await request(app)
        .get('/api/v1/clients')
        .set('Authorization', 'Bearer invalid-token')
        .expect(401);

      expect(response.body.error).toBeDefined();
      expect(response.body.error.code).toBe('INVALID_TOKEN');
    });
  });

  describe('Zone-based Access Control', () => {
    it('should return only clients in caregiver zone', async () => {
      const token = generateAccessToken({
        userId: testUserId1,
        role: 'caregiver',
        zoneId: testZoneId1,
        email: 'caregiver1@test.com',
      });

      const response = await request(app)
        .get('/api/v1/clients')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(response.body.data.clients).toHaveLength(2);
      expect(response.body.data.clients.every((c: { id: string }) => c.id !== testClient3Id)).toBe(
        true
      );
    });

    it('should deny access to different zone for non-admin', async () => {
      const token = generateAccessToken({
        userId: testUserId1,
        role: 'caregiver',
        zoneId: testZoneId1,
        email: 'caregiver1@test.com',
      });

      const response = await request(app)
        .get(`/api/v1/clients?zoneId=${testZoneId2}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(403);

      expect(response.body.error.code).toBe('AUTH_ZONE_ACCESS_DENIED');
    });

    it('should allow admin to access all zones', async () => {
      const token = generateAccessToken({
        userId: testAdminId,
        role: 'admin',
        zoneId: '',
        email: 'admin@test.com',
      });

      const response = await request(app)
        .get('/api/v1/clients')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(response.body.data.clients).toHaveLength(3);
    });

    it('should allow admin to filter by specific zone', async () => {
      const token = generateAccessToken({
        userId: testAdminId,
        role: 'admin',
        zoneId: '',
        email: 'admin@test.com',
      });

      const response = await request(app)
        .get(`/api/v1/clients?zoneId=${testZoneId1}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(response.body.data.clients).toHaveLength(2);
    });
  });

  describe('Pagination', () => {
    it('should return default pagination (page 1, limit 50)', async () => {
      const token = generateAccessToken({
        userId: testAdminId,
        role: 'admin',
        zoneId: '',
        email: 'admin@test.com',
      });

      const response = await request(app)
        .get('/api/v1/clients')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(response.body.data.pagination).toEqual({
        page: 1,
        limit: 50,
        total: 3,
        totalPages: 1,
      });
    });

    it('should respect custom page and limit', async () => {
      const token = generateAccessToken({
        userId: testAdminId,
        role: 'admin',
        zoneId: '',
        email: 'admin@test.com',
      });

      const response = await request(app)
        .get('/api/v1/clients?page=1&limit=2')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(response.body.data.clients).toHaveLength(2);
      expect(response.body.data.pagination).toEqual({
        page: 1,
        limit: 2,
        total: 3,
        totalPages: 2,
      });
    });

    it('should enforce max limit of 100', async () => {
      const token = generateAccessToken({
        userId: testAdminId,
        role: 'admin',
        zoneId: '',
        email: 'admin@test.com',
      });

      const response = await request(app)
        .get('/api/v1/clients?limit=200')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(response.body.data.pagination.limit).toBe(100);
    });

    it('should handle page 2 correctly', async () => {
      const token = generateAccessToken({
        userId: testAdminId,
        role: 'admin',
        zoneId: '',
        email: 'admin@test.com',
      });

      const response = await request(app)
        .get('/api/v1/clients?page=2&limit=2')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(response.body.data.clients).toHaveLength(1);
      expect(response.body.data.pagination.page).toBe(2);
    });
  });

  describe('Search', () => {
    it('should search by first name', async () => {
      const token = generateAccessToken({
        userId: testAdminId,
        role: 'admin',
        zoneId: '',
        email: 'admin@test.com',
      });

      const response = await request(app)
        .get('/api/v1/clients?search=Alice')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(response.body.data.clients).toHaveLength(1);
      expect(response.body.data.clients[0].firstName).toBe('Alice');
    });

    it('should search by last name', async () => {
      const token = generateAccessToken({
        userId: testAdminId,
        role: 'admin',
        zoneId: '',
        email: 'admin@test.com',
      });

      const response = await request(app)
        .get('/api/v1/clients?search=Brown')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(response.body.data.clients).toHaveLength(1);
      expect(response.body.data.clients[0].lastName).toBe('Brown');
    });

    it('should be case-insensitive', async () => {
      const token = generateAccessToken({
        userId: testAdminId,
        role: 'admin',
        zoneId: '',
        email: 'admin@test.com',
      });

      const response = await request(app)
        .get('/api/v1/clients?search=alice')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(response.body.data.clients).toHaveLength(1);
      expect(response.body.data.clients[0].firstName).toBe('Alice');
    });

    it('should return empty array for no matches', async () => {
      const token = generateAccessToken({
        userId: testAdminId,
        role: 'admin',
        zoneId: '',
        email: 'admin@test.com',
      });

      const response = await request(app)
        .get('/api/v1/clients?search=NonExistent')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(response.body.data.clients).toHaveLength(0);
      expect(response.body.data.pagination.total).toBe(0);
    });
  });

  describe('Response Format', () => {
    it('should return correct client data structure', async () => {
      const token = generateAccessToken({
        userId: testUserId1,
        role: 'caregiver',
        zoneId: testZoneId1,
        email: 'caregiver1@test.com',
      });

      const response = await request(app)
        .get('/api/v1/clients')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const client = response.body.data.clients[0];
      expect(client).toHaveProperty('id');
      expect(client).toHaveProperty('firstName');
      expect(client).toHaveProperty('lastName');
      expect(client).toHaveProperty('dateOfBirth');
      expect(client).toHaveProperty('address');
      expect(client).toHaveProperty('latitude');
      expect(client).toHaveProperty('longitude');
      expect(client).toHaveProperty('carePlanSummary');
      expect(client).toHaveProperty('lastVisitDate');
      expect(client).toHaveProperty('nextScheduledVisit');
    });

    it('should include care plan summary', async () => {
      const token = generateAccessToken({
        userId: testUserId1,
        role: 'caregiver',
        zoneId: testZoneId1,
        email: 'caregiver1@test.com',
      });

      const response = await request(app)
        .get('/api/v1/clients')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const aliceClient = response.body.data.clients.find(
        (c: { firstName: string }) => c.firstName === 'Alice'
      );
      expect(aliceClient.carePlanSummary).toBe('Requires assistance with daily activities');
    });

    it('should include last visit and next scheduled visit when available', async () => {
      const token = generateAccessToken({
        userId: testUserId1,
        role: 'caregiver',
        zoneId: testZoneId1,
        email: 'caregiver1@test.com',
      });

      const response = await request(app)
        .get('/api/v1/clients')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const aliceClient = response.body.data.clients.find(
        (c: { firstName: string }) => c.firstName === 'Alice'
      );

      expect(aliceClient.lastVisitDate).toBe(LAST_VISIT_COMPLETED_AT);
      expect(aliceClient.nextScheduledVisit).toBe(NEXT_VISIT_SCHEDULED_AT);
    });

    it('should sort by last name then first name', async () => {
      const token = generateAccessToken({
        userId: testAdminId,
        role: 'admin',
        zoneId: '',
        email: 'admin@test.com',
      });

      const response = await request(app)
        .get('/api/v1/clients')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const lastNames = response.body.data.clients.map((c: { lastName: string }) => c.lastName);
      expect(lastNames).toEqual(['Anderson', 'Brown', 'Chen']);
    });
  });

  describe('Redis Caching', () => {
    it('should cache results', async () => {
      const token = generateAccessToken({
        userId: testUserId1,
        role: 'caregiver',
        zoneId: testZoneId1,
        email: 'caregiver1@test.com',
      });

      // First request - should hit database
      const response1 = await request(app)
        .get('/api/v1/clients')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(response1.body.meta?.cached).toBeUndefined();

      // Second request - should hit cache
      const response2 = await request(app)
        .get('/api/v1/clients')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(response2.body.meta?.cached).toBe(true);
      expect(response2.body.data).toEqual(response1.body.data);
    });

    it('should have different cache keys for different queries', async () => {
      const token = generateAccessToken({
        userId: testAdminId,
        role: 'admin',
        zoneId: '',
        email: 'admin@test.com',
      });

      // Request with no filters
      const response1 = await request(app)
        .get('/api/v1/clients')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      // Request with zone filter
      const response2 = await request(app)
        .get(`/api/v1/clients?zoneId=${testZoneId1}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(response1.body.data.clients).toHaveLength(3);
      expect(response2.body.data.clients).toHaveLength(2);
    });
  });
});
