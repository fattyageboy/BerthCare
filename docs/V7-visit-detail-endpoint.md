# V7: GET /api/v1/visits/:visitId Endpoint

**Task ID:** V7  
**Status:** ✅ Complete  
**Date:** October 11, 2025  
**Endpoint:** GET /api/v1/visits/:visitId  
**Estimated Effort:** 1 day  
**Actual Effort:** 1 day

---

## Overview

Implemented the GET /api/v1/visits/:visitId endpoint to retrieve complete visit details including documentation, photos, and client information. This endpoint supports the mobile app's need to display full visit information with proper authorization and caching.

---

## Endpoint Specification

### GET /api/v1/visits/:visitId

**Purpose:** Retrieve complete visit details with all related data

**Authentication:** Required (JWT token)

**Authorization:**

- Caregivers can only view their own visits
- Coordinators can view visits in their zone
- Admins can view visits in their zone

**URL Parameters:**

- `visitId` (UUID, required): The visit identifier

**Response: 200 OK**

```typescript
{
  data: {
    id: string;
    clientId: string;
    staffId: string;
    scheduledStartTime: string;      // ISO 8601
    checkInTime: string | null;      // ISO 8601
    checkInLatitude: number | null;
    checkInLongitude: number | null;
    checkOutTime: string | null;     // ISO 8601
    checkOutLatitude: number | null;
    checkOutLongitude: number | null;
    status: string;                  // 'scheduled' | 'in_progress' | 'completed' | 'cancelled'
    duration: number | null;         // Minutes
    copiedFromVisitId: string | null;
    createdAt: string;               // ISO 8601
    updatedAt: string;               // ISO 8601
    client: {
      id: string;
      firstName: string;
      lastName: string;
      dateOfBirth: string;           // ISO 8601
      address: string;
      latitude: number;
      longitude: number;
      phone: string;
      emergencyContact: {
        name: string;
        phone: string;
        relationship: string;
      };
      zoneId: string;
    };
    staff: {
      id: string;
      firstName: string;
      lastName: string;
      email: string;
    };
    documentation: {
      vitalSigns: object | null;
      activities: object | null;
      observations: string | null;
      concerns: string | null;
      createdAt: string;             // ISO 8601
      updatedAt: string;             // ISO 8601
    } | null;
    photos: Array<{
      id: string;
      s3Key: string;
      s3Url: string;
      thumbnailS3Key: string;
      uploadedAt: string;            // ISO 8601
    }>;
  }
}
```

**Errors:**

- **400 Bad Request:** Invalid visitId format
- **401 Unauthorized:** Missing or invalid authentication token
- **403 Forbidden:** User not authorized to view this visit
- **404 Not Found:** Visit not found
- **500 Internal Server Error:** Server error

---

## Implementation Details

### File: `apps/backend/src/routes/visits.routes.ts`

**Key Features:**

1. **UUID Validation**
   - Validates visitId format before querying database
   - Returns 400 for invalid UUIDs

2. **Authorization Logic**
   - Caregivers: Can only view visits where they are the staff member
   - Coordinators/Admins: Can view visits where the client is in their zone
   - Authorization checked even with cached data

3. **Data Aggregation**
   - Single query joins visits, clients, and users tables
   - Separate queries for documentation and photos
   - Efficient data retrieval with proper indexing

4. **Redis Caching**
   - Cache key: `visit:detail:{visitId}`
   - TTL: 5 minutes (300 seconds)
   - Authorization still enforced on cache hits
   - Cache invalidated on visit updates

5. **Response Structure**
   - Complete visit information
   - Nested client object with emergency contact
   - Nested staff object
   - Documentation object (null if none exists)
   - Photos array (empty if none exist)

---

## Database Queries

### Main Visit Query

```sql
SELECT
  v.id,
  v.client_id,
  v.staff_id,
  v.scheduled_start_time,
  v.check_in_time,
  v.check_in_latitude,
  v.check_in_longitude,
  v.check_out_time,
  v.check_out_latitude,
  v.check_out_longitude,
  v.status,
  v.duration_minutes,
  v.copied_from_visit_id,
  v.created_at,
  v.updated_at,
  c.first_name as client_first_name,
  c.last_name as client_last_name,
  c.date_of_birth as client_date_of_birth,
  c.address as client_address,
  c.latitude as client_latitude,
  c.longitude as client_longitude,
  c.phone as client_phone,
  c.emergency_contact_name,
  c.emergency_contact_phone,
  c.emergency_contact_relationship,
  c.zone_id as client_zone_id,
  u.first_name as staff_first_name,
  u.last_name as staff_last_name,
  u.email as staff_email
FROM visits v
INNER JOIN clients c ON v.client_id = c.id
INNER JOIN users u ON v.staff_id = u.id
WHERE v.id = $1
```

