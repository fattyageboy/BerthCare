-- Migration: 008_create_care_alerts
-- Description: Create care_alerts table for voice alert and care coordination system
-- Author: Backend Engineer
-- Date: 2025-10-20
-- Reference: Architecture Blueprint - Voice Alert Service section

-- Stores voice alerts from caregivers to coordinators for urgent care issues
-- Supports voice-first communication, escalation, and outcome tracking

-- Enumerated types keep business states explicit and prevent invalid values
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'care_alert_type') THEN
        CREATE TYPE care_alert_type AS ENUM (
            'medical_concern',
            'medication_issue',
            'behavioral_change',
            'safety_concern',
            'family_request',
            'equipment_issue',
            'other'
        );
    END IF;
END$$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'care_alert_status') THEN
        CREATE TYPE care_alert_status AS ENUM (
            'initiated',
            'ringing',
            'answered',
            'no_answer',
            'escalated',
            'resolved',
            'cancelled'
        );
    END IF;
END$$;

CREATE TABLE IF NOT EXISTS care_alerts (
    -- Primary identifier
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- Relationships
    client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    staff_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    coordinator_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    
    -- Alert details
    alert_type care_alert_type NOT NULL,
    
    -- Voice message storage
    voice_message_url TEXT,
    
    -- Alert status tracking
    status care_alert_status NOT NULL DEFAULT 'initiated',
    
    -- Timestamp tracking for SLA monitoring
    initiated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    answered_at TIMESTAMP WITH TIME ZONE,
    escalated_at TIMESTAMP WITH TIME ZONE,
    resolved_at TIMESTAMP WITH TIME ZONE,
    
    -- Outcome documentation
    outcome TEXT,
    
    -- Audit timestamps
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    
    -- Soft delete support
    deleted_at TIMESTAMP WITH TIME ZONE,
    
    -- Constraints
    CONSTRAINT check_answered_after_initiated CHECK (answered_at IS NULL OR answered_at >= initiated_at),
    CONSTRAINT check_escalated_after_initiated CHECK (escalated_at IS NULL OR escalated_at >= initiated_at),
    CONSTRAINT check_resolved_after_initiated CHECK (resolved_at IS NULL OR resolved_at >= initiated_at)
);

-- ============================================================================
-- INDEXES
-- ============================================================================
-- Optimized for alert monitoring, SLA tracking, and coordinator dashboards

-- Fast lookup by coordinator for active alerts
-- Most common query: "Get all active alerts for coordinator X"
CREATE INDEX IF NOT EXISTS idx_care_alerts_coordinator_status 
    ON care_alerts (coordinator_id, status)
    WHERE deleted_at IS NULL;

-- Fast lookup by client for alert history
-- Common query: "Get all alerts for client X"
CREATE INDEX IF NOT EXISTS idx_care_alerts_client_id 
    ON care_alerts (client_id)
    WHERE deleted_at IS NULL;

-- Fast lookup by staff for caregiver alert history
-- Common query: "Get all alerts created by staff member X"
CREATE INDEX IF NOT EXISTS idx_care_alerts_staff_id 
    ON care_alerts (staff_id)
    WHERE deleted_at IS NULL;

-- SLA monitoring: alerts by status and initiated time
-- Supports: "Find alerts that haven't been answered in 5 minutes"
CREATE INDEX IF NOT EXISTS idx_care_alerts_status_initiated 
    ON care_alerts (status, initiated_at DESC)
    WHERE deleted_at IS NULL;

-- Alert type analytics
-- Supports: "What types of alerts are most common?"
CREATE INDEX IF NOT EXISTS idx_care_alerts_type_initiated 
    ON care_alerts (alert_type, initiated_at DESC)
    WHERE deleted_at IS NULL;

-- Composite index for coordinator dashboard
-- Optimizes: "Get recent alerts for coordinator X by status"
CREATE INDEX IF NOT EXISTS idx_care_alerts_coordinator_initiated 
    ON care_alerts (coordinator_id, initiated_at DESC)
    WHERE deleted_at IS NULL;

-- ============================================================================
-- TRIGGERS
-- ============================================================================
-- Automatic timestamp management

CREATE TRIGGER update_care_alerts_updated_at
    BEFORE UPDATE ON care_alerts
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- COMMENTS
-- ============================================================================
-- Documentation for database schema

COMMENT ON TABLE care_alerts IS 'Voice alerts from caregivers to coordinators for urgent care issues';

COMMENT ON COLUMN care_alerts.id IS 'Unique alert identifier (UUID)';
COMMENT ON COLUMN care_alerts.client_id IS 'Client this alert is about';
COMMENT ON COLUMN care_alerts.staff_id IS 'Caregiver who initiated the alert';
COMMENT ON COLUMN care_alerts.coordinator_id IS 'Coordinator who received the alert';
COMMENT ON COLUMN care_alerts.alert_type IS 'Category of alert for analytics and routing';
COMMENT ON COLUMN care_alerts.voice_message_url IS 'S3 URL to recorded voice message from caregiver';
COMMENT ON COLUMN care_alerts.status IS 'Current status of alert for tracking and SLA monitoring';
COMMENT ON COLUMN care_alerts.initiated_at IS 'When caregiver sent the alert';
COMMENT ON COLUMN care_alerts.answered_at IS 'When coordinator answered the call';
COMMENT ON COLUMN care_alerts.escalated_at IS 'When alert was escalated to backup coordinator';
COMMENT ON COLUMN care_alerts.resolved_at IS 'When alert was marked as resolved';
COMMENT ON COLUMN care_alerts.outcome IS 'Free-text description of how alert was resolved';
COMMENT ON COLUMN care_alerts.deleted_at IS 'Soft delete timestamp (NULL = active alert)';
