# Release Notes: Visit Documentation API v1.0.0

Release Date: 2025-10-14  
Version: 1.0.0  
Type: Feature Release

## Summary

Introduces the Visit Documentation API, enabling caregivers to start, document, and complete visits with secure role/zone‑based authorization, efficient Redis caching, and options to reuse prior documentation to minimize data entry.

## New Endpoints

- POST /api/v1/visits — Start a visit (check‑in) with optional GPS and documentation copy
- PATCH /api/v1/visits/:visitId — Update/complete visit (status, times, documentation upsert)
- GET /api/v1/visits — List with filtering, pagination, and scoped caching
- GET /api/v1/visits/:visitId — Visit detail with safe caching and invalidation

Photos and signature uploads are supported in this release via pre-signed URLs within visit tasks, and the metadata endpoints are integrated into the visits routes as part of this launch.

## Security

- JWT authentication required for all endpoints
- Caregiver access limited to own visits; coordinators/admins by zone
- Parameterized SQL for all DB operations
- Redis keys scoped per principal to prevent cross‑user data leakage

## Performance

- Pagination with sane defaults (limit 50, max 100)
- Indexed queries on visits (client_id, staff_id, scheduled_start_time, status)
- Redis caching on list/detail with 5‑minute TTL and precise invalidation

## Database

- 004_create_visits.sql — Visits table
- 005_create_visit_documentation.sql — Visit documentation table

## Testing

- Integration tests cover create, update, list, and detail flows, including validation and authorization scenarios
- Coverage target ≥ 80% enforced in apps/backend/jest.config.js

## Configuration

Environment variables (see `.env.example`):

- Database: `TEST_DATABASE_URL` for tests; `DATABASE_URL` for runtime
- Redis: `TEST_REDIS_URL` for tests; `REDIS_URL` for runtime
- Optional S3 buckets for photos/signatures (see storage docs)

## Upgrade Guide

1. Run migrations on the target environment:
   
   ```bash
   npx ts-node --project apps/backend/tsconfig.json apps/backend/src/db/migrate.ts up
   ```
2. Deploy backend service
3. Validate endpoints and caching behavior in staging

## Known Issues

- None at this time

## Future Enhancements

- Dedicated endpoints for documentation read/write (fine‑grained updates)
- Multiple signature fields (caregiver, client, family) or visit_signatures table
- Offline delta sync optimizations for low‑connectivity scenarios
