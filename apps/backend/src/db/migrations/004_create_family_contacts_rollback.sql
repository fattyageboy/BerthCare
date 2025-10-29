-- Rollback Migration: 004_create_family_contacts
-- Description: Rollback family_contacts table
-- Author: Backend Engineer
-- Date: 2025-10-29

-- ============================================================================
-- ROLLBACK INSTRUCTIONS
-- ============================================================================
-- This script safely removes all objects created by 004_create_family_contacts.sql
-- Execute this script to revert the migration

-- Drop helper functions
DROP FUNCTION IF EXISTS format_phone_display(VARCHAR);
DROP FUNCTION IF EXISTS get_effective_contact_time(TIME);

-- Drop trigger
DROP TRIGGER IF EXISTS update_family_contacts_updated_at ON family_contacts;

-- Drop indexes (will be automatically dropped with table, but explicit for clarity)
DROP INDEX IF EXISTS idx_family_contacts_alerts;
DROP INDEX IF EXISTS idx_family_contacts_daily_messages;
DROP INDEX IF EXISTS idx_family_contacts_phone_unique;
DROP INDEX IF EXISTS idx_family_contacts_client_id;

-- Drop table (CASCADE to handle foreign key dependencies from other tables)
DROP TABLE IF EXISTS family_contacts CASCADE;
