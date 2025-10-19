-- Rollback Migration: 003_create_care_plans
-- Description: Rollback care_plans table
-- Author: Backend Engineer
-- Date: 2025-10-10

-- ============================================================================
-- ROLLBACK INSTRUCTIONS
-- ============================================================================
-- This script safely removes all objects created by 003_create_care_plans.sql
-- Execute this script to revert the migration

-- Drop triggers first (depend on functions)
DROP TRIGGER IF EXISTS increment_care_plan_version_trigger ON care_plans;
DROP TRIGGER IF EXISTS update_care_plans_updated_at ON care_plans;

-- Drop functions
DROP FUNCTION IF EXISTS validate_allergies_structure(JSONB);
DROP FUNCTION IF EXISTS validate_medication_structure(JSONB);
DROP FUNCTION IF EXISTS increment_care_plan_version();

-- Drop indexes (will be automatically dropped with table, but explicit for clarity)
DROP INDEX IF EXISTS idx_care_plans_version;
DROP INDEX IF EXISTS idx_care_plans_allergies;
DROP INDEX IF EXISTS idx_care_plans_medications;
DROP INDEX IF EXISTS idx_care_plans_client_id;
DROP INDEX IF EXISTS idx_care_plans_client_unique;

-- Drop table (CASCADE to handle any foreign key dependencies from other tables)
DROP TABLE IF EXISTS care_plans CASCADE;
