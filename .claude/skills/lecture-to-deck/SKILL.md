---
name: lecture-to-deck
description: Turn a lecturer's course materials (PDF, Word .docx/.doc, PowerPoint .pptx) into a deck CSV the Chinese Flashcards app (skipper551.github.io/chinese-flashcards) can import. Use whenever someone hands over lesson files, vocabulary lists, slides or handouts and wants cards from them, e.g. "make a deck from this lecture", "import the professor's Lesson 4 slides", "turn these handouts into flashcards".
---

# Lecture files → deck CSV

The Chinese Flashcards app imports a CSV with the columns `deck,hanzi,pinyin,english,notes`. The learner writes each
`hanzi` from memory with an Apple Pencil after seeing the pinyin and English, so every row has to be a word they can
actually write, with a prompt that points to exactly one answer.

Two scripts come with this skill, in the `scripts/` folder next to this file (standard library Python, no installs):

- `scripts/extract.py FILE [--images DIR]` prints the text of a .docx or .pptx, with tables as `a | b | c` rows,
  slides numbered, speaker notes, and Word phonetic guides as `汉字[hànzì]`.
- `scripts/check.py DECK.csv [--against OTHER.csv ...]` checks the finished CSV the way the app will, plus characters
  the handwriting recognizer can't mark right, pinyin that doesn't fit the word, and repeats of words in other decks.

Below, `SKILL_DIR` stands for the folder this file is in; use its real path in commands.

## Where files go

- **In the Chinese Flashcards repo** (it has `src/import.ts`): lecturer files go in `lectures/`, output in
  `decks/<short-name>.csv`, one file per lesson. Both folders are git-ignored. The repo is public: never commit the
  lecturer's files or decks made from them unless the user explicitly asks to.
- **Anywhere else** (claude.ai, another project): write `<short-name>.csv` wherever the user can download or open it
  (on claude.ai, the outputs folder) and hand it over as a file. One file per lesson.

## 1. Read every file

| File | How |
|------|-----|
| `.pdf` | Read it directly, as pages: that catches scans and tables. In Claude Code, the Read tool with `pages: "1-20"`, then the next 20. |
| `.docx`, `.pptx` | `python3 -I SKILL_DIR/scripts/extract.py FILE`. Add `--images <empty folder>` if the text looks incomplete or refers to pictures, then look at the images that might hold vocabulary. |
| `.doc` | On a Mac, `textutil -convert html -output <folder>/lecture.html FILE`, then read the HTML (in Claude Code it needs the sandbox off). Not `-convert docx`: that flattens tables into one cell per line. Elsewhere, ask for a .docx or PDF. |
| `.ppt`, `.key`, `.pages` | Ask for it re-saved as .pptx/.docx or exported as PDF. |

Read the whole file before deciding anything: lessons often put the vocabulary list at the end, or spread it over
several slides with the same title.

## 2. Find the vocabulary

Use, in order of preference:

1. **An explicit word list**: 生词 / 词语 / 生字 / New words / Vocabulary tables or slides. When there is one, it is the
   deck; don't add words from the rest of the material.
2. **Words the material marks as new** (bold, coloured, numbered, glossed in the margin) when there's no list.
3. Otherwise there's nothing reliable to take. Say what the file contains (grammar notes, a dialogue, …) and ask the
   user what they want carded, e.g. every word in the dialogue that isn't in an earlier deck.

Supplementary lists (补充生词, "optional", "for recognition only", proper nouns) go in only if the user says so; ask
once and mention it in the report. Hidden slides are usually leftovers: skip them unless they're clearly vocabulary,
and say so. Skip sentences, grammar patterns and dialogue lines; they aren't cards.

## 3. Make each row

- **deck**: one deck per lesson, named the way the material names it, kept short (`Lesson 4`, `第四课`). If the user
  already has a naming scheme (earlier deck files), follow it. The same name in a later import adds to that deck.
- **hanzi**: simplified characters only, nothing else (no spaces, punctuation, Latin letters, digits or brackets; the
  app refuses such rows).
  - Traditional in the source → simplified. Both given → the simplified one.
  - Alternatives (`爸爸/爸`) → the first, or a row each if the lesson clearly teaches both.
  - Optional parts (`一点(儿)`, `(一)块`) → the main form, the other in notes (`Also 一点儿`).
  - Patterns with gaps (`一…就…`, `A跟B一样`) and words with Latin letters (`卡拉OK`, `T恤`) can't be cards: leave them
    out and list them in the report.
- **pinyin**: tone marks, copied from the source (keep its spacing, e.g. `nǐhǎo` or `nǐ hǎo`). Tone numbers are fine
  too; the app converts them. Neutral tone has no mark (`māma`). Keep `'` before a syllable starting with a vowel
  (`Xī'ān`). Polyphonic characters take the reading used in this lesson (了 le vs liǎo, 行 xíng vs háng).
  If the source has no pinyin, write it yourself and say so in the report.
- **english**: the prompt, so keep it short: the lesson's own gloss, trimmed, senses separated by `; ` (`I; me`).
  Meanings are always in English; translate glosses in other languages. Put grammar labels and long explanations in
  notes, not here. If the source has no gloss, write one and say so in the report.
  - **One answer per prompt.** Words with the same pinyin and meaning can't be told apart (他/她/它 are all *tā*):
    give the English a hint that settles it (`he; him (male)`, `she; her`, `it (things, animals)`). Notes don't
    help here, as they only appear after answering. Check the whole deck for clashes like this.
- **notes**: shown after answering. Use it for the part of speech (`v.`, `m.w.`), the measure word, variants, and a
  short example from the material if it has one. Leave it empty rather than padding it.

Keep the source's order; the app introduces new cards in file order.

## 4. Write and check the CSV

Write the CSV with the header `deck,hanzi,pinyin,english,notes`, UTF-8, one row per word. Quote a field (`"…"`) if it
contains a comma or a quote, and double quotes inside it (`""`). Then check it, listing earlier deck files if there
are any:

```bash
python3 -I SKILL_DIR/scripts/check.py lesson-4.csv --against lesson-1.csv lesson-2.csv lesson-3.csv
```

Fix every error. Go through each warning: fix it, or keep the row if it's right (e.g. a word that really is in two
lessons) and mention it in the report. A character the recognizer doesn't know can never be marked right; leave the
row out unless the user wants it anyway (the learner can still mark it right by hand).

## 5. Report

Tell the user, briefly:

- Each deck file written, its deck name, and how many cards it has.
- What was left out and why (patterns, Latin-letter words, supplementary lists, unknown characters).
- Pinyin or English you wrote yourself rather than copied, by word, so they can check it against the lesson.
- Anything you assumed (polyphone readings, which alternative you kept).
- How to import: get the CSV onto the iPad (AirDrop to Files, iCloud Drive, or download it there), then in the app
  **Decks → Import → choose the file**; the preview shows what will be added before anything is saved. Pasting the
  CSV text into the import box works too.

Offer the file in whatever way reaches the user (a download, or sending it to their phone if the environment can).
In the repo, don't commit anything.
