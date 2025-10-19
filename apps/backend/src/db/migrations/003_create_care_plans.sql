-- Migration: 003_create_care_plans
-- Description: Create care_plans table for client care plan management
-- Author: Backend Engineer
-- Date: 2025-10-10
--
-- Task C2: Design database schema – care plans
-- Create migration for care_plans table (id, client_id, summary, medications JSONB,
-- allergies JSONB, special_instructions TEXT, version, created_at, updated_at);
-- add foreign key to clients; add index on client_id.
--
-- Reference: project-documentation/task-plan.md - Phase C – Client Management API
-- Reference: Architecture Blueprint - GET /v1/clients/:clientId, care plan section

-- ============================================================================
-- CARE PLANS TABLE
-- ============================================================================
-- Stores care plan information for clients including medications, allergies,
-- and special care instructions. Supports versioning for audit trail.

CREATE TABLE IF NOT EXISTS care_plans (
    -- Primary identifier
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

-- Client association
-- Foreign key to clients table with CASCADE delete
-- When a client is deleted, their care plan is also deleted
client_id UUID NOT NULL REFERENCES clients (id) ON DELETE CASCADE,

-- Care plan content
-- Summary provides high-level overview of care needs
summary TEXT NOT NULL,

-- Medications stored as JSONB for flexible structure
-- Format: [{"name": "Aspirin", "dosage": "81mg", "frequency": "Daily"}]
-- JSONB allows efficient querying and indexing of medication data
medications JSONB NOT NULL DEFAULT '[]'::jsonb,

-- Allergies stored as JSONB array
-- Format: ["Penicillin", "Latex", "Shellfish"]
-- JSONB allows efficient searching and validation
allergies JSONB NOT NULL DEFAULT '[]'::jsonb,

-- Special instructions for caregivers
-- Free-form text for detailed care instructions
special_instructions TEXT,

-- Version tracking for audit trail
-- Incremented on each update to track care plan changes
-- Enables conflict detection and change history
version INTEGER NOT NULL DEFAULT 1,

-- Audit timestamps
created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,

-- Soft delete support
deleted_at TIMESTAMP WITH TIME ZONE,

-- Constraints
-- Ensure version is always positive
CONSTRAINT care_plans_version_positive CHECK (version > 0) );

-- ============================================================================
-- INDEXES
-- ============================================================================
-- Optimized for common query patterns in care plan management

-- Unique index to ensure each client has only one active care plan
-- Partial unique index excludes soft-deleted records
-- This index also serves for fast lookup by client_id (no need for separate non-unique index)
CREATE UNIQUE INDEX IF NOT EXISTS idx_care_plans_client_unique ON care_plans (client_id)
WHERE
    deleted_at IS NULL;

-- Support for medication searches
-- Query pattern: "Find all clients taking medication X"
-- GIN index enables efficient JSONB queries
CREATE INDEX IF NOT EXISTS idx_care_plans_medications ON care_plans USING GIN (medications)
WHERE
    deleted_at IS NULL;

-- Support for allergy searches
-- Query pattern: "Find all clients with allergy X"
-- GIN index enables efficient JSONB array queries
CREATE INDEX IF NOT EXISTS idx_care_plans_allergies ON care_plans USING GIN (allergies)
WHERE
    deleted_at IS NULL;

-- Version tracking for conflict detection
-- Query pattern: "Check if care plan has been updated since last read"
CREATE INDEX IF NOT EXISTS idx_care_plans_version ON care_plans (client_id, version)
WHERE
    deleted_at IS NULL;

-- ============================================================================
-- TRIGGERS
-- ============================================================================
-- Automatic timestamp and version management

