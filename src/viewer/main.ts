import './style.css';
import { footnoteInfo, renderMarkdown, renderRich } from '../render/render';
import {
  ensurePermission,
  ensureReadPermission,
  hasWritePermission,
  loadFile,
  currentStamp,
  detectEol,
  pickFile,
  PickerCancelled,
  saveFile,
  stampOf,
  type LoadedFile,
  type SaveResult,
} from '../files/file-layer';
import { createEditor, type MdEditor } from '../editor/editor';
import { diffLines, splitLines, withContext } from '../editor/diff';
import { addFootnote, removeFootnote, sourceRange, toggleTask } from '../editor/footnote-source';
import {
  forgetAll,
  forgetFile,
  listRecent,
  nameFromUrl,
  rememberFile,
  rememberUrl,
  type RecentFile,
} from '../files/handle-store';
import {
  applySettings,
  clampSettings,
  DEFAULTS,
  loadSettings,
  saveSettings,
  type Settings,
  type ThemeName,
} from '../state/settings';
import { collectHeadings, renderToc, startScrollSpy } from './toc';
import { applyCollapsed, foldToLevel, readCollapsed, reveal, wrapSections } from './collapse';
import { initFootnoteAdder, initFootnotes } from './footnotes';
import { findLines, fuzzyScore, listMarkdownFiles, MAX_FILES, type FolderFile } from './folder';
import { loadCollapsed, saveCollapsed } from '../state/view-state';

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing #${id}`);
  return el as T;
};

const els = {
  open: $<HTMLButtonElement>('open'),
  openFolder: $<HTMLButtonElement>('open-folder'),
  focusBtn: $<HTMLButtonElement>('focus-btn'),
  focusSection: $<HTMLButtonElement>('focus-section'),
  focusParagraph: $<HTMLButtonElement>('focus-paragraph'),
  focusFade: $<HTMLInputElement>('focus-fade'),
  focusFadeVal: $('focus-fade-val'),
  focusKeep: $<HTMLInputElement>('focus-keep'),
  focusExit: $<HTMLButtonElement>('focus-exit'),
  printBtn: $<HTMLButtonElement>('print-btn'),
  sidebar: $('sidebar'),
  sideTabs: $('side-tabs'),
  tabFiles: $<HTMLButtonElement>('tab-files'),
  tabIndex: $<HTMLButtonElement>('tab-index'),
  folder: $('folder'),
  folderName: $('folder-name'),
  folderClose: $<HTMLButtonElement>('folder-close'),
  folderSearch: $<HTMLInputElement>('folder-search'),
  searchResults: $('search-results'),
  folderFiles: $('folder-files'),
  switcher: $<HTMLDialogElement>('switcher'),
  switcherInput: $<HTMLInputElement>('switcher-input'),
  switcherList: $('switcher-list'),
  menuToggle: $<HTMLButtonElement>('menu-toggle'),
  menu: $('menu'),
  goToFile: $<HTMLButtonElement>('go-to-file'),
  settingsBtn: $<HTMLButtonElement>('settings-btn'),
  settingsPane: $('settings'),
  settingsClose: $<HTMLButtonElement>('settings-close'),
  qToc: $<HTMLButtonElement>('q-toc'),
  qFontDown: $<HTMLButtonElement>('q-font-down'),
  qFontUp: $<HTMLButtonElement>('q-font-up'),
  qFontSize: $('q-font-size'),
  qWidth: $<HTMLSelectElement>('q-width'),
  qTheme: $<HTMLSelectElement>('q-theme'),
  showToc: $<HTMLInputElement>('show-toc'),
  lineNumbers: $<HTMLInputElement>('line-numbers'),
  markColor: $<HTMLInputElement>('mark-color'),
  lineHeight: $<HTMLInputElement>('line-height'),
  lineHeightVal: $('line-height-val'),
  letterSpacing: $<HTMLInputElement>('letter-spacing'),
  letterSpacingVal: $('letter-spacing-val'),
  paraSpacing: $<HTMLInputElement>('para-spacing'),
  paraSpacingVal: $('para-spacing-val'),
  headingFont: $<HTMLInputElement>('heading-font'),
  headingColor: $<HTMLInputElement>('heading-color'),
  boldColor: $<HTMLInputElement>('bold-color'),
  codeBg: $<HTMLInputElement>('code-bg'),
  codeFg: $<HTMLInputElement>('code-fg'),
  footer: $('footer'),
  statHeadings: $('stat-headings'),
  statChars: $('stat-chars'),
  statRead: $('stat-read'),
  statTasks: $('stat-tasks'),
  progress: $('progress'),
  progressFill: $('progress-fill'),
  statProgress: $('stat-progress'),
  font: $<HTMLInputElement>('font'),
  recentClear: $<HTMLButtonElement>('recent-clear'),
  name: $('file-name'),
  readonly: $('readonly'),
  expandAll: $<HTMLButtonElement>('expand-all'),
  collapseAll: $<HTMLButtonElement>('collapse-all'),
  fontSizeVal: $('font-size-val'),
  theme: $<HTMLSelectElement>('theme'),
  width: $<HTMLSelectElement>('width'),
  fontUp: $<HTMLButtonElement>('font-up'),
  fontDown: $<HTMLButtonElement>('font-down'),
  toc: $('toc'),
  empty: $('empty'),
  content: $('content'),
  notice: $('notice'),
  noticeText: $('notice-text'),
  noticeActions: $('notice-actions'),
  edit: $<HTMLButtonElement>('edit'),
  save: $<HTMLButtonElement>('save'),
  status: $('status'),
  autosave: $<HTMLInputElement>('autosave'),
  diff: $('diff'),
  panes: $('panes'),
  editorPane: $('editor-pane'),
};

let settings: Settings;
/** A local file has a handle and can be edited; an online file has only its URL and is read-only. */
let current: { handle: FileSystemFileHandle | null; url?: string; loaded: LoadedFile } | null = null;
let stopSpy: () => void = () => {};
let sections: HTMLDetailsElement[] = [];
let collapsed = new Set<string>();
let fileKey = '';
let saveTimer: ReturnType<typeof setTimeout> | undefined;
// Registered before the click handlers below so a footnote click is already handled by then.
const footnotes = initFootnotes(els.content, {
  onRemove: (n) => void removeNote(n),
  canRemove: () => !!current?.loaded.editable,
});
let pollBusy = false;
let lostNoticeShown = false;
// Editing: the editor exists only while edit mode is on.
let editor: MdEditor | null = null;
let saving = false;
let previewTimer: ReturnType<typeof setTimeout> | undefined;
let autosaveTimer: ReturnType<typeof setTimeout> | undefined;
/** Stamp of the disk version shown in the conflict view, so polling does not re-report it. */
let conflictStamp: string | null = null;

type Action = [label: string, run: () => void];

function notice(msg: string | null, actions: Action[] = []): void {
  els.notice.hidden = msg === null;
  els.noticeText.textContent = msg ?? '';
  els.noticeActions.replaceChildren(
    ...actions.map(([label, run]) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      b.addEventListener('click', run);
      return b;
    }),
  );
}

function setStatus(text: string): void {
  els.status.textContent = text;
}

