// Toolbar button opens the viewer page in a new tab.
chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({ url: chrome.runtime.getURL('viewer.html') });
});

const viewerFor = (url) => `${chrome.runtime.getURL('viewer.html')}?url=${encodeURIComponent(url)}`;

// Any tab that navigates to a markdown file on the web opens it in the viewer instead.
// The redirect happens before the page commits, so Back returns to the page before it.
// On code hosts a .md address is usually an HTML page (blob/src view), so only their raw-file
// addresses are caught: gitlab.com/…/-/raw/…, github.com/…/raw/…, bitbucket.org/…/raw/….
// Local file:// pages are not caught here: the viewer may not read them, so content-local.js
// takes the text from the loaded page instead (see below).
const MD_PATH = /\.(md|markdown|mdown|mkd)$/i;
const HTML_HOSTS = new Set(['github.com', 'gitlab.com', 'bitbucket.org']);

chrome.webNavigation.onBeforeNavigate.addListener(
  ({ tabId, frameId, url }) => {
    if (frameId !== 0) return;
    let u;
    try {
      u = new URL(url);
    } catch {
      return;
    }
    if (!MD_PATH.test(u.pathname)) return;
    if (HTML_HOSTS.has(u.hostname) && !u.pathname.includes('/raw/')) return;
    chrome.tabs.update(tabId, { url: viewerFor(url) });
  },
  { url: [{ schemes: ['http', 'https'] }] },
);

// Text of a local markdown file, sent by content-local.js. It is kept in session storage under
// the file's address (sender.url, set by Chrome, not by the page) for the viewer to pick up.
chrome.runtime.onMessage.addListener((msg, sender) => {
  const tabId = sender.tab?.id;
  if (msg?.type !== 'local-md' || typeof msg.text !== 'string' || !tabId || !sender.url?.startsWith('file:')) return;
  chrome.storage.session
    .set({ [`file:${sender.url}`]: msg.text })
    .then(() => chrome.tabs.update(tabId, { url: viewerFor(sender.url) }));
});
