#!/usr/bin/env node
/**
 * Database Migration Runner
 *
 * Simple migration tool for running SQL migration files against PostgreSQL.
 * Supports both forward migrations and rollbacks.
 *
 * Usage:
 *   npm run migrate:up              # Run all pending migrations
 *   npm run migrate:up 001          # Run specific migration
 *   npm run migrate:down 001        # Rollback specific migration
 *
 * Philosophy: Keep it simple. SQL files are the source of truth.
 */

/* eslint-disable no-console */

import { readFileSync } from 'fs';
import { join } from 'path';

import { Pool, PoolClient } from 'pg';

import { getPostgresPoolConfig } from '../config/env';

// Database connection configuration
const pool = new Pool(
  getPostgresPoolConfig({
    max: 1,
    min: 0,
  })
);

// Migration file paths
const MIGRATIONS_DIR = join(__dirname, 'migrations');

/**
 * Ensure schema_migrations table exists
 */
async function ensureMigrationsTable(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version VARCHAR(10) PRIMARY KEY,
        applied_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      )
    `);
  } finally {
    client.release();
  }
}

/**
 * Get list of applied migrations
 */
async function getAppliedMigrations(): Promise<Set<string>> {
  const client = await pool.connect();
  try {
    const result = await client.query('SELECT version FROM schema_migrations ORDER BY version');
    return new Set(result.rows.map((row) => row.version));
  } finally {
    client.release();
  }
}

/**
 * Record migration as applied
 */
async function recordMigration(version: string, client: PoolClient): Promise<void> {
  await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [version]);
}

/**
 * Remove migration record
 */
async function removeMigrationRecord(version: string, client: PoolClient): Promise<void> {
  await client.query('DELETE FROM schema_migrations WHERE version = $1', [version]);
}

/**
 * Execute SQL migration file
 */
async function executeMigration(
  filename: string,
  version: string,
  isRollback = false
): Promise<void> {
  const filePath = join(MIGRATIONS_DIR, filename);
  const sql = readFileSync(filePath, 'utf-8');

  console.log(`\n📄 Executing migration: ${filename}`);
  console.log('─'.repeat(60));

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(sql);

    // Update migration state
    if (isRollback) {
      await removeMigrationRecord(version, client);
    } else {
      await recordMigration(version, client);
    }

    await client.query('COMMIT');
    console.log('✅ Migration completed successfully');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Migration failed:', error);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Run migration up (apply changes)
 */
async function migrateUp(migrationNumber?: string): Promise<void> {
  console.log('\n🚀 Running migrations...\n');

  // Ensure migrations tracking table exists
  await ensureMigrationsTable();

  // Get already applied migrations
  const appliedMigrations = await getAppliedMigrations();

  // Define all available migrations
  const allMigrations = [
    { version: '000', filename: '000_create_zones.sql' },
    { version: '001', filename: '001_create_users_auth.sql' },
    { version: '002', filename: '002_create_clients.sql' },
    { version: '003', filename: '003_create_care_plans.sql' },
  ];

  if (migrationNumber) {
    // Run specific migration
    const migration = allMigrations.find((m) => m.version === migrationNumber);
    if (!migration) {
      throw new Error(`Migration ${migrationNumber} not found`);
    }

    if (appliedMigrations.has(migration.version)) {
      console.log(`⏭️  Migration ${migration.version} already applied, skipping...`);
    } else {
      await executeMigration(migration.filename, migration.version);
    }
  } else {
    // Run all pending migrations in order
    let appliedCount = 0;
    for (const migration of allMigrations) {
      if (appliedMigrations.has(migration.version)) {
        console.log(`⏭️  Migration ${migration.version} already applied, skipping...`);
      } else {
        await executeMigration(migration.filename, migration.version);
        appliedCount++;
      }
    }

    if (appliedCount === 0) {
      console.log('\n✨ No pending migrations to run. Database is up to date!\n');
      return;
    }
  }

  console.log('\n✨ All migrations completed successfully!\n');
}

/**
 * Run migration down (rollback changes)
 */
async function migrateDown(migrationNumber: string): Promise<void> {
  console.log('\n⏪ Rolling back migration...\n');

  // Ensure migrations tracking table exists
  await ensureMigrationsTable();

  // Get already applied migrations
  const appliedMigrations = await getAppliedMigrations();

  // Check if migration was applied
  if (!appliedMigrations.has(migrationNumber)) {
    console.log(`⏭️  Migration ${migrationNumber} was not applied, nothing to rollback.`);
    return;
  }

  // Define ordered list of all migrations
  const orderedMigrations = ['000', '001', '002', '003'];

  // Check for dependent migrations (migrations applied after the target)
  const targetIndex = orderedMigrations.indexOf(migrationNumber);
  if (targetIndex === -1) {
    throw new Error(`Migration ${migrationNumber} not found in migration list`);
  }

  const dependentMigrations = orderedMigrations
    .slice(targetIndex + 1)
    .filter((version) => appliedMigrations.has(version));

  if (dependentMigrations.length > 0) {
    console.error(`❌ Cannot rollback migration ${migrationNumber}`);
    console.error(`   The following dependent migrations are still applied:`);
    dependentMigrations.forEach((version) => {
      console.error(`   - ${version}`);
    });
    console.error(`\n   Please rollback these migrations first, in reverse order.`);
    throw new Error(
      `Cannot rollback migration ${migrationNumber}: dependent migrations ${dependentMigrations.join(', ')} are still applied`
    );
  }

  const rollbackFiles: Record<string, string> = {
    '000': '000_create_zones_rollback.sql',
    '001': '001_create_users_auth_rollback.sql',
    '002': '002_create_clients_rollback.sql',
    '003': '003_create_care_plans_rollback.sql',
  };

  const filename = rollbackFiles[migrationNumber];
  if (!filename) {
    throw new Error(`Rollback for migration ${migrationNumber} not found`);
  }
  await executeMigration(filename, migrationNumber, true);

  console.log('\n✨ Rollback completed successfully!\n');
}

/**
 * Verify database connection
 */
async function verifyConnection(): Promise<void> {
  try {
    const client = await pool.connect();
    const result = await client.query('SELECT version()');
    console.log('✅ Database connection successful');
    console.log(`📊 PostgreSQL version: ${result.rows[0].version.split(',')[0]}`);
    client.release();
  } catch (error) {
    console.error('❌ Database connection failed:', error);
    throw error;
  }
}

/**
 * Main execution
 */
async function main() {
  const command = process.argv[2]; // 'up' or 'down'
  const migrationNumber = process.argv[3]; // Optional migration number

  try {
    // Verify database connection first
    await verifyConnection();

    // Execute migration command
    if (command === 'up') {
      await migrateUp(migrationNumber);
    } else if (command === 'down') {
      if (!migrationNumber) {
        console.error('❌ Migration number required for rollback');
        console.log('Usage: npm run migrate:down <migration_number>');
        process.exit(1);
      }
      await migrateDown(migrationNumber);
    } else {
      console.error('❌ Invalid command. Use "up" or "down"');
      console.log('Usage:');
      console.log('  npm run migrate:up              # Run all migrations');
      console.log('  npm run migrate:up 001          # Run specific migration');
      console.log('  npm run migrate:down 001        # Rollback migration');
      process.exit(1);
    }
  } catch (error) {
    console.error('\n❌ Migration failed:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

// Run if executed directly
if (require.main === module) {
  main();
}
