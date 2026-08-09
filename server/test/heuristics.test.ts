import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  correctionStrength,
  inferImportance,
  inferKind,
  looksLikeGreeting,
  looksLikeQuestion,
} from '../src/heuristics.js';

/**
 * These rules stand in for Claude whenever the Bedrock quota is exhausted, which on this
 * deployment is always. They decide the memory kind and whether a statement supersedes an earlier
 * belief — so if they regress, the demo silently loses memory types and supersession while still
 * appearing to work. That failure mode is the reason these are tested at all.
 */
describe('inferKind', () => {
  const cases: [string, string][] = [
    ['always run the migrations before deploying', 'procedural'],
    ['never force-push to main', 'procedural'],
    ['to roll back, run npm run db:rollback and restart the workers', 'procedural'],
    ['every pull request requires two approvals before merge', 'procedural'],

    ['we shipped the vector index yesterday', 'episodic'],
    ['the deploy failed last night', 'episodic'],
    ['we decided to move the standup to Tuesdays', 'episodic'],

    ['our retention policy is ninety days', 'semantic'],
    ['the team is based in Berlin', 'semantic'],
    ['Priya owns the billing service', 'semantic'],
  ];

  for (const [text, expected] of cases) {
    it(`classifies "${text.slice(0, 44)}" as ${expected}`, () => {
      assert.equal(inferKind(text), expected);
    });
  }

  it('prefers procedural over episodic for rules that contain a past-tense verb', () => {
    // "always ... deployed" would match the episodic past-tense rule too. Filing a standing rule as
    // an event would decay it three times faster than the fact it actually is.
    assert.equal(inferKind('always make sure the tests passed before you merge'), 'procedural');
  });
});

describe('correctionStrength', () => {
  it('treats explicit retractions as strong', () => {
    for (const text of [
      "actually we moved to ninety days",
      'that is no longer true, the limit is 50',
      'the retention used to be thirty days',
      'correction: Priya owns billing, not Sam',
    ]) {
      assert.equal(correctionStrength(text), 'strong', text);
    }
  });

  it('treats change-of-value phrasing as weak', () => {
    for (const text of [
      'we switched to Postgres for the reporting store',
      'the standup moved to 10am',
      'the timeout was raised to 60 seconds',
    ]) {
      assert.equal(correctionStrength(text), 'weak', text);
    }
  });

  it('does not flag ordinary statements', () => {
    for (const text of [
      'the team is based in Berlin',
      'every pull request requires two approvals',
      'we run CockroachDB in three regions',
    ]) {
      assert.equal(correctionStrength(text), 'none', text);
    }
  });

  it('rates a bare "now" as weak, not strong', () => {
    // Weak markers only supersede when an existing memory is close enough in embedding space.
    // "we now have three regions" adds a fact; it does not retract one, and treating it as a
    // strong correction would destroy an unrelated memory.
    assert.equal(correctionStrength('we now have three regions'), 'weak');
  });
});

describe('inferImportance', () => {
  it('ranks standing rules above incidental events', () => {
    const rule = inferImportance('always run the migrations before deploying', 'procedural');
    const event = inferImportance('we shipped the vector index yesterday', 'episodic');
    assert.ok(rule > event, `expected rule ${rule} > event ${event}`);
  });

  it('never exceeds 1', () => {
    const maxed = inferImportance(
      'always remember this critical required policy rule, it is important',
      'procedural',
    );
    assert.ok(maxed <= 1, `importance ${maxed} exceeded 1`);
  });

  it('stays within the valid range for plain facts', () => {
    const v = inferImportance('the team is based in Berlin', 'semantic');
    assert.ok(v > 0 && v <= 1);
  });
});

describe('looksLikeQuestion', () => {
  it('recognises questions with and without a question mark', () => {
    for (const text of [
      'what is our retention policy?',
      'who owns billing',
      'remind me what we decided',
      'how do I roll back',
    ]) {
      assert.equal(looksLikeQuestion(text), true, text);
    }
  });

  it('does not treat statements as questions', () => {
    for (const text of ['our retention policy is ninety days', 'we ship on Fridays']) {
      assert.equal(looksLikeQuestion(text), false, text);
    }
  });
});

describe('looksLikeGreeting', () => {
  it('matches bare greetings only', () => {
    assert.equal(looksLikeGreeting('hi'), true);
    assert.equal(looksLikeGreeting('Hello!'), true);
    assert.equal(looksLikeGreeting('good morning'), true);
  });

  it('does not swallow a greeting that carries a fact', () => {
    // "hey, we ship on Fridays" is a statement worth storing, not small talk to answer.
    assert.equal(looksLikeGreeting('hey, we ship on Fridays'), false);
  });
});
