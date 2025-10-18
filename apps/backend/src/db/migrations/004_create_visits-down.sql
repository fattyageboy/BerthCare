-- Rollback Migration: 004_create_visits
-- Description: Rollback visits table
-- Author: Backend Engineer
-- Date: 2025-10-11

-- ============================================================================
-- ROLLBACK INSTRUCTIONS
-- ============================================================================
-- This script safely removes all objects created by 004_create_visits.sql
-- Execute this script to revert the migration

-- Drop trigger first
DROP TRIGGER IF EXISTS update_visits_updated_at ON visits;

-- Drop indexes (will be automatically dropped with table, but explicit for clarity)
DROP INDEX IF EXISTS idx_visits_status_scheduled;
DROP INDEX IF EXISTS idx_visits_unsynced;
DROP INDEX IF EXISTS idx_visits_client_scheduled;
DROP INDEX IF EXISTS idx_visits_staff_scheduled;
DROP INDEX IF EXISTS idx_visits_status;
DROP INDEX IF EXISTS idx_visits_scheduled_time;
DROP INDEX IF EXISTS idx_visits_staff_id;
DROP INDEX IF EXISTS idx_visits_client_id;

-- Drop table (CASCADE to handle foreign key dependencies from other tables)
DROP TABLE IF EXISTS visits CASCADE;
