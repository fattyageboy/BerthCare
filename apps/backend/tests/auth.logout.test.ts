/**
 * Logout Endpoint Tests
 *
 * Tests for POST /v1/auth/logout endpoint:
 * - Access token blacklisting in Redis
 * - Refresh token revocation in database
 * - Error handling
 * - Integration with authentication middleware
 *
 * Reference: Task A9 - Implement POST /v1/auth/logout endpoint
 */

import crypto from 'crypto';

import express, { Express } from 'express';
import { Pool } from 'pg';
import request from 'supertest';

import { generateAccessToken, generateRefreshToken } from '@berthcare/shared';

import { RedisClient } from '../src/cache/redis-client';
import { createAuthRoutes } from '../src/routes/auth.routes';

import { setupTestConnections, teardownTestConnections } from './test-helpers';

describe('POST /v1/auth/logout', () => {
  let app: Express;
  let pgPool: Pool;
  let redisClient: RedisClient;
  let schemaName: string;

  beforeAll(async () => {
    const connections = await setupTestConnections();
    pgPool = connections.pgPool;
    redisClient = connections.redisClient;
    schemaName = connections.schemaName;

    // Create Express app
    app = express();
    app.use(express.json());

    // Mount auth routes
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const authRoutes = createAuthRoutes(pgPool, redisClient as any);
    app.use('/v1/auth', authRoutes);
  });

  afterAll(async () => {
    await teardownTestConnections(pgPool, redisClient, { schemaName, dropSchema: true });
  });

  beforeEach(async () => {
    await redisClient.flushDb();

    // Clear test refresh tokens from database
    const client = await pgPool.connect();
    try {
      await client.query(
        `DELETE FROM refresh_tokens WHERE user_id IN (
          SELECT id FROM users WHERE email LIKE 'test-logout-%@example.com'
        )`
      );
      await client.query(`DELETE FROM users WHERE email LIKE 'test-logout-%@example.com'`);
    } finally {
      client.release();
    }
  });

  describe('Success Cases', () => {
    it('should logout user with valid token and revoke refresh tokens', async () => {
      const client = await pgPool.connect();

      try {
        // Create test user
        const userResult = await client.query(
          `INSERT INTO users (email, password_hash, first_name, last_name, role, zone_id, is_active)
           VALUES ($1, $2, $3, $4, $5, $6, true)
           RETURNING id`,
          ['test-logout-1@example.com', 'hash123', 'Test', 'User', 'caregiver', null]
        );
        const userId = userResult.rows[0].id;

        // Create refresh token in database
        const refreshToken = generateRefreshToken({
          userId,
          role: 'caregiver',
          zoneId: '00000000-0000-0000-0000-000000000000',
          deviceId: 'device_test',
        });
        const tokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');
        const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

        await client.query(
          `INSERT INTO refresh_tokens (user_id, token_hash, device_id, expires_at)
           VALUES ($1, $2, $3, $4)`,
          [userId, tokenHash, 'device_test', expiresAt]
        );

        // Generate access token
        const accessToken = generateAccessToken({
          userId,
          role: 'caregiver',
          zoneId: '00000000-0000-0000-0000-000000000000',
          deviceId: 'device_test',
          email: 'test-logout-1@example.com',
        });

        // Logout
        const response = await request(app)
          .post('/v1/auth/logout')
          .set('Authorization', `Bearer ${accessToken}`)
          .expect(200);

        expect(response.body).toEqual({
          data: {
            message: 'Logged out successfully',
          },
        });

        // Verify access token is blacklisted in Redis
        const blacklistKey = `token:blacklist:${accessToken}`;
        const isBlacklisted = await redisClient.exists(blacklistKey);
        expect(isBlacklisted).toBe(1);

        // Verify refresh token is revoked in database
        const tokenResult = await client.query(
          'SELECT revoked_at FROM refresh_tokens WHERE token_hash = $1',
          [tokenHash]
        );
        expect(tokenResult.rows[0].revoked_at).not.toBeNull();
      } finally {
        client.release();
      }
    });

    it('should set expiry on blacklisted token', async () => {
      const client = await pgPool.connect();

      try {
        // Create test user
        const userResult = await client.query(
          `INSERT INTO users (email, password_hash, first_name, last_name, role, zone_id, is_active)
           VALUES ($1, $2, $3, $4, $5, $6, true)
           RETURNING id`,
          ['test-logout-2@example.com', 'hash456', 'Test', 'User2', 'coordinator', null]
        );
        const userId = userResult.rows[0].id;

        const token = generateAccessToken({
          userId,
          role: 'coordinator',
          zoneId: '00000000-0000-0000-0000-000000000000',
          email: 'test-logout-2@example.com',
          deviceId: 'test-device-id',
        });

        await request(app)
          .post('/v1/auth/logout')
          .set('Authorization', `Bearer ${token}`)
          .expect(200);

        // Check TTL (should be ~3600 seconds = 1 hour)
        const blacklistKey = `token:blacklist:${token}`;
        const ttl = await redisClient.ttl(blacklistKey);

        expect(ttl).toBeGreaterThan(3500);
        expect(ttl).toBeLessThanOrEqual(3600);
      } finally {
        client.release();
      }
    });

    it('should revoke multiple refresh tokens for the same user', async () => {
      const client = await pgPool.connect();

      try {
        // Create test user
        const userResult = await client.query(
          `INSERT INTO users (email, password_hash, first_name, last_name, role, zone_id, is_active)
           VALUES ($1, $2, $3, $4, $5, $6, true)
           RETURNING id`,
          ['test-logout-3@example.com', 'hash789', 'Test', 'User3', 'caregiver', null]
        );
        const userId = userResult.rows[0].id;

        // Create multiple refresh tokens (simulating multiple devices)
        const refreshToken1 = generateRefreshToken({
          userId,
          role: 'caregiver',
          zoneId: '00000000-0000-0000-0000-000000000000',
          deviceId: 'device_1',
        });
        const tokenHash1 = crypto.createHash('sha256').update(refreshToken1).digest('hex');

        const refreshToken2 = generateRefreshToken({
          userId,
          role: 'caregiver',
          zoneId: '00000000-0000-0000-0000-000000000000',
          deviceId: 'device_2',
        });
        const tokenHash2 = crypto.createHash('sha256').update(refreshToken2).digest('hex');

        const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

        await client.query(
          `INSERT INTO refresh_tokens (user_id, token_hash, device_id, expires_at)
           VALUES ($1, $2, $3, $4), ($1, $5, $6, $4)`,
          [userId, tokenHash1, 'device_1', expiresAt, tokenHash2, 'device_2']
        );

        // Generate access token
        const accessToken = generateAccessToken({
          userId,
          role: 'caregiver',
          zoneId: '00000000-0000-0000-0000-000000000000',
          deviceId: 'device_1',
          email: 'test-logout-3@example.com',
        });

        // Logout
        await request(app)
          .post('/v1/auth/logout')
          .set('Authorization', `Bearer ${accessToken}`)
          .expect(200);

        // Verify both refresh tokens are revoked
        const tokenResult = await client.query(
          'SELECT revoked_at FROM refresh_tokens WHERE user_id = $1',
          [userId]
        );

        expect(tokenResult.rows).toHaveLength(2);
        expect(tokenResult.rows[0].revoked_at).not.toBeNull();
        expect(tokenResult.rows[1].revoked_at).not.toBeNull();
      } finally {
        client.release();
      }
    });
  });

  describe('Error Cases', () => {
    it('should return 401 if Authorization header is missing', async () => {
      const response = await request(app).post('/v1/auth/logout').expect(401);

      expect(response.body).toEqual({
        error: {
          code: 'MISSING_TOKEN',
          message: 'Authorization header is required',
          timestamp: expect.any(String),
          requestId: expect.any(String),
        },
      });
    });

    it('should return 401 if Authorization header format is invalid', async () => {
      const response = await request(app)
        .post('/v1/auth/logout')
        .set('Authorization', 'InvalidFormat token123')
        .expect(401);

      expect(response.body).toEqual({
        error: {
          code: 'INVALID_TOKEN_FORMAT',
          message: 'Authorization header must be in format: Bearer <token>',
          timestamp: expect.any(String),
          requestId: expect.any(String),
        },
      });
    });

    it('should logout even with invalid token (blacklist it anyway)', async () => {
      // This is intentional - we blacklist any token provided, even if invalid
      // This prevents potential timing attacks
      const response = await request(app)
        .post('/v1/auth/logout')
        .set('Authorization', 'Bearer invalid.jwt.token')
        .expect(200);

      expect(response.body).toEqual({
        data: {
          message: 'Logged out successfully',
        },
      });

      // Verify token is blacklisted
      const blacklistKey = 'token:blacklist:invalid.jwt.token';
      const isBlacklisted = await redisClient.exists(blacklistKey);
      expect(isBlacklisted).toBe(1);
    });
  });

  describe('Integration: Logout prevents token reuse', () => {
    it('should prevent using token after logout', async () => {
      const client = await pgPool.connect();

      try {
        // Create test user
        const userResult = await client.query(
          `INSERT INTO users (email, password_hash, first_name, last_name, role, zone_id, is_active)
           VALUES ($1, $2, $3, $4, $5, $6, true)
           RETURNING id`,
          [
            'test-logout-integration@example.com',
            'hash_integration',
            'Test',
            'Integration',
            'caregiver',
            null,
          ]
        );
        const userId = userResult.rows[0].id;

        // Generate valid token
        const token = generateAccessToken({
          userId,
          role: 'caregiver',
          zoneId: '00000000-0000-0000-0000-000000000000',
          email: 'test-logout-integration@example.com',
        });

        // Logout (blacklist token)
        await request(app)
          .post('/v1/auth/logout')
          .set('Authorization', `Bearer ${token}`)
          .expect(200);

        // Verify token is blacklisted
        const blacklistKey = `token:blacklist:${token}`;
        const isBlacklisted = await redisClient.exists(blacklistKey);
        expect(isBlacklisted).toBe(1);

        // Note: To fully test that the token can't be used, we would need
        // a protected endpoint that uses the authenticateJWT middleware.
        // That will be tested in the integration tests for protected routes.
      } finally {
        client.release();
      }
    });

    it('should allow multiple logout calls (idempotent)', async () => {
      const client = await pgPool.connect();

      try {
        // Create test user
        const userResult = await client.query(
          `INSERT INTO users (email, password_hash, first_name, last_name, role, zone_id, is_active)
           VALUES ($1, $2, $3, $4, $5, $6, true)
           RETURNING id`,
          [
            'test-logout-idempotent@example.com',
            'hash_idempotent',
            'Test',
            'Idempotent',
            'caregiver',
            null,
          ]
        );
        const userId = userResult.rows[0].id;

        const token = generateAccessToken({
          userId,
          role: 'caregiver',
          zoneId: '00000000-0000-0000-0000-000000000000',
          deviceId: 'device_idempotent',
          email: 'test-logout-idempotent@example.com',
        });

        // First logout
        await request(app)
          .post('/v1/auth/logout')
          .set('Authorization', `Bearer ${token}`)
          .expect(200);

        // Second logout (should still succeed)
        await request(app)
          .post('/v1/auth/logout')
          .set('Authorization', `Bearer ${token}`)
          .expect(200);

        // Token should still be blacklisted
        const blacklistKey = `token:blacklist:${token}`;
        const isBlacklisted = await redisClient.exists(blacklistKey);
        expect(isBlacklisted).toBe(1);
      } finally {
        client.release();
      }
    });

    it('should prevent refresh token reuse after logout', async () => {
      const client = await pgPool.connect();

      try {
        // Create test user
        const userResult = await client.query(
          `INSERT INTO users (email, password_hash, first_name, last_name, role, zone_id, is_active)
           VALUES ($1, $2, $3, $4, $5, $6, true)
           RETURNING id`,
          ['test-logout-refresh@example.com', 'hash_refresh', 'Test', 'Refresh', 'caregiver', null]
        );
        const userId = userResult.rows[0].id;

        // Create refresh token in database
        const refreshToken = generateRefreshToken({
          userId,
          role: 'caregiver',
          zoneId: '00000000-0000-0000-0000-000000000000',
          deviceId: 'device_refresh',
        });
        const tokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');
        const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

        await client.query(
          `INSERT INTO refresh_tokens (user_id, token_hash, device_id, expires_at)
           VALUES ($1, $2, $3, $4)`,
          [userId, tokenHash, 'device_refresh', expiresAt]
        );

        // Generate access token
        const accessToken = generateAccessToken({
          userId,
          role: 'caregiver',
          zoneId: '00000000-0000-0000-0000-000000000000',
          deviceId: 'device_refresh',
          email: 'test-logout-refresh@example.com',
        });

        // Logout
        await request(app)
          .post('/v1/auth/logout')
          .set('Authorization', `Bearer ${accessToken}`)
          .expect(200);

        // Try to use refresh token (should fail because it's revoked)
        const refreshResponse = await request(app)
          .post('/v1/auth/refresh')
          .send({ refreshToken })
          .expect(401);

        expect(refreshResponse.body.error.code).toBe('TOKEN_REVOKED');

        // Verify refresh token is revoked in database
        const tokenResult = await client.query(
          'SELECT revoked_at FROM refresh_tokens WHERE token_hash = $1',
          [tokenHash]
        );
        expect(tokenResult.rows[0].revoked_at).not.toBeNull();
      } finally {
        client.release();
      }
    });
  });
});
