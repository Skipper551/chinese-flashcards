# Import format

The app imports CSV (comma or tab separated) or JSON, one row per word. Decks → Import accepts a file or pasted text.

| Column    | Required | Notes |
|-----------|----------|-------|
| `deck`    | no       | Deck to add the word to; created if it doesn't exist. Rows without it go to the deck named on the import screen. |
| `hanzi`   | yes      | Simplified characters only. A word with several characters is written one character at a time. |
| `pinyin`  | one of   | Tone marks (`nǐ hǎo`) or tone numbers (`ni3 hao3`, `lv4` for lǜ), shown with marks. |
| `english` | these    | The meaning shown on the prompt (can be hidden while studying). |
| `notes`   | no       | Shown after answering. |

A header row is optional; columns are matched by name (also `character`, `chinese`, `meaning`, `拼音`, …). Without a
header the order is `deck, hanzi, pinyin, english, notes`, or `hanzi, pinyin, english, notes` when the first column is
Chinese. Words already in the deck and repeats within the file are skipped; the preview shows which rows will be
added before anything is saved.

JSON is either an array of rows (`[{"hanzi": "你好", "pinyin": "nǐ hǎo", "english": "hello"}]`) or
`{"deck": "Lesson 1", "cards": [...]}` (or an array of those).

`hsk1-sample.csv` is the sample deck the app offers on first run.
