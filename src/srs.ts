// Spaced repetition with ts-fsrs, plus turning handwriting check results into an FSRS grade.

import { createEmptyCard, fsrs, generatorParameters, Rating, State, type Card as FsrsCard, type Grade } from 'ts-fsrs';
import type { Card, FsrsState } from './db';

export { Rating, State };
export type { Grade };

const scheduler = fsrs(generatorParameters({ enable_fuzz: true }));

function toFsrs(s: FsrsState): FsrsCard {
  return { ...s, due: new Date(s.due), last_review: s.last_review === undefined ? undefined : new Date(s.last_review) };
}

function fromFsrs(c: FsrsCard): FsrsState {
  return {
    due: c.due.getTime(),
    stability: c.stability,
    difficulty: c.difficulty,
    elapsed_days: c.elapsed_days,
    scheduled_days: c.scheduled_days,
    learning_steps: c.learning_steps,
    reps: c.reps,
    lapses: c.lapses,
    state: c.state,
    last_review: c.last_review?.getTime(),
  };
}

export function newFsrsState(now = Date.now()): FsrsState {
  return fromFsrs(createEmptyCard(new Date(now)));
}

export function schedule(state: FsrsState, grade: Grade, now = Date.now()): FsrsState {
  return fromFsrs(scheduler.next(toFsrs(state), new Date(now), grade).card);
}

/** When the card would next be due for each grade, for labelling the grade buttons. */
export function previewDue(state: FsrsState, now = Date.now()): Record<Grade, number> {
  const preview = scheduler.repeat(toFsrs(state), new Date(now));
  return {
    [Rating.Again]: preview[Rating.Again].card.due.getTime(),
    [Rating.Hard]: preview[Rating.Hard].card.due.getTime(),
    [Rating.Good]: preview[Rating.Good].card.due.getTime(),
    [Rating.Easy]: preview[Rating.Easy].card.due.getTime(),
  };
}

/** Short time until `due`: 10m, 5h, 3d, 2mo, 1.5y. */
export function formatInterval(due: number, now = Date.now()): string {
  const minutes = Math.max(1, Math.round((due - now) / 60_000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  if (days < 31) return `${days}d`;
  const months = days / 30.4;
  if (months < 12) return `${Math.round(months)}mo`;
  return `${Math.round((months / 12) * 10) / 10}y`;
}

/** How one character of a word went. */
export interface CharOutcome {
  /** Right on the first check, right after trying again, or wrong / "I don't know". */
  result: 'first' | 'retry' | 'failed';
  /** Recognizer rank of the target on the final check (null if not among the candidates or not checked). */
  rank: number | null;
  /** Time from the prompt (or the retry) until the final check. */
  ms: number;
  strokes: number;
}

// Writing from memory without hesitating: a couple of seconds to recall, then a steady pace per stroke.
const RECALL_MS = 2500;
const MS_PER_STROKE = 1200;

export function isFast(o: CharOutcome) {
  return o.ms <= RECALL_MS + MS_PER_STROKE * o.strokes;
}

/**
 * Grade for a whole word: any character wrong → Again; any needing a second try → Hard;
 * all right first time → Good, or Easy if every one was the recognizer's top pick and written without hesitating.
 */
export function autoGrade(outcomes: CharOutcome[]): Grade {
  if (outcomes.some((o) => o.result === 'failed')) return Rating.Again;
  if (outcomes.some((o) => o.result === 'retry')) return Rating.Hard;
  if (outcomes.every((o) => o.rank === 1 && isFast(o))) return Rating.Easy;
  return Rating.Good;
}

/** The worst (highest) rank across the word, or null if any character wasn't recognized. */
export function worstRank(outcomes: CharOutcome[]): number | null {
  if (outcomes.some((o) => o.rank === null)) return null;
  return Math.max(...outcomes.map((o) => o.rank as number));
}

/** Cards answered wrong come back within the session if they're due again this soon (FSRS learning steps). */
export const LEARN_AHEAD_MS = 20 * 60 * 1000;

/**
 * Cards for a study session: reviews that are due (oldest first), then new cards in the order they were added,
 * up to what's left of today's new-card limit.
 */
export function buildQueue(cards: Card[], newLimitLeft: number, now = Date.now()): Card[] {
  const due = cards.filter((c) => c.fsrs.state !== State.New && c.due <= now + LEARN_AHEAD_MS).sort((a, b) => a.due - b.due);
  const fresh = cards
    .filter((c) => c.fsrs.state === State.New)
    .sort((a, b) => a.createdAt - b.createdAt)
    .slice(0, Math.max(0, newLimitLeft));
  return [...due, ...fresh];
}

export const GRADE_LABELS: Record<Grade, string> = {
  [Rating.Again]: 'Again',
  [Rating.Hard]: 'Hard',
  [Rating.Good]: 'Good',
  [Rating.Easy]: 'Easy',
};
