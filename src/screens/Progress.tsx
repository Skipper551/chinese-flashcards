import { ColumnChart, StackedBar, StreakCalendar, type CalendarDay, type Datum } from '../components/charts';
import { db, useLive } from '../db';
import {
  accuracy,
  countStages,
  dayKey,
  dueForecast,
  longestStreak,
  reviewsByDay,
  shiftDay,
  streak,
} from '../stats';

const CALENDAR_WEEKS = 18;

const shortDate = (ts: number) => new Date(ts).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
const longDate = (ts: number) => new Date(ts).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
const percent = (x: number | null) => (x === null ? '–' : `${Math.round(x * 100)}%`);

export function Progress() {
  const data = useLive(async () => ({ cards: await db.cards.toArray(), logs: await db.reviewLogs.toArray() }));
  if (!data) return null;
  const { cards, logs } = data;
  const now = Date.now();
  const byDay = reviewsByDay(logs);

  const last30: Datum[] = Array.from({ length: 30 }, (_, i) => {
    const day = shiftDay(now, i - 29);
    const value = byDay.get(dayKey(day)) ?? 0;
    return { label: i === 29 ? 'Today' : shortDate(day), value, detail: `${longDate(day)} · ${value} review${value === 1 ? '' : 's'}` };
  });

  const forecast: Datum[] = dueForecast(cards, 14, now).map((value, i) => {
    const day = shiftDay(now, i);
    return {
      label: i === 0 ? 'Today' : shortDate(day),
      value,
      detail: `${i === 0 ? 'Today (incl. overdue)' : longDate(day)} · ${value} due`,
    };
  });

  const calendarDays: CalendarDay[] = Array.from({ length: CALENDAR_WEEKS * 7 }, (_, i) => {
    const day = shiftDay(now, i - (CALENDAR_WEEKS * 7 - 1));
    const key = dayKey(day);
    return { key, date: new Date(`${key}T12:00:00`), count: byDay.get(key) ?? 0 };
  });

  const monthAgo = shiftDay(now, -29);
  const recent = logs.filter((l) => l.at >= monthAgo);
  const stages = countStages(cards);

  return (
    <section class="progress">
      <h1>Progress</h1>

      <div class="today">
        <div class="card stat-tile">
          <span class="label">Current streak</span>
          <span class="value">{streak(logs, now)}</span>
          <span class="muted small">longest {longestStreak(logs)} days</span>
        </div>
        <div class="card stat-tile">
          <span class="label">Accuracy, last 30 days</span>
          <span class="value">{percent(accuracy(recent))}</span>
          <span class="muted small">all time {percent(accuracy(logs))}</span>
        </div>
        <div class="card stat-tile">
          <span class="label">Reviews</span>
          <span class="value">{logs.length.toLocaleString()}</span>
          <span class="muted small">{recent.length} in the last 30 days</span>
        </div>
      </div>

      <div class="card">
        <h2>Streak calendar</h2>
        <StreakCalendar days={calendarDays} />
      </div>

      <div class="card">
        <h2>Reviews per day</h2>
        <ColumnChart data={last30} caption="Last 30 days. Tap a day for its count." />
      </div>

      <div class="card">
        <h2>Cards by stage</h2>
        <StackedBar
          segments={[
            { key: 'new', label: 'New', value: stages.new },
            { key: 'learning', label: 'Learning', value: stages.learning },
            { key: 'young', label: 'Young', value: stages.young },
            { key: 'mature', label: 'Mature (3+ weeks)', value: stages.mature },
          ]}
        />
      </div>

      <div class="card">
        <h2>Due in the next two weeks</h2>
        <ColumnChart data={forecast} caption="Reviews coming up. Tap a day for its count." />
      </div>
    </section>
  );
}
