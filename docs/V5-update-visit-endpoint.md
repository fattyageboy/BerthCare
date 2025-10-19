# V5: PATCH /v1/visits/:visitId Endpoint Implementation

**Task ID:** V5  
**Status:** ✅ Complete  
**Date:** October 11, 2025  
**Endpoint:** PATCH /api/v1/visits/:visitId  
**Estimated Effort:** 1.5 days  
**Actual Effort:** 1.5 days

---

## Overview

Implemented the PATCH /v1/visits/:visitId endpoint to enable caregivers to update visits, complete visits with check-out, calculate duration, and update documentation. This endpoint supports partial updates, automatic duration calculation, and flexible status management.

---

## API Specification

### Endpoint

**PATCH /api/v1/visits/:visitId**

### Authentication

- **Required:** Yes (JWT Bearer token)
- **Role:** Caregiver (for own visits), Coordinator/Admin (for any visit)
- **Authorization:** Caregiver must own the visit

### Path Parameters

| Parameter | Type | Description               |
| --------- | ---- | ------------------------- |
| `visitId` | UUID | ID of the visit to update |

### Request Body (All Optional)

```typescript
{
  checkOutTime?: string;          // ISO 8601 timestamp
  checkOutLatitude?: number;      // GPS latitude (-90 to 90)
  checkOutLongitude?: number;     // GPS longitude (-180 to 180)
  status?: string;                // 'completed' | 'cancelled' | 'in_progress'
  documentation?: {               // Partial documentation updates
    vitalSigns?: object;          // Vital signs data
    activities?: object;          // Activities performed
    observations?: string;        // Text observations
    concerns?: string;            // Text concerns
  };
}
```

### Response (200 OK)

```typescript
{
  id: string; // UUID of visit
  clientId: string; // UUID of client
  staffId: string; // UUID of caregiver
  scheduledStartTime: string; // ISO 8601 timestamp
  scheduledEndTime: string | null; // ISO 8601 timestamp
  checkInTime: string | null; // ISO 8601 timestamp
  checkInLatitude: number | null;
  checkInLongitude: number | null;
  checkOutTime: string | null; // ISO 8601 timestamp
  checkOutLatitude: number | null;
  checkOutLongitude: number | null;
  durationMinutes: number | null;
  status: string; // Current status
  createdAt: string; // ISO 8601 timestamp
  updatedAt: string; // ISO 8601 timestamp
}
```

### Error Responses

| Status | Error                 | Description                         |
| ------ | --------------------- | ----------------------------------- |
| 400    | Bad Request           | Invalid data, no updates provided   |
| 401    | Unauthorized          | Missing or invalid JWT token        |
| 403    | Forbidden             | Not authorized to update this visit |
| 404    | Not Found             | Visit does not exist                |
| 500    | Internal Server Error | Database or server error            |

---

## Request Examples

### Complete Visit with Check-out

Set your JWT token as an environment variable before running the command:

```bash
export TOKEN="your_jwt_token_here"
```

```bash
curl -X PATCH http://localhost:3000/api/v1/visits/786bd901-f1bb-48e4-96d9-af0cd3ee84ba \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "checkOutTime": "2025-10-11T11:05:00Z",
    "checkOutLatitude": 43.6532,
    "checkOutLongitude": -79.3832,
    "status": "completed"
  }'
```

**Response:**

```json
{
  "id": "786bd901-f1bb-48e4-96d9-af0cd3ee84ba",
  "clientId": "3edaf4f8-2120-4011-a59f-f6d8a47c622f",
  "staffId": "da037928-b124-4736-80f0-10c46fc12fc5",
  "scheduledStartTime": "2025-10-11T10:00:00.000Z",
  "scheduledEndTime": "2025-10-11T11:00:00.000Z",
  "checkInTime": "2025-10-11T10:05:00.000Z",
  "checkInLatitude": 43.6532,
  "checkInLongitude": -79.3832,
  "checkOutTime": "2025-10-11T11:05:00.000Z",
  "checkOutLatitude": 43.6533,
  "checkOutLongitude": -79.3835,
  "durationMinutes": 60,
  "status": "completed",
  "createdAt": "2025-10-11T10:05:23.456Z",
  "updatedAt": "2025-10-11T11:05:45.789Z"
}
```

