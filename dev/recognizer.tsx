// Dev-only page (npm run dev, then /dev/recognizer.html): replays Make Me a Hanzi stroke medians into the
// recognizer, plain or distorted to look hand-drawn, and has a pad for trying real handwriting.
// Not part of the production build.

import { render } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import {
  loadRecognizer,
  RECOGNITION_TOLERANCES,
  type CheckResult,
  type RecognitionTolerance,
  type Recognizer,
  type Stroke,
} from '../src/recognize';
import { distort, handwritingLike, sampleMedians, seededRandom } from '../src/testing/handwriting';
import '../src/styles.css';
import './recognizer.css';

const chars = Object.keys(sampleMedians);

function StrokeView({ strokes, size = 120 }: { strokes: Stroke[]; size?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current!;
    const ctx = canvas.getContext('2d')!;
    const points = strokes.flat();
    const xs = points.map((p) => p[0]);
    const ys = points.map((p) => p[1]);
    const left = Math.min(...xs);
    const top = Math.min(...ys);
    const side = Math.max(Math.max(...xs) - left, Math.max(...ys) - top, 1);
    const scale = (size * 0.8) / side;
    ctx.clearRect(0, 0, size, size);
    ctx.lineWidth = 3;
    ctx.lineCap = ctx.lineJoin = 'round';
    ctx.strokeStyle = '#2b2420';
    for (const stroke of strokes) {
      ctx.beginPath();
      stroke.forEach(([x, y], i) => {
        const px = size * 0.1 + (x - left) * scale;
        const py = size * 0.1 + (y - top) * scale;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      });
      ctx.stroke();
    }
  }, [strokes, size]);
  return <canvas ref={ref} width={size} height={size} class="strokes" />;
}

function Results({ result }: { result: CheckResult }) {
  return (
    <span class="candidates">
      {result.candidates.slice(0, 5).map((c, i) => (
        <span key={c.char} class={i + 1 === result.rank ? 'target' : ''} title={c.score.toFixed(2)}>
          {c.char}
        </span>
      ))}
    </span>
  );
}

function Replay({ recognizer, tolerance }: { recognizer: Recognizer; tolerance: RecognitionTolerance }) {
  const [mode, setMode] = useState<'exact' | 'handwriting'>('handwriting');
  const [seed, setSeed] = useState(1);
  const random = seededRandom(seed);
  const rows = chars.map((char) => {
    const strokes = mode === 'exact' ? sampleMedians[char] : distort(sampleMedians[char], handwritingLike, random);
    const started = performance.now();
    const result = recognizer.check(strokes, char, tolerance);
    return { char, strokes, result, ms: performance.now() - started };
  });
  const accepted = rows.filter((r) => r.result.correct).length;
  const avgMs = rows.reduce((sum, r) => sum + r.ms, 0) / rows.length;

  return (
    <section>
      <h2>Replay Make Me a Hanzi strokes</h2>
      <div class="controls">
        <label>
          <input type="radio" checked={mode === 'exact'} onChange={() => setMode('exact')} /> Exact medians
        </label>
        <label>
          <input type="radio" checked={mode === 'handwriting'} onChange={() => setMode('handwriting')} /> Handwriting-like
        </label>
        <button disabled={mode === 'exact'} onClick={() => setSeed(seed + 1)}>
          New distortions
        </button>
        <strong id="summary">
          {accepted}/{rows.length} accepted · {avgMs.toFixed(0)} ms per check
        </strong>
      </div>
      <div class="grid">
        {rows.map((r) => (
          <figure key={r.char} class={r.result.correct ? 'pass' : 'fail'}>
            <StrokeView strokes={r.strokes} />
            <figcaption>
              <b>{r.char}</b> <Results result={r.result} />
            </figcaption>
          </figure>
        ))}
      </div>
    </section>
  );
}

function Pad({ recognizer, tolerance }: { recognizer: Recognizer; tolerance: RecognitionTolerance }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [target, setTarget] = useState('我');
  const current = useRef<Stroke | null>(null);

  useEffect(() => {
    const ctx = ref.current!.getContext('2d')!;
    ctx.clearRect(0, 0, 320, 320);
    ctx.lineWidth = 6;
    ctx.lineCap = ctx.lineJoin = 'round';
    for (const stroke of strokes) {
      ctx.beginPath();
      stroke.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
      ctx.stroke();
    }
  }, [strokes]);

  const point = (e: PointerEvent): [number, number] => {
    const rect = ref.current!.getBoundingClientRect();
    return [e.clientX - rect.left, e.clientY - rect.top];
  };
  const result = strokes.length ? recognizer.check(strokes, target, tolerance) : null;

  return (
    <section>
      <h2>Draw it yourself</h2>
      <div class="pad-row">
        <canvas
          ref={ref}
          width={320}
          height={320}
          class="pad"
          onPointerDown={(e) => {
            ref.current!.setPointerCapture(e.pointerId);
            current.current = [point(e)];
            setStrokes([...strokes, current.current]);
          }}
          onPointerMove={(e) => {
            if (!current.current) return;
            current.current.push(point(e));
            setStrokes([...strokes.slice(0, -1), current.current]);
          }}
          onPointerUp={() => (current.current = null)}
        />
        <div class="pad-side">
          <label>
            Target <input value={target} maxLength={1} onInput={(e) => setTarget(e.currentTarget.value)} />
          </label>
          <button onClick={() => setStrokes([])}>Clear</button>
          <button onClick={() => setStrokes(strokes.slice(0, -1))}>Undo stroke</button>
          {result && (
            <p id="pad-result">
              {result.correct ? '✓ accepted' : '✗ not accepted'} <Results result={result} />
            </p>
          )}
        </div>
      </div>
    </section>
  );
}

function Page() {
  const [recognizer, setRecognizer] = useState<Recognizer>();
  const [error, setError] = useState<string>();
  const [tolerance, setTolerance] = useState<RecognitionTolerance>('normal');

  useEffect(() => {
    loadRecognizer().then(setRecognizer, (e) => setError(String(e)));
  }, []);

  return (
    <main class="screen dev-page">
      <h1>Recognizer test</h1>
      <div class="controls">
        Tolerance:
        {(Object.keys(RECOGNITION_TOLERANCES) as RecognitionTolerance[]).map((t) => (
          <label key={t}>
            <input type="radio" checked={tolerance === t} onChange={() => setTolerance(t)} /> {t}
          </label>
        ))}
      </div>
      {error && <p class="fail">{error}</p>}
      {!recognizer && !error && <p>Loading recognizer…</p>}
      {recognizer && (
        <>
          <Pad recognizer={recognizer} tolerance={tolerance} />
          <Replay recognizer={recognizer} tolerance={tolerance} />
        </>
      )}
    </main>
  );
}

render(<Page />, document.getElementById('app')!);
