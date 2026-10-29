// Footnote popovers. Hover or keyboard focus previews a note, a click pins it.
// The popover lives in a Shadow DOM root so document styles never leak in or out, and its
// content is cloned from the already sanitized footnote list (no HTML strings are parsed).

const REF = '.footnote-ref a';
const HOVER_OPEN_MS = 150;
const HOVER_CLOSE_MS = 250;

export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** Below the anchor if it fits, otherwise above, always clamped inside the viewport. */
export function placePopover(
  anchor: Box,
  size: { width: number; height: number },
  viewport: { width: number; height: number },
  gap = 8,
  margin = 8,
): { left: number; top: number; placement: 'below' | 'above' } {
  const left = Math.max(margin, Math.min(anchor.left, viewport.width - size.width - margin));
  const below = anchor.bottom + gap;
  const above = anchor.top - gap - size.height;
  const fitsBelow = below + size.height <= viewport.height - margin;
  if (fitsBelow || above < margin) {
    const top = Math.max(margin, Math.min(below, viewport.height - size.height - margin));
    return { left, top, placement: 'below' };
  }
  return { left, top: above, placement: 'above' };
}

const STYLE = `
  .pop {
    position: fixed; z-index: 50; left: 0; top: 0;
    box-sizing: border-box;
    max-width: min(420px, calc(100vw - 16px));
    max-height: 40vh; overflow: auto;
    padding: 8px 14px;
    background: var(--surface, #fff); color: var(--fg, #111);
    border: 1px solid var(--border, #ccc); border-radius: 8px;
    box-shadow: 0 6px 24px rgba(0, 0, 0, 0.2);
    font: calc(var(--font-size, 17px) * 0.85)/1.5 system-ui, sans-serif;
    overflow-wrap: anywhere;
  }
  .pop[hidden] { display: none; }
  .pop:focus-visible { outline: 2px solid var(--accent, #0969da); outline-offset: 1px; }
  .pop[data-pinned='true'] { border-color: var(--accent, #0969da); }
  a { color: var(--accent, #0969da); }
  p { margin: 0.4em 0; }
  code { font: 0.9em ui-monospace, Menlo, Consolas, monospace; background: var(--code-bg, #eee); padding: 0.1em 0.3em; border-radius: 4px; }
  button {
    font: 13px system-ui, sans-serif; color: var(--fg, #111); background: var(--bg, #fff);
    border: 1px solid var(--border, #ccc); border-radius: 6px; padding: 3px 10px; cursor: pointer;
  }
  button:hover:not(:disabled) { border-color: var(--accent, #0969da); }
  button:focus-visible { outline: 2px solid var(--accent, #0969da); outline-offset: 2px; }
  .pop:has(.remove) { padding-right: 32px; }
  .remove {
    position: absolute; top: 4px; right: 4px;
    width: 22px; height: 22px; padding: 0; line-height: 1;
    font-size: 15px; color: var(--muted, #666); border-color: transparent; background: none;
  }
  .remove:hover:not(:disabled) { color: var(--fg, #111); }
`;

export interface FootnotePopovers {
  close(): void;
  destroy(): void;
}

/**
 * `onRemove` adds a Remove button to the popover; it gets the note's number as shown.
 * `canRemove` hides the button while it returns false (a read-only document).
 */
