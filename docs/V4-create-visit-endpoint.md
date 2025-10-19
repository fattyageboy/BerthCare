# V4: POST /v1/visits Endpoint Implementation

**Task ID:** V4  
**Status:** ✅ Complete  
**Date:** October 11, 2025  
**Endpoint:** POST /api/v1/visits  
**Estimated Effort:** 2 days  
**Actual Effort:** 2 days

---

## Overview

Implemented the POST /v1/visits endpoint to enable caregivers to start visits (check-in) with GPS verification and smart data reuse. This endpoint creates a new visit record with status 'in_progress', records check-in time and GPS coordinates, and optionally copies documentation from a previous visit.

---

## API Specification

### Endpoint

**POST /api/v1/visits**

### Authentication

- **Required:** Yes (JWT Bearer token)
- **Role:** Caregiver only
- **Authorization:** Caregiver must be in same zone as client

### Request Body

```typescript
{
  clientId: string;              // Required - UUID of client being visited
  scheduledStartTime: string;    // Required - ISO 8601 timestamp
  checkInTime?: string;          // Optional - ISO 8601 timestamp (defaults to now)
  checkInLatitude?: number;      // Optional - GPS latitude (-90 to 90)
  checkInLongitude?: number;     // Optional - GPS longitude (-180 to 180)
  copiedFromVisitId?: string;    // Optional - UUID of previous visit to copy from
}
```

### Response (201 Created)

```typescript
{
  id: string; // UUID of created visit
  clientId: string; // UUID of client
  staffId: string; // UUID of caregiver (from JWT)
  scheduledStartTime: string; // ISO 8601 timestamp
  checkInTime: string | null; // ISO 8601 timestamp
  checkInLatitude: number | null;
  checkInLongitude: number | null;
  status: string; // Always 'in_progress'
  createdAt: string; // ISO 8601 timestamp
}
```

### Error Responses

| Status | Error                 | Description                               |
| ------ | --------------------- | ----------------------------------------- |
| 400    | Bad Request           | Missing required fields or invalid format |
| 401    | Unauthorized          | Missing or invalid JWT token              |
| 403    | Forbidden             | Not a caregiver or wrong zone             |
| 404    | Not Found             | Client does not exist                     |
| 409    | Conflict              | Visit already exists for this time slot   |
| 500    | Internal Server Error | Database or server error                  |

---

## Request Examples

### Basic Visit (Minimal)

```bash
curl -X POST http://localhost:3000/api/v1/visits \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "clientId": "3edaf4f8-2120-4011-a59f-f6d8a47c622f",
    "scheduledStartTime": "2025-10-11T10:00:00Z"
  }'
```

**Response:**

```json
{
  "id": "786bd901-f1bb-48e4-96d9-af0cd3ee84ba",
  "clientId": "3edaf4f8-2120-4011-a59f-f6d8a47c622f",
  "staffId": "da037928-b124-4736-80f0-10c46fc12fc5",
  "scheduledStartTime": "2025-10-11T10:00:00.000Z",
  "checkInTime": "2025-10-11T10:05:23.456Z",
  "checkInLatitude": null,
  "checkInLongitude": null,
  "status": "in_progress",
  "createdAt": "2025-10-11T10:05:23.456Z"
}
```

### Visit with GPS Coordinates

```bash
curl -X POST http://localhost:3000/api/v1/visits \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "clientId": "3edaf4f8-2120-4011-a59f-f6d8a47c622f",
    "scheduledStartTime": "2025-10-11T10:00:00Z",
    "checkInTime": "2025-10-11T10:05:00Z",
    "checkInLatitude": 43.6532,
    "checkInLongitude": -79.3832
  }'
```

**Response:**

```json
{
  "id": "786bd901-f1bb-48e4-96d9-af0cd3ee84ba",
  "clientId": "3edaf4f8-2120-4011-a59f-f6d8a47c622f",
  "staffId": "da037928-b124-4736-80f0-10c46fc12fc5",
  "scheduledStartTime": "2025-10-11T10:00:00.000Z",
  "checkInTime": "2025-10-11T10:05:00.000Z",
  "checkInLatitude": 43.6532,
  "checkInLongitude": -79.3832,
  "status": "in_progress",
  "createdAt": "2025-10-11T10:05:23.456Z"
}
```

