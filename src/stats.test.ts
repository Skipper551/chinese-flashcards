import { describe, expect, it } from 'vitest';
import type { Card, ReviewLog } from './db';
import { newFsrsState, Rating, State } from './srs';
import { accuracy, countStages, dayKey, dueForecast, longestStreak, newIntroducedToday, shiftDay, streak } from './stats';

// Local times, since study days follow the iPad's clock (and start at 4 am).
const at = (day: number, hour = 12) => new Date(2026, 9, day, hour).getTime();
const log = (time: number, extra: Partial<ReviewLog> = {}): ReviewLog => ({
  id: 0,
  cardId: 1,
  deckId: 1,
  at: time,
  rating: Rating.Good,
  recognizedRank: 1,
  overridden: false,
  wasNew: false,
  durationMs: 1000,
  ...extra,
});

describe('study days', () => {
  it('start at 4 am', () => {
    expect(dayKey(at(24, 3))).toBe('2026-10-23');
    expect(dayKey(at(24, 4))).toBe('2026-10-24');
  });

  it('shift by whole days', () => {
    expect(dayKey(shiftDay(at(24), -1))).toBe('2026-10-23');
    expect(dayKey(shiftDay(at(24), 10))).toBe('2026-11-03');
  });
});

describe('streak', () => {
  it('counts consecutive days ending today', () => {
    expect(streak([log(at(22)), log(at(23)), log(at(24)), log(at(24, 20))], at(24, 22))).toBe(3);
  });

  it('is still alive in the morning before reviewing, counting up to yesterday', () => {
    expect(streak([log(at(22)), log(at(23))], at(24, 9))).toBe(2);
  });

  it('breaks after a missed day', () => {
    expect(streak([log(at(21)), log(at(22))], at(24))).toBe(0);
    expect(streak([log(at(20)), log(at(22)), log(at(24))], at(24))).toBe(1);
  });

  it('counts a 1 am session for the day before', () => {
    expect(streak([log(at(23)), log(at(24, 1))], at(24, 2))).toBe(1);
  });

  it('finds the longest run', () => {
    expect(longestStreak([log(at(1)), log(at(2)), log(at(3)), log(at(10)), log(at(11))])).toBe(3);
    expect(longestStreak([])).toBe(0);
  });
});

describe('counts', () => {
  it('counts new cards introduced today', () => {
    const logs = [log(at(24), { wasNew: true }), log(at(24)), log(at(23), { wasNew: true })];
    expect(newIntroducedToday(logs, at(24, 18))).toBe(1);
  });

  it('computes accuracy as the share of reviews that were not Again', () => {
    expect(accuracy([log(0), log(0, { rating: Rating.Again }), log(0, { rating: Rating.Hard }), log(0)])).toBe(0.75);
    expect(accuracy([])).toBeNull();
  });

  const card = (state: number, scheduledDays: number, due: number): Card =>
    ({
      id: 1,
      deckId: 1,
      hanzi: '字',
      pinyin: '',
      english: '',
      createdAt: 0,
      due,
      fsrs: { ...newFsrsState(), state, scheduled_days: scheduledDays, due },
    }) as Card;

  it('sorts cards into stages', () => {
    const cards = [
      card(State.New, 0, 0),
      card(State.Learning, 0, 0),
      card(State.Relearning, 0, 0),
      card(State.Review, 5, 0),
      card(State.Review, 21, 0),
      card(State.Review, 60, 0),
    ];
    expect(countStages(cards)).toEqual({ new: 1, learning: 2, young: 1, mature: 2 });
  });

  it('forecasts due cards per day, counting overdue ones today and skipping new cards', () => {
    const now = at(24, 12);
    const cards = [
      card(State.Review, 1, at(20)),
      card(State.Review, 1, at(24, 20)),
      card(State.Review, 1, at(25, 3)),
      card(State.Review, 1, at(26, 9)),
      card(State.Review, 1, at(30)),
      card(State.New, 0, at(24)),
    ];
    expect(dueForecast(cards, 4, now)).toEqual([3, 0, 1, 0]);
  });
});
