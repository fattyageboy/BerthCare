# V9: Signature Upload Flow Implementation

**Task ID:** V9  
**Status:** ✅ Complete  
**Date:** October 12, 2025  
**Endpoints:**
- POST /api/v1/visits/:visitId/signature/upload-url
- POST /api/v1/visits/:visitId/signature

**Estimated Effort:** 1 day  
**Actual Effort:** 1 day

---

## Overview

Implemented the signature upload flow using S3 pre-signed URLs for secure, direct-to-S3 uploads. This two-step process generates a pre-signed URL for the mobile app to upload digital signatures directly to S3, then records the signature URL in the appropriate slot on the visit documentation. Supports caregiver, client, and family signatures with file size validation (max 1MB) so each visit can maintain distinct signatures per role.

---

## API Specification

### Endpoint 1: Generate Pre-Signed Upload URL

**POST /api/v1/visits/:visitId/signature/upload-url**

### Authentication

- **Required:** Yes (JWT Bearer token)
- **Role:** Caregiver (or coordinator/admin)
- **Authorization:** Caregiver must own the visit

### Request Body

```typescript
{
  signatureSlot: 'caregiver' | 'client' | 'family'; // Required - Slot to populate
  fileSize: number; // Required - File size in bytes (max 1MB)
}
```

### Response (200 OK)

```typescript
{
  uploadUrl: string; // Pre-signed S3 URL (expires in 10 minutes)
  signatureKey: string; // S3 object key for later reference
  signatureSlot: 'caregiver' | 'client' | 'family'; // Slot the upload will populate
  expiresAt: string; // ISO 8601 timestamp when URL expires
}
```

### Endpoint 2: Record Signature Metadata

**POST /api/v1/visits/:visitId/signature**

### Authentication

- **Required:** Yes (JWT Bearer token)
- **Role:** Caregiver (or coordinator/admin)
- **Authorization:** Caregiver must own the visit

### Request Body

```typescript
{
  caregiverSignatureKey?: string; // Optional - provide to replace caregiver slot
  clientSignatureKey?: string; // Optional - provide to replace client slot
  familySignatureKey?: string; // Optional - provide to replace family slot
}
```

### Response (200 OK)

```typescript
{
  visitId: string; // Visit the signature is attached to
  caregiverSignatureUrl?: string; // Populated if caregiver slot was updated
  clientSignatureUrl?: string; // Populated if client slot was updated
  familySignatureUrl?: string; // Populated if family slot was updated
  slotUpdatedAt: string; // ISO 8601 timestamp for the slot update
}
```

### Error Responses

| Status | Error                 | Description                                                |
| ------ | --------------------- | ---------------------------------------------------------- |
| 400    | Bad Request           | Missing required fields, invalid format, or file too large |
| 401    | Unauthorized          | Missing or invalid JWT token                               |
| 403    | Forbidden             | Not authorized to upload signature for this visit          |
| 404    | Not Found             | Visit does not exist                                       |
| 500    | Internal Server Error | Database or S3 error                                       |

---

## Request Examples

### Step 1: Generate Pre-Signed URL

```bash
curl -X POST http://localhost:3000/api/v1/visits/786bd901-f1bb-48e4-96d9-af0cd3ee84ba/signature/upload-url \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "signatureSlot": "caregiver",
    "fileSize": 524288
  }'
```

**Response:**

```json
{
  "uploadUrl": "https://berthcare-signatures-dev.s3.ca-central-1.amazonaws.com/visits/786bd901-f1bb-48e4-96d9-af0cd3ee84ba/signatures/caregiver-1760246409476.png?X-Amz-Algorithm=...",
  "signatureKey": "visits/786bd901-f1bb-48e4-96d9-af0cd3ee84ba/signatures/caregiver-1760246409476.png",
  "signatureSlot": "caregiver",
  "expiresAt": "2025-10-12T06:30:09.476Z"
}
```

### Step 2: Upload Signature to S3

```bash
# Mobile app uploads directly to S3 using the pre-signed URL
curl -X PUT "https://berthcare-signatures-dev.s3.ca-central-1.amazonaws.com/visits/..." \
  -H "Content-Type: image/png" \
  --data-binary @signature.png
```

