import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderMarkdown } from '../src/render/render';
import { initFootnotes, placePopover, type FootnotePopovers } from '../src/viewer/footnotes';

let root: HTMLElement;
let ctl: FootnotePopovers;

const pop = () => document.getElementById('footnote-popover-host')!.shadowRoot!.querySelector('.pop') as HTMLElement;
const ref = () => root.querySelector('.footnote-ref a') as HTMLAnchorElement;

beforeEach(() => {
  vi.useFakeTimers();
  root = document.createElement('article');
  root.innerHTML = renderMarkdown('Text[^1] and more[^2]\n\n[^1]: the **first** note with [a link](https://example.com)\n[^2]: second note');
  document.body.append(root);
  ctl = initFootnotes(root);
});
afterEach(() => {
  ctl.destroy();
  root.remove();
  vi.useRealTimers();
});

describe('footnote popovers', () => {
  it('starts hidden', () => {
    expect(pop().hidden).toBe(true);
  });

  it('opens on click, pinned, with the note content and no back-reference', () => {
    const e = new MouseEvent('click', { bubbles: true, cancelable: true });
    ref().dispatchEvent(e);
    expect(e.defaultPrevented).toBe(true); // no jump to the footnote list
    expect(pop().hidden).toBe(false);
    expect(pop().dataset.pinned).toBe('true');
    expect(pop().textContent).toContain('the first note with');
    expect(pop().querySelector('strong')).not.toBeNull();
    expect(pop().querySelector('a')!.getAttribute('href')).toBe('https://example.com');
    expect(pop().textContent).not.toContain('↩');
    expect(pop().querySelector('[id]')).toBeNull(); // no duplicate ids from the clone
    expect(ref().getAttribute('aria-expanded')).toBe('true');
  });

  it('previews on hover after a short delay and closes after the pointer leaves', () => {
    ref().dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    expect(pop().hidden).toBe(true);
    vi.advanceTimersByTime(200);
    expect(pop().hidden).toBe(false);
    expect(pop().dataset.pinned).toBe('false');
    ref().dispatchEvent(new MouseEvent('mouseout', { bubbles: true }));
    vi.advanceTimersByTime(100);
    expect(pop().hidden).toBe(false); // grace period lets the pointer reach the popover
    vi.advanceTimersByTime(300);
    expect(pop().hidden).toBe(true);
  });

  it('stays open while the pointer is over the popover', () => {
    ref().dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    vi.advanceTimersByTime(200);
    ref().dispatchEvent(new MouseEvent('mouseout', { bubbles: true }));
    document.getElementById('footnote-popover-host')!.dispatchEvent(new MouseEvent('mouseenter'));
    vi.advanceTimersByTime(1000);
    expect(pop().hidden).toBe(false);
  });

  it('opens on keyboard focus and closes on Escape', () => {
    ref().dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    expect(pop().hidden).toBe(false);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(pop().hidden).toBe(true);
    expect(ref().getAttribute('aria-expanded')).toBe('false');
  });

  it('a second click on the same reference unpins it', () => {
    ref().click();
    expect(pop().hidden).toBe(false);
    ref().click();
    expect(pop().hidden).toBe(true);
  });

  it('stays closed after Escape on a pinned note, even though focus returns to the reference', () => {
    ref().click();
    ref().focus();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(pop().hidden).toBe(true);
    expect(document.activeElement).toBe(ref());
  });

  it('hovering another reference does not replace a pinned note', () => {
    ref().click();
    const second = root.querySelectorAll('.footnote-ref a')[1]!;
    second.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    vi.advanceTimersByTime(400);
    expect(pop().textContent).toContain('first note');
    expect(pop().textContent).not.toContain('second note');
    second.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(pop().textContent).toContain('second note'); // clicking switches the pin
  });

  it('closes a pinned note when clicking elsewhere', () => {
    ref().click();
    document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(pop().hidden).toBe(true);
  });

  it('ignores references that have no definition', () => {
    root.innerHTML = '<p><sup class="footnote-ref"><a href="#fn-missing">[9]</a></sup></p>';
    const e = new MouseEvent('click', { bubbles: true, cancelable: true });
    ref().dispatchEvent(e);
    expect(pop().hidden).toBe(true);
    expect(e.defaultPrevented).toBe(false);
  });
});

describe('placePopover', () => {
  const vp = { width: 1000, height: 700 };
  const size = { width: 300, height: 120 };

  it('goes below the anchor when it fits', () => {
    const r = placePopover({ left: 100, top: 100, right: 120, bottom: 118 }, size, vp);
    expect(r).toEqual({ left: 100, top: 126, placement: 'below' });
  });

  it('flips above near the bottom edge', () => {
    const r = placePopover({ left: 100, top: 640, right: 120, bottom: 658 }, size, vp);
    expect(r.placement).toBe('above');
    expect(r.top).toBe(640 - 8 - 120);
  });

  it('clamps horizontally inside the viewport', () => {
    expect(placePopover({ left: 950, top: 100, right: 970, bottom: 118 }, size, vp).left).toBe(692);
    expect(placePopover({ left: -40, top: 100, right: -20, bottom: 118 }, size, vp).left).toBe(8);
  });

  it('stays on screen when neither side has room', () => {
    const r = placePopover({ left: 100, top: 40, right: 120, bottom: 58 }, { width: 300, height: 680 }, vp);
    expect(r.top).toBeGreaterThanOrEqual(8);
    expect(r.top + 680).toBeLessThanOrEqual(700 - 8 + 0.0001);
  });
});
