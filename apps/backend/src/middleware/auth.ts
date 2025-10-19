/**
 * JWT Authentication Middleware
 *
 * Task A7: Implement JWT authentication middleware
 * Create Express middleware to verify JWT on protected routes; extract user from token;
 * attach to req.user; handle expired tokens (401); handle invalid tokens (401);
 * implement token blacklist using Redis (for logout).
 *
 * Task A8: Implement role-based authorization middleware
 * Create middleware to check user role against required roles; support multiple roles
 * per endpoint; return 403 for insufficient permissions.
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
 * Reference: project-documentation/task-plan.md - Phase A – Authentication & Authorization
 * Reference: Architecture Blueprint - API Gateway, JWT authentication
 *
 * Philosophy: "Uncompromising Security"
 * - Stateless authentication for horizontal scalability
 * - Token blacklist for logout functionality
 * - Clear error messages without leaking security details
 * - Multiple layers of validation
 */

import { Request, Response, NextFunction } from 'express';

import {
  verifyToken,
  JWTPayload,
  UserRole,
  DEFAULT_DEVICE_ID,
  getRolePermissions,
  hasRole,
  hasPermission,
} from '@berthcare/shared';
import type { Permission } from '@berthcare/shared';

import { RedisClient } from '../cache/redis-client';

/**
 * Extended Express Request with authenticated user
 */
export interface AuthenticatedRequest extends Request {
  user?: {
    userId: string;
    role: UserRole;
    zoneId: string;
    email?: string;
    deviceId: string;
    permissions?: Permission[];
  };
}

type RoleInput = UserRole | UserRole[] | null | undefined;
type PermissionInput = Permission | Permission[] | null | undefined;

interface AuthorizeOptions {
  enforceZoneCheck?: boolean;
  zoneParam?: string;
  allowAdminZoneBypass?: boolean;
  zoneResolver?: (req: AuthenticatedRequest) => string | null | undefined;
}

interface AuthorizeConfig extends AuthorizeOptions {
  roles?: RoleInput;
  permissions?: PermissionInput;
}

const AUTHORIZE_OPTIONS_KEYS = new Set([
  'enforceZoneCheck',
  'zoneParam',
  'allowAdminZoneBypass',
  'zoneResolver',
  'roles',
  'permissions',
]);

function extractRequestId(req: Request): string {
  const header = req.headers['x-request-id'];
  if (Array.isArray(header)) {
    return header[0] ?? 'unknown';
  }

  if (typeof header === 'string' && header.trim().length > 0) {
    return header;
  }

  return 'unknown';
}

function buildAuthErrorResponse(
  req: Request,
  code: string,
  message: string,
  details?: Record<string, unknown>
) {
  return {
    error: {
      code,
      message,
      ...(details ? { details } : {}),
      timestamp: new Date().toISOString(),
      requestId: extractRequestId(req),
    },
  };
}

function toRoleArray(input: RoleInput): UserRole[] {
  if (!input) {
    return [];
  }

  const roles = Array.isArray(input) ? input : [input];
  return Array.from(new Set(roles));
}

function toPermissionArray(input: PermissionInput): Permission[] {
  if (!input) {
    return [];
  }

  const permissions = Array.isArray(input) ? input : [input];
  return Array.from(new Set(permissions));
}

function isAuthorizeConfigObject(value: unknown): value is AuthorizeConfig {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  return Object.keys(value as Record<string, unknown>).some((key) =>
    AUTHORIZE_OPTIONS_KEYS.has(key)
  );
}

