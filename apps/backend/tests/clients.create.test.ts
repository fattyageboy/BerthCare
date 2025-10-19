/**
 * Integration Tests: POST /api/v1/clients - Create Client
 *
 * Tests client creation endpoint with geocoding and zone assignment.
 *
 * Test Coverage:
 * - ✅ Create client successfully (admin user)
 * - ✅ Reject non-admin user (403)
 * - ✅ Reject missing required fields (400)
 * - ✅ Reject invalid date format (400)
 * - ✅ Handle geocoding failure gracefully (400)
 * - ✅ Detect duplicate client (409)
 * - ✅ Create default care plan
 * - ✅ Assign zone based on location
 * - ✅ Allow manual zone override (admin)
 *
 * Reference: docs/C5-create-client-endpoint.md
 */

import { Express } from 'express';
import { Pool } from 'pg';
import request from 'supertest';

import { generateAccessToken } from '@berthcare/shared';

import { RedisClient } from '../src/cache/redis-client';

import {
  cleanupTestData,
  createTestApp,
  setupTestConnections,
  teardownTestConnections,
} from './test-helpers';

// Mock the geocoding service
jest.mock('../src/services/geocoding.service', () => {
  const GeocodingError = class GeocodingError extends Error {
    constructor(
      message: string,
      public code: string,
      public details?: unknown
    ) {
      super(message);
      this.name = 'GeocodingError';
    }
  };

  return {
    GeocodingService: jest.fn().mockImplementation(() => {
      return {
        geocodeAddress: jest.fn().mockImplementation((address: string) => {
          // Simulate geocoding failure for invalid addresses
          if (address.includes('Invalid Address') || address.includes('Does Not Exist')) {
            throw new GeocodingError('Address not found', 'ADDRESS_NOT_FOUND', { address });
          }

          if (address.includes('Config Missing')) {
            throw new GeocodingError('Google Maps API key not configured', 'CONFIGURATION_ERROR');
          }

          // Return successful geocoding for valid addresses
          return Promise.resolve({
            latitude: 43.6532,
            longitude: -79.3832,
            formattedAddress: '100 Queen St W, Toronto, ON M5H 2N2, Canada',
            placeId: 'ChIJqaYlDxQ1K4gRu-FRu_v_BLg',
          });
        }),
        validateCoordinates: jest.fn().mockReturnValue(true),
        clearCache: jest.fn().mockResolvedValue(undefined),
      };
    }),
    GeocodingError,
  };
});

