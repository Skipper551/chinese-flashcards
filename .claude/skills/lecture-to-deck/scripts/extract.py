#!/usr/bin/env python3
"""Dumps the text of a lecturer's .docx or .pptx (tables kept as rows, slides numbered, speaker notes included),
so vocabulary can be read out of it. Standard library only.

    python3 extract.py FILE [--images DIR]

Tables print as ` | `-separated rows. Word phonetic guides (pinyin typed above characters) print as 汉字[hànzì].
--images copies embedded pictures to DIR and says where each appeared, for vocabulary that only exists as an image.
PDFs aren't handled here: read them with Claude's Read tool, which sees the pages themselves. Legacy .doc files can
be read after macOS's `textutil -convert html` (its -convert docx loses tables).
"""

import argparse
import posixpath
import re
import sys
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET

W = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
A = '{http://schemas.openxmlformats.org/drawingml/2006/main}'
P = '{http://schemas.openxmlformats.org/presentationml/2006/main}'
R = '{http://schemas.openxmlformats.org/officeDocument/2006/relationships}'
REL = '{http://schemas.openxmlformats.org/package/2006/relationships}'


def tidy(text):
    return re.sub(r'[ \t　]+', ' ', text).strip()


def rels(z, part):
    """Relationship id → (type, target path inside the zip) for one part."""
    folder, name = posixpath.split(part)
    path = posixpath.join(folder, '_rels', name + '.rels')
    if path not in z.namelist():
        return {}
    out = {}
    for rel in ET.fromstring(z.read(path)).iter(REL + 'Relationship'):
        target = rel.get('Target')
        if rel.get('TargetMode') != 'External':
            target = posixpath.normpath(posixpath.join(folder, target))
        out[rel.get('Id')] = (rel.get('Type').rsplit('/', 1)[-1], target)
    return out


class Images:
    def __init__(self, z, out_dir):
        self.z, self.out_dir, self.saved = z, out_dir, {}
        if out_dir:
            out_dir.mkdir(parents=True, exist_ok=True)

    def note(self, target):
        """Copies the image (once) and returns the line to print where it appears."""
        if not self.out_dir:
            return f'[image: {posixpath.basename(target)}]'
        if target not in self.saved and target in self.z.namelist():
            dest = self.out_dir / f'{len(self.saved) + 1:03d}-{posixpath.basename(target)}'
            dest.write_bytes(self.z.read(target))
            self.saved[target] = dest
        return f'[image: {self.saved.get(target, target)}]'


# --- Word ---------------------------------------------------------------------------------------------------------

def docx_runs(el, part_rels, images):
    """Text of a paragraph (or cell content), with ruby as base[pinyin] and images as markers."""
    out = []
    for node in el:
        tag = node.tag
        if tag == W + 't':
            out.append(node.text or '')
        elif tag in (W + 'tab', W + 'ptab'):
            out.append('\t')
        elif tag in (W + 'br', W + 'cr'):
            out.append('\n')
        elif tag == W + 'ruby':
            base, guide = (node.find(W + name) for name in ('rubyBase', 'rt'))
            base = docx_runs(base, part_rels, images) if base is not None else ''
            guide = docx_runs(guide, part_rels, images) if guide is not None else ''
            out.append(f'{base}[{tidy(guide)}]')
        elif tag == W + 'txbxContent':
            out.append('\n' + '\n'.join(docx_blocks(node, part_rels, images)) + '\n')
        elif tag == A + 'blip':
            rel = part_rels.get(node.get(R + 'embed'))
            if rel:
                out.append(f' {images.note(rel[1])} ')
        else:
            out.append(docx_runs(node, part_rels, images))
    return ''.join(out)


def docx_table(tbl, part_rels, images):
    lines = []
    for tr in tbl.findall(W + 'tr'):  # tables nested in cells come out through docx_blocks
        cells = []
        for tc in tr.findall(W + 'tc'):
            text = ' / '.join(t for t in (tidy(b) for b in docx_blocks(tc, part_rels, images)) if t)
            span = tc.find(f'{W}tcPr/{W}gridSpan')
            cells.extend([text] + [''] * (int(span.get(W + 'val', 1)) - 1 if span is not None else 0))
        if any(cells):
            lines.append(' | '.join(cells))
    return lines


def docx_blocks(el, part_rels, images):
    """Paragraphs and tables in document order."""
    out = []
    for node in el:
        if node.tag == W + 'p':
            text = docx_runs(node, part_rels, images)
            out.extend(tidy(line) for line in text.split('\n'))
        elif node.tag == W + 'tbl':
            out.append('')
            out.append('[table]')
            out.extend(docx_table(node, part_rels, images))
            out.append('[/table]')
            out.append('')
        elif node.tag in (W + 'sdt', W + 'sdtContent', W + 'customXml', W + 'body'):
            out.extend(docx_blocks(node, part_rels, images))
    return out


