import MarkdownIt, {
  type MarkdownIt as MarkdownItInstance,
  type StateBlock,
  type StateCore,
  type StateInline,
} from 'markdown-it';
import footnote from 'markdown-it-footnote';
import taskLists from 'markdown-it-task-lists';
import DOMPurify from 'dompurify';
import hljs from 'highlight.js/lib/common';

/**
 * Records each block's source line range on the rendered element. Phase 3 and 4
 * use it to map a selection in the page back to a position in the markdown source.
 */
const lineMapPlugin = (md: MarkdownItInstance): void => {
  md.core.ruler.push('md_reader_line_map', (state: StateCore) => {
    for (const t of state.tokens) {
      if (!t.map || !t.block) continue;
      if (t.nesting === -1) continue;
      t.attrSet('data-line', String(t.map[0]));
      t.attrSet('data-line-end', String(t.map[1]));
    }
    return true;
  });
};

const CALLOUTS: Record<string, string> = {
  note: 'Note',
  tip: 'Tip',
  important: 'Important',
  warning: 'Warning',
  caution: 'Caution',
};

/**
 * GitHub callouts: a blockquote starting with [!NOTE], [!TIP], [!IMPORTANT], [!WARNING] or
 * [!CAUTION] gets class "callout callout-<kind>" and a title line in place of the marker.
 */
const calloutPlugin = (md: MarkdownItInstance): void => {
  md.core.ruler.after('inline', 'md_reader_callouts', (state: StateCore) => {
    const tokens = state.tokens;
    for (let i = 0; i + 2 < tokens.length; i++) {
      const inline = tokens[i + 2]!;
      if (tokens[i]!.type !== 'blockquote_open' || tokens[i + 1]!.type !== 'paragraph_open' || inline.type !== 'inline') continue;
      // GitHub wants the marker on its own line; many files put text after it, so allow both.
      const m = /^\[!(note|tip|important|warning|caution)\][ \t]*\n?/i.exec(inline.content);
      if (!m) continue;
      const kind = m[1]!.toLowerCase();
      tokens[i]!.attrJoin('class', `callout callout-${kind}`);
      inline.content = inline.content.slice(m[0].length);
      const children = inline.children ?? [];
      const first = children[0];
      if (first?.type === 'text') {
        first.content = first.content.replace(/^\[!\w+\][ \t]*/, '');
        if (!first.content) children.shift();
        if (children[0]?.type === 'softbreak') children.shift();
      }
      const open = new state.Token('paragraph_open', 'p', 1);
      open.attrSet('class', 'callout-title');
      const title = new state.Token('inline', '', 0);
      const text = new state.Token('text', '', 0);
      title.content = text.content = CALLOUTS[kind]!;
      title.children = [text];
      const close = new state.Token('paragraph_close', 'p', -1);
      open.block = close.block = true;
      tokens.splice(i + 1, 0, open, title, close);
      // "> [!NOTE]" alone on its line leaves an empty paragraph behind: drop it.
      if (children.length === 0) tokens.splice(i + 4, 3);
    }
    return true;
  });
};

/**
 * Math: $…$ inline and $$…$$ blocks become placeholders holding the TeX source (shown as
 * written until KaTeX draws them, see renderRich). Dollar amounts stay text: the opening $
 * must not be followed by a space, the closing $ not preceded by one nor followed by a digit.
 */
const mathPlugin = (md: MarkdownItInstance): void => {
  md.inline.ruler.after('escape', 'math_inline', (state: StateInline, silent: boolean) => {
    const src = state.src;
    const start = state.pos;
    if (src[start] !== '$' || src[start + 1] === '$' || !src[start + 1] || /\s/.test(src[start + 1]!)) return false;
    let end = start + 1;
    while ((end = src.indexOf('$', end)) !== -1 && src[end - 1] === '\\') end++;
    if (end === -1 || /\s/.test(src[end - 1]!) || /\d/.test(src[end + 1] ?? '')) return false;
    if (!silent) state.push('math_inline', 'span', 0).content = src.slice(start + 1, end);
    state.pos = end + 1;
    return true;
  });
  md.block.ruler.before(
    'fence',
    'math_block',
    (state: StateBlock, startLine: number, endLine: number, silent: boolean) => {
      const lineText = (n: number) => state.src.slice(state.bMarks[n]! + state.tShift[n]!, state.eMarks[n]);
      if (state.sCount[startLine]! - state.blkIndent >= 4) return false;
      const first = lineText(startLine);
      if (!first.startsWith('$$')) return false;
      let body: string[] = [];
      let last = startLine;
      const rest = first.slice(2).trimEnd();
      if (rest.endsWith('$$')) {
        body = [rest.slice(0, -2)]; // $$ … $$ on one line
      } else {
        body = [rest];
        for (last = startLine + 1; last < endLine; last++) {
          const t = lineText(last).trimEnd();
          if (t.endsWith('$$')) break;
          body.push(t);
        }
        if (last >= endLine) return false; // no closing $$: not math
        body.push(lineText(last).trimEnd().slice(0, -2));
      }
      if (silent) return true;
      const token = state.push('math_block', 'div', 0);
      token.block = true;
      token.content = body.join('\n').trim();
      token.map = [startLine, last + 1];
      state.line = last + 1;
      return true;
    },
    { alt: ['paragraph', 'reference', 'blockquote', 'list'] },
  );
  const esc = md.utils.escapeHtml;
  md.renderer.rules.math_inline = (tokens, i) =>
    `<span class="math" data-tex="${esc(tokens[i]!.content)}">${esc(tokens[i]!.content)}</span>`;
  md.renderer.rules.math_block = (tokens, i) =>
    `<div class="math math-display" data-tex="${esc(tokens[i]!.content)}">${esc(tokens[i]!.content)}</div>\n`;
};

