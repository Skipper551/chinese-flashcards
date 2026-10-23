import HanziWriter from 'hanzi-writer';
import { useEffect, useRef, useState } from 'preact/hooks';
import { loadHanziData } from '../hanziData';

/** The correct character, drawn by Hanzi Writer, with an optional stroke-order animation. */
export function HanziAnswer({ char, size = 200 }: { char: string; size?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const writer = useRef<HanziWriter | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'unavailable'>('loading');

  useEffect(() => {
    ref.current!.innerHTML = '';
    setState('loading');
    writer.current = HanziWriter.create(ref.current!, char, {
      width: size,
      height: size,
      padding: size / 20,
      strokeColor: '#2b2420',
      radicalColor: '#b23a2e',
      outlineColor: '#e6ddd0',
      strokeAnimationSpeed: 1.2,
      delayBetweenStrokes: 250,
      charDataLoader: (c, onLoad, onError) => {
        loadHanziData(c).then((data) => onLoad(data as never), onError);
      },
      onLoadCharDataSuccess: () => setState('ready'),
      // Offline with this character never fetched: fall back to the font.
      onLoadCharDataError: () => setState('unavailable'),
    });
    return () => {
      writer.current = null;
    };
  }, [char, size]);

  return (
    <div class="hanzi-answer">
      <div ref={ref} class="hanzi-writer" style={{ width: size, height: size, display: state === 'unavailable' ? 'none' : '' }} />
      {state === 'unavailable' && (
        <div class="hanzi-fallback" style={{ width: size, height: size, fontSize: size * 0.8 }}>
          {char}
        </div>
      )}
      <button class="link" disabled={state !== 'ready'} onClick={() => writer.current?.animateCharacter()}>
        Show stroke order
      </button>
    </div>
  );
}