/** While editing, `text` is the editor's text, so the preview follows the edits. */
function show(loaded: LoadedFile, keepScroll: boolean, text = loaded.text): void {
  const y = window.scrollY;
  // renderMarkdown sanitizes with DOMPurify, so this is the one place HTML enters the DOM.
  footnotes.close();
  els.content.innerHTML = renderMarkdown(text, current?.url);
  // Counted before line numbers and copy buttons are added, so only the document's own text counts.
  const plain = (els.content.textContent ?? '').replace(/\s+/g, ' ').trim();
  const chars = plain.length;
  const words = plain ? plain.split(' ').length : 0;
  sections = wrapSections(els.content);
  // Each code block gets a line-number gutter and a copy button. The gutter is a second <pre>
  // with the same metrics, so numbers line up and stay put when the code scrolls sideways.
  // The line-numbers setting only hides it (CSS), so toggling needs no re-render.
  for (const pre of els.content.querySelectorAll('pre')) {
    const wrap = document.createElement('div');
    wrap.className = 'code-block';
    const lines = (pre.textContent ?? '').replace(/\n$/, '').split('\n').length;
    const gutter = document.createElement('pre');
    gutter.className = 'gutter';
    gutter.setAttribute('aria-hidden', 'true');
    gutter.append(document.createElement('code'));
    gutter.firstElementChild!.textContent = Array.from({ length: lines }, (_, i) => i + 1).join('\n');
    const copy = document.createElement('button');
    copy.type = 'button';
    copy.className = 'copy';
    copy.textContent = 'Copy';
    copy.setAttribute('aria-label', 'Copy code');
    pre.before(wrap);
    wrap.append(gutter, pre, copy);
  }
  // Tables scroll inside their own box (both ways) so the header row can stick to its top.
  for (const table of els.content.querySelectorAll('table')) {
    const wrap = document.createElement('div');
    wrap.className = 'table-wrap';
    table.before(wrap);
    wrap.append(table);
  }
  // Math and diagrams are drawn last; their libraries load only for documents that use them.
  // Diagrams take light or dark colours from the theme's background.
  const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
  const rgb = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(bg)?.slice(1).map((h) => parseInt(h, 16));
  const dark = !!rgb && rgb[0]! * 0.299 + rgb[1]! * 0.587 + rgb[2]! * 0.114 < 128;
  void renderRich(els.content, dark);
  els.content.hidden = false;
  els.expandAll.disabled = els.collapseAll.disabled = false;
  els.empty.hidden = true;
  els.name.textContent = loaded.name;
  document.title = `${loaded.name} · Calmdown`;
  // Why a file is read-only, shown on the header tag, the Edit item and the task boxes.
  const readOnlyWhy = loaded.editable
    ? ''
    : current?.handle
      ? 'This file is not valid UTF-8, so it is read-only.'
      : 'Opened from a link or dropped onto a browser tab, so Chrome lets Calmdown read it but not save it. ' +
        'To edit it or tick tasks, open it with Open file or Open folder.';
  els.edit.disabled = !loaded.editable;
  els.edit.title = readOnlyWhy;
  els.readonly.hidden = loaded.editable;
  els.readonly.title = readOnlyWhy;

  stopSpy();
  const entries = collectHeadings(els.content);
  applyCollapsed(sections, collapsed);
  renderToc(els.toc, entries);
  stopSpy = startScrollSpy(els.toc, entries);
  els.statHeadings.textContent = `${entries.length} ${entries.length === 1 ? 'heading' : 'headings'}`;
  els.statChars.textContent = `${chars.toLocaleString()} characters`;
  // About 230 words a minute, a common average for reading on screen.
  els.statRead.textContent = `~${Math.max(1, Math.round(words / 230))} min read`;
  // Task checkboxes are clickable only where the file can be saved; the footer counts them.
  const boxes = [...els.content.querySelectorAll<HTMLInputElement>('input.task-list-item-checkbox')];
  for (const b of boxes) {
    b.disabled = !loaded.editable;
    b.title = readOnlyWhy;
  }
  els.statTasks.hidden = boxes.length === 0;
  els.statTasks.textContent = `${boxes.filter((b) => b.checked).length} of ${boxes.length} tasks done`;
  els.footer.hidden = false;

  window.scrollTo(0, keepScroll ? y : 0);
  fitTables();
  // Focus mode was on before the reload and "Stay on after reload" is ticked.
  if (settings.focusKeep && settings.focusActive && document.documentElement.dataset.focus !== 'on') setFocus(true);
}

let recentItems: RecentFile[] = [];

async function refreshRecent(): Promise<void> {
  const byName = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });
  recentItems = (await listRecent()).sort((a, b) => byName.compare(a.name, b.name));
  if (els.switcher.open) renderSwitcher();
}

/**
 * Where a recent file lives, as far as Calmdown knows: the web address, the disk path of a
 * file:// link, the folder path if it was opened from a folder. Chrome never shares the disk
 * path of a file picked with Open file or dropped on the page.
 */
function whereIs(r: RecentFile): string {
  if (r.url?.startsWith('file:')) {
    try {
      return decodeURI(new URL(r.url).pathname);
    } catch {
      return r.url;
    }
  }
  return r.url ?? r.path ?? 'Local file';
}

/** The menu holds actions; Settings opens as a second pane beside it and closes with it. */
function setMenu(open: boolean): void {
  els.menu.hidden = !open;
  els.menuToggle.setAttribute('aria-expanded', String(open));
  if (!open) setSettings(false);
}

function setSettings(open: boolean): void {
  els.settingsPane.hidden = !open;
  els.settingsBtn.setAttribute('aria-expanded', String(open));
}

/** `path` is the file's place in an open folder, kept with its recent entry. */
async function openHandle(handle: FileSystemFileHandle, path?: string): Promise<void> {
  if (editor?.isDirty() && !confirm('Discard your unsaved edits?')) return;
  notice(null);
  lostNoticeShown = false;
  if (!(await ensureReadPermission(handle))) {
    notice('Read permission was not granted for that file.');
    return;
  }
  let loaded: LoadedFile;
  try {
    loaded = await loadFile(handle);
  } catch (e) {
    notice(`Could not open the file: ${e instanceof Error ? e.message : String(e)}`);
    return;
  }
  flushSave();
  // The recent-files id doubles as the key for per-file view state. Both are best effort.
  let key = `name:${handle.name}`;
  try {
    key = (await rememberFile(handle, path)).id;
    await refreshRecent();
  } catch {
    /* IndexedDB unavailable or full: reading still works, state falls back to the file name */
  }
  fileKey = key;
  collapsed = await loadCollapsed(fileKey);
  stopEdit();
  current = { handle, loaded };
  history.replaceState(null, '', location.pathname); // drop a ?url= from an online file
  show(loaded, false);
}

