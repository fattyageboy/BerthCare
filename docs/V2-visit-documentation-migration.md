# V2: Visit Documentation Table Migration

**Task ID:** V2  
**Status:** ✅ Complete  
**Date:** October 11, 2025  
**Migration:** 005_create_visit_documentation.sql  
**Estimated Effort:** 0.5 days  
**Actual Effort:** 0.5 days

---

## Overview

Created the `visit_documentation` table to store detailed documentation for each visit, including vital signs, activities performed, observations, and concerns. This table supports the offline-first mobile app with structured JSONB data for flexible documentation and efficient querying.

---

## Database Schema

### Table: visit_documentation

```sql
CREATE TABLE visit_documentation (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  visit_id UUID NOT NULL REFERENCES visits(id) ON DELETE CASCADE,
  vital_signs JSONB,
  activities JSONB,
  observations TEXT,
  concerns TEXT,
  signature_url VARCHAR(500),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

### Field Descriptions

| Field           | Type         | Nullable | Description                             |
| --------------- | ------------ | -------- | --------------------------------------- |
| `id`            | UUID         | NOT NULL | Unique documentation identifier         |
| `visit_id`      | UUID         | NOT NULL | Reference to visit (foreign key)        |
| `vital_signs`   | JSONB        | NULL     | Structured vital signs data             |
| `activities`    | JSONB        | NULL     | Structured list of activities performed |
| `observations`  | TEXT         | NULL     | Free-form text observations             |
| `concerns`      | TEXT         | NULL     | Any concerns or issues noted            |
| `signature_url` | VARCHAR(500) | NULL     | URL to digital signature in S3          |
| `created_at`    | TIMESTAMP    | NOT NULL | Record creation timestamp               |
| `updated_at`    | TIMESTAMP    | NOT NULL | Record last update timestamp            |

---

## JSONB Data Structures

### Vital Signs (vital_signs JSONB)

Example structure:

```json
{
  "blood_pressure": "120/80",
  "heart_rate": 72,
  "temperature": 98.6,
  "oxygen_saturation": 98,
  "respiratory_rate": 16,
  "weight": 165,
  "notes": "All vitals within normal range"
}
```

**Benefits:**

- Flexible schema - can add new vital signs without migration
- Efficient storage - only store vitals that were measured
- Queryable - GIN index enables fast searches

### Activities (activities JSONB)

Example structure:

```json
[
  {
    "activity": "Medication administered",
    "completed": true,
    "time": "10:30",
    "notes": "Took morning medications with water"
  },
  {
    "activity": "Meal prepared",
    "completed": true,
    "meal_type": "breakfast",
    "notes": "Scrambled eggs and toast"
  },
  {
    "activity": "Light exercise",
    "completed": false,
    "reason": "Client felt tired"
  }
]
```

**Benefits:**

- Structured activity tracking
- Supports completion status
- Flexible notes per activity
- Can query for specific activities

---

## Indexes

Three indexes were created to optimize query patterns:

### 1. idx_visit_documentation_visit_id (B-tree)

```sql
CREATE INDEX idx_visit_documentation_visit_id ON visit_documentation(visit_id);
```

**Purpose:** Fast lookup of documentation by visit  
**Query Pattern:** "Get documentation for this visit"  
**Performance:** O(log n) lookup time

### 2. idx_visit_documentation_vital_signs (GIN)

```sql
CREATE INDEX idx_visit_documentation_vital_signs ON visit_documentation USING GIN (vital_signs);
```

**Purpose:** Fast JSONB queries on vital signs  
**Query Patterns:**

- "Find visits where blood pressure was recorded"
- "Find visits with heart rate > 100"
- "Search for specific vital sign values"

**Example Queries:**

```sql
-- Find all visits with blood pressure recorded
SELECT * FROM visit_documentation
WHERE vital_signs ? 'blood_pressure';

