/**
 * BerthCare Shared Library
 *
 * Shared utilities, types, and functions used across the monorepo.
 */

export const version = '2.0.0';

export function greet(name: string): string {
  return `Hello, ${name}! Welcome to BerthCare.`;
}

// Export authentication utilities
export {
  hashPassword,
  verifyPassword,
  getBcryptCostFactor,
  getEstimatedHashingTime,
} from './auth-utils';

// Export JWT utilities
export {
  generateAccessToken,
  generateRefreshToken,
  verifyToken,
  decodeToken,
  getTokenExpiry,
  isTokenExpired,
  initializeJwtKeyStore,
  clearJwtKeyCache,
  DEFAULT_DEVICE_ID,
  type UserRole,
  type JWTPayload,
  type AccessTokenOptions,
  type RefreshTokenOptions,
  type InitializeJwtKeyStoreOptions,
} from './jwt-utils';

// Export authorization helpers
export {
  ROLE_PERMISSIONS,
  getRolePermissions,
  hasRole,
  hasPermission,
  type Permission,
  type AuthorizableUser,
} from './authorization';
