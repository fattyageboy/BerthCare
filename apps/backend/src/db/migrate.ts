import { promises as fs } from 'fs';
import path from 'path';

import dotenv from 'dotenv';
import { Client } from 'pg';

type MigrationFile = {
  code: string;
  baseName: string;
  fileName: string;
  fullPath: string;
  isDown: boolean;
};

const moduleDir = __dirname;

const envPath = path.resolve(moduleDir, '../../.env');
dotenv.config({ path: envPath });

const directionArg = process.argv[2] ?? 'up';
const direction = directionArg === 'down' ? 'down' : 'up';
const target = process.argv[3];

ensureDatabaseUrl();

const migrationsDir = path.resolve(moduleDir, 'migrations');

void (async () => {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
  });
  let exitCode = 0;

  try {
    await client.connect();
    await ensureMigrationsTable(client);

    const allMigrations = await loadMigrationFiles(migrationsDir);
    const upMigrations = allMigrations
      .filter((migration) => !migration.isDown)
      .sort(compareMigrationsAsc);

    if (upMigrations.length === 0) {
      console.log('No migration files found.');
      return;
    }

    if (direction === 'up') {
      await runMigrateUp(client, upMigrations, target);
    } else {
      await runMigrateDown(client, allMigrations, upMigrations, target);
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    exitCode = 1;
  } finally {
    try {
      await client.end();
    } catch (endError) {
      console.error('Failed to close database connection.', endError);
      exitCode = 1;
    }
    process.exitCode = exitCode;
  }
})();

async function runMigrateUp(client: Client, upMigrations: MigrationFile[], targetArg?: string) {
  const executed = await loadExecutedMigrations(client);
  const pending = upMigrations.filter((migration) => !executed.has(migration.baseName));

  if (pending.length === 0) {
    console.log('No pending migrations to apply.');
    return;
  }

  const selected = selectUpMigrations(pending, upMigrations, targetArg);

  if (selected.length === 0) {
    console.log('No migrations selected for execution.');
    return;
  }

  for (const migration of selected) {
    await applySqlFile(client, migration, 'up');
  }

  console.log('Migrations complete!');
}

async function runMigrateDown(
  client: Client,
  allMigrations: MigrationFile[],
  upMigrations: MigrationFile[],
  targetArg?: string
) {
  const executedList = await loadExecutedList(client);

  if (executedList.length === 0) {
    console.log('No migrations have been applied yet.');
    return;
  }

  const orderIndex = new Map<string, number>();
  upMigrations.forEach((migration, index) => {
    orderIndex.set(migration.baseName, index);
  });

  const downMap = new Map<string, MigrationFile>();
  for (const migration of allMigrations) {
    if (migration.isDown) {
      downMap.set(migration.baseName, migration);
    }
  }

  const planned = selectDownMigrations(executedList, orderIndex, downMap, targetArg);

  if (planned.length === 0) {
    console.log('No migrations selected for rollback.');
    return;
  }

  for (const migration of planned) {
    await applySqlFile(client, migration, 'down');
  }

  console.log('Rollback complete!');
}

async function ensureMigrationsTable(client: Client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY,
      run_on TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

async function loadMigrationFiles(dir: string): Promise<MigrationFile[]> {
  try {
    await fs.access(dir);
    const stats = await fs.stat(dir);
    if (!stats.isDirectory()) {
      throw new Error(`Migrations path is not a directory: ${dir}`);
    }
  } catch (error) {
    const message =
      error instanceof Error &&
      'code' in error &&
      (error as NodeJS.ErrnoException).code === 'ENOENT'
        ? `Migrations directory not found: ${dir}`
        : `Unable to access migrations directory at ${dir}: ${error instanceof Error ? error.message : String(error)}`;
    throw new Error(message);
  }

  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error reading directory';
    throw new Error(`Unable to read migrations directory at ${dir}: ${message}`);
  }

  const migrations: MigrationFile[] = [];

  for (const fileName of entries) {
    if (!fileName.endsWith('.sql')) {
      continue;
    }

    const parsed = parseMigrationFile(fileName, dir);
    if (parsed) {
      migrations.push(parsed);
    }
  }

  return migrations;
}

