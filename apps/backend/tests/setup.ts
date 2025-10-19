/**
 * Test Setup and Configuration
 *
 * Global setup for integration tests:
 * - Environment variable configuration
 * - Test database initialization
 * - Global test utilities
 */

import path from 'path';

import { Client } from 'pg';
import dotenv from 'dotenv';

import { createRedisClient } from '../src/cache/redis-client';
import { registerCleanup } from './test-helpers';
import { getWorkerContext } from './worker-context';

// Load test environment variables
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

// Set test-specific environment variables
process.env.NODE_ENV = 'test';

// Test JWT keys (RSA 2048-bit key pair for testing only)
process.env.JWT_PRIVATE_KEY = `-----BEGIN PRIVATE KEY-----
MIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQDiZfJ8EAzjoGAj
go7nOywkrDYgZjRPJaum1cTzcBBdqinQRoQRr7frj+rQkislyCjelYTGclZ1obDT
g83va4z0PLt30ZOyMYGy0wG/nk3rIvuhOjEJZhODScDQqelaJFFxDXXszxBc+t0A
S2BVNoD+8GnwZfxzGkvqCoMmdUborTVP93OkwNgIk6XaH8Evb3MijHLBmTKXnEQe
EtgqAOCsi2pofOTjjV+bAZN9aH4QGvKOs502U/SufRek9zibJtqQyT0zsXo/uxUW
Jzs5ydtUdz2ucbwFVIxPA+Y8buCsIz66quAQ5gzJXrhdxj4wFdmWAlKVxF2p/Hjs
jWTc/mNlAgMBAAECggEAFz7Sc+yN9j08Qckg9Rr9QFKySAdWbZ33juy6CSjDdWqI
Wosy+kHph3VCbeHkLj/r+latyFZrDC7q4fzRgziuw1ENCpNpL82nfH3v2wXdCDyS
S46XBFkHvd4vvv0DKa868XmpVwQ3sORNFr+mh3lOK17x8a33CrZzfvdPWf6GplMZ
BqH40owBh6TyZbl23ZRPrAXSoML6YDEaum5/kCJwM00DtbBHQxmwk+k7hZV4ANv9
E7PkWYu4XRVWjraGDUDwM1ZiZaik5lPDP30LL+SRa4i70I13ZbCKwzpqu0Y0VkyP
hVvrFzzECSSWpuq3t/2i5kqdVBNBgpNJr4OTVk4DwQKBgQD3TmtL7RLTXb3ao93M
6ZOKk0OAzuTVn6vmEjFse0F5W/B9MnDuyTBT/5N2zr1BJubhh2Ld2GoVXgeiKpDm
1YddyQC0DrysHmop15T4sLHL1fHjGbtl5YSt25jjqO5SvqnCMaUW4EnJniPIDQxQ
BCpB417o7b6E0qya6mty2JDYMQKBgQDqW17AQV5Zv2Yh2e3uEev92g+p6HKUUQU3
+1KaQ0XDZFeMvfq6qdSOAAbEbTHuL1G+VQDGxNIZHGzzXV5qR+zQbeaGU9NEVbdG
MuFxQZ47Fs5sc2mt2TRAKEYSEmubVo6IJE17daDROs382ckpdKW/V7sg9yu3hUvT
GN+GlbSldQKBgQCfQS2RQEKeQECROnMLkOLFGx4eJZ1w/5i32MFhBWJdX1pXlRLq
gj6P6QYyPOHcwctuMjv1dnah+eJaiKS1MY4xU84TJWZURGXDOiOhnk9wXv6cayal
cI7nUoF7IX8PY953wnZ4a8i4gBC0s8pZAMWhlmS5BNhqOiySuiClXVaxEQKBgQCf
AD7Y0YDiAymX7fOvghlKsZfO/xY96npP8QOqBdpfJsT/iCWEX5UGgp4UxsEJiLE9
IQ7VzNN+lfqVYtOb6BCTmPy+RkEgK8ecqQirfomMLXz/t44LlUIOBUUFHdpEGgW5
+GdZTAU/71WyJ1CD/9A0caFUTF4stRMstcNx3EAjwQKBgG44kXHkw8MXxDzo308Y
0vHpxJts0Wob8X6bzA6iFUjbiOG/PoPxvdmXRbYBh0JzwClZwAPHgO1G4Ip0bisP
0ppvMrd9DUjeFvleH6OEsPn5IKJae0BLXkFhXfv3O4qMJLO7ViEK2broAHzrGKsw
4gThodG+kL8Xewvon5YLUg7L
-----END PRIVATE KEY-----
`;

