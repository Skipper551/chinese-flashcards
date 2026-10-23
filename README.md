# Chinese Flashcards

Handwriting flashcards for the iPad: write simplified Chinese characters from memory with the Apple Pencil, the app
checks them, and FSRS spaced repetition decides when each word comes back. Runs in Safari, installs to the Home
Screen, works offline, and keeps everything on the iPad (with backup/restore to a file).

## Using it

- **Decks → Import**: CSV or JSON vocabulary (see [samples/README.md](samples/README.md)), with a preview before
  anything is saved. Or start with the HSK 1 sample deck.
- **Study**: pinyin and English (toggleable) are shown; write each character, tap Check. Right first time → Good
  (Easy if it was quick and the recognizer's first guess), right on the second try → Hard, wrong or "I don't know" →
  Again. Any grade can be changed with one tap if the recognizer got it wrong.
- **Progress**: streak calendar, reviews per day, accuracy, cards by stage, upcoming reviews.
- **Settings**: new cards per day, daily goal, English hint default, how strict the handwriting check is, backup and
  restore.

To install on the iPad: open the site in Safari → Share → Add to Home Screen.

## Development

```bash
npm install
npm run dev        # http://localhost:5173 ; recognizer test page at /dev/recognizer.html
npm test           # unit tests, including recognizer accuracy on Make Me a Hanzi strokes
npm run build      # production build in dist/ (set BASE_PATH=/repo-name/ for GitHub Pages)
```

Stack: Vite, Preact, TypeScript, vite-plugin-pwa, Dexie (IndexedDB), ts-fsrs, Hanzi Writer.

- `src/recognize.ts` wraps HanziLookupJS (vendored in `public/vendor/hanzilookup/`). Answers are accepted when the
  target is among the top candidates *and* scores close to the best one, so look-alikes (他/她, 二/三) aren't accepted.
- `src/canvas/WritingPad.tsx` is the Pencil canvas: pressure-sensitive ink, palm rejection once the Pencil has been
  used, no scrolling/zooming/callouts.
- Hanzi Writer's stroke data (`hanzi-writer-data`, ~9,500 files) is served from `hanzi-data/` and cached by the
  service worker as characters are used; the app prefetches a deck's characters when it's imported or studied.

## Deploying

`.github/workflows/deploy.yml` builds, tests, and publishes to GitHub Pages on every push to `main` (enable Pages with
"GitHub Actions" as the source in the repository settings).

## Licenses

HanziLookupJS is GPL-3.0 and the Make Me a Hanzi / hanzi-writer-data stroke data is under the Arphic Public License;
see `public/vendor/hanzilookup/README.md`. Hanzi Writer and ts-fsrs are MIT, Dexie is Apache-2.0.