### Visit with Smart Data Reuse

```bash
curl -X POST http://localhost:3000/api/v1/visits \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "clientId": "3edaf4f8-2120-4011-a59f-f6d8a47c622f",
    "scheduledStartTime": "2025-10-11T10:00:00Z",
    "checkInLatitude": 43.6532,
    "checkInLongitude": -79.3832,
    "copiedFromVisitId": "previous-visit-uuid"
  }'
```

**Behavior:** Copies vital_signs, activities, and observations from the previous visit's documentation.

---

## Features Implemented

### 1. Visit Creation (Check-in)

**Functionality:**

- Creates visit record with status 'in_progress'
- Records check-in time (auto-uses current time if not provided)
- Captures GPS coordinates (optional for offline scenarios)
- Links visit to client and caregiver (staff)

**Database Operations:**

```sql
INSERT INTO visits (
  client_id, staff_id, scheduled_start_time,
  check_in_time, check_in_latitude, check_in_longitude,
  status, copied_from_visit_id
) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
RETURNING *;
```

### 2. Smart Data Reuse

**Functionality:**

- Copies documentation from previous visit if `copiedFromVisitId` provided
- Only copies if source visit belongs to same client
- Copies: vital_signs, activities, observations
- Gracefully handles missing source visits

**Implementation:**

```typescript
if (copiedFromVisitId) {
  // Verify source visit exists and belongs to same client
  const sourceVisit = await client.query('SELECT id, client_id FROM visits WHERE id = $1', [
    copiedFromVisitId,
  ]);

  if (sourceVisit.client_id === clientId) {
    // Copy documentation
    const sourceDoc = await client.query(
      'SELECT vital_signs, activities, observations FROM visit_documentation WHERE visit_id = $1',
      [copiedFromVisitId]
    );

    // Create new documentation with copied data
    await client.query(
      'INSERT INTO visit_documentation (visit_id, vital_signs, activities, observations) VALUES ($1, $2, $3, $4)',
      [newVisitId, sourceDoc.vital_signs, sourceDoc.activities, sourceDoc.observations]
    );
  }
}
```

**Benefits:**

- Saves caregiver time (no re-entering routine data)
- Maintains consistency across visits
- Reduces data entry errors
- Supports offline-first workflow

### 3. GPS Coordinate Handling

**Validation:**

- Latitude: -90 to 90 degrees
- Longitude: -180 to 180 degrees
- Handles 0 as valid coordinate (equator/prime meridian)

**Special Cases:**

- `0` is preserved (not converted to null)
- `undefined` becomes `null` in database
- Uses nullish coalescing (`??`) not logical OR (`||`)

**Example Locations at 0:**

- **0°N, 0°E**: Gulf of Guinea (off coast of Africa)
- **0°N**: Equator (crosses Ecuador, Kenya, Indonesia)
- **0°E**: Prime Meridian (crosses UK, France, Spain, Ghana)

### 4. Security & Authorization

**Authentication:**

- JWT token required in Authorization header
- Token validated via `authenticateJWT` middleware
- User ID and role extracted from token

**Authorization Checks:**

1. **Role Check**: Only caregivers can create visits
2. **Zone Check**: Caregiver must be in same zone as client
3. **Client Existence**: Client must exist and not be deleted

**Implementation:**

```typescript
// Check caregiver role
if (userRole !== 'caregiver') {
  return res.status(403).json({
    error: 'Forbidden',
    message: 'Only caregivers can create visits',
  });
}

// Check zone authorization
const caregiverZone = await getZone(userId);
const clientZone = await getZone(clientId);

if (caregiverZone !== clientZone) {
  return res.status(403).json({
    error: 'Forbidden',
    message: 'Cannot create visit for client in different zone',
  });
}
```

### 5. Input Validation

**Required Fields:**

- `clientId` (UUID format)
- `scheduledStartTime` (ISO 8601 timestamp)

**Optional Fields:**

- `checkInTime` (ISO 8601 timestamp, defaults to now)
- `checkInLatitude` (number, -90 to 90)
- `checkInLongitude` (number, -180 to 180)
- `copiedFromVisitId` (UUID format)