export function initFootnotes(
  root: HTMLElement,
  { onRemove, canRemove }: { onRemove?: (n: number) => void; canRemove?: () => boolean } = {},
): FootnotePopovers {
  const host = document.createElement('div');
  host.id = 'footnote-popover-host';
  const shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = STYLE;
  const pop = document.createElement('div');
  pop.className = 'pop';
  pop.setAttribute('role', 'dialog');
  pop.setAttribute('aria-label', 'Footnote');
  pop.tabIndex = -1;
  pop.hidden = true;
  shadow.append(style, pop);
  document.body.append(host);

  const ac = new AbortController();
  const opts = { signal: ac.signal };
  let current: HTMLAnchorElement | null = null;
  let pinned = false;
  // Returning focus to the reference after closing must not re-open its preview.
  let restoringFocus = false;
  let openTimer: ReturnType<typeof setTimeout> | undefined;
  let closeTimer: ReturnType<typeof setTimeout> | undefined;

  const refFrom = (t: EventTarget | null): HTMLAnchorElement | null =>
    t instanceof Element ? (t.closest(REF) as HTMLAnchorElement | null) : null;

  function definitionFor(a: HTMLAnchorElement): HTMLElement | null {
    const hash = a.getAttribute('href') ?? '';
    if (!hash.startsWith('#')) return null;
    let id = hash.slice(1);
    try {
      id = decodeURIComponent(id);
    } catch {
      /* keep the raw id */
    }
    const el = document.getElementById(id);
    return el && root.contains(el) ? el : null;
  }

  function fill(li: HTMLElement, a: HTMLAnchorElement): void {
    const clone = li.cloneNode(true) as HTMLElement;
    clone.querySelectorAll('.footnote-backref').forEach((n) => n.remove());
    clone.querySelectorAll('[id]').forEach((n) => n.removeAttribute('id'));
    pop.replaceChildren(...Array.from(clone.childNodes));
    const n = Number(/^#fn(\d+)$/.exec(a.getAttribute('href') ?? '')?.[1]);
    if (onRemove && n > 0 && canRemove?.() !== false) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'remove';
      b.textContent = '×';
      b.title = 'Remove footnote';
      b.setAttribute('aria-label', `Remove footnote ${n}`);
      b.addEventListener('click', () => {
        close();
        onRemove(n);
      });
      pop.append(b);
    }
  }

  function position(a: HTMLAnchorElement): void {
    pop.style.left = '0px';
    pop.style.top = '0px';
    const spot = placePopover(
      a.getBoundingClientRect(),
      { width: pop.offsetWidth, height: pop.offsetHeight },
      { width: window.innerWidth, height: window.innerHeight },
    );
    pop.style.left = `${spot.left}px`;
    pop.style.top = `${spot.top}px`;
    pop.dataset.placement = spot.placement;
  }

  function open(a: HTMLAnchorElement, pin: boolean): void {
    const li = definitionFor(a);
    if (!li) return;
    clearTimeout(openTimer);
    clearTimeout(closeTimer);
    // Hovering another reference never replaces a note the reader pinned.
    if (pinned && current && current !== a && !pin) return;
    if (current !== a) {
      current?.setAttribute('aria-expanded', 'false');
      fill(li, a);
    }
    const keepPinned = pinned && current === a;
    current = a;
    pinned = pin || keepPinned;
    a.setAttribute('aria-haspopup', 'dialog');
    a.setAttribute('aria-expanded', 'true');
    pop.dataset.pinned = String(pinned);
    pop.hidden = false;
    position(a);
  }

  function close(returnFocus = false): void {
    clearTimeout(openTimer);
    clearTimeout(closeTimer);
    const a = current;
    current = null;
    pinned = false;
    pop.hidden = true;
    if (a) {
      a.setAttribute('aria-expanded', 'false');
      if (returnFocus && a.isConnected) {
        restoringFocus = true;
        a.focus({ preventScroll: true });
        restoringFocus = false;
      }
    }
  }

  function scheduleClose(): void {
    if (pinned) return;
    clearTimeout(closeTimer);
    closeTimer = setTimeout(() => {
      if (!pinned) close();
    }, HOVER_CLOSE_MS);
  }

  root.addEventListener(
    'mouseover',
    (e) => {
      const a = refFrom(e.target);
      if (!a) return;
      clearTimeout(closeTimer);
      if (current === a) return;
      clearTimeout(openTimer);
      openTimer = setTimeout(() => open(a, false), HOVER_OPEN_MS);
    },
    opts,
  );
  root.addEventListener(
    'mouseout',
    (e) => {
      if (!refFrom(e.target)) return;
      clearTimeout(openTimer);
      scheduleClose();
    },
    opts,
  );
  // The pointer may travel from the reference to the popover to click a link inside it.
  host.addEventListener('mouseenter', () => clearTimeout(closeTimer), opts);
  host.addEventListener('mouseleave', scheduleClose, opts);

  root.addEventListener(
    'click',
    (e) => {
      const a = refFrom(e.target);
      if (!a || !definitionFor(a)) return;
      e.preventDefault();
      if (pinned && current === a) {
        close(true);
        return;
      }
      open(a, true);
      pop.focus({ preventScroll: true });
    },
    opts,
  );
  root.addEventListener(
    'focusin',
    (e) => {
      const a = refFrom(e.target);
      if (a && !restoringFocus) open(a, false);
    },
    opts,
  );
  root.addEventListener(
    'focusout',
    (e) => {
      if (refFrom(e.target)) scheduleClose();
    },
    opts,
  );

  document.addEventListener(
    'keydown',
    (e) => {
      if (e.key === 'Escape' && current) close(pinned);
    },
    opts,
  );
  document.addEventListener(
    'click',
    (e) => {
      if (!pinned) return;
      if (e.composedPath().includes(host) || refFrom(e.target)) return;
      close();
    },
    opts,
  );
  const reposition = () => {
    if (!current) return;
    if (pinned) position(current);
    else close();
  };
  window.addEventListener('scroll', reposition, { ...opts, passive: true });
  window.addEventListener('resize', reposition, opts);

  return {
    close: () => close(),
    destroy: () => {
      ac.abort();
      clearTimeout(openTimer);
      clearTimeout(closeTimer);
      host.remove();
    },
  };
}

