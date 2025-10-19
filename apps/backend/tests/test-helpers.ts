/**
 * Shared Test Helpers
 *
 * Provides common utilities for integration tests including:
 * - Test app creation with all routes
 * - Database and Redis connection management
 * - Test data factories (clients, visits, users)
 * - Cleanup utilities for test isolation
 *
 * @module test-helpers
 * @see {@link project-documentation/task-plan.md} Phase V - Visit Documentation API
 */

import * as crypto from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';

import express, { Express } from 'express';
import { Client, Pool, PoolClient } from 'pg';

import { createRedisClient, RedisClient } from '../src/cache/redis-client';
import { createAuthRoutes } from '../src/routes/auth.routes';
import { createCarePlanRoutes } from '../src/routes/care-plans.routes';
import { createClientRoutes } from '../src/routes/clients.routes';
import { createVisitsRouter } from '../src/routes/visits.routes';
import {
  buildSchemaConnectionString,
  buildSchemaName,
  getWorkerContext,
} from './worker-context';

const MIGRATIONS_DIR = path.resolve(__dirname, '../src/db/migrations');
const MIGRATIONS_TABLE = 'schema_migrations';

// Test configuration
export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
export const TEST_REDIS_URL = process.env.TEST_REDIS_URL;

if (!TEST_DATABASE_URL) {
  throw new Error('TEST_DATABASE_URL environment variable is required');
}
if (!TEST_REDIS_URL) {
  throw new Error('TEST_REDIS_URL environment variable is required');
}

type ParsedMigration = {
  version: number;
  baseName: string;
  fileName: string;
  fullPath: string;
  checksum?: string;
};

function parseMigrationFile(fileName: string): ParsedMigration | null {
  const match = /^(\d{3})_(.+)\.sql$/i.exec(fileName);
  if (!match) {
    return null;
  }

  const [, versionPart, remainder] = match;
  if (remainder.endsWith('-down')) {
    return null;
  }

  const version = Number.parseInt(versionPart, 10);
  if (Number.isNaN(version)) {
    return null;
  }

  return {
    version,
    baseName: `${versionPart}_${remainder}`,
    fileName,
    fullPath: path.join(MIGRATIONS_DIR, fileName),
  };
}

