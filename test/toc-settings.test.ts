import { describe, expect, it } from 'vitest';
import { collectHeadings, renderToc, slugify } from '../src/viewer/toc';
import { clampSettings, DEFAULTS } from '../src/state/settings';
import { detectEol } from '../src/files/file-layer';

describe('toc', () => {
  it('slugifies and de-duplicates heading ids', () => {
    const root = document.createElement('div');
    root.innerHTML = '<h2>Setup</h2><h2>Setup</h2><h3>Café & Tea!</h3>';
    const ids = collectHeadings(root).map((e) => e.id);
    expect(ids).toEqual(['setup', 'setup-1', 'café-tea']);
    expect(slugify('')).toBe('section');
  });

  it('nests entries and tolerates skipped levels', () => {
    const root = document.createElement('div');
    root.innerHTML = '<h1>A</h1><h3>B</h3><h2>C</h2><h1>D</h1>';
    const entries = collectHeadings(root);
    const toc = document.createElement('nav');
    renderToc(toc, entries);
    expect(toc.querySelectorAll('a')).toHaveLength(4);
    const top = toc.querySelector('ul')!;
    expect(top.children).toHaveLength(2); // A and D at the top
    expect(top.children[0]!.querySelectorAll('li')).toHaveLength(2); // B and C under A
  });

  it('shows a placeholder when there are no headings', () => {
    const toc = document.createElement('nav');
    renderToc(toc, []);
    expect(toc.textContent).toBe('No headings');
  });
});

describe('settings', () => {
  it('clamps out of range values and rejects unknown themes', () => {
    const s = clampSettings({ theme: 'neon' as never, fontSize: 999, width: 1 });
    expect(s.theme).toBe(DEFAULTS.theme);
    expect(s.fontSize).toBe(26);
    expect(s.width).toBe(560);
  });

  it('shows the index by default and only accepts plain font family names', () => {
    expect(clampSettings({}).showToc).toBe(true);
    expect(clampSettings({ showToc: false }).showToc).toBe(false);
    expect(clampSettings({ font: '  Source  Serif 4 ' }).font).toBe('Source Serif 4');
    expect(clampSettings({ font: 'Inter&family=Evil' }).font).toBe('');
    expect(clampSettings({ font: "x'); color: red" }).font).toBe('');
  });

  it('accepts the new themes, a hex highlight colour and the line-number switch', () => {
    expect(clampSettings({ theme: 'dracula-light' }).theme).toBe('dracula-light');
    expect(clampSettings({ theme: 'monokai' }).theme).toBe('monokai');
    expect(clampSettings({ markColor: '#A1B2C3' }).markColor).toBe('#A1B2C3');
    expect(clampSettings({ markColor: 'red; x' }).markColor).toBe(DEFAULTS.markColor);
    expect(clampSettings({}).lineNumbers).toBe(true);
    expect(clampSettings({ lineNumbers: false }).lineNumbers).toBe(false);
  });

  it('keeps focus mode settings valid, and remembers focus only when asked to', () => {
    expect(clampSettings({})).toMatchObject({ focusUnit: 'section', focusFade: 0.78, focusKeep: false, focusActive: false });
    expect(clampSettings({ focusUnit: 'word' as never, focusFade: 2 })).toMatchObject({ focusUnit: 'section', focusFade: 0.95 });
    expect(clampSettings({ focusUnit: 'paragraph' }).focusUnit).toBe('paragraph');
    expect(clampSettings({ focusKeep: false, focusActive: true }).focusActive).toBe(false);
    expect(clampSettings({ focusKeep: true, focusActive: true }).focusActive).toBe(true);
  });

  it('keeps text style values in range and colours as hex or theme', () => {
    const s = clampSettings({ lineHeight: 9, letterSpacing: -1, paraSpacing: Number.NaN, headingFont: 'Lora', boldColor: 'blue' });
    expect(s.lineHeight).toBe(2.4);
    expect(s.letterSpacing).toBe(0);
    expect(s.paraSpacing).toBe(DEFAULTS.paraSpacing);
    expect(s.headingFont).toBe('Lora');
    expect(s.boldColor).toBe('');
    expect(clampSettings({ headingColor: '#123abc' }).headingColor).toBe('#123abc');
    expect(clampSettings({}).codeBg).toBe('');
    expect(clampSettings({ codeBg: '#202020', codeFg: 'url(x)' })).toMatchObject({ codeBg: '#202020', codeFg: '' });
  });
});

describe('eol detection', () => {
  it('picks the dominant line ending', () => {
    expect(detectEol('a\r\nb\r\nc\n')).toBe('\r\n');
    expect(detectEol('a\nb\nc\r\n')).toBe('\n');
    expect(detectEol('single line')).toBe('\n');
  });
});

describe('change stamp', () => {
  it('differs when only the size changes under an identical mtime', async () => {
    const { stampOf } = await import('../src/files/file-layer');
    expect(stampOf({ lastModified: 5, size: 10 })).not.toBe(stampOf({ lastModified: 5, size: 11 }));
    expect(stampOf({ lastModified: 5, size: 10 })).toBe(stampOf({ lastModified: 5, size: 10 }));
  });
});
