import { useEffect, useRef } from 'preact/hooks';
import type { Stroke } from '../recognize';

/** x and y are fractions of the pad's size (so strokes survive rotating the iPad); pressure is 0–1. */
export type InkPoint = [x: number, y: number, pressure: number];
export type InkStroke = InkPoint[];

export function toStrokes(ink: InkStroke[]): Stroke[] {
  return ink.map((stroke) => stroke.map(([x, y]): [number, number] => [x * 1000, y * 1000]));
}

// Once the learner uses the Pencil, fingers (and the side of their hand) stop drawing for the rest of the visit.
let penSeen = false;

const INK = '#2b2420';

/** Line width in CSS px for a point, relative to the pad size. */
function widthAt(pressure: number, size: number) {
  return (size / 70) * (0.45 + pressure);
}

function drawSegment(ctx: CanvasRenderingContext2D, a: InkPoint, b: InkPoint, size: number) {
  ctx.lineWidth = widthAt((a[2] + b[2]) / 2, size);
  ctx.beginPath();
  ctx.moveTo(a[0] * size, a[1] * size);
  ctx.lineTo(b[0] * size, b[1] * size);
  ctx.stroke();
}

function drawStroke(ctx: CanvasRenderingContext2D, stroke: InkStroke, size: number) {
  if (stroke.length === 1) {
    ctx.beginPath();
    ctx.arc(stroke[0][0] * size, stroke[0][1] * size, widthAt(stroke[0][2], size) / 2, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  for (let i = 1; i < stroke.length; i++) drawSegment(ctx, stroke[i - 1], stroke[i], size);
}

/** Sizes a canvas to its CSS box at device resolution and returns the CSS size; call on every redraw. */
function prepare(canvas: HTMLCanvasElement) {
  const size = canvas.clientWidth;
  const dpr = window.devicePixelRatio || 1;
  if (canvas.width !== Math.round(size * dpr)) {
    canvas.width = canvas.height = Math.round(size * dpr);
  }
  const ctx = canvas.getContext('2d')!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, size, size);
  ctx.strokeStyle = ctx.fillStyle = INK;
  ctx.lineCap = ctx.lineJoin = 'round';
  return { ctx, size };
}

interface WritingPadProps {
  strokes: InkStroke[];
  onStrokesChange(strokes: InkStroke[]): void;
  disabled?: boolean;
}

/** Square writing area with a 田字格 practice grid. Controlled: the parent owns the strokes. */
export function WritingPad({ strokes, onStrokesChange, disabled }: WritingPadProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const current = useRef<{ pointerId: number; stroke: InkStroke } | null>(null);
  const latest = useRef({ strokes, onStrokesChange, disabled });
  latest.current = { strokes, onStrokesChange, disabled };

  const redraw = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const { ctx, size } = prepare(canvas);
    for (const stroke of latest.current.strokes) drawStroke(ctx, stroke, size);
    if (current.current) drawStroke(ctx, current.current.stroke, size);
  };

  useEffect(redraw, [strokes]);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const observer = new ResizeObserver(redraw);
    observer.observe(canvas);

    const pointAt = (e: PointerEvent): InkPoint => {
      const rect = canvas.getBoundingClientRect();
      // Mouse and finger report 0.5 or 0; give them a steady medium line.
      const pressure = e.pointerType === 'pen' ? e.pressure : 0.5;
      return [(e.clientX - rect.left) / rect.width, (e.clientY - rect.top) / rect.height, pressure];
    };

    const down = (e: PointerEvent) => {
      if (latest.current.disabled || current.current) return;
      if (e.pointerType === 'pen') penSeen = true;
      else if (penSeen && e.pointerType === 'touch') return;
      if (e.button > 0) return;
      e.preventDefault();
      try {
        canvas.setPointerCapture(e.pointerId);
      } catch {
        // Synthetic events (tests) have no real pointer to capture.
      }
      current.current = { pointerId: e.pointerId, stroke: [pointAt(e)] };
      redraw();
    };

    const move = (e: PointerEvent) => {
      const active = current.current;
      if (!active || e.pointerId !== active.pointerId) return;
      e.preventDefault();
      const ctx = canvas.getContext('2d')!;
      const size = canvas.clientWidth;
      // Pencil reports up to 240 points a second; coalesced events keep the ones between animation frames.
      const events = e.getCoalescedEvents?.() ?? [e];
      for (const event of events.length ? events : [e]) {
        const point = pointAt(event);
        const last = active.stroke[active.stroke.length - 1];
        active.stroke.push(point);
        drawSegment(ctx, last, point, size);
      }
    };

    const up = (e: PointerEvent) => {
      const active = current.current;
      if (!active || e.pointerId !== active.pointerId) return;
      current.current = null;
      latest.current.onStrokesChange([...latest.current.strokes, active.stroke]);
    };

    const cancel = (e: PointerEvent) => {
      if (current.current?.pointerId !== e.pointerId) return;
      current.current = null;
      redraw();
    };

    // Safari still scrolls, zooms or shows the magnifier on touch events unless they're cancelled too.
    const stopTouch = (e: TouchEvent) => e.preventDefault();

    canvas.addEventListener('pointerdown', down);
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', cancel);
    canvas.addEventListener('touchstart', stopTouch, { passive: false });
    canvas.addEventListener('touchmove', stopTouch, { passive: false });
    return () => {
      observer.disconnect();
      canvas.removeEventListener('pointerdown', down);
      canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerup', up);
      canvas.removeEventListener('pointercancel', cancel);
      canvas.removeEventListener('touchstart', stopTouch);
      canvas.removeEventListener('touchmove', stopTouch);
    };
  }, []);

  return (
    <div class={`writing-pad${disabled ? ' disabled' : ''}`}>
      <canvas ref={canvasRef} onContextMenu={(e) => e.preventDefault()} />
    </div>
  );
}

/** Small read-only rendering of what was written, for feedback after checking. */
export function InkPreview({ strokes }: { strokes: InkStroke[] }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const { ctx, size } = prepare(ref.current!);
    for (const stroke of strokes) drawStroke(ctx, stroke, size);
  }, [strokes]);
  return (
    <div class="ink-preview">
      <canvas ref={ref} />
    </div>
  );
}
