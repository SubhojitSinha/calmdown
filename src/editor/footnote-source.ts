// Edits to the markdown source made from the rendered page: adding and removing footnotes,
// and ticking task checkboxes. Text in, text out (LF line endings). Numeric footnote labels
// are renumbered after every change so [^n] always matches the number shown.

import { footnoteInfo } from '../render/render';

const NUM = /^\d+$/;
const REF = /\[\^([^\]\s]+)\]/g;
const DEF = /^ {0,3}\[\^([^\]\s]+)\]:/gm;

/** Same length as `src`, with code blanked out so footnote syntax inside code is left alone. */
function maskCode(src: string, codeLines: [number, number][]): string {
  const lines = src.split('\n');
  for (const [a, b] of codeLines) {
    for (let i = a; i < b && i < lines.length; i++) lines[i] = ' '.repeat(lines[i]!.length);
  }
  return lines.map((l) => l.replace(/(`+)[^`]*?\1/g, (m) => ' '.repeat(m.length))).join('\n');
}

/** Line range [start, end) of a footnote definition, continuation lines included. */
function defLines(lines: string[], label: string): [number, number] | null {
  const head = new RegExp(`^ {0,3}\\[\\^${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\]:`);
  const i = lines.findIndex((l) => head.test(l));
  if (i < 0) return null;
  let j = i + 1;
  while (j < lines.length && (lines[j]!.trim() === '' || /^( {4}|\t)/.test(lines[j]!))) j++;
  while (j > i + 1 && lines[j - 1]!.trim() === '') j--;
  return [i, j];
}

/** Numeric labels become 1, 2, 3… in reading order. Named labels and inline notes keep theirs. */
export function renumber(src: string): string {
  const { labels, codeLines } = footnoteInfo(src);
  const masked = maskCode(src, codeLines);
  const map = new Map<string, string>();
  labels.forEach((l, i) => {
    if (l !== null && NUM.test(l)) map.set(l, String(i + 1));
  });
  // Numeric definitions nothing refers to go after the rest, so they can never clash.
  let next = labels.length;
  for (const m of masked.matchAll(DEF)) {
    if (NUM.test(m[1]!) && !map.has(m[1]!)) map.set(m[1]!, String(++next));
  }
  let out = '';
  let last = 0;
  for (const m of masked.matchAll(REF)) {
    const to = map.get(m[1]!);
    if (to === undefined || to === m[1]) continue;
    out += `${src.slice(last, m.index)}[^${to}]`;
    last = m.index + m[0].length;
  }
  return out + src.slice(last);
}

/**
 * Inserts a reference at `offset` and its definition in reading order, then renumbers.
 * With `from`, the text from there to `offset` is wrapped in <mark> so it shows highlighted.
 */
export function addFootnote(src: string, offset: number, note: string, from?: number): string {
  const masked = maskCode(src, footnoteInfo(src).codeLines);
  let max = 0;
  for (const m of masked.matchAll(REF)) if (NUM.test(m[1]!)) max = Math.max(max, Number(m[1]));
  const label = String(max + 1);
  const body = note
    .trim()
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((l, i) => (i === 0 || l.trim() === '' ? l : `    ${l}`))
    .join('\n');
  const def = `[^${label}]: ${body}`;
  const marked =
    from !== undefined && from < offset
      ? `${src.slice(0, from)}<mark>${src.slice(from, offset)}</mark>`
      : src.slice(0, offset);
  const base = (marked + `[^${label}]` + src.slice(offset)).replace(/\n*$/, '');

  // Parse with the definition appended (a reference without one is not a footnote), then
  // move it in front of the next note's definition if there is one.
  const { labels, codeLines } = footnoteInfo(`${base}\n\n${def}\n`);
  const lines = maskCode(base, codeLines).split('\n');
  for (const l of labels.slice(labels.indexOf(label) + 1)) {
    const range = l === null ? null : defLines(lines, l);
    if (!range) continue;
    const at = range[0];
    const out = base.split('\n');
    out.splice(at, 0, ...(at > 0 && out[at - 1]!.trim() === '' ? [def, ''] : [def]));
    return renumber(`${out.join('\n')}\n`);
  }
  return renumber(`${base}\n\n${def}\n`);
}

