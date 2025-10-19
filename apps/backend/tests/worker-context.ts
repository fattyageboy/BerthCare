import crypto from 'crypto';

/**
 * Redis logical database ceiling. Redis exposes 16 logical databases (0-15) by default.
 * Allow overriding via TEST_REDIS_DB_LIMIT for custom deployments.
 */
export const REDIS_LOGICAL_DB_LIMIT = Number.parseInt(
  process.env.TEST_REDIS_DB_LIMIT ?? '16',
  10
);

export type WorkerIsolationContext = {
  workerId: number;
  workerIndex: number;
  baseDatabaseUrl: string;
  baseRedisUrl: string;
  redisDb: number;
  redisUrl: string;
  schemaPrefix: string;
};

declare global {
  // eslint-disable-next-line no-var
  var __TEST_WORKER_CONTEXT__?: WorkerIsolationContext;
}

function ensureEnv(variable: string, value: string | undefined): string {
  if (!value) {
    throw new Error(`${variable} environment variable is required for test execution`);
  }
  return value;
}

function resolveWorkerId(): number {
  const rawWorkerId =
    process.env.JEST_WORKER_ID ??
    // Allow overriding manually during CI or local debugging
    process.env.TEST_JEST_WORKER_ID ??
    '1';

  const parsed = Number.parseInt(rawWorkerId, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Invalid JEST_WORKER_ID value "${rawWorkerId}". Expected positive integer.`);
  }
  return parsed;
}

function parseBaseRedisDb(redisUrl: URL): number {
  const path = redisUrl.pathname?.replace('/', '') ?? '';
  if (!path) {
    return 0;
  }

  const parsed = Number.parseInt(path, 10);
  if (Number.isNaN(parsed) || parsed < 0) {
    throw new Error(
      `Invalid Redis logical database "${path}" in TEST_REDIS_URL. Expected non-negative integer.`
    );
  }
  return parsed;
}

function createWorkerContext(): WorkerIsolationContext {
  const workerId = resolveWorkerId();
  const workerIndex = workerId - 1;

  const baseDatabaseUrl = ensureEnv('TEST_DATABASE_URL', process.env.TEST_DATABASE_URL);
  const baseRedisUrl = ensureEnv('TEST_REDIS_URL', process.env.TEST_REDIS_URL);

  const redisUrl = new URL(baseRedisUrl);
  const baseDb = parseBaseRedisDb(redisUrl);

  const redisDb = baseDb + workerIndex;
  if (redisDb >= REDIS_LOGICAL_DB_LIMIT) {
    throw new Error(
      `Jest worker ${workerId} maps to Redis logical database ${redisDb}, which exceeds the configured limit (${REDIS_LOGICAL_DB_LIMIT - 1}). ` +
        'Increase TEST_REDIS_DB_LIMIT or reduce maxWorkers.'
    );
  }

  redisUrl.pathname = `/${redisDb}`;

  const schemaPrefix = `test_schema_w${workerId}`;

  const context: WorkerIsolationContext = {
    workerId,
    workerIndex,
    baseDatabaseUrl,
    baseRedisUrl,
    redisDb,
    redisUrl: redisUrl.toString(),
    schemaPrefix,
  };

  global.__TEST_WORKER_CONTEXT__ = context;
  return context;
}

export function getWorkerContext(): WorkerIsolationContext {
  return global.__TEST_WORKER_CONTEXT__ ?? createWorkerContext();
}

export function buildSchemaName(): string {
  const { schemaPrefix } = getWorkerContext();
  const suffix = crypto.randomUUID().replace(/-/g, '').slice(0, 12);
  return `${schemaPrefix}_${suffix}`;
}

export function buildSchemaConnectionString(schemaName: string): string {
  const { baseDatabaseUrl } = getWorkerContext();
  const schemaUrl = new URL(baseDatabaseUrl);
  const existingOptions = schemaUrl.searchParams.get('options');
  const searchPathOption = `-c search_path=${schemaName},public`;

  schemaUrl.searchParams.set(
    'options',
    existingOptions ? `${existingOptions} ${searchPathOption}` : searchPathOption
  );

  return schemaUrl.toString();
}
