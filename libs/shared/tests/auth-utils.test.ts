/**
 * Authentication Utilities Tests
 *
 * Comprehensive test suite for password hashing and verification.
 *
 * Test Coverage:
 * - Valid password hashing
 * - Valid password verification
 * - Invalid password verification
 * - Timing attack resistance
 * - Edge cases and error handling
 * - Performance requirements
 */

import {
  hashPassword,
  verifyPassword,
  getBcryptCostFactor,
  getEstimatedHashingTime,
} from '../src/auth-utils';

describe('Authentication Utilities', () => {
  describe('hashPassword', () => {
    it('should hash a valid password', async () => {
      const password = 'mySecurePassword123';
      const hash = await hashPassword(password);

      // Bcrypt hash format: $2b$12$[22 char salt][31 char hash]
      expect(hash).toMatch(/^\$2b\$12\$/);
      expect(hash.length).toBe(60); // Standard bcrypt hash length
    });

    it('should generate different hashes for the same password', async () => {
      const password = 'samePassword';
      const hash1 = await hashPassword(password);
      const hash2 = await hashPassword(password);

      // Different salts should produce different hashes
      expect(hash1).not.toBe(hash2);
    });

    it('should hash passwords with special characters', async () => {
      const password = 'P@ssw0rd!#$%^&*()';
      const hash = await hashPassword(password);

      expect(hash).toMatch(/^\$2b\$12\$/);
      expect(hash.length).toBe(60);
    });

    it('should hash long passwords', async () => {
      const password = 'a'.repeat(100);
      const hash = await hashPassword(password);

      expect(hash).toMatch(/^\$2b\$12\$/);
      expect(hash.length).toBe(60);
    });

    it('should take approximately 200ms to hash (cost factor 12)', async () => {
      const password = 'performanceTest';
      const startTime = Date.now();

      await hashPassword(password);

      const duration = Date.now() - startTime;

      // Should take between 100ms and 500ms (allowing for system variance)
      // Target is ~200ms for cost factor 12
      expect(duration).toBeGreaterThan(100);
      expect(duration).toBeLessThan(500);
    }, 10000); // 10 second timeout for this test

    it('should throw error for empty password', async () => {
      await expect(hashPassword('')).rejects.toThrow('Password cannot be empty');
    });

    it('should throw error for non-string password', async () => {
      // @ts-expect-error Testing invalid input
      await expect(hashPassword(null)).rejects.toThrow('Password must be a non-empty string');

      // @ts-expect-error Testing invalid input
      await expect(hashPassword(undefined)).rejects.toThrow('Password must be a non-empty string');

      // @ts-expect-error Testing invalid input
      await expect(hashPassword(123)).rejects.toThrow('Password must be a non-empty string');
    });
  });

  describe('verifyPassword', () => {
    it('should verify a valid password', async () => {
      const password = 'correctPassword123';
      const hash = await hashPassword(password);

      const isValid = await verifyPassword(password, hash);

      expect(isValid).toBe(true);
    });

    it('should reject an invalid password', async () => {
      const correctPassword = 'correctPassword123';
      const wrongPassword = 'wrongPassword456';
      const hash = await hashPassword(correctPassword);

      const isValid = await verifyPassword(wrongPassword, hash);

      expect(isValid).toBe(false);
    });

    it('should reject password with slight variation', async () => {
      const password = 'Password123';
      const hash = await hashPassword(password);

      // Test case sensitivity
      const isValid1 = await verifyPassword('password123', hash);
      expect(isValid1).toBe(false);

      // Test extra character
      const isValid2 = await verifyPassword('Password123!', hash);
      expect(isValid2).toBe(false);

      // Test missing character
      const isValid3 = await verifyPassword('Password12', hash);
      expect(isValid3).toBe(false);
    });

    it('should verify password with special characters', async () => {
      const password = 'P@ssw0rd!#$%^&*()';
      const hash = await hashPassword(password);

      const isValid = await verifyPassword(password, hash);

      expect(isValid).toBe(true);
    });

    it('should verify long passwords', async () => {
      const password = 'a'.repeat(100);
      const hash = await hashPassword(password);

      const isValid = await verifyPassword(password, hash);

      expect(isValid).toBe(true);
    });

    it('should throw error for empty password', async () => {
      const hash = await hashPassword('validPassword');

      await expect(verifyPassword('', hash)).rejects.toThrow('Password must be a non-empty string');
    });

    it('should throw error for invalid hash format', async () => {
      const password = 'validPassword';
      const invalidHash = 'not-a-valid-bcrypt-hash';

      await expect(verifyPassword(password, invalidHash)).rejects.toThrow(
        'Invalid bcrypt hash format'
      );
    });

    it('should throw error for non-string inputs', async () => {
      const hash = await hashPassword('validPassword');

      // @ts-expect-error Testing invalid input
      await expect(verifyPassword(null, hash)).rejects.toThrow(
        'Password must be a non-empty string'
      );

      // @ts-expect-error Testing invalid input
      await expect(verifyPassword('validPassword', null)).rejects.toThrow(
        'Hash must be a non-empty string'
      );
    });
  });

  describe('Timing Attack Resistance', () => {
    const TIMING_ATTACK_THRESHOLD_MS = 50; // Empirically safe jitter ceiling in CI to still flag timing regressions

    it('should take similar time for correct and incorrect passwords', async () => {
      const correctPassword = 'correctPassword123';
      const wrongPassword = 'wrongPassword456';
      const hash = await hashPassword(correctPassword);

      let totalDifference = 0;
      const attempts = 5;

      for (let i = 0; i < attempts; i += 1) {
        const startCorrect = Date.now();
        await verifyPassword(correctPassword, hash);
        const durationCorrect = Date.now() - startCorrect;

        const startWrong = Date.now();
        await verifyPassword(wrongPassword, hash);
        const durationWrong = Date.now() - startWrong;

        totalDifference += Math.abs(durationCorrect - durationWrong);
      }

      const avgDifference = totalDifference / attempts;

      // Multiple samples reduce flakiness; empirically CI variance stays <50ms
      // so this tighter threshold still flags regressions in timing resistance
      expect(avgDifference).toBeLessThan(TIMING_ATTACK_THRESHOLD_MS);
    }, 10000);

    it('should take similar time for passwords of different lengths', async () => {
      const shortPassword = 'short';
      const longPassword = 'a'.repeat(50);
      const hash = await hashPassword(shortPassword);

      // Measure time for short password
      const startShort = Date.now();
      await verifyPassword(shortPassword, hash);
      const durationShort = Date.now() - startShort;

      // Measure time for long password (incorrect)
      const startLong = Date.now();
      await verifyPassword(longPassword, hash);
      const durationLong = Date.now() - startLong;

      // Times should be similar (within 50ms to match our measured CI jitter window)
      const timeDifference = Math.abs(durationShort - durationLong);
      expect(timeDifference).toBeLessThan(TIMING_ATTACK_THRESHOLD_MS);
    }, 10000);
  });

  describe('Configuration', () => {
    it('should return correct bcrypt cost factor', () => {
      const costFactor = getBcryptCostFactor();

      expect(costFactor).toBe(12);
    });

    it('should return estimated hashing time', () => {
      const estimatedTime = getEstimatedHashingTime();

      // Cost factor 12 should estimate ~200ms
      expect(estimatedTime).toBe(200);
    });
  });

  describe('Real-world Scenarios', () => {
    it('should handle user registration flow', async () => {
      // User registers with password
      const userPassword = 'newUser123!';
      const storedHash = await hashPassword(userPassword);

      // Store hash in database (simulated)
      expect(storedHash).toBeDefined();
      expect(storedHash.length).toBe(60);

      // User logs in with same password
      const loginPassword = 'newUser123!';
      const isAuthenticated = await verifyPassword(loginPassword, storedHash);

      expect(isAuthenticated).toBe(true);
    });

    it('should handle failed login attempts', async () => {
      // User has registered
      const correctPassword = 'userPassword123';
      const storedHash = await hashPassword(correctPassword);

      // Attacker tries common passwords
      const commonPasswords = ['password', '123456', 'admin', 'letmein', 'qwerty'];

      for (const attemptedPassword of commonPasswords) {
        const isAuthenticated = await verifyPassword(attemptedPassword, storedHash);
        expect(isAuthenticated).toBe(false);
      }

      // Correct password still works
      const validLogin = await verifyPassword(correctPassword, storedHash);
      expect(validLogin).toBe(true);
    }, 15000);

    it('should handle password change flow', async () => {
      // User has old password
      const oldPassword = 'oldPassword123';
      const oldHash = await hashPassword(oldPassword);

      // User changes to new password
      const newPassword = 'newPassword456';
      const newHash = await hashPassword(newPassword);

      // Old password no longer works with new hash
      const oldPasswordValid = await verifyPassword(oldPassword, newHash);
      expect(oldPasswordValid).toBe(false);

      // New password works with new hash
      const newPasswordValid = await verifyPassword(newPassword, newHash);
      expect(newPasswordValid).toBe(true);

      // Hashes are different
      expect(oldHash).not.toBe(newHash);
    }, 15000);

    it('should handle multiple users with same password', async () => {
      // Two users choose the same password (common in real world)
      const sharedPassword = 'commonPassword123';

      const user1Hash = await hashPassword(sharedPassword);
      const user2Hash = await hashPassword(sharedPassword);

      // Hashes should be different (different salts)
      expect(user1Hash).not.toBe(user2Hash);

      // Both can authenticate with their respective hashes
      const user1Valid = await verifyPassword(sharedPassword, user1Hash);
      const user2Valid = await verifyPassword(sharedPassword, user2Hash);

      expect(user1Valid).toBe(true);
      expect(user2Valid).toBe(true);
    });
  });

  describe('Edge Cases', () => {
    it('should handle password with only spaces', async () => {
      const password = '   ';
      const hash = await hashPassword(password);

      const isValid = await verifyPassword('   ', hash);
      expect(isValid).toBe(true);

      const isInvalid = await verifyPassword('  ', hash);
      expect(isInvalid).toBe(false);
    });

    it('should handle unicode characters', async () => {
      const password = '密码123🔒';
      const hash = await hashPassword(password);

      const isValid = await verifyPassword('密码123🔒', hash);
      expect(isValid).toBe(true);
    });

    it('should handle newlines and special whitespace', async () => {
      const password = 'pass\nword\t123';
      const hash = await hashPassword(password);

      const isValid = await verifyPassword('pass\nword\t123', hash);
      expect(isValid).toBe(true);
    });
  });

  describe('Performance Requirements', () => {
    it('should hash multiple passwords efficiently', async () => {
      const passwords = Array.from({ length: 5 }, (_, i) => `password${i}`);
      const startTime = Date.now();

      const hashes = await Promise.all(passwords.map((password) => hashPassword(password)));

      const duration = Date.now() - startTime;

      // 5 passwords should take roughly 5 * 200ms = 1000ms
      // Allow up to 5000ms for system variance in CI environments
      expect(duration).toBeLessThan(5000);
      expect(hashes.length).toBe(5);

      // All hashes should be unique
      const uniqueHashes = new Set(hashes);
      expect(uniqueHashes.size).toBe(5);
    }, 15000);
  });
});
