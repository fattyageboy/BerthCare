/**
 * JWT Authentication Middleware
 *
 * Provides JWT token verification for protected routes.
 *
 * Features:
 * - JWT signature verification
 * - Token expiration checking
 * - Token blacklist support (logout functionality)
 * - User context attachment to request
 * - Clear error responses
 *
 * Reference: Architecture Blueprint - API Gateway, JWT authentication
 * Task: A7 - Implement JWT authentication middleware
 *
 * Philosophy: "Uncompromising Security"
 * - Stateless authentication for horizontal scalability
 * - Token blacklist for logout functionality
 * - Clear error messages without leaking security details
 * - Multiple layers of validation
 */

import { verifyToken, decodeToken } from '@berthcare/shared';
import type { JWTPayload, UserRole } from '@berthcare/shared';
import { Request, Response, NextFunction } from 'express';
import { createClient } from 'redis';

import { logError, logInfo } from '../config/logger';

/**
 * Extended Express Request with authenticated user
 */
export interface AuthenticatedRequest extends Request {
  user?: {
    userId: string;
    role: UserRole;
    zoneId: string;
    email?: string;
  };
}

/**
 * JWT Authentication Middleware
 *
 * Verifies JWT token from Authorization header and attaches user to request.
 *
 * Token Format: "Bearer <token>"
 *
 * Validation Steps:
 * 1. Extract token from Authorization header
 * 2. Verify JWT signature and expiration
 * 3. Check token blacklist (for logout functionality)
 * 4. Attach user information to request
 *
 * @param redisClient - Redis client for token blacklist
 * @returns Express middleware function
 *
 * @example
 * // Protect a route
 * router.get('/protected', authenticateJWT(redisClient), (req: AuthenticatedRequest, res) => {
 *   res.json({ userId: req.user?.userId });
 * });
 */
export function authenticateJWT(redisClient: ReturnType<typeof createClient>) {
  return async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      // Extract token from Authorization header
      const authHeader = req.headers.authorization;

      if (!authHeader) {
        res.status(401).json({
          error: {
            code: 'MISSING_TOKEN',
            message: 'Authorization header is required',
            timestamp: new Date().toISOString(),
            requestId: req.headers['x-request-id'] || 'unknown',
          },
        });
        return;
      }

      // Validate Bearer token format
      const parts = authHeader.split(' ');
      if (parts.length !== 2 || parts[0] !== 'Bearer') {
        res.status(401).json({
          error: {
            code: 'INVALID_TOKEN_FORMAT',
            message: 'Authorization header must be in format: Bearer <token>',
            timestamp: new Date().toISOString(),
            requestId: req.headers['x-request-id'] || 'unknown',
          },
        });
        return;
      }

      const token = parts[1];

      // Verify JWT signature and decode payload
      let payload: JWTPayload;
      try {
        payload = verifyToken(token);
      } catch (error) {
        // Handle expired tokens
        if (error instanceof Error && error.message.includes('expired')) {
          res.status(401).json({
            error: {
              code: 'TOKEN_EXPIRED',
              message: 'Access token has expired',
              timestamp: new Date().toISOString(),
              requestId: req.headers['x-request-id'] || 'unknown',
            },
          });
          return;
        }

        // Handle invalid tokens
        res.status(401).json({
          error: {
            code: 'INVALID_TOKEN',
            message: 'Invalid access token',
            timestamp: new Date().toISOString(),
            requestId: req.headers['x-request-id'] || 'unknown',
          },
        });
        return;
      }

      // Check token blacklist (for logout functionality)
      const blacklistKey = `token:blacklist:${token}`;
      const isBlacklisted = await redisClient.exists(blacklistKey);

      if (isBlacklisted) {
        res.status(401).json({
          error: {
            code: 'TOKEN_REVOKED',
            message: 'Access token has been revoked',
            timestamp: new Date().toISOString(),
            requestId: req.headers['x-request-id'] || 'unknown',
          },
        });
        return;
      }

      // Attach user information to request
      req.user = {
        userId: payload.userId,
        role: payload.role,
        zoneId: payload.zoneId,
        email: payload.email,
      };

      next();
    } catch (error) {
      console.error('Authentication error:', error);
      res.status(500).json({
        error: {
          code: 'INTERNAL_SERVER_ERROR',
          message: 'An error occurred during authentication',
          timestamp: new Date().toISOString(),
          requestId: req.headers['x-request-id'] || 'unknown',
        },
      });
    }
  };
}

/**
 * Role-based authorization middleware
 *
 * Restricts access to routes based on user role.
 * Must be used after authenticateJWT middleware.
 *
 * @param allowedRoles - Array of roles that can access the route
 * @returns Express middleware function
 *
 * @example
 * // Only coordinators and admins can access
 * router.get('/admin', authenticateJWT(redisClient), requireRole(['coordinator', 'admin']), handler);
 */
export function requireRole(allowedRoles: UserRole[]) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      res.status(401).json({
        error: {
          code: 'UNAUTHORIZED',
          message: 'Authentication required',
          timestamp: new Date().toISOString(),
          requestId: req.headers['x-request-id'] || 'unknown',
        },
      });
      return;
    }

    if (!allowedRoles.includes(req.user.role)) {
      res.status(403).json({
        error: {
          code: 'FORBIDDEN',
          message: 'Insufficient permissions',
          details: {
            requiredRoles: allowedRoles,
            userRole: req.user.role,
          },
          timestamp: new Date().toISOString(),
          requestId: req.headers['x-request-id'] || 'unknown',
        },
      });
      return;
    }

    next();
  };
}

/**
 * Blacklist a JWT token (for logout functionality)
 *
 * Adds token to Redis blacklist with expiration derived from token's exp claim.
 * This prevents the token from being used even if it hasn't expired yet.
 *
 * @param redisClient - Redis client for token blacklist
 * @param token - JWT token to blacklist
 * @param expirySeconds - Optional TTL override in seconds (default: derived from token exp)
 *
 * @example
 * // Logout endpoint (TTL auto-derived from token)
 * router.post('/logout', authenticateJWT(redisClient), async (req, res) => {
 *   const token = req.headers.authorization?.split(' ')[1];
 *   if (token) {
 *     await blacklistToken(redisClient, token);
 *   }
 *   res.json({ message: 'Logged out successfully' });
 * });
 */
export async function blacklistToken(
  redisClient: ReturnType<typeof createClient>,
  token: string,
  expirySeconds?: number
): Promise<void> {
  let ttl = expirySeconds;

  // If no explicit TTL provided, derive from token's exp claim
  if (ttl === undefined) {
    try {
      const decoded = decodeToken(token);

      if (decoded?.exp) {
        const nowInSeconds = Math.floor(Date.now() / 1000);
        ttl = Math.ceil(decoded.exp - nowInSeconds);

        // Don't blacklist if token is already expired
        if (ttl <= 0) {
          logInfo('Token already expired, skipping blacklist', {
            ttlSeconds: ttl,
          });
          return;
        }
      } else if (decoded) {
        logError('Token missing exp claim, using fallback TTL', new Error('No exp in JWT'));
        ttl = 3600; // Fallback to 1 hour
      } else {
        throw new Error('Unable to decode token');
      }
    } catch (error) {
      logError(
        'Failed to decode token for TTL calculation',
        error instanceof Error ? error : new Error(String(error))
      );
      ttl = 3600; // Fallback to 1 hour on decode error
    }
  }

  const blacklistKey = `token:blacklist:${token}`;
  await redisClient.setEx(blacklistKey, ttl, '1');
}