/** Removes the definition of `label` and every reference to it, then renumbers. */
export function removeFootnote(src: string, label: string): string {
  const { codeLines } = footnoteInfo(src);
  const lines = src.split('\n');
  const range = defLines(maskCode(src, codeLines).split('\n'), label);
  if (range) {
    const [a, b] = range;
    // Drop one of the blank lines around it so no double gap is left behind.
    const blankAround = a > 0 && lines[a - 1]!.trim() === '' && (b >= lines.length || lines[b]!.trim() === '');
    lines.splice(blankAround ? a - 1 : a, b - a + (blankAround ? 1 : 0));
  }
  let out = lines.join('\n');
  const masked = maskCode(out, footnoteInfo(out).codeLines);
  // Last to first, so earlier offsets stay valid. A <mark> that ends right at the
  // reference was the highlight added with it, so it goes too (its text stays).
  for (const m of [...masked.matchAll(REF)].filter((m) => m[1] === label).reverse()) {
    const at = m.index;
    out = out.slice(0, at) + out.slice(at + m[0].length);
    const open = out.lastIndexOf('<mark>', at - 7);
    if (out.slice(at - 7, at) === '</mark>' && open >= 0) {
      out = out.slice(0, open) + out.slice(open + 6, at - 7) + out.slice(at);
    }
  }
  return renumber(out);
}

/**
 * Ticks or unticks the task list item that starts on source line `line` ("- [ ] …",
 * "1. [x] …", also inside quotes). Only the one character between the brackets changes.
 * Null when that line is not a task item (the file changed since it was rendered).
 */
export function toggleTask(src: string, line: number, done: boolean): string | null {
  const lines = src.split('\n');
  const text = lines[line] ?? '';
  const m = /^([ \t>]*(?:[-*+]|\d+[.)])[ \t]+\[)[ xX]\]/.exec(text);
  if (!m) return null;
  const at = m[1]!.length;
  lines[line] = text.slice(0, at) + (done ? 'x' : ' ') + text.slice(at + 1);
  return lines.join('\n');
}

/**
 * Maps a selection in the rendered page to source offsets. The block is source lines
 * [line, lineEnd); `before` is its rendered text up to the selection and `selected` the
 * selected text. Characters are matched in order against the source, skipping markup.
 * `from` is where the selected text starts (null if it has no visible characters), `to` where
 * it ends; null when the text cannot all be found.
 */
export function sourceRange(
  src: string,
  line: number,
  lineEnd: number,
  before: string,
  selected: string,
): { from: number | null; to: number } | null {
  const lines = src.split('\n');
  const start = lines.slice(0, line).reduce((n, l) => n + l.length + 1, 0);
  const block = lines.slice(line, lineEnd).join('\n');
  // Images, link targets and HTML tags never show up as text, so they must not match.
  const visible = block.replace(
    /!\[[^\]]*\]\([^)]*\)|\]\([^)]*\)|\]\[[^\]]*\]|<\/?[A-Za-z][\w-]*(?:\s[^>]*)?\/?>/g,
    (m) => '\0'.repeat(m.length),
  );
  let i = 0;
  let from: number | null = null;
  for (const [text, inSelection] of [[before, false], [selected, true]] as const) {
    for (const ch of text) {
      if (/\s/.test(ch)) continue;
      const at = visible.indexOf(ch, i);
      if (at < 0) return null;
      if (inSelection && from === null) from = at;
      i = at + ch.length;
    }
  }
  // Start before opening markup (emphasis, code, link text) so the highlight wraps it.
  if (from !== null) {
    let k = from;
    while (k > 0 && '*_~`['.includes(block[k - 1]!)) k--;
    if (k === 0 || !/[\p{L}\p{N}]/u.test(block[k - 1]!)) from = k;
  }
  // Step past closing markup (emphasis, code, link target) so the marker lands after it.
  for (;;) {
    const rest = block.slice(i);
    const run = /^[*_~`]+/.exec(rest)?.[0];
    const tag = /^<\/[A-Za-z][\w-]*>/.exec(rest)?.[0];
    if (run && !/[\p{L}\p{N}]/u.test(block[i + run.length] ?? '')) i += run.length;
    else if (rest.startsWith('](') && rest.includes(')')) i += rest.indexOf(')') + 1;
    else if (rest.startsWith('][') && rest.indexOf(']', 1) > 0) i += rest.indexOf(']', 1) + 1;
    else if (rest.startsWith(']')) i += 1;
    else if (tag) i += tag.length;
    else break;
  }
  return { from: from === null ? null : start + from, to: start + i };
}