/** GitHub and GitLab "blob" pages are HTML; their raw file lives at a sibling address. */
function rawUrl(url: string): string {
  const gh = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/blob\/(.+)$/.exec(url);
  if (gh) return `https://raw.githubusercontent.com/${gh[1]}/${gh[2]}/${gh[3]}`;
  return url.replace(/^(https:\/\/gitlab\.com\/.+)\/-\/blob\//, '$1/-/raw/');
}

/** Opens a markdown file from the web or a file:// link. Such files are always read-only. */
async function openUrl(address: string): Promise<void> {
  if (editor?.isDirty() && !confirm('Discard your unsaved edits?')) return;
  notice(null);
  let url: URL;
  try {
    url = new URL(rawUrl(address.trim()));
    if (!['http:', 'https:', 'file:'].includes(url.protocol)) throw new Error();
  } catch {
    notice('That is not a web or file address.');
    return;
  }
  // Ask for access before the first request: a fetch Chrome blocks would also be logged as an
  // error on the extension's Errors page.
  const allowed =
    url.protocol === 'file:'
      ? await chrome.extension.isAllowedFileSchemeAccess()
      : await chrome.permissions.contains({ origins: [`${url.origin}/*`] });
  if (!allowed) {
    askAccess(url, address);
    return;
  }
  let text: string;
  if (url.protocol === 'file:') {
    // Chrome refuses file:// requests from extension pages, so content-local.js reads the text
    // from the file's own page and the background page keeps it in session storage.
    const key = `file:${url.href}`;
    const stored = (await chrome.storage.session.get(key))[key];
    if (typeof stored !== 'string') {
      // Not read yet in this browser session (e.g. opened from Recent): open the file's page
      // in this tab; the content script reads it and brings the tab back here.
      const tab = await chrome.tabs.getCurrent();
      if (tab?.id !== undefined) await chrome.tabs.update(tab.id, { url: url.href });
      return;
    }
    text = stored;
  } else {
    let res: Response;
    try {
      res = await fetch(url, { credentials: 'omit' });
    } catch {
      notice(`Could not load ${url.href}. Check the address and your connection.`);
      return;
    }
    if (!res.ok) {
      notice(`Could not load ${url.href}: ${res.status} ${res.statusText}`);
      return;
    }
    if ((res.headers.get('content-type') ?? '').includes('text/html')) {
      notice('That address returned a web page, not a markdown file.');
      return;
    }
    text = await res.text();
  }
  const loaded: LoadedFile = {
    name: nameFromUrl(url.href),
    text,
    lastModified: 0,
    size: text.length,
    stamp: '',
    hash: '',
    bom: false,
    eol: detectEol(text),
    mixedEol: false,
    editable: false,
  };
  flushSave();
  try {
    await rememberUrl(url.href);
    await refreshRecent();
  } catch {
    /* IndexedDB unavailable or full: reading still works */
  }
  fileKey = `url:${url.href}`;
  collapsed = await loadCollapsed(fileKey);
  stopEdit();
  lostNoticeShown = false;
  current = { handle: null, url: url.href, loaded };
  // Keep the address in the page URL so reload, bookmarks and Back work.
  history.replaceState(null, '', `${location.pathname}?url=${encodeURIComponent(url.href)}`);
  show(loaded, false);
}

/** Explains what access is missing and offers the way to grant it. */
function askAccess(url: URL, address: string): void {
  if (url.protocol === 'file:') {
    notice('To open local files from links, turn on "Allow access to file URLs" for Calmdown, then reload.', [
      ['Open extension settings', () => void chrome.tabs.create({ url: `chrome://extensions/?id=${chrome.runtime.id}` })],
    ]);
    return;
  }
  const origins = [`${url.origin}/*`];
  // The request must come from a click, so it waits for this button.
  notice(`Calmdown needs your permission to read files from ${url.host}. Allow it?`, [
    ['Allow', async () => {
      if (await chrome.permissions.request({ origins })) await openUrl(address);
    }],
  ]);
}

function startEdit(): void {
  if (!current || editor) return;
  // CodeMirror reads CRLF and CR as line breaks and keeps LF; saveFile restores the file's own.
  editor = createEditor(els.editorPane, current.loaded.text, onEdit);
  els.panes.classList.add('editing');
  els.editorPane.hidden = false;
  els.edit.textContent = 'Done editing';
  els.edit.setAttribute('aria-pressed', 'true');
  els.save.hidden = false;
  setStatus('');
  if (current.loaded.mixedEol) {
    const eol = current.loaded.eol === '\r\n' ? 'CRLF' : 'LF';
    notice(`This file mixes line endings. Saving will convert them all to ${eol}.`);
  }
  editor.focus();
}

function stopEdit(): void {
  if (!editor) return;
  clearTimeout(previewTimer);
  clearTimeout(autosaveTimer);
  editor.destroy();
  editor = null;
  hideDiff();
  els.panes.classList.remove('editing');
  els.editorPane.hidden = true;
  els.edit.textContent = 'Edit file';
  els.edit.setAttribute('aria-pressed', 'false');
  els.save.hidden = true;
  setStatus('');
  if (current) show(current.loaded, true);
}

function onEdit(): void {
  setStatus('Edited');
  clearTimeout(previewTimer);
  previewTimer = setTimeout(() => {
    if (current && editor) show(current.loaded, true, editor.getText());
  }, 200);
  if (settings.autosave) {
    clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(() => void save(false), 2000);
  }
}

/**
 * Writes the editor's text over the file. `fromUser` may ask for write permission; autosave
 * never prompts. `base` is the version the edits are checked against (the disk version when
 * the user chose to overwrite a conflict).
 */
async function save(fromUser: boolean, base = current?.loaded): Promise<boolean> {
  const ed = editor;
  if (!current || !ed || !base || saving) return false;
  if (!fromUser && !els.diff.hidden) return false;
  const { handle } = current;
  if (!handle) return false;
  const allowed = fromUser ? await ensurePermission(handle, 'readwrite') : await hasWritePermission(handle);
  if (!allowed) {
    if (fromUser) notice('Write permission was not granted for that file.');
    else setStatus('Edited · press Ctrl+S once to allow autosave');
    return false;
  }

  saving = true;
  setStatus('Saving…');
  const snap = ed.snapshot();
  let result: SaveResult;
  try {
    result = await saveFile(handle, base, snap.toString());
  } finally {
    saving = false;
  }
  if (editor !== ed || current?.handle !== handle) return false;

  if (result.ok) {
    current.loaded = result.loaded;
    ed.markSaved(snap);
    hideDiff();
    notice(null);
    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    setStatus(ed.isDirty() ? 'Edited' : `Saved ${time}`);
    return true;
  }
  if (result.reason === 'permission') {
    notice('Write permission was not granted for that file.');
    setStatus('Edited');
  } else if (result.reason === 'error') {
    notice(result.message);
    setStatus('Not saved');
  } else {
    showConflict(result.disk, result.reason === 'verify');
  }
  return false;
}

const SIGN = { same: ' ', del: '−', add: '+' } as const;

function showConflict(disk: LoadedFile, afterWrite = false): void {
  if (!editor) return;
  conflictStamp = disk.stamp;
  setStatus('Conflict');
  notice(
    afterWrite
      ? 'Saved, but the file changed again right after: something else is writing to it too.'
      : 'The file changed on disk while you were editing. Nothing was saved.',
    [
      ['Keep mine (overwrite)', () => void save(true, disk)],
      ['Use disk version', () => useDisk(disk)],
      ['Close', () => {
        hideDiff();
        notice(null);
      }],
    ],
  );
  const { ops, coarse } = diffLines(splitLines(disk.text), splitLines(editor.getText()));
  const head = document.createElement('p');
  head.textContent =
    'Lines marked − are only on disk, lines marked + are only in your editor.' +
    (coarse ? ' The change is large, so it is shown as one block.' : '');
  const rows = withContext(ops).map((row) => {
    const div = document.createElement('div');
    div.className = `diff-${row.kind}`;
    div.textContent = row.kind === 'gap' ? `… ${row.count} unchanged lines` : `${SIGN[row.kind]} ${row.text}`;
    return div;
  });
  els.diff.replaceChildren(head, ...rows);
  els.diff.hidden = false;
}

function hideDiff(): void {
  els.diff.hidden = true;
  els.diff.replaceChildren();
  conflictStamp = null;
}

function useDisk(disk: LoadedFile): void {
  if (!current || !editor) return;
  editor.setText(disk.text, { undoable: true });
  editor.markSaved();
  current.loaded = disk;
  hideDiff();
  notice('Your edits were replaced with the version on disk. Press Ctrl+Z in the editor to bring them back.');
  setStatus('');
  show(disk, true, editor.getText());
}

// Footnotes from a selection in the rendered page (never in the source editor). Changes go
// into the editor while editing, otherwise straight to the file.

/** The markdown the page shows, with LF line endings. */
function sourceText(): string {
  return editor ? editor.getText() : current!.loaded.text.replace(/\r\n?/g, '\n');
}

/** The rendered block a node sits in, if a footnote may go there (not in code or the notes list). */
function blockOf(node: Node): HTMLElement | null {
  const el = node instanceof Element ? node : node.parentElement;
  const block = el?.closest<HTMLElement>('[data-line]');
  return block && els.content.contains(block) && !el!.closest('.footnotes, pre') ? block : null;
}

async function applySource(next: string): Promise<string | null> {
  if (!current) return 'No file is open.';
  if (editor) {
    editor.setText(next, { undoable: true });
    onEdit();
    return null;
  }
  const { handle } = current;
  if (!handle) return 'Files opened from a link are read-only.';
  if (!(await ensurePermission(handle, 'readwrite'))) return 'Write permission was not granted for that file.';
  const result = await saveFile(handle, current.loaded, next);
  if (current?.handle !== handle) return null;
  if (result.ok) {
    current.loaded = result.loaded;
    show(result.loaded, true);
    return null;
  }
  if (result.reason === 'permission') return 'Write permission was not granted for that file.';
  if (result.reason === 'error') return result.message;
  current.loaded = result.disk;
  show(result.disk, true);
  return 'The file changed on disk at the same moment, so the page now shows that version. Please check it and try again.';
}

async function addNote(range: Range, note: string): Promise<string | null> {
  if (!current) return 'No file is open.';
  const src = sourceText();
  let spot: { from: number | null; to: number } | null = null;
  try {
    const sel = range.cloneRange();
    const elOf = (n: Node) => (n instanceof Element ? n : n.parentElement);
    // Never start or end inside inline code or a formula.
    const endCode = elOf(sel.endContainer)?.closest('code, .math');
    if (endCode) sel.setEndAfter(endCode);
    const startCode = elOf(sel.startContainer)?.closest('code, .math');
    if (startCode) sel.setStartBefore(startCode);
    // A drawn formula's text is not its source; count it as the TeX it came from.
    const text = (r: Range) => {
      const frag = r.cloneContents();
      frag.querySelectorAll<HTMLElement>('.math').forEach((m) => (m.textContent = m.dataset.tex ?? ''));
      return frag.textContent ?? '';
    };
    const block = blockOf(sel.endContainer);
    if (block) {
      // The text is highlighted only when the selection stays inside one block.
      const sameBlock = blockOf(sel.startContainer) === block;
      const before = document.createRange();
      before.setStart(block, 0);
      if (sameBlock) before.setEnd(sel.startContainer, sel.startOffset);
      else before.collapse(true);
      const selected = document.createRange();
      selected.setStart(before.endContainer, before.endOffset);
      selected.setEnd(sel.endContainer, sel.endOffset);
      const r = sourceRange(src, Number(block.dataset.line), Number(block.dataset.lineEnd), text(before), text(selected));
      if (r) spot = { from: sameBlock ? r.from : null, to: r.to };
    }
  } catch {
    /* the page was re-rendered since the selection was made */
  }
  if (!spot) return 'Could not find that spot in the file. Select the text again.';
  return applySource(addFootnote(src, spot.to, note, spot.from ?? undefined));
}

// Ticking a task box writes "[x]" or "[ ]" on that item's line, through the same checked
// save as every other change (into the editor while editing). One save at a time.
let taskBusy = false;
els.content.addEventListener('change', async (e) => {
  const box = e.target;
  if (!(box instanceof HTMLInputElement) || !box.classList.contains('task-list-item-checkbox')) return;
  const li = box.closest<HTMLElement>('li[data-line]');
  const next = current && li && !taskBusy ? toggleTask(sourceText(), Number(li.dataset.line), box.checked) : null;
  if (next === null) {
    box.checked = !box.checked; // undo the click: nothing was saved
    if (!taskBusy) notice('This task could not be found in the file. Reload the page to see the current version.');
    return;
  }
  taskBusy = true;
  try {
    const err = await applySource(next);
    if (err) {
      notice(err);
      if (current) show(current.loaded, true, editor?.getText()); // put the boxes back as saved
    }
  } finally {
    taskBusy = false;
  }
});

async function removeNote(n: number): Promise<void> {
  if (!current) return;
  const src = sourceText();
  const label = footnoteInfo(src).labels[n - 1];
  if (!label) {
    notice('This note is written inline (^[…]), so remove it in the editor.');
    return;
  }
  if (!confirm(`Remove footnote ${n}?`)) return;
  const err = await applySource(removeFootnote(src, label));
  if (err) notice(err);
}

initFootnoteAdder({
  accepts: (r) => !!current?.loaded.editable && blockOf(r.endContainer) !== null,
  onSave: addNote,
});

function scheduleSave(): void {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flushSave, 400);
}

