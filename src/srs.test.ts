import { describe, expect, it } from 'vitest';
import type { Card } from './db';
import { autoGrade, buildQueue, formatInterval, newFsrsState, Rating, schedule, State, worstRank, type CharOutcome } from './srs';

const outcome = (o: Partial<CharOutcome>): CharOutcome => ({ result: 'first', rank: 1, ms: 2000, strokes: 5, ...o });

describe('autoGrade', () => {
  it('is Easy when every character was the top match and written without hesitating', () => {
    expect(autoGrade([outcome({}), outcome({ strokes: 10, ms: 12000 })])).toBe(Rating.Easy);
  });

  it('is Good when right first time but slow', () => {
    expect(autoGrade([outcome({ ms: 20000 })])).toBe(Rating.Good);
  });

  it('is Good when right first time but not the top match', () => {
    expect(autoGrade([outcome({ rank: 3 })])).toBe(Rating.Good);
  });

  it('is Hard when any character needed a second try', () => {
    expect(autoGrade([outcome({}), outcome({ result: 'retry' })])).toBe(Rating.Hard);
  });

  it('is Again when any character was wrong or unknown, whatever the others did', () => {
    expect(autoGrade([outcome({ result: 'retry' }), outcome({ result: 'failed', rank: null })])).toBe(Rating.Again);
    expect(autoGrade([outcome({ result: 'failed' })])).toBe(Rating.Again);
  });
});

describe('worstRank', () => {
  it('is the highest rank, or null if any character went unrecognized', () => {
    expect(worstRank([outcome({ rank: 1 }), outcome({ rank: 4 })])).toBe(4);
    expect(worstRank([outcome({ rank: 1 }), outcome({ rank: null })])).toBeNull();
  });
});

describe('scheduling', () => {
  const now = Date.UTC(2026, 9, 24, 12);

  it('moves a new card to learning and keeps it due soon after Again', () => {
    const next = schedule(newFsrsState(now), Rating.Again, now);
    expect(next.state).toBe(State.Learning);
    expect(next.due - now).toBeLessThan(10 * 60 * 1000);
    expect(next.last_review).toBe(now);
  });

  it('schedules Easy further out than Good, and Good further than Hard', () => {
    const state = schedule(newFsrsState(now), Rating.Good, now);
    const later = state.due + 1;
    const [hard, good, easy] = [Rating.Hard, Rating.Good, Rating.Easy].map((r) => schedule(state, r as never, later).due);
    expect(hard).toBeLessThanOrEqual(good);
    expect(good).toBeLessThan(easy);
  });
});

describe('buildQueue', () => {
  const now = Date.UTC(2026, 9, 24, 12);
  let id = 0;
  const card = (state: number, due: number, createdAt = 0): Card =>
    ({ id: ++id, deckId: 1, hanzi: '字', pinyin: '', english: '', createdAt, due, fsrs: { ...newFsrsState(now), state, due } }) as Card;

  it('puts due reviews first (oldest first), then new cards in the order they were added, up to the limit', () => {
    const later = card(State.Review, now - 1000);
    const earlier = card(State.Review, now - 5000);
    const notDue = card(State.Review, now + 24 * 60 * 60 * 1000);
    const new2 = card(State.New, now, 2);
    const new1 = card(State.New, now, 1);
    const new3 = card(State.New, now, 3);
    expect(buildQueue([later, notDue, new2, earlier, new3, new1], 2, now)).toEqual([earlier, later, new1, new2]);
  });

  it('adds no new cards once the daily limit is used up', () => {
    expect(buildQueue([card(State.New, now)], 0, now)).toEqual([]);
    expect(buildQueue([card(State.New, now)], -3, now)).toEqual([]);
  });

  it('includes learning cards coming due within the session', () => {
    const soon = card(State.Learning, now + 5 * 60 * 1000);
    expect(buildQueue([soon], 0, now)).toEqual([soon]);
  });
});

describe('formatInterval', () => {
  const now = 0;
  it.each([
    [30_000, '1m'],
    [10 * 60_000, '10m'],
    [5 * 3600_000, '5h'],
    [3 * 86400_000, '3d'],
    [61 * 86400_000, '2mo'],
    [550 * 86400_000, '1.5y'],
  ])('%i ms → %s', (ms, text) => {
    expect(formatInterval(now + ms, now)).toBe(text);
  });
});
