// Stroke data for Hanzi Writer (hanzi-writer-data, one JSON file per character), served from our own site under
// hanzi-data/ (see vite.config.ts). The service worker caches each file once fetched, so the app prefetches the
// characters of imported and studied cards while online to make them available offline.

const base = `${import.meta.env.BASE_URL}hanzi-data/`;

export function hanziDataUrl(char: string) {
  return `${base}${encodeURIComponent(char)}.json`;
}

export async function loadHanziData(char: string): Promise<unknown> {
  const response = await fetch(hanziDataUrl(char));
  if (!response.ok) throw new Error(`No stroke data for ${char}`);
  return response.json();
}

/** Fetches (and so caches) stroke data for every character in `words`, a few at a time. Failures are ignored. */
export async function prefetchHanziData(words: string[]) {
  const chars = [...new Set(words.join(''))];
  const queue = [...chars];
  const worker = async () => {
    for (let char = queue.shift(); char; char = queue.shift()) {
      await fetch(hanziDataUrl(char)).catch(() => {});
    }
  };
  await Promise.all(Array.from({ length: 4 }, worker));
}
