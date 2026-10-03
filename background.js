chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== "inject-timing" || !sender.tab?.id) return;

  chrome.scripting
    .executeScript({
      target: { tabId: sender.tab.id },
      world: "MAIN",
      files: ["page-timing.js"]
    })
    .then(() => sendResponse({ ok: true }))
    .catch((error) => sendResponse({ ok: false, error: error.message }));

  return true;
});