function flushSave(): void {
  if (saveTimer === undefined) return;
  clearTimeout(saveTimer);
  saveTimer = undefined;
  void saveCollapsed(fileKey, collapsed);
}

els.open.addEventListener('click', async () => {
  try {
    await openHandle(await pickFile());
    setMenu(false);
  } catch (e) {
    if (!(e instanceof PickerCancelled)) notice(`Could not open the picker: ${String(e)}`);
  }
});

els.recentClear.addEventListener('click', async () => {
  if (!confirm('Remove all files from the recent list? The files themselves are not touched.')) return;
  await forgetAll();
  await refreshRecent();
});

els.menuToggle.addEventListener('click', () => setMenu(els.menuToggle.getAttribute('aria-expanded') !== 'true'));
els.settingsBtn.addEventListener('click', () => setSettings(els.settingsBtn.getAttribute('aria-expanded') !== 'true'));
els.settingsClose.addEventListener('click', () => setSettings(false));
els.goToFile.addEventListener('click', openSwitcher);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !els.menu.hidden && !els.switcher.open) {
    setMenu(false);
    els.menuToggle.focus();
  }
});
document.addEventListener('click', (e) => {
  const t = e.target;
  if (els.menu.hidden || !(t instanceof Node)) return;
  if (els.menu.contains(t) || els.settingsPane.contains(t) || els.menuToggle.contains(t)) return;
  // A click that came from a dialog (confirm) or a removed list row has no live target.
  if (t.isConnected) setMenu(false);
});
// Shortcut hints in the menu, written for this platform (⌘ and ⌥ on a Mac).
const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
for (const k of document.querySelectorAll<HTMLElement>('kbd[data-keys]')) {
  const [mod, key] = k.dataset.keys!.split('+');
  k.textContent = isMac ? `${mod === 'mod' ? '⌘' : '⌥'}${key}` : `${mod === 'mod' ? 'Ctrl' : 'Alt'}+${key}`;
}

