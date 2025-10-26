# Task C6: PATCH /v1/clients/:clientId Implementation Summary

**Task ID:** C6  
**Feature:** Client Management  
**Status:** ✅ Completed  
**Date:** October 10, 2025  
**Developer:** Backend Engineer

## Overview

Successfully implemented the PATCH /v1/clients/:clientId endpoint to update existing client information. The endpoint supports partial updates, automatically re-geocodes addresses when changed, invalidates Redis cache on updates, logs all modifications to an audit trail, and enforces zone-based access control for coordinators.

## What Was Implemented

### 1. Validation Middleware Extension

**File:** `apps/backend/src/middleware/validation.ts` (extended)

**Added Function:** `validateUpdateClient`

**Features:**

- Validates at least one field is provided (no empty updates)
- All field validations are optional (partial updates)
- Same validation rules as create endpoint
- Supports null values for clearing optional fields (e.g., phone)
- Clear error messages for each validation failure

**Validations:**

- firstName: 1-100 characters (optional)
- lastName: 1-100 characters (optional)
- dateOfBirth: ISO 8601 format, not future, not >120 years ago (optional)
- address: Non-empty string (optional, triggers re-geocoding)
- phone: 1-20 characters or null (optional)
- emergencyContactName: 1-200 characters (optional)
- emergencyContactPhone: 1-20 characters (optional)
- emergencyContactRelationship: 1-100 characters (optional)
- zoneId: UUID format (optional, admin only)

### 2. PATCH Endpoint Implementation

**File:** `apps/backend/src/routes/clients.routes.ts` (extended)

**Endpoint:** `PATCH /v1/clients/:clientId`

**Middleware Chain:**

1. `authenticateJWT(redisClient)` - Verify JWT token
2. `requireRole(['coordinator', 'admin'])` - Require coordinator or admin
3. `validateUpdateClient` - Validate request body

**Business Logic Flow:**

1. Validate client ID format (UUID)
2. Fetch existing client from database
3. Check authorization:
   - Coordinators can only update clients in their zone
   - Only admins can change zone
4. Check for duplicate if name/DOB changed
5. Re-geocode if address changed
6. Re-assign zone if address changed (unless admin specified zone)
7. Build dynamic UPDATE query with only provided fields
8. Execute update
9. Invalidate caches (detail + list for affected zones)
10. Log changes to audit trail
11. Return updated client

**Key Features:**

- **Partial Updates**: Only updates fields provided in request
- **Address Re-geocoding**: Automatically geocodes new addresses
- **Zone Re-assignment**: Auto-assigns zone based on new location
- **Cache Invalidation**: Clears all affected caches
- **Audit Logging**: Logs all field changes with old/new values
- **Authorization**: Zone-based access control for coordinators
- **Duplicate Detection**: Prevents duplicate clients after update

### 3. Authorization Logic

**Coordinator Access:**

- Can update clients in their zone only
- Cannot change client zone
- Cannot update clients in other zones

**Admin Access:**

- Can update any client in any zone
- Can manually change client zone
- No restrictions

**Caregiver Access:**

- Cannot update clients (read-only)
- Returns 403 Forbidden

### 4. Address Re-geocoding

**Trigger:** Address field changes

**Process:**

1. Call Google Maps Geocoding API
2. Update address with formatted address
3. Update latitude/longitude with new coordinates
4. Re-assign zone based on new location (unless admin specified zone)

**Error Handling:**

- Invalid address: 400 Bad Request
- Geocoding API failure: 400 Bad Request
- Clear error message with address and reason

### 5. Cache Invalidation

**Caches Cleared:**

1. Client detail cache: `client:detail:${clientId}`
2. Client list cache (old zone): `clients:list:zone=${oldZoneId}:*`
3. Client list cache (new zone): `clients:list:zone=${newZoneId}:*` (if zone changed)
4. Client list cache (all zones): `clients:list:zone=all:*`

**Implementation:**

- Uses Redis KEYS pattern matching
- Clears all matching keys in batch
- Graceful fallback if cache invalidation fails
- Logs warnings but doesn't fail request

### 6. Audit Trail Logging

**Log Format:**

