// Numbers for Home and Progress. Pure functions over cards and review logs.

import type { Card, ReviewLog } from './db';
import { Rating, State } from './srs';

// A study day starts at 4 am, so a late-night session still counts for the day it belongs to.
const DAY_START_HOUR = 4;
const DAY_MS = 24 * 60 * 60 * 1000;

/** The calendar date a moment belongs to for studying. Uses local clock hours, so daylight saving days work. */
function studyDate(ts: number): Date {
  const d = new Date(ts);
  if (d.getHours() < DAY_START_HOUR) d.setDate(d.getDate() - 1);
  return d;
}

/** Local study day as YYYY-MM-DD. */
export function dayKey(ts: number): string {
  const d = studyDate(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Start of the study day containing `ts`, as a timestamp. */
export function dayStart(ts: number): number {
  const d = studyDate(ts);
  d.setHours(DAY_START_HOUR, 0, 0, 0);
  return d.getTime();
}

/** The study day `offset` days from the one containing `ts` (handles daylight saving changes). */
export function shiftDay(ts: number, offset: number): number {
  const d = new Date(dayStart(ts));
  d.setDate(d.getDate() + offset);
  return d.getTime();
}

export function reviewsByDay(logs: ReviewLog[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const log of logs) counts.set(dayKey(log.at), (counts.get(dayKey(log.at)) ?? 0) + 1);
  return counts;
}

/** Days in a row with at least one review, ending today, or yesterday if today has none yet. */
export function streak(logs: ReviewLog[], now = Date.now()): number {
  const days = reviewsByDay(logs);
  let day = days.has(dayKey(now)) ? now : shiftDay(now, -1);
  let count = 0;
  while (days.has(dayKey(day))) {
    count++;
    day = shiftDay(day, -1);
  }
  return count;
}

export function longestStreak(logs: ReviewLog[]): number {
  const keys = [...reviewsByDay(logs).keys()].sort();
  let best = 0;
  let run = 0;
  let previous: string | undefined;
  for (const key of keys) {
    const expected = previous && dayKey(shiftDay(new Date(`${previous}T12:00:00`).getTime(), 1));
    run = expected === key ? run + 1 : 1;
    best = Math.max(best, run);
    previous = key;
  }
  return best;
}

export function reviewsToday(logs: ReviewLog[], now = Date.now()) {
  const today = dayKey(now);
  return logs.filter((l) => dayKey(l.at) === today);
}

/** New cards studied for the first time today, counted against the daily new-card limit. */
export function newIntroducedToday(logs: ReviewLog[], now = Date.now()) {
  return reviewsToday(logs, now).filter((l) => l.wasNew).length;
}

/** Share of reviews that weren't Again, or null with no reviews. */
export function accuracy(logs: ReviewLog[]): number | null {
  if (logs.length === 0) return null;
  return logs.filter((l) => l.rating !== Rating.Again).length / logs.length;
}

export type Stage = 'new' | 'learning' | 'young' | 'mature';

/** Mature means the next review is three weeks or more away, as in Anki. */
export function stageOf(card: Card): Stage {
  const { state, scheduled_days } = card.fsrs;
  if (state === State.New) return 'new';
  if (state === State.Learning || state === State.Relearning) return 'learning';
  return scheduled_days >= 21 ? 'mature' : 'young';
}

export function countStages(cards: Card[]): Record<Stage, number> {
  const counts: Record<Stage, number> = { new: 0, learning: 0, young: 0, mature: 0 };
  for (const card of cards) counts[stageOf(card)]++;
  return counts;
}

/** Studied cards due by the end of today (overdue included). */
export function dueTodayCount(cards: Card[], now = Date.now()): number {
  const end = shiftDay(now, 1);
  return cards.filter((c) => c.fsrs.state !== State.New && c.due < end).length;
}

/** Studied cards falling due on each of the next `days` days; overdue cards count for today. */
export function dueForecast(cards: Card[], days: number, now = Date.now()): number[] {
  const counts = Array(days).fill(0);
  const today = dayStart(now);
  for (const card of cards) {
    if (card.fsrs.state === State.New) continue;
    const index = card.due < today ? 0 : Math.round((dayStart(card.due) - today) / DAY_MS);
    if (index < days) counts[index]++;
  }
  return counts;
}
