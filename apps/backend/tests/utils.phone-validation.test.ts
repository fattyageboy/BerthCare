/**
 * Phone Validation Utility Tests
 *
 * Tests E.164 phone number validation
 */

import {
  isValidE164PhoneNumber,
  validateE164PhoneNumber,
  getPhoneValidationError,
} from '../src/utils/phone-validation';

describe('Phone Validation Utilities', () => {
  describe('isValidE164PhoneNumber', () => {
    describe('Valid E.164 formats', () => {
      it('should accept US/Canada number', () => {
        expect(isValidE164PhoneNumber('+15551234567')).toBe(true);
      });

      it('should accept UK number', () => {
        expect(isValidE164PhoneNumber('+442071234567')).toBe(true);
      });

      it('should accept Japan number', () => {
        expect(isValidE164PhoneNumber('+81312345678')).toBe(true);
      });

      it('should accept Australia number', () => {
        expect(isValidE164PhoneNumber('+61212345678')).toBe(true);
      });

      it('should accept North American number', () => {
        expect(isValidE164PhoneNumber('+12125550000')).toBe(true);
      });

      it('should accept maximum length (15 digits)', () => {
        expect(isValidE164PhoneNumber('+123456789012345')).toBe(true);
      });
    });

    describe('Invalid formats', () => {
      it('should reject null', () => {
        expect(isValidE164PhoneNumber(null)).toBe(false);
      });

      it('should reject undefined', () => {
        expect(isValidE164PhoneNumber(undefined)).toBe(false);
      });

      it('should reject empty string', () => {
        expect(isValidE164PhoneNumber('')).toBe(false);
      });

      it('should reject number without + prefix', () => {
        expect(isValidE164PhoneNumber('15551234567')).toBe(false);
      });

      it('should reject number starting with +0', () => {
        expect(isValidE164PhoneNumber('+05551234567')).toBe(false);
      });

      it('should reject number with letters', () => {
        expect(isValidE164PhoneNumber('+1555ABC4567')).toBe(false);
      });

      it('should reject number with spaces', () => {
        expect(isValidE164PhoneNumber('+1 555 123 4567')).toBe(false);
      });

      it('should reject number with dashes', () => {
        expect(isValidE164PhoneNumber('+1-555-123-4567')).toBe(false);
      });

      it('should reject number with parentheses', () => {
        expect(isValidE164PhoneNumber('+1(555)1234567')).toBe(false);
      });

      it('should reject number too long (>15 digits)', () => {
        expect(isValidE164PhoneNumber('+1234567890123456')).toBe(false);
      });

      it('should reject just + sign', () => {
        expect(isValidE164PhoneNumber('+')).toBe(false);
      });

      it('should reject + with non-digit', () => {
        expect(isValidE164PhoneNumber('+A')).toBe(false);
      });

      it('should reject single digit after +', () => {
        expect(isValidE164PhoneNumber('+1')).toBe(false);
      });

      it('should reject multiple leading zeros', () => {
        expect(isValidE164PhoneNumber('+00')).toBe(false);
      });
    });
  });

  describe('validateE164PhoneNumber', () => {
    it('should return valid phone number', () => {
      expect(validateE164PhoneNumber('+15551234567')).toBe('+15551234567');
    });

    it('should trim whitespace', () => {
      expect(validateE164PhoneNumber('  +15551234567  ')).toBe('+15551234567');
    });

    it('should return null for invalid format', () => {
      expect(validateE164PhoneNumber('15551234567')).toBe(null);
    });

    it('should return null for null input', () => {
      expect(validateE164PhoneNumber(null)).toBe(null);
    });

    it('should return null for undefined input', () => {
      expect(validateE164PhoneNumber(undefined)).toBe(null);
    });

    it('should return null for empty string', () => {
      expect(validateE164PhoneNumber('')).toBe(null);
    });
  });

  describe('getPhoneValidationError', () => {
    it('should return error for null', () => {
      expect(getPhoneValidationError(null)).toBe('Phone number is required');
    });

    it('should return error for undefined', () => {
      expect(getPhoneValidationError(undefined)).toBe('Phone number is required');
    });

    it('should return error for empty string', () => {
      expect(getPhoneValidationError('')).toBe('Phone number is required');
    });

    it('should return error for missing + prefix', () => {
      expect(getPhoneValidationError('15551234567')).toBe(
        'Phone number must start with + (E.164 format)'
      );
    });

    it('should return error for +0 prefix', () => {
      expect(getPhoneValidationError('+05551234567')).toBe(
        'Phone number cannot start with +0 (country codes start with 1-9)'
      );
    });

    it('should return error for too long', () => {
      expect(getPhoneValidationError('+1234567890123456')).toBe(
        'Phone number is too long (max 15 digits after +)'
      );
    });

    it('should return error for letters', () => {
      expect(getPhoneValidationError('+1555ABC4567')).toBe(
        'Phone number must contain only digits after the +'
      );
    });

    it('should return error for spaces', () => {
      expect(getPhoneValidationError('+1 555 123 4567')).toBe(
        'Phone number must contain only digits after the +'
      );
    });

    it('should return error for just + sign', () => {
      const error = getPhoneValidationError('+');
      expect(error).toBe('Phone number is too short');
    });
  });
});
