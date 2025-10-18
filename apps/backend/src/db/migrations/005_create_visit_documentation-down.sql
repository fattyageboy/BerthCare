-- Rollback Migration: 005_create_visit_documentation
-- Description: Rollback visit_documentation table
-- Author: Backend Engineer
-- Date: 2025-10-11

-- ============================================================================
-- ROLLBACK INSTRUCTIONS
-- ============================================================================
-- This script safely removes all objects created by 005_create_visit_documentation.sql
-- Execute this script to revert the migration

-- Drop trigger first
DROP TRIGGER IF EXISTS update_visit_documentation_updated_at ON visit_documentation;

-- Drop indexes (will be automatically dropped with table, but explicit for clarity)
DROP INDEX IF EXISTS idx_visit_documentation_activities;
DROP INDEX IF EXISTS idx_visit_documentation_vital_signs;
DROP INDEX IF EXISTS idx_visit_documentation_visit_id;

-- Drop table (CASCADE to handle any dependencies)
DROP TABLE IF EXISTS visit_documentation CASCADE;
