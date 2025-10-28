-- ============================================================================
-- Care Coordination Test Fixtures
-- ============================================================================
-- Description: Test data for care_alerts and coordinators tables
-- Usage: Run after applying migrations 008 and 009
-- Dependencies: Requires migrations 001-009 to be applied
--
-- Instructions:
-- 1. Apply all migrations first (001-009)
-- 2. Run this fixture file: psql -U postgres -d berthcare -f care_coordination_fixtures.sql
-- 3. Save the returned IDs from RETURNING clauses for use in subsequent INSERTs
-- 4. Replace <zone_id>, <caregiver_user_id>, etc. with actual returned values
--
-- Note: This file demonstrates the fixture creation process. In practice,
-- you may want to use a transaction and variables to capture RETURNING values.
-- ============================================================================

-- ============================================================================
-- PREREQUISITE SCHEMA REFERENCE
-- ============================================================================
-- This fixture depends on the following tables and columns:
--
-- zones (from migration 002):
--   - id UUID PRIMARY KEY
--   - name VARCHAR(100) NOT NULL
--   - region VARCHAR(100) NOT NULL
--
-- users (from migration 001):
--   - id UUID PRIMARY KEY
--   - email VARCHAR(255) NOT NULL UNIQUE
--   - password_hash VARCHAR(255) NOT NULL
--   - first_name VARCHAR(100) NOT NULL
--   - last_name VARCHAR(100) NOT NULL
--   - role VARCHAR(20) NOT NULL (caregiver, coordinator, admin)
--   - zone_id UUID (references zones)
--   - is_active BOOLEAN NOT NULL DEFAULT true
--
-- clients (from migration 002):
--   - id UUID PRIMARY KEY
--   - first_name VARCHAR(100) NOT NULL
--   - last_name VARCHAR(100) NOT NULL
--   - date_of_birth DATE NOT NULL
--   - zone_id UUID NOT NULL (references zones)
--
-- coordinators (from migration 009):
--   - id UUID PRIMARY KEY
--   - user_id UUID NOT NULL UNIQUE (references users)
--   - zone_id UUID NOT NULL (references zones)
--   - phone_number VARCHAR(20) NOT NULL
--   - is_active BOOLEAN NOT NULL DEFAULT true
--
-- care_alerts (from migration 008):
--   - id UUID PRIMARY KEY
--   - client_id UUID NOT NULL (references clients)
--   - staff_id UUID NOT NULL (references users)
--   - coordinator_id UUID NOT NULL (references users)
--   - alert_type care_alert_type NOT NULL
--   - status care_alert_status NOT NULL DEFAULT 'initiated'
-- ============================================================================

BEGIN;

-- ============================================================================
-- Step 1: Create a test zone
-- ============================================================================

INSERT INTO zones (id, name, region)
VALUES (gen_random_uuid(), 'Test Zone - Care Coordination', 'Test Region')
RETURNING id AS zone_id;

-- IMPORTANT: Save the returned zone_id from above
-- Example: zone_id = '12345678-1234-1234-1234-123456789012'
-- Replace '<zone_id>' below with this value

-- ============================================================================
-- Step 2: Create test users (caregiver and coordinator)
-- ============================================================================

INSERT INTO users (id, email, password_hash, first_name, last_name, role, zone_id, is_active)
VALUES
  (gen_random_uuid(), 'caregiver.test@example.com', '$2b$12$dummyhashfortest', 'Test', 'Caregiver', 'caregiver', '<zone_id>', true),
  (gen_random_uuid(), 'coordinator.test@example.com', '$2b$12$dummyhashfortest', 'Test', 'Coordinator', 'coordinator', '<zone_id>', true)
RETURNING id, role, email;

-- IMPORTANT: Save the returned user IDs from above
-- Example: caregiver_user_id = '23456789-2345-2345-2345-234567890123'
--          coordinator_user_id = '34567890-3456-3456-3456-345678901234'
-- Replace '<caregiver_user_id>' and '<coordinator_user_id>' below with these values