**Validation Rules:**

```typescript
// UUID format validation
const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
if (!uuidRegex.test(clientId)) {
  return res.status(400).json({ error: 'Invalid clientId format' });
}

// GPS coordinate validation
if (checkInLatitude !== undefined && (checkInLatitude < -90 || checkInLatitude > 90)) {
  return res.status(400).json({ error: 'checkInLatitude must be between -90 and 90' });
}

if (checkInLongitude !== undefined && (checkInLongitude < -180 || checkInLongitude > 180)) {
  return res.status(400).json({ error: 'checkInLongitude must be between -180 and 180' });
}
```

### 6. Duplicate Prevention

**Check:**

- Same client
- Same scheduled start time
- Status is 'scheduled' or 'in_progress'

**Implementation:**

```sql
SELECT id FROM visits
WHERE client_id = $1
AND status IN ('scheduled', 'in_progress')
AND scheduled_start_time = $2
```

**Response:**

```json
{
  "error": "Conflict",
  "message": "Visit already exists for this time slot"
}
```

### 7. Transaction Management

**Atomicity:**

- All database operations in single transaction
- Automatic rollback on any error
- Ensures data consistency

**Implementation:**

```typescript
const client = await pool.connect();
try {
  await client.query('BEGIN');

  // 1. Verify client exists and get zone
  // 2. Verify caregiver zone matches
  // 3. Check for duplicate visits
  // 4. Create visit record
  // 5. Copy documentation if requested

  await client.query('COMMIT');
} catch (error) {
  await client.query('ROLLBACK');
  throw error;
} finally {
  client.release();
}
```

---

## Testing

### Test Coverage

**15 integration tests covering:**

- ✅ Successful visit creation with GPS
- ✅ Visit creation without GPS
- ✅ Auto check-in time (current time)
- ✅ Zero coordinates (equator/prime meridian)
- ✅ Smart data reuse from previous visit
- ✅ Smart data reuse with missing source
- ✅ Unauthenticated requests (401)
- ✅ Non-caregiver users (403)
- ✅ Wrong zone authorization (403)
- ✅ Missing clientId (400)
- ✅ Missing scheduledStartTime (400)
- ✅ Invalid UUID format (400)
- ✅ Invalid GPS coordinates (400)
- ✅ Non-existent client (404)
- ✅ Duplicate visit prevention (409)

### Running Tests

```bash
# Run all visit tests
npm test -- apps/backend/tests/visits.create.test.ts

# Run specific test
npm test -- apps/backend/tests/visits.create.test.ts -t "should create visit with GPS"

# Run with coverage
npm run test:coverage
```

### Test Results

```
PASS  apps/backend/tests/visits.create.test.ts
  POST /v1/visits
    Successful visit creation
      ✓ should create visit with GPS coordinates (45ms)
      ✓ should create visit without GPS coordinates (32ms)
      ✓ should use current time if checkInTime not provided (28ms)
      ✓ should preserve 0 as valid GPS coordinates (equator/prime meridian) (31ms)
    Smart data reuse
      ✓ should copy documentation from previous visit (52ms)
      ✓ should not copy documentation if source visit does not exist (35ms)
    Authorization
      ✓ should reject unauthenticated requests (12ms)
      ✓ should reject non-caregiver users (38ms)
      ✓ should reject caregiver from different zone (42ms)
    Validation
      ✓ should reject missing clientId (15ms)
      ✓ should reject missing scheduledStartTime (14ms)
      ✓ should reject invalid clientId format (16ms)
      ✓ should reject invalid GPS coordinates (18ms)
      ✓ should reject non-existent client (25ms)
      ✓ should reject duplicate visit for same time slot (48ms)

Test Suites: 1 passed, 1 total
Tests:       15 passed, 15 total
```

---

## Implementation Details

### File Structure

```
apps/backend/src/routes/
  └── visits.routes.ts          # Visit routes implementation

apps/backend/tests/
  └── visits.create.test.ts     # Integration tests

apps/backend/src/main.ts        # Route registration
```

### Code Organization

**visits.routes.ts:**

