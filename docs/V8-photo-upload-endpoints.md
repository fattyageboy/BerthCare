# V8: Photo Upload Flow Implementation

**Task ID:** V8  
**Status:** ✅ Complete  
**Date:** October 12, 2025  
**Endpoints:**

- POST /api/v1/visits/:visitId/photos/upload-url
- POST /api/v1/visits/:visitId/photos  
  **Estimated Effort:** 2 days  
  **Actual Effort:** 2 days

---

## Overview

Implemented the photo upload flow using S3 pre-signed URLs for secure, direct-to-S3 uploads. This two-step process generates a pre-signed URL for the mobile app to upload photos directly to S3, then records the photo metadata in the database. Includes image compression validation (max 2MB), MIME type validation, and thumbnail support.

---

## API Specification

### Endpoint 1: Generate Pre-Signed Upload URL

**POST /api/v1/visits/:visitId/photos/upload-url**

### Authentication

- **Required:** Yes (JWT Bearer token)
- **Role:** Caregiver (or coordinator/admin)
- **Authorization:** Caregiver must own the visit

### Request Body

```typescript
{
  fileName: string; // Required - Original file name
  mimeType: string; // Required - MIME type (image/jpeg, image/png, image/webp). HEIC uploads must be converted client-side before upload.
  fileSize: number; // Required - File size in bytes (max 2MB)
}
```

### Response (200 OK)

```typescript
{
  uploadUrl: string; // Pre-signed S3 URL (expires in 1 hour)
  photoKey: string; // S3 object key for later reference
  expiresAt: string; // ISO 8601 timestamp when URL expires
}
```

### Endpoint 2: Record Photo Metadata

**POST /api/v1/visits/:visitId/photos**

### Authentication

- **Required:** Yes (JWT Bearer token)
- **Role:** Caregiver (or coordinator/admin)
- **Authorization:** Caregiver must own the visit

### Request Body

```typescript
{
  photoKey: string;              // Required - S3 object key from upload-url endpoint
  fileName: string;              // Required - Original file name
  fileSize: number;              // Required - File size in bytes
  mimeType: string;              // Required - MIME type
  thumbnailKey?: string;         // Optional - S3 key for thumbnail (320px width)
}
```

### Response (201 Created)

```typescript
{
  id: string; // UUID of photo record
  photoKey: string; // S3 object key
  photoUrl: string; // Full S3 URL
  thumbnailKey: string | null; // S3 key for thumbnail
  uploadedAt: string; // ISO 8601 timestamp
}
```

### Error Responses

| Status | Error                 | Description                                                |
| ------ | --------------------- | ---------------------------------------------------------- |
| 400    | Bad Request           | Missing required fields, invalid format, or file too large |
| 401    | Unauthorized          | Missing or invalid JWT token                               |
| 403    | Forbidden             | Not authorized to upload photos for this visit             |
| 404    | Not Found             | Visit does not exist                                       |
| 500    | Internal Server Error | Database or S3 error                                       |

---

## Request Examples

### Step 1: Generate Pre-Signed URL

```bash
curl -X POST http://localhost:3000/api/v1/visits/786bd901-f1bb-48e4-96d9-af0cd3ee84ba/photos/upload-url \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "fileName": "wound-photo.jpg",
    "mimeType": "image/jpeg",
    "fileSize": 1048576
  }'
```

**Response:**

```json
{
  "uploadUrl": "https://berthcare-photos-dev.s3.ca-central-1.amazonaws.com/visits/786bd901-f1bb-48e4-96d9-af0cd3ee84ba/photos/1760246409476-wound-photo.jpg?X-Amz-Algorithm=...",
  "photoKey": "visits/786bd901-f1bb-48e4-96d9-af0cd3ee84ba/photos/1760246409476-wound-photo.jpg",
  "expiresAt": "2025-10-12T06:20:09.476Z"
}
```

### Step 2: Upload Photo to S3

```bash
# Mobile app uploads directly to S3 using the pre-signed URL
curl -X PUT "https://berthcare-photos-dev.s3.ca-central-1.amazonaws.com/visits/..." \
  -H "Content-Type: image/jpeg" \
  --data-binary @wound-photo.jpg
```