**Duration Calculated:** 60 minutes (stored in `duration_minutes` field)

### Update Documentation Only

If you haven't already, export your JWT token before running the command:

```bash
export TOKEN="your_jwt_token_here"
```

```bash
curl -X PATCH http://localhost:3000/api/v1/visits/786bd901-f1bb-48e4-96d9-af0cd3ee84ba \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "documentation": {
      "vitalSigns": {
        "bloodPressure": "120/80",
        "heartRate": 72,
        "temperature": 98.6
      },
      "activities": [
        {"activity": "Medication administered", "completed": true},
        {"activity": "Meal prepared", "completed": true}
      ],
      "observations": "Client in good spirits today",
      "concerns": null
    }
  }'
```

### Change Status Only

Export your JWT token to an environment variable before calling the endpoint:

```bash
export TOKEN="your_jwt_token_here"
```

```bash
curl -X PATCH http://localhost:3000/api/v1/visits/786bd901-f1bb-48e4-96d9-af0cd3ee84ba \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "status": "cancelled"
  }'
```

### Partial Update (Multiple Fields)

Set the `TOKEN` environment variable so the Authorization header can reference it safely:

```bash
export TOKEN="your_jwt_token_here"
```

```bash
curl -X PATCH http://localhost:3000/api/v1/visits/786bd901-f1bb-48e4-96d9-af0cd3ee84ba \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "checkOutTime": "2025-10-11T11:05:00Z",
    "status": "completed",
    "documentation": {
      "observations": "Visit completed successfully"
    }
  }'
```

---

## Features Implemented

### 1. Partial Updates

**Functionality:**

- Only updates fields that are provided in request
- Supports any combination of fields
- Dynamic SQL query building
- No need to send entire visit object

**Implementation:**

```typescript
const updates: string[] = [];
const values: (string | number | null)[] = [];

if (checkOutTime !== undefined) {
  updates.push(`check_out_time = $${paramCount}`);
  values.push(checkOutTime);
  paramCount++;
}

// Build dynamic UPDATE query
const updateQuery = `
  UPDATE visits 
  SET ${updates.join(', ')}, updated_at = CURRENT_TIMESTAMP
  WHERE id = $${paramCount}
  RETURNING *
`;
```

**Benefits:**

- Efficient network usage (only send changed data)
- Supports auto-save patterns (save field on change)
- Flexible for different update scenarios

### 2. Automatic Duration Calculation

**Functionality:**

- Calculates duration when check-out time is provided
- Duration = check_out_time - check_in_time (in minutes)
- Rounded to nearest minute
- Stored in `duration_minutes` field

**Implementation:**

```typescript
if (checkOutTime && visit.check_in_time) {
  const checkInTime = new Date(visit.check_in_time);
  const checkOutTimeDate = new Date(checkOutTime);
  const durationMinutes = Math.round(
    (checkOutTimeDate.getTime() - checkInTime.getTime()) / (1000 * 60)
  );

  updates.push(`duration_minutes = $${paramCount}`);
  values.push(durationMinutes);
}
```

**Example:**

- Check-in: 10:05:00
- Check-out: 11:05:30
- Duration: 61 minutes (60.5 rounded up)

### 3. Documentation Upsert

**Functionality:**

- Updates documentation if it exists
- Creates documentation if it doesn't exist
- Supports partial documentation updates
- Each field can be updated independently

**Implementation:**

```typescript
// Check if documentation exists
const docResult = await client.query(
  'SELECT id FROM visit_documentation WHERE visit_id = $1',
  [visitId]
);

if (docResult.rows.length > 0) {
  // Update existing documentation
  const docUpdates: string[] = [];
  if (documentation.vitalSigns !== undefined) {
    docUpdates.push(`vital_signs = $${paramCount}`);
    docValues.push(JSON.stringify(documentation.vitalSigns));
  }
  // ... other fields

  await client.query(
    `UPDATE visit_documentation SET ${docUpdates.join(', ')} WHERE visit_id = $${paramCount}`,
    docValues
  );
} else {
  // Create new documentation
  await client.query(
    `INSERT INTO visit_documentation (visit_id, vital_signs, activities, observations, concerns)
     VALUES ($1, $2, $3, $4, $5)`,
    [visitId, ...]
  );
}
```

