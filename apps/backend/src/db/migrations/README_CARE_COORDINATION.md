# Care Coordination Database Schema

## Overview

These migrations establish the database schema for BerthCare's voice alert and care coordination system, following our design philosophy of simplicity and invisible technology.

## Migrations

### 008_create_care_alerts.sql

Creates the `care_alerts` table for tracking voice alerts from caregivers to coordinators.

**Key Features:**

- Voice-first alert tracking (no messaging platform needed)
- SLA monitoring with timestamp tracking
- Escalation support for backup coordinators
- Comprehensive outcome documentation
- Audit timestamps (created_at, updated_at) with automatic updates
- Soft delete support for compliance and historical reporting
- Timestamp constraints ensure data integrity

**Schema:**

```sql
care_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL → clients(id) ON DELETE CASCADE,
  staff_id UUID NOT NULL → users(id) ON DELETE CASCADE,
  coordinator_id UUID NOT NULL → users(id) ON DELETE CASCADE,
  alert_type care_alert_type NOT NULL,
  voice_message_url TEXT,
  status care_alert_status NOT NULL DEFAULT 'initiated',
  initiated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  answered_at TIMESTAMP,
  escalated_at TIMESTAMP,
  resolved_at TIMESTAMP,
  outcome TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP, -- Soft delete support
  CONSTRAINT check_answered_after_initiated CHECK (answered_at IS NULL OR answered_at >= initiated_at),
  CONSTRAINT check_escalated_after_initiated CHECK (escalated_at IS NULL OR escalated_at >= initiated_at),
  CONSTRAINT check_resolved_after_initiated CHECK (resolved_at IS NULL OR resolved_at >= initiated_at)
)
```

**Alert Types:**

- `medical_concern` - Health issues requiring immediate attention
- `medication_issue` - Problems with medication administration
- `behavioral_change` - Unusual client behavior
- `safety_concern` - Safety hazards or risks
- `family_request` - Family member requests
- `equipment_issue` - Medical equipment problems
- `other` - Other urgent matters

**Status Flow:**

```text
initiated → ringing → answered → resolved
         ↓         ↓         ↓         
         ↓         ↓         └────→ cancelled
         ↓         ↓
         ↓    no_answer → escalated → resolved
         ↓         ↓         ↓
         └─────→ cancelled ←─┘
```

**Status Definitions:**

- `initiated` - Alert created, call about to be placed
- `ringing` - Outbound call in progress to primary coordinator
- `answered` - Primary coordinator picked up the call
- `no_answer` - Primary coordinator did not answer (timeout/declined)
- `escalated` - Call routed to backup coordinator
- `resolved` - Issue addressed and alert closed
- `cancelled` - Alert manually stopped by caregiver or coordinator

**State Transition Rules:**

| From State  | To State    | Trigger                                    | Notes                                      |
|-------------|-------------|--------------------------------------------|--------------------------------------------|
| `initiated` | `ringing`   | Twilio call initiated                      | Automatic transition                       |
| `initiated` | `cancelled` | Caregiver cancels before call starts       | Manual action                              |
| `ringing`   | `answered`  | Coordinator picks up call                  | Twilio webhook callback                    |
| `ringing`   | `no_answer` | Call timeout or coordinator declines       | Twilio webhook callback                    |
| `ringing`   | `cancelled` | Caregiver cancels during ring              | Manual action                              |
| `answered`  | `resolved`  | Coordinator marks issue as resolved        | Manual action                              |
| `answered`  | `cancelled` | Coordinator or caregiver ends call early   | Manual action (rare)                       |
| `no_answer` | `escalated` | System routes to backup coordinator        | Automatic if backup exists                 |
| `no_answer` | `cancelled` | No backup available or caregiver cancels   | Manual or automatic                        |
| `escalated` | `resolved`  | Backup coordinator resolves issue          | Manual action                              |
| `escalated` | `cancelled` | Backup also unavailable or caregiver stops | Manual action                              |

**Terminal States:**

- `resolved` - Final state, alert successfully handled
- `cancelled` - Final state, alert stopped without resolution