### Step 3: Record Photo Metadata

```bash
curl -X POST http://localhost:3000/api/v1/visits/786bd901-f1bb-48e4-96d9-af0cd3ee84ba/photos \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "photoKey": "visits/786bd901-f1bb-48e4-96d9-af0cd3ee84ba/photos/1760246409476-wound-photo.jpg",
    "fileName": "wound-photo.jpg",
    "fileSize": 1048576,
    "mimeType": "image/jpeg"
  }'
```

**Response:**

```json
{
  "id": "3cf06086-95f4-49d0-b626-92a19c474c56",
  "photoKey": "visits/786bd901-f1bb-48e4-96d9-af0cd3ee84ba/photos/1760246409476-wound-photo.jpg",
  "photoUrl": "https://berthcare-photos-dev.s3.ca-central-1.amazonaws.com/visits/786bd901-f1bb-48e4-96d9-af0cd3ee84ba/photos/1760246409476-wound-photo.jpg",
  "thumbnailKey": null,
  "uploadedAt": "2025-10-12T05:20:09.575Z"
}
```

---

## Features Implemented

### 1. Pre-Signed URL Generation

**Functionality:**

- Generates secure, time-limited S3 upload URLs
- Validates file size (max 2MB after compression)
- Validates MIME type (JPEG, PNG, WebP)
- Sanitizes file names (removes special characters)
- Includes metadata in S3 object

**Benefits:**

- **Direct Upload**: Mobile app uploads directly to S3 (bypasses backend)
- **Performance**: Reduces backend load and network latency
- **Security**: Time-limited URLs (1 hour expiration)
- **Scalability**: S3 handles upload traffic, not backend

**Implementation:**

```typescript
const timestamp = Date.now();
const sanitizedFileName = fileName.replace(/[^a-zA-Z0-9.-]/g, '_');
const photoKey = `visits/${visitId}/photos/${timestamp}-${sanitizedFileName}`;

const metadata = {
  originalName: fileName,
  mimeType,
  size: fileSize,
  uploadedBy: userId,
  uploadedAt: new Date().toISOString(),
  visitId,
  clientId: visit.client_id,
};

const { url } = await generatePhotoUploadUrl(visitId, fileName, metadata);
```

### 2. Photo Metadata Recording

**Functionality:**

- Records photo metadata in database after successful upload
- Links photo to visit
- Stores S3 keys for full-size and thumbnail images
- Generates full S3 URLs for easy access
- Invalidates visit detail cache

**Database Operations:**

```sql
INSERT INTO visit_photos (
  visit_id, s3_key, s3_url, thumbnail_s3_key,
  file_name, file_size, mime_type, uploaded_at
) VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP)
RETURNING id, s3_key, s3_url, thumbnail_s3_key, uploaded_at;
```

### 3. File Size Validation

**Constraint:** Maximum 2MB per photo (after compression)

**Rationale:**

- **Mobile Performance**: Faster uploads on 3G/4G
- **Storage Costs**: Reduced S3 storage costs
- **User Experience**: Quick upload times
- **Compression**: Mobile app compresses before upload

**Implementation:**

```typescript
const maxSize = 2 * 1024 * 1024; // 2MB
if (fileSize > maxSize) {
  return res.status(400).json({
    error: 'Bad Request',
    message: 'File size exceeds maximum of 2MB. Please compress the image before upload.',
  });
}
```

**Expected Compression:**

- Original: 5-10MB (high-res phone camera)
- Compressed: 1-2MB (1920px width, 80% quality)
- Thumbnail: 50-100KB (320px width)

---

### 4. MIME Type Validation

**Supported Types:**

- `image/jpeg` - JPEG/JPG images
- `image/png` - PNG images
- `image/webp` - WebP images (modern format)
> ⚠️ HEIC images are not accepted by the API; iOS clients must convert to JPEG or PNG before requesting an upload URL.

**Implementation:**

```typescript
const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
if (!allowedTypes.includes(mimeType)) {
  return res.status(400).json({
    error: 'Bad Request',
    message: `Invalid MIME type. Allowed types: ${allowedTypes.join(', ')}`,
  });
}
```

