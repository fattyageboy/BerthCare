# A3: JWT Token Generation Implementation

**Status:** ✅ Complete  
**Task ID:** A3  
**Dependencies:** A2 (Password Hashing Implementation)  
**Estimated Time:** 1 day  
**Actual Time:** 1 day

## Overview

Implemented JWT token generation utilities using RS256 algorithm with support for key rotation. The module provides secure access and refresh token generation with comprehensive user context.

## Implementation Summary

### Files Created

1. **`libs/shared/src/jwt-utils.ts`** - Core JWT utility module
2. **`libs/shared/tests/jwt-utils.test.ts`** - Comprehensive test suite (32 tests)
3. **`libs/shared/examples/jwt-utils-demo.ts`** - Usage demonstration
4. **`docs/A3-jwt-token-generation.md`** - This documentation

### Files Modified

1. **`libs/shared/src/index.ts`** - Added JWT utility exports
2. **`.env.example`** - Added JWT configuration variables
3. **`package.json`** - Added `jsonwebtoken` dependency

## Technical Specifications

### Token Types

#### Access Token

- **Expiry:** 1 hour (3600 seconds)
- **Purpose:** API authentication and authorization
- **Payload:**
  - `sub`: Subject — mirrors `userId` for JWT spec compliance
  - `userId`: Unique user identifier (legacy compatibility)
  - `role`: User role (caregiver, coordinator, admin)
  - `zoneId`: Geographic zone for data access control
  - `deviceId`: Device identifier binding the session
  - `email`: User email (optional)
  - `iat`: Issued at timestamp (automatic)
  - `exp`: Expiration timestamp (automatic)
  - `iss`: Issuer (berthcare-api)
  - `aud`: Audience (berthcare-app)
  - `kid` (header): Key identifier for verification

#### Refresh Token

- **Expiry:** 30 days (2,592,000 seconds)
- **Purpose:** Obtain new access tokens without re-authentication
- **Payload:**
  - `sub`: Subject (user id)
  - `userId`: Unique user identifier (legacy compatibility)
  - `role`: User role
  - `zoneId`: Geographic zone
  - `deviceId`: Device identifier (matches database session)
  - `tokenId`: Unique identifier for revocation and rotation
  - `iat`: Issued at timestamp (automatic)
  - `exp`: Expiration timestamp (automatic)
  - `iss`: Issuer (berthcare-api)
  - `aud`: Audience (berthcare-app)

### Security Features

1. **RS256 Algorithm**
   - Asymmetric encryption (RSA with SHA-256)
   - Private key for signing (backend only)
   - Public key for verification (can be distributed)
   - Supports key rotation without service disruption

2. **Token Validation**
   - Signature verification
   - Expiration checking
   - Issuer and audience validation
   - Tamper detection

3. **Key Management**
   - Development: Environment variables (`JWT_PRIVATE_KEY`, `JWT_PUBLIC_KEY`, optional `JWT_KEY_ID`)
   - Production: AWS Secrets Manager via `initializeJwtKeyStore()` for automatic rotation
   - Advanced: `JWT_KEYS_JSON` / `JWT_PUBLIC_KEY_SET` for staged key rollouts and legacy support

## API Reference

### Core Functions

#### `generateAccessToken(options: AccessTokenOptions): string`

Generates a short-lived access token for API authentication.

```typescript
const accessToken = generateAccessToken({
  userId: 'user_123',
  role: 'caregiver',
  zoneId: 'zone_456',
  deviceId: 'device_ios_01',
  email: 'caregiver@example.com',
});
```

#### `generateRefreshToken(options: RefreshTokenOptions): string`

Generates a long-lived refresh token for obtaining new access tokens.

```typescript
const refreshToken = generateRefreshToken({
  userId: 'user_123',
  role: 'caregiver',
  zoneId: 'zone_456',
  deviceId: 'device_ios_01',
});
```

#### `verifyToken(token: string): JWTPayload`

Verifies token signature and expiration, returns decoded payload.

