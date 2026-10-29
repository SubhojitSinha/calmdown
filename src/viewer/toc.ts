export interface TocEntry {
  id: string;
  text: string;
  level: number;
  el: HTMLElement;
}

export function slugify(text: string): string {
  const s = text
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s+/g, '-');
  return s || 'section';
}

/** Gives every heading a stable, unique id and returns them in document order. */
export function collectHeadings(root: HTMLElement): TocEntry[] {
  const used = new Map<string, number>();
  const out: TocEntry[] = [];
  root.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6').forEach((el) => {
    const text = (el.textContent ?? '').trim();
    const base = slugify(text);
    const n = used.get(base) ?? 0;
    used.set(base, n + 1);
    el.id = n === 0 ? base : `${base}-${n}`;
    out.push({ id: el.id, text, level: Number(el.tagName.slice(1)), el });
  });
  return out;
}

/** Renders a nested list. Levels may skip (h1 to h3); the nesting follows the stack. */
export function renderToc(container: HTMLElement, entries: TocEntry[]): void {
  container.replaceChildren();
  if (entries.length === 0) {
    const p = document.createElement('p');
    p.className = 'toc-empty';
    p.textContent = 'No headings';
    container.append(p);
    return;
  }
  const root = document.createElement('ul');
  const stack: { level: number; ul: HTMLUListElement }[] = [{ level: 0, ul: root }];
  for (const e of entries) {
    while (stack.length > 1 && stack[stack.length - 1]!.level >= e.level) stack.pop();
    let parent = stack[stack.length - 1]!;
    const li = document.createElement('li');
    const a = document.createElement('a');
    a.href = `#${e.id}`;
    a.textContent = e.text;
    a.dataset.target = e.id;
    li.append(a);
    parent.ul.append(li);
    const sub = document.createElement('ul');
    li.append(sub);
    stack.push({ level: e.level, ul: sub });
  }
  root.querySelectorAll('ul:empty').forEach((u) => u.remove());
  container.append(root);
}

/** Highlights the TOC entry for the section nearest the top of the viewport. */
export function startScrollSpy(container: HTMLElement, entries: TocEntry[]): () => void {
  if (entries.length === 0) return () => {};
  const links = new Map<string, HTMLAnchorElement>();
  container.querySelectorAll<HTMLAnchorElement>('a[data-target]').forEach((a) => {
    links.set(a.dataset.target!, a);
  });
  const visible = new Set<string>();
  const setActive = (id: string | undefined) => {
    links.forEach((a, k) => a.classList.toggle('active', k === id));
    if (id) links.get(id)?.scrollIntoView({ block: 'nearest' });
  };
  const obs = new IntersectionObserver(
    (changes) => {
      for (const c of changes) {
        const id = (c.target as HTMLElement).id;
        if (c.isIntersecting) visible.add(id);
        else visible.delete(id);
      }
      // First visible heading in document order; otherwise keep the previous one.
      const first = entries.find((e) => visible.has(e.id));
      if (first) setActive(first.id);
    },
    { rootMargin: '0px 0px -70% 0px', threshold: [0, 1] },
  );
  entries.forEach((e) => obs.observe(e.el));
  return () => obs.disconnect();
}
