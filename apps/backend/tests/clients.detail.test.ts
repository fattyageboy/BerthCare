/**
 * Integration Tests: GET /api/v1/clients/:clientId
 *
 * Tests the client detail endpoint according to specifications:
 * - Returns full client details with care plan
 * - Includes emergency contact information
 * - Includes recent visits (last 10)
 * - Requires authentication
 * - Enforces zone-based access control
 * - Returns 404 for non-existent clients
 * - Returns 403 for unauthorized zone access
 * - Redis caching works (15 min TTL)
 *
 * Reference: Task C4 - Implement GET /api/v1/clients/:clientId endpoint
 * Architecture: project-documentation/architecture-output.md
 *
 * Test Strategy:
 * - Use real PostgreSQL and Redis connections
 * - Create test users, clients, and care plans
 * - Test happy path and error scenarios
 * - Verify zone-based access control
 * - Test caching behavior
 * - Validate response structure
 */

import express, { json } from 'express';
import type { Application } from 'express';
import { Pool } from 'pg';
import { createClient } from 'redis';
import request from 'supertest';

import { generateAccessToken } from '../../../libs/shared/src/jwt-utils';
import { createClientRoutes } from '../src/routes/clients.routes';

// Test configuration
const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ||
  'postgresql://berthcare:berthcare_dev_password@localhost:5432/berthcare_test';
const TEST_REDIS_URL =
  process.env.TEST_REDIS_URL || 'redis://:berthcare_redis_password@localhost:6379/1';

