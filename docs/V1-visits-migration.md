# V1: Visits Table Migration

**Task ID:** V1  
**Status:** ✅ Complete  
**Date:** October 11, 2025  
**Migration:** 004_create_visits.sql  
**Estimated Effort:** 0.5 days  
**Actual Effort:** 0.5 days

---

## Overview

Created the `visits` table to support visit documentation and tracking for the BerthCare home care system. This table is the foundation for the offline-first mobile app, enabling caregivers to check in/out of visits with GPS verification and smart data reuse.

---

## Database Schema

### Table: visits

```sql
CREATE TABLE visits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  staff_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  scheduled_start_time TIMESTAMP WITH TIME ZONE NOT NULL,
  check_in_time TIMESTAMP WITH TIME ZONE,
  check_in_latitude DECIMAL(10, 8),
  check_in_longitude DECIMAL(11, 8),
  check_out_time TIMESTAMP WITH TIME ZONE,
  check_out_latitude DECIMAL(10, 8),
  check_out_longitude DECIMAL(11, 8),
  status VARCHAR(50) NOT NULL DEFAULT 'scheduled',
  duration_minutes INTEGER,
  copied_from_visit_id UUID REFERENCES visits(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  synced_at TIMESTAMP WITH TIME ZONE
);
```

### Field Descriptions

| Field                  | Type          | Nullable | Description                                 |
| ---------------------- | ------------- | -------- | ------------------------------------------- |
| `id`                   | UUID          | NOT NULL | Unique visit identifier                     |
| `client_id`            | UUID          | NOT NULL | Reference to client being visited           |
| `staff_id`             | UUID          | NOT NULL | Reference to caregiver performing visit     |
| `scheduled_start_time` | TIMESTAMP     | NOT NULL | Scheduled start time for the visit          |
| `check_in_time`        | TIMESTAMP     | NULL     | Actual time caregiver checked in (arrived)  |
| `check_in_latitude`    | DECIMAL(10,8) | NULL     | GPS latitude at check-in                    |
| `check_in_longitude`   | DECIMAL(11,8) | NULL     | GPS longitude at check-in                   |
| `check_out_time`       | TIMESTAMP     | NULL     | Actual time caregiver checked out (left)    |
| `check_out_latitude`   | DECIMAL(10,8) | NULL     | GPS latitude at check-out                   |
| `check_out_longitude`  | DECIMAL(11,8) | NULL     | GPS longitude at check-out                  |
| `status`               | VARCHAR(50)   | NOT NULL | Visit status (ENUM constraint)              |
| `duration_minutes`     | INTEGER       | NULL     | Calculated visit duration in minutes        |
| `copied_from_visit_id` | UUID          | NULL     | Reference to previous visit for data reuse  |
| `created_at`           | TIMESTAMP     | NOT NULL | Record creation timestamp                   |
| `updated_at`           | TIMESTAMP     | NOT NULL | Record last update timestamp                |
| `synced_at`            | TIMESTAMP     | NULL     | Last sync timestamp (offline-first support) |

---

## Status ENUM Values

The `status` field is constrained to the following values:

- **scheduled**: Visit is scheduled but not started
- **in_progress**: Caregiver has checked in, visit is active
- **completed**: Visit is finished, caregiver has checked out
- **cancelled**: Visit was cancelled

---

## Indexes

Eight indexes were created to optimize common query patterns:

### 1. idx_visits_client_id

```sql
CREATE INDEX idx_visits_client_id ON visits(client_id);
```

**Purpose:** Fast lookup of all visits for a specific client  
**Query Pattern:** "Get visit history for this client"

### 2. idx_visits_staff_id

```sql
CREATE INDEX idx_visits_staff_id ON visits(staff_id);
```

**Purpose:** Fast lookup of all visits for a specific caregiver  
**Query Pattern:** "Get all visits for this caregiver"

### 3. idx_visits_scheduled_time

```sql
CREATE INDEX idx_visits_scheduled_time ON visits(scheduled_start_time);
```