-- Find visits with high heart rate
SELECT * FROM visit_documentation
WHERE (vital_signs->>'heart_rate')::int > 100;

-- Find visits with specific blood pressure
SELECT * FROM visit_documentation
WHERE vital_signs->>'blood_pressure' = '120/80';
```

### 3. idx_visit_documentation_activities (GIN)

```sql
CREATE INDEX idx_visit_documentation_activities ON visit_documentation USING GIN (activities);
```

**Purpose:** Fast JSONB queries on activities  
**Query Patterns:**

- "Find visits where medication was administered"
- "Find visits with incomplete activities"
- "Search for specific activity types"

**Example Queries:**

```sql
-- Find visits where medication was administered
SELECT * FROM visit_documentation
WHERE activities @> '[{"activity": "Medication administered"}]';

-- Find visits with incomplete activities
SELECT * FROM visit_documentation
WHERE activities @> '[{"completed": false}]';
```

---

## Foreign Key Constraint

### visit_documentation_visit_id_fkey

```sql
FOREIGN KEY (visit_id) REFERENCES visits(id) ON DELETE CASCADE
```

**Behavior:**

- **ON DELETE CASCADE**: When a visit is deleted, all associated documentation is automatically deleted
- **Rationale**: Documentation has no meaning without its visit
- **Data Integrity**: Prevents orphaned documentation records

**Testing:**

```sql
-- Create visit and documentation
INSERT INTO visits (...) VALUES (...) RETURNING id; -- Returns visit_id
INSERT INTO visit_documentation (visit_id, ...) VALUES (visit_id, ...);

-- Delete visit - documentation is automatically deleted
DELETE FROM visits WHERE id = visit_id;

-- Verify documentation was deleted
SELECT COUNT(*) FROM visit_documentation WHERE visit_id = visit_id; -- Returns 0
```

---

## Triggers

### update_visit_documentation_updated_at

Automatically updates the `updated_at` timestamp on every row update.

```sql
CREATE TRIGGER update_visit_documentation_updated_at
    BEFORE UPDATE ON visit_documentation
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
```

**Behavior:**

- Fires before every UPDATE operation
- Sets `updated_at` to CURRENT_TIMESTAMP
- Provides automatic audit trail

---

## Migration Execution

### Running the Migration

```bash
cd apps/backend
npm run migrate:up -- 005
```

### Verification

```bash
# Check table structure
docker exec berthcare-postgres psql -U berthcare -d berthcare_dev -c "\d visit_documentation"

# Check indexes
docker exec berthcare-postgres psql -U berthcare -d berthcare_dev -c "
  SELECT indexname, indexdef
  FROM pg_indexes
  WHERE tablename = 'visit_documentation'
  ORDER BY indexname;
"

# Check foreign key
docker exec berthcare-postgres psql -U berthcare -d berthcare_dev -c "
  SELECT conname, pg_get_constraintdef(oid)
  FROM pg_constraint
  WHERE conrelid = 'visit_documentation'::regclass;
