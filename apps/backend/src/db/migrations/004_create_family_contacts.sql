-- Migration: 004_create_family_contacts
-- Description: Create family_contacts table for family portal SMS system
-- Author: Backend Engineer
-- Date: 2025-10-29
-- Reference: Architecture Blueprint - Family Portal Flow section

-- ============================================================================
-- FAMILY CONTACTS TABLE
-- ============================================================================
-- Stores family member contact information for daily SMS updates and alerts
-- Supports opt-in preferences and preferred contact times for personalized communication

CREATE TABLE IF NOT EXISTS family_contacts (
    -- Primary identifier
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- Client association
    -- Foreign key to clients table with CASCADE delete
    -- When a client is deleted, their family contacts are also deleted
    client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    
    -- Family member information
    name VARCHAR(200) NOT NULL,
    relationship VARCHAR(100) NOT NULL,
    
    -- Contact information
    -- Phone number in E.164 format (e.g., +14165551234)
    -- Validated before storage to ensure Twilio compatibility
    phone_number VARCHAR(20) NOT NULL,
    
    -- Communication preferences
    -- Preferred time for daily messages (24-hour format, e.g., '18:00' for 6 PM)
    -- NULL means use system default (6 PM)
    preferred_contact_time TIME,
    
    -- Opt-in preferences for different message types
    -- opt_in_daily_updates: Receive daily status messages at 6 PM
    -- opt_in_alerts: Receive urgent care alerts (falls, medical concerns)
    opt_in_daily_updates BOOLEAN NOT NULL DEFAULT true,
    opt_in_alerts BOOLEAN NOT NULL DEFAULT true,
    
    -- Audit timestamps
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    
    -- Soft delete support
    deleted_at TIMESTAMP WITH TIME ZONE,
    
    -- Constraints
    -- Ensure phone number is in valid E.164 format
    CONSTRAINT family_contacts_phone_format CHECK (phone_number ~ '^\+[1-9]\d{1,14}$'),
    
    -- Ensure preferred contact time is reasonable (between 6 AM and 10 PM)
    CONSTRAINT family_contacts_contact_time_range CHECK (
        preferred_contact_time IS NULL OR
        (preferred_contact_time >= '06:00:00' AND preferred_contact_time <= '22:00:00')
    )
);

-- ============================================================================
-- INDEXES
-- ============================================================================
-- Optimized for common query patterns in family portal system

-- Fast lookup by client for family member lists
-- Most common query: "Get all family contacts for client X"
CREATE INDEX IF NOT EXISTS idx_family_contacts_client_id ON family_contacts(client_id) WHERE deleted_at IS NULL;

-- Fast lookup by phone number for incoming SMS webhook processing
-- Query pattern: "Which family member sent this SMS reply?"
-- Unique index ensures one contact per phone number (prevents duplicate SMS)
CREATE UNIQUE INDEX IF NOT EXISTS idx_family_contacts_phone_unique ON family_contacts(phone_number) WHERE deleted_at IS NULL;

-- Composite index for daily message generation queries
-- Query pattern: "Get all opted-in family contacts for daily messages at 6 PM"
CREATE INDEX IF NOT EXISTS idx_family_contacts_daily_messages ON family_contacts(
    preferred_contact_time,
    opt_in_daily_updates
) WHERE deleted_at IS NULL AND opt_in_daily_updates = true;

-- Composite index for alert notification queries
-- Query pattern: "Get all opted-in family contacts for client X alerts"
CREATE INDEX IF NOT EXISTS idx_family_contacts_alerts ON family_contacts(
    client_id,
    opt_in_alerts
) WHERE deleted_at IS NULL AND opt_in_alerts = true;

-- ============================================================================
-- TRIGGERS
-- ============================================================================
-- Automatic timestamp management

-- Trigger for family_contacts table (reuses function from 001_create_users_auth.sql)
CREATE TRIGGER update_family_contacts_updated_at
    BEFORE UPDATE ON family_contacts
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- COMMENTS
-- ============================================================================
-- Documentation for database schema

COMMENT ON TABLE family_contacts IS 'Family member contact information for SMS-based family portal';
COMMENT ON COLUMN family_contacts.id IS 'Unique family contact identifier (UUID)';
COMMENT ON COLUMN family_contacts.client_id IS 'Foreign key to clients table (CASCADE delete)';
COMMENT ON COLUMN family_contacts.name IS 'Family member full name';
COMMENT ON COLUMN family_contacts.relationship IS 'Relationship to client (e.g., daughter, son, spouse, friend)';
COMMENT ON COLUMN family_contacts.phone_number IS 'Phone number in E.164 format for Twilio SMS';
COMMENT ON COLUMN family_contacts.preferred_contact_time IS 'Preferred time for daily messages (24-hour format, NULL = system default 6 PM)';
COMMENT ON COLUMN family_contacts.opt_in_daily_updates IS 'Receive daily status messages (default: true)';
COMMENT ON COLUMN family_contacts.opt_in_alerts IS 'Receive urgent care alerts (default: true)';
COMMENT ON COLUMN family_contacts.deleted_at IS 'Soft delete timestamp (NULL = active contact)';

-- ============================================================================
-- HELPER FUNCTIONS
-- ============================================================================
-- Utility functions for family contact management

-- Function to get effective contact time (handles NULL preferred_contact_time)
CREATE OR REPLACE FUNCTION get_effective_contact_time(contact_time TIME)
RETURNS TIME AS $$
BEGIN
    -- Return preferred time if set, otherwise default to 6 PM
    RETURN COALESCE(contact_time, '18:00:00'::TIME);
END;
$$ LANGUAGE plpgsql IMMUTABLE;

COMMENT ON FUNCTION get_effective_contact_time IS 'Returns effective contact time, defaulting to 6 PM if NULL';

-- Function to format phone number for display (removes +1 for North American numbers)
CREATE OR REPLACE FUNCTION format_phone_display(phone VARCHAR)
RETURNS VARCHAR AS $$
BEGIN
    -- Format +14165551234 as (416) 555-1234 for display
    IF phone ~ '^\+1\d{10}$' THEN
        RETURN '(' || substring(phone from 3 for 3) || ') ' || 
               substring(phone from 6 for 3) || '-' || 
               substring(phone from 9 for 4);
    END IF;
    -- Return as-is for international numbers
    RETURN phone;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

COMMENT ON FUNCTION format_phone_display IS 'Formats phone number for human-readable display';