**Why These Types:**

- **JPEG**: Universal support, good compression
- **PNG**: Lossless, good for screenshots
- **WebP**: Modern format, better compression than JPEG
- **HEIC (Not Supported)**: Requires client-side conversion because many browsers lack native support and server-side thumbnails depend on JPEG/WebP

### 5. File Name Sanitization

**Functionality:**

- Removes special characters from file names
- Prevents path traversal attacks
- Ensures S3 key compatibility
- Preserves file extension

**Implementation:**

```typescript
const sanitizedFileName = fileName.replace(/[^a-zA-Z0-9.-]/g, '_');
// "photo with spaces & special!chars.jpg"
// becomes "photo_with_spaces___special_chars.jpg"
```

**Security Benefits:**

- Prevents directory traversal (../)
- Prevents command injection
- Ensures valid S3 keys
- Maintains readability

### 6. Authorization & Security

**Authorization Checks:**

1. **Authentication**: JWT token required
2. **Visit Ownership**: Caregiver must own the visit
3. **Coordinator Override**: Coordinators/admins can upload to any visit
4. **Visit Existence**: Visit must exist

**Implementation:**

```typescript
// Get visit and verify ownership
const visit = await pool.query('SELECT id, staff_id, client_id, status FROM visits WHERE id = $1', [
  visitId,
]);

// Authorization check
if (userRole === 'caregiver' && visit.staff_id !== userId) {
  return res.status(403).json({
    error: 'Forbidden',
    message: 'You can only upload photos for your own visits',
  });
}
```

---

### 7. Cache Invalidation

**Functionality:**

- Invalidates visit detail cache after photo upload
- Ensures fresh data on subsequent requests
- Uses exact cache key matching

**Implementation:**

```typescript
const cacheKeyPattern = `visit:detail:${visitId}`;
await redisClient.del(cacheKeyPattern);
```

**Why This Matters:**

- Visit detail endpoint includes photo list
- Cache must be cleared to show new photos
- Prevents stale data in mobile app

### 8. Thumbnail Support

**Functionality:**

- Optional thumbnail key for 320px width images
- Stored separately from full-size image
- Used for list views and previews

**Expected Flow:**

1. Mobile app compresses image to 1920px width (full-size)
2. Mobile app generates thumbnail at 320px width
3. Mobile app uploads both to S3
4. Mobile app records both keys in database

**Benefits:**

- **Performance**: Fast loading in list views
- **Bandwidth**: Reduced data usage
- **UX**: Instant previews, progressive loading

---

## Testing

### Test Coverage

**29 integration tests covering:**

**Upload URL Generation (15 tests):**

- ✅ Generate pre-signed URL for valid request
- ✅ Accept PNG images
- ✅ Accept WebP images
- ✅ Reject HEIC images (requires client-side conversion)
- ✅ Allow coordinator to generate URL
- ✅ Sanitize file names with special characters
- ✅ Reject file size exceeding 2MB
- ✅ Reject invalid MIME type
- ✅ Reject missing fileName
- ✅ Reject missing mimeType
- ✅ Reject missing fileSize
- ✅ Reject invalid visitId format
- ✅ Reject unauthenticated requests
- ✅ Reject caregiver uploading to another's visit
- ✅ Return 404 for non-existent visit

**Photo Metadata Recording (14 tests):**

- ✅ Record photo metadata after upload
- ✅ Record photo with thumbnail key
- ✅ Allow coordinator to record photo
- ✅ Generate correct S3 URL
- ✅ Reject missing photoKey
- ✅ Reject missing fileName
- ✅ Reject missing fileSize
- ✅ Reject missing mimeType
- ✅ Reject photoKey with wrong visit ID
- ✅ Reject invalid visitId format
- ✅ Reject unauthenticated requests
- ✅ Reject caregiver adding to another's visit
- ✅ Return 404 for non-existent visit
- ✅ Invalidate visit cache after adding photo

---

### Running Tests

```bash
# Run photo upload tests
npm test -- apps/backend/tests/visits.photos.test.ts

# Run specific test
npm test -- apps/backend/tests/visits.photos.test.ts -t "should generate pre-signed URL"

# Run with coverage
npm run test:coverage
```

