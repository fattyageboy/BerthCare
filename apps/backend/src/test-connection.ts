import { Pool } from 'pg';
import { createClient } from 'redis';

import { env, getPostgresPoolConfig, getRedisClientConfig } from './config/env';

async function testConnections() {
  console.log('🔍 Testing BerthCare Backend Connections...\n');

  let exitCode = 0;

  // Test PostgreSQL
  console.log('Testing PostgreSQL connection...');
  const pgPool = new Pool(
    getPostgresPoolConfig({
      max: 1,
      min: 0,
      connectionTimeoutMillis: 5000,
    })
  );

  try {
    const result = await pgPool.query(
      'SELECT NOW() as time, version() as version, current_database() as database'
    );
    console.log('✅ PostgreSQL connection successful');
    console.log(`   Database: ${result.rows[0].database}`);
    console.log(`   Time: ${result.rows[0].time}`);
    console.log(`   Version: ${result.rows[0].version.split(',')[0]}`);

    // Check if test database exists
    const dbCheck = await pgPool.query(`
      SELECT datname FROM pg_database 
      WHERE datname IN ('berthcare_dev', 'berthcare_test')
      ORDER BY datname
    `);
    console.log(
      `   Databases found: ${dbCheck.rows.map((r: { datname: string }) => r.datname).join(', ')}`
    );
  } catch (error) {
    console.error(
      '❌ PostgreSQL connection failed:',
      error instanceof Error ? error.message : error
    );
    exitCode = 1;
  } finally {
    await pgPool.end();
  }

  console.log('');

  // Test Redis
  console.log('Testing Redis connection...');
  const redisClient = createClient(getRedisClientConfig());

  try {
    await redisClient.connect();
    const pong = await redisClient.ping();
    console.log('✅ Redis connection successful');
    console.log(`   Ping response: ${pong}`);

    const info = await redisClient.info('server');
    const version = info.match(/redis_version:([^\r\n]+)/)?.[1];
    console.log(`   Redis version: ${version}`);

    // Test set/get
    await redisClient.set('test:connection', 'success', { EX: 10 });
    const value = await redisClient.get('test:connection');
    console.log(`   Test key set/get: ${value}`);
  } catch (error) {
    console.error('❌ Redis connection failed:', error instanceof Error ? error.message : error);
    exitCode = 1;
  } finally {
    await redisClient.quit();
  }

  console.log('');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  if (exitCode === 0) {
    console.log('✅ All connections successful!');
    console.log('');
    console.log('Next steps:');
    console.log(`  1. Start backend: npm run dev (PORT=${env.app.port})`);
    console.log(`  2. Test health endpoint: curl http://localhost:${env.app.port}/health`);
  } else {
    console.log('❌ Some connections failed. Check the errors above.');
  }
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  process.exit(exitCode);
}

testConnections();
