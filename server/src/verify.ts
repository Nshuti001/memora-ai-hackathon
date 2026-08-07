/**
 * End-to-end credential check. Run after filling in .env:
 *
 *   npm run verify
 *
 * Exercises every external dependency in order and prints measured latency, so a failure points at
 * exactly one thing rather than "something is misconfigured".
 */
import { pool, closePool, query } from './db.js';
import { embed } from './embeddings.js';
import { remember, recall } from './memory.js';
import { config } from './config.js';

const TENANT = 'verify';

function ms(started: number): string {
  return `${Date.now() - started}ms`;
}

async function main() {
  console.log('Verifying Memora setup\n');
  console.log(`   region=${config.awsRegion}  model=${config.modelId}  embed=${config.embedModelId}`);
  console.log(`   provider=${config.embeddingProvider}\n`);

  let started = Date.now();
  const [version] = await query<{ version: string }>('SELECT version() AS version');
  console.log(`1. CockroachDB connection  ok  (${ms(started)})`);
  console.log(`   ${version.version.split(' ').slice(0, 3).join(' ')}`);

  const [indexRow] = await query<{ count: string }>(
    `SELECT count(*) AS count FROM [SHOW INDEXES FROM memories] WHERE index_name = 'memories_embedding_idx'`,
  );
  if (Number(indexRow.count) > 0) {
    console.log('2. Vector index            ok  (memories_embedding_idx present)');
  } else {
    console.log('2. Vector index            MISSING — run `npm run db:migrate` first');
    process.exitCode = 1;
  }

  started = Date.now();
  let vector: number[];
  try {
    ({ vector } = await embed('The user prefers dark mode interfaces.'));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/Too many|Throttl/i.test(message)) {
      console.log('3. Bedrock embeddings      THROTTLED (credentials work; free-tier quota hit)');
      console.log('   Wait for the daily reset, or temporarily set EMBEDDING_PROVIDER=local to keep building.');
      console.log(`   Detail: ${message.slice(0, 160)}`);
      process.exitCode = 1;
      return;
    }
    throw err;
  }
  const provider = config.embeddingProvider === 'local' ? 'Local embeddings   ' : 'Bedrock embeddings ';
  console.log(`3. ${provider}      ok  (${ms(started)}, ${vector.length} dimensions)`);
  console.log(
    config.embeddingProvider === 'local'
      ? '   offline stand-in — lexical overlap only, set EMBEDDING_PROVIDER=bedrock for real semantics'
      : `   model ${config.embedModelId}`,
  );

  const [agent] = await query<{ id: string }>(
    `INSERT INTO agents (tenant_id, name, description)
          VALUES ($1, 'verify-agent', 'Created by npm run verify')
     ON CONFLICT (tenant_id, name) DO UPDATE SET description = excluded.description
       RETURNING id`,
    [TENANT],
  );

  started = Date.now();
  const written = await remember({
    tenantId: TENANT,
    agentId: agent.id,
    content: 'The user deploys to production on Fridays and prefers zero-downtime migrations.',
    kind: 'semantic',
    importance: 0.8,
  });
  console.log(`4. Write memory            ok  (${ms(started)}${written.deduplicated ? ', deduplicated' : ''})`);

  started = Date.now();
  const hits = await recall({
    tenantId: TENANT,
    agentId: agent.id,
    query: 'when does this team ship code?',
    limit: 3,
  });
  console.log(`5. Semantic recall         ok  (${ms(started)}, ${hits.length} hit(s))`);
  for (const hit of hits) {
    console.log(`   ${hit.score.toFixed(3)}  ${hit.content}`);
  }

  if (hits.length === 0) {
    console.log('\nRecall returned nothing, which means the write and the search disagree. Check that');
    console.log('EMBED_DIM matches the VECTOR(...) width in schema.sql.');
    process.exitCode = 1;
    return;
  }

  console.log('\nEverything is wired up. Start the API with `npm run dev`.');
}

main()
  .catch((err) => {
    console.error('\nVerification failed:\n');
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.query('DELETE FROM memory_audit WHERE tenant_id = $1', [TENANT]).catch(() => {});
    await pool.query('DELETE FROM agents WHERE tenant_id = $1', [TENANT]).catch(() => {});
    await closePool();
  });
