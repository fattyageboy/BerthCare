/**
 * Load Test: Care Alerts Write Performance
 *
 * Tests INSERT throughput on care_alerts table with 6 indexes
 * to validate acceptable write performance under expected alert volume.
 *
 * Expected Volume:
 * - 50 caregivers × 2 alerts/day = 100 alerts/day
 * - Peak: 20 alerts/hour during business hours
 * - Burst: 5 alerts/minute during incidents
 */

import { performance } from 'perf_hooks';

import { Pool } from 'pg';

import { env } from '../src/config/env';
import { logInfo, logWarn } from '../src/config/logger';

interface LoadTestConfig {
  totalAlerts: number;
  concurrentBatches: number;
  batchSize: number;
}

interface LoadTestResult {
  totalAlerts: number;
  totalDurationMs: number;
  averageInsertMs: number;
  insertsPerSecond: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
}

// Test configurations for different scenarios
const TEST_SCENARIOS: Record<string, LoadTestConfig> = {
  daily: { totalAlerts: 100, concurrentBatches: 5, batchSize: 20 },
  peak: { totalAlerts: 20, concurrentBatches: 2, batchSize: 10 },
  burst: { totalAlerts: 25, concurrentBatches: 5, batchSize: 5 },
  stress: { totalAlerts: 1000, concurrentBatches: 10, batchSize: 100 },
};

class AlertWriteLoadTest {
  private pool: Pool;
  private insertTimes: number[] = [];

  constructor() {
    this.pool = new Pool({
      host: env.postgres.host,
      port: env.postgres.port,
      database: env.postgres.database,
      user: env.postgres.user,
      password: env.postgres.password,
    });
  }

  async setup(): Promise<void> {
    // Use existing South Zone (Toronto) from seed data
    const SOUTH_ZONE_ID = '550e8400-e29b-41d4-a716-446655440002';

    // Ensure test users and clients exist
    await this.pool.query(`
      INSERT INTO users (id, email, password_hash, role, first_name, last_name)
      VALUES
        ('11111111-1111-1111-1111-111111111111', 'caregiver@test.com', 'hash', 'caregiver', 'Test', 'Caregiver'),
        ('22222222-2222-2222-2222-222222222222', 'coord@test.com', 'hash', 'coordinator', 'Test', 'Coordinator')
      ON CONFLICT (id) DO NOTHING;
    `);

    await this.pool.query(
      `
      INSERT INTO clients (
        id, first_name, last_name, date_of_birth, address,
        latitude, longitude, phone, emergency_contact_name,
        emergency_contact_phone, emergency_contact_relationship, zone_id
      )
      VALUES (
        '33333333-3333-3333-3333-333333333333', 'Test', 'Client', '1950-01-01',
        '123 Test St', 43.6532, -79.3832, '+15555555555',
        'Emergency Contact', '+15555555556', 'Family', $1
      )
      ON CONFLICT (id) DO NOTHING;
    `,
      [SOUTH_ZONE_ID]
    );
  }

  async insertAlert(): Promise<number> {
    const start = performance.now();

    await this.pool.query(`
      INSERT INTO care_alerts (
        client_id,
        staff_id,
        coordinator_id,
        alert_type,
        status,
        voice_message_url
      ) VALUES (
        '33333333-3333-3333-3333-333333333333',
        '11111111-1111-1111-1111-111111111111',
        '22222222-2222-2222-2222-222222222222',
        'medical_concern',
        'initiated',
        's3://bucket/test.mp3'
      )
    `);

    const duration = performance.now() - start;
    this.insertTimes.push(duration);
    return duration;
  }

  async runBatch(batchSize: number): Promise<void> {
    const promises = Array(batchSize)
      .fill(null)
      .map(() => this.insertAlert());

    await Promise.all(promises);
  }

  async runTest(config: LoadTestConfig): Promise<LoadTestResult> {
    this.insertTimes = [];
    const start = performance.now();

    const batches = Math.ceil(config.totalAlerts / config.batchSize);

    for (let i = 0; i < batches; i += config.concurrentBatches) {
      const batchPromises: Promise<void>[] = [];
      for (let j = 0; j < config.concurrentBatches && i + j < batches; j++) {
        batchPromises.push(this.runBatch(config.batchSize));
      }
      await Promise.all(batchPromises);
    }

    const totalDuration = performance.now() - start;

    // Calculate percentiles
    const sorted = [...this.insertTimes].sort((a, b) => a - b);
    const p50 = sorted[Math.floor(sorted.length * 0.5)];
    const p95 = sorted[Math.floor(sorted.length * 0.95)];
    const p99 = sorted[Math.floor(sorted.length * 0.99)];

    return {
      totalAlerts: this.insertTimes.length,
      totalDurationMs: totalDuration,
      averageInsertMs: this.insertTimes.reduce((a, b) => a + b, 0) / this.insertTimes.length,
      insertsPerSecond: (this.insertTimes.length / totalDuration) * 1000,
      p50Ms: p50,
      p95Ms: p95,
      p99Ms: p99,
    };
  }