const ADDER_STYLE = `
  .add { position: fixed; z-index: 60; left: 0; top: 0; color: var(--accent, #0969da); border-color: var(--accent, #0969da); box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2); }
  .add[hidden] { display: none; }
  textarea {
    display: block; box-sizing: border-box; width: min(380px, calc(100vw - 48px)); margin: 4px 0;
    font: 13px/1.5 ui-monospace, Menlo, Consolas, monospace; color: var(--fg, #111); background: var(--bg, #fff);
    border: 1px solid var(--border, #ccc); border-radius: 6px; padding: 6px 8px; resize: vertical;
  }
  .error { color: #d1242f; margin: 4px 0; }
  .actions { display: flex; justify-content: flex-end; gap: 8px; margin: 6px 0 4px; }
`;

export interface FootnoteAdder {
  destroy(): void;
}

/**
 * Select text, click the button that appears, write a note, save. `accepts` decides where the
 * button may appear; `onSave` returns an error to show in the box, or null once the note is added.
 */
export function initFootnoteAdder(opts: {
  accepts(range: Range): boolean;
  onSave(range: Range, note: string): Promise<string | null>;
}): FootnoteAdder {
  const host = document.createElement('div');
  host.id = 'footnote-adder-host';
  const shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = STYLE + ADDER_STYLE;

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'add';
  button.textContent = '+ Footnote';
  button.hidden = true;

  const box = document.createElement('div');
  box.className = 'pop';
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-label', 'Add footnote');
  box.hidden = true;
  const area = document.createElement('textarea');
  area.rows = 4;
  area.placeholder = 'Footnote text (Markdown). Ctrl+Enter to save.';
  area.setAttribute('aria-label', 'Footnote text');
  const error = document.createElement('p');
  error.className = 'error';
  error.setAttribute('role', 'alert');
  error.hidden = true;
  const save = document.createElement('button');
  save.type = 'button';
  save.textContent = 'Save';
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.textContent = 'Cancel';
  const actions = document.createElement('div');
  actions.className = 'actions';
  actions.append(cancel, save);
  box.append(area, error, actions);
  shadow.append(style, button, box);
  document.body.append(host);

  const ac = new AbortController();
  const signal = ac.signal;
  let range: Range | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;

  function place(el: HTMLElement, r: Range): void {
    const rects = r.getClientRects();
    const anchor = rects[rects.length - 1] ?? r.getBoundingClientRect();
    el.hidden = false;
    el.style.left = '0px';
    el.style.top = '0px';
    const spot = placePopover(
      anchor,
      { width: el.offsetWidth, height: el.offsetHeight },
      { width: window.innerWidth, height: window.innerHeight },
      4,
    );
    el.style.left = `${spot.left}px`;
    el.style.top = `${spot.top}px`;
  }

  function check(): void {
    if (!box.hidden) return;
    const sel = document.getSelection();
    const r = sel && sel.rangeCount > 0 && !sel.isCollapsed ? sel.getRangeAt(0) : null;
    if (!r || !opts.accepts(r)) {
      button.hidden = true;
      range = null;
      return;
    }
    range = r.cloneRange();
    place(button, r);
  }

  function close(): void {
    box.hidden = true;
    range = null;
  }

  function showError(msg: string): void {
    error.textContent = msg;
    error.hidden = false;
  }

  async function submit(): Promise<void> {
    if (!range) return close();
    if (!area.value.trim()) return showError('Write the note first.');
    save.disabled = true;
    try {
      const err = await opts.onSave(range, area.value);
      if (err) showError(err);
      else close();
    } finally {
      save.disabled = false;
    }
  }

  document.addEventListener(
    'selectionchange',
    () => {
      clearTimeout(timer);
      timer = setTimeout(check, 150);
    },
    { signal },
  );
  // Keep the page selection when the button is pressed.
  button.addEventListener('mousedown', (e) => e.preventDefault(), { signal });
  button.addEventListener(
    'click',
    () => {
      if (!range) return;
      button.hidden = true;
      area.value = '';
      error.hidden = true;
      place(box, range);
      area.focus();
    },
    { signal },
  );
  save.addEventListener('click', () => void submit(), { signal });
  cancel.addEventListener('click', close, { signal });
  box.addEventListener(
    'keydown',
    (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close();
      } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        void submit();
      }
    },
    { signal },
  );
  window.addEventListener('scroll', () => button.hidden || check(), { signal, passive: true });

  return {
    destroy: () => {
      ac.abort();
      clearTimeout(timer);
      host.remove();
    },
  };
}