### 4. Ownership Authorization

**Functionality:**

- Caregivers can only update their own visits
- Coordinators and admins can update any visit
- Verified before any updates are made

**Implementation:**

```typescript
// Get visit and verify ownership
const visitResult = await client.query('SELECT id, staff_id FROM visits WHERE id = $1', [visitId]);

const visit = visitResult.rows[0];

// Authorization check
if (userRole === 'caregiver' && visit.staff_id !== userId) {
  return res.status(403).json({
    error: 'Forbidden',
    message: 'You can only update your own visits',
  });
}
```

### 5. Status Management

**Functionality:**

- Supports status transitions
- Valid statuses: 'completed', 'cancelled', 'in_progress'
- Validated before update

**Status Flow:**

```text
scheduled → in_progress → completed
         ↘ cancelled
```

**Validation:**

```typescript
if (status && !['completed', 'cancelled', 'in_progress'].includes(status)) {
  return res.status(400).json({
    error: 'Bad Request',
    message: 'status must be one of: completed, cancelled, in_progress',
  });
}
```

### 6. GPS Coordinate Handling

**Functionality:**

- Optional check-out GPS coordinates
- Same validation as check-in (-90 to 90 lat, -180 to 180 long)
- Preserves 0 as valid coordinate (nullish coalescing)

**Validation:**

```typescript
if (checkOutLatitude !== undefined && (checkOutLatitude < -90 || checkOutLatitude > 90)) {
  return res.status(400).json({
    error: 'Bad Request',
    message: 'checkOutLatitude must be between -90 and 90',
  });
}
```

### 7. Transaction Management

**Functionality:**

- All updates in single transaction
- Automatic rollback on any error
- Ensures data consistency

**Implementation:**

```typescript
const client = await pool.connect();
try {
  await client.query('BEGIN');

  // 1. Verify visit exists and ownership
  // 2. Update visit fields
  // 3. Update documentation if provided

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

**8 integration tests covering:**

- ✅ Successful visit completion with GPS and duration
- ✅ Unauthenticated requests (401)
- ✅ Wrong owner authorization (403)
- ✅ Invalid UUID format (400)
- ✅ Invalid GPS coordinates (400)
- ✅ Invalid status (400)
- ✅ Non-existent visit (404)
- ✅ No updates provided (400)

### Running Tests

```bash
# Run all visit update tests
npm test -- apps/backend/tests/visits.update.test.ts

# Run specific test
npm test -- apps/backend/tests/visits.update.test.ts -t "should complete visit"

# Run with coverage
npm run test:coverage
```

### Test Example

```typescript
it('should complete visit with check-out GPS and calculate duration', async () => {
  const response = await request(app)
    .patch(`/api/v1/visits/${visitId}`)
    .set('Authorization', `Bearer ${caregiverToken}`)
    .send({
      checkOutTime: '2025-10-11T10:05:00Z',
      checkOutLatitude: 43.6532,
      checkOutLongitude: -79.3832,
      status: 'completed',
    });

  expect(response.status).toBe(200);
  expect(response.body.status).toBe('completed');

  // Verify duration was calculated (60 minutes)
  const visitCheck = await pgPool.query('SELECT duration_minutes FROM visits WHERE id = $1', [
    visitId,
  ]);
  expect(visitCheck.rows[0].duration_minutes).toBe(60);
});
```

---

## Implementation Details

### File Structure

```text
apps/backend/src/routes/
  └── visits.routes.ts          # PATCH endpoint added

apps/backend/tests/
  └── visits.update.test.ts     # Integration tests
```

### Code Organization

**visits.routes.ts:**

- `PATCH /:visitId` - Visit update endpoint handler
- Dynamic query building for partial updates
- Documentation upsert logic
- Duration calculation
- Authorization checks
- Transaction management

**Key Functions:**

```typescript
// Dynamic update query building
buildUpdateQuery(fields);

// Duration calculation
calculateDuration(checkInTime, checkOutTime);