### Step 3: Record Signature Metadata

```bash
curl -X POST http://localhost:3000/api/v1/visits/786bd901-f1bb-48e4-96d9-af0cd3ee84ba/signature \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "caregiverSignatureKey": "visits/786bd901-f1bb-48e4-96d9-af0cd3ee84ba/signatures/caregiver-1760246409476.png"
  }'
```

**Response:**

```json
{
  "visitId": "786bd901-f1bb-48e4-96d9-af0cd3ee84ba",
  "caregiverSignatureUrl": "https://berthcare-signatures-dev.s3.ca-central-1.amazonaws.com/visits/786bd901-f1bb-48e4-96d9-af0cd3ee84ba/signatures/caregiver-1760246409476.png",
  "slotUpdatedAt": "2025-10-12T05:20:09.575Z"
}
```

---

## Features Implemented

### 1. Pre-Signed URL Generation

**Functionality:**

- Generates secure, time-limited S3 upload URLs
- Validates file size (max 1MB)
- Validates requested signature slot (`caregiver`, `client`, `family`)
- Includes metadata in S3 object
- Short expiration (10 minutes) for security

**Benefits:**

- **Direct Upload**: Mobile app uploads directly to S3 (bypasses backend)
- **Performance**: Reduces backend load and network latency
- **Security**: Time-limited URLs (10 minutes vs 1 hour for photos)
- **Scalability**: S3 handles upload traffic, not backend

**Implementation:**

```typescript
const { url, key, slot } = await generateSignatureUploadUrl(visitId, 'caregiver', userId);

// Key format: visits/{visitId}/signatures/{slot}-{timestamp}.png
// Example: visits/786bd901.../signatures/caregiver-1760246409476.png
```

### 2. Signature Metadata Recording

**Functionality:**

- Records signature URLs in dedicated columns on the `visit_documentation` table
- Links signature to visit
- Updates existing documentation or creates new record
- Tracks which slot changed most recently
- Generates full S3 URLs for easy access
- Invalidates visit detail cache

**Database Operations:**

```sql
-- Update existing documentation
UPDATE visit_documentation
SET caregiver_signature_url = COALESCE($1, caregiver_signature_url),
    client_signature_url = COALESCE($2, client_signature_url),
    family_signature_url = COALESCE($3, family_signature_url),
    caregiver_signature_uploaded_at = COALESCE($4, caregiver_signature_uploaded_at),
    client_signature_uploaded_at = COALESCE($5, client_signature_uploaded_at),
    family_signature_uploaded_at = COALESCE($6, family_signature_uploaded_at),
    updated_at = CURRENT_TIMESTAMP
WHERE visit_id = $7;

-- Or create new documentation
INSERT INTO visit_documentation (
  visit_id,
  caregiver_signature_url,
  client_signature_url,
  family_signature_url,
  caregiver_signature_uploaded_at,
  client_signature_uploaded_at,
  family_signature_uploaded_at
)
VALUES ($1, $2, $3, $4, $5, $6, $7);
```

### 3. File Size Validation

**Constraint:** Maximum 1MB per signature

**Rationale:**

- **Signature Size**: Digital signatures are typically small (100-500KB)
- **Storage Costs**: Minimal S3 storage costs
- **Upload Speed**: Fast uploads even on slow connections
- **Format**: PNG format with transparency

**Implementation:**

- For pre-signed `PUT` uploads, validate the stored object after the client finishes uploading:

  ```typescript
  const maxSize = 1 * 1024 * 1024; // 1MB

  const head = await s3
    .headObject({
      Bucket: S3_BUCKETS.SIGNATURES,
      Key: signatureKey,
    })
    .promise();

  const uploadedSize = Number(head.ContentLength ?? 0);
  if (uploadedSize > maxSize) {
    await s3
      .deleteObject({
        Bucket: S3_BUCKETS.SIGNATURES,
        Key: signatureKey,
      })
      .promise();

    return res.status(400).json({
      error: 'Bad Request',
      message: 'Uploaded signature exceeds the 1MB limit.',
    });
  }
  ```

