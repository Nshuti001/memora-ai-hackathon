/**
 * Language heuristics for the no-model path.
 *
 * When Bedrock is unavailable the agent still has to decide two things it would otherwise ask
 * Claude: what kind of memory a statement is, and whether it corrects something already known.
 * Both decisions are what make the store a memory rather than a log — memory types drive recall
 * filtering, and corrections are what produce supersession edges and give time travel something
 * to show. Falling back to "store everything as semantic, never supersede" would keep the demo
 * alive but quietly remove the two behaviours the project is actually about.
 *
 * These are deliberately shallow rules, not a parser. They are wrong sometimes, and that is
 * acceptable: the cost of a misclassified memory is a slightly worse recall ordering, and the
 * caller labels every no-model answer as such. Anything cleverer would be a language model, which
 * is the thing we do not have here.
 */

import type { MemoryKind } from './memory.js';

/** Past-tense event markers: something that happened at a point in time. */
const EPISODIC = [
  /\b(yesterday|today|this morning|last (night|week|month|year)|earlier|just now|ago)\b/i,
  /\b(we|i|they|he|she|it)\s+\w+ed\b/i,
  /\b(shipped|deployed|released|merged|launched|fixed|broke|failed|happened|met|decided|agreed)\b/i,
];

/** Instructions and rules: how to do something, or what must always/never happen. */
const PROCEDURAL = [
  /\b(always|never|make sure|be sure to|remember to|don't forget|you should|we should)\b/i,
  /\b(in order to|the process (is|for)|the steps? (is|are|to)|workflow|runbook|procedure)\b/i,
  /^\s*(run|use|open|click|deploy|install|configure|set|add|remove|check|verify|call)\b/i,
  // "To roll back, run …" — an infinitive clause followed by a comma is the classic instruction
  // shape. The verb phrase can be several words ("roll back", "spin up a replica"), so this cannot
  // be a single \w+.
  /^\s*to\s+[^,]{2,40},/i,
  // Policy statements: "every PR requires two approvals", "changes must be reviewed".
  /\b(requires?|must|needs? to be)\b.*\b(approvals?|reviews?|reviewed|signed off|tested|tests?)\b/i,
];

/**
 * Classifies a statement into one of the three memory types.
 *
 * Procedural is checked before episodic on purpose: "always run the tests before you deploy"
 * contains a past-tense-looking verb but is a rule, and filing it as an event would make it decay
 * at three times the rate of the fact it actually is.
 */
export function inferKind(text: string): MemoryKind {
  if (PROCEDURAL.some((r) => r.test(text))) return 'procedural';
  if (EPISODIC.some((r) => r.test(text))) return 'episodic';
  return 'semantic';
}

/**
 * Signals that a statement replaces an earlier belief rather than adding a new one.
 *
 * Split into two strengths. A `strong` marker ("actually", "no longer", "used to be") is an
 * explicit correction and is trusted on its own. A `weak` marker ("now", "instead", "moved to")
 * often appears in ordinary statements too — "we now have three regions" adds a fact, it does not
 * retract one — so a weak marker only counts as a correction when the store already holds
 * something close enough to be the thing being corrected.
 */
const STRONG_CORRECTION = [
  /\b(actually|correction|scratch that|i was wrong|that's wrong|not true anymore)\b/i,
  /\b(no longer|not\s+\w+\s+anymore|used to be|previously|it was|has been changed)\b/i,
  /\b(update[d]?\s+(to|from)|revised|superseded|replaces?)\b/i,
];

const WEAK_CORRECTION = [
  /\b(now|instead of|rather than|changed to|switched to|moved to|bumped to|raised to|lowered to)\b/i,
];

export type CorrectionStrength = 'strong' | 'weak' | 'none';

export function correctionStrength(text: string): CorrectionStrength {
  if (STRONG_CORRECTION.some((r) => r.test(text))) return 'strong';
  if (WEAK_CORRECTION.some((r) => r.test(text))) return 'weak';
  return 'none';
}

/**
 * Importance for a statement written without a model to judge it.
 *
 * Rules and explicit preferences outrank incidental events, because importance damps decay and a
 * standing rule should outlive the memory of a single afternoon.
 */
export function inferImportance(text: string, kind: MemoryKind): number {
  let score = kind === 'procedural' ? 0.7 : kind === 'semantic' ? 0.6 : 0.45;
  if (/\b(always|never|must|required|critical|important|policy|rule)\b/i.test(text)) score += 0.15;
  if (/\b(prefer|likes?|dislikes?|hates?|favou?rite)\b/i.test(text)) score += 0.05;
  return Math.min(1, Number(score.toFixed(2)));
}

/** True when the message is asking rather than telling. */
export function looksLikeQuestion(text: string): boolean {
  return (
    text.trim().endsWith('?') ||
    /^(what|when|where|who|why|how|which|do|does|did|is|are|was|were|can|could|should|would|tell me|remind me|show me|list)\b/i.test(
      text.trim(),
    )
  );
}

/** True for greetings, which should be answered rather than stored as facts. */
export function looksLikeGreeting(text: string): boolean {
  return /^(hi|hello|hey|yo|sup|good (morning|afternoon|evening)|howdy)\b[\s!.]*$/i.test(text.trim());
}