process.env.JWT_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA4mXyfBAM46BgI4KO5zss
JKw2IGY0TyWrptXE83AQXaop0EaEEa+364/q0JIrJcgo3pWExnJWdaGw04PN72uM
9Dy7d9GTsjGBstMBv55N6yL7oToxCWYTg0nA0KnpWiRRcQ117M8QXPrdAEtgVTaA
/vBp8GX8cxpL6gqDJnVG6K01T/dzpMDYCJOl2h/BL29zIoxywZkyl5xEHhLYKgDg
rItqaHzk441fmwGTfWh+EBryjrOdNlP0rn0XpPc4mybakMk9M7F6P7sVFic7Ocnb
VHc9rnG8BVSMTwPmPG7grCM+uqrgEOYMyV64XcY+MBXZlgJSlcRdqfx47I1k3P5j
ZQIDAQAB
-----END PUBLIC KEY-----`;

process.env.JWT_KEY_ID = 'test-suite-key';

// Set timeout for integration tests (database setup can take time)
jest.setTimeout(20000);

// Initialize global cleanup registry for deterministic teardown
declare global {
  // eslint-disable-next-line no-var
  var __TEST_CLEANUPS__: Array<() => Promise<void>>;
}

global.__TEST_CLEANUPS__ = [];

// Suppress console errors during tests (optional - remove if you want to see all errors)
// global.console = {
//   ...console,
//   error: jest.fn(),
// };

// Global test utilities
export const TEST_ZONE_ID = '123e4567-e89b-12d3-a456-426614174000';

export const createTestUser = (overrides = {}) => ({
  email: 'test@example.com',
  password: 'SecurePass123',
  firstName: 'Test',
  lastName: 'User',
  role: 'caregiver',
  zoneId: TEST_ZONE_ID,
  deviceId: 'test-device-001',
  ...overrides,
});

let workerIsolationPromise: Promise<void> | undefined;

async function dropWorkerSchemas(prefix: string): Promise<void> {
  const context = getWorkerContext();
  const adminClient = new Client({ connectionString: context.baseDatabaseUrl });

  try {
    await adminClient.connect();
    const { rows } = await adminClient.query<{ schema_name: string }>(
      `
        SELECT schema_name
        FROM information_schema.schemata
        WHERE schema_name LIKE $1
      `,
      [`${prefix}_%`]
    );

    for (const row of rows) {
      const schemaName = row.schema_name;
      if (!schemaName) {
        continue;
      }
      await adminClient.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
    }
  } catch (error) {
    console.error('Failed to clean worker schemas during setup/teardown:', error);
  } finally {
    await adminClient.end().catch((closeError) => {
      console.error('Error closing admin PostgreSQL client during schema cleanup:', closeError);
    });
  }
}

async function flushWorkerRedisDb(redisUrl: string): Promise<void> {
  const redisClient = createRedisClient({ url: redisUrl });
  try {
    await redisClient.connect();
    await redisClient.flushDb();
  } catch (error) {
    console.error('Failed to prepare Redis logical database for tests:', error);
    throw error;
  } finally {
    await redisClient.quit().catch((quitError) => {
      console.error('Error closing Redis client during setup/teardown:', quitError);
      try {
        redisClient.disconnect();
      } catch {
        // Ignore secondary errors
      }
    });
  }
}

async function initializeWorkerIsolation(): Promise<void> {
  const context = getWorkerContext();

  await dropWorkerSchemas(context.schemaPrefix);
  await flushWorkerRedisDb(context.redisUrl);

  registerCleanup(async () => {
    await flushWorkerRedisDb(context.redisUrl);
  });

  registerCleanup(async () => {
    await dropWorkerSchemas(context.schemaPrefix);
  });
}

beforeAll(async () => {
  if (!workerIsolationPromise) {
    workerIsolationPromise = initializeWorkerIsolation();
  }
  await workerIsolationPromise;
});
