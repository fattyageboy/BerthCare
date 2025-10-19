## S3 Storage Module

This module provides AWS S3 integration for file storage with support for photos, documents, and signatures.

## Philosophy

> "Simplicity is the ultimate sophistication"

We use pre-signed URLs to allow mobile apps to upload files directly to S3, bypassing the backend server. This approach:

- Reduces backend load
- Improves upload performance
- Simplifies architecture
- Maintains security through time-limited URLs

## Features

### ✅ Pre-signed URL Generation

- Upload URLs with configurable expiration
- Download URLs for secure file access
- Automatic metadata attachment

### ✅ Photo Storage

- Compression metadata tracking
- Visit-based organization
- Batch operations support
- Size and type validation

### ✅ Document Storage

- PDF and image support
- Document type categorization
- Metadata tracking

### ✅ Signature Storage

- PNG signature images
- Visit association
- Signature type tracking

### ✅ LocalStack Support

- Local S3 emulation for development
- Seamless production deployment
- No code changes required

## Quick Start

### 1. Generate Upload URL

```typescript
import { generatePhotoUploadUrl } from './storage/photo-storage';

// Request photo upload
const { uploadUrl, photoKey } = await requestPhotoUpload({
  visitId: 'visit-123',
  fileName: 'photo.jpg',
  mimeType: 'image/jpeg',
  size: 1024000,
  width: 1920,
  height: 1080,
  compressed: true,
  compressionQuality: 85,
  uploadedBy: 'user-456',
  clientId: 'client-789',
});

// Mobile app uploads directly to S3 using uploadUrl
// PUT request to uploadUrl with photo data
```

### 2. Generate Download URL

```typescript
import { getPhotoDownloadUrl } from './storage/photo-storage';

// Get photo download URL
const photoInfo = await getPhotoDownloadUrl(photoKey);

// Mobile app downloads from photoInfo.downloadUrl
// GET request to downloadUrl
```

### 3. Delete Photo

```typescript
import { deletePhoto } from './storage/photo-storage';

// Delete photo
await deletePhoto(photoKey);
```

## S3 Buckets

### Development (LocalStack)

- `berthcare-photos-dev` - Visit photos
- `berthcare-documents-dev` - Care plans, assessments
- `berthcare-signatures-dev` - Digital signatures

### Production (AWS S3)

- `berthcare-photos-prod` - Visit photos
- `berthcare-documents-prod` - Care plans, assessments
- `berthcare-signatures-prod` - Digital signatures

## File Organization

### Photos

```text
visits/{visitId}/photos/{timestamp}-{filename}
```

Example:

```text
visits/visit-123/photos/1696789012345-photo.jpg
visits/visit-123/photos/1696789023456-photo2.jpg
```

### Documents

```text
documents/{documentType}/{timestamp}-{filename}
```

Example:

```text
documents/care-plan/1696789012345-care-plan.pdf
documents/assessment/1696789023456-assessment.pdf
```

### Signatures

```text
visits/{visitId}/signatures/{signatureType}-{timestamp}.png
```

Example:

```text
visits/visit-123/signatures/caregiver-1696789012345.png
visits/visit-123/signatures/client-1696789023456.png
visits/visit-123/signatures/family-1696789034567.png
```

## Metadata

### Photo Metadata

```typescript
{
  originalName: string;      // Original filename
  mimeType: string;          // MIME type (image/jpeg, etc.)
  size: number;              // File size in bytes
  width?: number;            // Image width in pixels
  height?: number;           // Image height in pixels
  compressed?: boolean;      // Whether image was compressed
  compressionQuality?: number; // Compression quality (0-100)
  uploadedBy: string;        // User ID who uploaded
  uploadedAt: string;        // ISO timestamp
  visitId?: string;          // Associated visit ID
  clientId?: string;         // Associated client ID
}
```

## Lifecycle Policies

### Photos

- **Retention**: 7 years (regulatory requirement)
- **Transition to Glacier**: After 1 year
- **Deletion**: After 7 years

### Documents

- **Retention**: 7 years (regulatory requirement)
- **Transition to Glacier**: After 1 year
- **Deletion**: After 7 years

### Signatures

- **Retention**: 7 years (regulatory requirement)
- **Transition to Glacier**: After 1 year
- **Deletion**: After 7 years

### Lifecycle Policy Configuration (Terraform)

```hcl
# See: terraform/modules/storage/main.tf

resource "aws_s3_bucket_lifecycle_configuration" "photos" {
  bucket = aws_s3_bucket.photos.id

  rule {
    id     = "archive-old-photos"
    status = "Enabled"

    # Transition to Glacier after 1 year
    transition {
      days          = 365
      storage_class = "GLACIER"
    }

    # Delete after 7 years
    expiration {
      days = 2555  # 7 years
    }
  }
}
```

