// Small SVG charts for Home and Progress. Touch first: tapping (or hovering) a mark shows its value in a readout
// line above the chart, since an iPad has no hover.

import { useState } from 'preact/hooks';

export interface Datum {
  label: string;
  value: number;
  /** Readout text when the mark is selected, e.g. "Tue 14 Oct · 23 reviews". */
  detail: string;
}

/** Single-series columns from a shared baseline, with a value on the tallest and the last column. */
export function ColumnChart({ data, height = 140, caption }: { data: Datum[]; height?: number; caption: string }) {
  const [selected, setSelected] = useState<number | null>(null);
  const width = 600;
  const top = 18;
  const bottom = 20;
  const plot = height - top - bottom;
  const max = Math.max(1, ...data.map((d) => d.value));
  const slot = width / data.length;
  const barWidth = Math.min(24, slot - 2);
  const maxIndex = data.findIndex((d) => d.value === max);
  const labelled = new Set([maxIndex, data.length - 1]);

  return (
    <figure class="chart">
      <p class="readout" aria-live="polite">
        {selected === null ? caption : data[selected].detail}
      </p>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={caption} onPointerLeave={() => setSelected(null)}>
        <line x1={0} x2={width} y1={top + plot} y2={top + plot} class="axis" />
        {data.map((d, i) => {
          const h = (d.value / max) * plot;
          const x = i * slot + (slot - barWidth) / 2;
          const y = top + plot - h;
          const r = Math.min(4, h, barWidth / 2);
          return (
            <g key={i} onPointerEnter={() => setSelected(i)} onClick={() => setSelected(i)}>
              <rect x={i * slot} y={0} width={slot} height={height} fill="transparent" />
              {h > 0 && (
                <path
                  class={`bar ${selected === i ? 'selected' : ''}`}
                  d={`M${x},${top + plot} V${y + r} Q${x},${y} ${x + r},${y} H${x + barWidth - r} Q${x + barWidth},${y} ${x + barWidth},${y + r} V${top + plot} Z`}
                />
              )}
              {labelled.has(i) && d.value > 0 && (
                <text x={x + barWidth / 2} y={y - 4} class="value" text-anchor="middle">
                  {d.value}
                </text>
              )}
              {(i === 0 || i === data.length - 1 || (data.length > 14 && i % 7 === 0 && data.length - 1 - i >= 4)) && (
                <text x={x + barWidth / 2} y={height - 4} class="tick" text-anchor="middle">
                  {d.label}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      <details class="table-view">
        <summary>Show as table</summary>
        <table>
          <tbody>
            {data.map((d, i) => (
              <tr key={i}>
                <td>{d.detail.split(' · ')[0]}</td>
                <td class="num">{d.value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}

/** Ring for the daily goal: one colored arc on a lighter track of the same hue. */
export function GoalRing({ done, goal, size = 120 }: { done: number; goal: number; size?: number }) {
  const stroke = 12;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const fraction = Math.min(1, done / Math.max(1, goal));
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} class="goal-ring" role="img" aria-label={`${done} of ${goal} reviews today`}>
      <circle cx={size / 2} cy={size / 2} r={radius} class="track" stroke-width={stroke} fill="none" />
      {fraction > 0 && <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        class={`fill ${fraction >= 1 ? 'complete' : ''}`}
        stroke-width={stroke}
        fill="none"
        stroke-linecap="round"
        stroke-dasharray={`${circumference * fraction} ${circumference}`}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />}
      <text x="50%" y="47%" text-anchor="middle" class="ring-value">
        {done}
      </text>
      <text x="50%" y="66%" text-anchor="middle" class="ring-label">
        of {goal}
      </text>
    </svg>
  );
}

export interface CalendarDay {
  key: string;
  date: Date;
  count: number;
}

/** GitHub-style calendar: one column per week (Monday on top), four shades of one hue by review count. */
export function StreakCalendar({ days }: { days: CalendarDay[] }) {
  const [selected, setSelected] = useState<CalendarDay | null>(null);
  const cell = 14;
  const gap = 3;
  const weekday = (d: Date) => (d.getDay() + 6) % 7;
  const offset = weekday(days[0].date);
  const weeks = Math.ceil((days.length + offset) / 7);
  const max = Math.max(1, ...days.map((d) => d.count));
  const level = (count: number) => (count === 0 ? 0 : Math.min(4, Math.ceil((count / max) * 4)));
  const format = (d: CalendarDay) =>
    `${d.date.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })} · ${
      d.count === 0 ? 'no reviews' : `${d.count} review${d.count === 1 ? '' : 's'}`
    }`;

  return (
    <figure class="chart calendar">
      <p class="readout" aria-live="polite">
        {selected ? format(selected) : 'Days you studied, last 18 weeks'}
      </p>
      <svg
        viewBox={`0 0 ${weeks * (cell + gap)} ${7 * (cell + gap)}`}
        role="img"
        aria-label="Study calendar"
        onPointerLeave={() => setSelected(null)}
      >
        {days.map((d, i) => {
          const position = i + offset;
          return (
            <rect
              key={d.key}
              x={Math.floor(position / 7) * (cell + gap)}
              y={(position % 7) * (cell + gap)}
              width={cell}
              height={cell}
              rx={3}
              class={`day level-${level(d.count)} ${selected?.key === d.key ? 'selected' : ''}`}
              onPointerEnter={() => setSelected(d)}
              onClick={() => setSelected(d)}
            />
          );
        })}
      </svg>
      <div class="legend scale">
        Less
        {[0, 1, 2, 3, 4].map((l) => (
          <span key={l} class={`swatch level-${l}`} />
        ))}
        More
      </div>
    </figure>
  );
}

export interface Segment {
  key: string;
  label: string;
  value: number;
}

/** One horizontal bar split into ordered segments (light to dark), with a legend carrying the counts. */
export function StackedBar({ segments }: { segments: Segment[] }) {
  const total = segments.reduce((sum, s) => sum + s.value, 0);
  return (
    <figure class="chart stacked">
      <div class="stack" role="img" aria-label={segments.map((s) => `${s.label}: ${s.value}`).join(', ')}>
        {total === 0 ? (
          <span class="stack-empty" />
        ) : (
          segments
            .filter((s) => s.value > 0)
            .map((s) => <span key={s.key} class={`segment seg-${s.key}`} style={{ flexGrow: s.value }} title={`${s.label}: ${s.value}`} />)
        )}
      </div>
      <ul class="legend">
        {segments.map((s) => (
          <li key={s.key}>
            <span class={`swatch seg-${s.key}`} /> {s.label} <strong>{s.value}</strong>
          </li>
        ))}
      </ul>
    </figure>
  );
}
