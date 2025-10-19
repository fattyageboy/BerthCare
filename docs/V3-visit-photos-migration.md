# V3: Visit Photos Table Migration

**Task ID:** V3  
**Status:** ✅ Complete  
**Date:** October 11, 2025  
**Migration:** 006_create_visit_photos.sql  
**Estimated Effort:** 0.25 days  
**Actual Effort:** 0.25 days

---

## Overview

Created the `visit_photos` table to store metadata for photos uploaded during visits. The actual photo files are stored in Amazon S3, while this table maintains references, thumbnails, and metadata for efficient querying and display.

---

## Database Schema

### Table: visit_photos

```sql
CREATE TABLE visit_photos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  visit_id UUID NOT NULL REFERENCES visits(id) ON DELETE CASCADE,
  s3_key TEXT NOT NULL,
  s3_url TEXT NOT NULL,
  thumbnail_s3_key TEXT,
  file_name VARCHAR(255),
  file_size INTEGER CHECK (file_size > 0),
  mime_type VARCHAR(100) NOT NULL,
  uploaded_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT unique_s3_key UNIQUE (s3_key)
);
```

### Field Descriptions

| Field              | Type         | Nullable | Description                         |
| ------------------ | ------------ | -------- | ----------------------------------- |
| `id`               | UUID         | NOT NULL | Unique photo identifier             |
| `visit_id`         | UUID         | NOT NULL | Reference to visit (foreign key)    |
| `s3_key`           | TEXT         | NOT NULL | S3 object key for full-size photo   |
| `s3_url`           | TEXT         | NOT NULL | Full S3 URL for accessing photo     |
| `thumbnail_s3_key` | TEXT         | NULL     | S3 object key for thumbnail (320px) |
| `file_name`        | VARCHAR(255) | NULL     | Original filename from upload       |
| `file_size`        | INTEGER      | NULL     | File size in bytes                  |
| `mime_type`        | VARCHAR(100) | NOT NULL | MIME type (e.g., image/jpeg)        |
| `uploaded_at`      | TIMESTAMP    | NOT NULL | Upload timestamp                    |

---

## S3 Storage Pattern

### Full-Size Photos

**S3 Key Format:** `visits/{visitId}/photos/{timestamp}-{sanitizedFileName}.jpg`

**Example:**

```text
s3_key: visits/3edaf4f8-2120-4011-a59f-f6d8a47c622f/photos/1728662400000-client_photo.jpg
s3_url: https://s3.amazonaws.com/berthcare-photos/visits/3edaf4f8-2120-4011-a59f-f6d8a47c622f/photos/1728662400000-client_photo.jpg
```

**Specifications:**

- Max size: 2MB (compressed)
- Max width: 1920px
- Format: JPEG (optimized for photos)
- Quality: 85%

### Thumbnails

**S3 Key Format:** `visits/{visitId}/photos/{timestamp}-{sanitizedFileName}_thumb.jpg`

**Example:**

```text
thumbnail_s3_key: visits/3edaf4f8-2120-4011-a59f-f6d8a47c622f/photos/1728662400000-client_photo_thumb.jpg
```

**Specifications:**

- Max width: 320px
- Format: JPEG
- Quality: 80%
- Purpose: Fast loading in lists and previews

---

## Indexes

Three indexes were created to optimize query patterns:

### 1. idx_visit_photos_visit_id (B-tree)

```sql
CREATE INDEX idx_visit_photos_visit_id ON visit_photos(visit_id);
```

**Purpose:** Fast lookup of all photos for a visit  
**Query Pattern:** "Get all photos for this visit"  
**Performance:** O(log n) lookup time

### 2. idx_visit_photos_uploaded_at (B-tree DESC)

```sql
CREATE INDEX idx_visit_photos_uploaded_at ON visit_photos(uploaded_at DESC);
```

**Purpose:** Chronological queries (newest first)  
**Query Patterns:**

- "Get recently uploaded photos"
- "Photos uploaded in date range"
- "Latest photos across all visits"

### 3. idx_visit_photos_visit_uploaded (Composite B-tree)

```sql
CREATE INDEX idx_visit_photos_visit_uploaded ON visit_photos(visit_id, uploaded_at DESC);
```

**Purpose:** Optimized for visit-specific chronological queries  
**Query Pattern:** "Get photos for this visit, newest first"  
**Performance:** Single index scan (no table lookup needed)

---

## Constraints

### Foreign Key Constraint

