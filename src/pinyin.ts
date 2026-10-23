// Pinyin helpers: imports may use tone numbers (ni3 hao3), the app always shows tone marks (nǐ hǎo).

const MARKS: Record<string, string> = {
  a: 'āáǎà',
  e: 'ēéěè',
  i: 'īíǐì',
  o: 'ōóǒò',
  u: 'ūúǔù',
  ü: 'ǖǘǚǜ',
};

/** Puts the tone mark on the right vowel: a or e if present, the o of ou, otherwise the last vowel. */
function markSyllable(syllable: string, tone: number): string {
  const s = syllable.replace(/u:|v/g, 'ü').replace(/U:|V/g, 'Ü');
  if (tone < 1 || tone > 4) return s;
  const lower = s.toLowerCase();
  let index = lower.search(/[ae]/);
  if (index === -1) index = lower.indexOf('ou');
  if (index === -1) {
    for (let i = lower.length - 1; i >= 0; i--) {
      if ('iouü'.includes(lower[i])) {
        index = i;
        break;
      }
    }
  }
  if (index === -1) return s;
  const vowel = lower[index];
  let marked = MARKS[vowel][tone - 1];
  if (s[index] !== vowel) marked = marked.toUpperCase();
  return s.slice(0, index) + marked + s.slice(index + 1);
}

/** "ni3 hao3" → "nǐ hǎo", "lv4" → "lǜ", "ma5"/"ma0" → "ma". Text already using marks passes through. */
export function numberedToMarks(text: string): string {
  return text.replace(/([a-zü:]+)([0-5])/gi, (_, syllable: string, tone: string) => markSyllable(syllable, Number(tone)));
}
