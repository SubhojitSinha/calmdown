// The only module that touches the disk. Every write is checked against what is on disk
// first, goes through a swap file (createWritable commits on close) and is verified after.

export interface LoadedFile {
  name: string;
  /** Decoded text, line endings exactly as on disk. */
  text: string;
  lastModified: number;
  size: number;
  /** lastModified plus size: a cheap change probe for polling. Not trusted for conflicts. */
  stamp: string;
  /** SHA-256 of the raw bytes. This is what conflict detection compares. */
  hash: string;
  bom: boolean;
  /** Dominant line ending, used when writing back. */
  eol: '\n' | '\r\n';
  /** LF and CRLF (or bare CR) are mixed: saving would normalise them. */
  mixedEol: boolean;
  /** False when the bytes are not valid UTF-8. Such a file is shown but never written. */
  editable: boolean;
}

const MD_TYPES: FilePickerAcceptType[] = [
  {
    description: 'Markdown',
    accept: { 'text/markdown': ['.md', '.markdown', '.mdown', '.mkd'], 'text/plain': ['.txt'] },
  },
];

export class PickerCancelled extends Error {
  constructor() {
    super('File picker cancelled');
  }
}

export async function pickFile(): Promise<FileSystemFileHandle> {
  try {
    const [handle] = await window.showOpenFilePicker({ types: MD_TYPES, multiple: false });
    if (!handle) throw new PickerCancelled();
    return handle;
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw new PickerCancelled();
    throw e;
  }
}

/** The first request for a stored handle must come from a user gesture. */
export async function ensurePermission(
  handle: FileSystemFileHandle,
  mode: 'read' | 'readwrite',
): Promise<boolean> {
  const opts = { mode } as const;
  if ((await handle.queryPermission(opts)) === 'granted') return true;
  return (await handle.requestPermission(opts)) === 'granted';
}

export const ensureReadPermission = (h: FileSystemFileHandle) => ensurePermission(h, 'read');

/** Autosave uses this: it must never trigger a permission prompt. */
export async function hasWritePermission(handle: FileSystemFileHandle): Promise<boolean> {
  return (await handle.queryPermission({ mode: 'readwrite' })) === 'granted';
}

export function countEols(text: string): { crlf: number; lf: number; cr: number } {
  const crlf = (text.match(/\r\n/g) ?? []).length;
  const lf = (text.match(/(?<!\r)\n/g) ?? []).length;
  const cr = (text.match(/\r(?!\n)/g) ?? []).length;
  return { crlf, lf, cr };
}

export function detectEol(text: string): '\n' | '\r\n' {
  const { crlf, lf } = countEols(text);
  return crlf > lf ? '\r\n' : '\n';
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

export function stampOf(file: { lastModified: number; size: number }): string {
  return `${file.lastModified}:${file.size}`;
}

export async function loadFile(handle: FileSystemFileHandle): Promise<LoadedFile> {
  const file = await handle.getFile();
  const bytes = new Uint8Array(await file.arrayBuffer());
  const bom = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
  const content = bom ? bytes.subarray(3) : bytes;
  let text: string;
  let editable = true;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(content);
  } catch {
    text = new TextDecoder('utf-8').decode(content); // lossy: for display only
    editable = false;
  }
  const { crlf, lf, cr } = countEols(text);
  return {
    name: file.name,
    text,
    lastModified: file.lastModified,
    size: file.size,
    stamp: stampOf(file),
    hash: await sha256(bytes),
    bom,
    eol: crlf > lf ? '\r\n' : '\n',
    mixedEol: cr > 0 || (crlf > 0 && lf > 0),
    editable,
  };
}

/** Cheap change probe for polling: no content read unless the stamp moved. */
export async function currentStamp(handle: FileSystemFileHandle): Promise<string> {
  return stampOf(await handle.getFile());
}

/**
 * Editor text always uses LF. Rebuilds the exact bytes for disk: original line ending, BOM kept.
 * For a file that was not edited this is byte-identical to what was read.
 */
export function encodeForDisk(text: string, base: Pick<LoadedFile, 'eol' | 'bom'>): Uint8Array {
  const lf = text.replace(/\r\n?/g, '\n');
  const out = base.eol === '\r\n' ? lf.replace(/\n/g, '\r\n') : lf;
  const body = new TextEncoder().encode(out);
  if (!base.bom) return body;
  const withBom = new Uint8Array(body.length + 3);
  withBom.set([0xef, 0xbb, 0xbf], 0);
  withBom.set(body, 3);
  return withBom;
}

export type SaveResult =
  | { ok: true; loaded: LoadedFile; wrote: boolean }
  | { ok: false; reason: 'permission' }
  /** The file on disk is not the one the edits were made against. Nothing was written. */
  | { ok: false; reason: 'conflict'; disk: LoadedFile }
  /** We wrote, but what is on disk afterwards is not what we wrote (someone else wrote too). */
  | { ok: false; reason: 'verify'; disk: LoadedFile }
  | { ok: false; reason: 'error'; message: string };

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * Saves `text` over the file that was loaded as `base`.
 * Order matters: permission, re-read, hash check, write via swap file, re-read and verify.
 * There is an unavoidable gap between the check and the commit on close; the verify step
 * after it reports a writer that slipped into that gap.
 */
export async function saveFile(
  handle: FileSystemFileHandle,
  base: LoadedFile,
  text: string,
): Promise<SaveResult> {
  if (!base.editable) return { ok: false, reason: 'error', message: 'This file is not valid UTF-8, so it is read-only.' };
  if (!(await hasWritePermission(handle))) return { ok: false, reason: 'permission' };

  let disk: LoadedFile;
  try {
    disk = await loadFile(handle);
  } catch (e) {
    return { ok: false, reason: 'error', message: `The file could not be read before saving: ${msg(e)}` };
  }
  if (disk.hash !== base.hash) return { ok: false, reason: 'conflict', disk };

  const bytes = encodeForDisk(text, base);
  const newHash = await sha256(bytes);
  if (newHash === base.hash) return { ok: true, loaded: disk, wrote: false };

  let writable: FileSystemWritableFileStream | undefined;
  try {
    writable = await handle.createWritable();
    await writable.write(bytes as BufferSource);
    await writable.close();
  } catch (e) {
    try {
      await writable?.abort();
    } catch {
      /* the original file is untouched until close succeeds */
    }
    return { ok: false, reason: 'error', message: `Saving failed, the file on disk is unchanged: ${msg(e)}` };
  }

  let after: LoadedFile;
  try {
    after = await loadFile(handle);
  } catch (e) {
    return { ok: false, reason: 'error', message: `Saved, but the file could not be re-read to verify it: ${msg(e)}` };
  }
  if (after.hash !== newHash) return { ok: false, reason: 'verify', disk: after };
  return { ok: true, loaded: after, wrote: true };
}