## Security

### Pre-signed URLs

- Time-limited (default: 1 hour)
- Specific to one operation (upload or download)
- Includes content type validation
- No AWS credentials exposed

### Access Control

- Bucket policies restrict access
- IAM roles for backend service
- No public access
- Encryption at rest (AES-256)
- Encryption in transit (TLS)

### Validation

- File size limits enforced
- MIME type validation
- Metadata validation
- Virus scanning (production)

## Environment Variables

```bash
# AWS Configuration
AWS_REGION=ca-central-1
AWS_ACCESS_KEY_ID=your-access-key
AWS_SECRET_ACCESS_KEY=your-secret-key

# LocalStack (Development)
AWS_ENDPOINT=http://localhost:4566

# S3 Buckets
S3_BUCKET_PHOTOS=berthcare-photos-dev
S3_BUCKET_DOCUMENTS=berthcare-documents-dev
S3_BUCKET_SIGNATURES=berthcare-signatures-dev

# S3 Configuration
S3_FORCE_PATH_STYLE=true  # Required for LocalStack
S3_SIGNATURE_VERSION=v4
```

## Testing

### Test S3 Connection

```bash
# Start LocalStack
docker-compose up -d localstack

# Test connection
npm run test:connection --prefix apps/backend
```

### Upload Test File

```bash
# Generate upload URL
curl -X POST http://localhost:3000/api/v1/photos/upload \
  -H "Content-Type: application/json" \
  -d '{
    "visitId": "test-visit",
    "fileName": "test.jpg",
    "mimeType": "image/jpeg",
    "size": 1024000,
    "uploadedBy": "test-user"
  }'

# Upload file using pre-signed URL
curl -X PUT "<upload-url>" \
  -H "Content-Type: image/jpeg" \
  --data-binary @test.jpg
```

### Verify Upload

```bash
# List files in bucket
aws --endpoint-url=http://localhost:4566 s3 ls s3://berthcare-photos-dev/visits/test-visit/photos/

# Download file
aws --endpoint-url=http://localhost:4566 s3 cp s3://berthcare-photos-dev/visits/test-visit/photos/test.jpg ./downloaded.jpg
```

## Error Handling

### Common Errors

### Upload URL Expired

```text
Error: Pre-signed URL has expired
Solution: Generate new upload URL
```

### File Too Large

```text
Error: Photo size exceeds maximum allowed size
Solution: Compress photo before upload
```

### Invalid MIME Type

```text
Error: Invalid MIME type: image/bmp
Solution: Convert to supported format (JPEG, PNG, WebP). HEIC uploads must be converted before requesting an upload URL.
```

### Bucket Not Found

```text
Error: The specified bucket does not exist
Solution: Check bucket name and AWS configuration
```

## Performance

### Upload Performance

- Direct S3 upload: ~1-5 seconds (depending on file size and network)
- Pre-signed URL generation: <100ms
- No backend bottleneck

### Download Performance

- Direct S3 download: ~1-5 seconds
- Pre-signed URL generation: <100ms
- CloudFront CDN for faster delivery (production)

### Optimization

- Use CloudFront CDN for downloads
- Compress images before upload
- Use WebP format for better compression
- Implement progressive JPEG for faster loading

## Monitoring

### Metrics to Track

- Upload success rate
- Download success rate
- Pre-signed URL generation time
- S3 API errors
- Storage usage per bucket
- Cost per bucket

### CloudWatch Metrics

- `S3.PutObject` - Upload operations
- `S3.GetObject` - Download operations
- `S3.DeleteObject` - Delete operations
- `S3.BucketSize` - Storage usage
- `S3.NumberOfObjects` - Object count

## Future Enhancements

- [ ] Image thumbnail generation
- [ ] Automatic image optimization
- [ ] Virus scanning integration
- [ ] CDN integration for faster downloads
- [ ] Batch upload support
- [ ] Progress tracking for large files
- [ ] Automatic backup to secondary region
- [ ] Image recognition for automatic tagging

## References

- Architecture Blueprint: `project-documentation/architecture-output.md`
- Task Plan: `project-documentation/task-plan.md` (B4)
- AWS S3 Documentation: https://docs.aws.amazon.com/s3/
- LocalStack Documentation: https://docs.localstack.cloud/
- Terraform Storage Module: `terraform/modules/storage/`

## Notes

- All files are stored in Canadian region (ca-central-1) for data residency
- Lifecycle policies ensure regulatory compliance (7-year retention)
- Pre-signed URLs provide secure, scalable file uploads
- LocalStack enables local development without AWS costs
- Metadata tracking enables audit trails and compliance