### Test Results

```
PASS  apps/backend/tests/visits.photos.test.ts
  Photo Upload Endpoints
    POST /v1/visits/:visitId/photos/upload-url
      Success Cases
        ✓ should generate pre-signed URL for valid photo upload request (47ms)
        ✓ should accept PNG images (14ms)
        ✓ should accept WebP images (10ms)
        ✓ should reject HEIC images (requires client-side conversion) (10ms)
        ✓ should allow coordinator to generate upload URL for any visit (5ms)
        ✓ should sanitize file names with special characters (6ms)
      Validation Errors
        ✓ should reject file size exceeding 2MB (4ms)
        ✓ should reject invalid MIME type (2ms)
        ✓ should reject missing fileName (9ms)
        ✓ should reject missing mimeType (3ms)
        ✓ should reject missing fileSize (2ms)
        ✓ should reject invalid visitId format (1ms)
      Authorization Errors
        ✓ should reject request without authentication (3ms)
        ✓ should reject caregiver uploading to another caregiver's visit (2ms)
        ✓ should return 404 for non-existent visit (3ms)
    POST /v1/visits/:visitId/photos
      Success Cases
        ✓ should record photo metadata after successful upload (8ms)
        ✓ should record photo with thumbnail key (3ms)
        ✓ should allow coordinator to record photo for any visit (4ms)
        ✓ should generate correct S3 URL (3ms)
      Validation Errors
        ✓ should reject missing photoKey (3ms)
        ✓ should reject missing fileName (1ms)
        ✓ should reject missing fileSize (1ms)
        ✓ should reject missing mimeType (1ms)
        ✓ should reject photoKey with wrong visit ID (1ms)
        ✓ should reject invalid visitId format (1ms)
      Authorization Errors
        ✓ should reject request without authentication (1ms)
        ✓ should reject caregiver adding photo to another caregiver's visit (3ms)
        ✓ should return 404 for non-existent visit (3ms)
      Cache Invalidation
        ✓ should invalidate visit cache after adding photo (140ms)

Test Suites: 1 passed, 1 total
Tests:       29 passed, 29 total
```

---

## Implementation Details

### File Structure

```
apps/backend/src/
  ├── routes/
  │   └── visits.routes.ts          # Photo upload endpoints
  ├── storage/
  │   ├── s3-client.ts              # S3 client and pre-signed URL generation
  │   └── photo-storage.ts          # Photo storage helper functions

apps/backend/tests/
  └── visits.photos.test.ts         # Integration tests
```

### Code Organization

**visits.routes.ts:**

- `POST /:visitId/photos/upload-url` - Generate pre-signed URL
- `POST /:visitId/photos` - Record photo metadata
- Request/response interfaces
- Validation logic
- Authorization checks
- Cache invalidation

**s3-client.ts:**

- `generatePhotoUploadUrl()` - Generate pre-signed URL with metadata
- `S3_BUCKETS` - Bucket name constants
- `FILE_CONFIGS` - File type configurations
- S3 client initialization

**photo-storage.ts:**

- `requestPhotoUpload()` - High-level photo upload request
- `getPhotoDownloadUrl()` - Generate download URLs
- `validatePhotoMetadata()` - Metadata validation

### Key Functions

```typescript
// Generate pre-signed URL
async function generatePhotoUploadUrl(
  visitId: string,
  fileName: string,
  metadata: Partial<PhotoMetadata>
): Promise<{ url: string; key: string }>;

// Record photo metadata
async function recordPhotoMetadata(
  visitId: string,
  photoKey: string,
  metadata: PhotoMetadata
): Promise<PhotoRecord>;
```

---

## Design Decisions

### 1. Pre-Signed URLs vs Direct Upload

**Decision:** Use S3 pre-signed URLs for direct uploads

**Rationale:**

- **Performance**: Eliminates backend as bottleneck
- **Scalability**: S3 handles upload traffic
- **Cost**: Reduces backend compute costs
- **Reliability**: S3's 99.99% availability
- **Bandwidth**: Reduces backend bandwidth usage

**Trade-offs:**

