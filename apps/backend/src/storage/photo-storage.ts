/**
 * Photo Storage Helper Functions
 *
 * Provides high-level functions for photo storage operations:
 * - Photo upload with compression metadata
 * - Photo retrieval with pre-signed URLs
 * - Photo deletion
 * - Batch operations
 *
 * Photos are organized by visit ID for easy retrieval and management.
 */

import { Pool } from 'pg';

import { getPostgresPoolConfig } from '../config/env';
import { logError, logInfo } from '../config/logger';

import {
  deleteObject,
  generateDownloadUrl,
  generatePhotoUploadUrl,
  getObjectMetadata,
  objectExists,
  PhotoMetadata,
  S3_BUCKETS,
} from './s3-client';

let photoDbPool: Pool | null = null;

function getPhotoDbPool(): Pool {
  if (!photoDbPool) {
    photoDbPool = new Pool(getPostgresPoolConfig());
    photoDbPool.on('error', (error) => {
      logError('Unexpected PostgreSQL error in photo storage pool', error as Error);
    });
  }
  return photoDbPool;
}

/**
 * Photo upload request
 */
export interface PhotoUploadRequest {
  visitId: string;
  fileName: string;
  mimeType: string;
  size: number;
  width?: number;
  height?: number;
  compressed?: boolean;
  compressionQuality?: number;
  uploadedBy: string;
  clientId?: string;
}

/**
 * Photo upload response
 */
export interface PhotoUploadResponse {
  uploadUrl: string;
  photoKey: string;
  expiresAt: Date;
  metadata: PhotoMetadata;
}

/**
 * Photo info
 */
export interface PhotoInfo {
  key: string;
  downloadUrl: string;
  metadata: PhotoMetadata;
  expiresAt: Date;
}

/**
 * Request pre-signed URL for photo upload
 *
 * This function generates a pre-signed URL that the mobile app can use
 * to upload photos directly to S3, bypassing the backend server.
 *
 * @param request - Photo upload request
 * @returns Pre-signed URL and metadata
 */
export async function requestPhotoUpload(
  request: PhotoUploadRequest
): Promise<PhotoUploadResponse> {
  try {
    // Validate file size
    const maxSize = 10 * 1024 * 1024; // 10MB
    if (request.size > maxSize) {
      throw new Error(`Photo size exceeds maximum allowed size of ${maxSize} bytes`);
    }

    // Validate MIME type
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/heic'];
    if (!allowedTypes.includes(request.mimeType)) {
      throw new Error(`Invalid MIME type: ${request.mimeType}`);
    }

    // Prepare metadata
    const metadata: Partial<PhotoMetadata> = {
      originalName: request.fileName,
      mimeType: request.mimeType,
      size: request.size,
      width: request.width,
      height: request.height,
      compressed: request.compressed,
      compressionQuality: request.compressionQuality,
      uploadedBy: request.uploadedBy,
      uploadedAt: new Date().toISOString(),
      visitId: request.visitId,
      clientId: request.clientId,
    };

    // Generate pre-signed URL
    const { url, key } = await generatePhotoUploadUrl(request.visitId, request.fileName, metadata);

    // Calculate expiration time (1 hour from now)
    const expiresAt = new Date(Date.now() + 3600 * 1000);

    logInfo('Photo upload requested', {
      visitId: request.visitId,
      fileName: request.fileName,
      photoKey: key,
      uploadedBy: request.uploadedBy,
    });

    return {
      uploadUrl: url,
      photoKey: key,
      expiresAt,
      metadata: metadata as PhotoMetadata,
    };
  } catch (error) {
    logError('Failed to request photo upload', error as Error, {
      visitId: request.visitId,
      fileName: request.fileName,
    });
    throw error;
  }
}

/**
 * Get photo download URL
 *
 * Generates a pre-signed URL for downloading a photo from S3.
 *
 * @param photoKey - S3 object key for the photo
 * @param expiresIn - URL expiration time in seconds (default: 3600)
 * @returns Photo info with download URL
 */