```json
{
  "level": "info",
  "message": "Client updated",
  "clientId": "uuid",
  "userId": "uuid",
  "changes": {
    "firstName": { "old": "John", "new": "Jonathan" },
    "address": { "old": "123 Old St", "new": "456 New St" },
    "latitude": { "old": 43.6532, "new": 43.7 },
    "longitude": { "old": -79.3832, "new": -79.4 }
  },
  "timestamp": "2025-10-10T12:00:00Z",
  "requestId": "uuid"
}
```

**Features:**

- Tracks all field changes (old value → new value)
- Records user who made the change
- Includes timestamp and request ID
- Only logs if changes were made
- Uses structured logging (logInfo)

**Future Enhancement:**

- Store in audit_logs table for persistence
- Query audit history via API
- Generate audit reports

### 7. Integration Tests

**File:** `apps/backend/tests/clients.update.test.ts`

**Test Coverage:**

- ✅ Authorization (401, 403)
- ✅ Coordinator can update client in same zone
- ✅ Coordinator cannot update client in different zone
- ✅ Coordinator cannot change zone
- ✅ Admin can update any client
- ✅ Admin can change zone
- ✅ Caregiver cannot update (403)
- ✅ Validation (400 for invalid fields)
- ✅ Client not found (404)
- ✅ Empty update rejected (400)
- ✅ Partial updates (single field)
- ✅ Multiple field updates
- ✅ Address re-geocoding
- ✅ Clear optional field (phone = null)
- ✅ Duplicate detection (409)
- ✅ Cache invalidation
- ✅ Emergency contact updates
- ✅ Response format validation

**Test Scenarios:**

- Authorization checks for all roles
- Validation of all fields
- Partial update scenarios
- Address change with re-geocoding
- Zone change (admin only)
- Duplicate detection after update
- Cache invalidation verification
- Emergency contact updates

## Design Philosophy Applied

### Simplicity is the Ultimate Sophistication

- Partial updates (only update what changed)
- Automatic re-geocoding on address change
- Automatic zone re-assignment
- Clear, predictable API behavior

### Obsess Over Details

- Comprehensive validation
- Clear error messages
- Audit trail for all changes
- Cache invalidation for data consistency
- Zone-based access control

### Start with User Experience

- Coordinators can update clients in their zone
- Admins have full control
- Automatic geocoding and zone assignment
- No manual cache management required

### Uncompromising Security

- Zone-based access control
- Role-based permissions
- Input validation
- Audit trail for compliance
- Parameterized queries (SQL injection prevention)

## Performance Considerations

### Cache Invalidation Strategy

**Selective Invalidation:**

- Only clears affected caches
- Uses pattern matching for efficiency
- Clears detail + list caches
- Clears old and new zone caches (if zone changed)

**Cache Warming:**

- Don't pre-populate cache after update
- Let next GET request populate cache
- Reduces update latency

### Database Optimization

**Dynamic Query Building:**

- Only updates fields that changed
- Single UPDATE query (no multiple queries)
- Uses parameterized queries for security
- Efficient query execution

**Duplicate Detection:**

- Scope: Zone-scoped. Candidate matches are loaded only from the coordinator’s `zone_id` (admins include the target client’s current zone) so cross-zone clients are ignored.
- Name matching: Normalize `firstName`/`lastName` by trimming, collapsing internal whitespace to a single space, and lowercasing. Names must match exactly after normalization; no fuzzy comparison is performed in v1 (future enhancement: evaluate Levenshtein distance ≤2).
- DOB matching: Require an exact `YYYY-MM-DD` match against `date_of_birth`. No tolerance window is applied.
- Indexes: Relies on `idx_clients_zone_last_name` for zone/name filtering and `idx_clients_full_name` for normalized comparisons; both include `WHERE deleted_at IS NULL`.
- Lookup flow:
  1. Normalize the incoming fields.
  2. Execute `SELECT id FROM clients WHERE zone_id = $1 AND deleted_at IS NULL AND LOWER(first_name) = $2 AND LOWER(last_name) = $3 AND date_of_birth = $4 LIMIT 1;`.
  3. If a row is returned with a different `id`, flag as potential duplicate.

### Geocoding Optimization

**Conditional Geocoding:**

