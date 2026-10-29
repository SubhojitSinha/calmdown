// The recent list: FileSystemFileHandles for local files and URLs for online ones, in IndexedDB.
// Handles are structured-cloneable but cannot live in chrome.storage, so this is the only
// place that touches IndexedDB.

export interface RecentFile {
  id: string;
  name: string;
  openedAt: number;
  /** A local file has a handle; an online file has its URL instead. */
  handle?: FileSystemFileHandle;
  url?: string;
  /** "Folder/sub/file.md" when the file was opened from a folder; Chrome gives no disk path otherwise. */
  path?: string;
}

const DB_NAME = 'md-reader';
const STORE = 'recent';
const MAX_RECENT = 12;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(STORE, mode);
        const req = run(t.objectStore(STORE));
        t.oncomplete = () => {
          db.close();
          resolve(req.result);
        };
        t.onerror = () => {
          db.close();
          reject(t.error);
        };
      }),
  );
}

export async function listRecent(): Promise<RecentFile[]> {
  const all = await tx<RecentFile[]>('readonly', (s) => s.getAll());
  return all.sort((a, b) => b.openedAt - a.openedAt);
}

/** Adds or refreshes a handle. The same file picked twice stays one entry (isSameEntry). */
export async function rememberFile(handle: FileSystemFileHandle, path?: string): Promise<RecentFile> {
  const existing = await listRecent();
  let id: string = crypto.randomUUID();
  let known: string | undefined;
  for (const r of existing) {
    if (r.handle && (await r.handle.isSameEntry(handle))) {
      id = r.id;
      known = r.path; // opened from a folder before: keep showing where it lives
      break;
    }
  }
  return remember({ id, name: handle.name, openedAt: Date.now(), handle, path: path ?? known });
}

/** Adds or refreshes an online file; the URL is its id, so it is never listed twice. */
export async function rememberUrl(url: string): Promise<RecentFile> {
  return remember({ id: `url:${url}`, name: nameFromUrl(url), openedAt: Date.now(), url });
}

/** The file name at the end of a URL's path, or its host when the path has none. */
export function nameFromUrl(url: string): string {
  const u = new URL(url);
  const last = u.pathname.split('/').pop() ?? '';
  try {
    return decodeURIComponent(last) || u.host;
  } catch {
    return last || u.host;
  }
}

async function remember(entry: RecentFile): Promise<RecentFile> {
  await tx('readwrite', (s) => s.put(entry));
  const after = await listRecent();
  for (const stale of after.slice(MAX_RECENT)) {
    await tx('readwrite', (s) => s.delete(stale.id));
  }
  return entry;
}

export async function forgetFile(id: string): Promise<void> {
  await tx('readwrite', (s) => s.delete(id));
}

/** Empties the recent list. The files themselves are untouched. */
export async function forgetAll(): Promise<void> {
  await tx('readwrite', (s) => s.clear());
}