**Important Constraints:**

1. **No Backward Transitions**: Once an alert moves forward (e.g., `ringing` → `answered`), it cannot go back to a previous state
2. **No Escalation from Answered**: If primary coordinator answers, the alert cannot be escalated (they own the issue)
3. **Escalation Only from No Answer**: `escalated` state is only reachable from `no_answer`
4. **Terminal States are Final**: `resolved` and `cancelled` cannot transition to any other state
5. **Cancelled is Reachable from Most States**: Except `resolved` (already terminal)

**Edge Cases:**

- **Backup coordinator also doesn't answer**: Alert remains in `escalated` state until manually cancelled or backup answers
- **Multiple backup attempts**: Not supported - only one escalation level (primary → backup)
- **Re-opening resolved alerts**: Not supported - create a new alert instead
- **Simultaneous state changes**: Last write wins (use `updated_at` for conflict detection)

**Indexes:**

- `idx_care_alerts_coordinator_status` - Fast coordinator dashboard queries
- `idx_care_alerts_client_id` - Client alert history
- `idx_care_alerts_staff_id` - Caregiver alert history
- `idx_care_alerts_status_initiated` - SLA monitoring
- `idx_care_alerts_type_initiated` - Alert type analytics
- `idx_care_alerts_coordinator_initiated` - Recent alerts by coordinator

**Implementation Guidance:**

When implementing state transitions in application code:

```typescript
// Example: Valid state transition check
const VALID_TRANSITIONS: Record<string, string[]> = {
  initiated: ['ringing', 'cancelled'],
  ringing: ['answered', 'no_answer', 'cancelled'],
  answered: ['resolved', 'cancelled'],
  no_answer: ['escalated', 'cancelled'],
  escalated: ['resolved', 'cancelled'],
  resolved: [], // Terminal state
  cancelled: [], // Terminal state
};

function isValidTransition(currentStatus: string, newStatus: string): boolean {
  return VALID_TRANSITIONS[currentStatus]?.includes(newStatus) ?? false;
}

// Example: Update alert status with validation
async function updateAlertStatus(alertId: string, newStatus: string) {
  const alert = await getAlert(alertId);
  
  if (!isValidTransition(alert.status, newStatus)) {
    throw new Error(
      `Invalid transition from ${alert.status} to ${newStatus}`
    );
  }
  
  // Update status and set appropriate timestamp
  await updateAlert(alertId, {
    status: newStatus,
    answered_at: newStatus === 'answered' ? new Date() : alert.answered_at,
    escalated_at: newStatus === 'escalated' ? new Date() : alert.escalated_at,
    resolved_at: newStatus === 'resolved' ? new Date() : alert.resolved_at,
  });
}
```

### 009_create_coordinators.sql

Creates the `coordinators` table for care coordinator management and alert routing.

**Key Features:**

- Zone-based coordinator assignment
- Backup coordinator failover support
- Active/inactive status tracking (default: true)
- Phone number for Twilio voice alerts
- Audit timestamps (created_at, updated_at) with automatic updates
- Soft delete support for compliance and historical reporting
- Self-reference constraint prevents coordinator from being own backup

**Schema:**

```sql
coordinators (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE → users(id) ON DELETE CASCADE,
  zone_id UUID NOT NULL → zones(id) ON DELETE RESTRICT,
  phone_number VARCHAR(20) NOT NULL,
  backup_coordinator_id UUID → coordinators(id) ON DELETE SET NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP, -- Soft delete support
  CONSTRAINT check_not_own_backup CHECK (id != backup_coordinator_id)
)
```

**Indexes:**

- `idx_coordinators_zone_active` - Fast alert routing by zone
- `idx_coordinators_user_id` - Coordinator profile lookup
- `idx_coordinators_backup` - Backup coordinator escalation
- `idx_coordinators_active` - Active coordinator listing

## Running Migrations

### Apply Migrations

```bash
# Run both migrations in order
psql -U postgres -d berthcare -f 008_create_care_alerts.sql
psql -U postgres -d berthcare -f 009_create_coordinators.sql
```

### Rollback Migrations

