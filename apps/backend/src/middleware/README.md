# Backend Middleware

This directory contains Express middleware for the BerthCare backend API.

## Available Middleware

### Authentication & Authorization

#### `auth.ts` - JWT Authentication Middleware

Provides JWT token verification and role-based access control.

**Usage:**

```typescript
import { authenticateJWT, requireRole, AuthenticatedRequest } from './middleware/auth';

// Protect a route (any authenticated user)
router.get('/protected', authenticateJWT(redisClient), (req: AuthenticatedRequest, res) => {
  const userId = req.user?.userId;
  res.json({ userId });
});

// Protect a route (specific roles only)
router.get(
  '/admin',
  authenticateJWT(redisClient),
  requireRole(['admin']),
  (req: AuthenticatedRequest, res) => {
    res.json({ message: 'Admin only' });
  }
);
```

**Features:**

- JWT signature verification
- Token expiration checking
- Token blacklist support (logout)
- User context attachment to request
- Role-based authorization

**User Context Attachment:**

The `authenticateJWT` middleware attaches user information to the request object synchronously before route handlers execute. After successful JWT verification, the middleware sets `req.user` with the authenticated user's details:

```typescript
// User object shape attached to req.user
req.user = {
  userId: string;      // UUID from JWT payload
  role: UserRole;      // 'admin' | 'coordinator' | 'caregiver'
  zoneId: string;      // UUID of user's assigned zone
  email?: string;      // Optional email address
};
```

For unauthenticated requests or failed verification, `req.user` remains `undefined`. Route handlers can check `req.user` to determine authentication status.

**TypeScript Support:**

The middleware exports an `AuthenticatedRequest` interface that extends Express's `Request` type:

```typescript
import { AuthenticatedRequest } from './middleware/auth';

router.get('/profile', authenticateJWT(redisClient), (req: AuthenticatedRequest, res) => {
  // TypeScript knows req.user exists and its shape
  const { userId, role, zoneId } = req.user!;
  res.json({ userId, role, zoneId });
});
```

**See:** `docs/A7-jwt-auth-middleware.md` for complete documentation

---

### Rate Limiting

#### `rate-limiter.ts` - IP-Based Rate Limiting

Provides Redis-backed rate limiting to prevent abuse.

**Usage:**

```typescript
import { createLoginRateLimiter, createRegistrationRateLimiter } from './middleware/rate-limiter';

// Apply to login endpoint (10 attempts per 15 minutes)
router.post('/login', createLoginRateLimiter(redisClient), loginHandler);

// Apply to registration endpoint (5 attempts per hour)
router.post('/register', createRegistrationRateLimiter(redisClient), registerHandler);
```

**Features:**

- Per-IP rate limiting
- Configurable time windows and max attempts
- Redis-backed for multi-instance support
- Clear error messages with retry information

---

### Validation

#### `validation.ts` - Request Validation

Provides input validation for API requests.

**Usage:**

```typescript
import { validateLogin, validateRegistration, validateRefreshToken } from './middleware/validation';

router.post('/login', validateLogin, loginHandler);
router.post('/register', validateRegistration, registerHandler);
router.post('/refresh', validateRefreshToken, refreshHandler);
```

**Features:**

- Email format validation
- Password strength validation
- Clear error messages
- Type-safe validation

---

## Middleware Ordering

When using multiple middleware, apply them in this order:

1. **Rate Limiting** - Reject abusive requests early
2. **Validation** - Validate input format
3. **Authentication** - Verify JWT token
4. **Authorization** - Check user role
5. **Business Logic** - Execute route handler

**Example:**

```typescript
router.post(
  '/protected-endpoint',
  createRateLimiter(redisClient, config), // 1. Rate limiting
  validateRequest, // 2. Validation
  authenticateJWT(redisClient), // 3. Authentication
  requireRole(['admin']), // 4. Authorization
  async (req: AuthenticatedRequest, res) => {
    // 5. Business logic
    res.json({ success: true });
  }
);
```

---

## Error Handling

All middleware follows a consistent error response format:

```json
{
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable message",
    "details": {},
    "timestamp": "2025-10-10T12:00:00.000Z",
    "requestId": "unique-request-id"
  }
}
```

---

## Testing

Each middleware has comprehensive unit tests:

- `tests/auth.middleware.test.ts` - Authentication middleware tests
- `tests/auth.logout.test.ts` - Logout endpoint tests

Run tests:

```bash
# Run all middleware tests
pnpm run test -- middleware

# Run specific middleware tests
pnpm run test -- auth.middleware.test.ts
```

---

## Philosophy

> "Uncompromising Security" - Security through simplicity and multiple layers of validation

- **Fail Fast** - Validate early, reject invalid requests immediately
- **Clear Errors** - Specific error codes, no security information leakage
- **Graceful Degradation** - System degrades gracefully, never catastrophically
- **Stateless** - JWT-based authentication for horizontal scalability