```typescript
try {
  const payload = verifyToken(token);
  console.log('User ID:', payload.userId);
} catch (error) {
  console.error('Invalid token:', error.message);
}
```

#### `decodeToken(token: string): JWTPayload | null`

Decodes token without verification (for debugging only).

```typescript
const payload = decodeToken(token);
if (payload) {
  console.log('Token expires at:', new Date(payload.exp! * 1000));
}
```

#### `isTokenExpired(token: string): boolean`

Checks if token is expired.

```typescript
if (isTokenExpired(token)) {
  console.log('Token has expired');
}
```

#### `initializeJwtKeyStore(options?: InitializeJwtKeyStoreOptions): Promise<void>`

Loads RSA key material from AWS Secrets Manager (or a provided Secrets Manager client) and stores
it in-memory for signing and verification. When `JWT_KEYS_SECRET_ARN` is configured the server will
fail fast if the secret cannot be retrieved, preventing tokens from being issued without a
matching verification key.

```typescript
await initializeJwtKeyStore({
  secretArn: process.env.JWT_KEYS_SECRET_ARN,
  region: process.env.AWS_REGION,
});
```

#### `clearJwtKeyCache(): void`

Clears the cached key configuration. This is handy in test environments or when reloading keys
without restarting the process.

#### `DEFAULT_DEVICE_ID`

Constant fallback (`'unknown-device'`) used when callers omit `deviceId`. It keeps JWT payloads
consistent while encouraging explicit device identifiers for every session.

#### `getTokenExpiry(tokenType: 'access' | 'refresh'): number`

Returns token expiry time in seconds.

```typescript
const accessExpiry = getTokenExpiry('access'); // 3600
const refreshExpiry = getTokenExpiry('refresh'); // 2592000
```

## Configuration

### Environment Variables

Add to `.env` file:

```bash
# JWT Private Key (for signing tokens)
# Generate with: openssl genrsa -out private_key.pem 2048
JWT_PRIVATE_KEY=-----BEGIN RSA PRIVATE KEY-----
...
-----END RSA PRIVATE KEY-----

# Optional: Key identifier appended to JWT header (kid)
JWT_KEY_ID=current-dev-key

# JWT Public Key (for verifying tokens)
# Generate with: openssl rsa -in private_key.pem -pubout -out public_key.pem
JWT_PUBLIC_KEY=-----BEGIN PUBLIC KEY-----
...
-----END PUBLIC KEY-----

# Optional: Additional public keys for rotated tokens (JSON)
JWT_PUBLIC_KEY_SET={}

# Optional: Inline key set override (activeKid + keys JSON)
JWT_KEYS_JSON=

# Optional: AWS Secrets Manager ARN storing key set (overrides env vars)
JWT_KEYS_SECRET_ARN=

# Optional: Token expiry times (defaults shown)
JWT_ACCESS_TOKEN_EXPIRY=1h
JWT_REFRESH_TOKEN_EXPIRY=30d
```

### Generating RSA Keys

```bash
# Generate private key
openssl genrsa -out private_key.pem 2048

# Generate public key
openssl rsa -in private_key.pem -pubout -out public_key.pem

# Optional: Base64 encode for environment variables
echo "base64:$(cat private_key.pem | base64)"
echo "base64:$(cat public_key.pem | base64)"
```

## Testing

### Run Tests

```bash
# Run JWT utility tests
npx nx test shared --testFile=jwt-utils.test.ts

# Run all shared library tests
npx nx test shared
```

### Test Coverage

- ✅ 32 tests passing
- ✅ Token generation (access and refresh)
- ✅ Token verification and validation
- ✅ Token decoding
- ✅ Expiration handling
- ✅ Error scenarios
- ✅ Security requirements
- ✅ Real-world scenarios

### Run Demo

```bash
npx tsx libs/shared/examples/jwt-utils-demo.ts
```

## Usage Examples

### User Login Flow

