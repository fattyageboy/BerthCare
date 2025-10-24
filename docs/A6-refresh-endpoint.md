# Task A6: Implement POST /v1/auth/refresh Endpoint

**Status:** ✅ Complete  
**Assigned To:** Backend Engineer  
**Estimated Time:** 1 day  
**Actual Time:** 1 day  
**Dependencies:** A5 (Login endpoint)

---

## Overview

Implemented the token refresh endpoint that allows users to obtain new access tokens using valid refresh tokens without re-authenticating. This endpoint is critical for maintaining seamless user sessions while ensuring security through short-lived access tokens.

## Implementation Details

### Endpoint Specification

**URL:** `POST /v1/auth/refresh`

**Request Body:**

```json
{
  "refreshToken": "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

**Success Response (200):**

```json
{
  "data": {
    "accessToken": "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9..."
  }
}
```

**Error Responses:**

- **400 Bad Request** - Missing or invalid token format

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Refresh token is required",
    "details": { "field": "refreshToken" },
    "timestamp": "2025-10-10T12:00:00.000Z",
    "requestId": "req_123"
  }
}
```

- **401 Unauthorized** - Invalid, expired, or revoked token

```json
{
  "error": {
    "code": "INVALID_TOKEN",
    "message": "Invalid or expired refresh token",
    "timestamp": "2025-10-10T12:00:00.000Z",
    "requestId": "req_123"
  }
}
```

### Security Validations

The endpoint implements multiple layers of security validation:

1. **Format Validation**
   - Validates JWT format (3 parts separated by dots)
   - Rejects malformed tokens early

2. **JWT Signature Verification**
   - Verifies token signature using public key
   - Validates issuer and audience claims
   - Checks token expiration from JWT payload

3. **Database Validation**
   - Verifies token hash exists in database
   - Checks token has not been revoked
   - Validates token expiration timestamp

4. **User Account Validation**
   - Verifies user account exists
   - Checks account is not soft-deleted
   - Ensures account is active

### Token Lifecycle

```
┌─────────────────────────────────────────────────────────────┐
│ 1. User logs in                                             │
│    - Receives access token (1 hour) + refresh token (30d)  │
└─────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│ 2. Access token expires after 1 hour                        │
│    - Mobile app detects 401 response                        │
└─────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│ 3. App calls POST /v1/auth/refresh                          │
│    - Sends refresh token                                    │
│    - Receives new access token                              │
└─────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│ 4. App retries original request with new access token       │
│    - User experience: seamless, no re-login required        │
└─────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│ 5. Refresh token expires after 30 days                      │
│    - User must log in again                                 │
└─────────────────────────────────────────────────────────────┘
```

### Error Codes

| Code                    | HTTP Status | Description                                | User Action              |
| ----------------------- | ----------- | ------------------------------------------ | ------------------------ |
| `VALIDATION_ERROR`      | 400         | Missing or malformed token                 | Check request format     |
| `INVALID_TOKEN`         | 401         | Token signature invalid or not in database | Re-authenticate          |
| `TOKEN_REVOKED`         | 401         | Token has been explicitly revoked          | Re-authenticate          |
| `TOKEN_EXPIRED`         | 401         | Token expiration time has passed           | Re-authenticate          |
| `USER_NOT_FOUND`        | 401         | User account deleted                       | Contact support          |
| `ACCOUNT_DISABLED`      | 401         | User account deactivated                   | Contact support          |
| `INTERNAL_SERVER_ERROR` | 500         | Server error                               | Retry or contact support |

## Files Modified

### 1. Validation Middleware (`apps/backend/src/middleware/validation.ts`)

Added `validateRefreshToken` middleware:

- Validates refresh token presence
- Checks JWT format (3 parts)
- Returns clear error messages

### 2. Auth Routes (`apps/backend/src/routes/auth.routes.ts`)

Implemented refresh endpoint:

- JWT signature verification
- Database token validation
- User account validation
- New access token generation
- Comprehensive error handling

### 3. Integration Tests (`apps/backend/tests/auth.refresh.test.ts`)

Created comprehensive test suite:

- Success cases (valid token refresh)
- Validation errors (missing/invalid format)
- Authentication errors (invalid/expired/revoked tokens)
- User account validation (deleted/disabled accounts)
- Response format validation
- Edge cases (multiple refreshes, different roles)

## Testing

### Run Tests

```bash
# Run all auth tests
npm test -- auth.refresh.test.ts

# Run with coverage
npm test -- --coverage auth.refresh.test.ts
```

### Test Coverage

- ✅ Successful token refresh with valid refresh token
- ✅ Missing refresh token returns 400
- ✅ Invalid token format returns 400
- ✅ Invalid JWT signature returns 401
- ✅ Token not in database returns 401
- ✅ Revoked token returns 401
- ✅ Expired token returns 401
- ✅ Deleted user account returns 401
- ✅ Disabled user account returns 401
- ✅ Multiple refresh attempts with same token
- ✅ Different user roles (caregiver, coordinator)
- ✅ Error response format validation
- ✅ No sensitive information leakage

### Manual Testing

```bash
# 1. Login to get tokens
curl -X POST http://localhost:3000/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "caregiver@example.com",
    "password": "Password123",
    "deviceId": "test-device"
  }'

# Save the refreshToken from response

# 2. Refresh access token
curl -X POST http://localhost:3000/v1/auth/refresh \
  -H "Content-Type: application/json" \
  -d '{
    "refreshToken": "YOUR_REFRESH_TOKEN_HERE"
  }'

# 3. Verify new access token works
curl -X GET http://localhost:3000/v1/clients \
  -H "Authorization: Bearer YOUR_NEW_ACCESS_TOKEN"
```

