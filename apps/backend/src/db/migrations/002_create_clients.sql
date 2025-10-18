-- Migration: 002_create_clients
-- Description: Create clients table for client management system
-- Author: Backend Engineer
-- Date: 2025-10-10
--
-- Task C1: Design database schema – clients
-- Create migration for clients table (id, first_name, last_name, date_of_birth, address,
-- latitude, longitude, phone, emergency_contact_name, emergency_contact_phone,
-- emergency_contact_relationship, zone_id, created_at, updated_at);
-- add indexes on zone_id, last_name.
--
-- Reference: project-documentation/task-plan.md - Phase C – Client Management API
-- Reference: Architecture Blueprint - Client Management Endpoints section

-- ============================================================================
-- CLIENTS TABLE
-- ============================================================================
-- Stores client (patient) information for home care services
-- Supports zone-based data isolation and geographic routing

CREATE TABLE IF NOT EXISTS clients (
    -- Primary identifier
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

-- Personal information
first_name VARCHAR(100) NOT NULL,
last_name VARCHAR(100) NOT NULL,
date_of_birth DATE NOT NULL,

-- Contact and location information
address TEXT NOT NULL,
latitude DECIMAL(10, 8) NOT NULL CHECK (latitude BETWEEN -90 AND 90),
longitude DECIMAL(11, 8) NOT NULL CHECK (
    longitude BETWEEN -180 AND 180
),
phone VARCHAR(20),

-- Emergency contact information
emergency_contact_name VARCHAR(200) NOT NULL,
emergency_contact_phone VARCHAR(20) NOT NULL,
emergency_contact_relationship VARCHAR(100) NOT NULL,

-- Zone assignment for data isolation and caregiver routing
-- Clients are assigned to specific zones for geographic organization
-- Foreign key will be added when zones table is created
zone_id UUID NOT NULL,

-- Audit timestamps
created_at TIMESTAMP
WITH
    TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP
WITH
    TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,

-- Soft delete support
deleted_at TIMESTAMP WITH TIME ZONE );

-- ============================================================================
-- INDEXES
-- ============================================================================
-- Optimized for common query patterns in client management

-- Fast lookup by zone for data isolation and caregiver assignment
-- Most common query: "Get all clients in my zone"
CREATE INDEX IF NOT EXISTS idx_clients_zone_id ON clients (zone_id)
WHERE
    deleted_at IS NULL;

-- Fast lookup by last name for search functionality
-- Common query: "Search clients by last name"
CREATE INDEX IF NOT EXISTS idx_clients_last_name ON clients (last_name)
WHERE
    deleted_at IS NULL;

-- Composite index for zone + last name queries (common in client lists)
-- Optimizes: "Get all clients in zone X, sorted by last name"
CREATE INDEX IF NOT EXISTS idx_clients_zone_last_name ON clients (zone_id, last_name)
WHERE
    deleted_at IS NULL;

-- Geographic queries for route optimization
-- Supports: "Find clients near this location"
CREATE INDEX IF NOT EXISTS idx_clients_location ON clients (latitude, longitude)
WHERE
    deleted_at IS NULL;

-- Full name search support (case-insensitive)
-- Supports: "Search clients by first or last name"
CREATE INDEX IF NOT EXISTS idx_clients_full_name ON clients (
    LOWER(first_name),
    LOWER(last_name)
)
WHERE
    deleted_at IS NULL;

-- ============================================================================
-- TRIGGERS
-- ============================================================================
-- Automatic timestamp management for updated_at column

-- Trigger for clients table (reuses function from 001_create_users_auth.sql)
CREATE TRIGGER update_clients_updated_at
    BEFORE UPDATE ON clients
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- COMMENTS
-- ============================================================================
-- Documentation for database schema

COMMENT ON
TABLE clients IS 'Client (patient) information for home care services';

COMMENT ON COLUMN clients.id IS 'Unique client identifier (UUID)';

COMMENT ON COLUMN clients.first_name IS 'Client first name';

COMMENT ON COLUMN clients.last_name IS 'Client last name';

COMMENT ON COLUMN clients.date_of_birth IS 'Client date of birth (for age calculation and identification)';

COMMENT ON COLUMN clients.address IS 'Full street address for visit routing';

COMMENT ON COLUMN clients.latitude IS 'GPS latitude for route optimization and check-in verification';

COMMENT ON COLUMN clients.longitude IS 'GPS longitude for route optimization and check-in verification';

COMMENT ON COLUMN clients.phone IS 'Client phone number (optional, may not have phone)';

COMMENT ON COLUMN clients.emergency_contact_name IS 'Emergency contact full name';

COMMENT ON COLUMN clients.emergency_contact_phone IS 'Emergency contact phone number';

COMMENT ON COLUMN clients.emergency_contact_relationship IS 'Relationship to client (e.g., daughter, son, spouse)';

COMMENT ON COLUMN clients.zone_id IS 'Zone assignment for geographic organization and data isolation';

COMMENT ON COLUMN clients.deleted_at IS 'Soft delete timestamp (NULL = active client)';