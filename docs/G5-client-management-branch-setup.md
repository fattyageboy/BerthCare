# G5: Client Management Feature Branch Setup

**Task ID:** G5  
**Date:** October 10, 2025  
**Status:** ✅ Complete  
**Branch:** `feat/client-management`  
**Issue:** #3  
**Dependencies:** G4 (Authentication system merged)

---

## Summary

Successfully created the feature branch for client management implementation and prepared comprehensive PR template with detailed checklist covering all requirements from the task plan.

---

## Actions Completed

### 1. Branch Creation

- ✅ Created branch `feat/client-management` from `main`
- ✅ Pushed branch to remote repository
- ✅ Branch is clean and up to date with main

### 2. PR Template Creation

- ✅ Created comprehensive PR template at `.github/PULL_REQUEST_TEMPLATE/client-management-pr.md`
- ✅ Included detailed checklist for all tasks (C1-C7)
- ✅ Added testing instructions and manual test commands
- ✅ Documented security and performance considerations
- ✅ Included rollback plan and review checklist

### 3. Checklist Coverage

The PR template includes comprehensive checklists for:

#### Database Schema (C1, C2)

- Clients table migration with all required fields
- Care plans table migration with JSONB support
- Proper indexes and foreign key constraints
- Rollback migrations

#### API Endpoints (C3-C7)

- **GET /v1/clients** - List with pagination, filtering, caching
- **GET /v1/clients/:clientId** - Details with authorization
- **POST /v1/clients** - Create with geocoding integration
- **PATCH /v1/clients/:clientId** - Update with cache invalidation
- **POST /v1/care-plans** - Create/update with versioning

#### Security & Quality

- JWT authentication on all endpoints
- Zone-based authorization
- Role-based authorization (admin, coordinator)
- Input validation and SQL injection protection
- 80%+ test coverage requirement
- ESLint, Prettier, TypeScript checks

---

## Next Steps

### To Create the Draft PR on GitHub:

1. **Visit the PR creation URL:**

   ```
   https://github.com/fattyageboy/BerthCare/pull/new/feat/client-management
   ```

2. **Configure the PR:**
   - Title: `[DRAFT] feat: Client Management API`
   - Base branch: `main`
   - Compare branch: `feat/client-management`
   - Mark as **Draft PR**
   - Link to issue #3 in the description

3. **The PR template will auto-populate** with the comprehensive checklist

4. **Add labels:**
   - `feature`
   - `backend`
   - `in-progress`

5. **Assign:**
   - Assignee: Backend developer
   - Reviewers: Senior backend dev (for final review)

---

## Implementation Roadmap

Following the task plan, the implementation will proceed in this order:

### Phase 1: Database Schema (0.5d each)

1. **C1:** Create clients table migration
2. **C2:** Create care_plans table migration
3. Run migrations and verify schema

### Phase 2: Read Endpoints (3.5d total)

4. **C3:** Implement GET /v1/clients (list with pagination) - 2d
5. **C4:** Implement GET /v1/clients/:clientId (details) - 1.5d

### Phase 3: Write Endpoints (5d total)

6. **C5:** Implement POST /v1/clients (create with geocoding) - 2d
7. **C6:** Implement PATCH /v1/clients/:clientId (update) - 1.5d
8. **C7:** Implement POST /v1/care-plans (create/update) - 1.5d

### Phase 4: Testing & Review (0.25d)

9. **G6:** CI checks, code review, merge

**Total Estimated Effort:** 9.75 days

---

## Technical Requirements

### Database Schema

#### Clients Table

```sql
CREATE TABLE clients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  first_name VARCHAR(100) NOT NULL,
  last_name VARCHAR(100) NOT NULL,
  date_of_birth DATE NOT NULL,
  address TEXT NOT NULL,
  latitude DECIMAL(10, 8),
  longitude DECIMAL(11, 8),
  phone VARCHAR(20),
  emergency_contact_name VARCHAR(200),
  emergency_contact_phone VARCHAR(20),
  emergency_contact_relationship VARCHAR(100),
  zone_id UUID NOT NULL REFERENCES zones(id),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_clients_zone_id ON clients(zone_id);
CREATE INDEX idx_clients_last_name ON clients(last_name);
```

#### Care Plans Table

```sql
CREATE TABLE care_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  summary TEXT,
  medications JSONB DEFAULT '[]'::jsonb,
  allergies JSONB DEFAULT '[]'::jsonb,
  special_instructions TEXT,
  version INTEGER DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_care_plans_client_id ON care_plans(client_id);
```

### API Endpoints

| Method | Endpoint              | Auth | Role              | Description                  |
| ------ | --------------------- | ---- | ----------------- | ---------------------------- |
| GET    | /v1/clients           | JWT  | Any               | List clients with pagination |
| GET    | /v1/clients/:clientId | JWT  | Zone-based        | Get client details           |
| POST   | /v1/clients           | JWT  | Admin             | Create new client            |
| PATCH  | /v1/clients/:clientId | JWT  | Coordinator/Admin | Update client                |
| POST   | /v1/care-plans        | JWT  | Coordinator/Admin | Create/update care plan      |

### External Dependencies

- **Google Maps Geocoding API** - For address to lat/long conversion
- **Redis** - For caching client data
- **PostgreSQL** - Primary data store

---

## Success Criteria

The feature will be considered complete when:

- ✅ All database migrations run successfully
- ✅ All 5 API endpoints implemented and tested
- ✅ Test coverage ≥80%
- ✅ All CI checks pass (ESLint, Prettier, TypeScript, tests)
- ✅ Security review passed
- ✅ Code review approved by senior backend dev
- ✅ Documentation complete
- ✅ PR merged to main

---

## References

- **Task Plan:** `project-documentation/task-plan.md` - Phase C (Client Management API)
- **Architecture:** `project-documentation/architecture-output.md` - Client Management section
- **Design Docs:** `design-documentation/features/family-portal/README.md`
- **Previous PR:** G4 Authentication system (merged)
- **Next Phase:** G7 Visit Documentation (depends on this)

---

## Notes

- This feature depends on the authentication system (G4) being merged first
- The visit documentation feature (Phase V) depends on this being complete
- Google Maps API key must be configured in environment variables
- Redis must be running for caching to work
- Zone data must exist in database for zone assignment to work

---

## CI Trigger

The branch has been pushed and CI will automatically run on the first commit. The draft PR should be created on GitHub to track progress through the checklist.

**GitHub PR URL:** https://github.com/fattyageboy/BerthCare/pull/new/feat/client-management