function parseMigrationFile(fileName: string, dir: string): MigrationFile | null {
  const match = /^(\d{3})_(.+)\.sql$/.exec(fileName);
  if (!match) {
    return null;
  }

  const [, code, remainder] = match;
  const downSuffix = '-down';
  const isDown = remainder.endsWith(downSuffix);
  const tail = isDown ? remainder.slice(0, -downSuffix.length) : remainder;
  const baseName = `${code}_${tail}`;

  return {
    code,
    baseName,
    fileName,
    fullPath: path.join(dir, fileName),
    isDown,
  };
}

function selectUpMigrations(
  pending: MigrationFile[],
  orderedAll: MigrationFile[],
  targetArg?: string
): MigrationFile[] {
  const normalizedTarget = targetArg?.trim();

  if (!normalizedTarget || normalizedTarget.toLowerCase() === 'all') {
    return pending;
  }

  const codeTarget = extractMigrationCode(normalizedTarget);
  if (codeTarget) {
    return filterPendingToTarget(
      pending,
      orderedAll,
      resolveMigrationName(normalizedTarget, orderedAll)
    );
  }

  if (/^\d+$/.test(normalizedTarget)) {
    const count = Number.parseInt(normalizedTarget, 10);
    return pending.slice(0, Math.max(count, 0));
  }

  return filterPendingToTarget(
    pending,
    orderedAll,
    resolveMigrationName(normalizedTarget, orderedAll)
  );
}

function filterPendingToTarget(
  pending: MigrationFile[],
  orderedAll: MigrationFile[],
  targetName: string
): MigrationFile[] {
  const limitIndex = orderedAll.findIndex((migration) => migration.baseName === targetName);

  if (limitIndex === -1) {
    throw new Error(`Unknown migration target: ${targetName}`);
  }

  const allowed = new Set(
    orderedAll.slice(0, limitIndex + 1).map((migration) => migration.baseName)
  );

  return pending.filter((migration) => allowed.has(migration.baseName));
}

function resolveMigrationName(input: string, orderedAll: MigrationFile[]): string {
  const trimmed = input.trim();

  const codeTarget = extractMigrationCode(trimmed);
  if (codeTarget) {
    const match = orderedAll.find((migration) => migration.code === codeTarget);
    if (!match) {
      throw new Error(`Unknown migration target: ${input}`);
    }
    return match.baseName;
  }

  const normalized = trimmed.endsWith('.sql') ? trimmed.slice(0, -'.sql'.length) : trimmed;
  const match = orderedAll.find(
    (migration) => migration.baseName === normalized || migration.fileName === `${normalized}.sql`
  );

  if (!match) {
    throw new Error(`Unknown migration target: ${input}`);
  }

  return match.baseName;
}

function selectDownMigrations(
  executed: string[],
  orderIndex: Map<string, number>,
  downMap: Map<string, MigrationFile>,
  targetArg?: string
): MigrationFile[] {
  const executedSorted = Array.from(new Set(executed))
    .filter((name) => orderIndex.has(name))
    .sort((a, b) => (orderIndex.get(b) ?? 0) - (orderIndex.get(a) ?? 0));

  if (executedSorted.length === 0) {
    return [];
  }

  const normalizedTarget = targetArg?.trim();

  if (!normalizedTarget) {
    return collectDownMigrations(executedSorted.slice(0, 1), downMap);
  }

  if (normalizedTarget.toLowerCase() === 'all' || normalizedTarget === '0') {
    return collectDownMigrations(executedSorted, downMap);
  }

  const codeTarget = extractMigrationCode(normalizedTarget);
  if (codeTarget) {
    const resolvedName = resolveTargetForDown(normalizedTarget, orderIndex);
    return collectDownMigrations(
      selectNamesToRollback(executedSorted, orderIndex, resolvedName),
      downMap
    );
  }

  if (/^\d+$/.test(normalizedTarget)) {
    const count = Number.parseInt(normalizedTarget, 10);
    return collectDownMigrations(executedSorted.slice(0, Math.max(count, 0)), downMap);
  }

  const resolvedName = resolveTargetForDown(normalizedTarget, orderIndex);
  return collectDownMigrations(
    selectNamesToRollback(executedSorted, orderIndex, resolvedName),
    downMap
  );
}