- Alternatively, issue a pre-signed `POST` instead of a `PUT` and supply a [`Content-Length-Range`](https://docs.aws.amazon.com/AmazonS3/latest/API/sigv4-HTTPPOSTConstructPolicy.html) condition (e.g., `0` to `1048576`) so S3 enforces the size limit before accepting the upload.

**Expected Sizes:**

- Typical signature: 100-300KB
- High-resolution signature: 500KB-1MB
- Compressed PNG with transparency

### 4. Signature Slot Validation

**Supported Slots:**

- `caregiver` - Caregiver's signature confirming service delivery
- `client` - Client's signature acknowledging service
- `family` - Family member's signature (if client unable to sign)

**Implementation:**

```typescript
const validSlots = ['caregiver', 'client', 'family'] as const;

if (!validSlots.includes(signatureSlot)) {
  return res.status(400).json({
    error: 'Bad Request',
    message: `Invalid signatureSlot. Allowed slots: ${validSlots.join(', ')}`,
  });
}

const payloadKeys = Object.keys(req.body).filter((key) =>
  ['caregiverSignatureKey', 'clientSignatureKey', 'familySignatureKey'].includes(key)
);

if (payloadKeys.length === 0) {
  return res.status(400).json({
    error: 'Bad Request',
    message: 'Provide at least one signature slot to update.',
  });
}
```

**Use Cases:**

- **Caregiver**: Always required, confirms visit completion
- **Client**: Preferred, acknowledges services received
- **Family**: Alternative when client cannot sign (cognitive issues, physical limitations)

### 5. Short URL Expiration

**Expiration:** 10 minutes (vs 1 hour for photos)

**Rationale:**

- **Immediate Upload**: Signatures captured and uploaded immediately
- **Security**: Shorter window reduces risk of URL misuse
- **Workflow**: Signature is last step before visit completion
- **No Retry**: If upload fails, generate new URL

**Implementation:**

```typescript
const expiresAt = new Date(Date.now() + 600 * 1000); // 10 minutes
```

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
    message: 'You can only upload signatures for your own visits',
  });
}
```

### 7. Cache Invalidation

**Functionality:**

- Invalidates visit detail cache after signature upload
- Ensures fresh data on subsequent requests
- Uses exact cache key matching

**Implementation:**

```typescript
const cacheKeyPattern = `visit:detail:${visitId}`;
await redisClient.del(cacheKeyPattern);
```

**Why This Matters:**

- Visit detail endpoint includes signature URL
- Cache must be cleared to show new signature
- Prevents stale data in mobile app

---

## Testing

### Test Coverage

**24 integration tests covering:**

**Upload URL Generation (12 tests):**

- ✅ Generate pre-signed URL for caregiver signature
- ✅ Generate pre-signed URL for client signature
- ✅ Generate pre-signed URL for family signature
- ✅ Allow coordinator to generate URL
- ✅ Reject file size exceeding 1MB
- ✅ Reject invalid signatureSlot value
- ✅ Reject missing signatureSlot
- ✅ Reject missing fileSize
- ✅ Reject invalid visitId format
- ✅ Reject unauthenticated requests
- ✅ Reject caregiver uploading to another's visit
- ✅ Return 404 for non-existent visit

**Signature Metadata Recording (12 tests):**

- ✅ Record signature metadata after upload
- ✅ Update existing documentation with signature
- ✅ Allow coordinator to record signature
- ✅ Generate correct S3 URL
- ✅ Reject payload without any signature slot keys
- ✅ Reject missing signatureKey for caregiver slot
- ✅ Reject signatureKey with wrong visit ID
- ✅ Reject invalid visitId format
- ✅ Reject unauthenticated requests
- ✅ Reject caregiver adding to another's visit
- ✅ Return 404 for non-existent visit
- ✅ Invalidate visit cache after adding signature

### Running Tests

```bash
# Run signature upload tests
npm test -- apps/backend/tests/visits.signature.test.ts

# Run specific test
npm test -- apps/backend/tests/visits.signature.test.ts -t "should generate pre-signed URL"

