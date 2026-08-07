/**
 * Re-embeds memories that were written by a different embedding model.
 *
 *   npm run db:reembed          # report what would change
 *   npm run db:reembed -- --run # actually rewrite the vectors
 *
 * Why this exists: vectors from two models occupy unrelated spaces, so recall filters on
 * `embedding_model` and simply cannot see rows written by a different one. That happens for real —
 * a Bedrock throttle sends `EMBEDDING_PROVIDER=auto` to the local fallback mid-session, and every
 * memory written during the outage lands in the wrong space. This brings the store back to one
 * model without losing content, importance, links, or history.
 *
 * The row's identity is preserved: only `embedding` and `embedding_model` change, so supersession
 * chains, graph edges and audit history all stay intact.
 */
import { closePool, query } from './db.js';
import { activeEmbeddingModel, embed, toVectorLiteral } from './embeddings.js';
import { config } from './config.js';

const APPLY = process.argv.includes('--run');
const BATCH = 25;

interface Row {
  id: string;
  content: string;
  embedding_model: string;
}

async function main() {
  const target = activeEmbeddingModel();

  console.log(`Active embedding model: ${target}  (provider=${config.embeddingProvider})\n`);

  const spread = await query<{ embedding_model: string; count: string }>(
    `SELECT embedding_model, count(*) AS count FROM memories GROUP BY embedding_model ORDER BY count DESC`,
  );

  if (spread.length === 0) {
    console.log('No memories stored yet — nothing to do.');
    return;
  }

  console.log('Memories by embedding model:');
  for (const row of spread) {
    const marker = row.embedding_model === target ? '  (current)' : '  <- needs re-embedding';
    console.log(`  ${String(row.count).padStart(6)}  ${row.embedding_model}${marker}`);
  }

  const stale = await query<Row>(
    `SELECT id, content, embedding_model FROM memories WHERE embedding_model != $1 ORDER BY created_at`,
    [target],
  );

  if (stale.length === 0) {
    console.log('\nEvery memory is in the active model\'s vector space. Recall is consistent.');
    return;
  }

  console.log(`\n${stale.length} memor${stale.length === 1 ? 'y is' : 'ies are'} unsearchable by the active model.`);

  if (!APPLY) {
    console.log('\nDry run — nothing written. Re-run with --run to rewrite these vectors:');
    console.log('  npm run db:reembed -- --run');
    return;
  }

  // Guard against the most damaging mistake this script could make: silently rewriting the whole
  // store into the *lexical fallback* space because Bedrock happened to be throttled right now.
  if (target === 'local-lexical-v1' && config.embeddingProvider !== 'local') {
    console.error(
      '\nRefusing to run. The active model is the local lexical fallback, which means Bedrock is\n' +
        'currently unavailable. Re-embedding now would convert real semantic vectors into lexical\n' +
        'ones. Wait for Bedrock, or set EMBEDDING_PROVIDER=local deliberately if that is what you want.',
    );
    process.exitCode = 1;
    return;
  }

  console.log('\nRe-embedding…');
  let done = 0;
  let failed = 0;

  for (let i = 0; i < stale.length; i += BATCH) {
    const batch = stale.slice(i, i + BATCH);

    for (const row of batch) {
      try {
        const embedded = await embed(row.content);

        // If the provider fell back mid-run, stop rather than write a second wrong space.
        if (embedded.model !== target) {
          console.error(
            `\nProvider changed mid-run (${target} -> ${embedded.model}). Stopping after ${done} rows ` +
              `to avoid mixing spaces. Re-run when the provider is stable.`,
          );
          process.exitCode = 1;
          return;
        }

        await query(
          `UPDATE memories SET embedding = $1, embedding_model = $2, updated_at = now() WHERE id = $3`,
          [toVectorLiteral(embedded.vector), embedded.model, row.id],
        );
        done++;
      } catch (err) {
        failed++;
        console.error(`  failed ${row.id}: ${err instanceof Error ? err.message.slice(0, 120) : err}`);
      }
    }

    process.stdout.write(`  ${Math.min(i + BATCH, stale.length)}/${stale.length}\r`);
  }

  console.log(`\n\nRe-embedded ${done} memor${done === 1 ? 'y' : 'ies'}${failed ? `, ${failed} failed` : ''}.`);
  if (failed === 0) console.log('Recall is consistent again.');
}

main()
  .catch((err) => {
    console.error('\nRe-embedding failed:', err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(closePool);