```typescript
import { generateAccessToken, generateRefreshToken } from '@berthcare/shared';

// User successfully authenticates
const user = {
  userId: 'user_123',
  role: 'caregiver',
  zoneId: 'zone_456',
  email: 'caregiver@example.com',
};

// Generate tokens
const accessToken = generateAccessToken(user);
const refreshToken = generateRefreshToken(user);

// Return to client
res.json({
  accessToken,
  refreshToken,
  user: {
    id: user.userId,
    email: user.email,
    role: user.role,
  },
});
```

### API Authentication Middleware

```typescript
import { verifyToken } from '@berthcare/shared';

function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  try {
    const payload = verifyToken(token);
    req.user = payload; // Attach user info to request
    next();
  } catch (error) {
    return res.status(403).json({ error: 'Invalid or expired token' });
  }
}
```

### Token Refresh Flow

```typescript
import { verifyToken, generateAccessToken } from '@berthcare/shared';

app.post('/auth/refresh', (req, res) => {
  const { refreshToken } = req.body;

  try {
    // Verify refresh token
    const payload = verifyToken(refreshToken);

    // Generate new access token
    const newAccessToken = generateAccessToken({
      userId: payload.userId,
      role: payload.role,
      zoneId: payload.zoneId,
    });

    res.json({ accessToken: newAccessToken });
  } catch (error) {
    res.status(403).json({ error: 'Invalid refresh token' });
  }
});
```

## Security Considerations

### Production Deployment

1. **Key Management**
   - Store private keys in AWS Secrets Manager
   - Never commit keys to version control
   - Rotate keys regularly (every 90 days)
   - Use different keys for each environment

2. **Token Storage**
   - Access tokens: Memory or secure storage (mobile)
   - Refresh tokens: httpOnly cookies (web) or secure storage (mobile)
   - Never store tokens in localStorage (web)

3. **Token Revocation**
   - Implement token blacklist in Redis
   - Revoke tokens on logout
   - Revoke all tokens on password change
   - Monitor for suspicious token usage

4. **Rate Limiting**
   - Limit token generation requests
   - Limit token refresh requests
   - Implement exponential backoff on failures

### Best Practices

1. **Token Rotation**
   - Issue new refresh token on each use
   - Invalidate old refresh token
   - Maintain token family for security

2. **Monitoring**
   - Log all token generation events
   - Alert on unusual token patterns
   - Track token usage metrics

3. **Error Handling**
   - Never expose internal errors to clients
   - Log detailed errors server-side
   - Return generic error messages

## Architecture Alignment

This implementation aligns with the BerthCare Architecture Blueprint:

- ✅ **RS256 Algorithm:** Asymmetric encryption for scalability
- ✅ **Stateless Authentication:** No server-side session storage
- ✅ **Key Rotation Support:** Versioned secrets for zero-downtime rotation
- ✅ **Comprehensive Payload:** User context for authorization
- ✅ **Security Best Practices:** Industry-standard JWT patterns

## Next Steps

1. **A4:** Implement authentication endpoints (login, refresh, logout)
2. **A5:** Create authentication middleware for API routes
3. **A6:** Implement token blacklist in Redis
4. **A7:** Set up AWS Secrets Manager for production keys
5. **A8:** Add token rotation on refresh

## References

- Architecture Blueprint: `project-documentation/architecture-output.md`
- Password Hashing: `docs/A2-password-hashing-implementation.md`
- JWT Specification: [RFC 7519](https://tools.ietf.org/html/rfc7519)
- RS256 Algorithm: [RFC 7518](https://tools.ietf.org/html/rfc7518)

## Acceptance Criteria

- ✅ JWT utility module created with RS256 algorithm
- ✅ `generateAccessToken()` implemented (1 hour expiry)
- ✅ `generateRefreshToken()` implemented (30 days expiry)
- ✅ Token payload includes userId, role, zoneId
- ✅ Key rotation support via environment variables
- ✅ Comprehensive unit tests (32 tests passing)
- ✅ Token generation and verification working successfully
- ✅ Documentation complete

**Status:** ✅ All acceptance criteria met
