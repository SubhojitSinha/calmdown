import { describe, expect, it } from 'vitest';
import { addFootnote, removeFootnote, renumber, sourceRange, toggleTask } from '../src/editor/footnote-source';
import { renderMarkdown } from '../src/render/render';

const after = (src: string, text: string) => src.indexOf(text) + text.length;

describe('addFootnote', () => {
  it('adds note 1 to a file without footnotes', () => {
    const src = 'Hello world.\n';
    expect(addFootnote(src, after(src, 'Hello'), 'A note.')).toBe('Hello[^1] world.\n\n[^1]: A note.\n');
  });

  it('numbers in reading order and keeps definitions in that order', () => {
    const src = 'One[^1] two three[^2].\n\n[^1]: First.\n\n[^2]: Second.\n';
    expect(addFootnote(src, after(src, 'two'), 'Middle.')).toBe(
      'One[^1] two[^2] three[^3].\n\n[^1]: First.\n\n[^2]: Middle.\n\n[^3]: Second.\n',
    );
  });

  it('indents a multi-line note so it stays one definition', () => {
    const src = 'Text.\n';
    expect(addFootnote(src, 4, 'Line one\nline two\n\nPara two')).toBe(
      'Text[^1].\n\n[^1]: Line one\n    line two\n\n    Para two\n',
    );
  });

  it('leaves named labels and footnote syntax inside code alone', () => {
    const src = 'A[^note] and `[^1]` b.\n\n```\n[^1]\n```\n\n[^note]: Named.\n';
    const out = addFootnote(src, after(src, 'b'), 'New.');
    expect(out).toContain('`[^1]` b[^2].');
    expect(out).toContain('```\n[^1]\n```');
    expect(out).toContain('[^note]: Named.');
    expect(out).toContain('[^2]: New.');
  });
});

describe('removeFootnote', () => {
  it('removes the reference and definition and renumbers the rest', () => {
    const src = 'A[^1] b[^2] c[^3].\n\n[^1]: One.\n\n[^2]: Two.\n\n[^3]: Three.\n';
    expect(removeFootnote(src, '2')).toBe('A[^1] b c[^2].\n\n[^1]: One.\n\n[^2]: Three.\n');
  });

  it('removes a multi-line definition and every reference to it', () => {
    const src = 'A[^1] b[^1].\n\n[^1]: Line\n    more\n\nAfter.\n';
    expect(removeFootnote(src, '1')).toBe('A b.\n\nAfter.\n');
  });
});

describe('toggleTask', () => {
  const src = '# Plan\n\n- [ ] first\n  1. [x] nested step\n> - [ ] quoted\n- plain item\n';

  it('changes only the box on that line', () => {
    expect(toggleTask(src, 2, true)).toBe(src.replace('- [ ] first', '- [x] first'));
    expect(toggleTask(src, 3, false)).toBe(src.replace('1. [x] nested', '1. [ ] nested'));
    expect(toggleTask(src, 4, true)).toBe(src.replace('> - [ ] quoted', '> - [x] quoted'));
  });

  it('refuses a line that is not a task', () => {
    expect(toggleTask(src, 5, true)).toBeNull();
    expect(toggleTask(src, 0, true)).toBeNull();
    expect(toggleTask(src, 99, true)).toBeNull();
  });

  it('finds the line from the rendered checkbox', () => {
    const root = document.createElement('div');
    root.innerHTML = renderMarkdown(src);
    const boxes = [...root.querySelectorAll<HTMLInputElement>('input.task-list-item-checkbox')];
    expect(boxes.map((b) => b.checked)).toEqual([false, true, false]);
    expect(root.querySelector('label')).toBeNull(); // only the box toggles, not the text
    const lines = boxes.map((b) => Number(b.closest<HTMLElement>('li[data-line]')!.dataset.line));
    expect(lines).toEqual([2, 3, 4]);
  });
});

describe('renumber', () => {
  it('rewrites numeric labels to match the shown numbers', () => {
    const src = 'A[^7] b[^3].\n\n[^3]: Three.\n[^7]: Seven.\n';
    expect(renumber(src)).toBe('A[^1] b[^2].\n\n[^2]: Three.\n[^1]: Seven.\n');
  });
});

describe('highlight', () => {
  it('wraps the selected text in <mark> and removes it with the footnote', () => {
    const src = 'Keep this part here.\n';
    const added = addFootnote(src, after(src, 'this part'), 'Why.', src.indexOf('this'));
    expect(added).toBe('Keep <mark>this part</mark>[^1] here.\n\n[^1]: Why.\n');
    expect(removeFootnote(added, '1')).toBe(src);
  });

  it('leaves a <mark> the user wrote that is not tied to the footnote', () => {
    const src = '<mark>mine</mark> and text[^1].\n\n[^1]: N.\n';
    expect(removeFootnote(src, '1')).toBe('<mark>mine</mark> and text.\n');
  });
});

describe('sourceRange', () => {
  const src = 'Intro.\n\nSome **bold** and a [link](https://example.com/x) and `code` here.\n';

  it('skips emphasis, links and code markup at the end', () => {
    expect(sourceRange(src, 2, 3, '', 'Some bold')!.to).toBe(after(src, '**bold**'));
    expect(sourceRange(src, 2, 3, '', 'Some bold and a link')!.to).toBe(after(src, '(https://example.com/x)'));
    expect(sourceRange(src, 2, 3, '', 'Some bold and a link and code')!.to).toBe(after(src, '`code`'));
  });

  it('starts before opening markup so the highlight wraps it', () => {
    const r = sourceRange(src, 2, 3, 'Some ', 'bold')!;
    expect(src.slice(r.from!, r.to)).toBe('**bold**');
    const l = sourceRange(src, 2, 3, 'Some bold and a ', 'link')!;
    expect(src.slice(l.from!, l.to)).toBe('[link](https://example.com/x)');
  });

  it('does not break a word joined by an underscore', () => {
    expect(sourceRange('snake_case word\n', 0, 1, '', 'snake')!.to).toBe(5);
  });

  it('returns null when the text cannot be matched', () => {
    expect(sourceRange('abc\n', 0, 1, '', 'xyz')).toBeNull();
  });

  it('maps a selection in the rendered page back to the source', () => {
    const md = '# Title\n\n- item one\n- item *two* end\n';
    const root = document.createElement('div');
    root.innerHTML = renderMarkdown(md);
    const em = root.querySelector('em')!;
    const block = em.closest<HTMLElement>('[data-line]')!;
    const before = document.createRange();
    before.setStart(block, 0);
    before.setEnd(em.firstChild!, 0);
    const r = sourceRange(md, Number(block.dataset.line), Number(block.dataset.lineEnd), before.toString(), 'two')!;
    expect(md.slice(r.from!, r.to)).toBe('*two*');
    expect(addFootnote(md, r.to, 'N.', r.from!)).toContain('- item <mark>*two*</mark>[^1] end');
  });
});