**visit_photos_visit_id_fkey**

```sql
FOREIGN KEY (visit_id) REFERENCES visits(id) ON DELETE CASCADE
```

**Behavior:**

- **ON DELETE CASCADE**: When a visit is deleted, all associated photos are automatically deleted
- **Rationale**: Photos have no meaning without their visit
- **S3 Cleanup**: Application must also delete S3 objects when photos are deleted

### Unique Constraint

**unique_s3_key**

```sql
CONSTRAINT unique_s3_key UNIQUE (s3_key)
```

**Purpose:**

- Prevents duplicate S3 keys in database
- Ensures one-to-one mapping between database record and S3 object
- Prevents accidental overwrites

### Check Constraint

**visit_photos_file_size_check**

```sql
CHECK (file_size > 0)
```

**Purpose:**

- Ensures file_size is positive if provided
- Prevents invalid metadata
- Helps identify upload issues

---

## Migration Execution

### Running the Migration

```bash
cd apps/backend
npm run migrate:up -- 006
```

### Verification

```bash
# Check table structure
docker exec berthcare-postgres psql -U berthcare -d berthcare_dev -c "\d visit_photos"

# Check indexes
docker exec berthcare-postgres psql -U berthcare -d berthcare_dev -c "
  SELECT indexname, indexdef
  FROM pg_indexes
  WHERE tablename = 'visit_photos'
  ORDER BY indexname;
"

# Check constraints
docker exec berthcare-postgres psql -U berthcare -d berthcare_dev -c "
  SELECT conname, pg_get_constraintdef(oid)
  FROM pg_constraint
  WHERE conrelid = 'visit_photos'::regclass;
"
```

### Rollback

If needed, rollback the migration:

```bash
npm run migrate:down -- 006
```

---

## Design Decisions

### 1. Metadata in Database, Files in S3

**Decision:** Store only metadata in PostgreSQL, actual files in S3

**Rationale:**

- **Scalability**: Database doesn't grow with photo storage
- **Performance**: Database queries remain fast
- **Cost**: S3 is cheaper for large file storage
- **CDN**: S3 integrates with CloudFront for global delivery

**Trade-offs:**

- Pros: Scalable, performant, cost-effective
- Cons: Two systems to manage, eventual consistency possible

### 2. CASCADE Delete

**Decision:** Use ON DELETE CASCADE for visit_id foreign key

**Rationale:**

- Photos are meaningless without their visit
- Simplifies data cleanup
- Prevents orphaned records
- Maintains referential integrity

**Important:** Application must also delete S3 objects when CASCADE delete occurs

### 3. Separate Thumbnail Storage

**Decision:** Store thumbnail S3 key separately

**Rationale:**

- **Performance**: Load thumbnails in lists without full images
- **Bandwidth**: Save mobile data with smaller thumbnails
- **UX**: Faster page loads and scrolling
- **Flexibility**: Can regenerate thumbnails independently

**Example Use Case:**

```sql
-- Get thumbnails for visit list (fast)
SELECT id, visit_id, thumbnail_s3_key, uploaded_at
FROM visit_photos
WHERE visit_id IN (SELECT id FROM visits WHERE staff_id = ?);

-- Get full image when user clicks (on-demand)
SELECT s3_url FROM visit_photos WHERE id = ?;
```

### 4. UNIQUE Constraint on s3_key

**Decision:** Enforce uniqueness of S3 keys

**Rationale:**

- **Data Integrity**: One database record per S3 object
- **Prevent Overwrites**: Catch duplicate uploads early
- **Debugging**: Easier to track down issues
- **Consistency**: Ensures database matches S3 state

**Handling Duplicates:**

```sql
-- This will fail if s3_key already exists
INSERT INTO visit_photos (visit_id, s3_key, s3_url, ...)
VALUES (?, ?, ?, ...);

-- Application should catch unique violation and handle appropriately
```

### 5. TEXT Type for S3 Keys and URLs

**Decision:** Use TEXT instead of VARCHAR for s3_key, s3_url, and thumbnail_s3_key

**Rationale:**

- **Pre-signed URLs**: Can exceed 1000 characters with query parameters
- **S3 Key Length**: AWS allows up to 1024 characters for object keys
- **CloudFront URLs**: Can be very long with custom domains and parameters
- **Future-proof**: No risk of truncation or insert failures
- **Performance**: TEXT has no length overhead in PostgreSQL (same as VARCHAR)

