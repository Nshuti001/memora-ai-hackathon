import { Pool, type PoolClient, type QueryResultRow } from 'pg';
import { config } from './config.js';

export const pool = new Pool({
  connectionString: config.databaseUrl,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
  application_name: 'memora',
});

pool.on('error', (err) => {
  console.error('[db] idle client error', err);
});

export async function query<T extends QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<T[]> {
  const result = await pool.query<T>(text, params);
  return result.rows;
}

/**
 * CockroachDB runs SERIALIZABLE isolation, so a transaction that loses a conflict is aborted with
 * SQLSTATE 40001 and is expected to be retried by the client — it is a normal outcome under
 * concurrency, not a failure. Anything that writes memories goes through here.
 */
export async function withTransaction<T>(
  fn: (client: PoolClient) => Promise<T>,
  maxAttempts = 5,
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      lastError = err;

      const retryable = (err as { code?: string })?.code === '40001';
      if (!retryable || attempt === maxAttempts) throw err;

      // Exponential backoff with jitter so retrying clients don't resynchronize into the same
      // conflict on the next attempt.
      const backoffMs = Math.min(2 ** attempt * 25, 500) * (0.5 + Math.random());
      await new Promise((resolve) => setTimeout(resolve, backoffMs));
    } finally {
      client.release();
    }
  }

  throw lastError;
}

export async function closePool(): Promise<void> {
  await pool.end();
}