# Run with coverage
npm run test:coverage
```

### Test Results

```text
PASS  apps/backend/tests/visits.signature.test.ts
  Signature Upload Endpoints
    POST /v1/visits/:visitId/signature/upload-url
      Success Cases
        ✓ should generate pre-signed URL for caregiver signature (45ms)
        ✓ should generate pre-signed URL for client signature (12ms)
        ✓ should generate pre-signed URL for family signature (10ms)
        ✓ should allow coordinator to generate upload URL for any visit (5ms)
      Validation Errors
        ✓ should reject file size exceeding 1MB (4ms)
        ✓ should reject invalid signatureSlot (2ms)
        ✓ should reject missing signatureSlot (3ms)
        ✓ should reject missing fileSize (2ms)
        ✓ should reject invalid visitId format (4ms)
      Authorization Errors
        ✓ should reject request without authentication (2ms)
        ✓ should reject caregiver uploading to another caregiver's visit (3ms)
        ✓ should return 404 for non-existent visit (4ms)
    POST /v1/visits/:visitId/signature
      Success Cases
        ✓ should record signature metadata after successful upload (13ms)
        ✓ should update existing documentation with signature (14ms)
        ✓ should allow coordinator to record signature for any visit (4ms)
        ✓ should generate correct S3 URL (3ms)
      Validation Errors
        ✓ should reject payload without slot keys (2ms)
        ✓ should reject caregiverSignatureKey with empty value (1ms)
        ✓ should reject signatureKey with wrong visit ID (1ms)
        ✓ should reject invalid visitId format (1ms)
      Authorization Errors
        ✓ should reject request without authentication (1ms)
        ✓ should reject caregiver adding signature to another caregiver's visit (2ms)
        ✓ should return 404 for non-existent visit (2ms)
      Cache Invalidation
        ✓ should invalidate visit cache after adding signature (132ms)

Test Suites: 1 passed, 1 total
Tests:       24 passed, 24 total
```

---

## Implementation Details

### File Structure

```text
apps/backend/src/
  ├── routes/
  │   └── visits.routes.ts          # Signature upload endpoints
  ├── storage/
  │   └── s3-client.ts              # S3 client with signature URL generation

apps/backend/tests/
  └── visits.signature.test.ts      # Integration tests

apps/backend/src/db/migrations/
  └── 005_create_visit_documentation.sql  # caregiver/client/family signature columns
```

### Code Organization

**visits.routes.ts:**

- `POST /:visitId/signature/upload-url` - Generate pre-signed URL
- `POST /:visitId/signature` - Record signature metadata
- Request/response interfaces
- Validation logic
- Authorization checks
- Cache invalidation

**s3-client.ts:**

- `generateSignatureUploadUrl()` - Generate pre-signed URL with metadata
- `S3_BUCKETS.SIGNATURES` - Signature bucket constant
- `FILE_CONFIGS.SIGNATURE` - Signature file configuration

### Key Functions

```typescript
type SignatureSlot = 'caregiver' | 'client' | 'family';

// Generate pre-signed URL
async function generateSignatureUploadUrl(
  visitId: string,
  signatureSlot: SignatureSlot,
  uploadedBy: string
): Promise<{ url: string; key: string; slot: SignatureSlot }>;

interface SignatureRecord {
  signatureUrl: string;
  signatureType: SignatureSlot;
  uploadedAt: string;
}