async function ensureMigrationsTable(client: PoolClient): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS ${MIGRATIONS_TABLE} (
      name TEXT PRIMARY KEY,
      run_on TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      checksum TEXT
    )
  `);

  await client.query(`
    ALTER TABLE ${MIGRATIONS_TABLE}
    ADD COLUMN IF NOT EXISTS checksum TEXT
  `);
}

function computeMigrationChecksum(contents: string): string {
  return crypto.createHash('sha256').update(contents, 'utf8').digest('hex');
}

async function loadPendingMigrations(client: PoolClient): Promise<ParsedMigration[]> {
  let entries: string[];
  try {
    entries = await fs.readdir(MIGRATIONS_DIR);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Unknown error reading migrations directory';
    throw new Error(`Unable to read migrations directory at ${MIGRATIONS_DIR}: ${message}`);
  }

  const files: ParsedMigration[] = [];

  for (const fileName of entries) {
    const parsed = parseMigrationFile(fileName);
    if (!parsed) {
      continue;
    }
    files.push(parsed);
  }

  const filesByName = new Map(files.map((migration) => [migration.baseName, migration]));
  const { rows } = await client.query<{ name: string; checksum: string | null }>(
    `SELECT name, checksum FROM ${MIGRATIONS_TABLE}`
  );

  for (const row of rows) {
    const migration = filesByName.get(row.name);
    if (!migration) {
      throw new Error(
        `Applied migration ${row.name} is recorded in ${MIGRATIONS_TABLE} but the file is missing`
      );
    }

    let contents: string;
    try {
      contents = await fs.readFile(migration.fullPath, 'utf8');
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown error reading migration file';
      throw new Error(`Unable to read migration ${migration.fileName}: ${message}`);
    }

    const checksum = computeMigrationChecksum(contents);
    migration.checksum = checksum;

    if (!row.checksum) {
      await client.query(
        `UPDATE ${MIGRATIONS_TABLE} SET checksum = $1 WHERE name = $2`,
        [checksum, row.name]
      );
    } else if (row.checksum !== checksum) {
      throw new Error(
        `Checksum mismatch for migration ${row.name}. Stored checksum (${row.checksum}) does not match current file checksum (${checksum}).`
      );
    }
  }

  const applied = new Set(rows.map((row) => row.name));
  const pending = files.filter((migration) => !applied.has(migration.baseName));

  return pending.sort((a, b) => {
    if (a.version !== b.version) {
      return a.version - b.version;
    }
    return a.baseName.localeCompare(b.baseName);
  });
}

export async function runTestMigrations(pgPool: Pool): Promise<void> {
  const client = await pgPool.connect();

  try {
    await ensureMigrationsTable(client);
    const pendingMigrations = await loadPendingMigrations(client);

    for (const migration of pendingMigrations) {
      let sql: string;
      try {
        sql = await fs.readFile(migration.fullPath, 'utf8');
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Unknown error reading migration file';
        throw new Error(`Unable to read migration ${migration.fileName}: ${message}`);
      }

      const checksum = computeMigrationChecksum(sql);

      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query(`INSERT INTO ${MIGRATIONS_TABLE} (name, checksum) VALUES ($1, $2)`, [
          migration.baseName,
          checksum,
        ]);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        const message = error instanceof Error ? error.message : 'Unknown error applying migration';
        throw new Error(`Failed to apply migration ${migration.fileName}: ${message}`);
      }
    }
  } finally {
    client.release();
  }
}

/**
 * Create a test app with all routes mounted
 */
export function createTestApp(pgPool: Pool, redisClient: RedisClient): Express {
  const app = express();
  app.use(express.json());

  // Mount routes
  app.use('/api/v1/auth', createAuthRoutes(pgPool, redisClient));
  app.use('/api/v1/clients', createClientRoutes(pgPool, redisClient));
  app.use('/api/v1/care-plans', createCarePlanRoutes(pgPool, redisClient));
  app.use('/api/v1/visits', createVisitsRouter(pgPool, redisClient));

  return app;
}

/**
 * Create test client in database
 */
export async function createTestClient(
  pgPool: Pool,
  data: {
    id?: string;
    firstName: string;
    lastName: string;
    dateOfBirth: string;
    address: string;
    latitude: number;
    longitude: number;
    phone?: string;
    zoneId: string;
    emergencyContactName: string;
    emergencyContactPhone: string;
    emergencyContactRelationship: string;
  }
): Promise<string> {
  const clientId = data.id || crypto.randomUUID();

  await pgPool.query(
    `
    INSERT INTO clients (
      id, first_name, last_name, date_of_birth, address,
      latitude, longitude, phone, zone_id,
      emergency_contact_name, emergency_contact_phone,
      emergency_contact_relationship,
      created_at, updated_at
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW(), NOW()
    )
  `,
    [
      clientId,
      data.firstName,
      data.lastName,
      data.dateOfBirth,
      data.address,
      data.latitude,
      data.longitude,
      data.phone || null,
      data.zoneId,
      data.emergencyContactName,
      data.emergencyContactPhone,
      data.emergencyContactRelationship,
    ]
  );

  return clientId;
}

/**
 * Create test visit in database
 */
export async function createTestVisit(
  pgPool: Pool,
  data: {
    id?: string;
    clientId: string;
    staffId: string;
    scheduledStartTime: string;
    checkInTime?: string;
    checkOutTime?: string;
    status?: string;
    durationMinutes?: number;
  }
): Promise<string> {
  const visitId = data.id || crypto.randomUUID();

  await pgPool.query(
    `
    INSERT INTO visits (
      id, client_id, staff_id, scheduled_start_time,
      check_in_time, check_out_time, status, duration_minutes,
      created_at, updated_at
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW()
    )
  `,
    [
      visitId,
      data.clientId,
      data.staffId,
      data.scheduledStartTime,
      data.checkInTime || null,
      data.checkOutTime || null,
      data.status || 'scheduled',
      data.durationMinutes || null,
    ]
  );

  return visitId;
}

/**
 * Clean up test data
 */
export async function cleanupTestData(pgPool: Pool, clientIds: string[]): Promise<void> {
  if (clientIds.length === 0) return;

  // Delete visits first (foreign key to clients)
  await pgPool.query('DELETE FROM visits WHERE client_id = ANY($1)', [clientIds]);

  // Delete care plans (foreign key to clients)
  await pgPool.query('DELETE FROM care_plans WHERE client_id = ANY($1)', [clientIds]);

  // Delete clients
  await pgPool.query('DELETE FROM clients WHERE id = ANY($1)', [clientIds]);
}

/**
 * Clean all test data from database
 * Handles foreign key constraints in correct order
 * Uses DELETE instead of TRUNCATE to avoid deadlocks
 */
export async function cleanAllTestData(pgPool: Pool, redisClient: RedisClient): Promise<void> {
  if (!pgPool) {
    return;
  }

  const client = await pgPool.connect();
  try {
    // Use a transaction to ensure atomicity
    await client.query('BEGIN');

    // Delete in order to respect foreign key constraints
    // Note: refresh_tokens has ON DELETE CASCADE, so deleting users will cascade
    await client.query('DELETE FROM visits');
    await client.query('DELETE FROM care_plans');
    await client.query('DELETE FROM clients');
    await client.query('DELETE FROM refresh_tokens');
    await client.query("DELETE FROM users WHERE email LIKE '%test-%@example.com'");

    await client.query('COMMIT');

    // Clear Redis
    if (redisClient && redisClient.status !== 'end') {
      await redisClient.flushDb();
    }
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error cleaning test data:', error);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Generate unique test email to avoid conflicts
 */
export function generateTestEmail(prefix: string = 'test'): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(7);
  return `${prefix}-${timestamp}-${random}@example.com`;
}

/**
 * Register a cleanup function to be called during global teardown
 * This ensures deterministic cleanup without arbitrary timeouts
 */
export function registerCleanup(cleanup: () => Promise<void>): void {
  if (!global.__TEST_CLEANUPS__) {
    global.__TEST_CLEANUPS__ = [];
  }
  global.__TEST_CLEANUPS__.push(cleanup);
}

/**
 * Setup test database and Redis connections
 */
export async function setupTestConnections(): Promise<{
  pgPool: Pool;
  redisClient: RedisClient;
  schemaName: string;
  redisDb: number;
}> {
  const context = getWorkerContext();
  const schemaName = buildSchemaName();
  const schemaConnectionString = buildSchemaConnectionString(schemaName);

  const adminClient = new Client({ connectionString: context.baseDatabaseUrl });
  try {
    await adminClient.connect();
    await adminClient.query(`CREATE SCHEMA IF NOT EXISTS "${schemaName}"`);
  } finally {
    await adminClient.end();
  }

  const pgPool = new Pool({
    connectionString: schemaConnectionString,
    max: 5, // Reduced pool size for tests
    min: 0, // Allow pool to scale down to 0
    idleTimeoutMillis: 10000, // Close idle connections faster
    connectionTimeoutMillis: 2000, // Fail fast if can't connect
    allowExitOnIdle: true, // Allow process to exit when pool is idle
  });

  try {
    const client = await pgPool.connect();
    await client.query('SELECT 1');
    client.release();
  } catch (error) {
    console.error('Failed to connect to PostgreSQL:', error);
    await pgPool.end().catch((closeError) => {
      console.error('Failed to close PostgreSQL pool after connection error:', closeError);
    });
    throw new Error('PostgreSQL connection failed. Is the database running?');
  }

  await runTestMigrations(pgPool);

  const redisClient = createRedisClient({
    url: context.redisUrl,
  });

  try {
    await redisClient.connect();
    await redisClient.flushDb();
  } catch (error) {
    console.error('Failed to connect to Redis:', error);
    await pgPool.end().catch((closeError) => {
      console.error('Failed to close PostgreSQL pool after Redis error:', closeError);
    });
    throw new Error('Redis connection failed. Is Redis running?');
  }

  registerCleanup(() =>
    teardownTestConnections(pgPool, redisClient, {
      schemaName,
      redisDb: context.redisDb,
      dropSchema: true,
    })
  );

  return { pgPool, redisClient, schemaName, redisDb: context.redisDb };
}

/**
 * Teardown test connections
 * Ensures all connections are properly closed and no handles remain open
 */
export async function teardownTestConnections(
  pgPool: Pool | undefined,
  redisClient: RedisClient | undefined,
  options: {
    schemaName?: string;
    redisDb?: number;
    dropSchema?: boolean;
  } = {}
): Promise<void> {
  if (!pgPool && !redisClient) {
    return;
  }

  const cleanupTasks: Promise<void>[] = [];

  const redisCleanup = (async () => {
    try {
      if (redisClient && redisClient.status !== 'end') {
        await redisClient.flushDb();
        await redisClient.quit();
      }
    } catch (error) {
      console.error('Error closing redisClient:', error);
      try {
        await redisClient?.disconnect();
      } catch (disconnectError) {
        console.error('Error disconnecting redisClient:', disconnectError);
      }
    }
  })();

  const pgCleanup = (async () => {
    try {
      if (pgPool && !pgPool.ended) {
        await pgPool.end();
      }
    } catch (error) {
      console.error('Error closing pgPool:', error);
    }
  })();

  cleanupTasks.push(redisCleanup, pgCleanup);

  await Promise.all(cleanupTasks);

  if (options.dropSchema && options.schemaName) {
    const adminClient = new Client({ connectionString: TEST_DATABASE_URL });
    try {
      await adminClient.connect();
      await adminClient.query(`DROP SCHEMA IF EXISTS "${options.schemaName}" CASCADE`);
    } catch (error) {
      console.error(`Error dropping schema "${options.schemaName}":`, error);
    } finally {
      await adminClient.end().catch((closeError) => {
        console.error('Error closing admin PostgreSQL client:', closeError);
      });
    }
  }
}
