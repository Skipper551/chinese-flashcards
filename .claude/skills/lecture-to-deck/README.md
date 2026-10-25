# lecture-to-deck

A skill for Claude that turns a lecturer's PDFs, Word documents and PowerPoint slides into decks for
[Chinese Flashcards](https://skipper551.github.io/chinese-flashcards/). Give Claude the lesson files and ask for a
deck; it picks out the vocabulary list, writes a CSV per lesson, checks it, and tells you what it skipped or had to
fill in. Import the CSV in the app under **Decks → Import**.

## Installing

- **Claude (claude.ai or the desktop app)**: Customize → Skills → **+** → Upload a skill, and choose
  `lecture-to-deck.zip` as it is (don't unzip it). Code execution has to be turned on.
- **Claude Code**: unzip it into `~/.claude/skills/`, so the file ends up at `~/.claude/skills/lecture-to-deck/SKILL.md`.

Then, for example: attach the Lesson 4 slides and ask "make a flashcard deck from this".

> **Vibe coded.** Like the app, this skill was fully created by Claude, Anthropic's AI (via Claude Code), and monitored
> by Malcolm Swim. Check the cards it makes against the lesson.