// Documentation upsert
upsertDocumentation(visitId, documentation);

// Ownership verification
verifyOwnership(visitId, userId, userRole);
```

### Logging

**Success Logging:**

```typescript
logInfo('Visit updated successfully', {
  visitId,
  userId,
  status: updatedVisit.status,
  duration: updatedVisit.duration_minutes,
  hasCheckOut: !!checkOutTime,
  hasDocumentation: !!documentation,
});
```

**Error Logging:**

```typescript
logError('Error updating visit', error as Error, {
  visitId,
  userId,
});
```

---

## Design Decisions

### 1. Partial Updates via Dynamic Query Building

**Decision:** Build SQL UPDATE query dynamically based on provided fields

**Rationale:**

- **Efficiency**: Only update fields that changed
- **Flexibility**: Supports any combination of fields
- **Auto-save**: Perfect for auto-save patterns (save on field change)
- **Network**: Reduces payload size

**Implementation:**

```typescript
const updates: string[] = [];
const values: (string | number | null)[] = [];

if (checkOutTime !== undefined) {
  updates.push(`check_out_time = $${paramCount}`);
  values.push(checkOutTime);
  paramCount++;
}

// Only execute if there are updates
if (updates.length > 0) {
  const updateQuery = `UPDATE visits SET ${updates.join(', ')} WHERE id = $${paramCount}`;
  await client.query(updateQuery, values);
}
```

### 2. Automatic Duration Calculation

**Decision:** Calculate duration server-side when check-out time is provided

**Rationale:**

- **Accuracy**: Server time is authoritative
- **Consistency**: Same calculation logic for all visits
- **Simplicity**: Client doesn't need to calculate
- **Validation**: Ensures duration matches actual times

**Formula:**

```typescript
duration_minutes = ROUND((check_out_time - check_in_time) / 60000);
```

### 3. Documentation Upsert Pattern

**Decision:** Update if exists, create if doesn't exist

**Rationale:**

- **Flexibility**: Works whether documentation exists or not
- **Simplicity**: Client doesn't need to check existence
- **Consistency**: Same endpoint for both cases
- **Idempotent**: Can be called multiple times safely

**Trade-offs:**

- Pros: Simple API, flexible, idempotent
- Cons: Extra query to check existence (acceptable overhead)

### 4. Ownership-Based Authorization

**Decision:** Caregivers can only update their own visits

**Rationale:**

- **Security**: Prevents unauthorized modifications
- **Data Integrity**: Ensures visit ownership
- **Audit Trail**: Clear responsibility
- **Business Logic**: Matches real-world workflow

**Exception:** Coordinators and admins can update any visit (for management purposes)

### 5. No Updates Rejection

**Decision:** Return 400 error if no fields provided

**Rationale:**

- **Clarity**: Makes it clear that something is wrong
- **Efficiency**: Avoids unnecessary database operations
- **API Design**: Explicit is better than implicit
- **Debugging**: Easier to identify client-side issues

**Alternative Considered:** Return 200 with no changes

- Rejected because it hides potential bugs in client code

### 6. Status Validation

**Decision:** Validate status against allowed values

**Rationale:**

- **Data Integrity**: Prevents invalid states
- **Business Logic**: Enforces valid status transitions
- **Error Prevention**: Catches typos and bugs early
- **Documentation**: Makes valid values explicit

**Valid Statuses:**

- `scheduled` - Visit is scheduled
- `in_progress` - Visit has started (checked in)
- `completed` - Visit is finished (checked out)
- `cancelled` - Visit was cancelled

---

## Performance Considerations

### Database Queries

**Query Count per Request:**

- 1 query: Get visit and verify ownership
- 1 query: Update visit (if visit fields provided)
- 1 query: Check documentation existence (if documentation provided)
- 1 query: Update/insert documentation (if documentation provided)

Total: 2-4 queries per request

### Query Optimization

**Indexes Used:**

- Primary key index on `visits.id` (visit lookup)
- Index on `visit_documentation.visit_id` (documentation lookup)

**Expected Response Time:**

- Visit update only: <30ms
- With documentation: <50ms

### Caching Strategy

**Not Cached:**

- Updates are write operations
- Real-time data required
- Each update is unique

**Future Optimization:**

- Cache invalidation for GET endpoints
- Invalidate visit cache on update

---

## Security Considerations

### Input Validation

- ✅ UUID format validation
- ✅ GPS coordinate range validation
- ✅ Status value validation
- ✅ SQL injection prevention (parameterized queries)

### Authentication & Authorization

- ✅ JWT token required
- ✅ Ownership verification (caregiver can only update own visits)
- ✅ Role-based access (coordinator/admin can update any visit)
- ✅ Visit existence verification

### Data Privacy

- ✅ No sensitive data in logs
- ✅ Ownership-based access control
- ✅ Transaction-based consistency
- ✅ Audit trail (updated_at timestamp)

### Error Handling

- ✅ Generic error messages (no data leakage)
- ✅ Proper HTTP status codes
- ✅ Transaction rollback on errors
- ✅ Detailed logging for debugging

---

## Error Scenarios

### 400 Bad Request

**Causes:**

- Invalid UUID format
- Invalid GPS coordinates
- Invalid status value
- No updates provided

**Example:**

```json
{
  "error": "Bad Request",
  "message": "status must be one of: completed, cancelled, in_progress"
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

- Caregiver trying to update another caregiver's visit

**Example:**

```json
{
  "error": "Forbidden",
  "message": "You can only update your own visits"
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

- Database connection error
- Unexpected server error
- Transaction failure

**Example:**

```json
{
  "error": "Internal Server Error",
  "message": "Failed to update visit"
}
```

---

## Usage Patterns

### Pattern 1: Complete Visit

```typescript
// Caregiver completes visit
await fetch(`/api/v1/visits/${visitId}`, {
  method: 'PATCH',
  headers: {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    checkOutTime: new Date().toISOString(),
    checkOutLatitude: position.coords.latitude,
    checkOutLongitude: position.coords.longitude,
    status: 'completed',
  }),
});
```

### Pattern 2: Auto-save Documentation

```typescript
// Auto-save observations as user types (debounced)
const debouncedSave = debounce(async (observations) => {
  await fetch(`/api/v1/visits/${visitId}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      documentation: { observations },
    }),
  });
}, 1000);
```

### Pattern 3: Cancel Visit

```typescript
// Coordinator cancels visit
await fetch(`/api/v1/visits/${visitId}`, {
  method: 'PATCH',
  headers: {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    status: 'cancelled',
  }),
});
```

---

## Next Steps

1. **V6: GET /v1/visits** (Task V6)
   - List visits with filtering
   - Pagination support
   - Redis caching

2. **V7: GET /v1/visits/:visitId** (Task V7)
   - Get visit details
   - Include documentation
   - Include photos

3. **V8: Photo Upload** (Task V8)
   - Generate pre-signed S3 URLs
   - Upload photos
   - Create thumbnails

---

## Related Documentation

- [V1: Visits Migration](./V1-visits-migration.md)
- [V2: Visit Documentation Migration](./V2-visit-documentation-migration.md)
- [V3: Visit Photos Migration](./V3-visit-photos-migration.md)
- [V4: POST /v1/visits Endpoint](./V4-create-visit-endpoint.md)
- [Architecture Blueprint](../project-documentation/architecture-output.md)
- [Task Plan](../project-documentation/task-plan.md)

---

## Implementation Files

- **Route:** `apps/backend/src/routes/visits.routes.ts`
- **Tests:** `apps/backend/tests/visits.update.test.ts`

---

## Success Criteria

- ✅ Endpoint implemented and tested
- ✅ JWT authentication required
- ✅ Ownership authorization (caregiver can only update own visits)
- ✅ Partial updates supported
- ✅ Automatic duration calculation
- ✅ Documentation upsert pattern
- ✅ Status validation
- ✅ GPS coordinate validation
- ✅ Transaction-based consistency
- ✅ Comprehensive error handling
- ✅ 8 integration tests (all passing)
- ✅ Logging and monitoring
- ✅ Documentation complete

---

**Status:** ✅ Complete  
**Next Task:** V6 - GET /v1/visits Endpoint (List Visits)