// Drag and drop: getAsFileSystemHandle gives a real handle (Chromium), not a one-off File.
document.addEventListener('dragover', (e) => e.preventDefault());
document.addEventListener('drop', async (e) => {
  e.preventDefault();
  const item = e.dataTransfer?.items[0];
  const handle = await item?.getAsFileSystemHandle?.();
  if (handle && handle.kind === 'file') await openHandle(handle as FileSystemFileHandle);
  else if (handle && handle.kind === 'directory') await openFolder(handle as FileSystemDirectoryHandle);
  else notice('Drop a single markdown file or a folder.');
});

// Folder mode: the Files tab lists every markdown file in the folder, Ctrl/Cmd+K jumps to one,
// and the search box finds text across all of them. Files open as local files (editable).
let folder: { name: string; files: FolderFile[] } | null = null;
/** Text read for search, by path, re-read only when the file's stamp changes. */
const textCache = new Map<string, { stamp: string; text: string }>();

function setTab(tab: 'files' | 'index'): void {
  els.sidebar.dataset.tab = tab;
  els.tabFiles.setAttribute('aria-selected', String(tab === 'files'));
  els.tabIndex.setAttribute('aria-selected', String(tab === 'index'));
}

async function openFolder(dir: FileSystemDirectoryHandle): Promise<void> {
  notice(null);
  let files: FolderFile[];
  try {
    files = await listMarkdownFiles(dir);
  } catch (e) {
    notice(`Could not read the folder: ${e instanceof Error ? e.message : String(e)}`);
    return;
  }
  folder = { name: dir.name, files };
  textCache.clear();
  els.folderName.textContent = `${dir.name} · ${files.length}${files.length >= MAX_FILES ? '+' : ''} files`;
  els.folderName.title = dir.name;
  els.folderSearch.value = '';
  els.searchResults.hidden = true;
  els.folder.hidden = false;
  els.sideTabs.hidden = false;
  setTab('files');
  // A tree: one nested list per subfolder, in path order.
  const lists = new Map<string, HTMLElement>([['', els.folderFiles]]);
  const listFor = (dirPath: string): HTMLElement => {
    let ul = lists.get(dirPath);
    if (ul) return ul;
    const slash = dirPath.lastIndexOf('/');
    const li = document.createElement('li');
    const label = document.createElement('div');
    label.className = 'dir';
    label.textContent = dirPath.slice(slash + 1);
    ul = document.createElement('ul');
    li.append(label, ul);
    listFor(slash < 0 ? '' : dirPath.slice(0, slash)).append(li);
    lists.set(dirPath, ul);
    return ul;
  };
  els.folderFiles.replaceChildren();
  for (const f of files) {
    const slash = f.path.lastIndexOf('/');
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = f.path.slice(slash + 1);
    b.title = f.path;
    b.dataset.path = f.path;
    li.append(b);
    listFor(slash < 0 ? '' : f.path.slice(0, slash)).append(li);
  }
  if (files.length === 0) notice(`No markdown files in ${dir.name}.`);
}

/** Opens a file of the open folder; with `find`, scrolls to the first match of that text. */
async function openFolderFile(path: string, find?: string): Promise<void> {
  const f = folder?.files.find((x) => x.path === path);
  if (!f) return;
  await openHandle(f.handle, `${folder!.name}/${f.path}`);
  if (current?.handle !== f.handle) return; // not opened (kept unsaved edits, or no permission)
  for (const b of els.folderFiles.querySelectorAll<HTMLButtonElement>('button')) {
    b.classList.toggle('active', b.dataset.path === path);
  }
  if (!find) return;
  const needle = find.toLowerCase();
  const walker = document.createTreeWalker(els.content, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const at = (n.textContent ?? '').toLowerCase().indexOf(needle);
    if (at < 0 || n.parentElement?.closest('.gutter, .copy')) continue;
    reveal(n.parentElement); // open collapsed sections around it
    const r = document.createRange();
    r.setStart(n, at);
    r.setEnd(n, at + find.length);
    getSelection()?.removeAllRanges();
    getSelection()?.addRange(r);
    n.parentElement?.scrollIntoView({ block: 'center' });
    return;
  }
}

els.openFolder.addEventListener('click', async () => {
  try {
    const dir = await window.showDirectoryPicker({ mode: 'read' });
    setMenu(false);
    await openFolder(dir);
  } catch (e) {
    if (!(e instanceof DOMException && e.name === 'AbortError')) notice(`Could not open the folder: ${String(e)}`);
  }
});
els.folderClose.addEventListener('click', () => {
  folder = null;
  textCache.clear();
  els.folder.hidden = true;
  els.sideTabs.hidden = true;
  setTab('index');
});
els.tabFiles.addEventListener('click', () => setTab('files'));
els.tabIndex.addEventListener('click', () => setTab('index'));
// File tree and search results: every entry is a button carrying its path (and the search text).
els.folder.addEventListener('click', (e) => {
  const b = e.target instanceof Element ? e.target.closest<HTMLElement>('button[data-path]') : null;
  if (b) void openFolderFile(b.dataset.path!, b.dataset.find);
});

// Search across the folder: reads each file (cached until it changes) and lists matching lines.
let searchRun = 0;
let searchTimer: ReturnType<typeof setTimeout> | undefined;
els.folderSearch.addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => void searchFolder(els.folderSearch.value.trim()), 250);
});

async function searchFolder(q: string): Promise<void> {
  const run = ++searchRun;
  if (!folder || q.length < 2) {
    els.searchResults.hidden = true;
    return;
  }
  els.searchResults.hidden = false;
  els.searchResults.textContent = 'Searching…';
  const rows: HTMLElement[] = [];
  let fileCount = 0;
  const button = (cls: string, path: string): HTMLButtonElement => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = cls;
    b.dataset.path = path;
    b.dataset.find = q;
    return b;
  };
  for (const f of folder.files) {
    let text: string;
    try {
      const file = await f.handle.getFile();
      const stamp = stampOf(file);
      const cached = textCache.get(f.path);
      text = cached?.stamp === stamp ? cached.text : await file.text();
      textCache.set(f.path, { stamp, text });
    } catch {
      continue; // unreadable file: skip it
    }
    if (run !== searchRun) return; // a newer search took over
    const lines = findLines(text, q, 3);
    if (lines.length === 0) continue;
    fileCount++;
    const head = button('hit-file', f.path);
    head.textContent = f.path;
    head.title = f.path;
    rows.push(head);
    for (const l of lines) {
      const b = button('hit-line', f.path);
      const at = l.text.toLowerCase().indexOf(q.toLowerCase());
      const hit = document.createElement('b');
      hit.textContent = l.text.slice(at, at + q.length);
      b.append(`${l.line}: ${l.text.slice(0, at)}`, hit, l.text.slice(at + q.length));
      rows.push(b);
    }
    if (fileCount >= 100) break;
  }
  if (run !== searchRun) return;
  const summary = document.createElement('div');
  summary.className = 'hit-summary';
  summary.textContent = fileCount ? `Found in ${fileCount}${fileCount >= 100 ? '+' : ''} files` : 'No matches.';
  els.searchResults.replaceChildren(summary, ...rows);
}