// Fenced code with a known language gets highlight.js spans (class names only, styled in
// style.css). A block with no language (common in generated docs) is auto-detected among
// common languages and coloured only when the guess is confident; '' leaves it plain, escaped
// by markdown-it. ```mermaid stays plain code here; renderRich turns it into a diagram.
const AUTO_LANGS = [
  'json', 'javascript', 'typescript', 'python', 'bash', 'shell', 'yaml', 'xml', 'css', 'scss', 'sql',
  'go', 'java', 'php', 'ruby', 'rust', 'c', 'cpp', 'csharp', 'diff', 'ini', 'dockerfile',
];
/** highlight.js's own measure of how sure a guess is; below this, the block stays plain. */
const MIN_RELEVANCE = 5;
const highlight = (code: string, lang: string): string => {
  if (lang) return hljs.getLanguage(lang) ? hljs.highlight(code, { language: lang, ignoreIllegals: true }).value : '';
  if (code.length > 20_000) return ''; // guessing is costly on huge blocks
  const guess = hljs.highlightAuto(code, AUTO_LANGS.filter((l) => hljs.getLanguage(l)));
  return guess.relevance >= MIN_RELEVANCE ? guess.value : '';
};

const md = new MarkdownIt({ html: true, linkify: true, typographer: false, highlight })
  .use(footnote)
  // No <label>: only the box itself toggles, so clicking or selecting the text never ticks it.
  .use(taskLists, { enabled: false, label: false })
  .use(calloutPlugin)
  .use(mathPlugin)
  .use(lineMapPlugin);

/** Address of the document being rendered; relative links and images resolve against it. */
let base: string | undefined;

let hooked = false;
function installHooks(): void {
  if (hooked) return;
  hooked = true;
  DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    const attr = node instanceof Element ? (node.tagName === 'A' ? 'href' : node.tagName === 'IMG' ? 'src' : null) : null;
    const value = attr && (node as Element).getAttribute(attr);
    // Not for in-page anchors or anything with a scheme (http:, mailto:, data: …).
    if (base && value && !value.startsWith('#') && !/^[a-z][a-z0-9+.-]*:/i.test(value)) {
      try {
        (node as Element).setAttribute(attr!, new URL(value, base).href);
      } catch {
        /* leave it as written */
      }
    }
    if (node instanceof Element && node.tagName === 'A') {
      const href = node.getAttribute('href') ?? '';
      if (/^https?:/i.test(href)) {
        node.setAttribute('target', '_blank');
        node.setAttribute('rel', 'noopener noreferrer');
      }
    }
    // Every input starts disabled; the viewer enables task checkboxes only in files it can save.
    if (node instanceof Element && node.tagName === 'INPUT') {
      node.setAttribute('disabled', '');
    }
  });
}

export function sanitize(html: string): string {
  installHooks();
  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ['style', 'form', 'iframe', 'object', 'embed', 'link', 'meta', 'base'],
    FORBID_ATTR: ['style'],
  });
}

/** `baseUrl` is the document's own address when it was opened from a link. */
export function renderMarkdown(source: string, baseUrl?: string): string {
  base = baseUrl;
  try {
    return sanitize(md.render(source));
  } finally {
    base = undefined;
  }
}

/**
 * Footnotes as the renderer numbers them: `labels[n - 1]` is the label shown as note n
 * (null for inline ^[…] notes). `codeLines` are the line ranges of code and HTML blocks,
 * where footnote syntax is plain text.
 */
export function footnoteInfo(source: string): { labels: (string | null)[]; codeLines: [number, number][] } {
  const env: { footnotes?: { list?: { label?: string }[] } } = {};
  const tokens = md.parse(source, env);
  return {
    labels: (env.footnotes?.list ?? []).map((f) => f.label ?? null),
    codeLines: tokens
      .filter((t) => t.map && ['fence', 'code_block', 'html_block', 'math_block'].includes(t.type))
      .map((t) => t.map as [number, number]),
  };
}

let diagramCount = 0;

/**
 * Draws math (KaTeX) and ```mermaid diagrams in a rendered document. Each library is loaded
 * from the extension's own files the first time a document needs it, so other documents load
 * nothing extra. When loading or drawing fails, the source stays visible as written.
 */
export async function renderRich(root: HTMLElement, dark: boolean): Promise<void> {
  const math = root.querySelectorAll<HTMLElement>('.math[data-tex]');
  if (math.length > 0) {
    const [{ default: katex }] = await Promise.all([import('katex'), import('katex/dist/katex.min.css')]);
    for (const el of math) {
      try {
        // throwOnError false: a bad formula is shown in red rather than breaking the page.
        katex.render(el.dataset.tex ?? '', el, { displayMode: el.tagName === 'DIV', throwOnError: false });
      } catch {
        /* keep the TeX as written */
      }
    }
  }
  const diagrams = root.querySelectorAll<HTMLElement>('pre > code.language-mermaid');
  if (diagrams.length > 0) {
    const { default: mermaid } = await import('mermaid');
    // strict: no scripts or click handlers in diagrams; Mermaid sanitizes its own SVG.
    mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: dark ? 'dark' : 'default' });
    for (const code of diagrams) {
      const block = code.closest('.code-block') ?? code.parentElement!;
      try {
        const { svg } = await mermaid.render(`mermaid-${++diagramCount}`, code.textContent ?? '');
        const figure = document.createElement('div');
        figure.className = 'mermaid-diagram';
        figure.innerHTML = svg;
        block.replaceWith(figure);
      } catch (e) {
        const note = document.createElement('p');
        note.className = 'mermaid-error';
        note.textContent = `This diagram could not be drawn: ${e instanceof Error ? e.message : String(e)}`;
        block.before(note);
      }
    }
  }
}
