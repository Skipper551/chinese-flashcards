import { useEffect, useRef, useState } from 'preact/hooks';
import { navigate, type ScreenProps } from '../app';
import { InkPreview, toStrokes, WritingPad, type InkStroke } from '../canvas/WritingPad';
import { HanziAnswer } from '../components/HanziAnswer';
import { db, getSettings, type Card, type Settings } from '../db';
import { prefetchHanziData } from '../hanziData';
import { loadRecognizer, type CheckResult, type Recognizer } from '../recognize';
import {
  autoGrade,
  buildQueue,
  formatInterval,
  GRADE_LABELS,
  LEARN_AHEAD_MS,
  previewDue,
  Rating,
  schedule,
  State,
  worstRank,
  type CharOutcome,
  type Grade,
} from '../srs';
import { dayStart, newIntroducedToday, streak } from '../stats';

// How many extra new cards "Learn more" adds once today's limit is used up.
const EXTRA_NEW = 5;

type Phase =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'empty'; nextDue?: number; newWaiting: number }
  | { kind: 'writing'; attempt: 1 | 2 }
  /** After Check or "I don't know". `outcome` is what will be recorded unless Sophie overrides it. */
  | { kind: 'checked'; attempt: 1 | 2; result: CheckResult | null; outcome: CharOutcome; canRetry: boolean }
  | { kind: 'grading'; suggested: Grade; due: Record<Grade, number> }
  | { kind: 'done'; streak: number };

interface Session {
  recognizer: Recognizer;
  settings: Settings;
  queue: Card[];
  reviewed: number;
  correct: number;
}

/** Next card: the first one due now; failing that, the soonest of those coming back within the session. */
function pickNext(queue: Card[], now: number): Card | undefined {
  return queue.find((c) => c.fsrs.state === State.New || c.due <= now) ?? [...queue].sort((a, b) => a.due - b.due)[0];
}

