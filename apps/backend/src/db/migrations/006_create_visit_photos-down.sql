-- Rollback Migration: 006_create_visit_photos
-- Description: Rollback visit_photos table
-- Author: Backend Engineer
-- Date: 2025-10-11

-- ============================================================================
-- ROLLBACK INSTRUCTIONS
-- ============================================================================
-- This script safely removes all objects created by 006_create_visit_photos.sql
-- Execute this script to revert the migration

-- Drop indexes (will be automatically dropped with table, but explicit for clarity)
DROP INDEX IF EXISTS idx_visit_photos_visit_uploaded;
DROP INDEX IF EXISTS idx_visit_photos_uploaded_at;
DROP INDEX IF EXISTS idx_visit_photos_visit_id;

-- Drop table (CASCADE to handle any dependencies)
DROP TABLE IF EXISTS visit_photos CASCADE;
