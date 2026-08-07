/**
 * Test harness.
 *
 * Tests run against a real CockroachDB — an in-memory fake would not exercise the vector index, the
 * MVCC time travel, or serializable retry behaviour, which is most of what is worth testing here.
 *
 * Start a local cluster first:
 *   cockroach start-single-node --insecure --listen-addr=localhost:26257
 *
 * Embeddings use the deterministic local provider, so no AWS credentials are needed.
 */
process.env.NODE_ENV ??= 'test';
process.env.EMBEDDING_PROVIDER = 'local';
process.env.DATABASE_URL ??= 'postgresql://root@localhost:26257/memora_test?sslmode=disable';

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { pool, query } from '../src/db.js';

const here = dirname(fileURLToPath(import.meta.url));

let migrated = false;

export async function ensureSchema(): Promise<void> {
  if (migrated) return;

  const sql = await readFile(join(here, '..', 'src', 'schema.sql'), 'utf8');
  const statements = sql
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('--'))
    .join('\n')
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);

  for (const statement of statements) {
    try {
      await pool.query(statement);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // Zone configuration is unavailable on some tiers; time travel still works within the default
      // window, so this must not fail the suite.
      if (/already exists/i.test(message) || /CONFIGURE ZONE/i.test(statement)) continue;
      throw err;
    }
  }

  migrated = true;
}

/**
 * Each test gets its own tenant id, so tests are isolated from each other without truncating shared
 * tables — which also means they can run against a cluster that already has data in it.
 */
export function freshTenant(): string {
  return `test-${randomUUID().slice(0, 8)}`;
}

export async function createAgent(tenantId: string, name = 'test-agent'): Promise<string> {
  const [row] = await query<{ id: string }>(
    `INSERT INTO agents (tenant_id, name) VALUES ($1, $2)
     ON CONFLICT (tenant_id, name) DO UPDATE SET name = excluded.name
       RETURNING id`,
    [tenantId, name],
  );
  return row.id;
}

export async function cleanupTenant(tenantId: string): Promise<void> {
  await query('DELETE FROM memory_audit WHERE tenant_id = $1', [tenantId]);
  await query('DELETE FROM memory_links WHERE tenant_id = $1', [tenantId]);
  await query('UPDATE memories SET superseded_by = NULL WHERE tenant_id = $1', [tenantId]);
  await query('DELETE FROM memories WHERE tenant_id = $1', [tenantId]);
  await query('DELETE FROM sessions WHERE tenant_id = $1', [tenantId]);
  await query('DELETE FROM agents WHERE tenant_id = $1', [tenantId]);
}

export async function shutdown(): Promise<void> {
  await pool.end();
}

/** True when a CockroachDB is reachable, so the suite can skip cleanly instead of failing. */
export async function databaseAvailable(): Promise<boolean> {
  try {
    await pool.query('SELECT 1');
    return true;
  } catch {
    return false;
  }
}