**Purpose:** Fast lookup by scheduled time  
**Query Pattern:** "Get all visits scheduled for today"

### 4. idx_visits_status

```sql
CREATE INDEX idx_visits_status ON visits(status);
```

**Purpose:** Fast filtering by visit status  
**Query Pattern:** "Get all in-progress visits" or "Get completed visits"

### 5. idx_visits_staff_scheduled

```sql
CREATE INDEX idx_visits_staff_scheduled ON visits(staff_id, scheduled_start_time);
```

**Purpose:** Composite index for caregiver's daily schedule  
**Query Pattern:** "Get today's schedule for this caregiver"

### 6. idx_visits_client_scheduled

```sql
CREATE INDEX idx_visits_client_scheduled ON visits(client_id, scheduled_start_time DESC);
```

**Purpose:** Composite index for client's visit history  
**Query Pattern:** "Get recent visits for this client"

### 7. idx_visits_unsynced

```sql
CREATE INDEX idx_visits_unsynced ON visits(synced_at) WHERE synced_at IS NULL;
```

**Purpose:** Partial index for offline sync support  
**Query Pattern:** "Find all visits that need to be synced"

### 8. idx_visits_status_scheduled

```sql
CREATE INDEX idx_visits_status_scheduled ON visits(status, scheduled_start_time);
```

**Purpose:** Composite index for operational queries  
**Query Pattern:** "Get all scheduled visits for today" or "Get completed visits this week"

---

## Constraints

### Foreign Key Constraints

1. **visits_client_id_fkey**
   - References: `clients(id)`
   - On Delete: `RESTRICT` (cannot delete client with visits)

2. **visits_staff_id_fkey**
   - References: `users(id)`
   - On Delete: `RESTRICT` (cannot delete user with visits)

3. **visits_copied_from_visit_id_fkey**
   - References: `visits(id)`
   - On Delete: `SET NULL` (safe to delete source visit)

### Check Constraints

1. **visits_status_check**

   ```sql
   CHECK (status IN ('scheduled', 'in_progress', 'completed', 'cancelled'))
   ```

   Ensures status is one of the valid ENUM values

2. **check_times_logical**

   ```sql
   CHECK (check_out_time IS NULL OR check_in_time IS NULL OR check_out_time >= check_in_time)
   ```

   Ensures check-out time is after check-in time

3. **check_duration_matches**

   ```sql
   CHECK (duration_minutes IS NULL OR check_in_time IS NULL OR check_out_time IS NULL
          OR duration_minutes = ROUND(EXTRACT(EPOCH FROM (check_out_time - check_in_time)) / 60)::INTEGER)
   ```

   Ensures duration_minutes matches the actual time difference (rounded to nearest minute to handle floating-point precision)

4. **visits_check_in_latitude_check**

   ```sql
   CHECK (check_in_latitude BETWEEN -90 AND 90)
   ```

   Validates GPS latitude range

5. **visits_check_in_longitude_check**

   ```sql
   CHECK (check_in_longitude BETWEEN -180 AND 180)
   ```

   Validates GPS longitude range

6. **visits_check_out_latitude_check**

   ```sql
   CHECK (check_out_latitude BETWEEN -90 AND 90)
   ```

   Validates GPS latitude range

7. **visits_check_out_longitude_check**

   ```sql
   CHECK (check_out_longitude BETWEEN -180 AND 180)
   ```

   Validates GPS longitude range

8. **visits_duration_minutes_check**
   ```sql
   CHECK (duration_minutes >= 0)
   ```
   Ensures duration is non-negative

---

## Triggers

### update_visits_updated_at

Automatically updates the `updated_at` timestamp on every row update.

```sql
CREATE TRIGGER update_visits_updated_at
    BEFORE UPDATE ON visits
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
```

---

## Migration Execution

### Running the Migration

```bash
cd apps/backend
npm run migrate:up -- 004
```

### Verification

