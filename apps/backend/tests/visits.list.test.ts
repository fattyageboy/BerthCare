/**
 * Integration Tests: GET /v1/visits
 *
 * Tests the visits list endpoint with filtering, pagination, and caching
 *
 * Reference: Architecture Blueprint - Visit Documentation Endpoints
 * Task: V6 - Implement GET /v1/visits endpoint
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

describe('GET /api/v1/visits', () => {
  let pgPool: Pool;
  let redisClient: RedisClient;
  let app: Express;
  let schemaName: string;

  // Test users
  let caregiverId: string;
  let caregiver2Id: string;
  let coordinatorId: string;
  let adminId: string;
  let zoneId: string;
  let zone2Id: string;

  // Test clients
  let client1Id: string;
  let client2Id: string;
  let client3Id: string;

  // Test visits (IDs not needed for assertions)

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
    adminId = crypto.randomUUID();

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

    await pgPool.query(
      `INSERT INTO users (id, email, password_hash, first_name, last_name, role, zone_id, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())`,
      [adminId, generateTestEmail('admin'), 'hash', 'Admin', 'User', 'admin', zoneId]
    );

    // Create test clients
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

    client2Id = await createTestClient(pgPool, {
      firstName: 'Bob',
      lastName: 'Smith',
      dateOfBirth: '1945-05-20',
      address: '456 Oak Ave',
      latitude: 43.6532,
      longitude: -79.3832,
      zoneId,
      emergencyContactName: 'Mary Smith',
      emergencyContactPhone: '555-0002',
      emergencyContactRelationship: 'Daughter',
    });

    client3Id = await createTestClient(pgPool, {
      firstName: 'Carol',
      lastName: 'Williams',
      dateOfBirth: '1955-08-10',
      address: '789 Pine Rd',
      latitude: 43.6532,
      longitude: -79.3832,
      zoneId: zone2Id,
      emergencyContactName: 'David Williams',
      emergencyContactPhone: '555-0003',
      emergencyContactRelationship: 'Son',
    });

    // Create test visits
    const now = new Date();
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);

    await createTestVisit(pgPool, {
      clientId: client1Id,
      staffId: caregiverId,
      scheduledStartTime: yesterday.toISOString(),
      checkInTime: yesterday.toISOString(),
      checkOutTime: new Date(yesterday.getTime() + 60 * 60 * 1000).toISOString(),
      status: 'completed',
      durationMinutes: 60,
    });

    await createTestVisit(pgPool, {
      clientId: client2Id,
      staffId: caregiverId,
      scheduledStartTime: now.toISOString(),
      checkInTime: now.toISOString(),
      status: 'in_progress',
    });

    await createTestVisit(pgPool, {
      clientId: client1Id,
      staffId: caregiverId,
      scheduledStartTime: tomorrow.toISOString(),
      status: 'scheduled',
    });

    await createTestVisit(pgPool, {
      clientId: client3Id,
      staffId: caregiver2Id,
      scheduledStartTime: now.toISOString(),
      checkInTime: now.toISOString(),
      status: 'in_progress',
    });
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
      const response = await request(app).get('/api/v1/visits');

      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe('MISSING_TOKEN');
    });

    it('should return 401 with invalid token', async () => {
      const response = await request(app)
        .get('/api/v1/visits')
        .set('Authorization', 'Bearer invalid-token');

      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe('INVALID_TOKEN');
    });
  });

  describe('Authorization', () => {
    it('should return only caregiver own visits', async () => {
      const token = generateAccessToken({ userId: caregiverId, role: 'caregiver', zoneId });

      const response = await request(app)
        .get('/api/v1/visits')
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body.data.visits).toHaveLength(3);
      expect(
        response.body.data.visits.every((v: { staffId: string }) => v.staffId === caregiverId)
      ).toBe(true);
    });

    it('should return all zone visits for coordinator', async () => {
      const token = generateAccessToken({ userId: coordinatorId, role: 'coordinator', zoneId });

      const response = await request(app)
        .get('/api/v1/visits')
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body.data.visits).toHaveLength(3);
      // Should see all visits in zone 1 (caregiver's visits)
      expect(
        response.body.data.visits.every((v: { staffId: string }) => v.staffId === caregiverId)
      ).toBe(true);
    });

    it('should return all zone visits for admin', async () => {
      const token = generateAccessToken({ userId: adminId, role: 'admin', zoneId });

      const response = await request(app)
        .get('/api/v1/visits')
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body.data.visits).toHaveLength(3);
      // Should see all visits in zone 1
      expect(
        response.body.data.visits.every((v: { staffId: string }) => v.staffId === caregiverId)
      ).toBe(true);
    });
  });

  describe('Filtering', () => {
    it('should filter by staffId', async () => {
      const token = generateAccessToken({ userId: coordinatorId, role: 'coordinator', zoneId });

      const response = await request(app)
        .get(`/api/v1/visits?staffId=${caregiverId}`)
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body.data.visits).toHaveLength(3);
      expect(
        response.body.data.visits.every((v: { staffId: string }) => v.staffId === caregiverId)
      ).toBe(true);
    });

    it('should filter by clientId', async () => {
      const token = generateAccessToken({ userId: caregiverId, role: 'caregiver', zoneId });

      const response = await request(app)
        .get(`/api/v1/visits?clientId=${client1Id}`)
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body.data.visits).toHaveLength(2);
      expect(
        response.body.data.visits.every((v: { clientId: string }) => v.clientId === client1Id)
      ).toBe(true);
    });

    it('should filter by status', async () => {
      const token = generateAccessToken({ userId: caregiverId, role: 'caregiver', zoneId });

      const response = await request(app)
        .get('/api/v1/visits?status=completed')
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body.data.visits).toHaveLength(1);
      expect(response.body.data.visits[0].status).toBe('completed');
    });

    it('should filter by date range', async () => {
      const token = generateAccessToken({ userId: caregiverId, role: 'caregiver', zoneId });
      const now = new Date();
      const startDate = new Date(now.getTime() - 12 * 60 * 60 * 1000).toISOString();
      const endDate = new Date(now.getTime() + 12 * 60 * 60 * 1000).toISOString();

      const response = await request(app)
        .get(`/api/v1/visits?startDate=${startDate}&endDate=${endDate}`)
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(200);
      // Caregiver should see only their own visit within the date range (today's visit)
      // Yesterday's completed visit and tomorrow's scheduled visit should be excluded
      expect(response.body.data.visits).toHaveLength(1);
      expect(response.body.data.visits[0].status).toBe('in_progress');
    });

    it('should return 400 for invalid staffId format', async () => {
      const token = generateAccessToken({ userId: caregiverId, role: 'caregiver', zoneId });

      const response = await request(app)
        .get('/api/v1/visits?staffId=invalid-uuid')
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('Invalid staffId format');
    });

    it('should return 400 for invalid status', async () => {
      const token = generateAccessToken({ userId: caregiverId, role: 'caregiver', zoneId });

      const response = await request(app)
        .get('/api/v1/visits?status=invalid-status')
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('Invalid status');
    });

    it('should return 400 for invalid clientId format', async () => {
      const token = generateAccessToken({ userId: caregiverId, role: 'caregiver', zoneId });

      const response = await request(app)
        .get('/api/v1/visits?clientId=invalid-uuid')
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('Invalid clientId format');
    });

    it('should return 400 for invalid startDate format', async () => {
      const token = generateAccessToken({ userId: caregiverId, role: 'caregiver', zoneId });

      const response = await request(app)
        .get('/api/v1/visits?startDate=invalid-date')
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('Invalid startDate format');
    });

    it('should return 400 for invalid endDate format', async () => {
      const token = generateAccessToken({ userId: caregiverId, role: 'caregiver', zoneId });

      const response = await request(app)
        .get('/api/v1/visits?endDate=invalid-date')
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('Invalid endDate format');
    });
  });

  describe('Pagination', () => {
    it('should use default pagination', async () => {
      const token = generateAccessToken({ userId: caregiverId, role: 'caregiver', zoneId });

      const response = await request(app)
        .get('/api/v1/visits')
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body.data.pagination).toEqual({
        page: 1,
        limit: 50,
        total: 3,
        totalPages: 1,
      });
    });

    it('should respect custom page and limit', async () => {
      const token = generateAccessToken({ userId: caregiverId, role: 'caregiver', zoneId });

      const response = await request(app)
        .get('/api/v1/visits?page=1&limit=2')
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body.data.visits).toHaveLength(2);
      expect(response.body.data.pagination).toEqual({
        page: 1,
        limit: 2,
        total: 3,
        totalPages: 2,
      });
    });

    it('should enforce max limit of 100', async () => {
      const token = generateAccessToken({ userId: caregiverId, role: 'caregiver', zoneId });

      const response = await request(app)
        .get('/api/v1/visits?limit=200')
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body.data.pagination.limit).toBe(100);
    });

    it('should return page 2 results', async () => {
      const token = generateAccessToken({ userId: caregiverId, role: 'caregiver', zoneId });

      const response = await request(app)
        .get('/api/v1/visits?page=2&limit=2')
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body.data.visits).toHaveLength(1);
      expect(response.body.data.pagination.page).toBe(2);
    });
  });

  describe('Response Format', () => {
    it('should return correct data structure', async () => {
      const token = generateAccessToken({ userId: caregiverId, role: 'caregiver', zoneId });

      const response = await request(app)
        .get('/api/v1/visits')
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body.data).toHaveProperty('visits');
      expect(response.body.data).toHaveProperty('pagination');
      expect(Array.isArray(response.body.data.visits)).toBe(true);
    });

    it('should include client name in visit summary', async () => {
      const token = generateAccessToken({ userId: caregiverId, role: 'caregiver', zoneId });

      const response = await request(app)
        .get('/api/v1/visits')
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body.data.visits[0]).toHaveProperty('clientName');
      expect(response.body.data.visits[0].clientName).toMatch(/Alice Johnson|Bob Smith/);
    });

    it('should include staff name in visit summary', async () => {
      const token = generateAccessToken({ userId: caregiverId, role: 'caregiver', zoneId });

      const response = await request(app)
        .get('/api/v1/visits')
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body.data.visits[0]).toHaveProperty('staffName');
      expect(response.body.data.visits[0].staffName).toBe('John Caregiver');
    });

    it('should sort by scheduled_start_time DESC', async () => {
      const token = generateAccessToken({ userId: caregiverId, role: 'caregiver', zoneId });

      const response = await request(app)
        .get('/api/v1/visits')
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(200);
      const visits = response.body.data.visits;
      expect(visits).toHaveLength(3);

      // Should be sorted newest first
      for (let i = 0; i < visits.length - 1; i++) {
        const current = new Date(visits[i].scheduledStartTime);
        const next = new Date(visits[i + 1].scheduledStartTime);
        expect(current.getTime()).toBeGreaterThanOrEqual(next.getTime());
      }
    });
  });

  describe('Caching', () => {
    it('should cache results', async () => {
      const token = generateAccessToken({ userId: caregiverId, role: 'caregiver', zoneId });

      // First request - cache miss
      const response1 = await request(app)
        .get('/api/v1/visits')
        .set('Authorization', `Bearer ${token}`);

      expect(response1.status).toBe(200);
      expect(response1.body.meta?.cached).toBeUndefined();

      // Second request - cache hit
      const response2 = await request(app)
        .get('/api/v1/visits')
        .set('Authorization', `Bearer ${token}`);

      expect(response2.status).toBe(200);
      expect(response2.body.meta?.cached).toBe(true);
    });

    it('should use different cache keys for different filters', async () => {
      const token = generateAccessToken({ userId: caregiverId, role: 'caregiver', zoneId });

      // Request with status filter
      const response1 = await request(app)
        .get('/api/v1/visits?status=completed')
        .set('Authorization', `Bearer ${token}`);

      expect(response1.status).toBe(200);
      expect(response1.body.data.visits).toHaveLength(1);

      // Request without filter - should not use cached result
      const response2 = await request(app)
        .get('/api/v1/visits')
        .set('Authorization', `Bearer ${token}`);

      expect(response2.status).toBe(200);
      expect(response2.body.data.visits).toHaveLength(3);
      expect(response2.body.meta?.cached).toBeUndefined();
    });
  });
});
