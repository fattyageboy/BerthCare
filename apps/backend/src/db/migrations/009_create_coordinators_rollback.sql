-- Rollback Migration: 009_create_coordinators
-- Description: Rollback coordinators table
-- Author: Backend Engineer
-- Date: 2025-10-20

-- ============================================================================
-- ROLLBACK INSTRUCTIONS
-- ============================================================================
-- This script safely removes all objects created by 009_create_coordinators.sql
-- Execute this script to revert the migration

BEGIN;

-- Drop triggers first (depend on table)
DROP TRIGGER IF EXISTS update_coordinators_updated_at ON coordinators;

-- Drop indexes
DROP INDEX IF EXISTS idx_coordinators_zone_active;
DROP INDEX IF EXISTS idx_coordinators_user_id;
DROP INDEX IF EXISTS idx_coordinators_backup;
DROP INDEX IF EXISTS idx_coordinators_active;

-- Drop table (CASCADE will remove foreign key constraints)
DROP TABLE IF EXISTS coordinators CASCADE;

COMMIT;