describe('GET /api/v1/clients/:clientId', () => {
  let app: Application;
  let pgPool: Pool;
  let redisClient: ReturnType<typeof createClient>;

  // Test data
  let testZoneId1: string;
  let testZoneId2: string;
  let testUserId1: string; // Caregiver in zone 1
  let testAdminId: string; // Admin user
  let testClient1Id: string; // Client in zone 1 with care plan
  let testClient2Id: string; // Client in zone 2

  // Setup: Create app and database connections
  beforeAll(async () => {
    // Create PostgreSQL connection
    pgPool = new Pool({
      connectionString: TEST_DATABASE_URL,
      max: 5,
    });

    // Create Redis connection
    redisClient = createClient({
      url: TEST_REDIS_URL,
    });
    await redisClient.connect();

    // Create Express app with client routes
    app = express();
    app.use(json());
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    app.use('/api/v1/clients', createClientRoutes(pgPool, redisClient as any));

    // Ensure test database has required tables
    await pgPool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        email VARCHAR(255) NOT NULL UNIQUE,
        password_hash VARCHAR(255) NOT NULL,
        first_name VARCHAR(100) NOT NULL,
        last_name VARCHAR(100) NOT NULL,
        role VARCHAR(20) NOT NULL CHECK (role IN ('caregiver', 'coordinator', 'admin')),
        zone_id UUID,
        is_active BOOLEAN NOT NULL DEFAULT true,
        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
        deleted_at TIMESTAMP WITH TIME ZONE
      );

      CREATE TABLE IF NOT EXISTS clients (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        first_name VARCHAR(100) NOT NULL,
        last_name VARCHAR(100) NOT NULL,
        date_of_birth DATE NOT NULL,
        address TEXT NOT NULL,
        latitude DECIMAL(10,8) NOT NULL,
        longitude DECIMAL(11,8) NOT NULL,
        phone VARCHAR(20),
        emergency_contact_name VARCHAR(200) NOT NULL,
        emergency_contact_phone VARCHAR(20) NOT NULL,
        emergency_contact_relationship VARCHAR(100) NOT NULL,
        zone_id UUID NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
        deleted_at TIMESTAMP WITH TIME ZONE
      );

      CREATE TABLE IF NOT EXISTS care_plans (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
        summary TEXT NOT NULL,
        medications JSONB NOT NULL DEFAULT '[]'::jsonb,
        allergies JSONB NOT NULL DEFAULT '[]'::jsonb,
        special_instructions TEXT,
        version INTEGER NOT NULL DEFAULT 1,
        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
        deleted_at TIMESTAMP WITH TIME ZONE
      );
    `);
  });

  // Cleanup: Close connections
  afterAll(async () => {
    await pgPool.end();
    await redisClient.quit();
  });

  // Clean database and Redis before each test
  beforeEach(async () => {
    const client = await pgPool.connect();
    try {
      await client.query('BEGIN');
      // Clear database tables in correct order
      await client.query('DELETE FROM care_plans');
      await client.query('DELETE FROM clients');
      await client.query(
        "DELETE FROM users WHERE email LIKE '%@test.com' OR email LIKE '%@example.com'"
      );
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
      `INSERT INTO clients (first_name, last_name, date_of_birth, address, latitude, longitude, phone,
                            emergency_contact_name, emergency_contact_phone, emergency_contact_relationship, zone_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING id`,
      [
        'Alice',
        'Anderson',
        '1950-01-01',
        '123 Main St',
        45.5017,
        -73.5673,
        '555-1234',
        'Bob Anderson',
        '555-0001',
        'Spouse',
        testZoneId1,
      ]
    );
    testClient1Id = client1Result.rows[0].id;

    const client2Result = await pgPool.query(
      `INSERT INTO clients (first_name, last_name, date_of_birth, address, latitude, longitude, phone,
                            emergency_contact_name, emergency_contact_phone, emergency_contact_relationship, zone_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING id`,
      [
        'Charlie',
        'Chen',
        '1960-03-03',
        '789 Pine Rd',
        45.5019,
        -73.5675,
        '555-5678',
        'Diana Chen',
        '555-0003',
        'Daughter',
        testZoneId2,
      ]
    );
    testClient2Id = client2Result.rows[0].id;

    // Create care plan for client 1
    await pgPool.query(
      `INSERT INTO care_plans (client_id, summary, medications, allergies, special_instructions)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        testClient1Id,
        'Requires assistance with daily activities',
        JSON.stringify([
          { name: 'Aspirin', dosage: '81mg', frequency: 'Daily' },
          { name: 'Metformin', dosage: '500mg', frequency: 'Twice daily' },
        ]),
        JSON.stringify(['Penicillin', 'Latex']),
        'Client prefers morning visits',
      ]
    );
  });

  describe('Authentication', () => {
    it('should return 401 without authentication token', async () => {
      const response = await request(app).get(`/api/v1/clients/${testClient1Id}`).expect(401);

      expect(response.body.error).toBeDefined();
      expect(response.body.error.code).toBe('MISSING_TOKEN');
    });

    it('should return 401 with invalid token', async () => {
      const response = await request(app)
        .get(`/api/v1/clients/${testClient1Id}`)
        .set('Authorization', 'Bearer invalid-token')
        .expect(401);

      expect(response.body.error).toBeDefined();
      expect(response.body.error.code).toBe('INVALID_TOKEN');
    });
  });

  describe('Client ID Validation', () => {
    it('should return 400 for invalid UUID format', async () => {
      const token = generateAccessToken({
        userId: testUserId1,
        role: 'caregiver',
        zoneId: testZoneId1,
        email: 'caregiver1@test.com',
      });

      const response = await request(app)
        .get('/api/v1/clients/invalid-uuid')
        .set('Authorization', `Bearer ${token}`)
        .expect(400);

      expect(response.body.error.code).toBe('INVALID_CLIENT_ID');
    });

    it('should return 404 for non-existent client', async () => {
      const token = generateAccessToken({
        userId: testUserId1,
        role: 'caregiver',
        zoneId: testZoneId1,
        email: 'caregiver1@test.com',
      });

      const nonExistentId = '99999999-9999-9999-9999-999999999999';
      const response = await request(app)
        .get(`/api/v1/clients/${nonExistentId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(404);

      expect(response.body.error.code).toBe('CLIENT_NOT_FOUND');
    });
  });

  describe('Zone-based Access Control', () => {
    it('should allow caregiver to access client in their zone', async () => {
      const token = generateAccessToken({
        userId: testUserId1,
        role: 'caregiver',
        zoneId: testZoneId1,
        email: 'caregiver1@test.com',
      });

      const response = await request(app)
        .get(`/api/v1/clients/${testClient1Id}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(response.body.data.id).toBe(testClient1Id);
      expect(response.body.data.firstName).toBe('Alice');
    });

    it('should deny caregiver access to client in different zone', async () => {
      const token = generateAccessToken({
        userId: testUserId1,
        role: 'caregiver',
        zoneId: testZoneId1,
        email: 'caregiver1@test.com',
      });

      const response = await request(app)
        .get(`/api/v1/clients/${testClient2Id}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(403);

      expect(response.body.error.code).toBe('FORBIDDEN');
    });

    it('should allow admin to access any client', async () => {
      const token = generateAccessToken({
        userId: testAdminId,
        role: 'admin',
        zoneId: '',
        email: 'admin@test.com',
      });

      const response1 = await request(app)
        .get(`/api/v1/clients/${testClient1Id}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(response1.body.data.id).toBe(testClient1Id);

      const response2 = await request(app)
        .get(`/api/v1/clients/${testClient2Id}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(response2.body.data.id).toBe(testClient2Id);
    });
  });

  describe('Response Format', () => {
    it('should return complete client data structure', async () => {
      const token = generateAccessToken({
        userId: testUserId1,
        role: 'caregiver',
        zoneId: testZoneId1,
        email: 'caregiver1@test.com',
      });

      const response = await request(app)
        .get(`/api/v1/clients/${testClient1Id}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const client = response.body.data;

      // Basic client info
      expect(client).toHaveProperty('id');
      expect(client).toHaveProperty('firstName');
      expect(client).toHaveProperty('lastName');
      expect(client).toHaveProperty('dateOfBirth');
      expect(client).toHaveProperty('address');
      expect(client).toHaveProperty('latitude');
      expect(client).toHaveProperty('longitude');
      expect(client).toHaveProperty('phone');

      // Emergency contact
      expect(client).toHaveProperty('emergencyContact');
      expect(client.emergencyContact).toHaveProperty('name');
      expect(client.emergencyContact).toHaveProperty('phone');
      expect(client.emergencyContact).toHaveProperty('relationship');

      // Care plan
      expect(client).toHaveProperty('carePlan');
      expect(client.carePlan).toHaveProperty('summary');
      expect(client.carePlan).toHaveProperty('medications');
      expect(client.carePlan).toHaveProperty('allergies');
      expect(client.carePlan).toHaveProperty('specialInstructions');

      // Recent visits
      expect(client).toHaveProperty('recentVisits');
      expect(Array.isArray(client.recentVisits)).toBe(true);
    });

    it('should include correct client details', async () => {
      const token = generateAccessToken({
        userId: testUserId1,
        role: 'caregiver',
        zoneId: testZoneId1,
        email: 'caregiver1@test.com',
      });

      const response = await request(app)
        .get(`/api/v1/clients/${testClient1Id}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const client = response.body.data;

      expect(client.firstName).toBe('Alice');
      expect(client.lastName).toBe('Anderson');
      expect(client.dateOfBirth).toBe('1950-01-01');
      expect(client.address).toBe('123 Main St');
      expect(client.phone).toBe('555-1234');
    });

    it('should include emergency contact information', async () => {
      const token = generateAccessToken({
        userId: testUserId1,
        role: 'caregiver',
        zoneId: testZoneId1,
        email: 'caregiver1@test.com',
      });

      const response = await request(app)
        .get(`/api/v1/clients/${testClient1Id}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const { emergencyContact } = response.body.data;

      expect(emergencyContact.name).toBe('Bob Anderson');
      expect(emergencyContact.phone).toBe('555-0001');
      expect(emergencyContact.relationship).toBe('Spouse');
    });

    it('should include care plan with medications and allergies', async () => {
      const token = generateAccessToken({
        userId: testUserId1,
        role: 'caregiver',
        zoneId: testZoneId1,
        email: 'caregiver1@test.com',
      });

      const response = await request(app)
        .get(`/api/v1/clients/${testClient1Id}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const { carePlan } = response.body.data;

      expect(carePlan.summary).toBe('Requires assistance with daily activities');
      expect(carePlan.medications).toHaveLength(2);
      expect(carePlan.medications[0]).toEqual({
        name: 'Aspirin',
        dosage: '81mg',
        frequency: 'Daily',
      });
      expect(carePlan.allergies).toEqual(['Penicillin', 'Latex']);
      expect(carePlan.specialInstructions).toBe('Client prefers morning visits');
    });

    it('should return empty care plan for client without care plan', async () => {
      const token = generateAccessToken({
        userId: testAdminId,
        role: 'admin',
        zoneId: '',
        email: 'admin@test.com',
      });

      const response = await request(app)
        .get(`/api/v1/clients/${testClient2Id}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const { carePlan } = response.body.data;

      expect(carePlan.summary).toBe('');
      expect(carePlan.medications).toEqual([]);
      expect(carePlan.allergies).toEqual([]);
      expect(carePlan.specialInstructions).toBe('');
    });

    it('should return empty recent visits array', async () => {
      const token = generateAccessToken({
        userId: testUserId1,
        role: 'caregiver',
        zoneId: testZoneId1,
        email: 'caregiver1@test.com',
      });

      const response = await request(app)
        .get(`/api/v1/clients/${testClient1Id}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(response.body.data.recentVisits).toEqual([]);
    });
  });

  describe('Redis Caching', () => {
    it('should cache client details', async () => {
      const token = generateAccessToken({
        userId: testUserId1,
        role: 'caregiver',
        zoneId: testZoneId1,
        email: 'caregiver1@test.com',
      });

      // First request - should hit database
      const response1 = await request(app)
        .get(`/api/v1/clients/${testClient1Id}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(response1.body.meta?.cached).toBeUndefined();

      // Second request - should hit cache
      const response2 = await request(app)
        .get(`/api/v1/clients/${testClient1Id}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(response2.body.meta?.cached).toBe(true);
      expect(response2.body.data).toEqual(response1.body.data);
    });

    it('should have different cache keys for different clients', async () => {
      const token = generateAccessToken({
        userId: testAdminId,
        role: 'admin',
        zoneId: '',
        email: 'admin@test.com',
      });

      // Request client 1
      const response1 = await request(app)
        .get(`/api/v1/clients/${testClient1Id}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      // Request client 2
      const response2 = await request(app)
        .get(`/api/v1/clients/${testClient2Id}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(response1.body.data.id).toBe(testClient1Id);
      expect(response2.body.data.id).toBe(testClient2Id);
      expect(response1.body.data.firstName).not.toBe(response2.body.data.firstName);
    });

    it('should enforce zone access control on cached data', async () => {
      const adminToken = generateAccessToken({
        userId: testAdminId,
        role: 'admin',
        zoneId: '',
        email: 'admin@test.com',
      });

      const caregiverToken = generateAccessToken({
        userId: testUserId1,
        role: 'caregiver',
        zoneId: testZoneId1,
        email: 'caregiver1@test.com',
      });

      // Admin caches client 2 (zone 2)
      await request(app)
        .get(`/api/v1/clients/${testClient2Id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      // Caregiver in zone 1 tries to access cached client 2
      const response = await request(app)
        .get(`/api/v1/clients/${testClient2Id}`)
        .set('Authorization', `Bearer ${caregiverToken}`)
        .expect(403);

      expect(response.body.error.code).toBe('FORBIDDEN');
    });
  });
});