- `createVisitsRouter(pool)` - Router factory function
- `POST /` - Visit creation endpoint handler
- Request/response interfaces
- Validation logic
- Authorization checks
- Transaction management

**Key Functions:**

```typescript
// Router creation
export function createVisitsRouter(pool: Pool): Router;

// Request validation
validateRequiredFields(body);
validateUUIDFormat(id);
validateGPSCoordinates(lat, lng);

// Authorization
checkCaregiverRole(user);
checkZoneAuthorization(caregiverId, clientId);

// Business logic
createVisit(data);
copyDocumentation(sourceVisitId, newVisitId);
```

### Logging

**Success Logging:**

```typescript
logInfo('Visit created successfully', {
  visitId: visit.id,
  clientId,
  staffId: userId,
  checkInTime: actualCheckInTime,
  hasGPS: checkInLatitude !== undefined && checkInLongitude !== undefined,
  copiedFromVisit: !!copiedFromVisitId,
});
```

**Error Logging:**

```typescript
logError('Error creating visit', error as Error, {
  clientId,
  userId,
});
```

---

## Design Decisions

### 1. Auto Check-in Time

**Decision:** Use current server time if `checkInTime` not provided

**Rationale:**

- Simplifies mobile app implementation
- Reduces network payload
- Server time is authoritative
- Handles timezone issues automatically

**Implementation:**

```typescript
const actualCheckInTime = checkInTime || new Date().toISOString();
```

### 2. Optional GPS Coordinates

**Decision:** Make GPS coordinates optional (nullable)

**Rationale:**

- **Offline Support**: App works without GPS signal
- **Indoor Locations**: GPS may not work indoors
- **Privacy**: Some caregivers may disable location
- **Flexibility**: Can add GPS later if needed

**Trade-offs:**

- Pros: Works in all scenarios, better UX
- Cons: Can't verify location for all visits

### 3. Nullish Coalescing for Coordinates

**Decision:** Use `??` instead of `||` for default values

**Rationale:**

- `0` is a valid coordinate (equator/prime meridian)
- `||` converts `0` to `null` (incorrect)
- `??` only converts `null`/`undefined` to `null`

**Example:**

```typescript
// Wrong: 0 becomes null
checkInLatitude || null; // ❌

// Correct: 0 stays as 0
checkInLatitude ?? null; // ✅
```

### 4. Zone-Based Authorization

**Decision:** Enforce zone matching between caregiver and client

**Rationale:**

- **Data Isolation**: Prevents cross-zone data access
- **Security**: Reduces attack surface
- **Compliance**: Supports geographic data regulations
- **Business Logic**: Caregivers work in specific zones

**Implementation:**

```typescript
if (caregiverZoneId !== clientZoneId) {
  return res.status(403).json({
    error: 'Forbidden',
    message: 'Cannot create visit for client in different zone',
  });
}
```

### 5. Transaction-Based Consistency

**Decision:** Use database transactions for all operations

**Rationale:**

- **Atomicity**: All-or-nothing operations
- **Consistency**: No partial data
- **Isolation**: Concurrent request safety
- **Durability**: Data persisted correctly

**Example:**

```typescript
await client.query('BEGIN');
try {
  // Multiple operations
  await client.query('COMMIT');
} catch (error) {
  await client.query('ROLLBACK');
  throw error;
}
```

### 6. Smart Data Reuse Safety

**Decision:** Only copy from same client's visits

**Rationale:**

- **Privacy**: Prevents data leakage between clients
- **Accuracy**: Ensures relevant data
- **Security**: Additional authorization layer

**Implementation:**

```typescript
if (sourceVisit.client_id === clientId) {
  // Copy documentation
} else {
  // Skip copy, log warning
  logInfo('Documentation copy skipped: different client');
}
```

---

## Performance Considerations

### Database Queries

**Query Count per Request:**

- 1 query: Check client exists and get zone
- 1 query: Get caregiver zone
- 1 query: Check for duplicate visits
- 1 query: Insert visit
- 0-2 queries: Copy documentation (if requested)

**Total: 4-6 queries per request**

### Query Optimization

**Indexes Used:**

- `idx_clients_zone_id` - Client zone lookup
- `idx_users_zone_id` - Caregiver zone lookup
- `idx_visits_client_id` - Duplicate check
- `idx_visits_scheduled_time` - Duplicate check

