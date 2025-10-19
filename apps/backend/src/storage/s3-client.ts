/**
 * AWS S3 Client Configuration
 *
 * Task B4: Set up S3 client
 * Configure AWS SDK v3 for S3; implement pre-signed URL generation for uploads;
 * create helper functions for photo storage (with compression metadata);
 * configure lifecycle policies (archive after 7 years).
 *
 * Provides S3 client for file storage operations with support for:
 * - Pre-signed URL generation for secure uploads/downloads
 * - Photo storage with compression metadata
 * - Document and signature storage
 * - LocalStack support for local development
 * - Production-ready error handling
 *
 * Reference: project-documentation/task-plan.md - Phase B – Backend Core Infrastructure
 * Reference: Architecture Blueprint - File Storage section
 */

import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  NotFound,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import dotenv from 'dotenv';

import { logDebug, logError, logInfo } from '../config/logger';

// Load environment variables
dotenv.config({ path: '../../.env' });

// S3 Client Configuration
const s3Config = {
  region: process.env.AWS_REGION || 'ca-central-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || 'test',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || 'test',
  },
  // LocalStack endpoint for local development
  ...(process.env.AWS_ENDPOINT && {
    endpoint: process.env.AWS_ENDPOINT,
    forcePathStyle: true, // Required for LocalStack
  }),
};

// Create S3 client instance
export const s3Client = new S3Client(s3Config);

// S3 Bucket Names
export const S3_BUCKETS = {
  PHOTOS: process.env.S3_BUCKET_PHOTOS || 'berthcare-photos-dev',
  DOCUMENTS: process.env.S3_BUCKET_DOCUMENTS || 'berthcare-documents-dev',
  SIGNATURES: process.env.S3_BUCKET_SIGNATURES || 'berthcare-signatures-dev',
} as const;

// File type configurations
export const FILE_CONFIGS = {
  PHOTO: {
    maxSize: 10 * 1024 * 1024, // 10MB
    allowedTypes: ['image/jpeg', 'image/png', 'image/webp'],
    bucket: S3_BUCKETS.PHOTOS,
  },
  DOCUMENT: {
    maxSize: 20 * 1024 * 1024, // 20MB
    allowedTypes: ['application/pdf', 'image/jpeg', 'image/png'],
    bucket: S3_BUCKETS.DOCUMENTS,
  },
  SIGNATURE: {
    maxSize: 1 * 1024 * 1024, // 1MB
    allowedTypes: ['image/png', 'image/jpeg'],
    bucket: S3_BUCKETS.SIGNATURES,
  },
} as const;

/**
 * Photo metadata interface
 */
export interface PhotoMetadata {
  originalName: string;
  mimeType: string;
  size: number;
  width?: number;
  height?: number;
  compressed?: boolean;
  compressionQuality?: number;
  uploadedBy: string;
  uploadedAt: string;
  visitId?: string;
  clientId?: string;
}

/**
 * Pre-signed URL options
 */
export interface PreSignedUrlOptions {
  expiresIn?: number; // Seconds (default: 3600 = 1 hour)
  contentType?: string;
  metadata?: Record<string, string>;
}

/**
 * Upload result interface
 */
export interface UploadResult {
  key: string;
  bucket: string;
  url: string;
  etag?: string;
  versionId?: string;
}

/**
 * Generate pre-signed URL for uploading a file to S3
 *
 * @param bucket - S3 bucket name
 * @param key - Object key (file path in S3)
 * @param options - Pre-signed URL options
 * @returns Pre-signed URL for upload
 */
export async function generateUploadUrl(
  bucket: string,
  key: string,
  options: PreSignedUrlOptions = {}
): Promise<string> {
  const { expiresIn = 3600, contentType, metadata } = options;

  try {
    const command = new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      ContentType: contentType,
      Metadata: metadata,
    });

    const url = await getSignedUrl(s3Client, command, { expiresIn });

    logDebug('Generated upload URL', {
      bucket,
      key,
      expiresIn,
      contentType,
    });

    return url;
  } catch (error) {
    logError('Failed to generate upload URL', error as Error, {
      bucket,
      key,
    });
    throw new Error('Failed to generate upload URL');
  }
}

