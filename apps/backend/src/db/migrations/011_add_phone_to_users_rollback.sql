-- Migration Rollback: 011_add_phone_to_users
-- Description: Remove phone_number column from users table
-- Author: Backend Engineer
-- Date: 2025-10-23

-- ============================================================================
-- DROP INDEX
-- ============================================================================

DROP INDEX IF EXISTS idx_users_phone_number;

-- ============================================================================
-- DROP CHECK CONSTRAINT
-- ============================================================================

ALTER TABLE users
DROP CONSTRAINT IF EXISTS check_phone_number_e164;

-- ============================================================================
-- DROP COLUMN
-- ============================================================================

ALTER TABLE users
DROP COLUMN IF EXISTS phone_number;
