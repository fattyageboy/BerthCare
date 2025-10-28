/**
 * Integration Tests: POST /v1/auth/refresh
 *
 * Tests token refresh endpoint functionality including:
 * - Successful token refresh with valid refresh token
 * - Rejection of invalid/expired/revoked tokens
 * - User account validation
 * - Error handling and response formats
 *
 * Reference: Architecture Blueprint - POST /v1/auth/refresh
 * Task: A6 - Implement POST /v1/auth/refresh endpoint
 *
 * Philosophy: "Uncompromising Security"
 * - Test all security validations
 * - Verify error messages don't leak sensitive information
 * - Ensure proper token lifecycle management
 */

import crypto from 'crypto';

import express, { json } from 'express';
import type { Application } from 'express';
import { Pool } from 'pg';
import { createClient } from 'redis';
import request from 'supertest';

import { generateRefreshToken } from '../../../libs/shared/src/jwt-utils';
import { createAuthRoutes } from '../src/routes/auth.routes';

// Test configuration
const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ||
  'postgresql://berthcare:berthcare_dev_password@localhost:5432/berthcare_test';
const TEST_REDIS_URL =
  process.env.TEST_REDIS_URL || 'redis://:berthcare_redis_password@localhost:6379/1';

describe('POST /v1/auth/refresh', () => {
  let app: Application;
  let pgPool: Pool;
  let redisClient: ReturnType<typeof createClient>;
  let testUserId: string;
  let validRefreshToken: string;
  let validTokenHash: string;

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

    // Create Express app with auth routes
    app = express();
    app.use(json());
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    app.use('/v1/auth', createAuthRoutes(pgPool, redisClient as any));

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

      CREATE TABLE IF NOT EXISTS refresh_tokens (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token_hash VARCHAR(255) NOT NULL UNIQUE,
        device_id VARCHAR(255) NOT NULL,
        expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
        revoked_at TIMESTAMP WITH TIME ZONE,
        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
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
      await client.query('DELETE FROM refresh_tokens');
      await client.query("DELETE FROM users WHERE email LIKE '%@example.com'");
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    await redisClient.flushDb();

    // Create a test user
    const userResult = await pgPool.query(
      `INSERT INTO users (email, password_hash, first_name, last_name, role, zone_id, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, true)
       RETURNING id`,
      [
        'refresh-test@example.com',
        'hashed_password',
        'Refresh',
        'Test',
        'caregiver',
        '550e8400-e29b-41d4-a716-446655440001',
      ]
    );
    testUserId = userResult.rows[0].id;

    // Generate a valid refresh token
    validRefreshToken = generateRefreshToken({
      userId: testUserId,
      role: 'caregiver',
      zoneId: '550e8400-e29b-41d4-a716-446655440001',
    });

    // Hash the token for database storage
    validTokenHash = crypto.createHash('sha256').update(validRefreshToken).digest('hex');

    // Store the refresh token in database
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days
    await pgPool.query(
      `INSERT INTO refresh_tokens (user_id, token_hash, device_id, expires_at)
       VALUES ($1, $2, $3, $4)`,
      [testUserId, validTokenHash, 'test-device', expiresAt]
    );
  });

  describe('Success Cases', () => {
    it('should refresh token successfully with valid refresh token', async () => {
      const response = await request(app).post('/v1/auth/refresh').send({
        refreshToken: validRefreshToken,
      });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('data');
      expect(response.body.data).toHaveProperty('accessToken');
      expect(typeof response.body.data.accessToken).toBe('string');
      expect(response.body.data.accessToken.split('.')).toHaveLength(3); // JWT format
    });

    it('should return new access token with correct user information', async () => {
      const response = await request(app).post('/v1/auth/refresh').send({
        refreshToken: validRefreshToken,
      });

      expect(response.status).toBe(200);

      // Decode the access token to verify payload (without verification)
      const accessToken = response.body.data.accessToken;
      const payload = JSON.parse(Buffer.from(accessToken.split('.')[1], 'base64').toString());

      expect(payload.userId).toBe(testUserId);
      expect(payload.role).toBe('caregiver');
      expect(payload.zoneId).toBe('550e8400-e29b-41d4-a716-446655440001');
      expect(payload.email).toBe('refresh-test@example.com');
    });
  });

  describe('Validation Errors', () => {
    it('should return 400 if refresh token is missing', async () => {
      const response = await request(app).post('/v1/auth/refresh').send({});

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('error');
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
      expect(response.body.error.message).toBe('Refresh token is required');
      expect(response.body.error.details.field).toBe('refreshToken');
    });

    it('should return 400 if refresh token format is invalid', async () => {
      const response = await request(app).post('/v1/auth/refresh').send({
        refreshToken: 'invalid-token-format',
      });

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('error');
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
      expect(response.body.error.message).toBe('Invalid refresh token format');
    });

    it('should return 400 if refresh token is not a string', async () => {
      const response = await request(app).post('/v1/auth/refresh').send({
        refreshToken: 12345,
      });

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('error');
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('Authentication Errors', () => {
    it('should return 401 for token with invalid signature', async () => {
      // Create a token with invalid signature
      const invalidToken = validRefreshToken.slice(0, -10) + 'invalidsig';

      const response = await request(app).post('/v1/auth/refresh').send({
        refreshToken: invalidToken,
      });

      expect(response.status).toBe(401);
      expect(response.body).toHaveProperty('error');
      expect(response.body.error.code).toBe('INVALID_TOKEN');
      expect(response.body.error.message).toBe('Invalid or expired refresh token');
    });

    it('should return 401 for token not found in database', async () => {
      // Generate a valid JWT but not stored in database
      const unstored = generateRefreshToken({
        userId: testUserId,
        role: 'caregiver',
        zoneId: 'zone_123',
      });

      const response = await request(app).post('/v1/auth/refresh').send({
        refreshToken: unstored,
      });

      expect(response.status).toBe(401);
      expect(response.body).toHaveProperty('error');
      expect(response.body.error.code).toBe('INVALID_TOKEN');
    });

    it('should return 401 for revoked token', async () => {
      // Revoke the token
      await pgPool.query(
        'UPDATE refresh_tokens SET revoked_at = CURRENT_TIMESTAMP WHERE token_hash = $1',
        [validTokenHash]
      );

      const response = await request(app).post('/v1/auth/refresh').send({
        refreshToken: validRefreshToken,
      });

      expect(response.status).toBe(401);
      expect(response.body).toHaveProperty('error');
      expect(response.body.error.code).toBe('TOKEN_REVOKED');
      expect(response.body.error.message).toBe('Refresh token has been revoked');
    });

    it('should return 401 for expired token', async () => {
      // Set token expiration to past
      await pgPool.query(
        'UPDATE refresh_tokens SET expires_at = $1 WHERE token_hash = $2',
        [new Date(Date.now() - 1000), validTokenHash] // Expired 1 second ago
      );

      const response = await request(app).post('/v1/auth/refresh').send({
        refreshToken: validRefreshToken,
      });

      expect(response.status).toBe(401);
      expect(response.body).toHaveProperty('error');
      expect(response.body.error.code).toBe('TOKEN_EXPIRED');
      expect(response.body.error.message).toBe('Refresh token has expired');
    });

    it('should return 401 if user account is deleted', async () => {
      // Soft delete the user
      await pgPool.query('UPDATE users SET deleted_at = CURRENT_TIMESTAMP WHERE id = $1', [
        testUserId,
      ]);

      const response = await request(app).post('/v1/auth/refresh').send({
        refreshToken: validRefreshToken,
      });

      expect(response.status).toBe(401);
      expect(response.body).toHaveProperty('error');
      expect(response.body.error.code).toBe('USER_NOT_FOUND');
      expect(response.body.error.message).toBe('User account not found');
    });

    it('should return 401 if user account is disabled', async () => {
      // Disable the user account
      await pgPool.query('UPDATE users SET is_active = false WHERE id = $1', [testUserId]);

      const response = await request(app).post('/v1/auth/refresh').send({
        refreshToken: validRefreshToken,
      });

      expect(response.status).toBe(401);
      expect(response.body).toHaveProperty('error');
      expect(response.body.error.code).toBe('ACCOUNT_DISABLED');
      expect(response.body.error.message).toBe('User account has been disabled');
    });
  });

  describe('Response Format', () => {
    it('should include standard error fields in error responses', async () => {
      const response = await request(app).post('/v1/auth/refresh').send({});

      expect(response.body.error).toHaveProperty('code');
      expect(response.body.error).toHaveProperty('message');
      expect(response.body.error).toHaveProperty('timestamp');
      expect(response.body.error).toHaveProperty('requestId');
      expect(response.body.error.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/); // ISO 8601 format
    });

    it('should not leak sensitive information in error messages', async () => {
      const response = await request(app)
        .post('/v1/auth/refresh')
        .send({
          refreshToken: validRefreshToken.slice(0, -10) + 'invalidsig',
        });

      expect(response.status).toBe(401);
      // Error message should be generic, not revealing specific failure reason
      expect(response.body.error.message).not.toContain('signature');
      expect(response.body.error.message).not.toContain('database');
      expect(response.body.error.message).not.toContain('hash');
    });
  });

  describe('Edge Cases', () => {
    it('should handle multiple refresh attempts with same token', async () => {
      // First refresh
      const response1 = await request(app).post('/v1/auth/refresh').send({
        refreshToken: validRefreshToken,
      });
      expect(response1.status).toBe(200);

      // Second refresh with same token should still work
      const response2 = await request(app).post('/v1/auth/refresh').send({
        refreshToken: validRefreshToken,
      });
      expect(response2.status).toBe(200);

      // Both should return different access tokens
      expect(response1.body.data.accessToken).not.toBe(response2.body.data.accessToken);
    });

    it('should handle refresh token for different user roles', async () => {
      // Create coordinator user
      const coordResult = await pgPool.query(
        `INSERT INTO users (email, password_hash, first_name, last_name, role, zone_id, is_active)
         VALUES ($1, $2, $3, $4, $5, $6, true)
         RETURNING id`,
        [
          'coordinator@example.com',
          'hashed_password',
          'Coord',
          'Test',
          'coordinator',
          '550e8400-e29b-41d4-a716-446655440001',
        ]
      );

      const coordToken = generateRefreshToken({
        userId: coordResult.rows[0].id,
        role: 'coordinator',
        zoneId: '550e8400-e29b-41d4-a716-446655440001',
      });

      const coordTokenHash = crypto.createHash('sha256').update(coordToken).digest('hex');
      const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

      await pgPool.query(
        `INSERT INTO refresh_tokens (user_id, token_hash, device_id, expires_at)
         VALUES ($1, $2, $3, $4)`,
        [coordResult.rows[0].id, coordTokenHash, 'coord-device', expiresAt]
      );

      const response = await request(app).post('/v1/auth/refresh').send({
        refreshToken: coordToken,
      });

      expect(response.status).toBe(200);
      const payload = JSON.parse(
        Buffer.from(response.body.data.accessToken.split('.')[1], 'base64').toString()
      );
      expect(payload.role).toBe('coordinator');
    });
  });

  describe('Rate Limiting', () => {
    it('should enforce rate limit of 20 requests per 15 minutes', async () => {
      const client = await pgPool.connect();

      try {
        // Create test user
        const userResult = await client.query(
          `INSERT INTO users (email, password_hash, first_name, last_name, role, zone_id, is_active)
           VALUES ($1, $2, $3, $4, $5, $6, true)
           RETURNING id`,
          ['ratelimit@test.com', 'hash', 'Rate', 'Limit', 'caregiver', null]
        );
        const userId = userResult.rows[0].id;

        // Create valid refresh token
        const token = generateRefreshToken({
          userId,
          role: 'caregiver',
          zoneId: '00000000-0000-0000-0000-000000000000',
          email: 'ratelimit@test.com',
        });
        const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
        const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

        await client.query(
          `INSERT INTO refresh_tokens (user_id, token_hash, device_id, expires_at)
           VALUES ($1, $2, $3, $4)`,
          [userId, tokenHash, 'test-device', expiresAt]
        );

        // Make 20 requests (should all succeed)
        for (let i = 0; i < 20; i++) {
          const response = await request(app).post('/v1/auth/refresh').send({
            refreshToken: token,
          });
          expect(response.status).toBe(200);
        }

        // 21st request should be rate limited
        const response = await request(app).post('/v1/auth/refresh').send({
          refreshToken: token,
        });

        expect(response.status).toBe(429);
        expect(response.body.error.code).toBe('RATE_LIMIT_EXCEEDED');
        expect(response.body.error.details.maxAttempts).toBe(20);
      } finally {
        client.release();
      }
    });
  });
});
