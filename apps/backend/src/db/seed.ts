#!/usr/bin/env node
/**
 * Database Seed Script
 *
 * Populates the database with sample data for development and testing.
 * Creates sample users with different roles for testing authentication.
 *
 * Usage:
 *   pnpm run db:seed
 *
 * WARNING: This will delete existing data! Only use in development.
 */

import { Pool } from 'pg';

import { hashPassword } from '../../../../libs/shared/src';
import { getPostgresPoolConfig } from '../config/env';

const pool = new Pool(
  getPostgresPoolConfig({
    max: 2,
    min: 0,
  })
);

/**
 * Generate sample zone IDs
 */
const ZONES = {
  NORTH: '550e8400-e29b-41d4-a716-446655440001',
  SOUTH: '550e8400-e29b-41d4-a716-446655440002',
  EAST: '550e8400-e29b-41d4-a716-446655440003',
  WEST: '550e8400-e29b-41d4-a716-446655440004',
};

/**
 * Sample users for development
 */
const SAMPLE_USERS = [
  {
    email: 'admin@berthcare.ca',
    password: 'admin123',
    firstName: 'Admin',
    lastName: 'User',
    role: 'admin',
    zoneId: null, // Admins have access to all zones
  },
  {
    email: 'coordinator.north@berthcare.ca',
    password: 'coord123',
    firstName: 'Mike',
    lastName: 'Johnson',
    role: 'coordinator',
    zoneId: ZONES.NORTH,
  },
  {
    email: 'coordinator.south@berthcare.ca',
    password: 'coord123',
    firstName: 'Sarah',
    lastName: 'Williams',
    role: 'coordinator',
    zoneId: ZONES.SOUTH,
  },
  {
    email: 'caregiver.north1@berthcare.ca',
    password: 'caregiver123',
    firstName: 'Emily',
    lastName: 'Chen',
    role: 'caregiver',
    zoneId: ZONES.NORTH,
  },
  {
    email: 'caregiver.north2@berthcare.ca',
    password: 'caregiver123',
    firstName: 'David',
    lastName: 'Martinez',
    role: 'caregiver',
    zoneId: ZONES.NORTH,
  },
  {
    email: 'caregiver.south1@berthcare.ca',
    password: 'caregiver123',
    firstName: 'Jessica',
    lastName: 'Taylor',
    role: 'caregiver',
    zoneId: ZONES.SOUTH,
  },
  {
    email: 'caregiver.east1@berthcare.ca',
    password: 'caregiver123',
    firstName: 'Michael',
    lastName: 'Brown',
    role: 'caregiver',
    zoneId: ZONES.EAST,
  },
];

/**
 * Zone fixtures for development
 */
const ZONE_FIXTURES = [
  {
    id: ZONES.NORTH,
    name: 'North Zone',
    slug: 'north',
    description: 'Greater Montreal region',
    centerLatitude: 45.5017,
    centerLongitude: -73.5673,
  },
  {
    id: ZONES.SOUTH,
    name: 'South Zone',
    slug: 'south',
    description: 'Greater Toronto Area',
    centerLatitude: 43.6532,
    centerLongitude: -79.3832,
  },
  {
    id: ZONES.EAST,
    name: 'East Zone',
    slug: 'east',
    description: 'Ottawa & Eastern Ontario',
    centerLatitude: 45.4215,
    centerLongitude: -75.6972,
  },
  {
    id: ZONES.WEST,
    name: 'West Zone',
    slug: 'west',
    description: 'Metro Vancouver region',
    centerLatitude: 49.2827,
    centerLongitude: -123.1207,
  },
];

/**
 * Clear existing data
 */
async function clearData(): Promise<void> {
  console.log('🗑️  Clearing existing data...');

  await pool.query('DELETE FROM care_plans');
  await pool.query('DELETE FROM clients');
  await pool.query('DELETE FROM refresh_tokens');
  await pool.query('DELETE FROM users');
  await pool.query('DELETE FROM zones');

  console.log('✅ Data cleared');
}

