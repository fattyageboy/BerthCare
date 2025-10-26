/**
 * Phone Number Validation Utilities
 *
 * Validates phone numbers in E.164 format for SMS notifications
 *
 * E.164 Format:
 * - Starts with + (plus sign)
 * - Followed by country code (1-3 digits, first digit 1-9)
 * - Followed by subscriber number
 * - Total length: 1-15 digits after the +
 *
 * Examples:
 * - +15551234567 (US/Canada)
 * - +442071234567 (UK)
 * - +81312345678 (Japan)
 * - +61212345678 (Australia)
 */

/**
 * E.164 phone number regex
 * Pattern: +[1-9][0-9]{0,14}
 * - ^ and $ ensure full string match
 * - \+ matches the plus sign
 * - [1-9] ensures first digit is 1-9 (no leading zeros)
 * - [0-9]{0,14} allows 0-14 more digits (total 1-15 digits)
 */
const E164_REGEX = /^\+[1-9][0-9]{0,14}$/;

/**
 * Validate if a phone number is in E.164 format
 *
 * @param phoneNumber - Phone number to validate
 * @returns true if valid E.164 format, false otherwise
 *
 * @example
 * isValidE164PhoneNumber('+15551234567') // true
 * isValidE164PhoneNumber('+442071234567') // true
 * isValidE164PhoneNumber('5551234567') // false (missing +)
 * isValidE164PhoneNumber('+0551234567') // false (starts with 0)
 * isValidE164PhoneNumber('+1555123456789012345') // false (too long)
 */
export function isValidE164PhoneNumber(phoneNumber: string | null | undefined): boolean {
  if (!phoneNumber) {
    return false;
  }

  return E164_REGEX.test(phoneNumber.trim());
}

/**
 * Validate and normalize a phone number to E.164 format
 *
 * @param phoneNumber - Phone number to validate
 * @returns The phone number if valid, null otherwise
 *
 * @example
 * validateE164PhoneNumber('+15551234567') // '+15551234567'
 * validateE164PhoneNumber('invalid') // null
 */
export function validateE164PhoneNumber(phoneNumber: string | null | undefined): string | null {
  if (!phoneNumber) {
    return null;
  }

  const trimmed = phoneNumber.trim();

  if (!isValidE164PhoneNumber(trimmed)) {
    return null;
  }

  return trimmed;
}

/**
 * Get a descriptive error message for invalid phone numbers
 *
 * @param phoneNumber - The invalid phone number
 * @returns Error message describing the issue
 */
export function getPhoneValidationError(phoneNumber: string | null | undefined): string {
  if (!phoneNumber || phoneNumber.trim().length === 0) {
    return 'Phone number is required';
  }

  const trimmed = phoneNumber.trim();

  if (!trimmed.startsWith('+')) {
    return 'Phone number must start with + (E.164 format)';
  }

  if (trimmed.length < 2) {
    return 'Phone number is too short';
  }

  if (trimmed.length > 16) {
    // +15 digits max
    return 'Phone number is too long (max 15 digits after +)';
  }

  if (trimmed[1] === '0') {
    return 'Phone number cannot start with +0 (country codes start with 1-9)';
  }

  if (!/^\+[0-9]+$/.test(trimmed)) {
    return 'Phone number must contain only digits after the +';
  }

  return 'Phone number must be in E.164 format (e.g., +15551234567)';
}