function selectNamesToRollback(
  executedSorted: string[],
  orderIndex: Map<string, number>,
  resolvedName: string
): string[] {
  const targetIndex = orderIndex.get(resolvedName);

  if (targetIndex === undefined) {
    throw new Error(`Unknown migration target: ${resolvedName}`);
  }

  const namesToRollback = executedSorted.filter(
    (name) => (orderIndex.get(name) ?? -1) >= targetIndex
  );

  return namesToRollback;
}

function resolveTargetForDown(input: string, orderIndex: Map<string, number>): string {
  const trimmed = input.trim();

  const codeTarget = extractMigrationCode(trimmed);
  if (codeTarget) {
    const candidates = Array.from(orderIndex.entries()).filter(([name]) =>
      name.startsWith(`${codeTarget}_`)
    );
    if (candidates.length === 0) {
      throw new Error(`Unknown migration target: ${input}`);
    }

    candidates.sort((a, b) => b[1] - a[1]);
    return candidates[0][0];
  }

  const normalized = trimmed.endsWith('.sql') ? trimmed.slice(0, -'.sql'.length) : trimmed;

  if (!orderIndex.has(normalized)) {
    throw new Error(`Unknown migration target: ${input}`);
  }

  return normalized;
}

function extractMigrationCode(value?: string): string | null {
  if (!value) {
    return null;
  }

  const match = /^(?:#|m)(\d{3})$/i.exec(value.trim());
  return match ? match[1] : null;
}

function collectDownMigrations(
  names: string[],
  downMap: Map<string, MigrationFile>
): MigrationFile[] {
  const selected: MigrationFile[] = [];

  for (const name of names) {
    const migration = downMap.get(name);
    if (!migration) {
      throw new Error(
        `Missing rollback SQL file for migration "${name}". Expected "<code>_<name>-down.sql"`
      );
    }
    selected.push(migration);
  }

  return selected;
}

async function applySqlFile(client: Client, migration: MigrationFile, mode: 'up' | 'down') {
  const sql = await fs.readFile(migration.fullPath, 'utf8');
  console.log(`${mode === 'up' ? 'Applying' : 'Reverting'} ${migration.fileName}`);

  await client.query('BEGIN');
  try {
    await client.query(sql);

    if (mode === 'up') {
      await client.query(
        `
          INSERT INTO schema_migrations (name, run_on)
          VALUES ($1, NOW())
          ON CONFLICT (name) DO NOTHING
        `,
        [migration.baseName]
      );
    } else {
      await client.query('DELETE FROM schema_migrations WHERE name = $1', [migration.baseName]);
    }

    await client.query('COMMIT');
    console.log(`✔ ${migration.baseName} ${mode === 'up' ? 'applied' : 'reverted'}`);
  } catch (error) {
    await client.query('ROLLBACK');
    throw new Error(
      `Migration "${migration.fileName}" failed: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}

async function loadExecutedMigrations(client: Client): Promise<Set<string>> {
  const result = await client.query<{ name: string }>('SELECT name FROM schema_migrations');
  return new Set(result.rows.map((row) => row.name));
}

async function loadExecutedList(client: Client): Promise<string[]> {
  const result = await client.query<{ name: string }>(
    'SELECT name FROM schema_migrations ORDER BY run_on DESC, name DESC'
  );
  return result.rows.map((row) => row.name);
}

function compareMigrationsAsc(a: MigrationFile, b: MigrationFile): number {
  if (a.code !== b.code) {
    return Number.parseInt(a.code, 10) - Number.parseInt(b.code, 10);
  }

  return a.baseName.localeCompare(b.baseName);
}

function ensureDatabaseUrl() {
  if (process.env.DATABASE_URL) {
    return;
  }

  const user = process.env.POSTGRES_USER ?? 'berthcare';
  const password = process.env.POSTGRES_PASSWORD ?? 'berthcare_dev_password';
  const host = process.env.POSTGRES_HOST ?? 'localhost';
  const port = process.env.POSTGRES_PORT ?? '5432';
  const database = process.env.POSTGRES_DB ?? 'berthcare_dev';

  const auth =
    password.length > 0
      ? `${encodeURIComponent(user)}:${encodeURIComponent(password)}`
      : encodeURIComponent(user);

  process.env.DATABASE_URL = `postgresql://${auth}@${host}:${port}/${database}`;
}
