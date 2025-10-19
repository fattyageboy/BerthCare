/**
 * Unit Tests: Photo Storage Service
 *
 * Tests photo storage service functionality:
 * - Photo upload with metadata
 * - Photo retrieval
 * - Photo deletion
 * - Compression handling
 * - Error scenarios
 */

// Mock the S3 client before importing photo storage
jest.mock('../src/storage/s3-client', () => ({
  generatePhotoUploadUrl: jest.fn(),
  generateDownloadUrl: jest.fn(),
  deleteObject: jest.fn(),
  objectExists: jest.fn(),
  getObjectMetadata: jest.fn(),
  S3_BUCKETS: {
    PHOTOS: 'berthcare-photos-test',
    DOCUMENTS: 'berthcare-documents-test',
    SIGNATURES: 'berthcare-signatures-test',
  },
  FILE_CONFIGS: {
    PHOTO: {
      maxSize: 10 * 1024 * 1024,
      allowedTypes: ['image/jpeg', 'image/png', 'image/webp'],
      bucket: 'berthcare-photos-test',
    },
  },
}));

import {
  deletePhoto,
  getPhotoDownloadUrl,
  requestPhotoUpload,
  validatePhotoMetadata,
} from '../src/storage/photo-storage';
import * as s3Client from '../src/storage/s3-client';

describe('Photo Storage Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('requestPhotoUpload', () => {
    it('should generate upload URL with correct parameters', async () => {
      const mockResponse = {
        url: 'https://s3.amazonaws.com/photos/test.jpg?signature=xyz',
        key: 'photos/visit-123/photo.jpg',
      };
      (s3Client.generatePhotoUploadUrl as jest.Mock).mockResolvedValue(mockResponse);

      const result = await requestPhotoUpload({
        visitId: 'visit-123',
        clientId: 'client-456',
        uploadedBy: 'user-789',
        fileName: 'photo.jpg',
        mimeType: 'image/jpeg',
        size: 1024,
      });

      expect(result).toHaveProperty('uploadUrl');
      expect(result).toHaveProperty('photoKey');
      expect(result).toHaveProperty('expiresAt');
      expect(result).toHaveProperty('metadata');
      expect(s3Client.generatePhotoUploadUrl).toHaveBeenCalled();
    });

    it('should validate file size', async () => {
      await expect(
        requestPhotoUpload({
          visitId: 'visit-123',
          clientId: 'client-456',
          uploadedBy: 'user-789',
          fileName: 'photo.jpg',
          mimeType: 'image/jpeg',
          size: 20 * 1024 * 1024, // 20MB - exceeds 10MB limit
        })
      ).rejects.toThrow();
    });

    it('should validate mime type', async () => {
      await expect(
        requestPhotoUpload({
          visitId: 'visit-123',
          clientId: 'client-456',
          uploadedBy: 'user-789',
          fileName: 'document.pdf',
          mimeType: 'application/pdf',
          size: 1024,
        })
      ).rejects.toThrow();
    });
  });

  describe('getPhotoDownloadUrl', () => {
    it('should generate download URL', async () => {
      const mockUrl = 'https://s3.amazonaws.com/photos/test.jpg?signature=xyz';
      const mockMetadata = {
        size: 1024,
        contentType: 'image/jpeg',
        metadata: { uploadedBy: 'user-123' },
        lastModified: new Date(),
      };
      (s3Client.generateDownloadUrl as jest.Mock).mockResolvedValue(mockUrl);
      (s3Client.objectExists as jest.Mock).mockResolvedValue(true);
      (s3Client.getObjectMetadata as jest.Mock).mockResolvedValue(mockMetadata);

      const result = await getPhotoDownloadUrl('photos/visit-123/photo.jpg');

      expect(result).toHaveProperty('downloadUrl', mockUrl);
      expect(result).toHaveProperty('expiresAt');
    });

    it('should throw error if photo does not exist', async () => {
      (s3Client.objectExists as jest.Mock).mockResolvedValue(false);

      await expect(getPhotoDownloadUrl('photos/visit-123/photo.jpg')).rejects.toThrow();
    });

    it('should use custom expiration time', async () => {
      const mockUrl = 'https://s3.amazonaws.com/photos/test.jpg?signature=xyz';
      const mockMetadata = {
        size: 1024,
        contentType: 'image/jpeg',
        metadata: { uploadedBy: 'user-123' },
        lastModified: new Date(),
      };
      (s3Client.generateDownloadUrl as jest.Mock).mockResolvedValue(mockUrl);
      (s3Client.objectExists as jest.Mock).mockResolvedValue(true);
      (s3Client.getObjectMetadata as jest.Mock).mockResolvedValue(mockMetadata);

      await getPhotoDownloadUrl('photos/visit-123/photo.jpg', 7200);

      expect(s3Client.generateDownloadUrl).toHaveBeenCalledWith(
        'berthcare-photos-test',
        'photos/visit-123/photo.jpg',
        7200
      );
    });
  });

  describe('validatePhotoMetadata', () => {
    it('should validate required fields', () => {
      expect(() =>
        validatePhotoMetadata({
          originalName: 'photo.jpg',
          mimeType: 'image/jpeg',
          size: 1024,
          uploadedBy: 'user-123',
          uploadedAt: new Date().toISOString(),
        })
      ).not.toThrow();
    });

    it('should throw error for missing required fields', () => {
      expect(() =>
        validatePhotoMetadata({
          mimeType: 'image/jpeg',
          size: 1024,
        })
      ).toThrow();
    });

    it('should validate file size limits', () => {
      expect(() =>
        validatePhotoMetadata({
          originalName: 'photo.jpg',
          mimeType: 'image/jpeg',
          size: 20 * 1024 * 1024, // 20MB
          uploadedBy: 'user-123',
          uploadedAt: new Date().toISOString(),
        })
      ).toThrow();
    });

    it('should validate mime types', () => {
      expect(() =>
        validatePhotoMetadata({
          originalName: 'document.pdf',
          mimeType: 'application/pdf',
          size: 1024,
          uploadedBy: 'user-123',
          uploadedAt: new Date().toISOString(),
        })
      ).toThrow();
    });
  });

  describe('deletePhoto', () => {
    it('should delete photo from S3', async () => {
      (s3Client.deleteObject as jest.Mock).mockResolvedValue(undefined);

      await deletePhoto('photos/visit-123/photo.jpg');

      expect(s3Client.deleteObject).toHaveBeenCalledWith(
        'berthcare-photos-test',
        'photos/visit-123/photo.jpg'
      );
    });

    it('should handle deletion errors', async () => {
      (s3Client.deleteObject as jest.Mock).mockRejectedValue(new Error('Delete failed'));

      await expect(deletePhoto('photos/visit-123/photo.jpg')).rejects.toThrow('Delete failed');
    });
  });
});