describe('POST /api/v1/clients - Create Client', () => {
  let app: Express;
  let pgPool: Pool;
  let redisClient: RedisClient;
  let schemaName: string;
  let adminToken: string;
  let caregiverToken: string;
  let testClientIds: string[] = [];
  const defaultZones = [
    {
      id: '00000000-0000-0000-0000-000000000001',
      name: 'North Zone',
      region: 'Quebec',
      latitude: 45.5017,
      longitude: -73.5673,
    },
    {
      id: '00000000-0000-0000-0000-000000000002',
      name: 'South Zone',
      region: 'Ontario',
      latitude: 43.6532,
      longitude: -79.3832,
    },
    {
      id: '00000000-0000-0000-0000-000000000003',
      name: 'West Zone',
      region: 'British Columbia',
      latitude: 49.2827,
      longitude: -123.1207,
    },
  ];

  // Test user IDs
  const adminUserId = '00000000-0000-0000-0000-000000000001';
  const caregiverUserId = '00000000-0000-0000-0000-000000000002';
  const testZoneId = '00000000-0000-0000-0000-000000000001';

  beforeAll(async () => {
    // Setup connections
    const connections = await setupTestConnections();
    pgPool = connections.pgPool;
    redisClient = connections.redisClient;
    schemaName = connections.schemaName;

    // Create app
    app = createTestApp(pgPool, redisClient);

    // Generate test tokens
    adminToken = generateAccessToken({
      userId: adminUserId,
      email: 'admin@test.com',
      role: 'admin',
      zoneId: testZoneId,
    });

    caregiverToken = generateAccessToken({
      userId: caregiverUserId,
      email: 'caregiver@test.com',
      role: 'caregiver',
      zoneId: testZoneId,
    });

    // Ensure required zones exist for zone assignment tests
    for (const zone of defaultZones) {
      await pgPool.query(
        `INSERT INTO zones (id, name, region, center_latitude, center_longitude, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
         ON CONFLICT (id)
         DO UPDATE SET
           name = EXCLUDED.name,
           region = EXCLUDED.region,
           center_latitude = EXCLUDED.center_latitude,
           center_longitude = EXCLUDED.center_longitude,
           deleted_at = NULL,
           updated_at = NOW()`,
        [zone.id, zone.name, zone.region, zone.latitude, zone.longitude]
      );
    }
  });

  afterEach(async () => {
    // Clean up test data
    await cleanupTestData(pgPool, testClientIds);
    testClientIds = [];
  });

  afterAll(async () => {
    // Teardown connections
    await teardownTestConnections(pgPool, redisClient, { schemaName, dropSchema: true });
  });

  describe('Authorization', () => {
    it('should reject request without authentication token', async () => {
      const response = await request(app).post('/api/v1/clients').send({
        firstName: 'John',
        lastName: 'Doe',
        dateOfBirth: '1950-01-01',
        address: '123 Main St, Toronto, ON',
        emergencyContactName: 'Jane Doe',
        emergencyContactPhone: '416-555-0100',
        emergencyContactRelationship: 'Spouse',
      });

      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe('MISSING_TOKEN');
    });

    it('should reject non-admin user (caregiver)', async () => {
      const response = await request(app)
        .post('/api/v1/clients')
        .set('Authorization', `Bearer ${caregiverToken}`)
        .send({
          firstName: 'John',
          lastName: 'Doe',
          dateOfBirth: '1950-01-01',
          address: '123 Main St, Toronto, ON',
          emergencyContactName: 'Jane Doe',
          emergencyContactPhone: '416-555-0100',
          emergencyContactRelationship: 'Spouse',
        });

      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('AUTH_INSUFFICIENT_ROLE');
    });
  });

  describe('Validation', () => {
    it('should reject missing first name', async () => {
      const response = await request(app)
        .post('/api/v1/clients')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          lastName: 'Doe',
          dateOfBirth: '1950-01-01',
          address: '123 Main St, Toronto, ON',
          emergencyContactName: 'Jane Doe',
          emergencyContactPhone: '416-555-0100',
          emergencyContactRelationship: 'Spouse',
        });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
      expect(response.body.error.message).toContain('First name');
    });

    it('should reject missing last name', async () => {
      const response = await request(app)
        .post('/api/v1/clients')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          firstName: 'John',
          dateOfBirth: '1950-01-01',
          address: '123 Main St, Toronto, ON',
          emergencyContactName: 'Jane Doe',
          emergencyContactPhone: '416-555-0100',
          emergencyContactRelationship: 'Spouse',
        });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
      expect(response.body.error.message).toContain('Last name');
    });

    it('should reject missing date of birth', async () => {
      const response = await request(app)
        .post('/api/v1/clients')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          firstName: 'John',
          lastName: 'Doe',
          address: '123 Main St, Toronto, ON',
          emergencyContactName: 'Jane Doe',
          emergencyContactPhone: '416-555-0100',
          emergencyContactRelationship: 'Spouse',
        });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
      expect(response.body.error.message).toContain('Date of birth');
    });

    it('should reject missing address', async () => {
      const response = await request(app)
        .post('/api/v1/clients')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          firstName: 'John',
          lastName: 'Doe',
          dateOfBirth: '1950-01-01',
          emergencyContactName: 'Jane Doe',
          emergencyContactPhone: '416-555-0100',
          emergencyContactRelationship: 'Spouse',
        });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
      expect(response.body.error.message).toContain('Address');
    });

    it('should reject missing emergency contact name', async () => {
      const response = await request(app)
        .post('/api/v1/clients')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          firstName: 'John',
          lastName: 'Doe',
          dateOfBirth: '1950-01-01',
          address: '123 Main St, Toronto, ON',
          emergencyContactPhone: '416-555-0100',
          emergencyContactRelationship: 'Spouse',
        });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
      expect(response.body.error.message).toContain('Emergency contact name');
    });

    it('should reject invalid date format', async () => {
      const response = await request(app)
        .post('/api/v1/clients')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          firstName: 'John',
          lastName: 'Doe',
          dateOfBirth: '01/01/1950', // Invalid format
          address: '123 Main St, Toronto, ON',
          emergencyContactName: 'Jane Doe',
          emergencyContactPhone: '416-555-0100',
          emergencyContactRelationship: 'Spouse',
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
        .post('/api/v1/clients')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          firstName: 'John',
          lastName: 'Doe',
          dateOfBirth: futureDateStr,
          address: '123 Main St, Toronto, ON',
          emergencyContactName: 'Jane Doe',
          emergencyContactPhone: '416-555-0100',
          emergencyContactRelationship: 'Spouse',
        });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
      expect(response.body.error.message).toContain('future');
    });

    it('should reject invalid zone ID format', async () => {
      const response = await request(app)
        .post('/api/v1/clients')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          firstName: 'John',
          lastName: 'Doe',
          dateOfBirth: '1950-01-01',
          address: '123 Main St, Toronto, ON',
          emergencyContactName: 'Jane Doe',
          emergencyContactPhone: '416-555-0100',
          emergencyContactRelationship: 'Spouse',
          zoneId: 'invalid-uuid',
        });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
      expect(response.body.error.message).toContain('zone ID format');
    });
  });

  describe('Duplicate Detection', () => {
    it('should detect duplicate client (same name and DOB)', async () => {
      // Create first client
      const firstResponse = await request(app)
        .post('/api/v1/clients')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          firstName: 'John',
          lastName: 'Duplicate',
          dateOfBirth: '1950-01-01',
          address: '123 Main St, Toronto, ON',
          emergencyContactName: 'Jane Doe',
          emergencyContactPhone: '416-555-0100',
          emergencyContactRelationship: 'Spouse',
        });

      expect(firstResponse.status).toBe(201);
      testClientIds.push(firstResponse.body.data.id);

      // Try to create duplicate
      const duplicateResponse = await request(app)
        .post('/api/v1/clients')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          firstName: 'John',
          lastName: 'Duplicate',
          dateOfBirth: '1950-01-01',
          address: '456 Different St, Toronto, ON', // Different address
          emergencyContactName: 'Jane Doe',
          emergencyContactPhone: '416-555-0100',
          emergencyContactRelationship: 'Spouse',
        });

      expect(duplicateResponse.status).toBe(409);
      expect(duplicateResponse.body.error.code).toBe('DUPLICATE_CLIENT');
      expect(duplicateResponse.body.error.details.existingClientId).toBe(
        firstResponse.body.data.id
      );
    });
  });

  describe('Geocoding', () => {
    it('should handle geocoding failure gracefully', async () => {
      // Use unique name to avoid duplicate detection
      const uniqueTimestamp = Date.now();
      const response = await request(app)
        .post('/api/v1/clients')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          firstName: `GeoFail${uniqueTimestamp}`,
          lastName: 'TestUser',
          dateOfBirth: '1950-01-01',
          address: 'Invalid Address That Does Not Exist 12345',
          emergencyContactName: 'Jane Doe',
          emergencyContactPhone: '416-555-0100',
          emergencyContactRelationship: 'Spouse',
        });

      // Should return 400 with geocoding error
      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('GEOCODING_ERROR');
    });

    it('should return 500 when geocoding configuration is missing', async () => {
      const response = await request(app)
        .post('/api/v1/clients')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          firstName: 'Config',
          lastName: 'Error',
          dateOfBirth: '1950-01-01',
          address: 'Config Missing API Key Address',
          emergencyContactName: 'Support Contact',
          emergencyContactPhone: '416-555-0100',
          emergencyContactRelationship: 'Spouse',
        });

      expect(response.status).toBe(500);
      expect(response.body.error.code).toBe('GEOCODING_CONFIGURATION_ERROR');
    });
  });

  describe('Successful Creation', () => {
    it('should create client successfully with all required fields', async () => {
      const response = await request(app)
        .post('/api/v1/clients')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          firstName: 'John',
          lastName: 'Smith',
          dateOfBirth: '1950-01-01',
          address: '100 Queen St W, Toronto, ON M5H 2N2',
          emergencyContactName: 'Jane Smith',
          emergencyContactPhone: '416-555-0100',
          emergencyContactRelationship: 'Spouse',
        });

      expect(response.status).toBe(201);
      expect(response.body.data).toHaveProperty('id');
      expect(response.body.data.firstName).toBe('John');
      expect(response.body.data.lastName).toBe('Smith');
      expect(response.body.data.dateOfBirth).toBe('1950-01-01');
      expect(response.body.data).toHaveProperty('latitude');
      expect(response.body.data).toHaveProperty('longitude');
      expect(response.body.data).toHaveProperty('zoneId');
      expect(response.body.data.emergencyContact.name).toBe('Jane Smith');
      expect(response.body.data.emergencyContact.phone).toBe('416-555-0100');
      expect(response.body.data.emergencyContact.relationship).toBe('Spouse');

      testClientIds.push(response.body.data.id);
    });

    it('should create client with optional phone number', async () => {
      const response = await request(app)
        .post('/api/v1/clients')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          firstName: 'Jane',
          lastName: 'Doe',
          dateOfBirth: '1955-05-15',
          address: '100 Queen St W, Toronto, ON M5H 2N2',
          phone: '416-555-0200',
          emergencyContactName: 'John Doe',
          emergencyContactPhone: '416-555-0100',
          emergencyContactRelationship: 'Spouse',
        });

      expect(response.status).toBe(201);
      expect(response.body.data.phone).toBe('416-555-0200');

      testClientIds.push(response.body.data.id);
    });

    it('should create default care plan for new client', async () => {
      const response = await request(app)
        .post('/api/v1/clients')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          firstName: 'Bob',
          lastName: 'Johnson',
          dateOfBirth: '1945-12-25',
          address: '100 Queen St W, Toronto, ON M5H 2N2',
          emergencyContactName: 'Alice Johnson',
          emergencyContactPhone: '416-555-0300',
          emergencyContactRelationship: 'Daughter',
        });

      expect(response.status).toBe(201);
      expect(response.body.data.carePlan).toHaveProperty('id');
      expect(response.body.data.carePlan.summary).toContain('Bob Johnson');
      expect(response.body.data.carePlan.medications).toEqual([]);
      expect(response.body.data.carePlan.allergies).toEqual([]);
      expect(response.body.data.carePlan.specialInstructions).toBe('');

      testClientIds.push(response.body.data.id);
    });

    it('should allow manual zone override (admin)', async () => {
      const manualZoneId = '00000000-0000-0000-0000-000000000002';

      const response = await request(app)
        .post('/api/v1/clients')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          firstName: 'Alice',
          lastName: 'Williams',
          dateOfBirth: '1960-03-10',
          address: '100 Queen St W, Toronto, ON M5H 2N2',
          emergencyContactName: 'Bob Williams',
          emergencyContactPhone: '416-555-0400',
          emergencyContactRelationship: 'Spouse',
          zoneId: manualZoneId,
        });

      expect(response.status).toBe(201);
      expect(response.body.data.zoneId).toBe(manualZoneId);

      testClientIds.push(response.body.data.id);
    });

    it('should reject invalid manual zone ID', async () => {
      const invalidZoneId = '00000000-0000-0000-0000-999999999999';

      const response = await request(app)
        .post('/api/v1/clients')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          firstName: 'Charlie',
          lastName: 'Brown',
          dateOfBirth: '1965-07-20',
          address: '100 Queen St W, Toronto, ON M5H 2N2',
          emergencyContactName: 'Lucy Brown',
          emergencyContactPhone: '416-555-0500',
          emergencyContactRelationship: 'Spouse',
          zoneId: invalidZoneId,
        });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('INVALID_ZONE');
    });
  });

  describe('Zone Assignment', () => {
    it('should assign zone based on geocoded location', async () => {
      const response = await request(app)
        .post('/api/v1/clients')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          firstName: 'David',
          lastName: 'Miller',
          dateOfBirth: '1940-08-30',
          address: '100 Queen St W, Toronto, ON M5H 2N2',
          emergencyContactName: 'Sarah Miller',
          emergencyContactPhone: '416-555-0600',
          emergencyContactRelationship: 'Daughter',
        });

      expect(response.status).toBe(201);
      expect(response.body.data).toHaveProperty('zoneId');
      expect(response.body.data.zoneId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
      );

      testClientIds.push(response.body.data.id);
    });
  });
});