export async function getPhotoDownloadUrl(
  photoKey: string,
  expiresIn: number = 3600
): Promise<PhotoInfo> {
  try {
    // Check if photo exists
    const exists = await objectExists(S3_BUCKETS.PHOTOS, photoKey);
    if (!exists) {
      throw new Error('Photo not found');
    }

    // Get photo metadata
    const s3Metadata = await getObjectMetadata(S3_BUCKETS.PHOTOS, photoKey);

    // Generate download URL
    const downloadUrl = await generateDownloadUrl(S3_BUCKETS.PHOTOS, photoKey, expiresIn);

    // Parse metadata
    const metadata: PhotoMetadata = {
      originalName: s3Metadata.originalname || 'unknown',
      mimeType: s3Metadata.mimetype || 'image/jpeg',
      size: parseInt(s3Metadata.size || '0'),
      width: s3Metadata.width ? parseInt(s3Metadata.width) : undefined,
      height: s3Metadata.height ? parseInt(s3Metadata.height) : undefined,
      compressed: s3Metadata.compressed === 'true',
      compressionQuality: s3Metadata.compressionquality
        ? parseInt(s3Metadata.compressionquality)
        : undefined,
      uploadedBy: s3Metadata.uploadedby || 'unknown',
      uploadedAt: s3Metadata.uploadedat || new Date().toISOString(),
      visitId: s3Metadata.visitid,
      clientId: s3Metadata.clientid,
    };

    const expiresAt = new Date(Date.now() + expiresIn * 1000);

    logInfo('Photo download URL generated', {
      photoKey,
      expiresIn,
    });

    return {
      key: photoKey,
      downloadUrl,
      metadata,
      expiresAt,
    };
  } catch (error) {
    logError('Failed to get photo download URL', error as Error, {
      photoKey,
    });
    throw error;
  }
}

/**
 * Get all photos for a visit
 *
 * Queries the visit_photos table for stored S3 keys and hydrates each object
 * with a pre-signed download URL plus metadata.
 *
 * @param visitId - Visit ID
 * @returns Array of photo info
 */
export async function getVisitPhotos(visitId: string): Promise<PhotoInfo[]> {
  logInfo('Getting visit photos', { visitId });

  try {
    const pool = getPhotoDbPool();
    const result = await pool.query<{ photo_key: string }>(
      `
        SELECT photo_key
        FROM visit_photos
        WHERE visit_id = $1
        ORDER BY uploaded_at DESC, photo_key ASC
      `,
      [visitId]
    );

    if (result.rowCount === 0) {
      return [];
    }

    return await Promise.all(result.rows.map((row) => getPhotoDownloadUrl(row.photo_key)));
  } catch (error) {
    logError('Failed to get visit photos', error as Error, {
      visitId,
    });
    throw error;
  }
}

/**
 * Delete a photo from S3
 *
 * @param photoKey - S3 object key for the photo
 */
export async function deletePhoto(photoKey: string): Promise<void> {
  try {
    await deleteObject(S3_BUCKETS.PHOTOS, photoKey);

    logInfo('Photo deleted', { photoKey });
  } catch (error) {
    logError('Failed to delete photo', error as Error, {
      photoKey,
    });
    throw error;
  }
}

/**
 * Delete all photos for a visit
 *
 * @param visitId - Visit ID
 */
export async function deleteVisitPhotos(visitId: string): Promise<void> {
  try {
    // Get all photo keys for visit from database
    const photos = await getVisitPhotos(visitId);

    // Delete each photo
    await Promise.all(photos.map((photo) => deletePhoto(photo.key)));

    logInfo('Visit photos deleted', {
      visitId,
      count: photos.length,
    });
  } catch (error) {
    logError('Failed to delete visit photos', error as Error, {
      visitId,
    });
    throw error;
  }
}

/**
 * Validate photo metadata
 *
 * @param metadata - Photo metadata to validate
 * @returns True if valid, throws error otherwise
 */
export function validatePhotoMetadata(metadata: Partial<PhotoMetadata>): boolean {
  // Required fields
  if (!metadata.originalName) {
    throw new Error('Original name is required');
  }

  if (!metadata.mimeType) {
    throw new Error('MIME type is required');
  }

  if (!metadata.size || metadata.size <= 0) {
    throw new Error('Valid file size is required');
  }

  if (!metadata.uploadedBy) {
    throw new Error('Uploaded by user ID is required');
  }

  // Validate MIME type
  const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/heic'];
  if (!allowedTypes.includes(metadata.mimeType)) {
    throw new Error(`Invalid MIME type: ${metadata.mimeType}`);
  }

  // Validate size
  const maxSize = 10 * 1024 * 1024; // 10MB
  if (metadata.size > maxSize) {
    throw new Error(`File size exceeds maximum of ${maxSize} bytes`);
  }

  // Validate dimensions if provided
  if (metadata.width && metadata.width <= 0) {
    throw new Error('Invalid width');
  }

  if (metadata.height && metadata.height <= 0) {
    throw new Error('Invalid height');
  }

  // Validate compression quality if provided
  if (
    metadata.compressionQuality &&
    (metadata.compressionQuality < 0 || metadata.compressionQuality > 100)
  ) {
    throw new Error('Compression quality must be between 0 and 100');
  }

  return true;
}