"
```

### Rollback

If needed, rollback the migration:

```bash
npm run migrate:down -- 005
```

---

## Design Decisions

### 1. JSONB for Vital Signs and Activities

**Decision:** Use JSONB instead of separate columns or tables

**Rationale:**

- **Flexibility**: Different clients may require different vital signs
- **Extensibility**: Can add new fields without schema changes
- **Performance**: GIN indexes make JSONB queries fast
- **Storage**: Only store data that exists (sparse data)

**Trade-offs:**

- Pros: Flexible, extensible, efficient for sparse data
- Cons: Less type safety than columns, requires application-level validation

### 2. CASCADE Delete

**Decision:** Use ON DELETE CASCADE for visit_id foreign key

**Rationale:**

- Documentation is meaningless without its visit
- Simplifies data cleanup
- Prevents orphaned records
- Maintains referential integrity

**Alternative Considered:** ON DELETE RESTRICT

- Rejected because it would require manual cleanup
- Would complicate visit deletion logic

### 3. GIN Indexes for JSONB

**Decision:** Create GIN indexes on both JSONB columns

**Rationale:**

- Enables fast queries on JSONB content
- Supports containment operators (@>, ?, ?&, ?|)
- Essential for reporting and analytics
- Small storage overhead for significant query performance

**Performance Impact:**

- Query time: O(log n) instead of O(n)
- Storage: ~20-30% overhead on JSONB columns
- Write time: Slightly slower inserts (acceptable trade-off)

### 4. Separate observations and concerns Fields

**Decision:** Keep observations and concerns as separate TEXT fields

**Rationale:**

- **Concerns** are actionable and may trigger alerts
- **Observations** are general notes
- Separation enables different business logic
- Easier to query for visits with concerns

**Example Use Case:**

```sql
-- Find all visits with concerns in the last week
SELECT v.*, vd.concerns
FROM visits v
JOIN visit_documentation vd ON v.id = vd.visit_id
WHERE vd.concerns IS NOT NULL
  AND v.check_in_time > NOW() - INTERVAL '7 days';
```

### 5. signature_url as VARCHAR(500)

**Decision:** Store S3 URL as string, not binary data

**Rationale:**

- Signatures stored in S3, not database
- URL provides reference to S3 object
- Keeps database size manageable
- Enables CDN caching of signatures

**Format:** `s3://bucket-name/signatures/visit-id/signature.png`

---

## Performance Considerations

### Query Patterns

1. **Get Documentation for Visit** (most common)
   - Query: `SELECT * FROM visit_documentation WHERE visit_id = ?`
   - Index: `idx_visit_documentation_visit_id`
   - Expected: <10ms response time

2. **Search by Vital Sign**
   - Query: `SELECT * FROM visit_documentation WHERE vital_signs ? 'blood_pressure'`
   - Index: `idx_visit_documentation_vital_signs` (GIN)
   - Expected: <50ms response time

3. **Search by Activity**
   - Query: `SELECT * FROM visit_documentation WHERE activities @> '[{"activity": "Medication"}]'`
   - Index: `idx_visit_documentation_activities` (GIN)
   - Expected: <50ms response time

### Storage Estimates

- Average row size: ~500 bytes (with JSONB)
- 1,000 visits/day = 500 KB/day
- 1 year = 183 MB
- 10 years = 1.83 GB (very manageable)

### JSONB vs JSON

**Why JSONB?**

- Binary format (faster processing)
- Supports indexing (JSON does not)
- Removes duplicate keys
- Preserves numeric types
- Slightly larger storage (acceptable trade-off)

---

## Security Considerations

### Data Privacy

- Vital signs are PHI (Protected Health Information)
- Must be encrypted at rest (database-level encryption)
- Access controlled via application-level authorization
- Audit trail via created_at/updated_at timestamps

### Input Validation

- Application must validate JSONB structure
- Prevent injection attacks via parameterized queries
- Sanitize text fields (observations, concerns)
- Validate signature URLs before storage

### Database Encryption: actionable verification steps

- Verify provider-side (cloud) disk encryption is enabled for database storage (e.g., AWS EBS/GP3, GCP Persistent Disk, Azure Managed Disk) and active for the database instance.
- Confirm that a Customer-Managed Key (CMK) / KMS key is used where required and document the key ARN/ID.
- Check KMS key rotation policy and, if automatic rotation is enabled, confirm rotation schedule and that previous key versions remain available for decrypting older backups.
- Inspect PostgreSQL settings and storage layer for server-side encryption (if using managed Postgres with transparent data encryption features) and log the encryption flags.
- From the database host or management console, inspect `pg_settings` for any encryption-related parameters or extensions in use and record their values:
  ```sql
  SELECT name, setting, unit, vartype FROM pg_settings WHERE name LIKE '%encrypt%' OR name LIKE '%ssl%';
  ```