- Pros: Better performance, lower costs, more scalable
- Cons: Two-step process, requires S3 configuration

**Alternative Considered:**

- Upload through backend (multipart/form-data)
- Rejected: Backend becomes bottleneck, higher costs

### 2. Two-Step Upload Process

**Decision:** Separate URL generation and metadata recording

**Rationale:**

- **Flexibility**: Mobile app controls upload timing
- **Retry Logic**: Can retry upload without new URL
- **Offline Support**: Generate URL online, upload later
- **Error Handling**: Clear separation of concerns

**Flow:**

```
1. Mobile app requests pre-signed URL
2. Backend validates and generates URL
3. Mobile app uploads directly to S3
4. Mobile app records metadata in database
```

**Benefits:**

- Mobile app can compress image before requesting URL
- Upload can be retried without backend involvement
- Metadata only recorded after successful upload

### 3. 2MB File Size Limit

**Decision:** Maximum 2MB per photo after compression

**Rationale:**

- **Mobile Performance**: Fast uploads on 3G/4G (5-10 seconds)
- **Storage Costs**: $0.023/GB/month in S3 (ca-central-1)
- **User Experience**: Quick upload, no waiting
- **Quality**: 1920px width at 80% quality is sufficient

**Compression Strategy:**

- Original: 5-10MB (4000x3000px, 100% quality)
- Compressed: 1-2MB (1920px width, 80% quality)
- Thumbnail: 50-100KB (320px width, 70% quality)

**Cost Analysis:**

- 1000 photos/month at 2MB = 2GB storage
- S3 cost: $0.046/month
- Transfer cost: $0.09/GB = $0.18/month
- Total: ~$0.23/month for 1000 photos

---

### 4. File Name Sanitization

**Decision:** Replace special characters with underscores

**Rationale:**

- **Security**: Prevents path traversal attacks
- **Compatibility**: Ensures valid S3 keys
- **Readability**: Maintains human-readable names
- **Simplicity**: Simple regex replacement

**Implementation:**

```typescript
fileName.replace(/[^a-zA-Z0-9.-]/g, '_');
```

**Examples:**

- `photo with spaces.jpg` → `photo_with_spaces.jpg`
- `wound-photo!@#.jpg` → `wound-photo___.jpg`
- `../../../etc/passwd` → `____________etc_passwd`

### 5. Timestamp-Based Keys

**Decision:** Include timestamp in S3 keys

**Rationale:**

- **Uniqueness**: Prevents key collisions
- **Ordering**: Natural chronological ordering
- **Debugging**: Easy to identify when photo was uploaded
- **Immutability**: Photos never overwrite each other

**Key Format:**

```
visits/{visitId}/photos/{timestamp}-{sanitizedFileName}
```

**Example:**

```
visits/786bd901-f1bb-48e4-96d9-af0cd3ee84ba/photos/1760246409476-wound-photo.jpg
```

### 6. Metadata in S3 Objects

**Decision:** Store metadata in S3 object metadata

**Rationale:**

- **Traceability**: Know who uploaded, when, and why
- **Debugging**: Easier troubleshooting
- **Compliance**: Audit trail for regulatory requirements
- **Recovery**: Can reconstruct database from S3 if needed

**Metadata Stored:**

```typescript
{
  originalName: string;
  mimeType: string;
  size: string;
  uploadedBy: string;
  uploadedAt: string;
  visitId: string;
  clientId: string;
}
```

---

## Performance Considerations

### Upload Performance

**Expected Upload Times (2MB photo):**

- 4G LTE (20 Mbps): ~1 second
- 3G (2 Mbps): ~8 seconds
- WiFi (50 Mbps): <1 second

**Optimization Strategies:**

- Direct S3 upload (no backend bottleneck)
- Compression before upload (1920px width)
- Progressive upload (show progress bar)
- Background upload (continue using app)

### Database Performance

**Query Count per Request:**

**Upload URL Generation:**

- 1 query: Get visit and verify ownership
- Total: 1 query (~10ms)

**Metadata Recording:**

- 1 query: Get visit and verify ownership
- 1 query: Insert photo metadata
- Total: 2 queries (~20ms)