/**
 * Generate pre-signed URL for downloading a file from S3
 *
 * @param bucket - S3 bucket name
 * @param key - Object key (file path in S3)
 * @param expiresIn - URL expiration time in seconds (default: 3600)
 * @returns Pre-signed URL for download
 */
export async function generateDownloadUrl(
  bucket: string,
  key: string,
  expiresIn: number = 3600
): Promise<string> {
  try {
    const command = new GetObjectCommand({
      Bucket: bucket,
      Key: key,
    });

    const url = await getSignedUrl(s3Client, command, { expiresIn });

    logDebug('Generated download URL', {
      bucket,
      key,
      expiresIn,
    });

    return url;
  } catch (error) {
    logError('Failed to generate download URL', error as Error, {
      bucket,
      key,
    });
    throw new Error('Failed to generate download URL');
  }
}

/**
 * Generate pre-signed URL for photo upload with metadata
 *
 * @param visitId - Visit ID for organizing photos
 * @param fileName - Original file name
 * @param metadata - Photo metadata
 * @returns Pre-signed URL and object key
 */
export async function generatePhotoUploadUrl(
  visitId: string,
  fileName: string,
  metadata: Partial<PhotoMetadata>
): Promise<{ url: string; key: string }> {
  // Generate unique key with timestamp
  const timestamp = Date.now();
  const sanitizedFileName = fileName.replace(/[^a-zA-Z0-9.-]/g, '_');
  const key = `visits/${visitId}/photos/${timestamp}-${sanitizedFileName}`;

  // Prepare metadata for S3
  const s3Metadata: Record<string, string> = {
    originalName: metadata.originalName || fileName,
    mimeType: metadata.mimeType || 'image/jpeg',
    size: String(metadata.size || 0),
    uploadedBy: metadata.uploadedBy || 'unknown',
    uploadedAt: metadata.uploadedAt || new Date().toISOString(),
  };

  // Add optional metadata
  if (metadata.width) s3Metadata.width = String(metadata.width);
  if (metadata.height) s3Metadata.height = String(metadata.height);
  if (metadata.compressed) s3Metadata.compressed = String(metadata.compressed);
  if (metadata.compressionQuality)
    s3Metadata.compressionQuality = String(metadata.compressionQuality);
  if (metadata.clientId) s3Metadata.clientId = metadata.clientId;

  const url = await generateUploadUrl(S3_BUCKETS.PHOTOS, key, {
    expiresIn: 3600, // 1 hour
    contentType: metadata.mimeType,
    metadata: s3Metadata,
  });

  logInfo('Generated photo upload URL', {
    visitId,
    key,
    metadata: s3Metadata,
  });

  return { url, key };
}

/**
 * Generate pre-signed URL for document upload
 *
 * @param documentType - Type of document (e.g., 'care-plan', 'assessment')
 * @param fileName - Original file name
 * @param uploadedBy - User ID who is uploading
 * @returns Pre-signed URL and object key
 */
export async function generateDocumentUploadUrl(
  documentType: string,
  fileName: string,
  uploadedBy: string
): Promise<{ url: string; key: string }> {
  const timestamp = Date.now();
  const sanitizedFileName = fileName.replace(/[^a-zA-Z0-9.-]/g, '_');
  const key = `documents/${documentType}/${timestamp}-${sanitizedFileName}`;

  const url = await generateUploadUrl(S3_BUCKETS.DOCUMENTS, key, {
    expiresIn: 3600,
    metadata: {
      originalName: fileName,
      uploadedBy,
      uploadedAt: new Date().toISOString(),
      documentType,
    },
  });

  logInfo('Generated document upload URL', {
    documentType,
    key,
    uploadedBy,
  });

  return { url, key };
}