// Record signature metadata
async function recordSignatureMetadata(
  visitId: string,
  signatureKeys: Partial<Record<SignatureSlot, string>>
): Promise<SignatureRecord>;
```

---

## Design Decisions

### 1. Distinct Signature Slots Per Visit

**Decision:** Store independent signature URLs for caregiver, client, and family slots on each visit.

**Implementation:** The `visit_documentation` table now carries three nullable columns—`caregiver_signature_url`, `client_signature_url`, and `family_signature_url`—so each role maintains its own slot. A new upload only overrides the URL in the targeted slot while the other slots remain untouched.

**Rationale:**

- **Role-Specific Evidence:** Supports agencies that require both caregiver and client acknowledgements.
- **Predictable Replacement:** Clear mapping between slot and stored column keeps overwrite logic simple.
- **Backwards Compatibility:** Existing one-slot consumers continue reading the caregiver column by default.

**Replacement Rules:**

- Uploading to a slot replaces the existing URL and timestamp for that slot only.
- Slots left out of the metadata request are ignored; their URLs remain unchanged.
- Re-uploading to the same slot is permitted for corrections.

**Future Enhancement:**

- If we need more than three roles, we can normalize into a `visit_signatures` join table that stores `(visit_id, role, s3_key, uploaded_by)` records without adding columns.

### 2. 10-Minute URL Expiration

**Decision:** Shorter expiration than photos (10 min vs 1 hour)

**Rationale:**

- **Immediate Upload**: Signatures captured and uploaded immediately
- **Security**: Shorter window reduces risk
- **Workflow**: Signature is last step, no delay expected
- **Mobile App**: Signature pad → capture → upload → complete visit

**Comparison:**

- Photos: 1 hour (may take multiple photos, review before upload)
- Signatures: 10 minutes (single capture, immediate upload)
- Documents: 1 hour (may need time to prepare/scan)

### 3. PNG Format Only

**Decision:** Only accept PNG format for signatures

**Rationale:**

- **Transparency**: PNG supports transparent backgrounds
- **Quality**: Lossless compression preserves signature details
- **Standard**: Industry standard for digital signatures
- **Size**: Efficient compression for line art (signatures)

**Implementation:**

```typescript
const key = `visits/${visitId}/signatures/${signatureSlot}-${timestamp}.png`;
```

**Why Not JPEG:**

- No transparency support
- Lossy compression artifacts on line art
- Larger file sizes for signatures

### 4. Signature Slot in Filename

**Decision:** Include signature slot in S3 key

**Rationale:**

- **Identification**: Easy to identify signature slot from filename
- **Organization**: Clear file naming convention
- **Debugging**: Easier troubleshooting
- **Future**: Supports multiple signatures per visit

**Key Format:**

```text
visits/{visitId}/signatures/{slot}-{timestamp}.png
```

**Examples:**

- `visits/786bd901.../signatures/caregiver-1760246409476.png`
- `visits/786bd901.../signatures/client-1760246409477.png`
- `visits/786bd901.../signatures/family-1760246409478.png`

### 5. Update vs Insert Documentation

**Decision:** Update existing documentation or create new record

**Rationale:**

- **Flexibility**: Works whether documentation exists or not
- **Signature First**: Can add signature before other documentation
- **Idempotent**: Safe to call multiple times
- **No Errors**: Doesn't fail if documentation missing

**Implementation:**

```typescript
const slotColumns = {
  caregiverSignatureKey: 'caregiver_signature_url',
  clientSignatureKey: 'client_signature_url',
  familySignatureKey: 'family_signature_url',
} as const;

// buildPublicUrl converts the stored S3 key into the public HTTPS URL returned to clients

const updates = Object.entries(slotColumns)
  .filter(([payloadKey]) => payload[payloadKey])
  .map(([payloadKey, column]) => ({
    column,
    url: buildPublicUrl(payload[payloadKey]),
  }));

if (updates.length === 0) {
  throw new BadRequestError('Provide at least one signature slot to update.');
}

const docResult = await client.query('SELECT id FROM visit_documentation WHERE visit_id = $1', [
  visitId,
]);

