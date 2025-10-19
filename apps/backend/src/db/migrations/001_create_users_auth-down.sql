-- Rollback Migration: 001_create_users_auth
-- Description: Rollback users and refresh_tokens tables
-- Author: Backend Engineer
-- Date: 2025-10-10

-- ============================================================================
-- ROLLBACK INSTRUCTIONS
-- ============================================================================
-- This script safely removes all objects created by 001_create_users_auth.sql
-- Execute this script to revert the migration

-- Drop triggers first (depend on functions)
DROP TRIGGER IF EXISTS update_refresh_tokens_updated_at ON refresh_tokens;
DROP TRIGGER IF EXISTS update_users_updated_at ON users;

-- Drop indexes (will be automatically dropped with tables, but explicit for clarity)
DROP INDEX IF EXISTS idx_refresh_tokens_expires_at;
DROP INDEX IF EXISTS idx_refresh_tokens_device_id;
DROP INDEX IF EXISTS idx_refresh_tokens_token_hash;
DROP INDEX IF EXISTS idx_refresh_tokens_user_id;
DROP INDEX IF EXISTS idx_users_zone_role;
DROP INDEX IF EXISTS idx_users_role;
DROP INDEX IF EXISTS idx_users_zone_id;
DROP INDEX IF EXISTS idx_users_email;

-- Drop tables (CASCADE to handle foreign key dependencies)
DROP TABLE IF EXISTS refresh_tokens CASCADE;
DROP TABLE IF EXISTS users CASCADE;
