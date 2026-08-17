/**
 * Evaluates the vector-index classifier on CLINC150.
 *
 *   Larson et al., "An Evaluation Dataset for Intent Classification and Out-of-Scope Prediction",
 *   EMNLP 2019. https://github.com/clinc/oos-eval — CC BY 3.0.
 *
 * Run:  npm run ml:clinc
 *
 * Why this benchmark: CLINC150 pairs 150 fine-grained intents with a labelled *out-of-scope* set,
 * and out-of-scope is the decision Memora actually has to make on every turn — is this a fact worth
 * remembering, or is it small talk? Measuring against a published benchmark turns "we have some
 * heuristics" into a number someone else can reproduce.
 *
 * The whole evaluation runs on embeddings and SQL. No Bedrock chat model is involved, which is the
 * point: this deployment's chat quota is zero, and the classifier does not care.
 */

import { readFile } from 'node:fs/promises';
import { config } from './config.js';
import { closePool, query, withTransaction } from './db.js';
import { embedBatch, toVectorLiteral, activeEmbeddingModel } from './embeddings.js';
import { classifyVector, fitOosThreshold, nearestLabelledByVector, OUT_OF_SCOPE, DEFAULT_K } from './intent.js';

const TENANT = 'clinc_eval';
const AGENT = 'clinc';

/** Kept small enough to run in a couple of minutes; every example costs one embedding call. */
const INTENTS = Number(process.env.CLINC_INTENTS ?? 15);
const TRAIN_PER_INTENT = Number(process.env.CLINC_TRAIN ?? 30);
const TEST_PER_INTENT = Number(process.env.CLINC_TEST ?? 15);
const OOS_VAL = Number(process.env.CLINC_OOS_VAL ?? 60);
const OOS_TEST = Number(process.env.CLINC_OOS_TEST ?? 150);

type Row = [string, string];
interface Clinc {
  train: Row[];
  val: Row[];
  test: Row[];
  oos_val: Row[];
  oos_test: Row[];
}

function take<T>(rows: T[], n: number): T[] {
  return rows.slice(0, n);
}

function byIntent(rows: Row[]): Map<string, string[]> {
  const m = new Map<string, string[]>();
  for (const [text, intent] of rows) {
    const list = m.get(intent);
    if (list) list.push(text);
    else m.set(intent, [text]);
  }
  return m;
}

/**
 * Opens the first connection, retrying briefly.
 *
 * A serverless CockroachDB cluster that has been idle takes a few seconds to accept its first
 * connection, and the pool's 10s timeout can expire during that wake-up. Every later query is fast,
 * so this only guards the very first one — without it, running the benchmark against a cold cluster
 * fails on line one for a reason that has nothing to do with the benchmark.
 */
