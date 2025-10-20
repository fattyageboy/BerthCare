-- Rollback: 000_create_zones

BEGIN;

DROP TRIGGER IF EXISTS update_zones_updated_at ON zones;
DROP TABLE IF EXISTS zones;

COMMIT;
