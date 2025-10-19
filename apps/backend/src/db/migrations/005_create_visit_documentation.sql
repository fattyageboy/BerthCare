-- Migration: 005_create_visit_documentation
-- Description: Create visit_documentation table for storing visit details
-- Author: Backend Engineer
-- Date: 2025-10-11
-- Reference: Architecture Blueprint - Visit Documentation Endpoints section

-- ============================================================================
-- VISIT_DOCUMENTATION TABLE
-- ============================================================================
-- Stores detailed documentation for each visit including vital signs,
-- activities performed, observations, and concerns
-- Supports smart data reuse by copying from previous visits

CREATE TABLE IF NOT EXISTS visit_documentation (
    -- Primary identifier
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- Relationship to visit (one-to-one: each visit has exactly one documentation)
    visit_id UUID NOT NULL UNIQUE REFERENCES visits(id) ON DELETE CASCADE,
    
    -- Vital signs data (structured JSON)
    -- Example: {"blood_pressure": "120/80", "heart_rate": 72, "temperature": 98.6}
    vital_signs JSONB,
    
    -- Activities performed during visit (structured JSON)
    -- Example: [{"activity": "Medication administered", "completed": true, "time": "10:30"}]
    activities JSONB,
    
    -- Free-form observations about the visit
    observations TEXT,
    
    -- Any concerns noted during the visit
    concerns TEXT,
    
    -- Digital signature URL (full URL to image stored in S3 or served via CDN)
    -- Uses TEXT type to accommodate pre-signed S3 URLs which can exceed 1000 characters
    -- with query parameters (X-Amz-Algorithm, X-Amz-Credential, X-Amz-Signature, etc.)
    signature_url TEXT,
    
    -- Audit timestamps
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================================
-- INDEXES
-- ============================================================================
-- Optimized for common query patterns in visit documentation

-- Note: visit_id has a UNIQUE constraint which automatically creates an index,
-- so no separate index is needed for visit_id lookups

-- GIN index for JSONB vital_signs queries
-- Query pattern: "Find visits where blood_pressure was recorded" or "Search by specific vital sign"
CREATE INDEX IF NOT EXISTS idx_visit_documentation_vital_signs ON visit_documentation USING GIN (vital_signs);

-- GIN index for JSONB activities queries
-- Query pattern: "Find visits where specific activity was performed"
CREATE INDEX IF NOT EXISTS idx_visit_documentation_activities ON visit_documentation USING GIN (activities);

-- ============================================================================
-- TRIGGERS
-- ============================================================================
-- Automatic timestamp management for updated_at column

-- Reuses or creates the shared update_updated_at_column helper (introduced in 001_create_users_auth.sql) via CREATE OR REPLACE to ensure it exists for idempotent reuse
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for visit_documentation table (uses the idempotently defined shared update function above)
CREATE TRIGGER update_visit_documentation_updated_at
    BEFORE UPDATE ON visit_documentation
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- COMMENTS
-- ============================================================================
-- Documentation for database schema

COMMENT ON TABLE visit_documentation IS 'Detailed documentation for each visit including vital signs, activities, and observations';

COMMENT ON COLUMN visit_documentation.id IS 'Unique documentation identifier (UUID)';
COMMENT ON COLUMN visit_documentation.visit_id IS 'Reference to the visit this documentation belongs to';
COMMENT ON COLUMN visit_documentation.vital_signs IS 'Structured vital signs data (JSONB): blood pressure, heart rate, temperature, etc.';
COMMENT ON COLUMN visit_documentation.activities IS 'Structured list of activities performed during visit (JSONB)';
COMMENT ON COLUMN visit_documentation.observations IS 'Free-form text observations about the visit';
COMMENT ON COLUMN visit_documentation.concerns IS 'Any concerns or issues noted during the visit';
COMMENT ON COLUMN visit_documentation.signature_url IS 'URL to digital signature image stored in S3';
COMMENT ON COLUMN visit_documentation.created_at IS 'Timestamp when documentation was created';
COMMENT ON COLUMN visit_documentation.updated_at IS 'Timestamp when documentation was last updated';
