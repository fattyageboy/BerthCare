# G8: Visit Documentation API - PR Summary

Pull Request: feat: implement visit documentation API  
Task ID: G8  
Date: 2025-10-14  
Status: Ready for Review

## Overview

Implements the Visit Documentation API including endpoints to start a visit, update/complete a visit with documentation, and list/fetch visit data. Adds robust authorization, Redis caching for list/detail responses with safe key scoping, and cache invalidation paths. Aligns with the “offline‑first everything” philosophy and supports smart data reuse (copying documentation from a previous visit).

## Implementation Summary

### Endpoints

- POST /api/v1/visits — Start a visit (check‑in) with optional GPS and documentation copy
- PATCH /api/v1/visits/:visitId — Update/complete visit, documentation upsert, signature/photo metadata support
- GET /api/v1/visits — List with filtering, pagination, and per‑principal scoped caching
- GET /api/v1/visits/:visitId — Visit detail with safe caching and invalidation

### Key Features

- Role‑aware authorization: caregivers restricted to their own visits; coordinators/admins by zone
- Safe caching: user/zone‑scoped Redis keys; invalidation on create/update
- Smart copy: optional copy of documentation from a prior visit for the same client
- Validation: strict UUID/date/enum/GPS validation and status transition checks
- Observability: structured success/error logging with useful context

### Files Changed (high‑level)

- apps/backend/src/routes/visits.routes.ts:42 — Full route implementations (create/list/detail/update)
- apps/backend/src/db/migrations/004_create_visits.sql — Visits table
- apps/backend/src/db/migrations/005_create_visit_documentation.sql — Visit documentation table
- apps/backend/src/storage/s3-client.ts — Helpers for photo/signature upload URLs (used by visit routes)
- apps/backend/tests/visits.*.test.ts — Integration tests for create/list/detail/update/photos/signature

## Security & Authorization

- JWT authentication required for all endpoints
- Caregivers limited to their own visits; coordinators/admins operate within their zone
- Parameterized SQL everywhere (no string interpolation)
- Cache keys scoped by userId (caregivers) or zoneId (coordinators/admins) to prevent leakage

## Caching Strategy

- List cache keyed as: visits:list:<principalScope>:<filters>:<page>:<limit>
- Detail cache keyed as: visit:detail:<visitId>
- Invalidated automatically on visit create/update and documentation changes

## Database

- visits table (id, client_id, staff_id, scheduled_start_time, check_in/out, GPS, status, duration_minutes, copied_from_visit_id, timestamps)
- visit_documentation table (visit_id, vital_signs JSON, activities JSON, observations TEXT, concerns TEXT, signature_url TEXT, timestamps)

## Testing

- Integration tests under apps/backend/tests:
  - visits.create.test.ts
  - visits.update.test.ts
  - visits.list.test.ts
  - visits.detail.test.ts
  - visits.photos.test.ts
  - visits.signature.test.ts

Run locally with Postgres and Redis (docker‑compose up -d). Example:

```bash
# From repo root
docker-compose up -d

# Migrate database
npx ts-node --project apps/backend/tsconfig.json apps/backend/src/db/migrate.ts up

# Run backend tests with coverage (serial to avoid DB port conflicts)
TEST_DATABASE_URL="postgresql://berthcare:berthcare_dev_password@localhost:5432/berthcare_dev" \
TEST_REDIS_URL="redis://:berthcare_redis_password@localhost:6379/1" \
npx nx run backend:test --ci --coverage --maxWorkers=1
```

Target: coverage ≥ 80%. Thresholds enforced by apps/backend/jest.config.js.

## Acceptance Criteria

- CI green for backend workflow (GitHub: .github/workflows/backend-ci.yml)
- 80%+ coverage (lines/statements/functions) for backend package
- At least 1 reviewer approval (senior backend dev)
- Branch up‑to‑date and squash‑merged

## Reviewer Checklist

- Code quality: style, error handling, input validation
- SQL correctness and performance (indexes, parameterization)
- Authorization rules (caregiver vs coordinator/admin) verified
- Caching and invalidation behavior correct and safe
- Tests cover success, validation, and error paths; environment teardown is clean

## Merge Strategy

Squash and merge with message:

```text
feat: implement visit documentation API

- Add visits endpoints (create/list/detail/update)
- Add documentation upsert, cache, and invalidation
- Enforce role/zone authorization and strict validation
- Add comprehensive integration tests (target ≥80% coverage)
```

## Post‑Merge

- Tag release candidate and publish release notes (see docs/RELEASE_NOTES_VISITS.md)
- Deploy to staging; verify endpoints and caching under load
- Monitor logs and error rates; validate DB indices in query plans