**Expected Response Time:**

- Without documentation copy: <50ms
- With documentation copy: <100ms

### Caching Strategy

**Not Cached:**

- Visit creation is a write operation
- Each visit is unique
- Real-time data required

**Future Optimization:**

- Cache client zone lookups (5 min TTL)
- Cache caregiver zone lookups (5 min TTL)

---

## Security Considerations

### Input Validation

- ✅ UUID format validation
- ✅ GPS coordinate range validation
- ✅ Required field validation
- ✅ SQL injection prevention (parameterized queries)

### Authentication & Authorization

- ✅ JWT token required
- ✅ Role-based access control (caregiver only)
- ✅ Zone-based data isolation
- ✅ Client existence verification

### Data Privacy

- ✅ No sensitive data in logs
- ✅ Zone-based access control
- ✅ Transaction-based consistency
- ✅ Audit trail (created_at, updated_at)

### Error Handling

- ✅ Generic error messages (no data leakage)
- ✅ Proper HTTP status codes
- ✅ Transaction rollback on errors
- ✅ Detailed logging for debugging

---

## Error Scenarios

### 400 Bad Request

**Causes:**

- Missing required fields
- Invalid UUID format
- Invalid GPS coordinates
- Invalid timestamp format

**Example:**

```json
{
  "error": "Bad Request",
  "message": "clientId and scheduledStartTime are required"
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
  "error": "Unauthorized",
  "message": "Authentication required"
}
```

### 403 Forbidden

**Causes:**

- User is not a caregiver
- Caregiver in different zone than client

**Example:**

```json
{
  "error": "Forbidden",
  "message": "Cannot create visit for client in different zone"
}
```

### 404 Not Found

**Causes:**

- Client does not exist
- Client has been deleted

**Example:**

```json
{
  "error": "Not Found",
  "message": "Client not found"
}
```

### 409 Conflict

**Causes:**

- Visit already exists for same time slot
- Duplicate visit prevention

**Example:**

```json
{
  "error": "Conflict",
  "message": "Visit already exists for this time slot"
}
```

### 500 Internal Server Error

**Causes:**

- Database connection error
- Unexpected server error
- Transaction failure

**Example:**

```json
{
  "error": "Internal Server Error",
  "message": "Failed to create visit"
}
```

---

## Next Steps

1. **V5: PATCH /v1/visits/:visitId** (Task V5)
   - Update visit documentation
   - Complete visit (check-out)
   - Calculate duration

2. **V6: GET /v1/visits** (Task V6)
   - List visits with filtering
   - Pagination support
   - Redis caching

3. **V7: GET /v1/visits/:visitId** (Task V7)
   - Get visit details
   - Include documentation
   - Include photos

4. **V8: Photo Upload** (Task V8)
   - Generate pre-signed S3 URLs
   - Upload photos
   - Create thumbnails

---

## Related Documentation

- [V1: Visits Migration](./V1-visits-migration.md)
- [V2: Visit Documentation Migration](./V2-visit-documentation-migration.md)
- [V3: Visit Photos Migration](./V3-visit-photos-migration.md)
- [Architecture Blueprint](../project-documentation/architecture-output.md)
- [Task Plan](../project-documentation/task-plan.md)

---

## Implementation Files

- **Route:** `apps/backend/src/routes/visits.routes.ts`
- **Tests:** `apps/backend/tests/visits.create.test.ts`
- **Main:** `apps/backend/src/main.ts` (route registration)

---

## Success Criteria

- ✅ Endpoint implemented and registered
- ✅ JWT authentication required
- ✅ Role-based authorization (caregiver only)
- ✅ Zone-based authorization
- ✅ Input validation (all fields)
- ✅ GPS coordinate handling (including 0)
- ✅ Smart data reuse implemented
- ✅ Transaction-based consistency
- ✅ Duplicate prevention
- ✅ Comprehensive error handling
- ✅ 15 integration tests (all passing)
- ✅ Logging and monitoring
- ✅ Documentation complete

---

**Status:** ✅ Complete  
**Next Task:** V5 - PATCH /v1/visits/:visitId Endpoint