```bash
# Check table structure
docker exec berthcare-postgres psql -U berthcare -d berthcare_dev -c "\d visits"

# Check indexes
docker exec berthcare-postgres psql -U berthcare -d berthcare_dev -c "
  SELECT indexname FROM pg_indexes
  WHERE tablename = 'visits'
  ORDER BY indexname;
"

# Check constraints
docker exec berthcare-postgres psql -U berthcare -d berthcare_dev -c "
  SELECT conname, pg_get_constraintdef(oid)
  FROM pg_constraint
  WHERE conrelid = 'visits'::regclass;
"
```

### Rollback

If needed, rollback the migration:

```bash
npm run migrate:down 004
```

---

## Design Decisions

### 1. Offline-First Support

**Decision:** Added `synced_at` field and partial index for unsynced records

**Rationale:** Caregivers work in areas with poor connectivity. The app must work offline and sync when connectivity is available.

**Implementation:**

- `synced_at` tracks when visit was last synced to server
- Partial index `idx_visits_unsynced` optimizes finding records that need sync
- NULL `synced_at` means record hasn't been synced yet

### 2. GPS Verification

**Decision:** Store GPS coordinates at check-in and check-out

**Rationale:** Verify caregivers are at the correct location when checking in/out

**Implementation:**

- Separate latitude/longitude fields for check-in and check-out
- DECIMAL(10,8) for latitude (8 decimal places = ~1mm precision)
- DECIMAL(11,8) for longitude (8 decimal places = ~1mm precision)
- Check constraints validate GPS coordinate ranges

### 3. Smart Data Reuse

**Decision:** Added `copied_from_visit_id` field

**Rationale:** Caregivers often perform similar tasks on each visit. Allow copying documentation from previous visit to save time.

**Implementation:**

- Self-referencing foreign key to `visits` table
- ON DELETE SET NULL (safe to delete source visit)
- Application logic will copy documentation from referenced visit

### 4. Duration Calculation

**Decision:** Store calculated duration in `duration_minutes` field

**Rationale:** Avoid recalculating duration on every query. Pre-calculate and store.

**Implementation:**

- INTEGER field for minutes
- Check constraint ensures it matches actual time difference (rounded to nearest minute)
- Uses ROUND() to handle floating-point precision issues
- Application calculates on check-out and rounds to nearest minute

### 5. Status ENUM as VARCHAR with CHECK Constraint

**Decision:** Use VARCHAR(50) with CHECK constraint instead of PostgreSQL ENUM type

**Rationale:**

- PostgreSQL ENUMs are difficult to modify (require migrations to add values)
- VARCHAR with CHECK constraint is more flexible
- Performance difference is negligible with proper indexing

**Implementation:**

```sql
status VARCHAR(50) NOT NULL DEFAULT 'scheduled'
  CHECK (status IN ('scheduled', 'in_progress', 'completed', 'cancelled'))
```

### 6. Comprehensive Indexing Strategy

**Decision:** Created 8 indexes covering all common query patterns

**Rationale:**

- Visits table will be heavily queried
- Mobile app needs fast response times
- Different user roles query different patterns

**Trade-offs:**

- More indexes = slower writes (acceptable for this use case)
- More indexes = more storage (acceptable for this use case)
- Benefit: Sub-100ms query response times

---

## Performance Considerations

### Expected Query Patterns

1. **Caregiver Daily Schedule** (most common)
   - Query: Get today's visits for logged-in caregiver
   - Index: `idx_visits_staff_scheduled`
   - Expected: <50ms response time

2. **Client Visit History**
   - Query: Get recent visits for a client
   - Index: `idx_visits_client_scheduled`
   - Expected: <50ms response time

3. **Operational Dashboard**
   - Query: Get all in-progress visits
   - Index: `idx_visits_status`
   - Expected: <100ms response time

4. **Offline Sync**
   - Query: Find all unsynced visits
   - Index: `idx_visits_unsynced` (partial index)
   - Expected: <50ms response time

### Storage Estimates

