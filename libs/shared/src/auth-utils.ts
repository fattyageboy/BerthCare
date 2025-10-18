/**
 * Authentication Utilities
 *
 * Task A2: Implement password hashing
 * Create auth utility module using bcrypt (cost factor 12);
 * implement hashPassword() and verifyPassword() functions;
 * add unit tests (valid password, invalid password, timing attack resistance).
 *
 * Provides secure password hashing and verification using bcrypt.
 *
 * Security Features:
 * - Bcrypt with cost factor 12 (~200ms hashing time)
 * - Automatic salt generation
 * - Timing attack resistance via constant-time comparison
 * - Industry-standard password security
 *
 * Reference: project-documentation/task-plan.md - Phase A – Authentication & Authorization
 * Reference: Architecture Blueprint - Security section
 *
 * Philosophy: "Uncompromising Security"
 * - Use proven security patterns, don't invent your own
 * - Password security is non-negotiable
 * - Every detail matters when it comes to user data
 */

import bcrypt from 'bcrypt';

/**
 * Bcrypt cost factor (number of hashing rounds)
 *
 * Cost factor 12 provides:
 * - ~200ms hashing time (secure but not too slow)
 * - 2^12 = 4,096 iterations
 * - Strong protection against brute force attacks
 * - Balanced security vs performance
 *
 * Note: Each increment doubles the time and computational cost
 */
const BCRYPT_COST_FACTOR = 12;

/**
 * Hash a plaintext password using bcrypt
 *
 * Process:
 * 1. Generate random salt (automatic with bcrypt)
 * 2. Hash password with salt using cost factor 12
 * 3. Return combined salt + hash string
 *
 * The returned hash includes:
 * - Algorithm identifier ($2b$)
 * - Cost factor (12)
 * - Salt (22 characters)
 * - Hash (31 characters)
 *
 * Example output: $2b$12$R9h/cIPz0gi.URNNX3kh2OPST9/PgBkqquzi.Ss7KIUgO2t0jWMUW
 *
 * @param password - Plaintext password to hash
 * @returns Promise resolving to bcrypt hash string
 * @throws Error if hashing fails
 *
 * @example
 * const hash = await hashPassword('mySecurePassword123');
 * // Store hash in database, never store plaintext password
 */
export async function hashPassword(password: string): Promise<string> {
  if (typeof password !== 'string') {
    throw new Error('Password must be a non-empty string');
  }

  if (!password || password.length < 1) {
    throw new Error('Password cannot be empty');
  }

  try {
    const hash = await bcrypt.hash(password, BCRYPT_COST_FACTOR);
    return hash;
  } catch (error) {
    throw new Error(
      `Password hashing failed: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}

/**
 * Verify a plaintext password against a bcrypt hash
 *
 * Process:
 * 1. Extract salt from stored hash
 * 2. Hash provided password with same salt
 * 3. Compare hashes using constant-time comparison
 * 4. Return true if match, false otherwise
 *
 * Security Features:
 * - Constant-time comparison (timing attack resistant)
 * - No information leakage about password correctness
 * - Safe against side-channel attacks
 *
 * @param password - Plaintext password to verify
 * @param hash - Bcrypt hash to compare against
 * @returns Promise resolving to true if password matches, false otherwise
 * @throws Error if verification process fails (not if password is wrong)
 *
 * @example
 * const isValid = await verifyPassword('mySecurePassword123', storedHash);
 * if (isValid) {
 *   // Password is correct, proceed with authentication
 * } else {
 *   // Password is incorrect, deny access
 * }
 */
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  if (!password || typeof password !== 'string') {
    throw new Error('Password must be a non-empty string');
  }

  if (!hash || typeof hash !== 'string') {
    throw new Error('Hash must be a non-empty string');
  }

  // Validate hash format (bcrypt hashes start with $2a$, $2b$, or $2y$)
  if (!hash.match(/^\$2[aby]\$\d{2}\$/)) {
    throw new Error('Invalid bcrypt hash format');
  }

  try {
    const isMatch = await bcrypt.compare(password, hash);
    return isMatch;
  } catch (error) {
    throw new Error(
      `Password verification failed: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}

/**
 * Get the current bcrypt cost factor
 *
 * Useful for:
 * - Testing and verification
 * - Monitoring hash generation time
 * - Validating security configuration
 *
 * @returns The bcrypt cost factor (12)
 */
export function getBcryptCostFactor(): number {
  return BCRYPT_COST_FACTOR;
}

/**
 * Estimate hashing time for current cost factor
 *
 * Provides approximate time for password hashing operation.
 * Actual time may vary based on system performance.
 *
 * @returns Estimated hashing time in milliseconds (~200ms for cost factor 12)
 */
export function getEstimatedHashingTime(): number {
  // Cost factor 12 typically takes ~200ms on modern hardware
  // Each increment doubles the time: 10=~50ms, 11=~100ms, 12=~200ms, 13=~400ms
  return Math.pow(2, BCRYPT_COST_FACTOR - 10) * 50;
}
