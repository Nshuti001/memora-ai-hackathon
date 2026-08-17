import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { fitOosThreshold } from '../src/intent.js';

/**
 * The out-of-scope threshold is the only fitted parameter in the classifier, and it is the one that
 * decides whether an utterance becomes a memory at all. A regression here does not throw — it
 * quietly starts storing small talk, or quietly stops storing anything.
 */
describe('fitOosThreshold', () => {
  it('separates two cleanly divided distributions', () => {
    const inScope = [0.2, 0.25, 0.3, 0.35];
    const oos = [0.9, 0.95, 1.0, 1.1];

    const { threshold, balancedAccuracy } = fitOosThreshold(inScope, oos);

    assert.equal(balancedAccuracy, 1, 'perfectly separable data should score 1.0');
    assert.ok(threshold >= 0.35 && threshold < 0.9, `threshold ${threshold} should fall in the gap`);
  });

  it('optimises balanced accuracy rather than raw accuracy', () => {
    // Deliberately lopsided: 20 in-scope, 2 out-of-scope. A threshold that accepts everything gets
    // 20/22 = 91% raw accuracy while catching zero out-of-scope inputs — useless at the actual job.
    // Balanced accuracy refuses to reward that.
    const inScope = Array.from({ length: 20 }, (_, i) => 0.1 + i * 0.01);
    const oos = [0.9, 1.0];

    const { threshold, balancedAccuracy } = fitOosThreshold(inScope, oos);

    assert.ok(threshold < 0.9, `threshold ${threshold} must reject the out-of-scope cases`);
    assert.equal(balancedAccuracy, 1);
  });

  it('still returns a usable threshold when the classes overlap', () => {
    const inScope = [0.3, 0.5, 0.7];
    const oos = [0.4, 0.6, 0.8];

    const { threshold, balancedAccuracy } = fitOosThreshold(inScope, oos);

    assert.ok(Number.isFinite(threshold));
    // Overlapping distributions cannot be perfectly separated, but a coin flip is 0.5 and the
    // sweep should beat that.
    assert.ok(balancedAccuracy > 0.5 && balancedAccuracy < 1, `got ${balancedAccuracy}`);
  });

  it('does not crash on empty input', () => {
    const { threshold, balancedAccuracy } = fitOosThreshold([], []);
    assert.equal(threshold, Infinity);
    assert.equal(balancedAccuracy, 0);
  });

  it('never picks a threshold that rejects every in-scope example when a better one exists', () => {
    const inScope = [0.1, 0.2, 0.3];
    const oos = [2.0];

    const { threshold } = fitOosThreshold(inScope, oos);

    const kept = inScope.filter((d) => d <= threshold).length;
    assert.equal(kept, inScope.length, 'all in-scope examples should survive a clean split');
  });
});