def extract_docx(z, images):
    part = 'word/document.xml'
    body = ET.fromstring(z.read(part)).find(W + 'body')
    lines = docx_blocks(body, rels(z, part), images)
    return '\n'.join(collapse(lines))


# --- PowerPoint ---------------------------------------------------------------------------------------------------

def pptx_text_body(body):
    lines = []
    for para in body.iter(A + 'p'):
        parts = []
        for node in para.iter():
            if node.tag == A + 't':
                parts.append(node.text or '')
            elif node.tag == A + 'br':
                parts.append('\n')
        lines.extend(tidy(line) for line in ''.join(parts).split('\n'))
    return [line for line in lines if line]


def pptx_shapes(tree, part_rels, images):
    """Text, tables, and pictures of a slide's shape tree, in order."""
    out = []
    for node in tree:
        tag = node.tag
        if tag == P + 'sp':
            body = node.find(P + 'txBody')
            if body is not None:
                out.extend(pptx_text_body(body))
        elif tag == P + 'grpSp':
            out.extend(pptx_shapes(node, part_rels, images))
        elif tag == P + 'graphicFrame':
            for tbl in node.iter(A + 'tbl'):
                out.append('[table]')
                for tr in tbl.iter(A + 'tr'):
                    cells = []
                    for tc in tr.findall(A + 'tc'):
                        if tc.get('hMerge') or tc.get('vMerge'):
                            cells.append('')
                            continue
                        body = tc.find(A + 'txBody')
                        cells.append(' / '.join(pptx_text_body(body)) if body is not None else '')
                    if any(cells):
                        out.append(' | '.join(cells))
                out.append('[/table]')
        elif tag == P + 'pic':
            blip = node.find(f'.//{A}blip')
            rel = part_rels.get(blip.get(R + 'embed')) if blip is not None else None
            if rel:
                out.append(images.note(rel[1]))
    return out


def extract_pptx(z, images):
    pres = 'ppt/presentation.xml'
    pres_rels = rels(z, pres)
    order = [pres_rels[s.get(R + 'id')][1] for s in ET.fromstring(z.read(pres)).iter(P + 'sldId')]
    out = []
    for number, slide in enumerate(order, 1):
        slide_rels = rels(z, slide)
        root = ET.fromstring(z.read(slide))
        hidden = ' (hidden)' if root.get('show') == '0' else ''
        out.append(f'=== Slide {number}{hidden} ===')
        out.extend(pptx_shapes(root.find(f'{P}cSld/{P}spTree'), slide_rels, images))
        for kind, target in slide_rels.values():
            if kind == 'notesSlide' and target in z.namelist():
                notes_root = ET.fromstring(z.read(target))
                notes = []
                for sp in notes_root.iter(P + 'sp'):
                    ph = sp.find(f'{P}nvSpPr/{P}nvPr/{P}ph')
                    body = sp.find(P + 'txBody')
                    if ph is not None and ph.get('type') == 'body' and body is not None:
                        notes.extend(pptx_text_body(body))
                if notes:
                    out.append('--- notes ---')
                    out.extend(notes)
        out.append('')
    return '\n'.join(out)


def collapse(lines):
    """Drops runs of blank lines."""
    out = []
    for line in lines:
        if line or (out and out[-1]):
            out.append(line)
    return out


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('file', type=Path)
    parser.add_argument('--images', type=Path, help='copy embedded images here')
    args = parser.parse_args()

    suffix = args.file.suffix.lower()
    if suffix == '.pdf':
        sys.exit('PDFs: read them with the Read tool (pages="1-20" at a time) instead of this script.')
    if suffix in ('.doc', '.ppt'):
        sys.exit(f'{suffix} is the old binary format. For .doc run `textutil -convert html FILE` (macOS) and read the '
                 'HTML; for .ppt, ask for it re-saved as .pptx or exported as PDF.')
    try:
        z = zipfile.ZipFile(args.file)
    except zipfile.BadZipFile:
        sys.exit(f'{args.file} is not a .docx/.pptx file (not a zip archive).')
    images = Images(z, args.images)
    names = z.namelist()
    if 'word/document.xml' in names:
        print(extract_docx(z, images))
    elif 'ppt/presentation.xml' in names:
        print(extract_pptx(z, images))
    else:
        sys.exit(f'{args.file} is neither a Word document nor a PowerPoint presentation.')
    if images.saved:
        print(f'\n[{len(images.saved)} image(s) saved to {args.images}]')


if __name__ == '__main__':
    main()