-- ============================================================================
-- Step 3: Create a test client
-- ============================================================================

INSERT INTO clients (id, first_name, last_name, date_of_birth, zone_id)
VALUES (gen_random_uuid(), 'Test', 'Client', '1950-01-01', '<zone_id>')
RETURNING id AS client_id;

-- IMPORTANT: Save the returned client_id from above
-- Example: client_id = '45678901-4567-4567-4567-456789012345'
-- Replace '<client_id>' below with this value

-- ============================================================================
-- Step 4: Create a test coordinator record
-- ============================================================================

INSERT INTO coordinators (id, user_id, zone_id, phone_number, is_active)
VALUES (gen_random_uuid(), '<coordinator_user_id>', '<zone_id>', '+15551234567', true)
RETURNING id AS coordinator_id;

-- IMPORTANT: Save the returned coordinator_id from above
-- Example: coordinator_id = '56789012-5678-5678-5678-567890123456'

-- ============================================================================
-- Step 5: Create test care alerts
-- ============================================================================

-- Alert 1: Initiated medical concern
INSERT INTO care_alerts (
  client_id, staff_id, coordinator_id,
  alert_type, status
) VALUES (
  '<client_id>',
  '<caregiver_user_id>',
  '<coordinator_user_id>',
  'medical_concern',
  'initiated'
)
RETURNING id, alert_type, status, initiated_at;

-- Alert 2: Resolved medication issue
INSERT INTO care_alerts (
  client_id, staff_id, coordinator_id,
  alert_type, status, outcome,
  initiated_at, answered_at, resolved_at
) VALUES (
  '<client_id>',
  '<caregiver_user_id>',
  '<coordinator_user_id>',
  'medication_issue',
  'resolved',
  'Medication dosage adjusted per doctor instructions',
  CURRENT_TIMESTAMP - INTERVAL '1 hour',
  CURRENT_TIMESTAMP - INTERVAL '58 minutes',
  CURRENT_TIMESTAMP - INTERVAL '45 minutes'
)
RETURNING id, alert_type, status, outcome;

-- Alert 3: Escalated safety concern
INSERT INTO care_alerts (
  client_id, staff_id, coordinator_id,
  alert_type, status,
  initiated_at, escalated_at
) VALUES (
  '<client_id>',
  '<caregiver_user_id>',
  '<coordinator_user_id>',
  'safety_concern',
  'escalated',
  CURRENT_TIMESTAMP - INTERVAL '30 minutes',
  CURRENT_TIMESTAMP - INTERVAL '25 minutes'
)
RETURNING id, alert_type, status, escalated_at;

COMMIT;

-- ============================================================================
-- ALTERNATIVE: Query existing records instead of creating fixtures
-- ============================================================================
-- If you already have data in your database, you can query existing records:

-- Find existing IDs to use for testing
SELECT
  (SELECT id FROM zones LIMIT 1) AS zone_id,
  (SELECT id FROM users WHERE role = 'caregiver' LIMIT 1) AS caregiver_id,
  (SELECT id FROM users WHERE role = 'coordinator' LIMIT 1) AS coordinator_id,
  (SELECT id FROM clients LIMIT 1) AS client_id;

-- Use the IDs from the query above in your INSERT statements

-- ============================================================================
-- CLEANUP (Optional)
-- ============================================================================
-- To remove test fixtures, run:
--
-- DELETE FROM care_alerts WHERE client_id IN (
--   SELECT id FROM clients WHERE first_name = 'Test' AND last_name = 'Client'
-- );
-- DELETE FROM coordinators WHERE user_id IN (
--   SELECT id FROM users WHERE email LIKE '%.test@example.com'
-- );
-- DELETE FROM clients WHERE first_name = 'Test' AND last_name = 'Client';
-- DELETE FROM users WHERE email LIKE '%.test@example.com';
-- DELETE FROM zones WHERE name = 'Test Zone - Care Coordination';
-- ============================================================================