**Example Long URL:**

```text
https://berthcare-photos.s3.amazonaws.com/visits/3edaf4f8-2120-4011-a59f-f6d8a47c622f/84c8ca84-3cb4-4d3a-8d3f-86d9ac468ae8.jpg?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=AKIAIOSFODNN7EXAMPLE%2F20251011%2Fus-east-1%2Fs3%2Faws4_request&X-Amz-Date=20251011T170500Z&X-Amz-Expires=3600&X-Amz-SignedHeaders=host&X-Amz-Signature=...
```

(This can easily exceed 500-1000 characters)

### 6. Optional Metadata Fields

**Decision:** Make file_name, file_size, mime_type optional (NULL)

**Rationale:**

- **Flexibility**: Can insert record before metadata is available
- **Backwards Compatibility**: Existing records without metadata still valid
- **Graceful Degradation**: Missing metadata doesn't break functionality

**Best Practice:** Always populate these fields when available

---

## Performance Considerations

### Query Patterns

1. **Get Photos for Visit** (most common)
   - Query: `SELECT * FROM visit_photos WHERE visit_id = ? ORDER BY uploaded_at DESC`
   - Index: `idx_visit_photos_visit_uploaded` (composite)
   - Expected: <10ms response time

2. **Get Recent Photos Across All Visits**
   - Query: `SELECT * FROM visit_photos ORDER BY uploaded_at DESC LIMIT 50`
   - Index: `idx_visit_photos_uploaded_at`
   - Expected: <20ms response time

3. **Count Photos for Visit**
   - Query: `SELECT COUNT(*) FROM visit_photos WHERE visit_id = ?`
   - Index: `idx_visit_photos_visit_id`
   - Expected: <5ms response time

### Storage Estimates

**Database:**

- Average row size: ~150 bytes
- 10 photos per visit average
- 1,000 visits/day = 10,000 photos/day = 1.5 MB/day
- 1 year = 548 MB
- 10 years = 5.48 GB (very manageable)

**S3:**

- Full-size photo: ~500 KB average
- Thumbnail: ~30 KB average
- 10,000 photos/day = 5.3 GB/day
- 1 year = 1.94 TB
- 10 years = 19.4 TB

**Cost Optimization:**

- Use S3 Intelligent-Tiering for automatic cost optimization
- Move old photos to Glacier after 1 year
- Delete thumbnails after 2 years (regenerate on-demand if needed)

---

## Security Considerations

### Access Control

- Photos contain PHI (Protected Health Information)
- Must use pre-signed URLs for access (not public URLs)
- Pre-signed URLs expire after 1 hour
- Access controlled via application-level authorization

### S3 Bucket Configuration

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Deny",
      "Principal": "*",
      "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::berthcare-photos/*",
      "Condition": {
        "Bool": {
          "aws:SecureTransport": "false"
        }
      }
    }
  ]
}
```

**Requirements:**

- Bucket is private (no public access)
- Encryption at rest (AES-256)
- Encryption in transit (HTTPS only)
- Versioning enabled for recovery
- Lifecycle policies for cost optimization

### Pre-Signed URL Generation

```typescript
// Example: Generate pre-signed URL for photo access
const s3Client = new S3Client({ region: 'us-east-1' });
const command = new GetObjectCommand({
  Bucket: 'berthcare-photos',
  Key: photo.s3_key,
});
const url = await getSignedUrl(s3Client, command, { expiresIn: 3600 });
```

---

## Photo Upload Workflow

### 1. Request Upload URL

```http
POST /v1/visits/:visitId/photos/upload-url
Authorization: Bearer {token}
Content-Type: application/json

{
  "file_name": "client_photo.jpg",
  "file_size": 524288,
  "mime_type": "image/jpeg"
}
```

**Response:**

```json
{
  "photo_id": "84c8ca84-3cb4-4d3a-8d3f-86d9ac468ae8",
  "upload_url": "https://s3.amazonaws.com/...",
  "s3_key": "visits/.../photo.jpg",
  "expires_at": "2025-10-11T18:00:00Z"
}
```

### 2. Upload to S3

```http
PUT {upload_url}
Content-Type: image/jpeg
Content-Length: 524288

{binary photo data}
```

### 3. Confirm Upload

```http
POST /v1/visits/:visitId/photos
Authorization: Bearer {token}
Content-Type: application/json

