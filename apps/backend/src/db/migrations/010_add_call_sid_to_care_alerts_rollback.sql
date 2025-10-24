-- Rollback Migration: 010_add_call_sid_to_care_alerts
-- Description: Remove call_sid column from care_alerts table

-- Drop index first
DROP INDEX IF EXISTS idx_care_alerts_call_sid;

-- Drop column
ALTER TABLE care_alerts
DROP COLUMN IF EXISTS call_sid;