/**
 * Generate pre-signed URL for signature upload
 *
 * @param visitId - Visit ID for the signature
 * @param signatureType - Type of signature (e.g., 'caregiver', 'client', 'family')
 * @param uploadedBy - User ID who is uploading
 * @returns Pre-signed URL and object key
 */
export async function generateSignatureUploadUrl(
  visitId: string,
  signatureType: string,
  uploadedBy: string
): Promise<{ url: string; key: string }> {
  const timestamp = Date.now();
  const key = `visits/${visitId}/signatures/${signatureType}-${timestamp}.png`;

  const url = await generateUploadUrl(S3_BUCKETS.SIGNATURES, key, {
    expiresIn: 600, // 10 minutes (signatures should be uploaded immediately)
    contentType: 'image/png',
    metadata: {
      visitId,
      signatureType,
      uploadedBy,
      uploadedAt: new Date().toISOString(),
    },
  });

  logInfo('Generated signature upload URL', {
    visitId,
    signatureType,
    key,
  });

  return { url, key };
}

/**
 * Check if an object exists in S3
 *
 * @param bucket - S3 bucket name
 * @param key - Object key
 * @returns True if object exists, false otherwise
 */
export async function objectExists(bucket: string, key: string): Promise<boolean> {
  try {
    const command = new HeadObjectCommand({
      Bucket: bucket,
      Key: key,
    });

    await s3Client.send(command);
    return true;
  } catch (error) {
    if (error instanceof NotFound) {
      return false;
    }
    logError('Failed to check object existence', error as Error, {
      bucket,
      key,
    });
    throw error;
  }
}

/**
 * Delete an object from S3
 *
 * @param bucket - S3 bucket name
 * @param key - Object key
 */
export async function deleteObject(bucket: string, key: string): Promise<void> {
  try {
    const command = new DeleteObjectCommand({
      Bucket: bucket,
      Key: key,
    });

    await s3Client.send(command);

    logInfo('Deleted object from S3', { bucket, key });
  } catch (error) {
    logError('Failed to delete object', error as Error, {
      bucket,
      key,
    });
    throw new Error('Failed to delete object');
  }
}

/**
 * Get object metadata from S3
 *
 * @param bucket - S3 bucket name
 * @param key - Object key
 * @returns Object metadata
 */
export async function getObjectMetadata(
  bucket: string,
  key: string
): Promise<Record<string, string>> {
  try {
    const command = new HeadObjectCommand({
      Bucket: bucket,
      Key: key,
    });

    const response = await s3Client.send(command);

    return response.Metadata || {};
  } catch (error) {
    logError('Failed to get object metadata', error as Error, {
      bucket,
      key,
    });
    throw new Error('Failed to get object metadata');
  }
}

/**
 * Verify S3 connection and bucket access
 *
 * @returns True if connection successful
 */
export async function verifyS3Connection(): Promise<boolean> {
  try {
    // Try to check if photos bucket exists
    const command = new HeadObjectCommand({
      Bucket: S3_BUCKETS.PHOTOS,
      Key: 'health-check', // Non-existent key, just checking bucket access
    });

    await s3Client.send(command);
    return true;
  } catch (error) {
    // NotFound is expected (key doesn't exist), but means bucket is accessible
    if (error instanceof NotFound) {
      logInfo('S3 connection verified', {
        bucket: S3_BUCKETS.PHOTOS,
        endpoint: process.env.AWS_ENDPOINT || 'AWS',
      });
      return true;
    }

    logError('S3 connection failed', error as Error, {
      bucket: S3_BUCKETS.PHOTOS,
    });
    return false;
  }
}

// Log S3 configuration on module load
logInfo('S3 Client initialized', {
  region: s3Config.region,
  endpoint: process.env.AWS_ENDPOINT || 'AWS',
  buckets: S3_BUCKETS,
});