// Ctrl/Cmd+K (or "Recent files & go to file…" in the menu): fuzzy search over the open folder's
// files and the recent files, shown in two groups. Recent files can be removed here, one by one
// or all at once. Arrow keys move, Enter opens, Esc closes.
interface SwitchItem {
  name: string;
  detail: string;
  /** What the query is matched against: the path where one is known, else the name. */
  match: string;
  open: () => Promise<void>;
  remove?: () => Promise<void>;
}
let switchItems: SwitchItem[] = [];
let switchSel = 0;

function openSwitcher(): void {
  setMenu(false);
  if (els.switcher.open) return;
  els.switcherInput.value = '';
  renderSwitcher();
  els.switcher.showModal();
}

function renderSwitcher(): void {
  const q = els.switcherInput.value;
  const rank = (items: SwitchItem[]) =>
    items
      .map((it) => ({ it, score: fuzzyScore(q, it.match) }))
      .filter((x) => x.score !== null)
      .sort((a, b) => b.score! - a.score!)
      .slice(0, 50)
      .map((x) => x.it);
  const groups: [string, SwitchItem[]][] = [
    [
      folder ? `In ${folder.name}` : '',
      rank(
        (folder?.files ?? []).map((f) => ({
          name: f.path.slice(f.path.lastIndexOf('/') + 1),
          detail: f.path,
          match: f.path,
          open: () => openFolderFile(f.path),
        })),
      ),
    ],
    [
      'Recent files',
      rank(
        recentItems.map((r) => ({
          // Web files are marked with a link icon; the line below says where a file lives.
          name: /^https?:/.test(r.url ?? '') ? `🔗 ${r.name}` : r.name,
          detail: whereIs(r),
          match: r.path ?? r.url ?? r.name,
          open: async () => {
            try {
              if (r.url) await openUrl(r.url);
              else if (r.handle) await openHandle(r.handle);
            } catch {
              await forgetFile(r.id); // the file is gone: drop it from the list
              await refreshRecent();
            }
          },
          remove: async () => {
            await forgetFile(r.id);
            await refreshRecent();
          },
        })),
      ),
    ],
  ];
  switchItems = groups.flatMap(([, items]) => items);
  switchSel = 0;
  els.recentClear.hidden = recentItems.length === 0;
  if (switchItems.length === 0) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = folder || recentItems.length ? 'No matching files' : 'Open a folder or a file first';
    els.switcherList.replaceChildren(li);
    return;
  }
  const rows: HTMLElement[] = [];
  let index = 0;
  for (const [label, items] of groups) {
    if (items.length === 0) continue;
    if (label) {
      const head = document.createElement('li');
      head.className = 'group-label';
      head.setAttribute('role', 'presentation');
      head.textContent = label;
      rows.push(head);
    }
    for (const it of items) {
      const li = document.createElement('li');
      li.setAttribute('role', 'option');
      li.setAttribute('aria-selected', String(index++ === 0));
      const text = document.createElement('span');
      text.className = 'item-text';
      const path = document.createElement('span');
      path.className = 'path';
      path.textContent = it.detail;
      text.append(it.name, path);
      li.append(text);
      li.addEventListener('click', () => {
        els.switcher.close();
        void it.open();
      });
      if (it.remove) {
        const x = document.createElement('button');
        x.type = 'button';
        x.className = 'remove';
        x.textContent = '×';
        x.title = 'Remove from recent files';
        x.setAttribute('aria-label', `Remove ${it.name} from recent files`);
        x.addEventListener('click', (e) => {
          e.stopPropagation(); // remove only; do not open it
          void it.remove!();
        });
        li.append(x);
      }
      rows.push(li);
    }
  }
  els.switcherList.replaceChildren(...rows);
}

els.switcherInput.addEventListener('input', renderSwitcher);
els.switcherInput.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    if (switchItems.length === 0) return;
    switchSel = (switchSel + (e.key === 'ArrowDown' ? 1 : switchItems.length - 1)) % switchItems.length;
    const options = els.switcherList.querySelectorAll('li[role="option"]');
    options.forEach((li, i) => li.setAttribute('aria-selected', String(i === switchSel)));
    options[switchSel]?.scrollIntoView({ block: 'nearest' });
  } else if (e.key === 'Enter') {
    e.preventDefault();
    const it = switchItems[switchSel];
    els.switcher.close();
    if (it) void it.open();
  }
});
document.addEventListener('keydown', (e) => {
  // Ctrl/Cmd+K (Ctrl/Cmd+P stays Print). e.code, so it works on any keyboard layout.
  if (!(e.ctrlKey || e.metaKey) || e.code !== 'KeyK' || e.shiftKey || e.altKey) return;
  e.preventDefault(); // instead of the browser's search-bar shortcut
  openSwitcher();
});

// The File System Access API has no change events, so poll the file stamp and only
// re-read the file when its stamp (mtime and size) moved.
setInterval(async () => {
  // Only local files are watched; an online file is fetched once.
  if (!current?.handle || document.hidden || pollBusy || saving) return;
  pollBusy = true;
  try {
    const stamp = await currentStamp(current.handle);
    lostNoticeShown = false;
    if (stamp !== current.loaded.stamp && stamp !== conflictStamp) {
      const loaded = await loadFile(current.handle);
      if (!editor) {
        current.loaded = loaded;
        show(loaded, true);
      } else if (loaded.hash === current.loaded.hash) {
        current.loaded = loaded; // touched, same content
      } else if (!editor.isDirty()) {
        // Nothing to lose: follow the disk version.
        current.loaded = loaded;
        editor.setText(loaded.text);
        editor.markSaved();
        show(loaded, true, editor.getText());
      } else {
        showConflict(loaded);
      }
    }
  } catch {
    if (!lostNoticeShown) {
      lostNoticeShown = true;
      notice('This file can no longer be read. It may have been moved, renamed or deleted.');
    }
  } finally {
    pollBusy = false;
  }
}, 1000);

// Any change to a section (click, keyboard, find-in-page) is read back from the DOM.
els.content.addEventListener(
  'toggle',
  (e) => {
    const t = e.target;
    if (!(t instanceof HTMLDetailsElement) || !sections.includes(t)) return;
    collapsed = readCollapsed(sections);
    scheduleSave();
  },
  true,
);

