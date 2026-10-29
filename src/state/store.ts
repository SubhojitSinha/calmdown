// Tiny key-value layer: chrome.storage.local inside the extension, localStorage as a
// fallback so the page (and the tests) also work outside an extension context.
// Every call is best effort: a storage failure must never block reading.

function hasChromeStorage(): boolean {
  return typeof chrome !== 'undefined' && !!chrome.storage?.local;
}

export async function kvGet<T>(key: string): Promise<T | undefined> {
  try {
    if (hasChromeStorage()) {
      const got = await chrome.storage.local.get(key);
      return got[key] as T | undefined;
    }
    const raw = localStorage.getItem(key);
    return raw === null ? undefined : (JSON.parse(raw) as T);
  } catch {
    return undefined;
  }
}

export async function kvSet(key: string, value: unknown): Promise<void> {
  try {
    if (hasChromeStorage()) await chrome.storage.local.set({ [key]: value });
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* ignore */
  }
}