- For backups and replicas, verify that snapshots and automated backups are encrypted with the same KMS key and that access controls prevent unauthorized export.
- Document a verification checklist: storage encryption, KMS key ID, rotation policy, encrypted backups, and test-decrypt of a recent backup in a secure environment.

### Audit log design (recommended)

- Create a separate, append-only audit table to record changes to visit_documentation and related objects. Minimal recommended columns:

  ```sql
  CREATE TABLE audit_log (
    id BIGSERIAL PRIMARY KEY,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    user_id UUID NULL,              -- application user who performed the action
    role TEXT NULL,                 -- user's role at time of action
    action TEXT NOT NULL,           -- 'INSERT' | 'UPDATE' | 'DELETE'
    object_type TEXT NOT NULL,      -- e.g., 'visit_documentation'
    object_id UUID NOT NULL,        -- affected record id
    changed_fields JSONB NULL,      -- diff or changed fields
    request_id UUID NULL,           -- optional correlation id from request
    source_ip TEXT NULL             -- optional client IP
  );
  ```

- Consider one of two capture mechanisms:
  - Database triggers on `visit_documentation` that INSERT into `audit_log` on INSERT/UPDATE/DELETE (keeps auditing close to data; ensure triggers are well-tested and non-blocking).
  - Application write-path instrumentation where the service emits audit records as part of the same transaction or via a reliable outbox if cross-service (gives richer context like auth claims and request_id).
- Define retention and archival policy (for example: keep 2 years online, archive to encrypted object storage, and delete beyond retention after legal review). Ensure archived audit logs remain immutable and access-controlled.

### Authorization and Row-Level Security (RLS)

- Enforce least-privilege access to `visit_documentation` using a combination of Postgres RLS policies and application-level checks.
- Example role separation: `admin`, `clinician`, `auditor`.
- Example RLS policy sketch (replace placeholder role checks with your auth mapping):

  ```sql
  -- Enable RLS on the table
  ALTER TABLE visit_documentation ENABLE ROW LEVEL SECURITY;

  -- Admins can see all rows
  CREATE POLICY visit_doc_admin ON visit_documentation
    FOR ALL
    USING ( current_setting('app.current_role', true) = 'admin' );

  -- Clinicians can see rows for visits assigned to them (application must set app.current_user_id and map visits)
  CREATE POLICY visit_doc_clinician ON visit_documentation
    FOR SELECT
    USING (
      current_setting('app.current_role', true) = 'clinician'
      AND visit_id IN (
        SELECT id FROM visits WHERE staff_id = current_setting('app.current_user_id', true)::uuid
      )
    );

  -- Auditors can SELECT only (read-only)
  CREATE POLICY visit_doc_auditor ON visit_documentation
    FOR SELECT
    USING ( current_setting('app.current_role', true) = 'auditor' );
  ```

- Ensure the application sets the appropriate `app.current_role` and `app.current_user_id` using `SET LOCAL` inside each DB transaction, or rely on a trusted session variable mechanism provided by your DB driver/connection pool.
- In addition to RLS, apply GRANTs for object-level privileges (for example, only the migration/deploy role can ALTER TABLE; application roles get INSERT/UPDATE/SELECT as required).
- Keep RBAC mapping documented (which application roles map to DB session roles) and enforce authorization checks in the application for complex business rules not easily expressed as RLS.

