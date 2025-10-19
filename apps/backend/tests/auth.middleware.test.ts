/**
 * JWT Authentication Middleware Tests
 *
 * Tests for JWT authentication middleware functionality:
 * - Token verification
 * - Token expiration handling
 * - Token blacklist (logout)
 * - Role-based authorization
 * - Error handling
 *
 * Reference: Task A7 - JWT authentication middleware
 */

import { Response } from 'express';

import * as jwtUtils from '@berthcare/shared';

import type { RedisClient } from '../src/cache/redis-client';
import {
  authenticateJWT,
  authorize,
  requireRole,
  blacklistToken,
  AuthenticatedRequest,
} from '../src/middleware/auth';

class InMemoryRedisClient {
  private store = new Map<string, { value: string; expiresAt: number | null }>();

  async connect(): Promise<void> {
    return;
  }

  async quit(): Promise<void> {
    this.store.clear();
  }

  async flushDb(): Promise<'OK'> {
    this.store.clear();
    return 'OK';
  }

  async exists(key: string): Promise<number> {
    return this.get(key) ? 1 : 0;
  }

  async setEx(key: string, seconds: number, value: string): Promise<'OK'> {
    const expiresAt = Number.isFinite(seconds) ? Date.now() + seconds * 1000 : null;
    this.store.set(key, { value, expiresAt });
    return 'OK';
  }

  async keys(pattern: string): Promise<string[]> {
    const regex = this.patternToRegex(pattern);
    return Array.from(this.store.keys()).filter((key) => regex.test(key) && this.get(key));
  }

  async del(keys: string[] | string): Promise<number> {
    const list = Array.isArray(keys) ? keys : [keys];
    let removed = 0;
    for (const key of list) {
      if (this.store.delete(key)) {
        removed += 1;
      }
    }
    return removed;
  }

  async ttl(key: string): Promise<number> {
    const entry = this.store.get(key);
    if (!entry) {
      return -2;
    }
    if (entry.expiresAt === null) {
      return -1;
    }
    const remaining = entry.expiresAt - Date.now();
    if (remaining <= 0) {
      this.store.delete(key);
      return -2;
    }
    return Math.ceil(remaining / 1000);
  }

  async set(key: string, value: string): Promise<'OK'> {
    this.store.set(key, { value, expiresAt: null });
    return 'OK';
  }

  async *scanIterator(options: { MATCH?: string; COUNT?: number }) {
    const regex = this.patternToRegex(options.MATCH ?? '*');
    for (const key of Array.from(this.store.keys())) {
      if (regex.test(key) && (await this.exists(key))) {
        yield key;
      }
    }
  }

  private get(key: string) {
    const entry = this.store.get(key);
    if (!entry) {
      return null;
    }
    if (entry.expiresAt !== null && entry.expiresAt <= Date.now()) {
      this.store.delete(key);
      return null;
    }
    return entry;
  }

  private patternToRegex(pattern: string): RegExp {
    const escaped = pattern.replace(/[-/\\^$+?.()|[\]{}]/g, '\\$&').replace(/\*/g, '.*');
    return new RegExp(`^${escaped}$`);
  }
}