**Indexes Used:**

- Primary key on `visits.id`
- Foreign key indexes on `visits.client_id` and `visits.staff_id`

### Documentation Query

```sql
SELECT
  vital_signs,
  activities,
  observations,
  concerns,
  created_at,
  updated_at
FROM visit_documentation
WHERE visit_id = $1
```

**Indexes Used:**

- Index on `visit_documentation.visit_id`

### Photos Query

```sql
SELECT
  id,
  s3_key,
  s3_url,
  thumbnail_s3_key,
  uploaded_at
FROM visit_photos
WHERE visit_id = $1
ORDER BY uploaded_at ASC
```

**Indexes Used:**

- Index on `visit_photos.visit_id`

---

## Testing

### File: `apps/backend/tests/visits.detail.test.ts`

**Test Coverage:**

1. **Authentication Tests**
   - ✅ Returns 401 without token
   - ✅ Returns 401 with invalid token

2. **Authorization Tests**
   - ✅ Allows caregiver to view their own visit
   - ✅ Denies caregiver from viewing another caregiver's visit
   - ✅ Allows coordinator to view visits in their zone
   - ✅ Denies coordinator from viewing visits in different zone

3. **Response Format Tests**
   - ✅ Returns complete visit data with client info
   - ✅ Returns visit with documentation and photos
   - ✅ Returns null documentation if none exists

4. **Validation Tests**
   - ✅ Returns 400 for invalid visitId format
   - ✅ Returns 404 for non-existent visit

5. **Caching Tests**
   - ✅ Caches visit details (5 min TTL)
   - ✅ Still enforces authorization with cached data

**Test Execution:**

```bash
npm run test -- visits.detail.test.ts
```

---

## Security Considerations

### Authorization Enforcement

**Caregiver Access:**

- Can only view visits where `visit.staff_id === userId`
- Prevents caregivers from viewing other caregivers' visits

**Coordinator/Admin Access:**

- Can view visits where `client.zone_id === user.zone_id`
- Zone-based isolation ensures data privacy

**Cache Security:**

- Authorization checked even with cached data
- Prevents unauthorized access via cache poisoning
- User validation occurs before returning cached response

### Data Privacy

**Client Information:**

- Full client details only visible to authorized users
- Emergency contact information included for care coordination
- GPS coordinates included for route planning

**Visit Documentation:**

- Sensitive health information (vital signs, observations)
- Only accessible to authorized caregivers and coordinators
- Audit trail maintained via created_at/updated_at timestamps

---

## Performance Optimizations

### Database Optimization

1. **Single Query for Main Data**
   - Joins visits, clients, and users in one query
   - Reduces round trips to database
   - Leverages existing foreign key indexes

2. **Separate Queries for Optional Data**
   - Documentation and photos fetched separately
   - Allows for efficient caching
   - Reduces payload size when data doesn't exist

3. **Index Usage**
   - Primary key lookup on visits (O(log n))
   - Foreign key indexes on joins
   - Index on visit_documentation.visit_id
   - Index on visit_photos.visit_id

### Caching Strategy

**Cache Key:** `visit:detail:{visitId}`

**TTL:** 5 minutes (300 seconds)

**Rationale:**

- Visit details change infrequently once completed
- 5-minute TTL balances freshness and performance
- Cache invalidated on visit updates

**Cache Invalidation:**

- Explicit invalidation on PATCH /v1/visits/:visitId
- Prevents stale data after updates
- Maintains data consistency

### Response Time Targets

- **Cache Hit:** <50ms
- **Cache Miss:** <200ms
- **With Documentation & Photos:** <300ms

---

## Error Handling

### Validation Errors

**Invalid UUID Format:**

```json
{
  "error": "Bad Request",
  "message": "Invalid visitId format"
}
```

**Visit Not Found:**

```json
{
  "error": "Not Found",
  "message": "Visit not found"
}
```

### Authorization Errors

**Caregiver Viewing Another's Visit:**

```json
{
  "error": "Forbidden",
  "message": "You can only view your own visits"
}
```

**Coordinator Viewing Different Zone:**

