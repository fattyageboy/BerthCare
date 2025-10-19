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

import express from 'express';
import { Pool } from 'pg';
import request from 'supertest';

import { generateRefreshToken } from '@berthcare/shared';

import { RedisClient } from '../src/cache/redis-client';
import { createAuthRoutes } from '../src/routes/auth.routes';

import { setupTestConnections, teardownTestConnections } from './test-helpers';

describe('POST /v1/auth/refresh', () => {
  let app: express.Application;
  let pgPool: Pool;
  let redisClient: RedisClient;
  let schemaName: string;
  let testUserId: string;
  let validRefreshToken: string;
  let validTokenHash: string;

  // Setup: Create app and database connections
  beforeAll(async () => {
    const connections = await setupTestConnections();
    pgPool = connections.pgPool;
    redisClient = connections.redisClient;
    schemaName = connections.schemaName;

    // Create Express app with auth routes
    app = express();
    app.use(express.json());
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    app.use('/v1/auth', createAuthRoutes(pgPool, redisClient as any));
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
        '123e4567-e89b-12d3-a456-426614174000',
      ]
    );
    testUserId = userResult.rows[0].id;

    // Generate a valid refresh token
    validRefreshToken = generateRefreshToken({
      userId: testUserId,
      role: 'caregiver',
      zoneId: '123e4567-e89b-12d3-a456-426614174000',
      deviceId: 'test-device',
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
      expect(response.body.data).toHaveProperty('refreshToken');
      expect(typeof response.body.data.accessToken).toBe('string');
      expect(typeof response.body.data.refreshToken).toBe('string');
      expect(response.body.data.accessToken.split('.')).toHaveLength(3); // JWT format
      expect(response.body.data.refreshToken.split('.')).toHaveLength(3); // JWT format
      expect(response.body.data.refreshToken).not.toBe(validRefreshToken);

      const newTokenHash = crypto
        .createHash('sha256')
        .update(response.body.data.refreshToken)
        .digest('hex');

      const newTokenResult = await pgPool.query(
        'SELECT revoked_at, device_id FROM refresh_tokens WHERE token_hash = $1',
        [newTokenHash]
      );
      expect(newTokenResult.rows).toHaveLength(1);
      expect(newTokenResult.rows[0].revoked_at).toBeNull();
      expect(newTokenResult.rows[0].device_id).toBe('test-device');

      const oldTokenResult = await pgPool.query(
        'SELECT revoked_at FROM refresh_tokens WHERE token_hash = $1',
        [validTokenHash]
      );
      expect(oldTokenResult.rows).toHaveLength(1);
      expect(oldTokenResult.rows[0].revoked_at).not.toBeNull();
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
      expect(payload.zoneId).toBe('123e4567-e89b-12d3-a456-426614174000');
      expect(payload.email).toBe('refresh-test@example.com');
    });

    it('should allow subsequent refresh with rotated refresh token', async () => {
      const firstResponse = await request(app).post('/v1/auth/refresh').send({
        refreshToken: validRefreshToken,
      });

      expect(firstResponse.status).toBe(200);
      const rotatedRefreshToken = firstResponse.body.data.refreshToken;

      const secondResponse = await request(app).post('/v1/auth/refresh').send({
        refreshToken: rotatedRefreshToken,
      });

      expect(secondResponse.status).toBe(200);
      expect(secondResponse.body.data.refreshToken).not.toBe(rotatedRefreshToken);
      expect(secondResponse.body.data.refreshToken.split('.')).toHaveLength(3);
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
        deviceId: 'test-device',
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

    it('should return 401 when device id does not match stored session', async () => {
      const mismatchedToken = generateRefreshToken({
        userId: testUserId,
        role: 'caregiver',
        zoneId: '123e4567-e89b-12d3-a456-426614174000',
        deviceId: 'other-device',
      });

      const mismatchedHash = crypto.createHash('sha256').update(mismatchedToken).digest('hex');
      const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

      await pgPool.query(
        `INSERT INTO refresh_tokens (user_id, token_hash, device_id, expires_at)
         VALUES ($1, $2, $3, $4)`,
        [testUserId, mismatchedHash, 'test-device', expiresAt]
      );

      const response = await request(app).post('/v1/auth/refresh').send({
        refreshToken: mismatchedToken,
      });

      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe('DEVICE_MISMATCH');
      expect(response.body.error.message).toBe(
        'Refresh token device does not match active session'
      );
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
    it('should reject reuse of old refresh token after rotation', async () => {
      // Initial refresh rotates the token
      const firstResponse = await request(app).post('/v1/auth/refresh').send({
        refreshToken: validRefreshToken,
      });
      expect(firstResponse.status).toBe(200);

      // Reusing the original token should be rejected after rotation
      const reuseResponse = await request(app).post('/v1/auth/refresh').send({
        refreshToken: validRefreshToken,
      });
      expect(reuseResponse.status).toBe(401);
      expect(reuseResponse.body.error.code).toBe('TOKEN_REVOKED');
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
          '123e4567-e89b-12d3-a456-426614174000',
        ]
      );

      const coordToken = generateRefreshToken({
        userId: coordResult.rows[0].id,
        role: 'coordinator',
        zoneId: '123e4567-e89b-12d3-a456-426614174000',
        deviceId: 'coord-device',
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
});
