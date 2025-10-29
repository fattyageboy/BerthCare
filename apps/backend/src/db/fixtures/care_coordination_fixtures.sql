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
--
-- Note: This script uses a PL/pgSQL DO block to automatically capture and reuse
-- generated IDs across all INSERT statements. No manual copy/paste required.
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
--   - phone_number VARCHAR(30) NOT NULL
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

DO $$
DECLARE
    v_zone_id UUID;
    v_caregiver_user_id UUID;
    v_coordinator_user_id UUID;
    v_client_id UUID;
    v_coordinator_id UUID;
BEGIN
    -- ============================================================================
    -- Step 1: Create a test zone
    -- ============================================================================
    INSERT INTO zones (id, name, region)
    VALUES (
        gen_random_uuid(),
        'Test Zone - Care Coordination',
        'Test Region'
    )
    RETURNING id INTO v_zone_id;

    RAISE NOTICE 'Created zone with ID: %', v_zone_id;

    -- ============================================================================
    -- Step 2: Create test users (caregiver and coordinator)
    -- ============================================================================
    INSERT INTO users (
        id,
        email,
        password_hash,
        first_name,
        last_name,
        role,
        zone_id,
        is_active
    )
    VALUES (
        gen_random_uuid(),
        'caregiver.test@example.com',
        '$2b$12$dummyhashfortest',
        'Test',
        'Caregiver',
        'caregiver',
        v_zone_id,
        true
    )
    RETURNING id INTO v_caregiver_user_id;

    RAISE NOTICE 'Created caregiver user with ID: %', v_caregiver_user_id;

    INSERT INTO users (
        id,
        email,
        password_hash,
        first_name,
        last_name,
        role,
        zone_id,
        is_active
    )
    VALUES (
        gen_random_uuid(),
        'coordinator.test@example.com',
        '$2b$12$dummyhashfortest',
        'Test',
        'Coordinator',
        'coordinator',
        v_zone_id,
        true
    )
    RETURNING id INTO v_coordinator_user_id;

    RAISE NOTICE 'Created coordinator user with ID: %', v_coordinator_user_id;

    -- ============================================================================
    -- Step 3: Create a test client
    -- ============================================================================
    INSERT INTO clients (
        id,
        first_name,
        last_name,
        date_of_birth,
        zone_id
    )
    VALUES (
        gen_random_uuid(),
        'Test',
        'Client',
        '1950-01-01',
        v_zone_id
    )
    RETURNING id INTO v_client_id;

    RAISE NOTICE 'Created client with ID: %', v_client_id;

    -- ============================================================================
    -- Step 4: Create a test coordinator record
    -- ============================================================================
    INSERT INTO coordinators (
        id,
        user_id,
        zone_id,
        phone_number,
        is_active
    )
    VALUES (
        gen_random_uuid(),
        v_coordinator_user_id,
        v_zone_id,
        '+15551234567',
        true
    )
    RETURNING id INTO v_coordinator_id;

    RAISE NOTICE 'Created coordinator record with ID: %', v_coordinator_id;

    -- ============================================================================
    -- Step 5: Create test care alerts
    -- ============================================================================

    -- Alert 1: Initiated medical concern
    INSERT INTO care_alerts (
        client_id,
        staff_id,
        coordinator_id,
        alert_type,
        status
    )
    VALUES (
        v_client_id,
        v_caregiver_user_id,
        v_coordinator_user_id,
        'medical_concern',
        'initiated'
    );

    RAISE NOTICE 'Created care alert 1: medical_concern (initiated)';

    -- Alert 2: Resolved medication issue
    INSERT INTO care_alerts (
        client_id,
        staff_id,
        coordinator_id,
        alert_type,
        status,
        outcome,
        initiated_at,
        answered_at,
        resolved_at
    )
    VALUES (
        v_client_id,
        v_caregiver_user_id,
        v_coordinator_user_id,
        'medication_issue',
        'resolved',
        'Medication dosage adjusted per doctor instructions',
        CURRENT_TIMESTAMP - INTERVAL '1 hour',
        CURRENT_TIMESTAMP - INTERVAL '58 minutes',
        CURRENT_TIMESTAMP - INTERVAL '45 minutes'
    );

    RAISE NOTICE 'Created care alert 2: medication_issue (resolved)';

    -- Alert 3: Escalated safety concern
    INSERT INTO care_alerts (
        client_id,
        staff_id,
        coordinator_id,
        alert_type,
        status,
        initiated_at,
        escalated_at
    )
    VALUES (
        v_client_id,
        v_caregiver_user_id,
        v_coordinator_user_id,
        'safety_concern',
        'escalated',
        CURRENT_TIMESTAMP - INTERVAL '30 minutes',
        CURRENT_TIMESTAMP - INTERVAL '25 minutes'
    );

    RAISE NOTICE 'Created care alert 3: safety_concern (escalated)';

    RAISE NOTICE 'All test fixtures created successfully!';
END $$;

-- ============================================================================
-- ALTERNATIVE: Query existing records instead of creating fixtures
-- ============================================================================
-- If you already have data in your database, you can query existing records:

-- Find existing IDs to use for testing
SELECT (
        SELECT id
        FROM zones
        LIMIT 1
    ) AS zone_id,
    (
        SELECT id
        FROM users
        WHERE
            role = 'caregiver'
        LIMIT 1
    ) AS caregiver_id,
    (
        SELECT id
        FROM users
        WHERE
            role = 'coordinator'
        LIMIT 1
    ) AS coordinator_id,
    (
        SELECT id
        FROM clients
        LIMIT 1
    ) AS client_id;

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