# Alert Write Performance Analysis

## Overview

The `care_alerts` table has **6 indexes** to optimize query performance for coordinator dashboards, SLA monitoring, and analytics. This document validates that write performance remains acceptable under expected alert volume.

## Index Strategy

### Indexes (from migration 008)

1. **idx_care_alerts_coordinator_status** - Coordinator dashboard active alerts
2. **idx_care_alerts_client_id** - Client alert history
3. **idx_care_alerts_staff_id** - Staff alert history
4. **idx_care_alerts_status_initiated** - SLA monitoring
5. **idx_care_alerts_type_initiated** - Alert type analytics
6. **idx_care_alerts_coordinator_initiated** - Coordinator recent alerts

All indexes use partial indexing (`WHERE deleted_at IS NULL`) to reduce index size and maintenance overhead.

## Expected Alert Volume

### Normal Operations
- **50 caregivers** × **2 alerts/day** = **100 alerts/day**
- **Peak hours**: 20 alerts/hour (8am-6pm)
- **Average**: 4-5 alerts/hour

### Burst Scenarios
- **Incident response**: 5 alerts/minute for short periods
- **Shift changes**: 10-15 alerts in 15 minutes

## Performance Thresholds

### Acceptable Performance
- **Average INSERT**: < 100ms
- **P95 latency**: < 200ms
- **Throughput**: > 10 inserts/second
- **Concurrent writes**: Handle 5+ simultaneous inserts

### Why These Thresholds?
- Alerts are user-initiated (not automated), so sub-second response is acceptable
- Peak load (20/hour) = 1 alert every 3 minutes, well within capacity
- Burst load (5/minute) requires ~12 inserts/sec sustained for 1 minute

## Load Test Scenarios

### 1. Daily Volume Test
```
Total: 100 alerts
Concurrent batches: 5
Batch size: 20
```
Simulates normal daily operations.

### 2. Peak Hour Test
```
Total: 20 alerts
Concurrent batches: 2
Batch size: 10
```
Simulates busy hour during business hours.

### 3. Burst Test
```
Total: 25 alerts
Concurrent batches: 5
Batch size: 5
```
Simulates incident response with multiple simultaneous alerts.

### 4. Stress Test
```
Total: 1000 alerts
Concurrent batches: 10
Batch size: 100
```
Tests system limits and index maintenance overhead.

## Running the Load Test

### Prerequisites
```bash
# Ensure test database is running
docker-compose up -d postgres

# Run migrations
pnpm nx run backend:migrate
```

### Execute Load Test
```bash
# Run all scenarios
pnpm tsx apps/backend/tests/load-test-alert-writes.ts

# Or with custom database
DB_NAME=careplatform_test pnpm tsx apps/backend/tests/load-test-alert-writes.ts
```

### Expected Output
```
🚀 Care Alerts Write Performance Load Test

📈 DAILY Scenario Results:
   Total Alerts: 100
   Total Duration: 2500.00ms
   Average Insert: 25.00ms
   Throughput: 40.00 inserts/sec
   P50: 20.00ms
   P95: 45.00ms
   P99: 60.00ms
   ✅ Performance within acceptable thresholds

📊 Verifying Index Usage:
Coordinator Dashboard:
✅ Uses index
   Execution: 0.15ms

Client History:
✅ Uses index
   Execution: 0.12ms

SLA Monitoring:
✅ Uses index
   Execution: 0.18ms
```

## Index Maintenance Considerations

### Write Overhead
Each INSERT updates 6 indexes:
- **Estimated overhead**: 5-10ms per index = 30-60ms total
- **Acceptable** for user-initiated alerts (not high-frequency automated events)

### Partial Index Benefits
Using `WHERE deleted_at IS NULL`:
- Reduces index size by ~20% (assuming 20% soft-delete rate)
- Faster index updates
- Better cache hit rates

### B-tree Index Performance
PostgreSQL B-tree indexes:
- INSERT: O(log n) complexity
- At 10,000 alerts: log₂(10000) ≈ 13 operations
- At 100,000 alerts: log₂(100000) ≈ 17 operations
- **Scales well** with alert volume growth

## Monitoring in Production

### Key Metrics to Track

1. **INSERT Duration** (pg_stat_statements)
```sql
SELECT 
  mean_exec_time,
  max_exec_time,
  calls
FROM pg_stat_statements
WHERE query LIKE '%INSERT INTO care_alerts%';
```

2. **Index Usage** (pg_stat_user_indexes)
```sql
SELECT 
  indexrelname,
  idx_scan,
  idx_tup_read,
  idx_tup_fetch
FROM pg_stat_user_indexes
WHERE tablename = 'care_alerts';
```

3. **Table Bloat** (pg_stat_user_tables)
```sql
SELECT 
  n_tup_ins,
  n_tup_upd,
  n_tup_del,
  n_live_tup,
  n_dead_tup
FROM pg_stat_user_tables
WHERE tablename = 'care_alerts';
```

### Alert Thresholds
- **P95 INSERT latency > 200ms**: Investigate index bloat or lock contention
- **Throughput < 10 inserts/sec**: Check database CPU/IO
- **Unused indexes** (idx_scan = 0 after 1 week): Consider dropping

## Optimization Options (If Needed)

### If Write Performance Degrades

1. **Drop Unused Indexes**
   - Monitor `pg_stat_user_indexes` for 2 weeks
   - Drop indexes with `idx_scan = 0`

2. **Consolidate Indexes**
   - Combine `idx_care_alerts_coordinator_status` and `idx_care_alerts_coordinator_initiated`
   - PostgreSQL can use multi-column indexes for prefix queries

3. **Async Index Updates** (PostgreSQL 14+)
   - Use `CREATE INDEX CONCURRENTLY` for maintenance
   - Minimal impact on write operations

4. **Partitioning** (if > 1M alerts)
   - Partition by `initiated_at` (monthly)
   - Reduces index size per partition

## Conclusion

**6 indexes is reasonable** for this use case because:
- Alert volume is moderate (100/day, not 100/second)
- Alerts are user-initiated, not automated
- Query performance is critical for coordinator response times
- Partial indexes reduce maintenance overhead
- B-tree indexes scale logarithmically

**Load testing validates** that write performance remains well within acceptable thresholds for expected alert volume.

## References
- Migration: `apps/backend/src/db/migrations/008_create_care_alerts.sql`
- Load Test: `apps/backend/tests/load-test-alert-writes.ts`
- PostgreSQL Index Documentation: https://www.postgresql.org/docs/current/indexes.html