  async verifyIndexUsage(): Promise<void> {
    logInfo('Verifying Index Usage');

    const queries = [
      {
        name: 'Coordinator Dashboard',
        query: `EXPLAIN ANALYZE
          SELECT * FROM care_alerts
          WHERE coordinator_id = '22222222-2222-2222-2222-222222222222'
            AND status = 'initiated'
            AND deleted_at IS NULL
          LIMIT 10`,
      },
      {
        name: 'Client History',
        query: `EXPLAIN ANALYZE
          SELECT * FROM care_alerts
          WHERE client_id = '33333333-3333-3333-3333-333333333333'
            AND deleted_at IS NULL
          ORDER BY initiated_at DESC
          LIMIT 20`,
      },
      {
        name: 'SLA Monitoring',
        query: `EXPLAIN ANALYZE
          SELECT * FROM care_alerts
          WHERE status = 'initiated'
            AND initiated_at < NOW() - INTERVAL '5 minutes'
            AND deleted_at IS NULL`,
      },
    ];

    for (const { name, query } of queries) {
      const result = await this.pool.query(query);
      const plan = result.rows.map((r) => r['QUERY PLAN']).join('\n');

      const usesIndex = plan.includes('Index Scan') || plan.includes('Index Only Scan');

      // Extract execution time
      const timeMatch = plan.match(/Execution Time: ([\d.]+) ms/);
      const executionTime = timeMatch ? parseFloat(timeMatch[1]) : undefined;

      if (usesIndex) {
        logInfo('Index verification passed', {
          queryName: name,
          usesIndex: true,
          executionTimeMs: executionTime,
        });
      } else {
        logWarn('Sequential scan detected', {
          queryName: name,
          usesIndex: false,
          executionTimeMs: executionTime,
        });
      }
    }
  }

  async cleanup(): Promise<void> {
    await this.pool.query(
      `DELETE FROM care_alerts WHERE client_id = '33333333-3333-3333-3333-333333333333'`
    );
    await this.pool.end();
  }

  printResults(scenario: string, result: LoadTestResult): void {
    logInfo(`Load Test: ${scenario.toUpperCase()} Scenario`, {
      totalAlerts: result.totalAlerts,
      totalDurationMs: result.totalDurationMs.toFixed(2),
      averageInsertMs: result.averageInsertMs.toFixed(2),
      throughputPerSec: result.insertsPerSecond.toFixed(2),
      p50Ms: result.p50Ms.toFixed(2),
      p95Ms: result.p95Ms.toFixed(2),
      p99Ms: result.p99Ms.toFixed(2),
    });

    // Performance thresholds
    const warnings: string[] = [];
    if (result.averageInsertMs > 100) warnings.push('Average insert time > 100ms');
    if (result.p95Ms > 200) warnings.push('P95 latency > 200ms');
    if (result.insertsPerSecond < 10) warnings.push('Throughput < 10 inserts/sec');

    if (warnings.length > 0) {
      logWarn('Performance warnings detected', {
        scenario,
        warnings,
      });
    } else {
      logInfo('Performance within acceptable thresholds', { scenario });
    }
  }
}

async function main() {
  const test = new AlertWriteLoadTest();

  try {
    logInfo('Starting Care Alerts Write Performance Load Test', {
      description: 'Testing INSERT throughput with 6 indexes on care_alerts table',
    });

    await test.setup();

    // Run all test scenarios
    for (const [scenario, config] of Object.entries(TEST_SCENARIOS)) {
      const result = await test.runTest(config);
      test.printResults(scenario, result);
    }

    // Verify indexes are being used
    await test.verifyIndexUsage();

    logInfo('Load test completed successfully');
  } catch (error) {
    logWarn('Load test failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    process.exit(1);
  } finally {
    await test.cleanup();
  }
}

// Run if executed directly
if (require.main === module) {
  main();
}

export { AlertWriteLoadTest, LoadTestConfig, LoadTestResult };
