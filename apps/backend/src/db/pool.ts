import { Pool, PoolConfig } from 'pg';

const MAX_PRIMARY_CONNECTIONS = 20;
const MAX_REPLICA_CONNECTIONS = 20;

const DEFAULT_PRIMARY_POOL_MAX = 20;
const DEFAULT_REPLICA_POOL_MAX = 10;

const primaryMaxConnections = clampPoolSize(
  process.env.DB_POOL_MAX,
  MAX_PRIMARY_CONNECTIONS,
  DEFAULT_PRIMARY_POOL_MAX
);

const primaryMinConnections = (() => {
  const defaultMin = 2;
  const parsed = parseInt(process.env.DB_POOL_MIN ?? String(defaultMin), 10);
  const normalized = Math.max(0, Number.isNaN(parsed) ? defaultMin : parsed);
  return Math.min(primaryMaxConnections, normalized);
})();

const primaryConfig: PoolConfig = {
  connectionString: resolveConnectionString(),
  max: primaryMaxConnections,
  min: primaryMinConnections,
  idleTimeoutMillis: parseInt(process.env.DB_IDLE_TIMEOUT_MS ?? '30000', 10),
  connectionTimeoutMillis: parseInt(process.env.DB_CONNECTION_TIMEOUT_MS ?? '2000', 10),
};

export const primaryPool = new Pool(primaryConfig);

const replicaConfig = buildReplicaConfig();
export const replicaPool = replicaConfig ? new Pool(replicaConfig) : null;

type ReplicaHealth = 'unknown' | 'healthy' | 'unhealthy';
let replicaHealth: ReplicaHealth = 'unknown';

export function getReadPool(): Pool {
  if (replicaPool && replicaHealth !== 'unhealthy') {
    return replicaPool;
  }

  return primaryPool;
}

export function markReplicaHealthy(): void {
  if (replicaPool) {
    replicaHealth = 'healthy';
  }
}

export function markReplicaUnhealthy(): void {
  if (replicaPool) {
    replicaHealth = 'unhealthy';
  }
}

export function getReplicaHealth(): ReplicaHealth | 'not_configured' {
  if (!replicaPool) {
    return 'not_configured';
  }

  return replicaHealth;
}

function buildReplicaConfig(): PoolConfig | null {
  const replicaUrl = process.env.DATABASE_REPLICA_URL;
  if (!replicaUrl) {
    return null;
  }

  return {
    connectionString: replicaUrl,
    // Replica defaults to a smaller pool (10) to reduce steady-state load but can be overridden via env.
    max: clampPoolSize(
      process.env.DB_REPLICA_POOL_MAX,
      MAX_REPLICA_CONNECTIONS,
      DEFAULT_REPLICA_POOL_MAX
    ),
    idleTimeoutMillis: primaryConfig.idleTimeoutMillis,
    connectionTimeoutMillis: primaryConfig.connectionTimeoutMillis,
  };
}

function clampPoolSize(
  value: string | undefined,
  absoluteMax: number,
  defaultValue: number
): number {
  const parsed = parseInt(value ?? String(defaultValue), 10);
  if (Number.isNaN(parsed)) {
    return defaultValue;
  }
  return Math.max(1, Math.min(parsed, absoluteMax));
}

function resolveConnectionString(): string {
  if (process.env.DATABASE_URL) {
    return process.env.DATABASE_URL;
  }

  const isDevelopment = process.env.NODE_ENV === 'development';
  let user = process.env.POSTGRES_USER ?? '';
  let password = process.env.POSTGRES_PASSWORD ?? '';
  let host = process.env.POSTGRES_HOST ?? '';
  let port = process.env.POSTGRES_PORT ?? '';
  let database = process.env.POSTGRES_DB ?? '';

  const missingKeys = [
    user ? null : 'POSTGRES_USER',
    password ? null : 'POSTGRES_PASSWORD',
    host ? null : 'POSTGRES_HOST',
    port ? null : 'POSTGRES_PORT',
    database ? null : 'POSTGRES_DB',
  ].filter(Boolean) as string[];

  if (!isDevelopment && missingKeys.length > 0) {
    throw new Error(
      `Missing required Postgres environment variables: ${missingKeys.join(
        ', '
      )}. Set DATABASE_URL or configure POSTGRES_USER, POSTGRES_PASSWORD, POSTGRES_HOST, POSTGRES_PORT, and POSTGRES_DB.`
    );
  }

  if (isDevelopment && missingKeys.length > 0) {
    console.warn(
      `[db] Missing Postgres env vars (${missingKeys.join(', ')}); using development defaults.`
    );
    user = user || 'berthcare';
    password = password || 'berthcare_dev_password';
    host = host || 'localhost';
    port = port || '5432';
    database = database || 'berthcare_dev';
  }

  if (!user || !host || !port || !database) {
    throw new Error(
      'Unable to resolve Postgres connection string. Set DATABASE_URL or provide POSTGRES_USER, POSTGRES_PASSWORD, POSTGRES_HOST, POSTGRES_PORT, and POSTGRES_DB.'
    );
  }

  const auth =
    password.length > 0
      ? `${encodeURIComponent(user)}:${encodeURIComponent(password)}`
      : encodeURIComponent(user);

  return `postgresql://${auth}@${host}:${port}/${database}`;
}