for (const [button, level] of [
  [els.expandAll, Infinity],
  [els.collapseAll, 1],
] as const) {
  button.addEventListener('click', () => {
    setMenu(false);
    foldToLevel(sections, level);
    collapsed = readCollapsed(sections);
    scheduleSave();
  });
}

// Following an in-page link (index, back-references) opens the sections around its target.
function revealHash(href: string | null): void {
  if (!href?.startsWith('#')) return;
  let id = href.slice(1);
  try {
    id = decodeURIComponent(id);
  } catch {
    /* keep the raw id */
  }
  reveal(document.getElementById(id));
}
els.toc.addEventListener('click', (e) => {
  const a = e.target instanceof Element ? e.target.closest('a[href]') : null;
  if (a) revealHash(a.getAttribute('href'));
});
els.content.addEventListener('click', (e) => {
  if (e.defaultPrevented) return;
  const a = e.target instanceof Element ? e.target.closest('a[href^="#"]') : null;
  if (a) revealHash(a.getAttribute('href'));
});
window.addEventListener('hashchange', () => revealHash(location.hash));

// Reading progress: how far the page is scrolled. Recomputed once per frame on scroll, on
// resize, and whenever the content's height changes (new render, folding, images loading).
let progressFrame = 0;
function scheduleProgress(): void {
  if (progressFrame) return;
  progressFrame = requestAnimationFrame(() => {
    progressFrame = 0;
    const max = document.documentElement.scrollHeight - window.innerHeight;
    const pct = max > 0 ? Math.min(100, Math.round((window.scrollY / max) * 100)) : 100;
    els.progressFill.style.width = `${pct}%`;
    els.progress.setAttribute('aria-valuenow', String(pct));
    els.statProgress.textContent = `${pct}%`;
    if (document.documentElement.dataset.focus === 'on') markFocus();
  });
}
window.addEventListener('scroll', scheduleProgress, { passive: true });
window.addEventListener('resize', scheduleProgress);
// Tables that fit the column drop their scroll box so the header pins to the page (see
// .table-wrap.fits in style.css). Checked whenever the content's size changes.
function fitTables(): void {
  for (const wrap of els.content.querySelectorAll<HTMLElement>('.table-wrap')) {
    const table = wrap.querySelector('table');
    if (table) wrap.classList.toggle('fits', table.scrollWidth <= wrap.clientWidth + 1);
  }
}
new ResizeObserver(() => {
  scheduleProgress();
  fitTables();
}).observe(els.content);

// Focus mode: no bars, and everything but the section at the reading line is faded.
// The reading line is 40% down the window; the section is the innermost one there.
// Both the section and the block (paragraph, list, code, table…) at the reading line are marked;
// the "Highlight" setting decides in CSS which of the two stays bright.
function markFocus(): void {
  const box = els.content.getBoundingClientRect();
  const at = document.elementFromPoint(box.left + box.width / 2, window.innerHeight * 0.4);
  const marks: [string, Element | null][] = [
    ['focus-current', at?.closest('details.section') ?? null],
    ['focus-block', at?.closest('.section-body > :not(details), details.section > summary, .md > :not(details)') ?? null],
  ];
  for (const [cls, el] of marks) {
    const prev = els.content.querySelector(`.${cls}`);
    if (prev === el) continue;
    prev?.classList.remove(cls);
    el?.classList.add(cls);
  }
}

function setFocus(on: boolean): void {
  if (on && !current) return;
  document.documentElement.dataset.focus = on ? 'on' : 'off';
  els.focusExit.hidden = !on;
  if (on) {
    setMenu(false);
    markFocus();
  }
  // Remembered for the next reload only when "Stay on after reload" is ticked.
  if (settings.focusKeep && settings.focusActive !== on) void update({ focusActive: on });
}

els.focusBtn.addEventListener('click', () => setFocus(true));
els.focusSection.addEventListener('click', () => void update({ focusUnit: 'section' }));
els.focusParagraph.addEventListener('click', () => void update({ focusUnit: 'paragraph' }));
els.focusFade.addEventListener('input', () => void update({ focusFade: Number(els.focusFade.value) }));
els.focusKeep.addEventListener('change', () => {
  const keep = els.focusKeep.checked;
  void update({ focusKeep: keep, focusActive: keep && document.documentElement.dataset.focus === 'on' });
});
els.focusExit.addEventListener('click', () => setFocus(false));
document.addEventListener('keydown', (e) => {
  const focusOn = document.documentElement.dataset.focus === 'on';
  if (e.key === 'Escape' && focusOn && !els.switcher.open) setFocus(false);
  // Alt/Option+F; e.code because Option+F types "ƒ" on a Mac.
  if (e.altKey && !e.ctrlKey && !e.metaKey && e.code === 'KeyF') {
    e.preventDefault();
    setFocus(!focusOn);
  }
});

// Print / PDF: print styles are in style.css. Collapsed sections and the footnotes are opened
// for the printout and closed again afterwards.
let closedForPrint: HTMLDetailsElement[] = [];
els.printBtn.addEventListener('click', () => {
  setMenu(false);
  window.print();
});
window.addEventListener('beforeprint', () => {
  closedForPrint = [...els.content.querySelectorAll<HTMLDetailsElement>('details:not([open])')];
  for (const d of closedForPrint) d.open = true;
});
window.addEventListener('afterprint', () => {
  for (const d of closedForPrint) d.open = false;
  closedForPrint = [];
});
els.content.addEventListener('click', async (e) => {
  const btn = e.target instanceof Element ? e.target.closest<HTMLButtonElement>('.code-block > .copy') : null;
  const code =
    btn?.parentElement?.querySelector('pre:not(.gutter) code') ?? btn?.parentElement?.querySelector('pre:not(.gutter)');
  if (!btn || !code) return;
  try {
    await navigator.clipboard.writeText(code.textContent ?? '');
    btn.textContent = 'Copied';
  } catch {
    btn.textContent = 'Copy failed';
  }
  setTimeout(() => (btn.textContent = 'Copy'), 1500);
});
window.addEventListener('pagehide', flushSave);

