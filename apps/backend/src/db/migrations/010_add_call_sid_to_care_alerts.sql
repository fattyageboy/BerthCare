-- Migration: 010_add_call_sid_to_care_alerts
-- Description: Add call_sid column to care_alerts for proper webhook correlation
-- Author: Backend Engineer
-- Date: 2025-10-23
-- Reference: Fix race condition in webhook handler

-- ============================================================================
-- ADD CALL_SID COLUMN
-- ============================================================================
-- Stores Twilio CallSid to correlate webhook updates with the correct alert
-- Prevents race conditions when multiple alerts are active simultaneously

ALTER TABLE care_alerts
ADD COLUMN call_sid VARCHAR(34);

-- ============================================================================
-- CREATE INDEX
-- ============================================================================
-- Fast lookup by call_sid for webhook processing
-- Twilio CallSid format: CA + 32 hex characters = 34 characters total

CREATE INDEX IF NOT EXISTS idx_care_alerts_call_sid
    ON care_alerts (call_sid)
    WHERE call_sid IS NOT NULL AND deleted_at IS NULL;

-- ============================================================================
-- COMMENTS
-- ============================================================================

COMMENT ON COLUMN care_alerts.call_sid IS 'Twilio CallSid for correlating webhook updates with alerts';