if (docResult.rows.length > 0) {
  // Update existing documentation with targeted slots
  const setClauses = updates
    .map(
      (update, idx) =>
        `${update.column} = $${idx + 1}, ${update.column.replace('_url', '_uploaded_at')} = NOW()`
    )
    .join(', ');

  await client.query(
    `UPDATE visit_documentation SET ${setClauses}, updated_at = NOW() WHERE visit_id = $${
      updates.length + 1
    }`,
    [...updates.map((u) => u.url), visitId]
  );
} else {
  // Create new documentation row with supplied slots populated
  await client.query(
    `
      INSERT INTO visit_documentation (
        visit_id,
        caregiver_signature_url,
        client_signature_url,
        family_signature_url,
        caregiver_signature_uploaded_at,
        client_signature_uploaded_at,
        family_signature_uploaded_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7)
    `,
    [
      visitId,
      updates.find((u) => u.column === 'caregiver_signature_url')?.url ?? null,
      updates.find((u) => u.column === 'client_signature_url')?.url ?? null,
      updates.find((u) => u.column === 'family_signature_url')?.url ?? null,
      updates.find((u) => u.column === 'caregiver_signature_url') ? new Date() : null,
      updates.find((u) => u.column === 'client_signature_url') ? new Date() : null,
      updates.find((u) => u.column === 'family_signature_url') ? new Date() : null,
    ]
  );
}
```

---

## Performance Considerations

### Upload Performance

**Expected Upload Times (500KB signature):**

- 4G LTE (20 Mbps): <1 second
- 3G (2 Mbps): ~2 seconds
- WiFi (50 Mbps): <1 second

**Optimization Strategies:**

- Direct S3 upload (no backend bottleneck)
- PNG compression (efficient for line art)
- Immediate upload (no background processing)
- Short expiration (10 minutes)

### Database Performance

**Query Count per Request:**

**Upload URL Generation:**

- 1 query: Get visit and verify ownership
- Total: 1 query (~10ms)

**Metadata Recording:**

- 1 query: Get visit and verify ownership
- 1 query: Check if documentation exists
- 1 query: Insert or update signature slots
- Total: 3 queries (~30ms)

**Indexes Used:**

- `idx_visits_id` (primary key) - Visit lookup
- `idx_visit_documentation_visit_id` - Documentation lookup

### Caching Strategy

**Cache Invalidation:**

- Visit detail cache cleared after signature upload
- Ensures fresh signature URL on next request
- Uses exact key matching for efficiency

**Not Cached:**

- Signature upload operations (write operations)
- Pre-signed URLs (time-sensitive, unique)

---

## Security Considerations

### Input Validation

- ✅ File size validation (max 1MB)
- ✅ Signature slot validation (whitelist)
- ✅ UUID format validation
- ✅ SignatureKey format validation

### Authentication & Authorization

- ✅ JWT token required
- ✅ Visit ownership verification
- ✅ Coordinator override support
- ✅ Visit existence check

### S3 Security

- ✅ Pre-signed URLs (time-limited, 10 minutes)
- ✅ Bucket policies (private by default)
- ✅ IAM roles (least privilege)
- ✅ Encryption at rest (S3 default)
- ✅ Encryption in transit (HTTPS only)

### Data Privacy

- ✅ Signatures linked to visits (not publicly accessible)
- ✅ Zone-based access control (via visit ownership)
- ✅ Audit trail (uploaded_by, uploaded_at in S3 metadata)
- ✅ Signature changes tracked (updated_at timestamp)

---

## Error Scenarios

### 400 Bad Request

**Causes:**

- File size exceeds 1MB
- Invalid signatureSlot
- Missing required fields
- Invalid UUID format
- SignatureKey doesn't match visitId

**Examples:**

```json
{
  "error": "Bad Request",
  "message": "File size exceeds maximum of 1MB."
}
```

```json
{
  "error": "Bad Request",
  "message": "Invalid signatureSlot. Allowed slots: caregiver, client, family"
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
  "message": "You can only upload signatures for your own visits"
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
// Step 1: Capture signature
const signatureData = await signaturePad.toDataURL('image/png');
const signatureBlob = await fetch(signatureData).then((r) => r.blob());

// Step 2: Request pre-signed URL
const urlResponse = await fetch(`/api/v1/visits/${visitId}/signature/upload-url`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    signatureSlot: 'caregiver',
    fileSize: signatureBlob.size,
  }),
});

const { uploadUrl, signatureKey, signatureSlot } = await urlResponse.json();
// signatureSlot echoes the server-validated slot ('caregiver' | 'client' | 'family')

// Step 3: Upload to S3
await fetch(uploadUrl, {
  method: 'PUT',
  headers: {
    'Content-Type': 'image/png',
  },
  body: signatureBlob,
});