**Indexes Used:**

- `idx_visits_id` (primary key) - Visit lookup
- `idx_visit_photos_visit_id` - Photo listing
- `unique_s3_key` - Duplicate prevention

### Caching Strategy

**Cache Invalidation:**

- Visit detail cache cleared after photo upload
- Ensures fresh photo list on next request
- Uses exact key matching for efficiency

**Not Cached:**

- Photo upload operations (write operations)
- Pre-signed URLs (time-sensitive, unique)

---

## Security Considerations

### Input Validation

- ✅ File size validation (max 2MB)
- ✅ MIME type validation (whitelist)
- ✅ File name sanitization
- ✅ UUID format validation
- ✅ PhotoKey format validation

### Authentication & Authorization

- ✅ JWT token required
- ✅ Visit ownership verification
- ✅ Coordinator override support
- ✅ Visit existence check

### S3 Security

- ✅ Pre-signed URLs (time-limited, 1 hour)
- ✅ Bucket policies (private by default)
- ✅ IAM roles (least privilege)
- ✅ Encryption at rest (S3 default)
- ✅ Encryption in transit (HTTPS only)

### Data Privacy

- ✅ Photos linked to visits (not publicly accessible)
- ✅ Zone-based access control (via visit ownership)
- ✅ Audit trail (uploaded_by, uploaded_at)
- ✅ Metadata stored in S3 (traceability)

---

## Error Scenarios

### 400 Bad Request

**Causes:**

- File size exceeds 2MB
- Invalid MIME type
- Missing required fields
- Invalid UUID format
- PhotoKey doesn't match visitId

**Examples:**

```json
{
  "error": "Bad Request",
  "message": "File size exceeds maximum of 2MB. Please compress the image before upload."
}
```

```json
{
  "error": "Bad Request",
  "message": "Invalid MIME type. Allowed types: image/jpeg, image/png, image/webp"
}
```

### 401 Unauthorized

**Causes:**

- Missing Authorization header
- Invalid JWT token
- Expired JWT token

**Example:**

```json
{
  "error": {
    "code": "MISSING_TOKEN",
    "message": "Authorization header is required",
    "requestId": "unknown",
    "timestamp": "2025-10-12T05:20:09.568Z"
  }
}
```

### 403 Forbidden

**Causes:**

- Caregiver uploading to another caregiver's visit
- User not authorized for this visit

**Example:**

```json
{
  "error": "Forbidden",
  "message": "You can only upload photos for your own visits"
}
```

### 404 Not Found

**Causes:**

- Visit does not exist
- Visit has been deleted

**Example:**

```json
{
  "error": "Not Found",
  "message": "Visit not found"
}
```

### 500 Internal Server Error

**Causes:**

- S3 connection error
- Database connection error
- Unexpected server error

**Example:**

```json
{
  "error": "Internal Server Error",
  "message": "Failed to generate upload URL"
}
```

---

## Mobile App Integration

### Upload Flow

```typescript
// Step 1: Compress image
const compressedImage = await compressImage(originalImage, {
  maxWidth: 1920,
  quality: 0.8,
  format: 'jpeg',
});

const thumbnail = await compressImage(originalImage, {
  maxWidth: 320,
  quality: 0.7,
  format: 'jpeg',
});

// Step 2: Request pre-signed URLs
const fullSizeResponse = await fetch(`/api/v1/visits/${visitId}/photos/upload-url`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    fileName: 'wound-photo.jpg',
    mimeType: 'image/jpeg',
    fileSize: compressedImage.size,
  }),
});

const { uploadUrl, photoKey } = await fullSizeResponse.json();

// Step 3: Upload to S3
await fetch(uploadUrl, {
  method: 'PUT',
  headers: {
    'Content-Type': 'image/jpeg',
  },
  body: compressedImage.blob,
});

// Step 4: Record metadata
await fetch(`/api/v1/visits/${visitId}/photos`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    photoKey,
    fileName: 'wound-photo.jpg',
    fileSize: compressedImage.size,
    mimeType: 'image/jpeg',
    thumbnailKey: thumbnailKey, // if thumbnail uploaded
  }),
});
```

### Error Handling

