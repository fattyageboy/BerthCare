-- Migration: 009_create_coordinators
-- Description: Create coordinators table for care coordination and alert routing
-- Author: Backend Engineer
-- Date: 2025-10-20
-- Reference: Architecture Blueprint - Voice Alert Service section

-- ============================================================================
-- COORDINATORS TABLE
-- ============================================================================
-- Stores coordinator information for voice alert routing and escalation
-- Supports zone-based assignment and backup coordinator failover

CREATE TABLE IF NOT EXISTS coordinators (
    -- Primary identifier
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- Relationships
    user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    zone_id UUID NOT NULL REFERENCES zones(id) ON DELETE CASCADE,
    
    -- Contact information for voice alerts
    phone_number VARCHAR(20) NOT NULL,
    
    -- Backup coordinator for escalation
    backup_coordinator_id UUID REFERENCES coordinators(id) ON DELETE SET NULL,
    
    -- Availability tracking
    is_active BOOLEAN NOT NULL DEFAULT true,
    
    -- Audit timestamps
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    
    -- Soft delete support
    deleted_at TIMESTAMP WITH TIME ZONE,
    
    -- Constraints
    CONSTRAINT check_not_own_backup CHECK (id != backup_coordinator_id)
);

-- ============================================================================
-- INDEXES
-- ============================================================================
-- Optimized for alert routing and coordinator lookup

-- Fast lookup by zone for alert routing
-- Most common query: "Find active coordinator for zone X"
CREATE INDEX IF NOT EXISTS idx_coordinators_zone_active 
    ON coordinators (zone_id, is_active)
    WHERE deleted_at IS NULL;

-- Fast lookup by user_id for coordinator profile
-- Common query: "Get coordinator details for user X"
CREATE INDEX IF NOT EXISTS idx_coordinators_user_id 
    ON coordinators (user_id)
    WHERE deleted_at IS NULL;

-- Fast lookup of backup coordinators
-- Supports: "Get backup coordinator for escalation"
CREATE INDEX IF NOT EXISTS idx_coordinators_backup 
    ON coordinators (backup_coordinator_id)
    WHERE deleted_at IS NULL AND backup_coordinator_id IS NOT NULL;

-- Active coordinators for dashboard
-- Supports: "List all active coordinators"
CREATE INDEX IF NOT EXISTS idx_coordinators_active 
    ON coordinators (is_active)
    WHERE deleted_at IS NULL;

-- ============================================================================
-- TRIGGERS
-- ============================================================================
-- Automatic timestamp management

CREATE TRIGGER update_coordinators_updated_at
    BEFORE UPDATE ON coordinators
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- COMMENTS
-- ============================================================================
-- Documentation for database schema

COMMENT ON TABLE coordinators IS 'Care coordinators who receive voice alerts from caregivers';

COMMENT ON COLUMN coordinators.id IS 'Unique coordinator identifier (UUID)';
COMMENT ON COLUMN coordinators.user_id IS 'Reference to user account (one-to-one relationship)';
COMMENT ON COLUMN coordinators.zone_id IS 'Zone this coordinator is responsible for';
COMMENT ON COLUMN coordinators.phone_number IS 'Phone number for receiving voice alerts via Twilio';
COMMENT ON COLUMN coordinators.backup_coordinator_id IS 'Backup coordinator for escalation if primary does not answer';
COMMENT ON COLUMN coordinators.is_active IS 'Whether coordinator is currently available for alerts';
COMMENT ON COLUMN coordinators.deleted_at IS 'Soft delete timestamp (NULL = active coordinator)';
