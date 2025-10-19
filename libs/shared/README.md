# BerthCare Shared Library

Shared utilities, types, and functions used across the BerthCare monorepo.

## Overview

This library provides common functionality that is shared between the backend API and mobile application, including authentication utilities, JWT token management, and shared types.

## Features

### Authentication Utilities

Secure password hashing and verification using bcrypt.

```typescript
import { hashPassword, verifyPassword } from '@berthcare/shared';

// Hash a password
const hash = await hashPassword('mySecurePassword123');

// Verify a password
const isValid = await verifyPassword('mySecurePassword123', hash);
```

**Features:**

- Bcrypt with cost factor 12 (~200ms hashing time)
- Automatic salt generation
- Timing attack resistance
- Comprehensive error handling

**Documentation:** `docs/A2-password-hashing-implementation.md`

### JWT Token Generation

Secure JWT token generation and verification using RS256 algorithm.

```typescript
import {
  generateAccessToken,
  generateRefreshToken,
  verifyToken,
  initializeJwtKeyStore,
} from '@berthcare/shared';

// Optionally load signing keys from AWS Secrets Manager
await initializeJwtKeyStore({
  secretArn: process.env.JWT_KEYS_SECRET_ARN,
  region: process.env.AWS_REGION,
});

// Generate tokens
const accessToken = generateAccessToken({
  userId: 'user_123',
  role: 'caregiver',
  zoneId: 'zone_456',
  deviceId: 'device_ios_01',
  email: 'caregiver@example.com',
});

const refreshToken = generateRefreshToken({
  userId: 'user_123',
  role: 'caregiver',
  zoneId: 'zone_456',
  deviceId: 'device_ios_01',
});

// Verify token
try {
  const payload = verifyToken(accessToken);
  console.log('User ID:', payload.userId);
  console.log('Device ID:', payload.deviceId);
} catch (error) {
  console.error('Invalid token');
}
```

**Features:**

- RS256 algorithm (asymmetric encryption)
- Key rotation support
- Device binding via `deviceId`
- Short-lived access tokens (1 hour)
- Long-lived refresh tokens (30 days)
- Comprehensive payload with user context

**Documentation:** `docs/A3-jwt-token-generation.md`

## Installation

This library is part of the BerthCare monorepo and is automatically available to all workspace projects.

```typescript
// Import in any workspace project
import { hashPassword, generateAccessToken } from '@berthcare/shared';
```

## Development

### Running Tests

```bash
# Run all tests
npx nx test shared

# Run specific test file
npx nx test shared --testFile=jwt-utils.test.ts

# Run tests in watch mode
npx nx test shared --watch
```

### Running Examples

```bash
# Password hashing demo
npx tsx libs/shared/examples/auth-utils-demo.ts

# JWT token generation demo
npx tsx libs/shared/examples/jwt-utils-demo.ts
```

## Configuration

### Environment Variables

```bash
# JWT Configuration (required for JWT utilities)
JWT_PRIVATE_KEY=your-rsa-private-key
JWT_KEY_ID=current-dev-key
JWT_PUBLIC_KEY_SET={}
JWT_KEYS_JSON=
JWT_KEYS_SECRET_ARN=
JWT_PUBLIC_KEY=your-rsa-public-key

# Notes:
# - JWT_KEY_ID identifies the signing key and must be set whenever you use JWKS (JWT_PUBLIC_KEY_SET) or a JSON keyset (JWT_KEYS_JSON / JWT_KEYS_SECRET_ARN).
# - Single-key setups supply JWT_PRIVATE_KEY + JWT_PUBLIC_KEY and skip JWKS variables; multi-key setups should provide JWT_PUBLIC_KEY_SET or JWT_KEYS_JSON / JWT_KEYS_SECRET_ARN.
# - Precedence: explicit JWT_KEYS_JSON or JWT_KEYS_SECRET_ARN (secret-managed keyset) overrides JWT_PUBLIC_KEY; if both single-key and JWKS values are provided, the JWKS/keyset is preferred.
# - Use JWT_KEYS_SECRET_ARN to load JWKS/JSON keysets from Secrets Manager and ensure JWT_KEY_ID matches the active key in that set.
# - JWT_PUBLIC_KEY_SET should hold a JWKS string for multi-key rotation; leave it empty when using single-key PEM values.
# - JWT_PRIVATE_KEY is only required when signing tokens locally; consumers verifying tokens only need the corresponding public key or JWKS entry.
```

See `.env.example` for complete configuration options.

## API Reference

### Authentication Utilities

- `hashPassword(password: string): Promise<string>` - Hash a password using bcrypt
- `verifyPassword(password: string, hash: string): Promise<boolean>` - Verify a password
- `getBcryptCostFactor(): number` - Get the bcrypt cost factor
- `getEstimatedHashingTime(): number` - Get estimated hashing time

### JWT Utilities

- `generateAccessToken(options: AccessTokenOptions): string` - Generate access token
- `generateRefreshToken(options: RefreshTokenOptions): string` - Generate refresh token
- `verifyToken(token: string): JWTPayload` - Verify and decode token
- `decodeToken(token: string): JWTPayload | null` - Decode token without verification
- `isTokenExpired(token: string): boolean` - Check if token is expired
- `getTokenExpiry(tokenType: 'access' | 'refresh'): number` - Get token expiry time
- `initializeJwtKeyStore(options?: InitializeJwtKeyStoreOptions): Promise<void>` - Load keys from AWS Secrets Manager
- `clearJwtKeyCache(): void` - Clear cached key configuration
- `DEFAULT_DEVICE_ID: string` - Default fallback when deviceId is omitted

### Types

```typescript
type UserRole = 'caregiver' | 'coordinator' | 'admin' | 'family';

interface AccessTokenOptions {
  userId: string;
  role: UserRole;
  zoneId: string;
  deviceId?: string;
  email?: string;
}

interface RefreshTokenOptions extends AccessTokenOptions {
  tokenId?: string;
}

interface JWTPayload {
  sub: string;
  userId?: string;
  role: UserRole;
  zoneId: string;
  deviceId?: string;
  tokenId?: string;
  email?: string;
  iat?: number;
  exp?: number;
}
```

## Testing

The library includes comprehensive test coverage:

- **63 tests total**
- **Password hashing:** 28 tests
- **JWT utilities:** 32 tests
- **Integration tests:** 3 tests

All tests use industry-standard security practices and cover edge cases, error scenarios, and real-world usage patterns.

## Security

This library implements security best practices:

- ✅ Bcrypt for password hashing (cost factor 12)
- ✅ RS256 algorithm for JWT tokens
- ✅ Timing attack resistance
- ✅ Comprehensive input validation
- ✅ Secure error handling
- ✅ Key rotation support

## Architecture

This library aligns with the BerthCare Architecture Blueprint:

- **Simplicity:** Clear, focused APIs
- **Security:** Industry-standard patterns
- **Reliability:** Comprehensive testing
- **Maintainability:** Well-documented code

## Contributing

When adding new utilities to this library:

1. Add implementation to `src/`
2. Export from `src/index.ts`
3. Add comprehensive tests to `tests/`
4. Add usage examples to `examples/`
5. Update this README
6. Create documentation in `docs/`

## License

MIT