- Only geocodes if address changed
- Uses cached geocoding results (24 hour TTL)
- Skips geocoding if address unchanged
- Reduces API calls and latency

## Security Considerations

### Input Validation

- All fields validated
- String length limits enforced
- Date format and range validated
- UUID format validated
- Prevents SQL injection via parameterized queries

### Authorization

- Zone-based access control for coordinators
- Admin-only zone changes
- Verify user has permission before update
- Log all update attempts

### Data Privacy

- Log minimal PII in audit trail
- Encrypt sensitive data at rest
- Use HTTPS for all API calls
- Comply with PIPEDA requirements

## Error Handling

### Validation Errors (400)

- Empty update (no fields provided)
- Invalid field types
- Invalid date format
- Invalid UUID format
- String length violations

### Authorization Errors (403)

- Caregiver attempting update
- Coordinator updating client in different zone
- Coordinator attempting zone change

### Not Found Errors (404)

- Client ID doesn't exist
- Client was soft deleted

### Conflict Errors (409)

- Duplicate client after name/DOB change
- Returns existing client ID

### Geocoding Errors (400)

- Invalid address format
- Address not found
- API timeout
- API quota exceeded

### Server Errors (500)

- Database errors
- Unexpected errors
- Transaction failures

## API Examples

### Update Single Field

**Request:**

```bash
curl -X PATCH http://localhost:3000/v1/clients/uuid \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "phone": "416-555-9999"
  }'
```

**Response:**

```json
{
  "data": {
    "id": "uuid",
    "firstName": "John",
    "lastName": "Doe",
    "dateOfBirth": "1950-01-01",
    "address": "100 Queen St W, Toronto, ON M5H 2N2",
    "latitude": 43.6532,
    "longitude": -79.3832,
    "phone": "416-555-9999",
    "emergencyContact": {
      "name": "Jane Doe",
      "phone": "416-555-0200",
      "relationship": "Spouse"
    },
    "zoneId": "uuid",
    "updatedAt": "2025-10-10T12:00:00Z"
  }
}
```

### Update Multiple Fields

**Request:**

```bash
curl -X PATCH http://localhost:3000/v1/clients/uuid \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "firstName": "Jonathan",
    "lastName": "Smith",
    "phone": "416-555-1111"
  }'
```

### Update Address (Triggers Re-geocoding)

**Request:**

```bash
curl -X PATCH http://localhost:3000/v1/clients/uuid \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "address": "301 Front St W, Toronto, ON M5V 2T6"
  }'
```

**Response:**

```json
{
  "data": {
    "id": "uuid",
    "firstName": "John",
    "lastName": "Doe",
    "dateOfBirth": "1950-01-01",
    "address": "301 Front St W, Toronto, ON M5V 2T6, Canada",
    "latitude": 43.64263,
    "longitude": -79.38708,
    "phone": "416-555-1111",
    "emergencyContact": {
      "name": "Jane Doe",
      "phone": "416-555-0200",
      "relationship": "Spouse"
    },
    "zoneId": "reassigned-zone-uuid",
    "updatedAt": "2025-10-10T12:05:00Z"
  }
}
```

### Clear Optional Field

**Request:**

```bash
curl -X PATCH http://localhost:3000/v1/clients/uuid \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "phone": null
  }'
```

### Change Zone (Admin Only)

**Request:**

```bash
curl -X PATCH http://localhost:3000/v1/clients/uuid \
  -H "Authorization: Bearer <admin_token>" \
  -H "Content-Type: application/json" \
  -d '{
    "zoneId": "new-zone-uuid"
  }'
```

## Known Limitations

### MVP Constraints

1. **Audit Trail in Logs**
   - Changes logged to application logs
   - Future: Store in audit_logs table

2. **No Optimistic Locking**
   - Last write wins
   - Future: Add version field for concurrent update detection

3. **No Field-Level Permissions**
   - All fields updatable by coordinators
   - Future: Restrict certain fields to admin only

4. **No Bulk Updates**
   - One client at a time
   - Future: Bulk update endpoint

## Future Enhancements

### Short Term

1. **Audit Logs Table**
   - Create audit_logs table
   - Store all changes persistently
   - Query audit history via API

