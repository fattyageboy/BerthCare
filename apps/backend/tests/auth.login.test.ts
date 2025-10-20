/**
 * Integration Tests: POST /v1/auth/login
 *
 * Tests the user login endpoint according to specifications:
 * - Login succeeds with valid credentials
 * - 401 for invalid credentials
 * - Rate limit works (10 attempts per hour per IP)
 * - Account disabled check
 * - Email format validation
 * - Required field validation
 *
 * Reference: Task A5 - Login endpoint integration tests
 * Architecture: project-documentation/architecture-output.md
 *
 * Test Strategy:
 * - Use real PostgreSQL and Redis connections
 * - Create test users before each test
 * - Test happy path and error scenarios
 * - Verify rate limiting behavior
 * - Validate JWT token generation
 */

import crypto from 'crypto';

import express from 'express';
import { Pool } from 'pg';
import { createClient } from 'redis';
import request from 'supertest';

import { verifyToken } from '../../../libs/shared/src/jwt-utils';
import { createAuthRoutes } from '../src/routes/auth.routes';

import { setupTestConnections, teardownTestConnections } from './test-helpers';

describe('POST /v1/auth/login', () => {
  let app: express.Application;
  let pgPool: Pool;
  let redisClient: ReturnType<typeof createClient>;

  // Setup: Create app and database connections
  beforeAll(async () => {
    // Setup connections using shared helper
    const connections = await setupTestConnections();
    pgPool = connections.pgPool;
    redisClient = connections.redisClient;

    // Create Express app with auth routes
    app = express();
    app.use(express.json());
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    app.use('/v1/auth', createAuthRoutes(pgPool, redisClient as any));
  });

  // Cleanup: Close connections
  afterAll(async () => {
    await teardownTestConnections(pgPool, redisClient);
  });

  // Clean database and Redis before each test
  beforeEach(async () => {
    const client = await pgPool.connect();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM refresh_tokens');
      await client.query("DELETE FROM users WHERE email LIKE '%@example.com'");
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Error cleaning test database:', error);
      throw error;
    } finally {
      client.release();
    }

    // Redis cleanup outside PostgreSQL transaction
    try {
      await redisClient.flushDb();
    } catch (error) {
      console.error('Error cleaning Redis:', error);
      throw error;
    }
  });

  // Helper function to create a test user
  async function createTestUser(
    email: string,
    password: string,
    role: string = 'caregiver',
    zoneId: string = '550e8400-e29b-41d4-a716-446655440001',
    isActive: boolean = true
  ) {
    const response = await request(app).post('/v1/auth/register').send({
      email,
      password,
      firstName: 'Test',
      lastName: 'User',
      role,
      zoneId,
      deviceId: 'test-device-setup',
    });

    // Check if registration succeeded
    if (response.status !== 201) {
      throw new Error(
        `Failed to create test user: ${response.status} - ${JSON.stringify(response.body)}`
      );
    }

    // If account should be inactive, update it
    if (!isActive) {
      await pgPool.query('UPDATE users SET is_active = false WHERE email = $1', [
        email.toLowerCase(),
      ]);
    }

    return response.body.data.user;
  }

  describe('Successful Login', () => {
    it('should login with valid credentials', async () => {
      // Create test user
      await createTestUser('test@example.com', 'SecurePass123');

      // Login
      const response = await request(app).post('/v1/auth/login').send({
        email: 'test@example.com',
        password: 'SecurePass123',
        deviceId: 'test-device-001',
      });

      expect(response.status).toBe(200);
      expect(response.body.data).toHaveProperty('accessToken');
      expect(response.body.data).toHaveProperty('refreshToken');
      expect(response.body.data.user).toMatchObject({
        email: 'test@example.com',
        firstName: 'Test',
        lastName: 'User',
        role: 'caregiver',
      });
      expect(response.body.data.user).toHaveProperty('id');

      // Verify tokens are valid JWTs
      const accessTokenPayload = verifyToken(response.body.data.accessToken);
      expect(accessTokenPayload.userId).toBe(response.body.data.user.id);
      expect(accessTokenPayload.role).toBe('caregiver');
      expect(accessTokenPayload.email).toBe('test@example.com');

      // Verify refresh token was stored
      const tokenResult = await pgPool.query(
        'SELECT * FROM refresh_tokens WHERE user_id = $1 AND device_id = $2',
        [response.body.data.user.id, 'test-device-001']
      );
      expect(tokenResult.rows).toHaveLength(1);
    });

    it('should login with case-insensitive email', async () => {
      // Create test user with lowercase email
      await createTestUser('test@example.com', 'SecurePass123');

      // Login with uppercase email
      const response = await request(app).post('/v1/auth/login').send({
        email: 'TEST@EXAMPLE.COM',
        password: 'SecurePass123',
        deviceId: 'test-device-002',
      });

      expect(response.status).toBe(200);
      expect(response.body.data.user.email).toBe('test@example.com');
    });

    it('should allow multiple logins from different devices', async () => {
      // Create test user
      const user = await createTestUser('test@example.com', 'SecurePass123');

      // Login from device 1
      const response1 = await request(app).post('/v1/auth/login').send({
        email: 'test@example.com',
        password: 'SecurePass123',
        deviceId: 'device-001',
      });

      // Login from device 2
      const response2 = await request(app).post('/v1/auth/login').send({
        email: 'test@example.com',
        password: 'SecurePass123',
        deviceId: 'device-002',
      });

      expect(response1.status).toBe(200);
      expect(response2.status).toBe(200);

      // Verify both refresh tokens were stored
      const tokenResult = await pgPool.query('SELECT * FROM refresh_tokens WHERE user_id = $1', [
        user.id,
      ]);
      expect(tokenResult.rows.length).toBeGreaterThanOrEqual(2);
    });

    it('should login coordinator successfully', async () => {
      await createTestUser('coordinator@example.com', 'SecurePass123', 'coordinator');

      const response = await request(app).post('/v1/auth/login').send({
        email: 'coordinator@example.com',
        password: 'SecurePass123',
        deviceId: 'test-device-003',
      });

      expect(response.status).toBe(200);
      expect(response.body.data.user.role).toBe('coordinator');
    });

    it('should login admin successfully', async () => {
      await createTestUser('admin@example.com', 'AdminPass123', 'admin', undefined);

      const response = await request(app).post('/v1/auth/login').send({
        email: 'admin@example.com',
        password: 'AdminPass123',
        deviceId: 'test-device-004',
      });

      expect(response.status).toBe(200);
      expect(response.body.data.user.role).toBe('admin');
    });
  });

  describe('Invalid Credentials', () => {
    it('should return 401 for non-existent email', async () => {
      const response = await request(app).post('/v1/auth/login').send({
        email: 'nonexistent@example.com',
        password: 'SecurePass123',
        deviceId: 'test-device-005',
      });

      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe('INVALID_CREDENTIALS');
      expect(response.body.error.message).toContain('Invalid email or password');
    });

    it('should return 401 for incorrect password', async () => {
      await createTestUser('test@example.com', 'CorrectPass123');

      const response = await request(app).post('/v1/auth/login').send({
        email: 'test@example.com',
        password: 'WrongPass123',
        deviceId: 'test-device-006',
      });

      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe('INVALID_CREDENTIALS');
      expect(response.body.error.message).toContain('Invalid email or password');
    });

    it('should return 401 for disabled account', async () => {
      await createTestUser('disabled@example.com', 'SecurePass123', 'caregiver', undefined, false);

      const response = await request(app).post('/v1/auth/login').send({
        email: 'disabled@example.com',
        password: 'SecurePass123',
        deviceId: 'test-device-007',
      });

      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe('ACCOUNT_DISABLED');
      expect(response.body.error.message).toContain('disabled');
    });

    it('should not reveal whether email exists', async () => {
      await createTestUser('exists@example.com', 'SecurePass123');

      // Wrong password for existing user
      const response1 = await request(app).post('/v1/auth/login').send({
        email: 'exists@example.com',
        password: 'WrongPass123',
        deviceId: 'test-device-008',
      });

      // Non-existent user
      const response2 = await request(app).post('/v1/auth/login').send({
        email: 'nonexistent@example.com',
        password: 'SomePass123',
        deviceId: 'test-device-009',
      });

      // Both should return same error message
      expect(response1.status).toBe(401);
      expect(response2.status).toBe(401);
      expect(response1.body.error.message).toBe(response2.body.error.message);
    });
  });

  describe('Email Format Validation', () => {
    it('should reject invalid email format', async () => {
      const response = await request(app).post('/v1/auth/login').send({
        email: 'invalid-email',
        password: 'SecurePass123',
        deviceId: 'test-device-010',
      });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
      expect(response.body.error.message).toContain('Invalid email format');
    });

    it('should reject email without domain', async () => {
      const response = await request(app).post('/v1/auth/login').send({
        email: 'test@',
        password: 'SecurePass123',
        deviceId: 'test-device-011',
      });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should reject email without @', async () => {
      const response = await request(app).post('/v1/auth/login').send({
        email: 'testexample.com',
        password: 'SecurePass123',
        deviceId: 'test-device-012',
      });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('Required Field Validation', () => {
    it('should reject missing email', async () => {
      const response = await request(app).post('/v1/auth/login').send({
        password: 'SecurePass123',
        deviceId: 'test-device-013',
      });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
      expect(response.body.error.message).toContain('Email is required');
    });

    it('should reject missing password', async () => {
      const response = await request(app).post('/v1/auth/login').send({
        email: 'test@example.com',
        deviceId: 'test-device-014',
      });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
      expect(response.body.error.message).toContain('Password is required');
    });

    it('should reject missing deviceId', async () => {
      const response = await request(app).post('/v1/auth/login').send({
        email: 'test@example.com',
        password: 'SecurePass123',
      });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
      expect(response.body.error.message).toContain('Device ID is required');
    });
  });

  describe('Rate Limiting', () => {
    it('should allow 10 login attempts per hour', async () => {
      await createTestUser('test@example.com', 'SecurePass123');

      const attempts: number[] = [];

      // Make 10 attempts (should all succeed)
      for (let i = 0; i < 10; i++) {
        const response = await request(app)
          .post('/v1/auth/login')
          .send({
            email: 'test@example.com',
            password: 'SecurePass123',
            deviceId: `test-device-${i}`,
          });

        attempts.push(response.status);
      }

      // All 10 attempts should succeed (200)
      expect(attempts.every((status) => status === 200)).toBe(true);
    });

    it('should block 11th login attempt with 429', async () => {
      await createTestUser('test@example.com', 'SecurePass123');

      // Make 10 successful attempts
      for (let i = 0; i < 10; i++) {
        await request(app)
          .post('/v1/auth/login')
          .send({
            email: 'test@example.com',
            password: 'SecurePass123',
            deviceId: `test-device-${i}`,
          });
      }

      // 11th attempt should be rate limited
      const response = await request(app).post('/v1/auth/login').send({
        email: 'test@example.com',
        password: 'SecurePass123',
        deviceId: 'test-device-11',
      });

      expect(response.status).toBe(429);
      expect(response.body.error.code).toBe('RATE_LIMIT_EXCEEDED');
      expect(response.body.error.message).toContain('Too many attempts');
      expect(response.body.error.details.maxAttempts).toBe(10);
    });

    it('should rate limit failed login attempts', async () => {
      await createTestUser('test@example.com', 'SecurePass123');

      // Make 10 failed attempts
      for (let i = 0; i < 10; i++) {
        await request(app)
          .post('/v1/auth/login')
          .send({
            email: 'test@example.com',
            password: 'WrongPass123',
            deviceId: `test-device-${i}`,
          });
      }

      // 11th attempt should be rate limited (even with correct password)
      const response = await request(app).post('/v1/auth/login').send({
        email: 'test@example.com',
        password: 'SecurePass123',
        deviceId: 'test-device-11',
      });

      expect(response.status).toBe(429);
      expect(response.body.error.code).toBe('RATE_LIMIT_EXCEEDED');
    });

    it('should include rate limit headers', async () => {
      await createTestUser('test@example.com', 'SecurePass123');

      const response = await request(app).post('/v1/auth/login').send({
        email: 'test@example.com',
        password: 'SecurePass123',
        deviceId: 'test-device-001',
      });

      expect(response.headers['x-ratelimit-limit']).toBe('10');
      expect(response.headers['x-ratelimit-remaining']).toBeDefined();
      expect(response.headers['x-ratelimit-reset']).toBeDefined();
    });
  });

  describe('Security', () => {
    it('should hash refresh token before storing', async () => {
      await createTestUser('test@example.com', 'SecurePass123');

      const response = await request(app).post('/v1/auth/login').send({
        email: 'test@example.com',
        password: 'SecurePass123',
        deviceId: 'test-device-security',
      });

      const refreshToken = response.body.data.refreshToken;

      // Get stored token hash from database
      const tokenResult = await pgPool.query(
        'SELECT token_hash FROM refresh_tokens WHERE user_id = $1 AND device_id = $2',
        [response.body.data.user.id, 'test-device-security']
      );

      const storedHash = tokenResult.rows[0].token_hash;

      // Hash should not equal plain token
      expect(storedHash).not.toBe(refreshToken);

      // Hash should be 64 characters (SHA-256 hex)
      expect(storedHash).toHaveLength(64);

      // Verify hash matches
      const expectedHash = crypto.createHash('sha256').update(refreshToken).digest('hex');
      expect(storedHash).toBe(expectedHash);
    });

    it('should use constant-time password comparison', async () => {
      await createTestUser('test@example.com', 'SecurePass123');

      // Measure time for correct password
      const start1 = Date.now();
      await request(app).post('/v1/auth/login').send({
        email: 'test@example.com',
        password: 'SecurePass123',
        deviceId: 'test-device-001',
      });
      const time1 = Date.now() - start1;

      // Clean rate limit
      await redisClient.flushDb();

      // Measure time for incorrect password
      const start2 = Date.now();
      await request(app).post('/v1/auth/login').send({
        email: 'test@example.com',
        password: 'WrongPass123',
        deviceId: 'test-device-002',
      });
      const time2 = Date.now() - start2;

      // Times should be similar (within 100ms) - constant-time comparison
      // Note: This is a basic check, not a rigorous timing attack test
      expect(Math.abs(time1 - time2)).toBeLessThan(100);
    });

    it('should set refresh token expiry to 30 days', async () => {
      await createTestUser('test@example.com', 'SecurePass123');

      const response = await request(app).post('/v1/auth/login').send({
        email: 'test@example.com',
        password: 'SecurePass123',
        deviceId: 'test-device-expiry',
      });

      // Get stored token from database
      const tokenResult = await pgPool.query(
        'SELECT expires_at FROM refresh_tokens WHERE user_id = $1 AND device_id = $2',
        [response.body.data.user.id, 'test-device-expiry']
      );

      const expiresAt = new Date(tokenResult.rows[0].expires_at);
      const now = new Date();
      const daysDiff = (expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);

      // Should be approximately 30 days (allow 1 day margin for test execution time)
      expect(daysDiff).toBeGreaterThan(29);
      expect(daysDiff).toBeLessThan(31);
    });
  });

  describe('Token Generation', () => {
    it('should generate different tokens for each login', async () => {
      await createTestUser('test@example.com', 'SecurePass123');

      const response1 = await request(app).post('/v1/auth/login').send({
        email: 'test@example.com',
        password: 'SecurePass123',
        deviceId: 'test-device-001',
      });

      // Clean rate limit
      await redisClient.flushDb();

      const response2 = await request(app).post('/v1/auth/login').send({
        email: 'test@example.com',
        password: 'SecurePass123',
        deviceId: 'test-device-002',
      });

      expect(response1.body.data.accessToken).not.toBe(response2.body.data.accessToken);
      expect(response1.body.data.refreshToken).not.toBe(response2.body.data.refreshToken);
    });

    it('should include correct user data in access token', async () => {
      const user = await createTestUser(
        'test@example.com',
        'SecurePass123',
        'coordinator',
        '550e8400-e29b-41d4-a716-446655440001'
      );

      const response = await request(app).post('/v1/auth/login').send({
        email: 'test@example.com',
        password: 'SecurePass123',
        deviceId: 'test-device-001',
      });

      const payload = verifyToken(response.body.data.accessToken);

      expect(payload.userId).toBe(user.id);
      expect(payload.role).toBe('coordinator');
      expect(payload.zoneId).toBe('550e8400-e29b-41d4-a716-446655440001');
      expect(payload.email).toBe('test@example.com');
    });
  });
});
