## Client Management API Implementation

**Feature Branch:** `feat/client-management`  
**Issue:** #3  
**Dependencies:** Authentication system (PR #2)  
**Estimated Effort:** 8.5 days

---

## Overview

This PR implements the complete Client Management API as specified in the BerthCare Technical Architecture Blueprint. It includes database schema for clients and care plans, CRUD endpoints with proper authentication/authorization, Redis caching, geocoding integration, and comprehensive testing.

---

## Implementation Checklist

### Database Schema (Tasks C1, C2)

- [ ] **C1: Clients Table Migration**
  - [ ] Create migration file `002_create_clients.sql`
  - [ ] Define `clients` table with all required fields:
    - id, first_name, last_name, date_of_birth
    - address, latitude, longitude, phone
    - emergency_contact_name, emergency_contact_phone, emergency_contact_relationship
    - zone_id, created_at, updated_at
  - [ ] Add index on `zone_id`
  - [ ] Add index on `last_name`
  - [ ] Create rollback migration `002_create_clients_rollback.sql`
  - [ ] Run migration successfully on local database
  - [ ] Verify schema matches specifications

- [ ] **C2: Care Plans Table Migration**
  - [ ] Create migration file `003_create_care_plans.sql`
  - [ ] Define `care_plans` table with all required fields:
    - id, client_id, summary
    - medications (JSONB), allergies (JSONB)
    - special_instructions (TEXT), version
    - created_at, updated_at
  - [ ] Add foreign key constraint to `clients` table
  - [ ] Add index on `client_id`
  - [ ] Create rollback migration `003_create_care_plans_rollback.sql`
  - [ ] Run migration successfully on local database
  - [ ] Verify foreign key relationships work

### API Endpoints

- [ ] **C3: GET /v1/clients (List Clients)**
  - [ ] Implement endpoint with pagination (default 50, max 100)
  - [ ] Add filtering by `zone_id`
  - [ ] Add search by name (first_name or last_name)
  - [ ] Return client summary with last visit date
  - [ ] Implement Redis caching (5 min TTL)
  - [ ] Require JWT authentication
  - [ ] Add integration tests:
    - Returns paginated clients
    - Filtering by zone works
    - Search by name works
    - Caching works (verify Redis hit)
    - Unauthorized access returns 401

- [ ] **C4: GET /v1/clients/:clientId (Get Client Details)**
  - [ ] Implement endpoint to fetch full client details
  - [ ] Include care plan in response
  - [ ] Include emergency contact information
  - [ ] Include recent visits (last 10)
  - [ ] Implement Redis caching (15 min TTL)
  - [ ] Require JWT authentication
  - [ ] Implement zone authorization (user can only access clients in their zone)
  - [ ] Add integration tests:
    - Returns full client data
    - 404 for non-existent client
    - 403 for client in different zone
    - Caching works
    - Cache invalidation on update

- [ ] **C5: POST /v1/clients (Create Client)**
  - [ ] Implement endpoint to create new client
  - [ ] Validate required fields (first_name, last_name, date_of_birth, address)
  - [ ] Integrate Google Maps Geocoding API to convert address to lat/long
  - [ ] Assign client to zone based on geocoded location
  - [ ] Create default care plan for new client
  - [ ] Require admin role authorization
  - [ ] Add integration tests:
    - Creates client successfully with valid data
    - Geocoding works and populates lat/long
    - Zone assignment works
    - Default care plan created
    - Validation errors return 400
    - Non-admin users get 403

- [ ] **C6: PATCH /v1/clients/:clientId (Update Client)**
  - [ ] Implement endpoint to update client details
  - [ ] Support partial updates (only update provided fields)
  - [ ] Invalidate Redis cache on successful update
  - [ ] Log changes to audit trail
  - [ ] Require coordinator or admin role
  - [ ] Add integration tests:
    - Updates client successfully
    - Partial updates work
    - Cache invalidated after update
    - Audit trail logged
    - 404 for non-existent client
    - 403 for insufficient permissions

- [ ] **C7: POST /v1/care-plans (Create/Update Care Plan)**
  - [ ] Implement endpoint to create or update care plan
  - [ ] Support versioning (increment version on each update)
  - [ ] Validate medications format (JSONB array)
  - [ ] Validate allergies format (JSONB array)
  - [ ] Require coordinator or admin role
  - [ ] Add integration tests:
    - Creates new care plan successfully
    - Updates existing care plan and increments version
    - Validation works for medications/allergies
    - 403 for insufficient permissions
    - Version history maintained

### Security & Authorization

- [ ] All endpoints require JWT authentication
- [ ] Zone-based authorization implemented for GET /v1/clients/:clientId
- [ ] Role-based authorization (admin, coordinator) implemented
- [ ] Input validation on all endpoints
- [ ] SQL injection protection (parameterized queries)
- [ ] Rate limiting configured

### Caching Strategy

- [ ] Redis caching implemented for GET /v1/clients (5 min TTL)
- [ ] Redis caching implemented for GET /v1/clients/:clientId (15 min TTL)
- [ ] Cache invalidation on POST /v1/clients
- [ ] Cache invalidation on PATCH /v1/clients/:clientId
- [ ] Cache invalidation on POST /v1/care-plans

### External Integrations

- [ ] Google Maps Geocoding API integration
- [ ] API key stored in environment variables
- [ ] Error handling for geocoding failures
- [ ] Fallback behavior if geocoding unavailable

### Testing

- [ ] Unit tests for all service functions
- [ ] Integration tests for all endpoints
- [ ] Test coverage ≥80%
- [ ] Edge cases covered:
  - Invalid input data
  - Missing required fields
  - Duplicate client detection
  - Geocoding API failures
  - Cache failures
  - Database connection errors
  - Unauthorized access attempts

### Documentation

- [ ] API endpoint documentation in `/docs/client-management-api.md`
- [ ] Database schema documented in migration files
- [ ] Code comments for complex business logic
- [ ] Update MIGRATION_SUMMARY.md with new migrations
- [ ] Update README.md with new endpoints

### Code Quality

- [ ] ESLint passes with no errors
- [ ] Prettier formatting applied
- [ ] TypeScript type checks pass
- [ ] No console.log statements (use Winston logger)
- [ ] Error handling follows project standards
- [ ] Consistent naming conventions

### CI/CD

- [ ] All CI checks pass (ESLint, Prettier, TypeScript, tests)
- [ ] No security vulnerabilities (npm audit, Snyk)
- [ ] Branch up to date with `main`

---

## Testing Instructions

### Local Setup

```bash
# Start local services
docker-compose up -d

# Run migrations
npm run migrate:up

# Start backend server
cd apps/backend
npm run dev
```

### Manual Testing

```bash
# 1. Create a client (admin only)
curl -X POST http://localhost:3000/v1/clients \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "first_name": "John",
    "last_name": "Doe",
    "date_of_birth": "1945-03-15",
    "address": "123 Main St, Toronto, ON M5V 3A8",
    "phone": "+14165551234",
    "emergency_contact_name": "Jane Doe",
    "emergency_contact_phone": "+14165555678",
    "emergency_contact_relationship": "Daughter"
  }'

# 2. List clients
curl http://localhost:3000/v1/clients \
  -H "Authorization: Bearer YOUR_TOKEN"

# 3. Get client details
curl http://localhost:3000/v1/clients/CLIENT_ID \
  -H "Authorization: Bearer YOUR_TOKEN"

# 4. Update client
curl -X PATCH http://localhost:3000/v1/clients/CLIENT_ID \
  -H "Authorization: Bearer YOUR_COORDINATOR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"phone": "+14165559999"}'

# 5. Create/update care plan
curl -X POST http://localhost:3000/v1/care-plans \
  -H "Authorization: Bearer YOUR_COORDINATOR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "client_id": "CLIENT_ID",
    "summary": "Daily medication management and mobility assistance",
    "medications": [
      {"name": "Metformin", "dosage": "500mg", "frequency": "twice daily"}
    ],
    "allergies": [
      {"allergen": "Penicillin", "severity": "severe"}
    ],
    "special_instructions": "Client prefers morning visits before 10am"
  }'
```

### Run Tests

```bash
# Run all tests
npm test

# Run client management tests only
npm test -- apps/backend/tests/clients

# Check test coverage
npm run test:coverage
```

---

## Performance Considerations

- [ ] Database queries optimized with proper indexes
- [ ] Redis caching reduces database load
- [ ] Pagination prevents large result sets
- [ ] Geocoding results cached to avoid repeated API calls
- [ ] Connection pooling configured for PostgreSQL

---

## Security Considerations

- [ ] All endpoints require authentication
- [ ] Zone-based authorization prevents cross-zone access
- [ ] Role-based authorization for admin/coordinator actions
- [ ] Input validation prevents injection attacks
- [ ] Sensitive data (emergency contacts) only accessible to authorized users
- [ ] Audit trail logs all client data modifications

---

## Rollback Plan

If issues are discovered after merge:

1. Revert the PR: `git revert MERGE_COMMIT_SHA`
2. Roll back database migrations:
   ```bash
   npm run migrate:down -- 003_create_care_plans
   npm run migrate:down -- 002_create_clients
   ```
3. Clear Redis cache: `redis-cli FLUSHDB`

---

## Review Checklist

**For Reviewers:**

- [ ] Code follows project architecture and patterns
- [ ] All acceptance criteria met
- [ ] Tests are comprehensive and pass
- [ ] Security best practices followed
- [ ] Performance considerations addressed
- [ ] Documentation is clear and complete
- [ ] No breaking changes to existing APIs
- [ ] Database migrations are reversible

---

## Related Issues

- Closes #3
- Depends on #2 (Authentication system)
- Blocks #4 (Visit documentation - requires client data)

---

## Merge Strategy

**Squash and merge** with commit message:

```
feat: implement client management API

- Add clients and care_plans database schema
- Implement CRUD endpoints for client management
- Add Google Maps geocoding integration
- Implement Redis caching for performance
- Add comprehensive tests (80%+ coverage)
- Add zone-based and role-based authorization

Closes #3
```
