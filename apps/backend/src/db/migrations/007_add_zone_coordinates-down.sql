-- Rollback Migration: 007_add_zone_coordinates
-- Description: Remove geographic center coordinates from zones

ALTER TABLE zones
    DROP CONSTRAINT IF EXISTS zones_center_latitude_check;

ALTER TABLE zones
    DROP CONSTRAINT IF EXISTS zones_center_longitude_check;

ALTER TABLE zones
    DROP COLUMN IF EXISTS center_latitude;

ALTER TABLE zones
    DROP COLUMN IF EXISTS center_longitude;

