-- Migration: 004_create_visits
-- Description: Create visits table for visit documentation and tracking
-- Author: Backend Engineer
-- Date: 2025-10-11
-- Reference: Architecture Blueprint - Visit Documentation Endpoints section

-- ============================================================================
-- VISITS TABLE
-- ============================================================================
-- Stores visit records for caregiver check-ins/check-outs with clients
-- Supports offline-first mobile app with GPS verification and smart data reuse

CREATE TABLE IF NOT EXISTS visits (
    -- Primary identifier
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- Relationships
    client_id UUID NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
    staff_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    
    -- Scheduling information
    scheduled_start_time TIMESTAMP WITH TIME ZONE NOT NULL,
    
    -- Check-in tracking (when caregiver arrives)
    check_in_time TIMESTAMP WITH TIME ZONE,
    check_in_latitude DECIMAL(10, 8) CHECK (check_in_latitude BETWEEN -90 AND 90),
    check_in_longitude DECIMAL(11, 8) CHECK (check_in_longitude BETWEEN -180 AND 180),
    
    -- Check-out tracking (when caregiver leaves)
    check_out_time TIMESTAMP WITH TIME ZONE,
    check_out_latitude DECIMAL(10, 8) CHECK (check_out_latitude BETWEEN -90 AND 90),
    check_out_longitude DECIMAL(11, 8) CHECK (check_out_longitude BETWEEN -180 AND 180),
    
    -- Visit status tracking
    status VARCHAR(50) NOT NULL DEFAULT 'scheduled' 
        CHECK (status IN ('scheduled', 'in_progress', 'completed', 'cancelled')),
    
    -- Duration tracking (in minutes)
    duration_minutes INTEGER CHECK (
        duration_minutes >= 0 AND duration_minutes <= 720
    ),
    
    -- Smart data reuse - reference to previous visit for copying documentation
    copied_from_visit_id UUID REFERENCES visits(id) ON DELETE SET NULL,
    
    -- Audit timestamps
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    
    -- Offline sync tracking
    synced_at TIMESTAMP WITH TIME ZONE,
    
    -- Constraints
    CONSTRAINT check_times_logical CHECK (
        check_out_time IS NULL OR 
        check_in_time IS NULL OR 
        check_out_time >= check_in_time
    ),

    -- Disallow check-out without a prior check-in
    CONSTRAINT check_out_requires_check_in CHECK (
        check_out_time IS NULL OR check_in_time IS NOT NULL
    ),
    -- Check-out coordinates require a check-out time
    CONSTRAINT check_out_latitude_requires_times CHECK (
        check_out_latitude IS NULL OR check_out_time IS NOT NULL
    ),
    CONSTRAINT check_out_longitude_requires_times CHECK (
        check_out_longitude IS NULL OR check_out_time IS NOT NULL
    ),
    -- Check-in coordinates require check-in time and must appear as a pair
    CONSTRAINT check_in_coordinates_require_time CHECK (
        (check_in_latitude IS NULL AND check_in_longitude IS NULL)
        OR check_in_time IS NOT NULL
    ),
    CONSTRAINT check_in_coordinates_must_pair CHECK (
        (check_in_latitude IS NULL AND check_in_longitude IS NULL)
        OR (check_in_latitude IS NOT NULL AND check_in_longitude IS NOT NULL)
    ),
    -- Duration can only be stored when both times exist and stays within sane bounds
    CONSTRAINT duration_requires_times CHECK (
        duration_minutes IS NULL OR (
            check_in_time IS NOT NULL
            AND check_out_time IS NOT NULL
        )
    )
);

-- ============================================================================
-- INDEXES
-- ============================================================================
-- Optimized for common query patterns in visit management

-- Fast lookup by client for visit history
-- Most common query: "Get all visits for this client"
CREATE INDEX IF NOT EXISTS idx_visits_client_id ON visits(client_id);

-- Fast lookup by staff member for caregiver's schedule and history
-- Common query: "Get all visits for this caregiver"
CREATE INDEX IF NOT EXISTS idx_visits_staff_id ON visits(staff_id);

-- Fast lookup by scheduled time for daily schedules and route planning
-- Common query: "Get all visits scheduled for today"
CREATE INDEX IF NOT EXISTS idx_visits_scheduled_time ON visits(scheduled_start_time);

-- Fast lookup by status for filtering active/completed visits
-- Common query: "Get all in-progress visits" or "Get completed visits"
CREATE INDEX IF NOT EXISTS idx_visits_status ON visits(status);

-- Composite index for staff + scheduled time (caregiver's daily schedule)
-- Optimizes: "Get today's schedule for this caregiver"
CREATE INDEX IF NOT EXISTS idx_visits_staff_scheduled ON visits(staff_id, scheduled_start_time);

-- Composite index for client + scheduled time (client's visit history)
-- Optimizes: "Get recent visits for this client"
CREATE INDEX IF NOT EXISTS idx_visits_client_scheduled ON visits(client_id, scheduled_start_time DESC);

-- Index for finding unsynced visits (offline-first support)
-- Optimizes: "Find all visits that need to be synced"
CREATE INDEX IF NOT EXISTS idx_visits_unsynced ON visits(synced_at) 
    WHERE synced_at IS NULL;

-- Composite index for status + scheduled time (operational queries)
-- Optimizes: "Get all scheduled visits for today" or "Get completed visits this week"
CREATE INDEX IF NOT EXISTS idx_visits_status_scheduled ON visits(status, scheduled_start_time);

-- ============================================================================
-- TRIGGERS
-- ============================================================================
-- Automatic timestamp management for updated_at column

-- Trigger for visits table (reuses function from 001_create_users_auth.sql)
CREATE TRIGGER update_visits_updated_at
    BEFORE UPDATE ON visits
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- COMMENTS
-- ============================================================================
-- Documentation for database schema

COMMENT ON TABLE visits IS 'Visit records for caregiver check-ins/check-outs with clients';

COMMENT ON COLUMN visits.id IS 'Unique visit identifier (UUID)';
COMMENT ON COLUMN visits.client_id IS 'Reference to client being visited';
COMMENT ON COLUMN visits.staff_id IS 'Reference to caregiver performing the visit';
COMMENT ON COLUMN visits.scheduled_start_time IS 'Scheduled start time for the visit';
COMMENT ON COLUMN visits.check_in_time IS 'Actual time caregiver checked in (arrived)';
COMMENT ON COLUMN visits.check_in_latitude IS 'GPS latitude at check-in for location verification';
COMMENT ON COLUMN visits.check_in_longitude IS 'GPS longitude at check-in for location verification';
COMMENT ON COLUMN visits.check_out_time IS 'Actual time caregiver checked out (left)';
COMMENT ON COLUMN visits.check_out_latitude IS 'GPS latitude at check-out for location verification';
COMMENT ON COLUMN visits.check_out_longitude IS 'GPS longitude at check-out for location verification';
COMMENT ON COLUMN visits.status IS 'Visit status: scheduled, in_progress, completed, or cancelled';
COMMENT ON COLUMN visits.duration_minutes IS 'Recorded visit duration in minutes when both check-in and check-out times are present';
COMMENT ON COLUMN visits.copied_from_visit_id IS 'Reference to previous visit for smart data reuse';
COMMENT ON COLUMN visits.synced_at IS 'Timestamp when visit was last synced to server (offline-first support)';
COMMENT ON COLUMN visits.created_at IS 'Timestamp when visit record was created';
COMMENT ON COLUMN visits.updated_at IS 'Timestamp when visit record was last updated';