els.edit.addEventListener('click', () => {
  setMenu(false);
  if (!editor) return startEdit();
  if (!editor.isDirty()) return stopEdit();
  notice('You have unsaved edits.', [
    ['Save and close', async () => {
      if (await save(true)) stopEdit();
    }],
    ['Discard edits', () => {
      notice(null);
      stopEdit();
    }],
    ['Keep editing', () => notice(null)],
  ]);
});
els.save.addEventListener('click', () => void save(true));
document.addEventListener('keydown', (e) => {
  if (!editor || !(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 's') return;
  e.preventDefault();
  void save(true);
});
window.addEventListener('beforeunload', (e) => {
  if (editor?.isDirty()) e.preventDefault();
});
els.autosave.addEventListener('change', () => {
  void update({ autosave: els.autosave.checked });
  if (els.autosave.checked && editor?.isDirty()) onEdit();
});

// Two layers: `settings` are saved for all sessions (the Settings pane); `quick` holds this tab's
// footer changes to theme, width, text size and index, kept in sessionStorage (survives a
// reload, not closing the tab). The page shows `quick` over `settings`.
type QuickKey = 'theme' | 'width' | 'fontSize' | 'showToc';
const QUICK_KEY = 'md-reader-quick';
let quick: Partial<Pick<Settings, QuickKey>> = {};
try {
  quick = JSON.parse(sessionStorage.getItem(QUICK_KEY) ?? '{}') as typeof quick;
} catch {
  /* storage blocked or bad data: no quick changes */
}
const shown = (): Settings => clampSettings({ ...settings, ...quick });
let shownTheme: ThemeName | undefined;

function saveQuick(): void {
  try {
    sessionStorage.setItem(QUICK_KEY, JSON.stringify(quick));
  } catch {
    /* this tab only anyway */
  }
}

/** A footer change: applies to this tab only and never touches the saved settings. */
function updateQuick(next: Partial<Pick<Settings, QuickKey>>): void {
  const value = clampSettings({ ...settings, ...quick, ...next });
  for (const k of Object.keys(next) as QuickKey[]) Object.assign(quick, { [k]: value[k] });
  saveQuick();
  showSettings();
}

function showSettings(): void {
  const view = shown();
  applySettings(view);
  // Footer quick controls show what is on screen; the Settings pane shows the saved values.
  els.qTheme.value = view.theme;
  els.qWidth.value = String(view.width);
  els.qFontSize.textContent = `${view.fontSize}px`;
  els.qToc.setAttribute('aria-pressed', String(view.showToc));
  // Diagrams are drawn in the theme's colours, so a theme change redraws them.
  if (shownTheme !== undefined && shownTheme !== view.theme && current && els.content.querySelector('.mermaid-diagram')) {
    show(current.loaded, true, editor?.getText());
  }
  shownTheme = view.theme;
  els.autosave.checked = settings.autosave;
  els.theme.value = settings.theme;
  els.width.value = String(settings.width);
  els.showToc.checked = settings.showToc;
  els.lineNumbers.checked = settings.lineNumbers;
  els.markColor.value = settings.markColor;
  els.fontSizeVal.textContent = `${settings.fontSize}px`;
  els.focusSection.setAttribute('aria-pressed', String(settings.focusUnit === 'section'));
  els.focusParagraph.setAttribute('aria-pressed', String(settings.focusUnit === 'paragraph'));
  els.focusFade.value = String(settings.focusFade);
  els.focusFadeVal.textContent = `${Math.round(settings.focusFade * 100)}%`;
  els.focusKeep.checked = settings.focusKeep;
  els.font.value = settings.font;
  els.lineHeight.value = String(settings.lineHeight);
  els.lineHeightVal.textContent = settings.lineHeight.toFixed(2);
  els.letterSpacing.value = String(settings.letterSpacing);
  els.letterSpacingVal.textContent = `${settings.letterSpacing.toFixed(3)}em`;
  els.paraSpacing.value = String(settings.paraSpacing);
  els.paraSpacingVal.textContent = `${settings.paraSpacing.toFixed(1)}em`;
  els.headingFont.value = settings.headingFont;
  // A colour left to the theme shows the theme's text colour in the picker.
  const themeVar = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  els.headingColor.value = settings.headingColor || themeVar('--fg');
  els.boldColor.value = settings.boldColor || themeVar('--fg');
  els.codeBg.value = settings.codeBg || themeVar('--code-bg');
  els.codeFg.value = settings.codeFg || themeVar('--fg');
}

/** A Settings pane change: saved for all sessions, and it takes over from a footer change to the same thing. */
async function update(next: Partial<Settings>): Promise<void> {
  settings = clampSettings({ ...settings, ...next });
  let dropped = false;
  for (const k of Object.keys(next)) {
    if (k in quick) {
      delete quick[k as QuickKey];
      dropped = true;
    }
  }
  if (dropped) saveQuick();
  showSettings();
  await saveSettings(settings);
}

els.theme.addEventListener('change', () => void update({ theme: els.theme.value as ThemeName }));
els.showToc.addEventListener('change', () => void update({ showToc: els.showToc.checked }));
els.width.addEventListener('change', () => void update({ width: Number(els.width.value) }));
els.lineNumbers.addEventListener('change', () => void update({ lineNumbers: els.lineNumbers.checked }));
els.markColor.addEventListener('input', () => void update({ markColor: els.markColor.value }));
els.lineHeight.addEventListener('input', () => void update({ lineHeight: Number(els.lineHeight.value) }));
els.letterSpacing.addEventListener('input', () => void update({ letterSpacing: Number(els.letterSpacing.value) }));
els.paraSpacing.addEventListener('input', () => void update({ paraSpacing: Number(els.paraSpacing.value) }));
els.headingFont.addEventListener('change', () => void update({ headingFont: els.headingFont.value }));
els.headingColor.addEventListener('input', () => void update({ headingColor: els.headingColor.value }));
els.boldColor.addEventListener('input', () => void update({ boldColor: els.boldColor.value }));
els.codeBg.addEventListener('input', () => void update({ codeBg: els.codeBg.value }));
els.codeFg.addEventListener('input', () => void update({ codeFg: els.codeFg.value }));
// '' means "theme colour"; for the highlight, which has no theme colour, it means the default.
type ColorKey = 'markColor' | 'headingColor' | 'boldColor' | 'codeBg' | 'codeFg';
for (const b of els.settingsPane.querySelectorAll<HTMLButtonElement>('.reset-color')) {
  b.addEventListener('click', () => void update({ [b.dataset.for as ColorKey]: '' }));
}
// ↺ in a group's header: every setting the group lists in data-reset goes back to its default.
for (const b of els.settingsPane.querySelectorAll<HTMLButtonElement>('.reset-group')) {
  const keys = (b.closest<HTMLElement>('[data-reset]')?.dataset.reset ?? '').split(',') as (keyof Settings)[];
  b.addEventListener('click', () => void update(Object.fromEntries(keys.map((k) => [k, DEFAULTS[k]]))));
}
// 'change' fires on Enter, on blur and when a suggestion is picked, not on every key.
els.font.addEventListener('change', () => void update({ font: els.font.value }));
els.fontUp.addEventListener('click', () => void update({ fontSize: settings.fontSize + 1 }));
els.fontDown.addEventListener('click', () => void update({ fontSize: settings.fontSize - 1 }));

// Footer quick controls (this tab only). Their lists are copied from the Settings pane's.
els.qTheme.innerHTML = els.theme.innerHTML;
els.qWidth.innerHTML = els.width.innerHTML;
els.qTheme.addEventListener('change', () => updateQuick({ theme: els.qTheme.value as ThemeName }));
els.qWidth.addEventListener('change', () => updateQuick({ width: Number(els.qWidth.value) }));
els.qFontUp.addEventListener('click', () => updateQuick({ fontSize: shown().fontSize + 1 }));
els.qFontDown.addEventListener('click', () => updateQuick({ fontSize: shown().fontSize - 1 }));
els.qToc.addEventListener('click', () => updateQuick({ showToc: !shown().showToc }));

void (async () => {
  settings = await loadSettings();
  showSettings();
  await refreshRecent();
  // Set by the background page when a tab navigated to a markdown file, and kept on reload.
  const url = new URLSearchParams(location.search).get('url');
  if (url) await openUrl(url);
})();
