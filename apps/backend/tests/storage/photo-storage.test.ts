import * as PhotoStorage from '../../src/storage/photo-storage';
import type { PhotoUploadRequest } from '../../src/storage/photo-storage';

jest.mock('../../src/config/logger', () => ({
  logInfo: jest.fn(),
  logError: jest.fn(),
  logDebug: jest.fn(),
}));

jest.mock('../../src/storage/s3-client', () => ({
  generatePhotoUploadUrl: jest.fn(),
  objectExists: jest.fn(),
  getObjectMetadata: jest.fn(),
  generateDownloadUrl: jest.fn(),
  deleteObject: jest.fn(),
  S3_BUCKETS: { PHOTOS: 'test-photos' },
}));

const loggerMocks = jest.requireMock('../../src/config/logger') as {
  logInfo: jest.Mock;
  logError: jest.Mock;
  logDebug: jest.Mock;
};

const s3Mocks = jest.requireMock('../../src/storage/s3-client') as {
  generatePhotoUploadUrl: jest.Mock;
  objectExists: jest.Mock;
  getObjectMetadata: jest.Mock;
  generateDownloadUrl: jest.Mock;
  deleteObject: jest.Mock;
  S3_BUCKETS: { PHOTOS: string };
};

const logInfoMock = loggerMocks.logInfo;
const logErrorMock = loggerMocks.logError;

const generatePhotoUploadUrlMock = s3Mocks.generatePhotoUploadUrl;
const objectExistsMock = s3Mocks.objectExists;
const getObjectMetadataMock = s3Mocks.getObjectMetadata;
const generateDownloadUrlMock = s3Mocks.generateDownloadUrl;
const deleteObjectMock = s3Mocks.deleteObject;

const {
  requestPhotoUpload,
  getPhotoDownloadUrl,
  getVisitPhotos,
  deletePhoto,
  deleteVisitPhotos,
  validatePhotoMetadata,
} = PhotoStorage;

describe('photo-storage helpers', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('generates upload url with metadata and expiration', async () => {
    const request: PhotoUploadRequest = {
      visitId: 'visit-1',
      fileName: 'photo.jpg',
      mimeType: 'image/jpeg',
      size: 1024,
      uploadedBy: 'user-123',
    };
    generatePhotoUploadUrlMock.mockResolvedValueOnce({
      url: 'https://upload-url',
      key: 'visits/visit-1/photos/123-photo.jpg',
    });

    const result = await requestPhotoUpload(request);

    expect(generatePhotoUploadUrlMock).toHaveBeenCalledWith(
      request.visitId,
      request.fileName,
      expect.objectContaining({
        originalName: 'photo.jpg',
        mimeType: 'image/jpeg',
        size: 1024,
      })
    );
    expect(result.uploadUrl).toBe('https://upload-url');
    expect(result.photoKey).toBe('visits/visit-1/photos/123-photo.jpg');
    expect(result.metadata.uploadedBy).toBe('user-123');
    expect(result.expiresAt.valueOf()).toBeGreaterThan(Date.now());
  });

  it('rejects oversized uploads', async () => {
    const request: PhotoUploadRequest = {
      visitId: 'visit-1',
      fileName: 'big-photo.jpg',
      mimeType: 'image/jpeg',
      size: 20 * 1024 * 1024,
      uploadedBy: 'user-123',
    };

    await expect(requestPhotoUpload(request)).rejects.toThrow(/Photo size exceeds maximum/);
    expect(logErrorMock).toHaveBeenCalled();
  });

  it('rejects unsupported mime types', async () => {
    const request: PhotoUploadRequest = {
      visitId: 'visit-1',
      fileName: 'doc.pdf',
      mimeType: 'application/pdf',
      size: 1024,
      uploadedBy: 'user-123',
    };

    await expect(requestPhotoUpload(request)).rejects.toThrow(/Invalid MIME type/);
    expect(logErrorMock).toHaveBeenCalled();
  });

  it('builds download url with metadata', async () => {
    objectExistsMock.mockResolvedValueOnce(true);
    getObjectMetadataMock.mockResolvedValueOnce({
      originalname: 'photo.jpg',
      mimetype: 'image/jpeg',
      size: '1024',
      uploadedby: 'user-123',
      uploadedat: '2024-01-01T00:00:00.000Z',
      visitid: 'visit-1',
      clientid: 'client-5',
    });
    generateDownloadUrlMock.mockResolvedValueOnce('https://download-url');

    const result = await getPhotoDownloadUrl('visits/visit-1/photos/sample.jpg', 600);

    expect(objectExistsMock).toHaveBeenCalledWith(
      'test-photos',
      'visits/visit-1/photos/sample.jpg'
    );
    expect(generateDownloadUrlMock).toHaveBeenCalledWith(
      'test-photos',
      'visits/visit-1/photos/sample.jpg',
      600
    );
    expect(result.metadata.originalName).toBe('photo.jpg');
    expect(result.expiresAt.valueOf()).toBeGreaterThan(Date.now());
  });

  it('throws when photo is missing', async () => {
    objectExistsMock.mockResolvedValueOnce(false);

    await expect(getPhotoDownloadUrl('missing-photo.jpg')).rejects.toThrow('Photo not found');
    expect(logErrorMock).toHaveBeenCalled();
  });

  it('deletes photo objects', async () => {
    deleteObjectMock.mockResolvedValueOnce(undefined);

    await deletePhoto('photo-key.jpg');

    expect(deleteObjectMock).toHaveBeenCalledWith('test-photos', 'photo-key.jpg');
  });

  it('handles visit photo deletion when no photos exist', async () => {
    await deleteVisitPhotos('visit-123');

    expect(logInfoMock).toHaveBeenCalledWith('Visit photos deleted', {
      visitId: 'visit-123',
      count: 0,
    });
  });

  it('returns empty visit photo list placeholder', async () => {
    const result = await getVisitPhotos('visit-123');
    expect(result).toEqual([]);
    expect(logInfoMock).toHaveBeenCalledWith('Getting visit photos', { visitId: 'visit-123' });
  });

  it('validates metadata inputs', () => {
    const valid = {
      originalName: 'photo.jpg',
      mimeType: 'image/jpeg',
      size: 1000,
      uploadedBy: 'user-1',
    };

    expect(validatePhotoMetadata(valid)).toBe(true);
    expect(() => validatePhotoMetadata({ mimeType: 'image/jpeg', size: 0 })).toThrow(
      'Original name is required'
    );
    expect(() =>
      validatePhotoMetadata({ originalName: 'photo.jpg', size: 100, uploadedBy: 'user' })
    ).toThrow('MIME type is required');
  });
});