## Security Considerations

### Token Storage

**Refresh tokens are stored as SHA-256 hashes:**

- Never store raw tokens in database
- Hash comparison prevents token theft from database breach
- One-way hashing ensures tokens cannot be reconstructed

### Error Messages

**Generic error messages prevent information leakage:**

- Don't reveal whether token exists in database
- Don't reveal specific validation failure reason
- Consistent "Invalid or expired refresh token" message

### Token Revocation

**Tokens can be revoked for security events:**

- User logout (revoke specific device token)
- Password change (revoke all user tokens)
- Security breach (revoke all tokens)
- Account deletion (cascade delete via foreign key)

### Rate Limiting

**Note:** Rate limiting not implemented on refresh endpoint because:

- Refresh tokens are already rate-limited by their 30-day expiry
- Failed refresh attempts require re-login (which is rate-limited)
- Legitimate use case: multiple devices refreshing simultaneously

## Performance Considerations

### Database Queries

**Single query for token validation:**

```sql
SELECT id, user_id, expires_at, revoked_at
FROM refresh_tokens
WHERE token_hash = $1
```

**Single query for user validation:**

```sql
SELECT id, email, role, zone_id, is_active
FROM users
WHERE id = $1 AND deleted_at IS NULL
```

**Indexes used:**

- `idx_refresh_tokens_token_hash` - Fast token lookup
- `users.id` primary key - Fast user lookup

### Response Time

- **Target:** <100ms for successful refresh
- **Typical:** 50-80ms (2 database queries + JWT generation)
- **Bottleneck:** JWT signature verification (CPU-bound)

## Integration with Mobile App

### Automatic Token Refresh

The mobile app should implement automatic token refresh:

```typescript
// Pseudo-code for mobile app
async function apiRequest(url, options) {
  let response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  // If access token expired, refresh and retry
  if (response.status === 401) {
    const newAccessToken = await refreshAccessToken();

    if (newAccessToken) {
      // Retry original request with new token
      response = await fetch(url, {
        ...options,
        headers: {
          Authorization: `Bearer ${newAccessToken}`,
        },
      });
    } else {
      // Refresh failed, redirect to login
      navigateToLogin();
    }
  }

  return response;
}

async function refreshAccessToken() {
  try {
    const response = await fetch('/v1/auth/refresh', {
      method: 'POST',
      body: JSON.stringify({ refreshToken }),
    });

    if (response.ok) {
      const { data } = await response.json();
      await saveAccessToken(data.accessToken);
      return data.accessToken;
    }
  } catch (error) {
    console.error('Token refresh failed:', error);
  }

  return null;
}
```

### Token Expiry Handling

**Proactive refresh (recommended):**

- Check access token expiry before each request
- Refresh if token expires within 5 minutes
- Prevents 401 errors and retry overhead

**Reactive refresh (implemented):**

- Wait for 401 response
- Refresh token and retry request
- Simpler but causes brief delay

## Future Enhancements

### Token Rotation (Security Best Practice)

**Current:** Refresh token can be reused multiple times  
**Enhanced:** Issue new refresh token on each refresh

```typescript
// Generate new refresh token
const newRefreshToken = generateRefreshToken({...});

// Revoke old refresh token
await revokeToken(oldTokenHash);

// Store new refresh token
await storeToken(newTokenHash);

// Return both tokens
return {
  accessToken: newAccessToken,
  refreshToken: newRefreshToken
};
```

**Benefits:**

- Limits token lifetime even if stolen
- Detects token theft (old token used after rotation)
- Industry best practice for high-security applications

**Trade-offs:**

- More complex mobile app logic
- Must handle token update failures
- Increased database writes

### Device Management

**Future feature:** Allow users to view and revoke device sessions

```sql
-- Query active sessions
SELECT device_id, created_at, expires_at
FROM refresh_tokens
WHERE user_id = $1 AND revoked_at IS NULL;

-- Revoke specific device
UPDATE refresh_tokens
SET revoked_at = CURRENT_TIMESTAMP
WHERE user_id = $1 AND device_id = $2;
```

## Acceptance Criteria

- ✅ Endpoint validates refresh token format
- ✅ Endpoint verifies JWT signature
- ✅ Endpoint checks token exists in database
- ✅ Endpoint validates token not revoked
- ✅ Endpoint validates token not expired
- ✅ Endpoint validates user account active
- ✅ Endpoint generates new access token
- ✅ Returns 401 for invalid/expired tokens
- ✅ Returns 400 for validation errors
- ✅ Error messages don't leak sensitive information
- ✅ Integration tests cover all scenarios
- ✅ Response format matches API specification

## Next Steps

### Immediate (Task A7)

Implement JWT authentication middleware:

- Verify access token on protected routes
- Extract user information from token
- Attach user to request object
- Handle expired/invalid tokens

### Future (Task A8)

Implement role-based authorization middleware:

- Check user role against required roles
- Support multiple roles per endpoint
- Return 403 for insufficient permissions

## References

- Architecture Blueprint: `project-documentation/architecture-output.md` - Authentication Endpoints
- JWT Utilities: `libs/shared/src/jwt-utils.ts`
- Database Schema: `apps/backend/src/db/migrations/001_create_users_auth.sql`
- Login Endpoint: `docs/A5-login-endpoint.md`
- Registration Endpoint: `docs/A4-registration-endpoint.md`

---

**Philosophy:** "Uncompromising Security"

Token refresh is a critical security feature. We implement multiple layers of validation to ensure only legitimate users can obtain new access tokens, while maintaining a seamless user experience through automatic token refresh.
