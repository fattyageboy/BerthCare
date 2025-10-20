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

**Schema:**
```sql
care_alerts (
  id UUID PRIMARY KEY,
  client_id UUID → clients(id),
  staff_id UUID → users(id),
  coordinator_id UUID → users(id),
  alert_type ENUM,
  voice_message_url TEXT,
  status ENUM,
  initiated_at TIMESTAMP,
  answered_at TIMESTAMP,
  escalated_at TIMESTAMP,
  resolved_at TIMESTAMP,
  outcome TEXT
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
```
initiated → ringing → answered → resolved
                   ↓
              no_answer → escalated → resolved
```

**Indexes:**
- `idx_care_alerts_coordinator_status` - Fast coordinator dashboard queries
- `idx_care_alerts_client_id` - Client alert history
- `idx_care_alerts_staff_id` - Caregiver alert history
- `idx_care_alerts_status_initiated` - SLA monitoring
- `idx_care_alerts_type_initiated` - Alert type analytics
- `idx_care_alerts_coordinator_initiated` - Recent alerts by coordinator

### 009_create_coordinators.sql

Creates the `coordinators` table for care coordinator management and alert routing.

**Key Features:**
- Zone-based coordinator assignment
- Backup coordinator failover support
- Active/inactive status tracking
- Phone number for Twilio voice alerts

**Schema:**
```sql
coordinators (
  id UUID PRIMARY KEY,
  user_id UUID → users(id) UNIQUE,
  zone_id UUID → zones(id),
  phone_number VARCHAR(20),
  backup_coordinator_id UUID → coordinators(id),
  is_active BOOLEAN
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

**Simplicity is the Ultimate Sophistication**
- Voice alerts, not messaging platform
- Simple status flow, not complex state machine
- Clear relationships, not over-normalized schema

**Obsess Over Details**
- Comprehensive indexes for sub-second queries
- Timestamp constraints ensure data integrity
- Soft deletes preserve audit trail

**Start with User Experience**
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
- Soft deletes with WHERE clauses on indexes
- Composite indexes for multi-column queries
- Foreign keys for referential integrity

## Testing

```sql
-- Verify tables exist
SELECT table_name FROM information_schema.tables 
WHERE table_schema = 'public' 
AND table_name IN ('care_alerts', 'coordinators');

-- Verify indexes exist
SELECT indexname FROM pg_indexes 
WHERE tablename IN ('care_alerts', 'coordinators');

-- Test alert creation
INSERT INTO care_alerts (
  client_id, staff_id, coordinator_id, 
  alert_type, status
) VALUES (
  'client-uuid', 'staff-uuid', 'coordinator-uuid',
  'medical_concern', 'initiated'
);

-- Test coordinator creation
INSERT INTO coordinators (
  user_id, zone_id, phone_number, is_active
) VALUES (
  'user-uuid', 'zone-uuid', '+1234567890', true
);
```

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
