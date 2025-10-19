-- Migration: 007_add_zone_coordinates
-- Description: Add geographic center coordinates to zones for proximity assignment
-- Reference: Client Management - Zone Assignment enhancements

-- ============================================================================
-- SCHEMA CHANGES
-- ============================================================================

ALTER TABLE zones
    ADD COLUMN IF NOT EXISTS center_latitude DOUBLE PRECISION,
    ADD COLUMN IF NOT EXISTS center_longitude DOUBLE PRECISION;

ALTER TABLE zones
    ADD CONSTRAINT zones_center_latitude_check
    CHECK (center_latitude IS NULL OR (center_latitude BETWEEN -90 AND 90));

ALTER TABLE zones
    ADD CONSTRAINT zones_center_longitude_check
    CHECK (center_longitude IS NULL OR (center_longitude BETWEEN -180 AND 180));

-- ============================================================================
-- DATA BACKFILL (Seed known MVP zones if present)
-- ============================================================================

UPDATE zones
SET
    center_latitude = 45.5017,
    center_longitude = -73.5673
WHERE id = '00000000-0000-0000-0000-000000000001';

UPDATE zones
SET
    center_latitude = 43.6532,
    center_longitude = -79.3832
WHERE id = '00000000-0000-0000-0000-000000000002';

UPDATE zones
SET
    center_latitude = 49.2827,
    center_longitude = -123.1207
WHERE id = '00000000-0000-0000-0000-000000000003';

-- ============================================================================
-- COMMENTS
-- ============================================================================

COMMENT ON COLUMN zones.center_latitude IS 'Latitude of the zone''s geographic center (used for auto-assignment)';
COMMENT ON COLUMN zones.center_longitude IS 'Longitude of the zone''s geographic center (used for auto-assignment)';