### Compliance and Implementation References

 - [PostgreSQL RLS docs](https://www.postgresql.org/docs/current/ddl-rowsecurity.html)
 - [Audit table and trigger patterns](https://wiki.postgresql.org/wiki/Audit_logging)
 - [AWS KMS & RDS encryption best practices](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/Overview.Encryption.html)
 - [GCP disk encryption docs](https://cloud.google.com/compute/docs/disks/customer-supplied-encryption)
 - GDPR/PHIPA/PIPEDA compliance guidance: include legal/compliance team's checklist and retention policy


---

## Testing

### Manual Testing

```sql
-- Test 1: Insert documentation with JSONB
INSERT INTO visit_documentation (
  visit_id,
  vital_signs,
  activities,
  observations
) VALUES (
  (SELECT id FROM visits LIMIT 1),
  '{"blood_pressure": "120/80", "heart_rate": 72}'::jsonb,
  '[{"activity": "Medication", "completed": true}]'::jsonb,
  'Client doing well'
);

-- Test 2: Query JSONB with containment
SELECT * FROM visit_documentation
WHERE vital_signs ? 'blood_pressure';

-- Test 3: Query JSONB with value comparison
SELECT * FROM visit_documentation
WHERE (vital_signs->>'heart_rate')::int > 70;

-- Test 4: Test CASCADE delete
-- Capture a visit_id, delete that visit, then verify documentation for that visit is gone
WITH target AS (
  SELECT visit_id FROM visit_documentation LIMIT 1
), deleted AS (
  DELETE FROM visits WHERE id = (SELECT visit_id FROM target) RETURNING id
)
SELECT COUNT(*) AS remaining_docs_for_deleted_visit
FROM visit_documentation
WHERE visit_id = (SELECT visit_id FROM target);
-- Expect remaining_docs_for_deleted_visit = 0

-- Test 5: Test updated_at trigger
UPDATE visit_documentation
SET observations = 'Updated observation'
WHERE id = (SELECT id FROM visit_documentation LIMIT 1);
-- Verify updated_at changed
```

---

## Integration with Visits Table

### Relationship

```text
visits (1) ---- (1) visit_documentation
```

- One visit has exactly one documentation record (one-to-one relationship)
- Documentation is created when visit is completed
- Documentation can be updated multiple times
- Documentation is deleted when visit is deleted

### Typical Workflow

1. **Visit Created**: `INSERT INTO visits (...)`
2. **Visit Started**: Caregiver checks in
3. **Documentation Created**: `INSERT INTO visit_documentation (...)`
4. **Documentation Updated**: Caregiver adds notes, vitals, activities
5. **Visit Completed**: Caregiver checks out
6. **Documentation Finalized**: Final updates, signature added

---

## Next Steps

1. **V3: Visit Photos Table** (Task V3)
   - Create `visit_photos` table
   - Store S3 URLs for photos
   - Foreign key to `visits` table

2. **V4: POST /v1/visits Endpoint** (Task V4)
   - Implement visit creation endpoint
   - Create visit and documentation together
   - Support smart data reuse

3. **API Endpoints for Documentation**
   - GET /v1/visits/:visitId/documentation
   - PATCH /v1/visits/:visitId/documentation
   - Support partial updates

---

## Related Documentation

- [V1: Visits Migration](./V1-visits-migration.md)
- [Architecture Blueprint](../project-documentation/architecture-output.md)
- [Task Plan](../project-documentation/task-plan.md)
- [Visit Documentation PR Template](../.github/PULL_REQUEST_TEMPLATE/visit-documentation-pr.md)

---

## Migration Files

- **Forward Migration:** `apps/backend/src/db/migrations/005_create_visit_documentation.sql`
- **Rollback Migration:** `apps/backend/src/db/migrations/005_create_visit_documentation-down.sql`
- **Migration Runner:** `apps/backend/src/db/migrate.ts`

---

## Success Criteria

- ✅ Migration file created
- ✅ Rollback migration created
- ✅ Migration runs successfully
- ✅ Table created with all fields
- ✅ Foreign key constraint working (CASCADE delete)
- ✅ All 3 indexes created (1 B-tree, 2 GIN)
- ✅ JSONB data insertion and retrieval working
- ✅ GIN indexes enable JSONB queries
- ✅ Trigger for updated_at working
- ✅ Schema verified in database

---

**Status:** ✅ Complete
**Next Task:** V3 - Visit Photos Table Migration
