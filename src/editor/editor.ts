import { EditorState, Transaction, type Text } from '@codemirror/state';
import { EditorView, drawSelection, keymap } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';

export interface MdEditor {
  /** Always LF; the file layer restores the original line endings on save. */
  getText(): string;
  /**
   * Replaces the whole document without counting as a user edit. By default it stays out of the
   * undo history; pass undoable when the user chose to discard their edits, so Ctrl+Z brings them back.
   */
  setText(text: string, opts?: { undoable?: boolean }): void;
  /** The document as it is now. Cheap: documents are immutable trees. */
  snapshot(): Text;
  /** Marks `snap` (default: now) as what is on disk. */
  markSaved(snap?: Text): void;
  isDirty(): boolean;
  focus(): void;
  destroy(): void;
}

// Colours come from the viewer's CSS variables, so every theme works without extra code.
const theme = EditorView.theme({
  '&': { height: '100%', color: 'var(--fg)', backgroundColor: 'var(--bg)' },
  '&.cm-focused': { outline: '2px solid var(--accent)', outlineOffset: '-2px' },
  '.cm-scroller': {
    overflow: 'auto',
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
    fontSize: '14px',
    lineHeight: '1.6',
  },
  '.cm-content': { caretColor: 'var(--fg)', padding: '16px 0', maxWidth: '78ch' },
  '.cm-line': { padding: '0 16px' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--fg)' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': {
    backgroundColor: 'color-mix(in srgb, var(--accent) 25%, transparent)',
  },
});

const highlight = HighlightStyle.define([
  { tag: t.heading, color: 'var(--accent)', fontWeight: '700' },
  { tag: t.strong, fontWeight: '700' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strikethrough, textDecoration: 'line-through' },
  { tag: [t.link, t.url], color: 'var(--accent)', textDecoration: 'underline' },
  { tag: t.monospace, backgroundColor: 'var(--code-bg)' },
  { tag: t.quote, color: 'var(--muted)' },
  { tag: [t.processingInstruction, t.contentSeparator, t.meta], color: 'var(--muted)' },
  { tag: t.list, color: 'var(--accent)' },
]);

export function createEditor(parent: HTMLElement, doc: string, onChange: () => void): MdEditor {
  let silent = false;
  let saved: Text | null = null;

  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc,
      extensions: [
        history(),
        drawSelection(),
        EditorView.lineWrapping,
        markdown(),
        syntaxHighlighting(highlight),
        theme,
        keymap.of([...defaultKeymap, ...historyKeymap]),
        EditorView.contentAttributes.of({ 'aria-label': 'Markdown source', spellcheck: 'true' }),
        EditorView.updateListener.of((u) => {
          if (u.docChanged && !silent) onChange();
        }),
      ],
    }),
  });
  saved = view.state.doc;

  return {
    getText: () => view.state.doc.toString(),
    setText(text, opts) {
      // Replace only the span that differs, so the cursor and scroll position survive.
      const next = text.replace(/\r\n?/g, '\n');
      const old = view.state.doc.toString();
      let a = 0;
      while (a < old.length && a < next.length && old[a] === next[a]) a++;
      let b = 0;
      while (b < old.length - a && b < next.length - a && old[old.length - 1 - b] === next[next.length - 1 - b]) b++;
      silent = true;
      try {
        view.dispatch({
          changes: { from: a, to: old.length - b, insert: next.slice(a, next.length - b) },
          annotations: Transaction.addToHistory.of(opts?.undoable === true),
        });
      } finally {
        silent = false;
      }
    },
    snapshot: () => view.state.doc,
    markSaved(snap) {
      saved = snap ?? view.state.doc;
    },
    isDirty: () => !!saved && !view.state.doc.eq(saved),
    focus: () => view.focus(),
    destroy: () => view.destroy(),
  };
}