- Average row size: ~200 bytes
- 1,000 visits/day = 200 KB/day
- 1 year = 73 MB
- 10 years = 730 MB (very manageable)

---

## Security Considerations

### Data Isolation

- Foreign key to `staff_id` enables row-level security
- Application enforces: caregivers can only see their own visits
- Coordinators can see visits in their zone

### GPS Privacy

- GPS coordinates stored for verification only
- Not exposed to family members
- Used for operational purposes (route optimization, verification)

### Audit Trail

- `created_at` and `updated_at` provide audit trail
- All changes tracked automatically via trigger
- Immutable history (no DELETE, only soft delete if needed)

---

## Testing

### Manual Testing

```sql
-- Insert test visit
INSERT INTO visits (client_id, staff_id, scheduled_start_time, status)
VALUES (
  (SELECT id FROM clients LIMIT 1),
  (SELECT id FROM users WHERE role = 'caregiver' LIMIT 1),
  NOW() + INTERVAL '1 hour',
  'scheduled'
);

-- Test status ENUM constraint
INSERT INTO visits (client_id, staff_id, scheduled_start_time, status)
VALUES (
  (SELECT id FROM clients LIMIT 1),
  (SELECT id FROM users WHERE role = 'caregiver' LIMIT 1),
  NOW() + INTERVAL '2 hours',
  'invalid_status'  -- Should fail
);

-- Test GPS coordinate validation
INSERT INTO visits (
  client_id, staff_id, scheduled_start_time,
  check_in_latitude, check_in_longitude, status
)
VALUES (
  (SELECT id FROM clients LIMIT 1),
  (SELECT id FROM users WHERE role = 'caregiver' LIMIT 1),
  NOW(),
  91.0,  -- Invalid latitude (> 90)
  0.0,
  'in_progress'  -- Should fail
);

-- Test time logic constraint
INSERT INTO visits (
  client_id, staff_id, scheduled_start_time,
  check_in_time, check_out_time, status
)
VALUES (
  (SELECT id FROM clients LIMIT 1),
  (SELECT id FROM users WHERE role = 'caregiver' LIMIT 1),
  NOW(),
  NOW(),
  NOW() - INTERVAL '1 hour',  -- Check-out before check-in
  'completed'  -- Should fail
);
```

---

## Next Steps

1. **V2: Visit Documentation Table** (Task V2)
   - Create `visit_documentation` table
   - Store vital signs, activities, observations
   - Foreign key to `visits` table

2. **V3: Visit Photos Table** (Task V3)
   - Create `visit_photos` table
   - Store S3 URLs for photos
   - Foreign key to `visits` table

3. **V4: POST /v1/visits Endpoint** (Task V4)
   - Implement visit creation endpoint
   - Handle check-in with GPS
   - Support smart data reuse

---

## Related Documentation

- [Architecture Blueprint](../project-documentation/architecture-output.md)
- [Task Plan](../project-documentation/task-plan.md)
- [Visit Documentation PR Template](../.github/PULL_REQUEST_TEMPLATE/visit-documentation-pr.md)
- [G7: Branch Setup](./G7-visit-documentation-branch-setup.md)

---

## Migration Files

- **Forward Migration:** `apps/backend/src/db/migrations/004_create_visits.sql`
- **Rollback Migration:** `apps/backend/src/db/migrations/004_create_visits-down.sql`
- **Migration Runner:** `apps/backend/src/db/migrate.ts`

---

## Success Criteria

- ✅ Migration file created
- ✅ Rollback migration created
- ✅ Migration runs successfully
- ✅ Table created with all fields
- ✅ All 8 indexes created
- ✅ All 8 check constraints working
- ✅ Foreign key constraints working
- ✅ Status ENUM constraint working
- ✅ GPS coordinate validation working
- ✅ Time logic validation working
- ✅ Duration calculation constraint working
- ✅ Trigger for updated_at working
- ✅ Schema verified in database

---

**Status:** ✅ Complete  
**Next Task:** V2 - Visit Documentation Table Migration
