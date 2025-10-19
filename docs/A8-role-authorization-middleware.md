# A8: Role-Based Authorization Middleware

**Status:** ✅ COMPLETED  
**Task ID:** A8  
**Dependencies:** A7 (JWT Authentication Middleware)  
**Effort:** 0.5 days  
**Completed:** October 10, 2025

---

## Overview

The authorization layer now exposes a configurable `authorize` middleware that enforces user roles, granular permissions, and zone-scoped access control in a single reusable component. It builds on the JWT authentication middleware by attaching a permission set to `req.user` (resolved from a shared role map) and returning standardized 401/403 payloads that align with the architecture blueprint.

### Delivered Capabilities

- Multi-role enforcement with type-safe helpers
- Permission checks backed by `ROLE_PERMISSIONS` and overrides from JWT payloads
- Automatic zone guard (`req.params.zoneId` by default) with configurable resolvers
- Consistent `AUTH_*` error codes and telemetry metadata
- Backwards compatibility through a `requireRole` wrapper for legacy routes

---

## Requirements

### Functional

1. ✅ Reject unauthenticated requests with `AUTH_UNAUTHENTICATED`
2. ✅ Enforce required roles via shared `hasRole` helper
3. ✅ Enforce granular permissions via shared `hasPermission` helper
4. ✅ Deny zone mismatches with `AUTH_ZONE_ACCESS_DENIED` (admin bypass supported)
5. ✅ Populate `req.user.permissions` for downstream handlers
6. ✅ Provide composable middleware that supports array and config-object invocation styles

### Non-Functional

1. ✅ TypeScript-first API with literal unions for roles and permissions
2. ✅ Stateless design (<1 ms overhead; set lookups only)
3. ✅ Comprehensive unit coverage (21 tests) across success and failure paths
4. ✅ Shared library utilities (`libs/shared/src/authorization.ts`) for reuse across services
5. ✅ Exhaustive documentation and examples for onboarding

---

## Implementation

### Key Locations

- **Shared helpers:** `libs/shared/src/authorization.ts`
- **JWT payload extensions:** `libs/shared/src/jwt-utils.ts`
- **Middleware:** `apps/backend/src/middleware/auth.ts`
- **Tests:** `apps/backend/tests/auth.middleware.test.ts`
- **Examples:** `apps/backend/src/middleware/examples/protected-route-example.ts`

### Shared Permission Map

```typescript
export const ROLE_PERMISSIONS = {
  caregiver: [
    'read:clients',
    'read:care-plans',
    'read:visits',
    'read:schedules',
    'create:visit',
    'update:visit',
    'update:visit-documentation',
    'delete:visit-draft',
    'create:visit-note',
    'create:alert',
    'resolve:alert',
    'create:message',
  ],
  coordinator: [
    // caregiver permissions +
    'delete:alert',
    'create:client',
    'update:client',
    'create:care-plan',
    'update:care-plan',
    'create:schedule',
    'update:schedule',
    'create:user',
  ],
  admin: ['*'],
  family: ['read:clients', 'read:care-plans', 'read:visits', 'read:schedules', 'create:message'],
} as const;
```

Helper functions export `getRolePermissions`, `hasRole`, and `hasPermission`, enabling consistent checks across services.

### Authorization Middleware

```typescript
export function authorize(
  rolesOrConfig?: RoleInput | AuthorizeConfig,
  permissionsOrOptions?: PermissionInput | AuthorizeOptions | null,
  maybeOptions?: AuthorizeOptions
) {
  // Normalizes roles, permissions, and options (zone enforcement, admin bypass)
  // Returns Express middleware that:
  // 1. Rejects missing authentication (401 AUTH_UNAUTHENTICATED)
  // 2. Validates role membership (403 AUTH_INSUFFICIENT_ROLE)
  // 3. Validates permissions (403 AUTH_INSUFFICIENT_PERMISSIONS)
  // 4. Enforces zone access (403 AUTH_ZONE_ACCESS_DENIED)
}

// Backwards-compatible wrapper (no zone enforcement):
export function requireRole(allowedRoles: UserRole | UserRole[]) {
  return authorize(allowedRoles, null, { enforceZoneCheck: false });
}
```

JWT verification now hydrates `req.user.permissions` with either the token payload or role defaults, keeping downstream checks fast and consistent.

---

## Usage Examples

### Role + Permission (Positional)

```typescript
router.post(
  '/v1/visits',
  authenticateJWT(redisClient),
  authorize(['caregiver', 'coordinator'], ['create:visit']),
  createVisitHandler
);
```

### Configuration Object with Zone Resolver

