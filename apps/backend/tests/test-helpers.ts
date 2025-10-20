/**
 * Shared Test Helpers
 *
 * Provides common utilities for integration tests
 */

import * as crypto from 'crypto';

import express, { Express } from 'express';
import { Pool } from 'pg';
import { createClient } from 'redis';

import { createAuthRoutes } from '../src/routes/auth.routes';
import { createCarePlanRoutes } from '../src/routes/care-plans.routes';
import { createClientRoutes } from '../src/routes/clients.routes';

// Test configuration
export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
export const TEST_REDIS_URL = process.env.TEST_REDIS_URL;

if (!TEST_DATABASE_URL) {
  throw new Error('TEST_DATABASE_URL environment variable is required');
}
if (!TEST_REDIS_URL) {
  throw new Error('TEST_REDIS_URL environment variable is required');
}

/**
 * Create a test app with all routes mounted
 */
export function createTestApp(pgPool: Pool, redisClient: ReturnType<typeof createClient>): Express {
  const app = express();
  app.use(express.json());

  // Mount routes
  app.use('/api/v1/auth', createAuthRoutes(pgPool, redisClient));
  app.use('/api/v1/clients', createClientRoutes(pgPool, redisClient));
  app.use('/api/v1/care-plans', createCarePlanRoutes(pgPool, redisClient));

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
 * Clean up test data
 */
export async function cleanupTestData(pgPool: Pool, clientIds: string[]): Promise<void> {
  if (clientIds.length === 0) return;

  // Delete care plans first (foreign key)
  await pgPool.query('DELETE FROM care_plans WHERE client_id = ANY($1)', [clientIds]);

  // Delete clients
  await pgPool.query('DELETE FROM clients WHERE id = ANY($1)', [clientIds]);
}

/**
 * Clean all test data from database
 * Handles foreign key constraints in correct order
 * Uses DELETE instead of TRUNCATE to avoid deadlocks
 */
export async function cleanAllTestData(
  pgPool: Pool,
  redisClient: ReturnType<typeof createClient>
): Promise<void> {
  const client = await pgPool.connect();
  try {
    // Use a transaction to ensure atomicity
    await client.query('BEGIN');

    // Delete in order to respect foreign key constraints
    // Note: refresh_tokens has ON DELETE CASCADE, so deleting users will cascade
    await client.query('DELETE FROM care_plans');
    await client.query('DELETE FROM clients');
    await client.query('DELETE FROM refresh_tokens');
    await client.query("DELETE FROM users WHERE email LIKE '%test-%@example.com'");

    await client.query('COMMIT');

    // Clear Redis
    await redisClient.flushDb();
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
 * Setup test database and Redis connections
 */
export async function setupTestConnections(): Promise<{
  pgPool: Pool;
  redisClient: ReturnType<typeof createClient>;
}> {
  const pgPool = new Pool({
    connectionString: TEST_DATABASE_URL,
    max: 10, // Limit pool size to prevent exhaustion
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
  });
  const redisClient = createClient({ url: TEST_REDIS_URL });
  await redisClient.connect();

  // Ensure zone fixtures exist for tests that rely on them
  await pgPool.query(
    `INSERT INTO zones (id, name, slug, description, center_latitude, center_longitude, radius_km)
     VALUES
       ('550e8400-e29b-41d4-a716-446655440001', 'North Zone', 'north', 'Greater Montreal region', 45.5017, -73.5673, 25),
       ('550e8400-e29b-41d4-a716-446655440002', 'South Zone', 'south', 'Greater Toronto Area', 43.6532, -79.3832, 35)
     ON CONFLICT (id) DO NOTHING`
  );

  return { pgPool, redisClient };
}

/**
 * Teardown test connections
 */
export async function teardownTestConnections(
  pgPool: Pool,
  redisClient: ReturnType<typeof createClient>
): Promise<void> {
  try {
    await pgPool.end();
  } catch (error) {
    console.error('Error closing pgPool:', error);
  }

  try {
    await redisClient.quit();
  } catch (error) {
    console.error('Error closing redisClient:', error);
  }
}