```json
{
  "error": "Forbidden",
  "message": "You can only view visits in your zone"
}
```

### Server Errors

**Database Error:**

```json
{
  "error": "Internal Server Error",
  "message": "Failed to fetch visit details"
}
```

**Logging:**

- All errors logged with context (visitId, userId)
- Sentry integration for production error tracking
- Audit trail for security events

---

## Integration with Other Endpoints

### Related Endpoints

**GET /api/v1/visits**

- List endpoint provides visit summaries
- Detail endpoint provides complete information
- Consistent authorization logic

**PATCH /api/v1/visits/:visitId**

- Update endpoint invalidates detail cache
- Ensures data consistency
- Maintains audit trail

**POST /api/v1/visits/:visitId/photos**

- Photo upload updates photos array
- Cache invalidation ensures fresh data
- Consistent response structure

### Mobile App Integration

**Use Cases:**

1. **Visit Detail Screen**
   - Display complete visit information
   - Show client details and emergency contact
   - Display documentation and photos

2. **Offline Support**
   - Mobile app caches visit details locally
   - Syncs with server when online
   - Conflict resolution via updated_at timestamps

3. **Care Coordination**
   - Coordinators review completed visits
   - Access to full documentation and photos
   - Zone-based access control

---

## Design Decisions

### Decision 1: Single Endpoint for All Visit Data

**Rationale:**

- Mobile app needs complete visit information
- Reduces number of API calls
- Simplifies client-side logic

**Trade-offs:**

- Larger response payload
- More complex query
- Acceptable for detail view use case

**Mitigation:**

- Redis caching reduces database load
- Efficient queries with proper indexing
- Gzip compression reduces network payload

### Decision 2: Authorization on Cache Hits

**Rationale:**

- Security cannot be compromised for performance
- Prevents unauthorized access via cache
- Maintains consistent authorization logic

**Trade-offs:**

- Additional database query on cache hits
- Slightly slower cache hit performance
- Worth it for security guarantee

**Implementation:**

- User validation query is fast (indexed)
- Authorization check is in-memory
- Minimal performance impact

### Decision 3: Null Documentation vs Empty Object

**Rationale:**

- Null clearly indicates no documentation exists
- Distinguishes from empty documentation
- Simplifies client-side logic

**Trade-offs:**

- Client must handle null case
- Consistent with REST best practices
- Clear semantic meaning

### Decision 4: Include Client and Staff Details

**Rationale:**

- Mobile app needs this data for display
- Reduces need for additional API calls
- Improves user experience

**Trade-offs:**

- Larger response payload
- More complex query
- Acceptable for detail view

**Mitigation:**

- Data is needed anyway
- Single query is efficient
- Caching reduces repeated fetches

---

## Future Enhancements

### Potential Improvements

1. **Partial Response Support**
   - Add `fields` query parameter
   - Allow clients to request specific fields
   - Reduces payload size for specific use cases

2. **ETag Support**
   - Add ETag header based on updated_at
   - Support conditional requests (If-None-Match)
   - Reduces bandwidth for unchanged data

3. **GraphQL Alternative**
   - Consider GraphQL for flexible queries
   - Allows clients to request exact data needed
   - Reduces over-fetching

4. **Real-time Updates**
   - WebSocket support for live updates
   - Push notifications on visit changes
   - Improves coordinator experience

---

## Related Documentation

- [V1: Visits Migration](./V1-visits-migration.md)
- [V2: Visit Documentation Migration](./V2-visit-documentation-migration.md)
- [V3: Visit Photos Migration](./V3-visit-photos-migration.md)
- [V4: Create Visit Endpoint](./V4-create-visit-endpoint.md)
- [V5: Update Visit Endpoint](./V5-update-visit-endpoint.md)
- [V6: List Visits Endpoint](./V6-list-visits-endpoint.md)
- [Architecture Blueprint](../project-documentation/architecture-output.md)
- [Task Plan](../project-documentation/task-plan.md)

---

## Success Criteria

- ✅ Endpoint implemented and tested
- ✅ Returns complete visit data with all related information
- ✅ Authorization enforced (caregiver owns visit or coordinator in same zone)
- ✅ Redis caching implemented (5 min TTL)
- ✅ Returns 404 for non-existent visits
- ✅ Returns 403 for unauthorized access
- ✅ Returns 400 for invalid visitId format
- ✅ Integration tests passing
- ✅ Documentation complete

---

**Status:** ✅ Complete  
**Next Task:** V8 - Implement photo upload flow