```bash
# Rollback in reverse order
psql -U postgres -d berthcare -f 009_create_coordinators_rollback.sql
psql -U postgres -d berthcare -f 008_create_care_alerts_rollback.sql
```

## Design Philosophy Alignment

#### Simplicity is the Ultimate Sophistication

- Voice alerts, not messaging platform
- Simple status flow, not complex state machine
- Clear relationships, not over-normalized schema

#### Obsess Over Details

- Comprehensive indexes for sub-second queries
- Timestamp constraints ensure data integrity
- Soft deletes preserve audit trail

#### Start with User Experience

- Schema designed for <15 second alert delivery
- SLA monitoring built into timestamps
- Escalation support for reliability

## Performance Considerations

**Expected Query Patterns:**

1. Get active alerts for coordinator (most frequent)
2. Find coordinator for zone (alert routing)
3. Track alert SLA metrics (monitoring)
4. Client alert history (care planning)

**Optimization:**

- All common queries use indexes
- Soft deletes with WHERE clauses on indexes (deleted_at IS NULL)
- Composite indexes for multi-column queries
- Foreign keys for referential integrity

**Soft Delete Strategy:**

- Records are never physically deleted from the database
- Setting `deleted_at` timestamp marks records as deleted
- All indexes include `WHERE deleted_at IS NULL` for performance
- Preserves complete audit trail for compliance and analytics
- Application/ORM layer is responsible for filtering soft-deleted rows: repository helpers and services must always include `deleted_at IS NULL` (or call the shared query utilities that already do so) when reading coordinator, alert, or user data
- No automatic database view/trigger/RLS filtering is in place—developers must use the approved helper queries or apply the standard filter themselves to avoid leaking soft-deleted records back into the API responses
- Deleted records remain queryable for historical reporting

## Testing

### Verify Migration Success

```sql
-- Verify tables exist
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public'
AND table_name IN ('care_alerts', 'coordinators');

-- Verify indexes exist
SELECT indexname FROM pg_indexes
WHERE tablename IN ('care_alerts', 'coordinators');

-- Verify enum types exist
SELECT typname FROM pg_type
WHERE typname IN ('care_alert_type', 'care_alert_status');
```

### Load Test Fixtures

Test fixtures are provided in a separate file to avoid cluttering this README and to ensure they stay synchronized with schema changes.

**Fixture File:** `apps/backend/src/db/fixtures/care_coordination_fixtures.sql`

**Prerequisites:**
- Migrations 001-009 must be applied
- Requires existing tables: zones, users, clients, coordinators, care_alerts

**Load Fixtures:**

```bash
# After applying migrations, load test fixtures
psql -U postgres -d berthcare -f apps/backend/src/db/fixtures/care_coordination_fixtures.sql
```

**Important Notes:**

1. The fixture file uses `RETURNING` clauses to output generated IDs
2. You must manually capture and replace placeholder values (e.g., `<zone_id>`) in subsequent INSERTs
3. The fixture file includes detailed schema documentation for all prerequisite tables
4. Cleanup commands are provided at the end of the fixture file

**Alternative - Query Existing Data:**

If you already have data in your database:

```sql
-- Find existing IDs to use for testing
SELECT
  (SELECT id FROM zones LIMIT 1) AS zone_id,
  (SELECT id FROM users WHERE role = 'caregiver' LIMIT 1) AS caregiver_id,
  (SELECT id FROM users WHERE role = 'coordinator' LIMIT 1) AS coordinator_id,
  (SELECT id FROM clients LIMIT 1) AS client_id;
```

**Maintenance:**

When schema changes occur in migrations, update the fixture file accordingly:
- Update prerequisite schema documentation
- Adjust INSERT statements to match new columns/constraints
- Update cleanup commands if table relationships change

## Next Steps

1. Create Twilio integration service
2. Implement alert routing logic
3. Build escalation workflow
4. Add SLA monitoring alerts
5. Create coordinator dashboard

---

**Reference:** Architecture Blueprint - Voice Alert Service  
**Task:** T1 - Design database schema – care coordination  
**Status:** ✅ Complete
