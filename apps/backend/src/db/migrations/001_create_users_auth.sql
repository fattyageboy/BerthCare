-- Migration: 001_create_users_auth
-- Description: Create users and refresh_tokens tables for authentication system
-- Author: Backend Engineer
-- Date: 2025-10-10
-- Reference: Architecture Blueprint - Authentication section

-- ============================================================================
-- USERS TABLE
-- ============================================================================
-- Stores user account information for caregivers, coordinators, and admins
-- Supports role-based access control and zone-based data isolation

CREATE TABLE IF NOT EXISTS users (
    -- Primary identifier
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- Authentication credentials
    email VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    
    -- User profile information
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    
    -- Role-based access control
    -- caregiver: Home care workers who provide direct care to clients
    -- coordinator: Zone managers who handle alerts and oversight
    -- admin: System administrators with full access
    role VARCHAR(20) NOT NULL CHECK (role IN ('caregiver', 'coordinator', 'admin', 'family')),
    
    -- Zone assignment for data isolation
    -- Caregivers and coordinators are assigned to specific zones
    -- Admins have access to all zones (zone_id can be NULL)
    zone_id UUID REFERENCES zones(id),
    
    -- Optional contact information
    phone VARCHAR(20),
    
    -- Account status
    is_active BOOLEAN NOT NULL DEFAULT true,
    
    -- Authentication activity
    last_login_at TIMESTAMP WITH TIME ZONE,
    
    -- Audit timestamps
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    
    -- Soft delete support
    deleted_at TIMESTAMP WITH TIME ZONE
);

-- ============================================================================
-- REFRESH TOKENS TABLE
-- ============================================================================
-- Stores refresh tokens for JWT authentication
-- Supports multi-device sessions and token revocation

CREATE TABLE IF NOT EXISTS refresh_tokens (
    -- Primary identifier
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- User association
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    
    -- Token data
    -- Stored as hash for security (never store raw tokens)
    token_hash VARCHAR(255) NOT NULL UNIQUE,
    
    -- Device identification for multi-device support
    -- Allows users to see and manage active sessions per device
    device_id VARCHAR(255) NOT NULL,
    
    -- Token lifecycle
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    
    -- Revocation support
    -- Tokens can be revoked for security (logout, password change, etc.)
    revoked_at TIMESTAMP WITH TIME ZONE,
    
    -- Audit timestamps
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================================
-- INDEXES
-- ============================================================================
-- Optimized for common query patterns in authentication flows

-- Users table indexes
-- Fast lookup by email during login
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email) WHERE deleted_at IS NULL;

-- Fast lookup by zone for data isolation queries
CREATE INDEX IF NOT EXISTS idx_users_zone_id ON users(zone_id) WHERE deleted_at IS NULL AND is_active = true;

-- Fast lookup by role for authorization checks
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role) WHERE deleted_at IS NULL AND is_active = true;

-- Composite index for zone + role queries (common in coordinator dashboards)
CREATE INDEX IF NOT EXISTS idx_users_zone_role ON users(zone_id, role) WHERE deleted_at IS NULL AND is_active = true;

-- Refresh tokens table indexes
-- Fast lookup by user for token validation
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user_id ON refresh_tokens(user_id) WHERE revoked_at IS NULL;

-- Fast lookup by token hash during refresh operations
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_token_hash ON refresh_tokens(token_hash) WHERE revoked_at IS NULL;

-- Fast lookup by device for multi-device session management
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_device_id ON refresh_tokens(device_id) WHERE revoked_at IS NULL;

-- Cleanup expired tokens (for maintenance jobs)
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_expires_at ON refresh_tokens(expires_at) WHERE revoked_at IS NULL;

-- ============================================================================
-- TRIGGERS
-- ============================================================================
-- Automatic timestamp management for updated_at columns

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for users table
CREATE TRIGGER update_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Trigger for refresh_tokens table
CREATE TRIGGER update_refresh_tokens_updated_at
    BEFORE UPDATE ON refresh_tokens
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- COMMENTS
-- ============================================================================
-- Documentation for database schema

COMMENT ON TABLE users IS 'User accounts for authentication and authorization';
COMMENT ON COLUMN users.id IS 'Unique user identifier (UUID)';
COMMENT ON COLUMN users.email IS 'User email address (unique, used for login)';
COMMENT ON COLUMN users.password_hash IS 'Bcrypt hashed password (never store plaintext)';
COMMENT ON COLUMN users.role IS 'User role: caregiver, coordinator, admin, or family';
COMMENT ON COLUMN users.zone_id IS 'Zone assignment for data isolation (NULL for admins)';
COMMENT ON COLUMN users.phone IS 'Optional contact phone number';
COMMENT ON COLUMN users.is_active IS 'Account active status (false = disabled)';
COMMENT ON COLUMN users.last_login_at IS 'Timestamp of the most recent successful login';
COMMENT ON COLUMN users.deleted_at IS 'Soft delete timestamp (NULL = not deleted)';

COMMENT ON TABLE refresh_tokens IS 'JWT refresh tokens for multi-device session management';
COMMENT ON COLUMN refresh_tokens.token_hash IS 'Hashed refresh token (never store plaintext)';
COMMENT ON COLUMN refresh_tokens.device_id IS 'Device identifier for multi-device support';
COMMENT ON COLUMN refresh_tokens.expires_at IS 'Token expiration timestamp (30 days from creation)';
COMMENT ON COLUMN refresh_tokens.revoked_at IS 'Token revocation timestamp (NULL = active)';
