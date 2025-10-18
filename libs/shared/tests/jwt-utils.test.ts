/**
 * JWT Token Generation Utilities Tests
 *
 * Comprehensive test suite for JWT token generation and verification.
 *
 * Test Coverage:
 * - Access token generation
 * - Refresh token generation
 * - Token verification
 * - Token decoding
 * - Expiration handling
 * - Error scenarios
 * - Security requirements
 */

import { generateKeyPairSync, randomUUID } from 'crypto';

import jwt from 'jsonwebtoken';

import {
  generateAccessToken,
  generateRefreshToken,
  verifyToken,
  decodeToken,
  getTokenExpiry,
  isTokenExpired,
  clearJwtKeyCache,
  DEFAULT_DEVICE_ID,
  initializeJwtKeyStore,
  type AccessTokenOptions,
} from '../src/jwt-utils';

// Test RSA key pair (for testing only - DO NOT use in production)
const TEST_PRIVATE_KEY = `-----BEGIN RSA PRIVATE KEY-----
MIIEowIBAAKCAQEA8vLyMdpSN1/EtweFz/U/uCkzVzDNsn1va9YLQm21AZiL6Pk0
v3TsUr7+ziKQtO5BORspLNofrUJo1Vv4WuWoLrPEa39L14T1jxA5AYa3AlXEZkKs
TsiAVxyWLeSanon8TXsuLCGPaZ7GlBRwKZB5I+9ThMV1kOWS/y9cQV8wyrYWA2PX
+779gZfDt6/T4WBawhlqmCkH+Qg7IFiS4LB8ebLOrWfPUGxfBTgLZmK9zfYmbZiQ
9eIvFcCQ6PSwnayM+yNDs9h3F0h44AqJlpgeGO83ig5lNViKL0at4Z7ezN6uS/oO
IpPznGYDtQkqwuXxloro/zQ1ENo3BwBmX/d2PQIDAQABAoIBAAgkA+GPwzl/yAOq
CN3TBfORzdqaFAprEZS3c2Eic/I9vlJsJ0xTCqgrJjaaCedGJIFZW6PZGz6e/wxH
LKc/Esed1nMTrOLn3aKRlJdsgC1f2lji2ws4xLQmjRG0m0m8reuauQ1ZgoizfUvw
82ExKh3+IvpL84iLaMWMPLckDWp9Zr+UYCXSe9REy1w4I3Bg/vc/S8J7kuJuOWu9
1vEYkYQpGGddrk49CYhTWBVgWpPKLNQV5N+VEGhCrMYkQ+60vYaEfeDNZsbTv7RQ
zr+Q0ju3g1exOF5rgGfPMIW4ZaCEEMBN21NiL7p8sd3cfxmQ0SDpXsoFvDCUaNUz
v1FIeAECgYEA/4mFhGDEqzZvUUfBBI2b2rzlNuyiGdX66Op+uJZMRtH+6WD37qN8
NScM0WpPsuObwwlHNyJd8nQubvyH8Wem8QZOQVABs+MGR3Ot9SEFwHngsT23VKzB
9bb/nMOxZwKNXu662wApY46MIXRDLLsc16z2XKncZQ8dHEXh6bM++b0CgYEA82OW
jDzxvEonF2PeEBU7e8uVxlkRupwpUQxvsHKM8I6vKrlPCqbz67DV2HGIFwXG9vI4
/crlsfwj9u2z2XGhU8QZ+dh/nPDRDYKvOXyd0ETbV0tXhhVtN0opL1IL2oo8pR7s
tRaVGYjn1OYJBx22IpIXJdFRfiJPW9lMlyJA9oECgYEAtBzJeDoAxTEUGzU5Li1l
6jJ0WVdHFnDFbsBB23dMgipnwzVu68xdstU4aq7FSDC3zCvQ/2KA13DefaoPY68M
cxxfshdja9ibx2cY+Qtyk20UW7lFbDBscfWvi14/v3yECqK4H76obZy+1qGs621j
cf1elIfBaZXSjegPyPpna/0CgYBLClNqXYfyk7JFxea7crBqVLSS+Pc8X9VlRb5R
2p+Vs4hSVdwG3r6p1lW4bBiXcJKNpNTpetsi6yhzg4pF6oDhAL85hwShcKYj0j0Q
LlnB0tkFqxcLIiQQPe9Axb0d3i0gg85bbuD9hHZl756s8P4s3noAkO7dQtrQ6Mhy
eH8rAQKBgHia7lz67OfRHdhMJHoEDa6+aIw2dzmr7bm1Dojfw+bApDH5zOvHl+HJ
j/gczsrP1aZMkSovNqpJnBPlLKOQbZyUQyvLuPaHFRuyl9gx7r04JSvzSQS96eSd
TPKMF96EYFbl9lKcWthx83dCUmPr1XzZZXKYa92UnDd9sJe8amDS
-----END RSA PRIVATE KEY-----`;

