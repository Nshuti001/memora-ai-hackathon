import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { pool, closePool } from './db.js';

const here = dirname(fileURLToPath(import.meta.url));

/** Splits the schema into statements, dropping `--` comments so they can't confuse the split. */
function statementsOf(sql: string): string[] {
  return sql
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('--'))
    .join('\n')
    .split(';')
    .map((statement) => statement.trim())
    .filter(Boolean);
}

function labelOf(statement: string): string {
  const created = statement.match(
    /CREATE\s+(?:VECTOR\s+|INVERTED\s+)?(TABLE|INDEX)\s+(?:IF NOT EXISTS\s+)?(\S+)/i,
  );
  if (created) return `${created[1].toLowerCase()} ${created[2]}`;

  const zoned = statement.match(/ALTER\s+TABLE\s+(\S+)\s+CONFIGURE\s+ZONE/i);
  if (zoned) return `zone config ${zoned[1]}`;

  return statement.slice(0, 48).replace(/\s+/g, ' ');
}

async function main() {
  const sql = await readFile(join(here, 'schema.sql'), 'utf8');
  const statements = statementsOf(sql);

  console.log(`Applying ${statements.length} statements to CockroachDB…\n`);

  for (const statement of statements) {
    const label = labelOf(statement);
    try {
      await pool.query(statement);
      console.log(`  ok    ${label}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);

      if (/already exists/i.test(message)) {
        console.log(`  skip  ${label} (already exists)`);
        continue;
      }

      if (/CONFIGURE ZONE/i.test(statement)) {
        console.log(
          `  warn  ${label} — could not extend MVCC retention (${message.split('\n')[0]}).\n` +
            `        Time-travel recall still works, but only within the cluster's default window.`,
        );
        continue;
      }

      if (/vector/i.test(statement) && /unimplemented|unsupported|syntax error/i.test(message)) {
        console.error(
          `\n  FAIL  ${label}\n` +
            `        ${message}\n\n` +
            `        Vector indexing needs a recent CockroachDB version. Check your cluster version in\n` +
            `        the Cloud Console; if it is older than v25.2, create a new cluster on the current\n` +
            `        release. Recall still works without the index (CockroachDB falls back to an exact\n` +
            `        scan) but it will not stay fast as the memory count grows, and the hackathon\n` +
            `        requires distributed vector indexing to actually be in use.\n`,
        );
        process.exitCode = 1;
        continue;
      }

      console.error(`\n  FAIL  ${label}\n        ${message}\n`);
      throw err;
    }
  }

  console.log('\nSchema is up to date.');
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(closePool);
