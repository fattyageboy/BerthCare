# Database Test Fixtures

## Overview

This directory contains SQL fixture files for populating test data in the BerthCare database. Fixtures are used for:

- Manual testing of features
- Seeding development databases
- Integration test setup
- Demonstrating data relationships

## Usage

### Prerequisites

1. All required migrations must be applied first
2. Database connection must be configured
3. User must have INSERT permissions

### Loading Fixtures

```bash
# Load specific fixture file
psql -U postgres -d berthcare -f apps/backend/src/db/fixtures/<fixture_file>.sql

# Example: Load care coordination fixtures
psql -U postgres -d berthcare -f apps/backend/src/db/fixtures/care_coordination_fixtures.sql
```

### Using with Docker

```bash
# Copy fixture into container and run
docker cp apps/backend/src/db/fixtures/care_coordination_fixtures.sql berthcare-postgres:/tmp/
docker exec -it berthcare-postgres psql -U postgres -d berthcare -f /tmp/care_coordination_fixtures.sql
```

## Available Fixtures

### care_coordination_fixtures.sql

Creates test data for the voice alert and care coordination system.

**Dependencies:**
- Migrations 001-009
- Tables: zones, users, clients, coordinators, care_alerts

**Creates:**
- 1 test zone
- 2 test users (caregiver and coordinator)
- 1 test client
- 1 coordinator record
- 3 sample care alerts (initiated, resolved, escalated)

**Usage Notes:**
- Uses `RETURNING` clauses to output generated IDs
- Requires manual ID substitution for dependent records
- Includes cleanup commands for removing test data
- Documents prerequisite schema requirements

## Best Practices

### Creating New Fixtures

1. **Document Dependencies**
   - List required migrations
   - Document prerequisite tables and columns
   - Specify expected data types and constraints

2. **Use Transactions**
   - Wrap fixtures in BEGIN/COMMIT blocks
   - Allows rollback on errors
   - Ensures atomic fixture loading

3. **Include RETURNING Clauses**
   - Output generated IDs for reference
   - Makes it easier to create dependent records
   - Helps with debugging

4. **Provide Cleanup Commands**
   - Include DELETE statements at the end
   - Document cleanup order (respect foreign keys)
   - Make it easy to reset test data

5. **Keep Fixtures Synchronized**
   - Update fixtures when migrations change schemas
   - Test fixtures after schema changes
   - Document breaking changes in comments

### Naming Convention

- Use descriptive names: `<feature>_fixtures.sql`
- Match related migration names when possible
- Use lowercase with underscores

### File Structure

```sql
-- Header with description and dependencies
-- Prerequisite schema documentation
-- BEGIN transaction
-- Step-by-step INSERTs with RETURNING
-- COMMIT transaction
-- Alternative approaches (query existing data)
-- Cleanup commands
```

## Maintenance

### When to Update Fixtures

- After adding new migrations that change schemas
- When adding new required columns
- When changing foreign key relationships
- When adding new constraints or validations

### Testing Fixtures

Before committing fixture changes:

1. Apply all migrations to a clean database
2. Run the fixture file
3. Verify all INSERTs succeed
4. Check that RETURNING clauses output expected data
5. Test cleanup commands

### Version Control

- Commit fixture files alongside related migrations
- Document fixture changes in migration commit messages
- Keep fixture files in sync with migration versions

## Troubleshooting

### Foreign Key Violations

**Problem:** INSERT fails with foreign key constraint error

**Solution:**
- Ensure prerequisite records exist
- Check that referenced IDs are valid
- Verify migration order is correct

### Unique Constraint Violations

**Problem:** INSERT fails with unique constraint error

**Solution:**
- Run cleanup commands first
- Use different email addresses or unique values
- Check for existing test data

### Missing Columns

**Problem:** INSERT fails with "column does not exist" error

**Solution:**
- Verify all migrations are applied
- Check fixture file is up to date with schema
- Review prerequisite schema documentation

### RETURNING Clause Issues

**Problem:** Can't capture RETURNING values in psql

**Solution:**
- Use `\gset` in psql to capture values into variables
- Or manually copy IDs from output
- Or use a script/tool that supports variable binding

## Examples

### Using psql Variables

```sql
-- Create zone and capture ID
INSERT INTO zones (name, region)
VALUES ('Test Zone', 'Test Region')
RETURNING id \gset zone_

-- Use captured ID in subsequent INSERT
INSERT INTO users (email, password_hash, first_name, last_name, role, zone_id, is_active)
VALUES ('test@example.com', 'hash', 'Test', 'User', 'caregiver', :'zone_id', true);
```

### Conditional Fixture Loading

```sql
-- Only insert if record doesn't exist
INSERT INTO zones (name, region)
SELECT 'Test Zone', 'Test Region'
WHERE NOT EXISTS (
  SELECT 1 FROM zones WHERE name = 'Test Zone'
);
```

---

**Note:** Fixtures are for testing and development only. Never use fixture data in production environments.