```typescript
try {
  // Upload flow
} catch (error) {
  if (error.status === 400) {
    // File too large or invalid format
    showError('Please compress the image and try again');
  } else if (error.status === 403) {
    // Not authorized
    showError('You are not authorized to upload photos for this visit');
  } else if (error.status === 404) {
    // Visit not found
    showError('Visit not found. Please refresh and try again');
  } else {
    // Generic error
    showError('Failed to upload photo. Please try again');
  }
}
```

---

## Future Enhancements

### 1. Image Compression Service

**Current:** Mobile app compresses images
**Future:** Backend service for server-side compression

**Benefits:**

- Consistent compression quality
- Optional format conversion for unsupported uploads (e.g., HEIC → JPEG)
- Automatic thumbnail generation
- Reduced mobile app complexity

**Implementation:**

- Lambda function triggered on S3 upload
- Sharp library for image processing
- Automatic thumbnail generation (320px)
- Store compressed version alongside original

### 2. Photo Download Endpoints

**Endpoint:** GET /api/v1/visits/:visitId/photos/:photoId

**Functionality:**

- Generate pre-signed download URLs
- Support for full-size and thumbnail
- Time-limited URLs (1 hour)
- Access control (same as upload)

### 3. Photo Deletion

**Endpoint:** DELETE /api/v1/visits/:visitId/photos/:photoId

**Functionality:**

- Soft delete (mark as deleted)
- Hard delete after 30 days
- Delete from S3 and database
- Audit trail

### 4. Bulk Photo Upload

**Endpoint:** POST /api/v1/visits/:visitId/photos/bulk

**Functionality:**

- Upload multiple photos at once
- Generate multiple pre-signed URLs
- Batch metadata recording
- Progress tracking

### 5. Photo Metadata Search

**Endpoint:** GET /api/v1/photos/search

**Functionality:**

- Search by client, date range, caregiver
- Filter by file size, MIME type
- Pagination support
- Export to CSV

---

## Related Documentation

- [V1: Visits Migration](./V1-visits-migration.md)
- [V3: Visit Photos Migration](./V3-visit-photos-migration.md)
- [V7: Visit Detail Endpoint](./V7-visit-detail-endpoint.md)
- [B4: S3 Storage Setup](./B4-s3-storage-setup.md)
- [Architecture Blueprint](../project-documentation/architecture-output.md)
- [Task Plan](../project-documentation/task-plan.md)

---

## Implementation Files

- **Routes:** `apps/backend/src/routes/visits.routes.ts`
- **S3 Client:** `apps/backend/src/storage/s3-client.ts`
- **Photo Storage:** `apps/backend/src/storage/photo-storage.ts`
- **Tests:** `apps/backend/tests/visits.photos.test.ts`
- **Migration:** `apps/backend/src/db/migrations/006_create_visit_photos.sql`

---

## Success Criteria

- ✅ Pre-signed URL generation endpoint implemented
- ✅ Photo metadata recording endpoint implemented
- ✅ File size validation (max 2MB)
- ✅ MIME type validation (JPEG, PNG, WebP)
- ✅ File name sanitization
- ✅ Authorization checks (visit ownership)
- ✅ Coordinator override support
- ✅ Thumbnail support
- ✅ Cache invalidation
- ✅ S3 metadata storage
- ✅ 29 integration tests (all passing)
- ✅ Comprehensive error handling
- ✅ Logging and monitoring
- ✅ Documentation complete

---

## Logging

### Success Logging

**Upload URL Generation:**

```typescript
logInfo('Photo upload URL generated', {
  visitId,
  photoKey,
  userId,
  fileName,
  fileSize,
});
```

**Metadata Recording:**

```typescript
logInfo('Photo metadata recorded', {
  visitId,
  photoId: photo.id,
  photoKey,
  userId,
  fileSize,
});
```

### Error Logging

```typescript
logError('Error generating photo upload URL', error as Error, {
  visitId,
  userId,
  fileName,
});

logError('Error recording photo metadata', error as Error, {
  visitId,
  userId,
  photoKey,
});
```

---

**Status:** ✅ Complete  
**Next Task:** Mobile app photo upload implementation