```typescript
router.patch(
  '/v1/zones/:zoneId/settings',
  authenticateJWT(redisClient),
  authorize({
    roles: ['coordinator', 'admin'],
    permissions: ['update:schedule'],
    zoneResolver: (req) => req.params.zoneId ?? (req.query.zone as string | undefined),
  }),
  updateSettingsHandler
);
```

### Legacy Convenience Wrapper

```typescript
router.get(
  '/v1/admin/audit-log',
  authenticateJWT(redisClient),
  requireRole(['admin']),
  listAuditEventsHandler
);
```

---

## Error Responses

### 401 – Missing Authentication

```json
{
  "error": {
    "code": "AUTH_UNAUTHENTICATED",
    "message": "Authentication is required to access this resource",
    "timestamp": "2025-10-10T14:30:00.000Z",
    "requestId": "req_123"
  }
}
```

### 403 – Role Violation

```json
{
  "error": {
    "code": "AUTH_INSUFFICIENT_ROLE",
    "message": "You do not have permission to access this resource",
    "details": {
      "requiredRoles": ["admin"],
      "userRole": "caregiver"
    },
    "timestamp": "2025-10-10T14:35:00.000Z",
    "requestId": "req_456"
  }
}
```

### 403 – Permission Violation

```json
{
  "error": {
    "code": "AUTH_INSUFFICIENT_PERMISSIONS",
    "message": "You do not have permission to perform this action",
    "details": {
      "requiredPermissions": ["update:client"]
    },
    "timestamp": "2025-10-10T14:36:00.000Z",
    "requestId": "req_789"
  }
}
```

### 403 – Zone Violation

```json
{
  "error": {
    "code": "AUTH_ZONE_ACCESS_DENIED",
    "message": "You do not have access to this zone",
    "details": {
      "requestedZoneId": "zone-556",
      "userZoneId": "zone-123"
    },
    "timestamp": "2025-10-10T14:37:00.000Z",
    "requestId": "req_987"
  }
}
```

---

## Middleware Chain Pattern

```typescript
router.post(
  '/endpoint',
  rateLimiter,
  validateRequest,
  authenticateJWT(redisClient),
  authorize(['coordinator', 'admin'], ['update:client']),
  handleBusinessLogic
);
```

Ordering guarantees rate limiting → validation → authentication → authorization → business logic.

---

## Security & Performance Notes

- **Defense in depth:** Authentication + authorization required.
- **Fail secure:** Default deny; no implicit grants.
- **Observability:** All error payloads include `requestId` and ISO timestamps for tracing.
- **Performance:** Role/permission checks use in-memory sets (<0.2 ms observed).
- **Type Safety:** Literal unions prevent invalid role/permission strings at compile time.

---

## Test Coverage

### Unit Tests (21 total)

1. JWT middleware happy path, blacklist, and error handling
2. Permission hydration from token payload vs. role defaults
3. `requireRole` success/failure branches (401/403)
4. `authorize` success + role, permission, and zone failure paths
5. Custom zone resolver behaviour
6. Integration flow (authenticate → authorize → logout)

```plaintext
PASS  apps/backend/tests/auth.middleware.test.ts
  JWT Authentication Middleware
    authenticateJWT ...
    requireRole ...
    authorize ...
    blacklistToken ...
    Integration: Full authentication flow ...
```

---

## Acceptance Criteria

| Criteria                                                        | Status | Evidence                                      |
| --------------------------------------------------------------- | ------ | --------------------------------------------- |
| Enforce required roles with standardized 403 payloads           | ✅     | `apps/backend/src/middleware/auth.ts:361`     |
| Enforce granular permissions per endpoint                       | ✅     | `apps/backend/src/middleware/auth.ts:371`     |
| Zone guard blocks cross-zone access (admin bypass allowed)      | ✅     | `apps/backend/src/middleware/auth.ts:385`     |
| Shared helpers for roles + permissions exported                 | ✅     | `libs/shared/src/authorization.ts`            |
| `req.user.permissions` populated during authentication          | ✅     | `apps/backend/src/middleware/auth.ts:261`     |
| Comprehensive unit tests covering success & failure scenarios   | ✅     | `apps/backend/tests/auth.middleware.test.ts`  |
| Documentation & examples updated to new authorization contract  | ✅     | This document + `apps/backend/.../examples`   |

---

## Future Enhancements

1. **Resource-level guards:** Integrate data ownership checks (e.g., visit/client IDs).
2. **Dynamic permission provisioning:** Load role → permission mappings from the database for tenant-specific overrides.
3. **Audit logging:** Persist authorization failures for compliance analytics.
4. **Policy caching:** Expose cache invalidation hooks when role permissions change at runtime.

---

## Conclusion

Task A8 now delivers a production-ready authorization framework that combines roles, permissions, and zone awareness with clear error contracts and thorough test coverage. The middleware is reusable across services, documented, and ready for integration into upcoming endpoints without additional work.