/**
 * Seed zones for development
 */
async function seedZones(): Promise<void> {
  console.log('\n📍 Seeding zones...');

  for (const zone of ZONE_FIXTURES) {
    await pool.query(
      `INSERT INTO zones (id, name, slug, description, center_latitude, center_longitude, radius_km, is_active, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, 15, true, '{}'::jsonb)
       ON CONFLICT (id) DO UPDATE
         SET name = EXCLUDED.name,
             slug = EXCLUDED.slug,
             description = EXCLUDED.description,
             center_latitude = EXCLUDED.center_latitude,
             center_longitude = EXCLUDED.center_longitude,
             updated_at = NOW()`,
      [zone.id, zone.name, zone.slug, zone.description, zone.centerLatitude, zone.centerLongitude]
    );

    console.log(`  ✅ Zone ready: ${zone.name}`);
  }

  console.log(`\n✅ Prepared ${ZONE_FIXTURES.length} service zones`);
}

/**
 * Seed users
 */
async function seedUsers(): Promise<void> {
  console.log('\n👥 Seeding users...');

  for (const user of SAMPLE_USERS) {
    const passwordHash = await hashPassword(user.password);

    await pool.query(
      `INSERT INTO users (email, password_hash, first_name, last_name, role, zone_id)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [user.email, passwordHash, user.firstName, user.lastName, user.role, user.zoneId]
    );

    console.log(`  ✅ Created ${user.role}: ${user.email} (password: ${user.password})`);
  }

  console.log(`\n✅ Created ${SAMPLE_USERS.length} users`);
}

/**
 * Display summary
 */
async function displaySummary(): Promise<void> {
  console.log('\n' + '─'.repeat(60));
  console.log('\n📊 Database Summary:\n');

  // Count users by role
  const roleCount = await pool.query(
    `SELECT role, COUNT(*) as count 
     FROM users 
     GROUP BY role 
     ORDER BY role`
  );

  console.log('Users by role:');
  roleCount.rows.forEach((row) => {
    console.log(`  ${row.role}: ${row.count}`);
  });

  // Count users by zone
  const zoneCount = await pool.query(
    `SELECT 
       COALESCE(z.name, 'All Zones (Admin)') AS zone,
       COUNT(*) as count 
     FROM users u
     LEFT JOIN zones z ON z.id = u.zone_id
     GROUP BY z.name, u.zone_id
     ORDER BY z.name NULLS FIRST`
  );

  console.log('\nUsers by zone:');
  zoneCount.rows.forEach((row) => {
    console.log(`  ${row.zone}: ${row.count}`);
  });

  console.log('\n' + '─'.repeat(60));
  console.log('\n🔐 Sample Login Credentials:\n');
  console.log('Admin:');
  console.log('  Email: admin@berthcare.ca');
  console.log('  Password: admin123\n');
  console.log('coordinator (North Zone):');
  console.log('  Email: coordinator.north@berthcare.ca');
  console.log('  Password: coord123\n');
  console.log('Caregiver (North Zone):');
  console.log('  Email: caregiver.north1@berthcare.ca');
  console.log('  Password: caregiver123\n');
  console.log('⚠️  These are development credentials only!');
  console.log('   Never use these passwords in production.\n');
}

/**
 * Main execution
 */
async function main() {
  console.log('\n🌱 Seeding BerthCare Database\n');
  console.log('⚠️  WARNING: This will delete all existing data!');
  console.log('   Only use this in development environments.\n');

  try {
    // Verify connection
    await pool.query('SELECT 1');
    console.log('✅ Database connection successful\n');

    // Clear and seed
    await clearData();
    await seedZones();
    await seedUsers();
    await displaySummary();

    console.log('✨ Database seeding complete!\n');
  } catch (error) {
    console.error('\n❌ Seeding failed:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

// Run if executed directly
if (require.main === module) {
  main();
}
