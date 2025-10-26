/**
 * BerthCare Shared Library
 *
 * Shared utilities, types, and functions used across the monorepo.
 */

export const version = '1.0.0';

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
  type UserRole,
  type JWTPayload,
  type TokenOptions,
} from './jwt-utils';