-- Trigger for care_plans table (reuses function from 001_create_users_auth.sql)
CREATE TRIGGER update_care_plans_updated_at
    BEFORE UPDATE ON care_plans
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Function to auto-increment version on updates
CREATE OR REPLACE FUNCTION increment_care_plan_version()
RETURNS TRIGGER AS $$
BEGIN
    -- Only increment version if content changed (not just timestamps)
    IF (NEW.summary IS DISTINCT FROM OLD.summary OR
        NEW.medications IS DISTINCT FROM OLD.medications OR
        NEW.allergies IS DISTINCT FROM OLD.allergies OR
        NEW.special_instructions IS DISTINCT FROM OLD.special_instructions) THEN
        NEW.version = OLD.version + 1;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-increment version on care plan updates
CREATE TRIGGER increment_care_plan_version_trigger
    BEFORE UPDATE ON care_plans
    FOR EACH ROW
    EXECUTE FUNCTION increment_care_plan_version();

-- ============================================================================
-- COMMENTS
-- ============================================================================
-- Documentation for database schema

COMMENT ON
TABLE care_plans IS 'Care plan information for clients including medications, allergies, and special instructions';

COMMENT ON COLUMN care_plans.id IS 'Unique care plan identifier (UUID)';

COMMENT ON COLUMN care_plans.client_id IS 'Foreign key to clients table (CASCADE delete)';

COMMENT ON COLUMN care_plans.summary IS 'High-level overview of care needs';

COMMENT ON COLUMN care_plans.medications IS 'JSONB array of medication objects with name, dosage, frequency';

COMMENT ON COLUMN care_plans.allergies IS 'JSONB array of allergy strings';

COMMENT ON COLUMN care_plans.special_instructions IS 'Detailed care instructions for caregivers';

COMMENT ON COLUMN care_plans.version IS 'Version number for change tracking and conflict detection';

COMMENT ON COLUMN care_plans.deleted_at IS 'Soft delete timestamp (NULL = active care plan)';

-- ============================================================================
-- VALIDATION FUNCTIONS
-- ============================================================================
-- Helper functions for JSONB validation (can be used in application layer)

-- Function to validate medication structure
CREATE OR REPLACE FUNCTION validate_medication_structure(medications JSONB)
RETURNS BOOLEAN AS $$
DECLARE
    med JSONB;
BEGIN
    -- Check if medications is an array
    IF jsonb_typeof(medications) != 'array' THEN
        RETURN FALSE;
    END IF;
    
    -- Validate each medication object
    FOR med IN SELECT * FROM jsonb_array_elements(medications)
    LOOP
        -- Each medication must have name, dosage, and frequency
        IF NOT (med ? 'name' AND med ? 'dosage' AND med ? 'frequency') THEN
            RETURN FALSE;
        END IF;
        
        -- Each field must be a string
        IF (jsonb_typeof(med->'name') != 'string' OR
            jsonb_typeof(med->'dosage') != 'string' OR
            jsonb_typeof(med->'frequency') != 'string') THEN
            RETURN FALSE;
        END IF;
    END LOOP;
    
    RETURN TRUE;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Function to validate allergies structure
CREATE OR REPLACE FUNCTION validate_allergies_structure(allergies JSONB)
RETURNS BOOLEAN AS $$
DECLARE
    allergy JSONB;
BEGIN
    -- Check if allergies is an array
    IF jsonb_typeof(allergies) != 'array' THEN
        RETURN FALSE;
    END IF;
    
    -- Validate each allergy is a string
    FOR allergy IN SELECT * FROM jsonb_array_elements(allergies)
    LOOP
        IF jsonb_typeof(allergy) != 'string' THEN
            RETURN FALSE;
        END IF;
    END LOOP;
    
    RETURN TRUE;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

COMMENT ON FUNCTION validate_medication_structure IS 'Validates that medications JSONB has correct structure';

COMMENT ON FUNCTION validate_allergies_structure IS 'Validates that allergies JSONB is an array of strings';

ALTER TABLE care_plans
    ADD CONSTRAINT care_plans_medications_valid
    CHECK (validate_medication_structure(medications));

ALTER TABLE care_plans
    ADD CONSTRAINT care_plans_allergies_valid
    CHECK (validate_allergies_structure(allergies));