// Step 4: Record metadata
await fetch(`/api/v1/visits/${visitId}/signature`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    caregiverSignatureKey: signatureKey,
  }),
});
```

### Error Handling

```typescript
try {
  // Upload flow
} catch (error) {
  if (error.status === 400) {
    // File too large or invalid slot selection
    showError('Signature file is too large or slot is invalid. Please try again.');
  } else if (error.status === 403) {
    // Not authorized
    showError('You are not authorized to add a signature to this visit');
  } else if (error.status === 404) {
    // Visit not found
    showError('Visit not found. Please refresh and try again');
  } else {
    // Generic error
    showError('Failed to upload signature. Please try again');
  }
}
```

---

## Future Enhancements

### 1. Normalize Signature Storage

**Goal:** Support additional signature roles or maintain a history of signature revisions.

**Implementation:**

- Introduce a `visit_signatures` table with `(id, visit_id, role, s3_key, uploaded_by, uploaded_at, deleted_at)`.
- Backfill existing caregiver/client/family columns into role-based records.
- Update read models to aggregate rows back into the three-slot response for backwards compatibility.

### 2. Signature Verification

**Feature:** Verify signature authenticity

**Implementation:**

- Store signature hash in database
- Compare uploaded signature with stored hash
- Detect signature tampering
- Audit trail for signature changes

### 3. Signature Templates

**Feature:** Pre-fill signature pad with previous signature

**Implementation:**

- Store signature as reusable template
- Load template on signature pad
- Allow modifications before saving
- Faster signing for repeat visits

### 4. Signature Download Endpoint

**Endpoint:** GET /api/v1/visits/:visitId/signature

**Functionality:**

- Generate pre-signed download URL
- Time-limited URL (1 hour)
- Access control (same as upload)
- Support for each signature slot (`caregiver`, `client`, `family`)

### 5. Signature Deletion

**Endpoint:** DELETE /api/v1/visits/:visitId/signature

**Functionality:**

- Soft delete (mark slot as cleared)
- Hard delete after 30 days
- Delete from S3 and database
- Audit trail

---

## Related Documentation

- [V2: Visit Documentation Migration](./V2-visit-documentation-migration.md)
- [V7: Visit Detail Endpoint](./V7-visit-detail-endpoint.md)
- [V8: Photo Upload Endpoints](./V8-photo-upload-endpoints.md)
- [B4: S3 Storage Setup](./B4-s3-storage-setup.md)
- [Architecture Blueprint](../project-documentation/architecture-output.md)
- [Task Plan](../project-documentation/task-plan.md)

---

## Implementation Files

- **Routes:** `apps/backend/src/routes/visits.routes.ts`
- **S3 Client:** `apps/backend/src/storage/s3-client.ts`
- **Tests:** `apps/backend/tests/visits.signature.test.ts`
- **Migration:** `apps/backend/src/db/migrations/005_create_visit_documentation.sql`

---

## Success Criteria

- ✅ Pre-signed URL generation endpoint implemented
- ✅ Signature metadata recording endpoint implemented
- ✅ File size validation (max 1MB)
- ✅ Signature slot validation (caregiver, client, family)
- ✅ Authorization checks (visit ownership)
- ✅ Coordinator override support
- ✅ Short URL expiration (10 minutes)
- ✅ Cache invalidation
- ✅ S3 metadata storage
- ✅ 24 integration tests (all passing)
- ✅ Comprehensive error handling
- ✅ Logging and monitoring
- ✅ Documentation complete

---

## Logging

### Success Logging

**Upload URL Generation:**

```typescript
logInfo('Signature upload URL generated', {
  visitId,
  signatureKey,
  userId,
  signatureSlot,
  fileSize,
});
```

**Metadata Recording:**

```typescript
logInfo('Signature metadata recorded', {
  visitId,
  signatureKeys,
  slotsUpdated,
  userId,
});
```

### Error Logging

```typescript
logError('Error generating signature upload URL', error as Error, {
  visitId,
  userId,
  signatureSlot,
});

logError('Error recording signature metadata', error as Error, {
  visitId,
  userId,
  signatureKeys,
});
```

---

**Status:** ✅ Complete  
**Next Task:** Mobile app signature capture implementation
