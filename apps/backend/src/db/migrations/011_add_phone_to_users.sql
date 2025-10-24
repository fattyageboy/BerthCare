-- Migration: 011_add_phone_to_users
-- Description: Add phone_number column to users table for SMS notifications
-- Author: Backend Engineer
-- Date: 2025-10-23
-- Reference: Task T6 - Alert resolution tracking with caregiver notification

-- ============================================================================
-- ADD PHONE_NUMBER COLUMN
-- ============================================================================
-- Stores phone number for SMS notifications (alert resolutions, etc.)
-- Enforces E.164 format: +[country code][number] (e.g., +15551234567)

ALTER TABLE users
ADD COLUMN phone_number VARCHAR(20);

-- ============================================================================
-- ADD CHECK CONSTRAINT
-- ============================================================================
-- Enforce E.164 format: starts with +, followed by 1-15 digits
-- E.164 format: +[1-9][0-9]{0,14}
-- Examples: +15551234567 (US), +442071234567 (UK), +81312345678 (Japan)

ALTER TABLE users
ADD CONSTRAINT check_phone_number_e164 
    CHECK (phone_number IS NULL OR phone_number ~ '^\+[1-9][0-9]{0,14}$');

-- ============================================================================
-- CREATE INDEX
-- ============================================================================
-- Fast lookup by phone number for SMS delivery

CREATE INDEX IF NOT EXISTS idx_users_phone_number
    ON users (phone_number)
    WHERE phone_number IS NOT NULL AND deleted_at IS NULL;

-- ============================================================================
-- COMMENTS
-- ============================================================================

COMMENT ON COLUMN users.phone_number IS 'Phone number for SMS notifications (E.164 format: +[country code][number])';