function isAuthorizeOptionsCandidate(value: unknown): value is AuthorizeOptions {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  return Object.keys(value as Record<string, unknown>).some((key) =>
    AUTHORIZE_OPTIONS_KEYS.has(key)
  );
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
export function authenticateJWT(redisClient: RedisClient) {
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
      const resolvedPermissions =
        Array.isArray(payload.permissions) && payload.permissions.length > 0
          ? (Array.from(new Set(payload.permissions)) as Permission[])
          : getRolePermissions(payload.role);

      const userId = payload.userId ?? payload.sub;
      if (!userId) {
        res.status(401).json({
          error: {
            code: 'INVALID_TOKEN',
            message: 'Token payload missing user identifier',
            timestamp: new Date().toISOString(),
            requestId: req.headers['x-request-id'] || 'unknown',
          },
        });
        return;
      }

      const userContext: NonNullable<AuthenticatedRequest['user']> = {
        userId,
        role: payload.role,
        zoneId: payload.zoneId,
        deviceId: payload.deviceId ?? DEFAULT_DEVICE_ID,
        permissions: resolvedPermissions,
      };

      if (payload.email) {
        userContext.email = payload.email;
      }

      req.user = userContext;

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
 * Configurable authorization middleware enforcing roles, permissions, and zone access rules.
 *
 * Supports multiple calling conventions:
 * - `authorize(['coordinator', 'admin'])`
 * - `authorize(['caregiver'], ['create:visit', 'update:visit'])`
 * - `authorize({ roles: ['coordinator'], permissions: ['update:client'], zoneParam: 'zoneId' })`
 *
 * @param rolesOrConfig - Roles array or configuration object
 * @param permissionsOrOptions - Required permissions or additional options
 * @param maybeOptions - Optional configuration when using positional arguments
 */
export function authorize(
  rolesOrConfig?: RoleInput | AuthorizeConfig,
  permissionsOrOptions?: PermissionInput | AuthorizeOptions | null,
  maybeOptions?: AuthorizeOptions
) {
  let config: AuthorizeConfig;

  if (isAuthorizeConfigObject(rolesOrConfig)) {
    config = { ...rolesOrConfig };

    if (permissionsOrOptions && isAuthorizeOptionsCandidate(permissionsOrOptions)) {
      config = { ...config, ...permissionsOrOptions };
      if (maybeOptions) {
        config = { ...config, ...maybeOptions };
      }
    } else if (permissionsOrOptions !== undefined && permissionsOrOptions !== null) {
      config = { ...config, permissions: permissionsOrOptions as PermissionInput };
      if (maybeOptions) {
        config = { ...config, ...maybeOptions };
      }
    } else if (maybeOptions) {
      config = { ...config, ...maybeOptions };
    }
  } else {
    let permissions: PermissionInput | undefined;
    let options: AuthorizeOptions | undefined;

    if (permissionsOrOptions && isAuthorizeOptionsCandidate(permissionsOrOptions)) {
      options = permissionsOrOptions;
    } else {
      permissions = permissionsOrOptions as PermissionInput;
      options = maybeOptions;
    }

    config = {
      roles: rolesOrConfig,
      permissions,
      ...options,
    };
  }

  const requiredRoles = toRoleArray(config.roles);
  const requiredPermissions = toPermissionArray(config.permissions);
  const {
    enforceZoneCheck = true,
    zoneParam = 'zoneId',
    allowAdminZoneBypass = true,
    zoneResolver,
  } = config;

  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      res
        .status(401)
        .json(
          buildAuthErrorResponse(
            req,
            'AUTH_UNAUTHENTICATED',
            'Authentication is required to access this resource'
          )
        );
      return;
    }

    const user = req.user;

    if (requiredRoles.length > 0 && !hasRole(user, requiredRoles)) {
      res.status(403).json(
        buildAuthErrorResponse(
          req,
          'AUTH_INSUFFICIENT_ROLE',
          'You do not have permission to access this resource',
          {
            requiredRoles,
            userRole: user.role,
          }
        )
      );
      return;
    }

    if (requiredPermissions.length > 0 && !hasPermission(user, requiredPermissions)) {
      res.status(403).json(
        buildAuthErrorResponse(
          req,
          'AUTH_INSUFFICIENT_PERMISSIONS',
          'You do not have permission to perform this action',
          {
            requiredPermissions,
          }
        )
      );
      return;
    }

    if (enforceZoneCheck) {
      let requestedZoneId: string | undefined;

      if (zoneResolver) {
        const resolvedZone = zoneResolver(req);
        if (typeof resolvedZone === 'string' && resolvedZone.trim().length > 0) {
          requestedZoneId = resolvedZone.trim();
        }
      }

      if (!requestedZoneId) {
        const sources: unknown[] = [
          req.params,
          req.query,
          typeof req.body === 'object' && req.body !== null ? req.body : undefined,
        ];

        for (const source of sources) {
          if (!source || typeof source !== 'object') {
            continue;
          }

          const rawValue = (source as Record<string, unknown>)[zoneParam];
          if (typeof rawValue === 'string') {
            const trimmedValue = rawValue.trim();
            if (trimmedValue.length > 0) {
              requestedZoneId = trimmedValue;
              break;
            }
          }
        }
      }

      if (
        requestedZoneId &&
        requestedZoneId !== user.zoneId &&
        !(allowAdminZoneBypass && user.role === 'admin')
      ) {
        res.status(403).json(
          buildAuthErrorResponse(
            req,
            'AUTH_ZONE_ACCESS_DENIED',
            'You do not have access to this zone',
            {
              requestedZoneId,
              userZoneId: user.zoneId,
            }
          )
        );
        return;
      }
    }

    next();
  };
}

/**
 * Backwards-compatible role-only convenience wrapper.
 *
 * Note: Zone enforcement is disabled to preserve previous behavior.
 */
export function requireRole(allowedRoles: UserRole | UserRole[]) {
  return authorize(allowedRoles, null, { enforceZoneCheck: false });
}

/**
 * Blacklist a JWT token (for logout functionality)
 *
 * Adds token to Redis blacklist with expiration matching token expiry.
 * This prevents the token from being used even if it hasn't expired yet.
 *
 * @param redisClient - Redis client for token blacklist
 * @param token - JWT token to blacklist
 * @param expirySeconds - Token expiry in seconds (default: 3600 = 1 hour)
 *
 * @example
 * // Logout endpoint
 * router.post('/logout', authenticateJWT(redisClient), async (req, res) => {
 *   const token = req.headers.authorization?.split(' ')[1];
 *   if (token) {
 *     await blacklistToken(redisClient, token);
 *   }
 *   res.json({ message: 'Logged out successfully' });
 * });
 */
export async function blacklistToken(
  redisClient: RedisClient,
  token: string,
  expirySeconds: number = 3600
): Promise<void> {
  const blacklistKey = `token:blacklist:${token}`;
  await redisClient.setEx(blacklistKey, expirySeconds, '1');
}
