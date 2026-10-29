import { describe, expect, it } from 'vitest';
import { renderMarkdown } from '../src/render/render';
import { nameFromUrl } from '../src/files/handle-store';

function dom(html: string): HTMLElement {
  const root = document.createElement('div');
  root.innerHTML = html;
  return root;
}

describe('sanitizing', () => {
  it('strips inline event handlers and script tags', () => {
    const html = renderMarkdown('<img src=x onerror=alert(1)>\n\n<script>alert(2)</script>\n\nok');
    expect(html).not.toMatch(/onerror/i);
    expect(html).not.toMatch(/<script/i);
    expect(html).toContain('ok');
  });

  it('never produces a javascript: link, from markdown or raw HTML', () => {
    const md = dom(renderMarkdown('[x](javascript:alert(1))'));
    const raw = dom(renderMarkdown('<a href="javascript:alert(1)">y</a>'));
    for (const root of [md, raw]) {
      root.querySelectorAll('a').forEach((a) => {
        expect((a.getAttribute('href') ?? '').toLowerCase()).not.toMatch(/^\s*javascript:/);
      });
    }
  });

  it('drops iframes, forms and style attributes', () => {
    const html = renderMarkdown(
      '<iframe src="https://example.com"></iframe>\n\n<form action="/x"><input name=a></form>\n\n<p style="color:red">p</p>',
    );
    expect(html).not.toMatch(/<iframe|<form|style=/i);
  });

  it('opens external links safely', () => {
    const a = dom(renderMarkdown('[e](https://example.com)')).querySelector('a')!;
    expect(a.getAttribute('target')).toBe('_blank');
    expect(a.getAttribute('rel')).toContain('noopener');
  });
});

describe('markdown features', () => {
  it('adds a source line range to blocks', () => {
    const root = dom(renderMarkdown('# Title\n\npara one\n\n- a\n- b\n'));
    expect(root.querySelector('h1')!.getAttribute('data-line')).toBe('0');
    expect(root.querySelector('p')!.getAttribute('data-line')).toBe('2');
    expect(root.querySelector('p')!.getAttribute('data-line-end')).toBe('3');
    expect(root.querySelector('ul')!.getAttribute('data-line')).toBe('4');
  });

  it('renders footnotes with matching ref and definition ids', () => {
    const root = dom(renderMarkdown('Text[^1]\n\n[^1]: the note'));
    const ref = root.querySelector('.footnote-ref a')!;
    const target = ref.getAttribute('href')!.slice(1);
    expect(root.querySelector(`[id="${target}"]`)).not.toBeNull();
  });

  it('renders task list checkboxes as disabled', () => {
    const boxes = dom(renderMarkdown('- [ ] a\n- [x] b')).querySelectorAll('input[type=checkbox]');
    expect(boxes).toHaveLength(2);
    boxes.forEach((b) => expect(b.hasAttribute('disabled')).toBe(true));
  });

  it('renders tables and fenced code', () => {
    const root = dom(renderMarkdown('| a | b |\n|---|---|\n| 1 | 2 |\n\n```js\nlet x = 1;\n```'));
    expect(root.querySelector('table')).not.toBeNull();
    expect(root.querySelector('pre code')!.textContent).toContain('let x = 1;');
  });

  it('resolves relative links and images against an online document, and only then', () => {
    const src = '[next](./next.md) [top](#top) [mail](mailto:a@b.c) ![pic](img/a.png)';
    const online = dom(renderMarkdown(src, 'https://example.com/docs/readme.md'));
    const hrefs = [...online.querySelectorAll('a')].map((a) => a.getAttribute('href'));
    expect(hrefs).toEqual(['https://example.com/docs/next.md', '#top', 'mailto:a@b.c']);
    expect(online.querySelector('img')!.getAttribute('src')).toBe('https://example.com/docs/img/a.png');
    const local = dom(renderMarkdown(src));
    expect(local.querySelector('a')!.getAttribute('href')).toBe('./next.md');
  });

  it('turns GitHub callouts into titled boxes and leaves plain quotes alone', () => {
    const root = dom(renderMarkdown('> [!WARNING]\n> Mind the gap.\n\n> [!tip] Inline text\n\n> Just a quote'));
    const [warn, tip, plain] = [...root.querySelectorAll('blockquote')];
    expect(warn!.className).toBe('callout callout-warning');
    expect(warn!.querySelector('.callout-title')!.textContent).toBe('Warning');
    expect(warn!.textContent).not.toContain('[!WARNING]');
    expect(warn!.textContent).toContain('Mind the gap.');
    expect(tip!.className).toBe('callout callout-tip');
    expect(tip!.textContent).toContain('Inline text');
    expect(plain!.className).toBe('');
  });

  it('marks $…$ and $$…$$ as math, but not dollar amounts or code', () => {
    const root = dom(renderMarkdown('Area $\\pi r^2$ costs $5 and $10.\n\n$$\nE = mc^2\n$$\n\n`$x$`'));
    const math = [...root.querySelectorAll<HTMLElement>('.math')];
    expect(math.map((m) => [m.tagName, m.dataset.tex])).toEqual([
      ['SPAN', '\\pi r^2'],
      ['DIV', 'E = mc^2'],
    ]);
    expect(root.textContent).toContain('costs $5 and $10.');
    expect(root.querySelector('code')!.textContent).toBe('$x$');
  });

  it('leaves mermaid fences as code for the diagram step', () => {
    const root = dom(renderMarkdown('```mermaid\ngraph TD; A-->B\n```'));
    expect(root.querySelector('pre > code.language-mermaid')!.textContent).toContain('A-->B');
  });

  it('names an online file after the last part of its path', () => {
    expect(nameFromUrl('https://example.com/docs/My%20Notes.md?x=1')).toBe('My Notes.md');
    expect(nameFromUrl('https://example.com/')).toBe('example.com');
  });

  it('guesses the language of an unlabeled code block, but leaves plain text plain', () => {
    const json = dom(renderMarkdown('```\n{\n  "message": "migrated",\n  "data": { "attempts": 1, "error": null }\n}\n```'));
    expect(json.querySelector('pre code .hljs-attr')!.textContent).toBe('"message"');
    const prose = dom(renderMarkdown('```\nJust a note about the deploy\n```'));
    expect(prose.querySelector('pre code span')).toBeNull();
  });

  it('highlights code with a known language and leaves the rest escaped', () => {
    const known = dom(renderMarkdown('```js\nconst s = "<b>";\n```'));
    expect(known.querySelector('pre code .hljs-keyword')!.textContent).toBe('const');
    expect(known.querySelector('pre code b')).toBeNull();
    const unknown = dom(renderMarkdown('```nosuchlang\n<b>x</b>\n```'));
    expect(unknown.querySelector('pre code span')).toBeNull();
    expect(unknown.querySelector('pre code')!.textContent).toBe('<b>x</b>\n');
  });
});
