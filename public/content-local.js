// Runs on local markdown files (file://…md) that Chrome shows as plain text, for example a file
// dropped onto a tab. Extension pages may not read file:// addresses, but this page already has
// the text: hand it to the background page, which opens it in the viewer.
// Needs "Allow access to file URLs"; without it Chrome never runs this and shows the plain text.
if (document.contentType !== 'text/html') {
  // Reached with Back (from the viewer): keep going back instead of opening the viewer again.
  const nav = performance.getEntriesByType('navigation')[0];
  if (nav?.type === 'back_forward') {
    history.back();
  } else {
    const text = document.querySelector('body > pre')?.textContent ?? document.body?.innerText ?? '';
    chrome.runtime.sendMessage({ type: 'local-md', text });
  }
  // Same when Chrome restores this page from its back/forward cache, where scripts do not re-run.
  addEventListener('pageshow', (e) => {
    if (e.persisted) history.back();
  });
}
