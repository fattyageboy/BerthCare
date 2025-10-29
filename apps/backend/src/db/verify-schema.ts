#!/usr/bin/env node
/**
 * Database Schema Verification Script
 *
 * Verifies that the database schema matches the migration specifications.
 * Checks for tables, columns, indexes, and constraints.
 *
 * Usage:
 *   pnpm run db:verify
 */

import { Pool } from 'pg';

import { getPostgresPoolConfig } from '../config/env';

const pool = new Pool(
  getPostgresPoolConfig({
    max: 1,
    min: 0,
  })
);

interface VerificationResult {
  passed: boolean;
  message: string;
}

/**
 * Verify table exists
 */
async function verifyTableExists(tableName: string): Promise<VerificationResult> {
  const result = await pool.query(
    `SELECT EXISTS (
      SELECT FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name = $1
    )`,
    [tableName]
  );

  // Defensive check: validate result structure
  if (!result.rows || result.rows.length === 0 || typeof result.rows[0]?.exists !== 'boolean') {
    return {
      passed: false,
      message: `❌ Table '${tableName}' verification failed: unexpected query result`,
    };
  }

  const exists = result.rows[0].exists;
  return {
    passed: exists,
    message: exists ? `✅ Table '${tableName}' exists` : `❌ Table '${tableName}' not found`,
  };
}

/**
 * Verify columns exist in table
 */
async function verifyColumns(
  tableName: string,
  expectedColumns: string[]
): Promise<VerificationResult> {
  const result = await pool.query(
    `SELECT column_name 
     FROM information_schema.columns 
     WHERE table_schema = 'public' 
     AND table_name = $1`,
    [tableName]
  );

  const actualColumns = result.rows.map((row) => row.column_name);
  const missingColumns = expectedColumns.filter((col) => !actualColumns.includes(col));

  if (missingColumns.length === 0) {
    return {
      passed: true,
      message: `✅ All columns exist in '${tableName}' (${expectedColumns.length} columns)`,
    };
  } else {
    return {
      passed: false,
      message: `❌ Missing columns in '${tableName}': ${missingColumns.join(', ')}`,
    };
  }
}

/**
 * Verify index exists
 */
async function verifyIndexExists(indexName: string): Promise<VerificationResult> {
  const result = await pool.query(
    `SELECT EXISTS (
      SELECT FROM pg_indexes 
      WHERE schemaname = 'public' 
      AND indexname = $1
    )`,
    [indexName]
  );

  // Defensive check: validate result structure
  if (!result.rows || result.rows.length === 0 || typeof result.rows[0]?.exists !== 'boolean') {
    return {
      passed: false,
      message: `❌ Index '${indexName}' verification failed: unexpected query result`,
    };
  }

  const exists = result.rows[0].exists;
  return {
    passed: exists,
    message: exists ? `✅ Index '${indexName}' exists` : `❌ Index '${indexName}' not found`,
  };
}

/**
 * Main verification
 */
async function verifySchema(): Promise<void> {
  console.log('\n🔍 Verifying database schema...\n');
  console.log('─'.repeat(60));

  const results: VerificationResult[] = [];

  // Verify users table
  results.push(await verifyTableExists('users'));
  results.push(
    await verifyColumns('users', [
      'id',
      'email',
      'password_hash',
      'first_name',
      'last_name',
      'role',
      'zone_id',
      'is_active',
      'created_at',
      'updated_at',
      'deleted_at',
    ])
  );

  // Verify refresh_tokens table
  results.push(await verifyTableExists('refresh_tokens'));
  results.push(
    await verifyColumns('refresh_tokens', [
      'id',
      'user_id',
      'token_hash',
      'device_id',
      'expires_at',
      'revoked_at',
      'created_at',
      'updated_at',
    ])
  );

  // Verify zones table
  results.push(await verifyTableExists('zones'));
  results.push(
    await verifyColumns('zones', [
      'id',
      'name',
      'slug',
      'description',
      'center_latitude',
      'center_longitude',
      'radius_km',
      'is_active',
      'metadata',
      'created_at',
      'updated_at',
    ])
  );

  // Verify indexes
  const indexes = [
    'idx_users_email',
    'idx_users_zone_id',
    'idx_users_role',
    'idx_users_zone_role',
    'idx_refresh_tokens_user_id',
    'idx_refresh_tokens_token_hash',
    'idx_refresh_tokens_device_id',
    'idx_refresh_tokens_expires_at',
    'idx_zones_slug',
    'idx_zones_active',
  ];

  for (const indexName of indexes) {
    results.push(await verifyIndexExists(indexName));
  }

  // Print results
  console.log('\n📊 Verification Results:\n');
  results.forEach((result) => console.log(result.message));

  // Summary
  const passed = results.filter((r) => r.passed).length;
  const total = results.length;

  console.log('\n' + '─'.repeat(60));
  console.log(`\n📈 Summary: ${passed}/${total} checks passed\n`);

  if (passed === total) {
    console.log('✨ Schema verification successful!\n');
    process.exit(0);
  } else {
    console.log('❌ Schema verification failed. Please check the errors above.\n');
    process.exit(1);
  }
}

/**
 * Main execution
 */
async function main() {
  try {
    await verifySchema();
  } catch (error) {
    console.error('\n❌ Verification error:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

// Run if executed directly
if (require.main === module) {
  main();
}
