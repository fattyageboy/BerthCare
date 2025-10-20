-- Migration: 000_create_zones
-- Description: Establish core service zones used for geographic routing
-- Author: Backend Engineering
-- Philosophy: A single, obvious source of truth for where we operate

BEGIN;

-- Ensure timestamp update helper exists (shared with later migrations)
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Core zones table
CREATE TABLE IF NOT EXISTS zones (
    id UUID PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    description TEXT,
    center_latitude NUMERIC(10, 7) NOT NULL CHECK (center_latitude BETWEEN -90 AND 90),
    center_longitude NUMERIC(10, 7) NOT NULL CHECK (center_longitude BETWEEN -180 AND 180),
    radius_km NUMERIC(6, 2),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Indexes to keep lookups fast
CREATE INDEX IF NOT EXISTS idx_zones_slug ON zones (slug);
CREATE INDEX IF NOT EXISTS idx_zones_active ON zones (is_active);

-- Trigger for automatic updated_at management
CREATE TRIGGER update_zones_updated_at
    BEFORE UPDATE ON zones
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Seed canonical service zones (safe if re-run)
INSERT INTO zones (id, name, slug, description, center_latitude, center_longitude, radius_km, metadata)
VALUES
    ('550e8400-e29b-41d4-a716-446655440001', 'North Zone', 'north', 'Greater Montreal region', 45.5017, -73.5673, 25, '{}'::jsonb),
    ('550e8400-e29b-41d4-a716-446655440002', 'South Zone', 'south', 'Greater Toronto Area', 43.6532, -79.3832, 35, '{}'::jsonb),
    ('550e8400-e29b-41d4-a716-446655440003', 'East Zone', 'east', 'Ottawa & Eastern Ontario', 45.4215, -75.6972, 40, '{}'::jsonb),
    ('550e8400-e29b-41d4-a716-446655440004', 'West Zone', 'west', 'Metro Vancouver region', 49.2827, -123.1207, 30, '{}'::jsonb)
ON CONFLICT (id) DO NOTHING;

COMMENT ON TABLE zones IS 'Service zones used for caregiver routing and data partitioning';
COMMENT ON COLUMN zones.slug IS 'Human-friendly zone identifier used in URLs and dashboards';

COMMIT;
