// Folds a rendered document into nested <details> sections: every heading plus the
// content up to the next heading of the same or higher level.

const HEADING_TAG = /^H[1-6]$/;

function isFootnoteNode(n: Node): n is HTMLElement {
  return (
    n instanceof HTMLElement &&
    (n.classList.contains('footnotes') || n.classList.contains('footnotes-sep'))
  );
}

/**
 * Wraps the direct children of `root`. Returns the heading sections in document order.
 * Footnotes stay at the top level, inside one closed "Footnotes (n)" block.
 * Call before collectHeadings so heading ids exist when state is applied.
 */
export function wrapSections(root: HTMLElement): HTMLDetailsElement[] {
  const nodes = Array.from(root.childNodes);
  root.replaceChildren();

  const sections: HTMLDetailsElement[] = [];
  const stack: { level: number; body: HTMLElement }[] = [];
  const footnoteNodes: HTMLElement[] = [];

  for (const node of nodes) {
    if (isFootnoteNode(node)) {
      footnoteNodes.push(node);
      continue;
    }
    if (node instanceof HTMLElement && HEADING_TAG.test(node.tagName)) {
      const level = Number(node.tagName.slice(1));
      while (stack.length > 0 && stack[stack.length - 1]!.level >= level) stack.pop();

      const details = document.createElement('details');
      details.className = 'section';
      details.open = true;
      details.dataset.level = String(level);
      const summary = document.createElement('summary');
      summary.append(node);
      const body = document.createElement('div');
      body.className = 'section-body';
      details.append(summary, body);

      (stack.length > 0 ? stack[stack.length - 1]!.body : root).append(details);
      stack.push({ level, body });
      sections.push(details);
      continue;
    }
    (stack.length > 0 ? stack[stack.length - 1]!.body : root).append(node);
  }

  if (footnoteNodes.length > 0) {
    const count = footnoteNodes.reduce(
      (n, el) => n + el.querySelectorAll('ol.footnotes-list > li').length,
      0,
    );
    const block = document.createElement('details');
    block.className = 'footnotes-block';
    const summary = document.createElement('summary');
    summary.textContent = `Footnotes (${count})`;
    block.append(summary, ...footnoteNodes);
    root.append(block);
  }
  return sections;
}

export function headingOf(section: HTMLDetailsElement): HTMLElement | null {
  const first = section.firstElementChild?.firstElementChild;
  return first instanceof HTMLElement ? first : null;
}

export function sectionId(section: HTMLDetailsElement): string {
  return headingOf(section)?.id ?? '';
}

export function sectionLevel(section: HTMLDetailsElement): number {
  return Number(section.dataset.level ?? '1');
}

/** Ids of the sections that are currently closed. */
export function readCollapsed(sections: HTMLDetailsElement[]): Set<string> {
  const out = new Set<string>();
  for (const s of sections) {
    const id = sectionId(s);
    if (id && !s.open) out.add(id);
  }
  return out;
}

export function applyCollapsed(sections: HTMLDetailsElement[], collapsed: Set<string>): void {
  for (const s of sections) s.open = !collapsed.has(sectionId(s));
}

/**
 * Opens sections above `level` and closes the rest.
 * Infinity opens everything. 1 closes everything. 2 shows H1 contents and H2 headings.
 */
export function foldToLevel(sections: HTMLDetailsElement[], level: number): void {
  for (const s of sections) s.open = sectionLevel(s) < level;
}

/** Opens every closed section around `el` so it is visible, including its own section. */
export function reveal(el: Element | null): void {
  for (let p = el?.parentElement ?? null; p; p = p.parentElement) {
    if (p instanceof HTMLDetailsElement) p.open = true;
  }
}
