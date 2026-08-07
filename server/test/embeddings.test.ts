import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  EMBED_DIM,
  l2Distance,
  localEmbed,
  toUnitVector,
  toVectorLiteral,
} from '../src/embeddings.js';

describe('toUnitVector', () => {
  test('scales to length 1', () => {
    const unit = toUnitVector([3, 4]);
    assert.equal(Math.hypot(...unit).toFixed(10), '1.0000000000');
  });

  test('preserves direction', () => {
    const unit = toUnitVector([3, 4]);
    assert.equal(unit[0].toFixed(4), '0.6000');
    assert.equal(unit[1].toFixed(4), '0.8000');
  });

  test('leaves the zero vector alone rather than dividing by zero', () => {
    assert.deepEqual(toUnitVector([0, 0, 0]), [0, 0, 0]);
  });

  test('makes L2 ordering agree with cosine ordering', () => {
    // The correctness argument behind using <-> on a CockroachDB vector index: once every vector is
    // unit length, ranking by L2 distance and ranking by cosine distance produce the same order.
    const queryVec = toUnitVector([1, 0, 0]);
    const candidates = [
      toUnitVector([0.9, 0.4, 0]),
      toUnitVector([0.2, 1, 0]),
      toUnitVector([0.99, 0.05, 0]),
      // Same direction as the first candidate but 100x the magnitude. If normalization were
      // skipped, this would rank as extremely distant despite being identical in meaning.
      toUnitVector([90, 40, 0]),
    ];

    const cosineDistance = (a: number[], b: number[]) => 1 - a.reduce((s, v, i) => s + v * b[i], 0);

    const byL2 = [...candidates].sort((a, b) => l2Distance(queryVec, a) - l2Distance(queryVec, b));
    const byCosine = [...candidates].sort(
      (a, b) => cosineDistance(queryVec, a) - cosineDistance(queryVec, b),
    );

    assert.deepEqual(byL2, byCosine);
  });
});

describe('toVectorLiteral', () => {
  test('emits the bracketed format CockroachDB parses', () => {
    assert.equal(toVectorLiteral([1, 0.5, -2]), '[1,0.5,-2]');
  });
});

describe('localEmbed', () => {
  test('returns the schema-declared width', () => {
    assert.equal(localEmbed('hello world').length, EMBED_DIM);
  });

  test('is deterministic', () => {
    assert.deepEqual(localEmbed('the user prefers dark mode'), localEmbed('the user prefers dark mode'));
  });

  test('is unit length, so it satisfies the index precondition', () => {
    const magnitude = Math.hypot(...localEmbed('deploys to production on Fridays'));
    assert.ok(Math.abs(magnitude - 1) < 1e-9, `expected unit length, got ${magnitude}`);
  });

  test('ranks a restatement closer than an unrelated sentence', () => {
    const anchor = localEmbed('The user prefers dark mode interfaces');
    const restatement = localEmbed('User prefers a dark mode interface');
    const unrelated = localEmbed('Quarterly revenue grew in the Nordic region');

    assert.ok(
      l2Distance(anchor, restatement) < l2Distance(anchor, unrelated),
      'a restatement should be nearer than an unrelated sentence',
    );
  });

  test('ignores stop words when deciding similarity', () => {
    const a = localEmbed('the deployment pipeline');
    const b = localEmbed('deployment pipeline');
    assert.ok(l2Distance(a, b) < 0.05, 'stop words should not move the vector meaningfully');
  });

  test('rejects empty input rather than emitting a zero vector', async () => {
    const { embed } = await import('../src/embeddings.js');
    await assert.rejects(() => embed('   '), /Cannot embed empty text/);
  });
});
