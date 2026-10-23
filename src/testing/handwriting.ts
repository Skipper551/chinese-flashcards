// Turns Make Me a Hanzi stroke medians into something closer to real Pencil input, for testing the recognizer.
// Medians are clean, sparse, font-derived strokes; handwriting is dense, wobbly, skewed and drawn at any size.

import type { Point, Stroke } from '../recognize';
import medians from './mmah-medians-sample.json';

export const sampleMedians = medians as unknown as Record<string, Stroke[]>;

/** Small deterministic PRNG (mulberry32) so test runs are repeatable. */
export function seededRandom(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Distortion {
  /** Max rotation in degrees, either way. */
  rotate: number;
  /** Max independent x/y scale change, e.g. 0.15 for ±15%. */
  stretch: number;
  /** Max horizontal shear factor. */
  shear: number;
  /** Max random offset of each stroke, as a fraction of the character size (strokes drawn a bit out of place). */
  strokeShift: number;
  /** Amplitude of the slow, smooth wobble of a hand-drawn line, in the original 256px units. */
  wobble: number;
  /** Max per-point sensor noise, in the original 256px units. */
  noise: number;
  /** Size of the final drawing in pixels (an iPad writing pad is several hundred px). */
  size: number;
}

export const handwritingLike: Distortion = {
  rotate: 4,
  stretch: 0.12,
  shear: 0.08,
  strokeShift: 0.03,
  wobble: 2.5,
  noise: 0.4,
  size: 600,
};

/** Resamples each stroke to points `spacing` apart, like dense Pencil input. */
export function densify(strokes: Stroke[], spacing = 1.5): Stroke[] {
  return strokes.map((stroke) => {
    const out: Stroke = [stroke[0]];
    for (let i = 1; i < stroke.length; i++) {
      const [x0, y0] = stroke[i - 1];
      const [x1, y1] = stroke[i];
      const steps = Math.max(1, Math.round(Math.hypot(x1 - x0, y1 - y0) / spacing));
      for (let s = 1; s <= steps; s++) out.push([x0 + ((x1 - x0) * s) / steps, y0 + ((y1 - y0) * s) / steps]);
    }
    return out;
  });
}

export function distort(strokes: Stroke[], d: Distortion, random: () => number): Stroke[] {
  const spread = (max: number) => (random() * 2 - 1) * max;
  const angle = (spread(d.rotate) * Math.PI) / 180;
  const sx = 1 + spread(d.stretch);
  const sy = 1 + spread(d.stretch);
  const shear = spread(d.shear);
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const scale = d.size / 256;

  return densify(strokes).map((stroke) => {
    const shiftX = spread(d.strokeShift) * 256;
    const shiftY = spread(d.strokeShift) * 256;
    // Wobble is a couple of sine waves along the stroke, with a wavelength of 40–80px and random phase.
    const waves = [0, 1].map(() => ({ length: 40 + random() * 40, phaseX: random() * 7, phaseY: random() * 7 }));
    let travelled = 0;
    return stroke.map(([x, y], i): Point => {
      if (i > 0) travelled += Math.hypot(x - stroke[i - 1][0], y - stroke[i - 1][1]);
      let wx = spread(d.noise);
      let wy = spread(d.noise);
      for (const w of waves) {
        wx += (d.wobble / 2) * Math.sin((travelled / w.length) * 2 * Math.PI + w.phaseX);
        wy += (d.wobble / 2) * Math.sin((travelled / w.length) * 2 * Math.PI + w.phaseY);
      }
      // Work around the center of the 256 box so rotation and stretch don't push the character away.
      let px = (x - 128 + shiftX + wx) * sx;
      const py = (y - 128 + shiftY + wy) * sy;
      px += shear * py;
      return [(px * cos - py * sin + 128) * scale, (px * sin + py * cos + 128) * scale];
    });
  });
}
