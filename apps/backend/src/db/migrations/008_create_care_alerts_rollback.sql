-- Rollback Migration: 008_create_care_alerts
-- Description: Rollback care_alerts table
-- Author: Backend Engineer
-- Date: 2025-10-20

-- ============================================================================
-- ROLLBACK INSTRUCTIONS
-- ============================================================================
-- This script safely removes all objects created by 008_create_care_alerts.sql
-- Execute this script to revert the migration

BEGIN;

-- Drop triggers first (depend on table)
DROP TRIGGER IF EXISTS update_care_alerts_updated_at ON care_alerts;

-- Drop indexes
DROP INDEX IF EXISTS idx_care_alerts_coordinator_status;
DROP INDEX IF EXISTS idx_care_alerts_client_id;
DROP INDEX IF EXISTS idx_care_alerts_staff_id;
DROP INDEX IF EXISTS idx_care_alerts_status_initiated;
DROP INDEX IF EXISTS idx_care_alerts_type_initiated;
DROP INDEX IF EXISTS idx_care_alerts_coordinator_initiated;

-- Drop table (CASCADE will remove foreign key constraints)
DROP TABLE IF EXISTS care_alerts CASCADE;

COMMIT;
