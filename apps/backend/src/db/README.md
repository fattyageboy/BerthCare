# Database Migrations

This directory contains database migration files and tools for managing the BerthCare PostgreSQL schema.

## Philosophy

> "Simplicity is the ultimate sophistication"

We use plain SQL migration files as the source of truth. No complex migration frameworks, no ORM magic—just SQL that's easy to read, review, and understand.

## Directory Structure

```
db/
├── migrations/           # SQL migration files
│   ├── 001_create_users_auth.sql
│   ├── 001_create_users_auth_rollback.sql
│   ├── 002_create_clients.sql
│   ├── 002_create_clients_rollback.sql
│   ├── 003_create_care_plans.sql
│   └── 003_create_care_plans_rollback.sql
├── migrate.ts           # Migration runner
├── verify-schema.ts     # Schema verification tool
├── seed.ts             # Database seeding tool
└── README.md           # This file
```

## Quick Start

### 1. Run Migrations

Apply all pending migrations:

```bash
npm run migrate:up
```

Apply specific migration:

```bash
npm run migrate:up 001  # Users and auth
npm run migrate:up 002  # Clients
npm run migrate:up 003  # Care plans
```

### 2. Verify Schema

Check that the database schema matches specifications:

```bash
npm run db:verify
```

### 3. Rollback Migration

Rollback a specific migration:

```bash
npm run migrate:down 001  # Rollback users and auth
npm run migrate:down 002  # Rollback clients
npm run migrate:down 003  # Rollback care plans
```

### 4. Reset Database

Drop and recreate all tables (useful for development):

```bash
npm run db:reset
```

## Migration Files

### 001_create_users_auth.sql

Creates the authentication system tables:

**users table:**

- Stores user accounts (caregivers, coordinators, admins)
- Supports role-based access control
- Zone-based data isolation
- Soft delete support

**refresh_tokens table:**

- JWT refresh token management
- Multi-device session support
- Token revocation for security

**Indexes:**

- Optimized for authentication flows
- Fast email lookup for login
- Efficient zone-based queries
- Token validation performance

### 002_create_clients.sql

Creates the client management table:

**clients table:**

- Stores client (patient) information
- Personal details (name, DOB, address)
- Geographic coordinates for route optimization
- Emergency contact information
- Zone assignment for data isolation
- Soft delete support

**Indexes:**

- Zone-based queries for caregiver assignment
- Name search (last name, full name)
- Geographic proximity searches
- Composite zone + name sorting

### 003_create_care_plans.sql

Creates the care plan management table:

**care_plans table:**

- Stores care plan information for clients
- Summary of care needs
- Medications (JSONB array with name, dosage, frequency)
- Allergies (JSONB array of strings)
- Special instructions for caregivers
- Version tracking for change history
- Foreign key to clients with CASCADE delete

**Indexes:**

- Fast client lookup
- GIN indexes for JSONB medication/allergy searches
- Version tracking for conflict detection
- Unique constraint: one active care plan per client

**Triggers:**

- Auto-increment version on content changes
- Auto-update timestamps

**Functions:**

- `increment_care_plan_version()` - Version management
- `validate_medication_structure()` - JSONB validation
- `validate_allergies_structure()` - JSONB validation

## Database Connection

The migration tools use environment variables for database connection:

```bash
POSTGRES_HOST=localhost
POSTGRES_PORT=5432
POSTGRES_DB=berthcare_dev
POSTGRES_USER=berthcare
POSTGRES_PASSWORD=berthcare_dev_password
```

These are configured in your `.env` file and match the `docker-compose.yml` setup.

## Migration Workflow

### Creating a New Migration

1. Create forward migration file: `00X_description.sql`
2. Create rollback file: `00X_description_rollback.sql`
3. Update `migrate.ts` to include new migration
4. Test migration: `npm run migrate:up 00X`
5. Verify schema: `npm run db:verify`
6. Test rollback: `npm run migrate:down 00X`
7. Commit both files to version control

### Migration Best Practices

**DO:**

- ✅ Use descriptive migration names
- ✅ Include comments explaining the purpose
- ✅ Create rollback scripts for every migration
- ✅ Test migrations on development database first
- ✅ Use transactions (BEGIN/COMMIT/ROLLBACK)
- ✅ Add indexes for common query patterns
- ✅ Document table and column purposes

**DON'T:**

- ❌ Modify existing migration files after deployment
- ❌ Skip rollback script creation
- ❌ Use database-specific features without fallbacks
- ❌ Forget to test rollback scripts
- ❌ Mix schema changes with data migrations

## Schema Verification

The `verify-schema.ts` script checks:

- ✅ Tables exist
- ✅ Columns exist with correct names
- ✅ Indexes are created
- ✅ Constraints are in place

Run after every migration to ensure schema integrity:

```bash
npm run db:verify
```

## Troubleshooting

### Migration fails with "relation already exists"

The migration has already been run. Check your database state:

```bash
npm run test:connection
```

### Connection refused

Ensure PostgreSQL is running:

```bash
docker-compose up -d postgres
```

### Permission denied

Check your database credentials in `.env` file.

### Rollback fails

Check the rollback SQL file for errors. You may need to manually fix the database state.

## Production Deployment

For production deployments:

1. **Backup database** before running migrations
2. **Test migrations** on staging environment first
3. **Run migrations** during maintenance window
4. **Verify schema** after migration completes
5. **Monitor application** for any issues
6. **Keep rollback scripts** ready if needed

## Current Schema

### Tables

1. **users** - User accounts and authentication
2. **refresh_tokens** - JWT refresh token management
3. **clients** - Client (patient) information
4. **care_plans** - Care plan details with medications and allergies

### Relationships

```
users
  └─ (zone_id) → zones (future)

clients
  └─ (zone_id) → zones (future)

care_plans
  └─ (client_id) → clients (CASCADE delete)
```

### Migration History

| Migration | Description            | Status     |
| --------- | ---------------------- | ---------- |
| 001       | Users & Authentication | ✅ Applied |
| 002       | Clients                | ✅ Applied |
| 003       | Care Plans             | ✅ Applied |

## Reference

- Architecture Blueprint: `project-documentation/architecture-output.md`
- Task Plan: `project-documentation/task-plan.md`
- Migration 001 Docs: `docs/A1-users-auth-migration.md`
- Migration 002 Docs: `docs/C1-clients-migration.md`
- Database Setup: `docs/E4-local-setup.md`
