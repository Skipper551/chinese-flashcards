#!/usr/bin/env python3
"""Checks a deck CSV the way the app's importer (src/import.ts) will, plus what the importer can't see: characters
the handwriting recognizer doesn't know, pinyin that doesn't fit the word, and words that are already in another deck
file. Standard library only.

    python3 check.py lesson-3.csv [--against lesson-1.csv lesson-2.csv ...]

Errors are rows the app would refuse. Warnings are rows it would take but that are probably wrong. Exits 1 on errors.
"""

import argparse
import csv
import json
import re
import sys
import unicodedata
from pathlib import Path

HERE = Path(__file__).resolve().parent
FIELDS = ['deck', 'hanzi', 'pinyin', 'english', 'notes']
# Same aliases as src/import.ts.
ALIASES = {
    'deck': 'deck', 'lesson': 'deck', '课': 'deck',
    'hanzi': 'hanzi', 'character': 'hanzi', 'characters': 'hanzi', 'chinese': 'hanzi', 'word': 'hanzi',
    '汉字': 'hanzi', '词语': 'hanzi', '生词': 'hanzi',
    'pinyin': 'pinyin', '拼音': 'pinyin',
    'english': 'english', 'meaning': 'english', 'definition': 'english', 'translation': 'english', '英文': 'english',
    'notes': 'notes', 'note': 'notes', 'example': 'notes', '备注': 'notes',
}
HANZI = re.compile(r'^[㐀-䶿一-鿿豈-﫿]+$')
TONED = re.compile(r'[āáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜ]|[a-zü:]+[1-4]', re.I)


def rows_of(path):
    """(line, row dict) pairs, matching the importer's header and no-header rules."""
    text = path.read_text(encoding='utf-8-sig')
    delimiter = '\t' if '\t' in text.split('\n', 1)[0] else ','
    table = list(csv.reader(text.splitlines(), delimiter=delimiter))
    if not table:
        return []
    header = [ALIASES.get(h.strip().lower()) for h in table[0]]
    has_header = 'hanzi' in header
    no_deck = not has_header and len(table[0]) <= 4 and HANZI.match(table[0][0].strip() or '-')
    columns = header if has_header else FIELDS[1:] if no_deck else FIELDS
    out = []
    for line, cells in enumerate(table, 1):
        if (has_header and line == 1) or not any(c.strip() for c in cells):
            continue
        row = {f: '' for f in FIELDS}
        for field, cell in zip(columns, cells):
            if field:
                row[field] = cell.strip()
        row['hanzi'] = re.sub(r'\s+', '', row['hanzi'])
        out.append((line, row))
    return out


def syllables(pinyin):
    """Rough syllable count: vowel groups, split at apostrophes, tone numbers, spaces and hyphens."""
    plain = unicodedata.normalize('NFD', pinyin.lower())
    plain = ''.join(c for c in plain if not unicodedata.combining(c)).replace('u:', 'ü').replace('v', 'ü')
    return len(re.findall(r'[aeiouü]+', plain))


def known_chars():
    """Characters the recognizer knows (all of which have stroke-order data too), or None if the list isn't here:
    known-chars.txt beside this script in the downloadable skill, the recognizer's own data in the repo."""
    bundled = HERE / 'known-chars.txt'
    if bundled.exists():
        return set(bundled.read_text(encoding='utf-8').strip())
    for folder in HERE.parents:
        mmah = folder / 'public/vendor/hanzilookup/mmah.json'
        if mmah.exists():
            return {c[0] for c in json.loads(mmah.read_text(encoding='utf-8'))['chars']}
    return None


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('csv', type=Path)
    parser.add_argument('--against', type=Path, nargs='*', default=[], help='other deck files to look for repeats in')
    args = parser.parse_args()

    rows = rows_of(args.csv)
    recognizer = known_chars()
    elsewhere = {}
    for other in args.against:
        if other.resolve() != args.csv.resolve():
            for _, row in rows_of(other):
                elsewhere.setdefault(row['hanzi'], f"{other.name} ({row['deck']})")

    errors, warnings, seen, decks = [], [], set(), {}
    for line, row in rows:
        hanzi, pinyin, english = row['hanzi'], row['pinyin'], row['english']
        deck = row['deck'] or '(deck named on the import screen)'
        where = f'line {line} {hanzi or "(blank)"}'
        if not hanzi:
            errors.append(f'{where}: no characters')
            continue
        if not HANZI.match(hanzi):
            bad = ''.join(sorted({c for c in hanzi if not HANZI.match(c)}))
            errors.append(f'{where}: non-Chinese text in the characters column: {bad!r}')
            continue
        if not pinyin and not english:
            errors.append(f'{where}: needs pinyin or English')
        if (deck, hanzi) in seen:
            warnings.append(f'{where}: repeated in this file (the app skips the repeat)')
        else:
            decks[deck] = decks.get(deck, 0) + 1
        seen.add((deck, hanzi))

        if recognizer is not None and (missing := [c for c in hanzi if c not in recognizer]):
            warnings.append(f'{where}: recognizer doesn\'t know {"".join(missing)}, so it can never be marked right')
        if not pinyin:
            warnings.append(f'{where}: no pinyin')
        else:
            if re.search(r'[^a-zA-ZāáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜüÜ0-5:\' \-·]', pinyin):
                warnings.append(f'{where}: odd characters in pinyin {pinyin!r}')
            n = syllables(pinyin)
            # 儿 often has no syllable of its own (erhua: 一点儿 yìdiǎnr).
            if n != len(hanzi) and not (n == len(hanzi) - hanzi.count('儿') and pinyin.rstrip().endswith('r')):
                warnings.append(f'{where}: {n} pinyin syllable(s) for {len(hanzi)} character(s): {pinyin!r}')
            if not TONED.search(pinyin):
                warnings.append(f'{where}: no tone marks in {pinyin!r} (fine only for neutral-tone words like 吗)')
        if not english:
            warnings.append(f'{where}: no English (the prompt will show pinyin only)')
        elif len(english) > 70:
            warnings.append(f'{where}: long English prompt ({len(english)} characters)')
        if hanzi in elsewhere:
            warnings.append(f'{where}: also in {elsewhere[hanzi]}')

    print(f'{args.csv}: {len(rows)} row(s)')
    for deck, count in decks.items():
        print(f'  {deck}: {count} card(s)')
    if recognizer is None:
        print('  (recognizer data not found, character coverage not checked)')
    for title, items in (('Errors', errors), ('Warnings', warnings)):
        if items:
            print(f'\n{title} ({len(items)}):')
            print('\n'.join(f'  {item}' for item in items))
    if not errors and not warnings:
        print('All rows look good.')
    sys.exit(1 if errors else 0)


if __name__ == '__main__':
    main()
