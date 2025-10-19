-- Rollback Migration: 002_create_clients
-- Description: Rollback clients table
-- Author: Backend Engineer
-- Date: 2025-10-10

-- ============================================================================
-- ROLLBACK INSTRUCTIONS
-- ============================================================================
-- This script safely removes all objects created by 002_create_clients.sql
-- Execute this script to revert the migration

-- Drop trigger first
DROP TRIGGER IF EXISTS update_clients_updated_at ON clients;

-- Drop indexes (will be automatically dropped with table, but explicit for clarity)
DROP INDEX IF EXISTS idx_clients_full_name;
DROP INDEX IF EXISTS idx_clients_location;
DROP INDEX IF EXISTS idx_clients_zone_last_name;
DROP INDEX IF EXISTS idx_clients_last_name;
DROP INDEX IF EXISTS idx_clients_zone_id;

-- Drop table (CASCADE to handle foreign key dependencies from other tables)
DROP TABLE IF EXISTS clients CASCADE;