export function Study({ param }: ScreenProps) {
  const deckId = param ? Number(param) : undefined;
  const session = useRef<Session | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  const [card, setCard] = useState<Card>();
  const [charIndex, setCharIndex] = useState(0);
  const [outcomes, setOutcomes] = useState<CharOutcome[]>([]);
  const [ink, setInk] = useState<InkStroke[]>([]);
  const [showEnglish, setShowEnglish] = useState(true);
  const [deckName, setDeckName] = useState<string>();
  const charStartedAt = useRef(Date.now());

  async function start(extraNew = 0) {
    setPhase({ kind: 'loading' });
    try {
      const now = Date.now();
      const [settings, recognizer, cards, todaysLogs] = await Promise.all([
        getSettings(),
        loadRecognizer(),
        deckId === undefined ? db.cards.toArray() : db.cards.where({ deckId }).toArray(),
        db.reviewLogs.where('at').aboveOrEqual(dayStart(now)).toArray(),
      ]);
      if (deckId !== undefined) setDeckName((await db.decks.get(deckId))?.name);
      const newLeft = extraNew || settings.dailyNewLimit - newIntroducedToday(todaysLogs, now);
      const queue = buildQueue(cards, newLeft, now);
      session.current = { recognizer, settings, queue, reviewed: 0, correct: 0 };
      setShowEnglish(settings.showEnglish);
      prefetchHanziData(queue.map((c) => c.hanzi));
      if (queue.length === 0) {
        const studied = cards.filter((c) => c.fsrs.state !== State.New);
        setPhase({
          kind: 'empty',
          nextDue: studied.length ? Math.min(...studied.map((c) => c.due)) : undefined,
          newWaiting: cards.length - studied.length,
        });
      } else showCard(queue);
    } catch (e) {
      setPhase({ kind: 'error', message: e instanceof Error ? e.message : String(e) });
    }
  }

  useEffect(() => {
    start();
  }, []);

  function showCard(queue: Card[]) {
    const next = pickNext(queue, Date.now());
    if (!next) return;
    setCard(next);
    setCharIndex(0);
    setOutcomes([]);
    startWriting(1);
  }

  function startWriting(attempt: 1 | 2) {
    setInk([]);
    charStartedAt.current = Date.now();
    setPhase({ kind: 'writing', attempt });
  }

  function check() {
    if (!card || !session.current || phase.kind !== 'writing' || ink.length === 0) return;
    const { recognizer, settings } = session.current;
    const result = recognizer.check(toStrokes(ink), card.hanzi[charIndex], settings.tolerance);
    const base = { rank: result.rank, ms: Date.now() - charStartedAt.current, strokes: ink.length };
    const outcome: CharOutcome = result.correct
      ? { ...base, result: phase.attempt === 1 ? 'first' : 'retry' }
      : { ...base, result: 'failed' };
    setPhase({ kind: 'checked', attempt: phase.attempt, result, outcome, canRetry: !result.correct && phase.attempt === 1 });
  }

  function dontKnow() {
    if (phase.kind !== 'writing') return;
    const outcome: CharOutcome = { result: 'failed', rank: null, ms: Date.now() - charStartedAt.current, strokes: ink.length };
    setInk([]);
    setPhase({ kind: 'checked', attempt: phase.attempt, result: null, outcome, canRetry: false });
  }

  /** Records the character's outcome and moves to the next character, or to grading the word. */
  function commit(outcome: CharOutcome) {
    if (!card) return;
    const all = [...outcomes, outcome];
    setOutcomes(all);
    if (charIndex + 1 < card.hanzi.length) {
      setCharIndex(charIndex + 1);
      startWriting(1);
    } else {
      setPhase({ kind: 'grading', suggested: autoGrade(all), due: previewDue(card.fsrs) });
    }
  }

  async function grade(rating: Grade) {
    if (!card || !session.current || phase.kind !== 'grading') return;
    const now = Date.now();
    const fsrs = schedule(card.fsrs, rating, now);
    await db.transaction('rw', db.cards, db.reviewLogs, async () => {
      await db.cards.update(card.id, { fsrs, due: fsrs.due });
      await db.reviewLogs.add({
        cardId: card.id,
        deckId: card.deckId,
        at: now,
        rating,
        recognizedRank: worstRank(outcomes),
        overridden: rating !== phase.suggested,
        wasNew: card.fsrs.state === State.New,
        durationMs: outcomes.reduce((sum, o) => sum + o.ms, 0),
      } as never);
    });
    const s = session.current;
    s.reviewed++;
    if (rating !== Rating.Again) s.correct++;
    s.queue = s.queue.filter((c) => c.id !== card.id);
    if (fsrs.due - now <= LEARN_AHEAD_MS) s.queue.push({ ...card, fsrs, due: fsrs.due });
    if (s.queue.length) showCard(s.queue);
    else {
      const logs = await db.reviewLogs.where('at').above(now - 400 * 24 * 60 * 60 * 1000).toArray();
      setPhase({ kind: 'done', streak: streak(logs, now) });
    }
  }

  const s = session.current;
  const target = card?.hanzi[charIndex];

  if (phase.kind === 'loading') return <p class="placeholder">Getting your cards ready…</p>;
  if (phase.kind === 'error')
    return (
      <section class="study-message">
        <h1>Couldn’t start</h1>
        <p>{phase.message}</p>
        <button onClick={() => start()}>Try again</button>
      </section>
    );
  if (phase.kind === 'empty')
    return (
      <section class="study-message">
        <h1>All caught up</h1>
        <p>
          {phase.nextDue
            ? `Nothing is due${deckName ? ` in ${deckName}` : ''} right now. The next review is in ${formatInterval(phase.nextDue)}.`
            : phase.newWaiting
              ? 'You’ve learned today’s new cards.'
              : 'There are no cards here yet. Add a deck or import vocabulary first.'}
        </p>
        <div class="row">
          {phase.newWaiting > 0 && (
            <button class="primary" onClick={() => start(EXTRA_NEW)}>
              Learn {Math.min(EXTRA_NEW, phase.newWaiting)} more new
            </button>
          )}
          {phase.newWaiting === 0 && !phase.nextDue && <button class="primary" onClick={() => navigate('decks')}>Go to Decks</button>}
          <button onClick={() => navigate('home')}>Home</button>
        </div>
      </section>
    );
  if (phase.kind === 'done' && s)
    return (
      <section class="study-message">
        <h1>Session complete</h1>
        <p class="big-stat">
          {s.reviewed} {s.reviewed === 1 ? 'review' : 'reviews'} · {Math.round((100 * s.correct) / Math.max(1, s.reviewed))}% right
        </p>
        <p>
          {phase.streak} day streak{phase.streak > 1 ? ' — keep it going!' : ''}
        </p>
        <div class="row">
          <button class="primary" onClick={() => navigate('home')}>Home</button>
          <button onClick={() => start(EXTRA_NEW)}>Learn more new cards</button>
        </div>
      </section>
    );
  if (!card || !s || !target) return null;

  const left = s.queue.length;

  return (
    <section class={`study phase-${phase.kind}`}>
      <header class="study-bar">
        <button class="link" onClick={() => navigate('home')}>
          ✕ End
        </button>
        <span class="muted">
          {left} {left === 1 ? 'card' : 'cards'} left{deckName ? ` · ${deckName}` : ''}
          {card.fsrs.state === State.New && <span class="tag">new</span>}
        </span>
        <button class="link" aria-pressed={showEnglish} onClick={() => setShowEnglish(!showEnglish)}>
          English {showEnglish ? 'on' : 'off'}
        </button>
      </header>

      <div class="study-body">
        <div class="prompt" hidden={phase.kind === 'grading'}>
          <div class="pinyin">{card.pinyin}</div>
          {showEnglish && <div class="english">{card.english}</div>}
          {card.hanzi.length > 1 && (
            <div class="slots">
              {[...card.hanzi].map((ch, i) => {
                const o = outcomes[i];
                const current = i === charIndex && phase.kind !== 'grading';
                return (
                  <span key={i} class={`slot ${o ? o.result : ''} ${current ? 'current' : ''}`}>
                    {o ? ch : current ? '?' : ''}
                  </span>
                );
              })}
            </div>
          )}
        </div>

        <div class="work">
          {phase.kind === 'writing' && (
            <>
              <WritingPad strokes={ink} onStrokesChange={setInk} />
              <div class="toolbar">
                <button disabled={!ink.length} onClick={() => setInk(ink.slice(0, -1))}>
                  Undo
                </button>
                <button disabled={!ink.length} onClick={() => setInk([])}>
                  Clear
                </button>
                <button onClick={dontKnow}>I don’t know</button>
                <button class="primary" disabled={!ink.length} onClick={check}>
                  Check
                </button>
              </div>
              {phase.attempt === 2 && <p class="muted center">Second try: write it again.</p>}
            </>
          )}

          {phase.kind === 'checked' && (
            <Feedback
              phase={phase}
              ink={ink}
              target={target}
              onRetry={() => startWriting(2)}
              onShowAnswer={() => setPhase({ ...phase, canRetry: false })}
              onCommit={commit}
            />
          )}

          {phase.kind === 'grading' && (
            <div class="grading">
              <div class="word">{card.hanzi}</div>
              <div class="pinyin">{card.pinyin}</div>
              <div class="english">{card.english}</div>
              {card.notes && <p class="notes">{card.notes}</p>}
              <p class="muted">How did that go?</p>
              <div class="grades">
                {([Rating.Again, Rating.Hard, Rating.Good, Rating.Easy] as Grade[]).map((r) => (
                  <button key={r} class={`grade grade-${r} ${r === phase.suggested ? 'suggested' : ''}`} onClick={() => grade(r)}>
                    <span>{GRADE_LABELS[r]}</span>
                    <small>{formatInterval(phase.due[r])}</small>
                  </button>
                ))}
              </div>
              <p class="muted small">The highlighted grade is what the check suggests. Tap any grade to continue.</p>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

interface FeedbackProps {
  phase: Extract<Phase, { kind: 'checked' }>;
  ink: InkStroke[];
  target: string;
  onRetry(): void;
  onShowAnswer(): void;
  onCommit(outcome: CharOutcome): void;
}

function Feedback({ phase, ink, target, onRetry, onShowAnswer, onCommit }: FeedbackProps) {
  const { outcome, result, canRetry, attempt } = phase;
  const right = outcome.result !== 'failed';
  const gaveUp = result === null;
  const lookedLike = result?.candidates[0]?.char;
  // "I wrote it right": the recognizer misread a correct answer.
  const override: CharOutcome = { ...outcome, result: attempt === 1 ? 'first' : 'retry' };

  return (
    <div class={`feedback ${right ? 'right' : 'wrong'}`}>
      <p class="verdict">
        {right
          ? outcome.result === 'retry'
            ? 'Got it on the second try.'
            : 'Correct!'
          : gaveUp
            ? 'Here it is:'
            : canRetry
              ? `Not quite${lookedLike && lookedLike !== target ? ` — that looks more like ${lookedLike}` : ''}.`
              : 'Not this time. Here’s the answer:'}
      </p>
      <div class="compare">
        {ink.length > 0 && (
          <figure>
            <InkPreview strokes={ink} />
            <figcaption>You wrote</figcaption>
          </figure>
        )}
        {!canRetry && (
          <figure>
            <HanziAnswer char={target} />
          </figure>
        )}
      </div>
      <div class="toolbar">
        {canRetry ? (
          <>
            <button onClick={onShowAnswer}>Show answer</button>
            <button onClick={() => onCommit(override)}>I wrote it right</button>
            <button class="primary" onClick={onRetry}>
              Try again
            </button>
          </>
        ) : (
          <>
            {!right && !gaveUp && <button onClick={() => onCommit(override)}>I wrote it right</button>}
            <button class="primary" onClick={() => onCommit(outcome)}>
              Continue
            </button>
          </>
        )}
      </div>
    </div>
  );
}
