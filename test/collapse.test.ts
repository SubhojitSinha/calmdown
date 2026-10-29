import { describe, expect, it } from 'vitest';
import {
  applyCollapsed,
  foldToLevel,
  readCollapsed,
  reveal,
  sectionId,
  wrapSections,
} from '../src/viewer/collapse';
import { collectHeadings } from '../src/viewer/toc';

function build(html: string) {
  const root = document.createElement('div');
  root.innerHTML = html;
  const sections = wrapSections(root);
  collectHeadings(root);
  return { root, sections };
}

describe('wrapSections', () => {
  it('nests sections by heading level and keeps intro content at the top', () => {
    const { root, sections } = build(
      '<p>intro</p><h1>A</h1><p>a</p><h2>B</h2><p>b</p><h2>C</h2><h1>D</h1><p>d</p>',
    );
    expect(sections.map(sectionId)).toEqual(['a', 'b', 'c', 'd']);
    expect(root.firstElementChild!.tagName).toBe('P');
    const [a, b, c, d] = sections as [HTMLDetailsElement, HTMLDetailsElement, HTMLDetailsElement, HTMLDetailsElement];
    expect(b.parentElement!.parentElement).toBe(a);
    expect(c.parentElement!.parentElement).toBe(a);
    expect(d.parentElement).toBe(root);
    expect(b.textContent).toContain('b');
    expect(a.textContent).toContain('a');
    expect(d.textContent).toContain('d');
    expect(a.contains(d)).toBe(false);
  });

  it('copes with skipped levels (h1, h3, then h2)', () => {
    const { sections } = build('<h1>A</h1><h3>B</h3><h2>C</h2>');
    const [a, b, c] = sections as [HTMLDetailsElement, HTMLDetailsElement, HTMLDetailsElement];
    expect(a.contains(b)).toBe(true);
    expect(a.contains(c)).toBe(true);
    expect(b.contains(c)).toBe(false);
  });

  it('puts the heading inside the summary so it stays clickable', () => {
    const { sections } = build('<h2>Only</h2><p>text</p>');
    const summary = sections[0]!.firstElementChild!;
    expect(summary.tagName).toBe('SUMMARY');
    expect(summary.firstElementChild!.tagName).toBe('H2');
  });

  it('moves footnotes out of the last section into one closed block', () => {
    const { root, sections } = build(
      '<h1>A</h1><p>x</p><hr class="footnotes-sep"><section class="footnotes"><ol class="footnotes-list"><li id="fn1">n</li><li id="fn2">m</li></ol></section>',
    );
    const block = root.querySelector('details.footnotes-block') as HTMLDetailsElement;
    expect(block.open).toBe(false);
    expect(block.firstElementChild!.textContent).toBe('Footnotes (2)');
    expect(block.parentElement).toBe(root);
    expect(sections[0]!.contains(block)).toBe(false);
  });

  it('does nothing special for a document with no headings', () => {
    const { root, sections } = build('<p>one</p><p>two</p>');
    expect(sections).toHaveLength(0);
    expect(root.querySelectorAll('details')).toHaveLength(0);
    expect(root.querySelectorAll('p')).toHaveLength(2);
  });
});

describe('folding', () => {
  const html = '<h1>A</h1><h2>B</h2><h3>C</h3><h1>D</h1>';

  it('reads and applies collapsed ids', () => {
    const { sections } = build(html);
    applyCollapsed(sections, new Set(['b', 'ghost']));
    expect(sections.map((s) => s.open)).toEqual([true, false, true, true]);
    expect([...readCollapsed(sections)]).toEqual(['b']);
  });

  it('foldToLevel opens only sections above the level', () => {
    const { sections } = build(html);
    foldToLevel(sections, 2);
    expect(sections.map((s) => s.open)).toEqual([true, false, false, true]);
    foldToLevel(sections, 1);
    expect(sections.every((s) => !s.open)).toBe(true);
    foldToLevel(sections, Infinity);
    expect(sections.every((s) => s.open)).toBe(true);
  });

  it('reveal opens every closed ancestor, including the target heading section', () => {
    const { root, sections } = build(html);
    foldToLevel(sections, 1);
    reveal(root.querySelector('#c'));
    expect(sections.map((s) => s.open)).toEqual([true, true, true, false]);
  });
});