async function warmUp(attempts = 5): Promise<void> {
  for (let i = 1; i <= attempts; i += 1) {
    try {
      await query('SELECT 1');
      return;
    } catch (err) {
      if (i === attempts) throw err;
      console.log(`  cluster still waking (attempt ${i}/${attempts})…`);
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
}

async function ensureAgent(): Promise<string> {
  const [row] = await query<{ id: string }>(
    `INSERT INTO agents (tenant_id, name) VALUES ($1, $2)
     ON CONFLICT (tenant_id, name) DO UPDATE SET name = excluded.name
     RETURNING id`,
    [TENANT, AGENT],
  );
  return row.id;
}

/** Embeds and stores the labelled examples. This is the entirety of "training" for a kNN model. */
async function loadTrainingSet(agentId: string, examples: Row[]): Promise<number> {
  await query(`DELETE FROM memories WHERE tenant_id = $1`, [TENANT]);

  // One Bedrock call per 96 examples rather than per example — see embedBatch.
  const vectors = await embedBatch(examples.map(([text]) => text), 'document');
  process.stdout.write(`  embedded ${vectors.length}/${examples.length}\n`);

  let written = 0;
  for (let i = 0; i < examples.length; i += 1) {
    const [text, intent] = examples[i];
    const embedded = vectors[i];
    await withTransaction((client) =>
      client.query(
        `INSERT INTO memories (tenant_id, agent_id, kind, content, embedding, embedding_model, metadata)
         VALUES ($1, $2, 'semantic', $3, $4, $5, $6)`,
        [TENANT, agentId, text, toVectorLiteral(embedded.vector), embedded.model, { intent }],
      ),
    );
    written += 1;
  }
  return written;
}

async function main(): Promise<void> {
  const path = process.env.CLINC_PATH ?? '/tmp/clinc_full.json';
  const data: Clinc = JSON.parse(await readFile(path, 'utf8'));

  console.log('CLINC150 — kNN over the CockroachDB vector index');
  console.log(`  embedding model : ${activeEmbeddingModel()}`);
  console.log(`  provider        : ${config.embeddingProvider}`);
  console.log(`  k               : ${DEFAULT_K}\n`);

  const trainByIntent = byIntent(data.train);
  const intents = [...trainByIntent.keys()].sort().slice(0, INTENTS);
  const chosen = new Set(intents);

  const trainRows: Row[] = intents.flatMap((i) =>
    take(trainByIntent.get(i) ?? [], TRAIN_PER_INTENT).map((t) => [t, i] as Row),
  );

  const valByIntent = byIntent(data.val.filter(([, i]) => chosen.has(i)));
  const valRows: Row[] = intents.flatMap((i) =>
    take(valByIntent.get(i) ?? [], 5).map((t) => [t, i] as Row),
  );

  const testByIntent = byIntent(data.test.filter(([, i]) => chosen.has(i)));
  const testRows: Row[] = intents.flatMap((i) =>
    take(testByIntent.get(i) ?? [], TEST_PER_INTENT).map((t) => [t, i] as Row),
  );

  const oosVal = take(data.oos_val, OOS_VAL);
  const oosTest = take(data.oos_test, OOS_TEST);

  console.log(`  intents         : ${intents.length}`);
  console.log(`  train examples  : ${trainRows.length}`);
  console.log(`  val / oos-val   : ${valRows.length} / ${oosVal.length}`);
  console.log(`  test / oos-test : ${testRows.length} / ${oosTest.length}\n`);

  await warmUp();
  const agentId = await ensureAgent();
  console.log('Loading training set (embed + insert)…');
  const started = Date.now();
  await loadTrainingSet(agentId, trainRows);
  console.log(`  stored in ${((Date.now() - started) / 1000).toFixed(1)}s\n`);

  // --- Fit the out-of-scope threshold on validation data only ---
  console.log('Fitting out-of-scope threshold on the validation split…');
  const nearestDistances = async (rows: Row[]): Promise<number[]> => {
    const vecs = await embedBatch(rows.map(([t]) => t), 'query');
    const out: number[] = [];
    for (const v of vecs) {
      const n = await nearestLabelledByVector({ tenantId: TENANT, agentId, vector: v.vector });
      out.push(n[0]?.distance ?? Infinity);
    }
    return out;
  };
  const valDistances = await nearestDistances(valRows);
  const oosValDistances = await nearestDistances(oosVal);
  const { threshold, balancedAccuracy } = fitOosThreshold(valDistances, oosValDistances);
  console.log(`  threshold ${threshold.toFixed(4)}  (val balanced accuracy ${(balancedAccuracy * 100).toFixed(1)}%)\n`);

  // --- Test: in-scope accuracy ---
  console.log('Evaluating on the held-out test split…');
  let correct = 0;
  let keptInScope = 0;
  const latencies: number[] = [];

  const testVecs = await embedBatch(testRows.map(([t]) => t), 'query');
  for (let i = 0; i < testRows.length; i += 1) {
    const gold = testRows[i][1];
    const v = testVecs[i];
    // Timed around the database lookup only: the embedding is already batched above, and in the
    // running product it is computed once and reused for recall too.
    const t0 = Date.now();
    const p = await classifyVector({ tenantId: TENANT, agentId, vector: v.vector, oosThreshold: threshold });
    latencies.push(Date.now() - t0);
    if (p.intent !== OUT_OF_SCOPE) keptInScope += 1;
    if (p.intent === gold) correct += 1;
  }

  // --- Test: out-of-scope recall ---
  let oosCaught = 0;
  const oosVecs = await embedBatch(oosTest.map(([t]) => t), 'query');
  for (const v of oosVecs) {
    const p = await classifyVector({ tenantId: TENANT, agentId, vector: v.vector, oosThreshold: threshold });
    if (p.intent === OUT_OF_SCOPE) oosCaught += 1;
  }

  // Accuracy with out-of-scope detection disabled, to separate the two failure modes: how good is
  // the classifier itself, before the threshold starts rejecting things?
  let rawCorrect = 0;
  for (let i = 0; i < testRows.length; i += 1) {
    const v = testVecs[i];
    const p = await classifyVector({ tenantId: TENANT, agentId, vector: v.vector });
    if (p.intent === testRows[i][1]) rawCorrect += 1;
  }

  latencies.sort((a, b) => a - b);
  const p50 = latencies[Math.floor(latencies.length * 0.5)] ?? 0;
  const p95 = latencies[Math.floor(latencies.length * 0.95)] ?? 0;

  const inScopeAcc = (correct / testRows.length) * 100;
  const rawAcc = (rawCorrect / testRows.length) * 100;
  const oosRecall = (oosCaught / oosTest.length) * 100;

  console.log('\n=== Results ===');
  console.log(`  in-scope accuracy (with OOS detection) : ${inScopeAcc.toFixed(1)}%  (${correct}/${testRows.length})`);
  console.log(`  in-scope accuracy (classifier alone)   : ${rawAcc.toFixed(1)}%  (${rawCorrect}/${testRows.length})`);
  console.log(`  out-of-scope recall                    : ${oosRecall.toFixed(1)}%  (${oosCaught}/${oosTest.length})`);
  console.log(`  in-scope retained                      : ${((keptInScope / testRows.length) * 100).toFixed(1)}%`);
  console.log(`  classify latency                       : p50 ${p50}ms · p95 ${p95}ms`);
  console.log(`\n  ${intents.length}-way problem, ${trainRows.length} labelled examples, no model trained.`);

  await closePool();
}

main().catch(async (err) => {
  console.error(err);
  await closePool().catch(() => {});
  process.exit(1);
});
