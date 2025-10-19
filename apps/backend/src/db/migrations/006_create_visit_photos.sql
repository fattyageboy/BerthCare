-- Migration: 006_create_visit_photos
-- Description: Create visit_photos table for storing photo metadata
-- Author: Backend Engineer
-- Date: 2025-10-11
-- Reference: Architecture Blueprint - Photo Management section

-- ============================================================================
-- VISIT_PHOTOS TABLE
-- ============================================================================
-- Stores metadata for photos uploaded during visits
-- Actual photo files are stored in S3, this table tracks references and metadata
-- Supports multiple photos per visit with thumbnails for efficient loading

CREATE TABLE IF NOT EXISTS visit_photos (
    -- Primary identifier
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- Relationship to visit
    visit_id UUID NOT NULL REFERENCES visits(id) ON DELETE CASCADE,
    
    -- S3 storage keys and URLs
    s3_key TEXT NOT NULL,
    s3_url TEXT NOT NULL,
    thumbnail_s3_key TEXT,
    
    -- File metadata
    file_name VARCHAR(255) NOT NULL CHECK (char_length(file_name) <= 255),
    file_size INTEGER CHECK (file_size > 0),
    mime_type VARCHAR(100) NOT NULL CHECK (mime_type IN (
        'image/jpeg',
        'image/png',
        'image/webp',
        'image/gif'
    )),
    
    -- Upload tracking
    uploaded_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    
    -- Constraints
    CONSTRAINT unique_s3_key UNIQUE (s3_key)
);

-- ============================================================================
-- INDEXES
-- ============================================================================
-- Optimized for common query patterns in photo management

-- Index on uploaded_at for chronological queries
-- Query pattern: "Get recently uploaded photos" or "Photos uploaded in date range"
CREATE INDEX IF NOT EXISTS idx_visit_photos_uploaded_at ON visit_photos(uploaded_at DESC);

-- Composite index for visit + upload time
-- Query pattern: "Get photos for visit ordered by upload time"
CREATE INDEX IF NOT EXISTS idx_visit_photos_visit_uploaded ON visit_photos(visit_id, uploaded_at DESC);

-- ============================================================================
-- COMMENTS
-- ============================================================================
-- Documentation for database schema

COMMENT ON TABLE visit_photos IS 'Metadata for photos uploaded during visits (actual files stored in S3)';

COMMENT ON COLUMN visit_photos.id IS 'Unique photo identifier (UUID)';
COMMENT ON COLUMN visit_photos.visit_id IS 'Reference to the visit this photo belongs to';
COMMENT ON COLUMN visit_photos.s3_key IS 'S3 object key for the full-size photo';
COMMENT ON COLUMN visit_photos.s3_url IS 'Full S3 URL for accessing the photo';
COMMENT ON COLUMN visit_photos.thumbnail_s3_key IS 'S3 object key for the thumbnail version (320px width)';
COMMENT ON COLUMN visit_photos.file_name IS 'Original filename from upload';
COMMENT ON COLUMN visit_photos.file_size IS 'File size in bytes';
COMMENT ON COLUMN visit_photos.mime_type IS 'MIME type (e.g., image/jpeg, image/png)';
COMMENT ON COLUMN visit_photos.uploaded_at IS 'Timestamp when photo was uploaded';
