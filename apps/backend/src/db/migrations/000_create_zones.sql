-- Migration: 000_create_zones
-- Description: Create zones table for geographic/organizational data isolation
-- Author: Backend Engineer
-- Date: 2025-10-12
-- Reference: Architecture Blueprint - Data Isolation section

-- ============================================================================
-- ZONES TABLE
-- ============================================================================
-- Stores geographic or organizational zones for data isolation
-- Users, clients, and visits are assigned to zones for access control

CREATE TABLE IF NOT EXISTS zones (
    -- Primary identifier
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- Zone information
    name VARCHAR(100) NOT NULL,
    region VARCHAR(100) NOT NULL,
    
    -- Audit timestamps
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    
    -- Soft delete support
    deleted_at TIMESTAMP WITH TIME ZONE
);

-- ============================================================================
-- INDEXES
-- ============================================================================

-- Fast lookup by name
CREATE INDEX IF NOT EXISTS idx_zones_name ON zones(name) WHERE deleted_at IS NULL;

-- Fast lookup by region
CREATE INDEX IF NOT EXISTS idx_zones_region ON zones(region) WHERE deleted_at IS NULL;

-- ============================================================================
-- TRIGGERS
-- ============================================================================

-- Ensure the timestamp update helper function exists before creating triggers
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_proc p
        INNER JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE p.proname = 'update_updated_at_column'
          AND n.nspname = 'public'
          AND p.pronargs = 0
    ) THEN
        EXECUTE $function$
            CREATE FUNCTION public.update_updated_at_column()
            RETURNS TRIGGER
            LANGUAGE plpgsql
            AS $body$
            BEGIN
                NEW.updated_at = CURRENT_TIMESTAMP;
                RETURN NEW;
            END;
            $body$;
        $function$;
    END IF;
END;
$$;

-- Trigger for zones table
CREATE TRIGGER update_zones_updated_at
    BEFORE UPDATE ON zones
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- COMMENTS
-- ============================================================================

COMMENT ON TABLE zones IS 'Geographic or organizational zones for data isolation';
COMMENT ON COLUMN zones.id IS 'Unique zone identifier (UUID)';
COMMENT ON COLUMN zones.name IS 'Zone name';
COMMENT ON COLUMN zones.region IS 'Geographic region';
COMMENT ON COLUMN zones.deleted_at IS 'Soft delete timestamp (NULL = not deleted)';
