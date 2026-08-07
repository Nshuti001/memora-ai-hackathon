/**
 * Seeds a realistic memory store so the dashboard has something to show before anyone has talked to
 * the agent.
 *
 *   npm run db:seed
 *
 * The data is deliberately shaped to demonstrate each memory behaviour: a cluster of related
 * episodes that consolidation can distill, a belief that gets corrected twice so the provenance
 * chain has depth, shared memories visible across agents, and a low-importance memory that decay
 * will archive.
 */
import { closePool, query } from './db.js';
import { remember, supersede } from './memory.js';
import { config } from './config.js';

const TENANT = process.env.SEED_TENANT ?? 'demo';

async function agentFor(name: string): Promise<string> {
  const [row] = await query<{ id: string }>(
    `INSERT INTO agents (tenant_id, name, description) VALUES ($1, $2, $3)
     ON CONFLICT (tenant_id, name) DO UPDATE SET description = excluded.description
       RETURNING id`,
    [TENANT, name, 'Seeded by npm run db:seed'],
  );
  return row.id;
}

const SEMANTIC: [string, number, string[]][] = [
  ['The user prefers dark mode interfaces in every tool they use', 0.7, ['preference', 'ui']],
  ['The user works in the Europe/Berlin timezone', 0.75, ['preference', 'timezone']],
  ['The team ships to production on Fridays and requires zero-downtime migrations', 0.9, ['devops']],
  ['The user prefers phased rollouts over big-bang releases', 0.85, ['preference', 'process']],
  ['Code review requires two approvals before merge to main', 0.8, ['process']],
];

const PROCEDURAL: [string, number, string[]][] = [
  ['To deploy, run make release, tag the commit, then watch the canary dashboard for ten minutes', 0.8, ['devops']],
  ['To roll back, re-tag the previous release and redeploy; never revert the migration itself', 0.85, ['devops']],
];

/** These all circle the same topic, so consolidation has a real cluster to distill. */
const EPISODIC_CLUSTER = [
  'User asked about migrating the REST endpoints to GraphQL this morning',
  'User asked whether the GraphQL migration should cover the auth endpoints first',
  'User asked how long the GraphQL endpoints migration would take overall',
  'User asked about GraphQL migration risk for the auth endpoints again this afternoon',
];

const EPISODIC_MISC: [string, number][] = [
  ['User mentioned the Nordic region grew twelve percent last quarter', 0.5],
  ['User asked for the on-call rotation to be rebalanced', 0.45],
  ['User mentioned in passing that the office coffee machine is broken', 0.12],
];

const SHARED = [
  'The staging database credentials rotate every Monday at 03:00 UTC',
  'The billing service owns the ledger schema; do not write to it from other services',
];

async function main() {
  console.log(`Seeding tenant "${TENANT}" (embeddings: ${config.embeddingProvider})\n`);

  const memora = await agentFor('memora');
  const analyst = await agentFor('analyst');
  let written = 0;

  for (const [content, importance, tags] of SEMANTIC) {
    await remember({ tenantId: TENANT, agentId: memora, content, kind: 'semantic', importance, tags });
    written++;
  }

  for (const [content, importance, tags] of PROCEDURAL) {
    await remember({ tenantId: TENANT, agentId: memora, content, kind: 'procedural', importance, tags });
    written++;
  }

  for (const content of EPISODIC_CLUSTER) {
    await remember({ tenantId: TENANT, agentId: memora, content, kind: 'episodic', importance: 0.5 });
    written++;
  }

  for (const [content, importance] of EPISODIC_MISC) {
    await remember({ tenantId: TENANT, agentId: memora, content, kind: 'episodic', importance });
    written++;
  }

  // Written by a second agent and shared, so cross-agent recall has something to find.
  for (const content of SHARED) {
    await remember({
      tenantId: TENANT,
      agentId: analyst,
      content,
      kind: 'semantic',
      importance: 0.8,
      shared: true,
    });
    written++;
  }

  // A belief revised twice — gives the provenance view and the graph's supersedes edges real depth.
  const original = await remember({
    tenantId: TENANT,
    agentId: memora,
    content: 'Memory retention is configured to thirty days',
    kind: 'semantic',
    importance: 0.6,
  });
  const revised = await supersede({
    tenantId: TENANT,
    agentId: memora,
    oldId: original.memory.id,
    content: 'Memory retention was raised to sixty days after the audit',
  });
  await supersede({
    tenantId: TENANT,
    agentId: memora,
    oldId: revised.id,
    content: 'Memory retention is now ninety days, matching the compliance requirement',
  });
  written += 3;

  console.log(`Wrote ${written} memories across 2 agents.`);
  console.log('\nThings to try in the dashboard:');
  console.log('  · Search "when does the team ship code" — semantic match, not keyword match');
  console.log('  · Open the Graph tab — the retention belief shows two supersedes edges');
  console.log('  · Press Consolidate — the four GraphQL episodes distill into one durable fact');
  console.log('  · Time Travel on "retention" — see the belief change across revisions');
}

main()
  .catch((err) => {
    console.error('\nSeeding failed:', err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(closePool);