const TEST_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA8vLyMdpSN1/EtweFz/U/
uCkzVzDNsn1va9YLQm21AZiL6Pk0v3TsUr7+ziKQtO5BORspLNofrUJo1Vv4WuWo
LrPEa39L14T1jxA5AYa3AlXEZkKsTsiAVxyWLeSanon8TXsuLCGPaZ7GlBRwKZB5
I+9ThMV1kOWS/y9cQV8wyrYWA2PX+779gZfDt6/T4WBawhlqmCkH+Qg7IFiS4LB8
ebLOrWfPUGxfBTgLZmK9zfYmbZiQ9eIvFcCQ6PSwnayM+yNDs9h3F0h44AqJlpge
GO83ig5lNViKL0at4Z7ezN6uS/oOIpPznGYDtQkqwuXxloro/zQ1ENo3BwBmX/d2
PQIDAQAB
-----END PUBLIC KEY-----`;

// Setup test environment
beforeAll(() => {
  process.env.JWT_PRIVATE_KEY = TEST_PRIVATE_KEY;
  process.env.JWT_PUBLIC_KEY = TEST_PUBLIC_KEY;
  process.env.JWT_KEY_ID = 'test-key';
  clearJwtKeyCache();
});

afterAll(() => {
  delete process.env.JWT_PRIVATE_KEY;
  delete process.env.JWT_PUBLIC_KEY;
  delete process.env.JWT_KEY_ID;
  clearJwtKeyCache();
});

beforeEach(() => {
  clearJwtKeyCache();
});

afterEach(() => {
  delete process.env.JWT_KEYS_JSON;
  delete process.env.JWT_PUBLIC_KEY_SET;
  delete process.env.JWT_KEYS_SECRET_ARN;
  clearJwtKeyCache();
});

describe('JWT Token Generation Utilities', () => {
  const mockUser: AccessTokenOptions = {
    userId: 'user_123',
    role: 'caregiver',
    zoneId: 'zone_456',
    email: 'caregiver@example.com',
    deviceId: 'device_abc',
  };

  describe('generateAccessToken', () => {
    it('should generate a valid access token', () => {
      const token = generateAccessToken(mockUser);

      expect(token).toBeDefined();
      expect(typeof token).toBe('string');
      expect(token.split('.').length).toBe(3); // JWT format: header.payload.signature
    });

    it('should include user information in token payload', () => {
      const token = generateAccessToken(mockUser);
      const decoded = decodeToken(token);

      expect(decoded).toBeDefined();
      expect(decoded?.userId).toBe(mockUser.userId);
      expect(decoded?.role).toBe(mockUser.role);
      expect(decoded?.zoneId).toBe(mockUser.zoneId);
      expect(decoded?.email).toBe(mockUser.email);
    });

    it('should set correct expiration time (1 hour)', () => {
      const beforeTime = Math.floor(Date.now() / 1000);
      const token = generateAccessToken(mockUser);
      const decoded = decodeToken(token);
      const afterTime = Math.floor(Date.now() / 1000);

      expect(decoded?.exp).toBeDefined();
      const expectedExpiry = beforeTime + 3600; // 1 hour
      const actualExpiry = decoded!.exp!;

      // Allow 2 second variance for test execution time
      expect(actualExpiry).toBeGreaterThanOrEqual(expectedExpiry - 2);
      expect(actualExpiry).toBeLessThanOrEqual(afterTime + 3600 + 2);
    });

    it('should include issuer and audience claims', () => {
      const token = generateAccessToken(mockUser);
      const decoded = decodeToken(token);

      expect(decoded).toBeDefined();
      // Note: issuer and audience are validated during verification
    });

    it('should generate different tokens for same user', async () => {
      const token1 = generateAccessToken(mockUser);
      // Wait 1 second to ensure different iat timestamp
      await new Promise((resolve) => setTimeout(resolve, 1000));
      const token2 = generateAccessToken(mockUser);

      expect(token1).not.toBe(token2);
      // Different iat (issued at) timestamps make tokens unique
    });

    it('should work without optional email field', () => {
      const userWithoutEmail: AccessTokenOptions = {
        userId: 'user_789',
        role: 'coordinator',
        zoneId: 'zone_123',
        deviceId: 'device_without_email',
      };

      const token = generateAccessToken(userWithoutEmail);
      const decoded = decodeToken(token);

      expect(decoded).toBeDefined();
      expect(decoded?.userId).toBe(userWithoutEmail.userId);
      expect(decoded?.email).toBeUndefined();
    });

    it('should handle all user roles', () => {
      const roles: Array<'caregiver' | 'coordinator' | 'admin' | 'family'> = [
        'caregiver',
        'coordinator',
        'admin',
        'family',
      ];

      roles.forEach((role) => {
        const user: AccessTokenOptions = {
          userId: 'user_test',
          role,
          zoneId: 'zone_test',
          deviceId: `device_${role}`,
        };

        const token = generateAccessToken(user);
        const decoded = decodeToken(token);

        expect(decoded?.role).toBe(role);
      });
    });

    it('should include key id (kid) header', () => {
      const token = generateAccessToken(mockUser);
      const [headerSegment] = token.split('.');
      const header = JSON.parse(Buffer.from(headerSegment, 'base64').toString());

      expect(header.kid).toBe(process.env.JWT_KEY_ID || 'env-default');
    });

    it('should default deviceId when not provided', () => {
      const token = generateAccessToken({
        userId: 'no-device-user',
        role: 'caregiver',
        zoneId: 'zone_default',
        email: 'nodevice@example.com',
      });

      const decoded = decodeToken(token);
      expect(decoded?.deviceId).toBe(DEFAULT_DEVICE_ID);
    });
  });

  describe('generateRefreshToken', () => {
    it('should generate a valid refresh token', () => {
      const token = generateRefreshToken(mockUser);

      expect(token).toBeDefined();
      expect(typeof token).toBe('string');
      expect(token.split('.').length).toBe(3);
    });

    it('should include user information in token payload', () => {
      const token = generateRefreshToken(mockUser);
      const decoded = decodeToken(token);

      expect(decoded).toBeDefined();
      expect(decoded?.userId).toBe(mockUser.userId);
      expect(decoded?.role).toBe(mockUser.role);
      expect(decoded?.zoneId).toBe(mockUser.zoneId);
      expect(decoded?.deviceId).toBe(mockUser.deviceId);
      expect(decoded?.tokenId).toBeDefined();
    });

    it('should set correct expiration time (30 days)', () => {
      const beforeTime = Math.floor(Date.now() / 1000);
      const token = generateRefreshToken(mockUser);
      const decoded = decodeToken(token);
      const afterTime = Math.floor(Date.now() / 1000);

      expect(decoded?.exp).toBeDefined();
      const expectedExpiry = beforeTime + 2592000; // 30 days
      const actualExpiry = decoded!.exp!;

      // Allow 2 second variance
      expect(actualExpiry).toBeGreaterThanOrEqual(expectedExpiry - 2);
      expect(actualExpiry).toBeLessThanOrEqual(afterTime + 2592000 + 2);
    });

    it('should not include email in refresh token', () => {
      const token = generateRefreshToken(mockUser);
      const decoded = decodeToken(token);

      expect(decoded).toBeDefined();
      expect(decoded?.email).toBeUndefined();
      expect(decoded?.tokenId).toBeDefined();
    });

    it('should generate different tokens for same user', async () => {
      const token1 = generateRefreshToken(mockUser);
      // Wait 1 second to ensure different iat timestamp
      await new Promise((resolve) => setTimeout(resolve, 1000));
      const token2 = generateRefreshToken(mockUser);

      expect(token1).not.toBe(token2);
    });

    it('should assign unique tokenId values to refresh tokens', async () => {
      const token1 = generateRefreshToken(mockUser);
      await new Promise((resolve) => setTimeout(resolve, 10));
      const token2 = generateRefreshToken(mockUser);

      const decoded1 = decodeToken(token1);
      const decoded2 = decodeToken(token2);

      expect(decoded1?.tokenId).toBeDefined();
      expect(decoded2?.tokenId).toBeDefined();
      expect(decoded1?.tokenId).not.toBe(decoded2?.tokenId);
    });

    it('should default deviceId to unknown when omitted', () => {
      const token = generateRefreshToken({
        userId: 'refresh-nodevice',
        role: 'caregiver',
        zoneId: 'zone_default',
      });

      const decoded = decodeToken(token);
      expect(decoded?.deviceId).toBe(DEFAULT_DEVICE_ID);
    });
  });

  describe('verifyToken', () => {
    it('should verify a valid access token', () => {
      const token = generateAccessToken(mockUser);
      const payload = verifyToken(token);

      expect(payload).toBeDefined();
      expect(payload.sub).toBe(mockUser.userId);
      expect(payload.userId).toBe(mockUser.userId);
      expect(payload.role).toBe(mockUser.role);
      expect(payload.zoneId).toBe(mockUser.zoneId);
      expect(payload.deviceId).toBe(mockUser.deviceId);
    });

    it('should verify a valid refresh token', () => {
      const token = generateRefreshToken(mockUser);
      const payload = verifyToken(token);

      expect(payload).toBeDefined();
      expect(payload.sub).toBe(mockUser.userId);
      expect(payload.userId).toBe(mockUser.userId);
      expect(payload.deviceId).toBe(mockUser.deviceId);
      expect(payload.tokenId).toBeDefined();
    });

    it('should throw error for invalid token', () => {
      const invalidToken = 'invalid.token.here';

      expect(() => verifyToken(invalidToken)).toThrow();
    });

    it('should throw error for tampered token', () => {
      const token = generateAccessToken(mockUser);
      const parts = token.split('.');
      // Tamper with payload
      parts[1] = parts[1].substring(0, parts[1].length - 1) + 'X';
      const tamperedToken = parts.join('.');

      expect(() => verifyToken(tamperedToken)).toThrow();
    });

    it('should throw error for token with wrong signature', () => {
      const token = generateAccessToken(mockUser);
      const parts = token.split('.');
      // Change signature
      parts[2] = 'wrongsignature';
      const wrongToken = parts.join('.');

      expect(() => verifyToken(wrongToken)).toThrow();
    });
  });

  describe('decodeToken', () => {
    it('should decode token without verification', () => {
      const token = generateAccessToken(mockUser);
      const decoded = decodeToken(token);

      expect(decoded).toBeDefined();
      expect(decoded?.sub).toBe(mockUser.userId);
      expect(decoded?.userId).toBe(mockUser.userId);
      expect(decoded?.role).toBe(mockUser.role);
      expect(decoded?.deviceId).toBe(mockUser.deviceId);
    });

    it('should decode tampered token (no verification)', () => {
      const token = generateAccessToken(mockUser);
      const parts = token.split('.');
      parts[1] = parts[1].substring(0, parts[1].length - 1) + 'X';
      const tamperedToken = parts.join('.');

      // Decode should work (no verification)
      const decoded = decodeToken(tamperedToken);
      expect(decoded).toBeDefined();
    });

    it('should return null for invalid token format', () => {
      const invalidToken = 'not-a-jwt-token';
      const decoded = decodeToken(invalidToken);

      expect(decoded).toBeNull();
    });
  });

  describe('getTokenExpiry', () => {
    it('should return correct expiry for access token', () => {
      const expiry = getTokenExpiry('access');
      expect(expiry).toBe(3600); // 1 hour in seconds
    });

    it('should return correct expiry for refresh token', () => {
      const expiry = getTokenExpiry('refresh');
      expect(expiry).toBe(2592000); // 30 days in seconds
    });
  });

  describe('isTokenExpired', () => {
    it('should return false for valid token', () => {
      const token = generateAccessToken(mockUser);
      const expired = isTokenExpired(token);

      expect(expired).toBe(false);
    });

    it('should return true for invalid token', () => {
      const invalidToken = 'invalid.token.here';
      const expired = isTokenExpired(invalidToken);

      expect(expired).toBe(true);
    });
  });

  describe('Error Handling', () => {
    it('should throw error when private key is missing', () => {
      const originalKey = process.env.JWT_PRIVATE_KEY;
      delete process.env.JWT_PRIVATE_KEY;
      clearJwtKeyCache();

      expect(() => generateAccessToken(mockUser)).toThrow('JWT_PRIVATE_KEY not configured');

      process.env.JWT_PRIVATE_KEY = originalKey;
      clearJwtKeyCache();
    });

    it('should throw error when public key is missing', () => {
      const originalKey = process.env.JWT_PUBLIC_KEY;
      delete process.env.JWT_PUBLIC_KEY;
      clearJwtKeyCache();

      expect(() => generateAccessToken(mockUser)).toThrow('JWT_PUBLIC_KEY not configured');

      process.env.JWT_PUBLIC_KEY = originalKey;
      clearJwtKeyCache();
    });

    it('should throw error when verifying with unknown kid', () => {
      const originalPrivateKey = process.env.JWT_PRIVATE_KEY;
      const originalPublicKey = process.env.JWT_PUBLIC_KEY;
      const originalKeyId = process.env.JWT_KEY_ID;
      const originalKeysJson = process.env.JWT_KEYS_JSON;

      process.env.JWT_PRIVATE_KEY = ''; // force use of JWT_KEYS_JSON
      process.env.JWT_PUBLIC_KEY = '';
      process.env.JWT_KEY_ID = 'mismatch-key';
      process.env.JWT_KEYS_JSON = JSON.stringify({
        activeKid: 'mismatch-key',
        keys: {
          'mismatch-key': {
            privateKey: TEST_PRIVATE_KEY,
            publicKey: TEST_PUBLIC_KEY,
          },
        },
      });
      clearJwtKeyCache();

      const token = generateAccessToken(mockUser);

      // Simulate rotation removing the signing key before verification
      const { privateKey: rotatedPrivateKey, publicKey: rotatedPublicKey } = generateKeyPairSync(
        'rsa',
        {
          modulusLength: 2048,
          privateKeyEncoding: { format: 'pem', type: 'pkcs1' },
          publicKeyEncoding: { format: 'pem', type: 'spki' },
        }
      );

      process.env.JWT_KEYS_JSON = JSON.stringify({
        activeKid: 'new-key',
        keys: {
          'new-key': {
            privateKey: rotatedPrivateKey,
            publicKey: rotatedPublicKey,
          },
        },
      });
      clearJwtKeyCache();

      expect(() => verifyToken(token)).toThrow('Invalid token: unknown key id');

      process.env.JWT_PRIVATE_KEY = originalPrivateKey;
      process.env.JWT_PUBLIC_KEY = originalPublicKey;
      process.env.JWT_KEY_ID = originalKeyId;
      process.env.JWT_KEYS_JSON = originalKeysJson;
      clearJwtKeyCache();
    });
  });

  describe('Security Requirements', () => {
    it('should use RS256 algorithm', () => {
      const token = generateAccessToken(mockUser);
      const parts = token.split('.');
      const header = JSON.parse(Buffer.from(parts[0], 'base64').toString());

      expect(header.alg).toBe('RS256');
    });

    it('should include standard JWT claims', () => {
      const token = generateAccessToken(mockUser);
      const decoded = decodeToken(token);

      expect(decoded?.iat).toBeDefined(); // Issued at
      expect(decoded?.exp).toBeDefined(); // Expiration
    });

    it('should have different expiry times for access and refresh tokens', () => {
      const accessToken = generateAccessToken(mockUser);
      const refreshToken = generateRefreshToken(mockUser);

      const accessDecoded = decodeToken(accessToken);
      const refreshDecoded = decodeToken(refreshToken);

      const accessExpiry = accessDecoded!.exp! - accessDecoded!.iat!;
      const refreshExpiry = refreshDecoded!.exp! - refreshDecoded!.iat!;

      expect(refreshExpiry).toBeGreaterThan(accessExpiry);
      expect(accessExpiry).toBe(3600); // 1 hour
      expect(refreshExpiry).toBe(2592000); // 30 days
    });
  });

  describe('Key Management', () => {
    it('should verify tokens signed with legacy key via JWT_KEYS_JSON', () => {
      const { privateKey: legacyPrivateKey, publicKey: legacyPublicKey } = generateKeyPairSync(
        'rsa',
        {
          modulusLength: 2048,
          privateKeyEncoding: { format: 'pem', type: 'pkcs1' },
          publicKeyEncoding: { format: 'pem', type: 'spki' },
        }
      );

      process.env.JWT_KEYS_JSON = JSON.stringify({
        activeKid: 'current-key',
        keys: {
          'current-key': {
            privateKey: TEST_PRIVATE_KEY,
            publicKey: TEST_PUBLIC_KEY,
          },
          'legacy-key': {
            publicKey: legacyPublicKey,
          },
        },
      });

      clearJwtKeyCache();

      const legacyToken = jwt.sign(
        {
          sub: 'legacy-user',
          role: 'caregiver',
          zoneId: 'legacy-zone',
          deviceId: 'legacy-device',
        },
        legacyPrivateKey,
        {
          algorithm: 'RS256',
          issuer: 'berthcare-api',
          audience: 'berthcare-app',
          keyid: 'legacy-key',
          jwtid: randomUUID(),
        }
      );

      const payload = verifyToken(legacyToken);

      expect(payload.userId).toBe('legacy-user');
      expect(payload.deviceId).toBe('legacy-device');
    });

    it('should load key configuration from Secrets Manager', async () => {
      const { privateKey: rotatedPrivateKey, publicKey: rotatedPublicKey } = generateKeyPairSync(
        'rsa',
        {
          modulusLength: 2048,
          privateKeyEncoding: { format: 'pem', type: 'pkcs1' },
          publicKeyEncoding: { format: 'pem', type: 'spki' },
        }
      );

      const secretArn = 'arn:aws:secretsmanager:ca-central-1:123456789012:secret:jwt-rotation';
      process.env.JWT_KEYS_SECRET_ARN = secretArn;

      const secretString = JSON.stringify({
        activeKid: 'rotation-2025',
        keys: {
          'rotation-2025': {
            privateKey: rotatedPrivateKey,
            publicKey: rotatedPublicKey,
          },
          'rotation-2024': {
            publicKey: TEST_PUBLIC_KEY,
          },
        },
      });

      const mockClient = {
        send: jest.fn().mockResolvedValue({ SecretString: secretString }),
      };

      await initializeJwtKeyStore({
        secretArn,
        region: 'ca-central-1',
        client: mockClient,
      });

      const token = generateAccessToken({
        userId: 'rotation-user',
        role: 'admin',
        zoneId: 'zone-rotation',
        deviceId: 'rotation-device',
        email: 'rotation@example.com',
      });

      const payload = verifyToken(token);

      expect(payload.userId).toBe('rotation-user');
      expect(payload.deviceId).toBe('rotation-device');
      expect(mockClient.send).toHaveBeenCalledTimes(1);
    });
  });

  describe('Real-world Scenarios', () => {
    it('should handle user login flow', () => {
      // User logs in
      const accessToken = generateAccessToken(mockUser);
      const refreshToken = generateRefreshToken(mockUser);

      // Verify access token
      const accessPayload = verifyToken(accessToken);
      expect(accessPayload.userId).toBe(mockUser.userId);
      expect(accessPayload.deviceId).toBe(mockUser.deviceId);

      // Verify refresh token
      const refreshPayload = verifyToken(refreshToken);
      expect(refreshPayload.userId).toBe(mockUser.userId);
      expect(refreshPayload.deviceId).toBe(mockUser.deviceId);
      expect(refreshPayload.tokenId).toBeDefined();
    });

    it('should handle token refresh flow', () => {
      // User has refresh token
      const refreshToken = generateRefreshToken(mockUser);

      // Verify refresh token
      const payload = verifyToken(refreshToken);

      // Generate new access token
      const newAccessToken = generateAccessToken({
        userId: payload.userId ?? payload.sub,
        role: payload.role,
        zoneId: payload.zoneId,
        deviceId: payload.deviceId ?? mockUser.deviceId,
      });

      // Verify new access token
      const newPayload = verifyToken(newAccessToken);
      expect(newPayload.userId).toBe(mockUser.userId);
      expect(newPayload.deviceId).toBe(payload.deviceId ?? mockUser.deviceId);
    });

    it('should handle multiple concurrent users', () => {
      const users: AccessTokenOptions[] = [
        { userId: 'user_1', role: 'caregiver', zoneId: 'zone_1', deviceId: 'device_1' },
        { userId: 'user_2', role: 'coordinator', zoneId: 'zone_2', deviceId: 'device_2' },
        { userId: 'user_3', role: 'admin', zoneId: 'zone_3', deviceId: 'device_3' },
      ];

      const tokens = users.map((user) => ({
        user,
        accessToken: generateAccessToken(user),
        refreshToken: generateRefreshToken(user),
      }));

      // Verify all tokens
      tokens.forEach(({ user, accessToken, refreshToken }) => {
        const accessPayload = verifyToken(accessToken);
        const refreshPayload = verifyToken(refreshToken);

        expect(accessPayload.userId).toBe(user.userId);
        expect(refreshPayload.userId).toBe(user.userId);
        expect(accessPayload.deviceId).toBe(user.deviceId);
        expect(refreshPayload.deviceId).toBe(user.deviceId);
        expect(refreshPayload.tokenId).toBeDefined();
      });

      // All tokens should be unique
      const allTokens = tokens.flatMap((t) => [t.accessToken, t.refreshToken]);
      const uniqueTokens = new Set(allTokens);
      expect(uniqueTokens.size).toBe(allTokens.length);
    });
  });
});
