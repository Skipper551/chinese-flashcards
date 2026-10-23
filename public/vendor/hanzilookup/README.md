# HanziLookupJS (vendored)

Handwriting recognition used to check the characters Sophie writes.

- Source: https://github.com/gugray/HanziLookupJS, commit `b21124f771ddd91f131e62aa478bc188f6ec78d3` (2019-08-07)
- `hanzilookup.min.js` and `mmah.json` are copied unmodified from the repository's `dist/` folder.
- `hanzilookup.min.js` is licensed under the GNU GPL v3 (`LICENSE-GPL`). It is derived from Jordan Kiang's HanziLookup.
- `mmah.json` is derived from Make Me a Hanzi's `graphics.txt`, itself derived from the Arphic PL KaitiM GB and
  Arphic PL UKai fonts, and is licensed under the Arphic Public License (`LICENSE-APL`).

`src/recognize.ts` loads both at runtime. `src/testing/mmah-medians-sample.json` holds Make Me a Hanzi stroke medians
for 55 characters (from the same repository's `library/data/x-mmah-medians.js`), used only by tests and the dev page.