{
  "photo_id": "84c8ca84-3cb4-4d3f-86d9ac468ae8",
  "s3_key": "visits/.../photo.jpg"
}
```

**Response:**

```json
{
  "id": "84c8ca84-3cb4-4d3a-8d3f-86d9ac468ae8",
  "visit_id": "3edaf4f8-2120-4011-a59f-f6d8a47c622f",
  "s3_url": "https://s3.amazonaws.com/...",
  "thumbnail_url": "https://s3.amazonaws.com/.../thumb.jpg",
  "uploaded_at": "2025-10-11T17:30:00Z"
}
```

---

## Testing

### Manual Testing

```sql
-- Test 1: Insert photo metadata
INSERT INTO visit_photos (
  visit_id,
  s3_key,
  s3_url,
  thumbnail_s3_key,
  file_name,
  file_size,
  mime_type
) VALUES (
  (SELECT id FROM visits LIMIT 1),
  'visits/test/photo1.jpg',
  'https://s3.amazonaws.com/berthcare-photos/visits/test/photo1.jpg',
  'visits/test/photo1_thumb.jpg',
  'test_photo.jpg',
  524288,
  'image/jpeg'
);

-- Test 2: Verify unique constraint
INSERT INTO visit_photos (visit_id, s3_key, s3_url)
VALUES (
  (SELECT id FROM visits LIMIT 1),
  'visits/test/photo1.jpg',  -- Duplicate s3_key
  'https://s3.amazonaws.com/...'
);
-- Should fail with unique violation

-- Test 3: Test CASCADE delete
DELETE FROM visits WHERE id = (SELECT visit_id FROM visit_photos LIMIT 1);
-- Verify photos were deleted

-- Test 4: Test file_size constraint
INSERT INTO visit_photos (visit_id, s3_key, s3_url, file_size)
VALUES (
  (SELECT id FROM visits LIMIT 1),
  'visits/test/photo2.jpg',
  'https://s3.amazonaws.com/...',
  0  -- Invalid: must be > 0
);
-- Should fail with check constraint violation
```

---

## Integration with Other Tables

### Relationship Diagram

```text
visits (1) ----< (many) visit_photos
```

- One visit can have multiple photos
- Photos are created during or after visit
- Photos are deleted when visit is deleted
- Photos can be viewed by authorized users

### Typical Workflow

1. **Visit Created**: `INSERT INTO visits (...)`
2. **Visit Started**: Caregiver checks in
3. **Photos Taken**: During visit
4. **Photos Uploaded**:
   - Request pre-signed URL
   - Upload to S3
   - Record metadata in `visit_photos`
5. **Visit Completed**: Caregiver checks out
6. **Photos Viewable**: By caregiver, coordinator, family (if enabled)

---

## Next Steps

1. **V4: POST /v1/visits Endpoint** (Task V4)
   - Implement visit creation endpoint
   - Handle check-in with GPS
   - Support smart data reuse

2. **Photo Upload Endpoints** (Task V8)
   - POST /v1/visits/:visitId/photos/upload-url
   - POST /v1/visits/:visitId/photos
   - Implement image compression
   - Generate thumbnails

3. **Photo Viewing**
   - GET /v1/visits/:visitId/photos
   - Generate pre-signed URLs for access
   - Support thumbnail vs full-size requests

---

## Related Documentation

- [V1: Visits Migration](./V1-visits-migration.md)
- [V2: Visit Documentation Migration](./V2-visit-documentation-migration.md)
- [Architecture Blueprint](../project-documentation/architecture-output.md)
- [S3 Storage Setup](./B4-s3-storage-setup.md)
- [Task Plan](../project-documentation/task-plan.md)

---

## Migration Files

- **Forward Migration:** `apps/backend/src/db/migrations/006_create_visit_photos.sql`
- **Rollback Migration:** `apps/backend/src/db/migrations/006_create_visit_photos-down.sql`
- **Migration Runner:** `apps/backend/src/db/migrate.ts`

---

## Success Criteria

- ✅ Migration file created
- ✅ Rollback migration created
- ✅ Migration runs successfully
- ✅ Table created with all fields
- ✅ Foreign key constraint working (CASCADE delete)
- ✅ UNIQUE constraint on s3_key working
- ✅ CHECK constraint on file_size working
- ✅ All 3 indexes created
- ✅ Photo metadata insertion and retrieval working
- ✅ Schema verified in database

---

**Status:** ✅ Complete  
**Next Task:** V4 - POST /v1/visits Endpoint Implementation