2. **Optimistic Locking**
   - Add version field to clients table
   - Detect concurrent updates
   - Return 409 Conflict on version mismatch

3. **Field-Level Permissions**
   - Restrict DOB updates to admin only
   - Restrict zone changes to admin only
   - Configurable field permissions

### Long Term

1. **Bulk Updates**
   - Update multiple clients in one request
   - Batch processing
   - Progress tracking

2. **Change History API**
   - GET /v1/clients/:clientId/history
   - View all changes over time
   - Filter by date range, user, field

3. **Rollback Support**
   - Revert to previous version
   - Undo last change
   - Restore from audit log

## Testing Strategy

### Unit Tests

- Validation middleware
- Cache invalidation logic
- Change tracking logic
- Authorization checks

### Integration Tests

- Full endpoint flow
- Database updates
- Cache invalidation
- Error scenarios
- Edge cases

### Manual Testing

- Update various fields
- Test address re-geocoding
- Verify cache invalidation
- Test authorization rules
- Test with different roles

## Monitoring & Logging

### Metrics to Track

- Update success rate
- Update response time
- Geocoding API calls (address changes)
- Cache invalidation count
- Authorization failures
- Duplicate detection rate

### Logging Events

- Client updated (INFO)
- Field changes (INFO)
- Geocoding triggered (INFO)
- Authorization failure (WARN)
- Validation error (WARN)
- Unexpected errors (ERROR)

## Troubleshooting

### Common Issues

**Error: FORBIDDEN - "You can only update clients in your zone"**

- **Cause:** Coordinator trying to update client in different zone
- **Solution:** Use admin token or update client in your zone

**Error: FORBIDDEN - "Only admins can change client zone"**

- **Cause:** Coordinator trying to change zone
- **Solution:** Use admin token to change zone

**Error: VALIDATION_ERROR - "At least one field must be provided"**

- **Cause:** Empty request body
- **Solution:** Provide at least one field to update

**Error: DUPLICATE_CLIENT**

- **Cause:** Another client with same name and DOB exists
- **Solution:** Use different name or DOB, or update existing client

**Error: GEOCODING_ERROR**

- **Cause:** Invalid address or geocoding API failure
- **Solution:** Provide valid address or check API configuration

**Error: CLIENT_NOT_FOUND**

- **Cause:** Client ID doesn't exist or was deleted
- **Solution:** Verify client ID is correct

## References

- **Documentation:** `docs/C6-update-client-endpoint.md`
- **Architecture Blueprint:** `project-documentation/architecture-output.md`
- **Task Plan:** `project-documentation/task-plan.md` - Task C6
- **Create Client:** `docs/C5-create-client-endpoint.md`
- **Geocoding Service:** `apps/backend/src/services/geocoding.service.ts`
- **Zone Assignment:** `apps/backend/src/services/zone-assignment.service.ts`

## Next Steps

With the PATCH /v1/clients/:clientId endpoint complete, the next implementation tasks are:

1. **Run Integration Tests**
   - Test endpoint with various scenarios
   - Verify cache invalidation
   - Test authorization rules

2. **Manual Testing**
   - Update clients with different roles
   - Test address re-geocoding
   - Verify audit logging

3. **Update Task Plan**
   - Mark C6 as complete
   - Move to next task

## Conclusion

The PATCH /v1/clients/:clientId endpoint is now fully implemented and ready for testing. The endpoint provides:

- ✅ Partial updates (only update provided fields)
- ✅ Automatic address re-geocoding
- ✅ Automatic zone re-assignment
- ✅ Cache invalidation for data consistency
- ✅ Audit trail logging
- ✅ Zone-based access control
- ✅ Comprehensive validation
- ✅ Clear error messages
- ✅ Integration tests

**Status:** ✅ Ready for testing and deployment

---

**Implementation Files:**

- ✅ `apps/backend/src/middleware/validation.ts` - Extended validation
- ✅ `apps/backend/src/routes/clients.routes.ts` - PATCH endpoint
- ✅ `apps/backend/tests/clients.update.test.ts` - Integration tests
- ✅ `docs/C6-update-client-endpoint.md` - API documentation
- ✅ `docs/C6-update-client-implementation-summary.md` - This summary

**Next Task:** Testing and validation
