# A1: Users & Authentication Database Migration

**Task ID:** A1  
**Status:** ✅ Completed  
**Date:** October 10, 2025  
**Engineer:** Backend Engineer

## Overview

Created database schema for user authentication system including users and refresh tokens tables with appropriate indexes for optimal query performance.

## Deliverables

### Migration Files

- ✅ `apps/backend/src/db/migrations/001_create_users_auth.sql` - Forward migration
- ✅ `apps/backend/src/db/migrations/001_create_users_auth_rollback.sql` - Rollback migration
- ✅ `apps/backend/src/db/migrate.ts` - Migration runner tool
- ✅ `apps/backend/src/db/verify-schema.ts` - Schema verification tool
- ✅ `apps/backend/src/db/README.md` - Migration documentation

### Database Schema

#### Users Table

Stores user accounts for caregivers, coordinators, and administrators.

**Columns:**

- `id` (UUID, Primary Key, NOT NULL) - Unique user identifier
- `email` (VARCHAR, UNIQUE, NOT NULL) - User email for login
- `password_hash` (VARCHAR, NOT NULL) - Bcrypt hashed password
- `first_name` (VARCHAR, NOT NULL) - User first name
- `last_name` (VARCHAR, NOT NULL) - User last name
- `role` (VARCHAR, NOT NULL) - User role: 'caregiver', 'coordinator', or 'admin'
- `zone_id` (UUID, NULLABLE) - Zone assignment for data isolation (NULL for admins)
- `is_active` (BOOLEAN, NOT NULL) - Account active status
- `created_at` (TIMESTAMP, NOT NULL) - Account creation timestamp
- `updated_at` (TIMESTAMP, NOT NULL) - Last update timestamp (auto-updated)
- `deleted_at` (TIMESTAMP, NULLABLE) - Soft delete timestamp (NULL = not deleted)

**Indexes:**

- `idx_users_email` - Fast email lookup for login (partial index: `WHERE deleted_at IS NULL`)
- `idx_users_zone_id` - Zone-based data isolation queries (partial index: `WHERE deleted_at IS NULL AND is_active = true`)
- `idx_users_role` - Role-based authorization checks (partial index: `WHERE deleted_at IS NULL AND is_active = true`)
- `idx_users_zone_role` - Composite index for zone + role queries (partial index: `WHERE deleted_at IS NULL AND is_active = true`)

**Note:** All indexes use partial indexing with `WHERE deleted_at IS NULL` to efficiently filter soft-deleted records. This significantly reduces index size and improves query performance for active users.

#### Refresh Tokens Table

Manages JWT refresh tokens for multi-device session support.

**Columns:**

- `id` (UUID, Primary Key, NOT NULL) - Unique token identifier
- `user_id` (UUID, Foreign Key, NOT NULL) - References users table (ON DELETE CASCADE: automatically deleted when associated user is deleted)
- `token_hash` (VARCHAR, UNIQUE, NOT NULL) - Hashed refresh token
- `device_id` (VARCHAR, NOT NULL) - Device identifier for multi-device support
- `expires_at` (TIMESTAMP, NOT NULL) - Token expiration (configured via `REFRESH_TOKEN_EXPIRY` constant in `libs/shared/src/jwt-utils.ts`, default: 30 days)
- `revoked_at` (TIMESTAMP, NULLABLE) - Token revocation timestamp (NULL = active)
- `created_at` (TIMESTAMP, NOT NULL) - Token creation timestamp
- `updated_at` (TIMESTAMP, NOT NULL) - Last update timestamp (auto-updated)

**Indexes:**

- `idx_refresh_tokens_user_id` - Fast user token lookup
- `idx_refresh_tokens_token_hash` - Token validation queries
- `idx_refresh_tokens_device_id` - Multi-device session management
- `idx_refresh_tokens_expires_at` - Expired token cleanup

### Features

**Security:**

- Password hashing (bcrypt) - never store plaintext passwords
- Token hashing - never store raw refresh tokens
- Soft delete support - preserve audit trail
- Role-based access control - caregiver, coordinator, admin

**Performance:**

- Optimized indexes for common query patterns
- Composite indexes for complex queries
- Partial indexes with WHERE clauses for efficiency

**Reliability:**

- Foreign key constraints with CASCADE delete
- Automatic timestamp management via triggers
- Transaction support (BEGIN/COMMIT/ROLLBACK)
- Comprehensive error handling

**Maintainability:**

- Clear table and column comments
- Descriptive index names
- Rollback scripts for safe deployment
- Schema verification tool

## Usage

### Run Migration

```bash
# Apply migration
pnpm run migrate:up

# Verify schema
pnpm run db:verify
```

### Rollback Migration

```bash
# Rollback if needed
pnpm run migrate:down 001

# Verify rollback
pnpm run db:verify
```

### Reset Database (Development)

```bash
# Drop and recreate tables
pnpm run db:reset
```

## Verification Results

All schema checks passed:

```
✅ Table 'users' exists
✅ All columns exist in 'users' (11 columns)
✅ Table 'refresh_tokens' exists
✅ All columns exist in 'refresh_tokens' (8 columns)
✅ Index 'idx_users_email' exists
✅ Index 'idx_users_zone_id' exists
✅ Index 'idx_users_role' exists
✅ Index 'idx_users_zone_role' exists
✅ Index 'idx_refresh_tokens_user_id' exists
✅ Index 'idx_refresh_tokens_token_hash' exists
✅ Index 'idx_refresh_tokens_device_id' exists
✅ Index 'idx_refresh_tokens_expires_at' exists

📈 Summary: 12/12 checks passed
```

## Architecture Alignment

This migration implements the authentication system as specified in:

- **Architecture Blueprint:** `project-documentation/architecture-output.md` - Authentication section
- **Task Plan:** `project-documentation/task-plan.md` - Task A1
- **Database Setup:** `docs/E4-local-setup.md`

### Design Philosophy Applied

**Simplicity is the Ultimate Sophistication:**

- Plain SQL migrations (no complex ORM)
- Clear, readable schema definitions
- Straightforward migration runner

**Obsess Over Details:**

- Comprehensive indexes for performance
- Automatic timestamp management
- Detailed comments and documentation

**Uncompromising Security:**

- Password hashing (never plaintext)
- Token hashing (never raw tokens)
- Soft delete (preserve audit trail)
- Role-based access control

## Next Steps

With the database schema in place, the next tasks are:

1. **A2:** Implement authentication service (JWT generation, password hashing)
2. **A3:** Create authentication API endpoints (login, refresh, logout)
3. **A4:** Add authentication middleware for protected routes
4. **A5:** Implement role-based authorization

## Notes

- Migration tested on PostgreSQL 15.14
- All indexes created successfully
- Triggers working correctly for auto-timestamps
- Foreign key constraints enforced
- Ready for authentication service implementation

## References

- Migration files: `apps/backend/src/db/migrations/`
- Migration tools: `apps/backend/src/db/`
- Documentation: `apps/backend/src/db/README.md`