describe('JWT Authentication Middleware', () => {
  let redisClient: RedisClient;
  let inMemoryRedis: InMemoryRedisClient;
  let mockRequest: Partial<AuthenticatedRequest>;
  let mockResponse: Partial<Response>;
  let nextFunction: jest.Mock;

  beforeAll(async () => {
    inMemoryRedis = new InMemoryRedisClient();
    redisClient = inMemoryRedis as unknown as RedisClient;
    await inMemoryRedis.connect();
  });

  afterAll(async () => {
    await inMemoryRedis.quit();
  });

  beforeEach(async () => {
    await inMemoryRedis.flushDb();

    // Reset mocks
    mockRequest = {
      headers: {},
    };

    mockResponse = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };

    mockRequest.params = {};

    nextFunction = jest.fn();
  });

  describe('authenticateJWT', () => {
    it('should reject request without Authorization header', async () => {
      const middleware = authenticateJWT(redisClient);
      await middleware(mockRequest as AuthenticatedRequest, mockResponse as Response, nextFunction);

      expect(mockResponse.status).toHaveBeenCalledWith(401);
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.objectContaining({
            code: 'MISSING_TOKEN',
            message: 'Authorization header is required',
          }),
        })
      );
      expect(nextFunction).not.toHaveBeenCalled();
    });

    it('should reject request with invalid Authorization header format', async () => {
      mockRequest.headers = {
        authorization: 'InvalidFormat token123',
      };

      const middleware = authenticateJWT(redisClient);
      await middleware(mockRequest as AuthenticatedRequest, mockResponse as Response, nextFunction);

      expect(mockResponse.status).toHaveBeenCalledWith(401);
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.objectContaining({
            code: 'INVALID_TOKEN_FORMAT',
            message: 'Authorization header must be in format: Bearer <token>',
          }),
        })
      );
      expect(nextFunction).not.toHaveBeenCalled();
    });

    it('should reject request with invalid JWT token', async () => {
      mockRequest.headers = {
        authorization: 'Bearer invalid.jwt.token',
      };

      const middleware = authenticateJWT(redisClient);
      await middleware(mockRequest as AuthenticatedRequest, mockResponse as Response, nextFunction);

      expect(mockResponse.status).toHaveBeenCalledWith(401);
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.objectContaining({
            code: 'INVALID_TOKEN',
            message: 'Invalid access token',
          }),
        })
      );
      expect(nextFunction).not.toHaveBeenCalled();
    });

    it('should reject request with expired JWT token', async () => {
      mockRequest.headers = {
        authorization: 'Bearer expired.jwt.token',
      };

      const verifySpy = jest.spyOn(jwtUtils, 'verifyToken').mockImplementation(() => {
        throw new Error('Token has expired');
      });

      const middleware = authenticateJWT(redisClient);
      await middleware(mockRequest as AuthenticatedRequest, mockResponse as Response, nextFunction);

      expect(mockResponse.status).toHaveBeenCalledWith(401);
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.objectContaining({
            code: 'TOKEN_EXPIRED',
            message: 'Access token has expired',
          }),
        })
      );
      expect(nextFunction).not.toHaveBeenCalled();

      verifySpy.mockRestore();
    });

    it('should accept request with valid JWT token', async () => {
      // Generate valid token
      const token = jwtUtils.generateAccessToken({
        userId: 'user_123',
        role: 'caregiver',
        zoneId: 'zone_456',
        email: 'test@example.com',
        deviceId: 'device-auth-123',
      });

      mockRequest.headers = {
        authorization: `Bearer ${token}`,
      };

      const middleware = authenticateJWT(redisClient);
      await middleware(mockRequest as AuthenticatedRequest, mockResponse as Response, nextFunction);

      expect(nextFunction).toHaveBeenCalled();
      expect(mockRequest.user).toEqual({
        userId: 'user_123',
        role: 'caregiver',
        zoneId: 'zone_456',
        email: 'test@example.com',
        deviceId: 'device-auth-123',
        permissions: jwtUtils.getRolePermissions('caregiver'),
      });
      expect(mockResponse.status).not.toHaveBeenCalled();
    });

    it('should reject blacklisted token', async () => {
      // Generate valid token
      const token = jwtUtils.generateAccessToken({
        userId: 'user_123',
        role: 'caregiver',
        zoneId: 'zone_456',
      });

      // Blacklist the token
      await blacklistToken(redisClient, token);

      mockRequest.headers = {
        authorization: `Bearer ${token}`,
      };

      const middleware = authenticateJWT(redisClient);
      await middleware(mockRequest as AuthenticatedRequest, mockResponse as Response, nextFunction);

      expect(mockResponse.status).toHaveBeenCalledWith(401);
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.objectContaining({
            code: 'TOKEN_REVOKED',
            message: 'Access token has been revoked',
          }),
        })
      );
      expect(nextFunction).not.toHaveBeenCalled();
    });

    it('should attach user information to request', async () => {
      const token = jwtUtils.generateAccessToken({
        userId: 'user_789',
        role: 'coordinator',
        zoneId: 'zone_abc',
        email: 'coordinator@example.com',
      });

      mockRequest.headers = {
        authorization: `Bearer ${token}`,
      };

      const middleware = authenticateJWT(redisClient);
      await middleware(mockRequest as AuthenticatedRequest, mockResponse as Response, nextFunction);

      expect(mockRequest.user).toBeDefined();
      expect(mockRequest.user?.userId).toBe('user_789');
      expect(mockRequest.user?.role).toBe('coordinator');
      expect(mockRequest.user?.zoneId).toBe('zone_abc');
      expect(mockRequest.user?.email).toBe('coordinator@example.com');
      expect(mockRequest.user?.permissions).toEqual(jwtUtils.getRolePermissions('coordinator'));
    });

    it('should prefer permissions from token payload when provided', async () => {
      const customPermissions = [
        'create:visit',
        'update:visit-documentation',
      ] as jwtUtils.Permission[];
      const token = jwtUtils.generateAccessToken({
        userId: 'user_permissions',
        role: 'caregiver',
        zoneId: 'zone_custom',
        permissions: customPermissions,
      });

      mockRequest.headers = {
        authorization: `Bearer ${token}`,
      };

      const middleware = authenticateJWT(redisClient);
      await middleware(mockRequest as AuthenticatedRequest, mockResponse as Response, nextFunction);

      expect(mockRequest.user?.permissions).toEqual(customPermissions);
    });
  });

  describe('requireRole', () => {
    beforeEach(() => {
      // Set up authenticated user
      mockRequest.user = {
        userId: 'user_123',
        role: 'caregiver',
        zoneId: 'zone_456',
        email: 'test@example.com',
        permissions: jwtUtils.getRolePermissions('caregiver'),
      };
    });

    it('should allow access for authorized role', () => {
      const middleware = requireRole(['caregiver', 'coordinator']);
      middleware(mockRequest as AuthenticatedRequest, mockResponse as Response, nextFunction);

      expect(nextFunction).toHaveBeenCalled();
      expect(mockResponse.status).not.toHaveBeenCalled();
    });

    it('should deny access for unauthorized role', () => {
      const middleware = requireRole(['admin']);
      middleware(mockRequest as AuthenticatedRequest, mockResponse as Response, nextFunction);

      expect(mockResponse.status).toHaveBeenCalledWith(403);
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.objectContaining({
            code: 'AUTH_INSUFFICIENT_ROLE',
            message: 'You do not have permission to access this resource',
            details: {
              requiredRoles: ['admin'],
              userRole: 'caregiver',
            },
          }),
        })
      );
      expect(nextFunction).not.toHaveBeenCalled();
    });

    it('should deny access if user not authenticated', () => {
      mockRequest.user = undefined;

      const middleware = requireRole(['caregiver']);
      middleware(mockRequest as AuthenticatedRequest, mockResponse as Response, nextFunction);

      expect(mockResponse.status).toHaveBeenCalledWith(401);
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.objectContaining({
            code: 'AUTH_UNAUTHENTICATED',
            message: 'Authentication is required to access this resource',
          }),
        })
      );
      expect(nextFunction).not.toHaveBeenCalled();
    });

    it('should allow access for multiple authorized roles', () => {
      mockRequest.user = {
        userId: 'user_456',
        role: 'coordinator',
        zoneId: 'zone_789',
        permissions: jwtUtils.getRolePermissions('coordinator'),
      };

      const middleware = requireRole(['coordinator', 'admin']);
      middleware(mockRequest as AuthenticatedRequest, mockResponse as Response, nextFunction);

      expect(nextFunction).toHaveBeenCalled();
      expect(mockResponse.status).not.toHaveBeenCalled();
    });
  });

  describe('authorize', () => {
    beforeEach(() => {
      mockRequest.user = {
        userId: 'auth_user',
        role: 'coordinator',
        zoneId: 'zone-123',
        permissions: jwtUtils.getRolePermissions('coordinator'),
      };
      mockRequest.params = {};
      nextFunction.mockClear();
      (mockResponse.status as jest.Mock).mockClear();
      (mockResponse.json as jest.Mock).mockClear();
    });

    it('allows access when role and permission requirements are satisfied', () => {
      const middleware = authorize(['coordinator'], ['update:client']);
      middleware(mockRequest as AuthenticatedRequest, mockResponse as Response, nextFunction);

      expect(nextFunction).toHaveBeenCalled();
      expect(mockResponse.status).not.toHaveBeenCalled();
    });

    it('denies access when required permission is missing', () => {
      mockRequest.user = {
        userId: 'auth_user',
        role: 'caregiver',
        zoneId: 'zone-123',
        permissions: jwtUtils.getRolePermissions('caregiver'),
      };

      const middleware = authorize(['caregiver'], ['update:client']);
      middleware(mockRequest as AuthenticatedRequest, mockResponse as Response, nextFunction);

      expect(mockResponse.status).toHaveBeenCalledWith(403);
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.objectContaining({
            code: 'AUTH_INSUFFICIENT_PERMISSIONS',
            message: 'You do not have permission to perform this action',
            details: {
              requiredPermissions: ['update:client'],
            },
          }),
        })
      );
      expect(nextFunction).not.toHaveBeenCalled();
    });

    it('denies access when zone does not match and user is not admin', () => {
      mockRequest.params = { zoneId: 'zone-456' };

      const middleware = authorize(['coordinator']);
      middleware(mockRequest as AuthenticatedRequest, mockResponse as Response, nextFunction);

      expect(mockResponse.status).toHaveBeenCalledWith(403);
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.objectContaining({
            code: 'AUTH_ZONE_ACCESS_DENIED',
            message: 'You do not have access to this zone',
            details: {
              requestedZoneId: 'zone-456',
              userZoneId: 'zone-123',
            },
          }),
        })
      );
      expect(nextFunction).not.toHaveBeenCalled();
    });

    it('allows admin users to bypass zone checks by default', () => {
      mockRequest.user = {
        userId: 'admin_user',
        role: 'admin',
        zoneId: 'zone-admin',
        permissions: jwtUtils.getRolePermissions('admin'),
      };
      mockRequest.params = { zoneId: 'zone-other' };

      const middleware = authorize(['admin']);
      middleware(mockRequest as AuthenticatedRequest, mockResponse as Response, nextFunction);

      expect(nextFunction).toHaveBeenCalled();
      expect(mockResponse.status).not.toHaveBeenCalled();
    });

    it('supports custom zone resolver overrides', () => {
      mockRequest.params = {};

      const middleware = authorize(['coordinator'], null, {
        zoneResolver: (req) => req.query?.zone as string,
      });

      mockRequest.query = { zone: 'zone-456' };

      middleware(mockRequest as AuthenticatedRequest, mockResponse as Response, nextFunction);

      expect(mockResponse.status).toHaveBeenCalledWith(403);
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.objectContaining({
            code: 'AUTH_ZONE_ACCESS_DENIED',
            details: {
              requestedZoneId: 'zone-456',
              userZoneId: 'zone-123',
            },
          }),
        })
      );
      expect(nextFunction).not.toHaveBeenCalled();
    });
  });

  describe('blacklistToken', () => {
    it('should add token to blacklist', async () => {
      const token = 'test.jwt.token';
      await blacklistToken(redisClient, token, 60);

      const blacklistKey = `token:blacklist:${token}`;
      const exists = await redisClient.exists(blacklistKey);

      expect(exists).toBe(1);
    });

    it('should set expiry on blacklisted token', async () => {
      const token = 'test.jwt.token.expiry';
      await blacklistToken(redisClient, token, 10);

      const blacklistKey = `token:blacklist:${token}`;
      const ttl = await redisClient.ttl(blacklistKey);

      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(10);
    });

    it('should use default expiry if not specified', async () => {
      const token = 'test.jwt.token.default';
      await blacklistToken(redisClient, token);

      const blacklistKey = `token:blacklist:${token}`;
      const ttl = await redisClient.ttl(blacklistKey);

      // Default expiry is 3600 seconds (1 hour)
      expect(ttl).toBeGreaterThan(3500);
      expect(ttl).toBeLessThanOrEqual(3600);
    });
  });

  describe('Integration: Full authentication flow', () => {
    it('should authenticate, authorize, and logout user', async () => {
      // Step 1: Generate token
      const token = jwtUtils.generateAccessToken({
        userId: 'user_integration',
        role: 'coordinator',
        zoneId: 'zone_integration',
        email: 'integration@example.com',
      });

      // Step 2: Authenticate with valid token
      mockRequest.headers = {
        authorization: `Bearer ${token}`,
      };

      const authMiddleware = authenticateJWT(redisClient);
      await authMiddleware(
        mockRequest as AuthenticatedRequest,
        mockResponse as Response,
        nextFunction
      );

      expect(nextFunction).toHaveBeenCalled();
      expect(mockRequest.user?.userId).toBe('user_integration');

      // Step 3: Check role authorization
      nextFunction.mockClear();
      const roleMiddleware = requireRole(['coordinator', 'admin']);
      roleMiddleware(mockRequest as AuthenticatedRequest, mockResponse as Response, nextFunction);

      expect(nextFunction).toHaveBeenCalled();

      // Step 4: Blacklist token (logout)
      await blacklistToken(redisClient, token);

      // Step 5: Try to use blacklisted token
      nextFunction.mockClear();
      mockResponse.status = jest.fn().mockReturnThis();
      mockResponse.json = jest.fn().mockReturnThis();

      await authMiddleware(
        mockRequest as AuthenticatedRequest,
        mockResponse as Response,
        nextFunction
      );

      expect(mockResponse.status).toHaveBeenCalledWith(401);
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.objectContaining({
            code: 'TOKEN_REVOKED',
          }),
        })
      );
      expect(nextFunction).not.toHaveBeenCalled();
    });
  });
});
