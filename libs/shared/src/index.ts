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
export * from './auth-utils';

// Export JWT utilities
export * from './jwt-utils';
