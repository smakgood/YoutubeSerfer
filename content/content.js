'use strict';

(function initContent() {
  if (globalThis.__YS_BOOTED) return;
  globalThis.__YS_BOOTED = true;

  const YS = globalThis.YS;
  // After the extension is reloaded, the previous copy keeps running in the tab.
  document.dispatchEvent(new CustomEvent('ys-takeover'));
  const ui = YS.ui.create();
  let forceShow = false;
  let disposed = false;

  document.addEventListener('ys-takeover', () => {
    disposed = true;
    YS.engine.stop();
    ui.destroy();
  }, { once: true });

  ui.onStart((query, settings) => {
    chrome.storage.local.set({ query, settings }).catch(() => {});
    YS.engine.start({
      query,
      getSettings: () => ui.getSettings(),
      ui,
      resume: false,
      seenIds: [],
      searchUrl: '',
    });
  });

  ui.onStop(() => YS.engine.stop());

  ui.onQuery((query) => {
    chrome.storage.local.set({ query }).catch(() => {});
  });

  ui.onSettings((settings) => {
    chrome.storage.local.set({ settings }).catch(() => {});
  });

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === 'SHOW_PANEL' && !disposed) {
      forceShow = true;
      ui.show();
    }
  });

  document.addEventListener('yt-navigate-finish', () => {
    if (disposed) return;
    if (!document.getElementById('ys-root')) ui.mount();
    // YouTube navigates without reloading the content script.
    // A running loop keeps going; this listener must not start a second one.
  });

  restore();

  async function restore() {
    const [session, local] = await Promise.all([
      YS.session.get([
        'panelVisible',
        'running',
        'owner',
        'query',
        'settings',
        'seenIds',
        'searchUrl',
      ]),
      chrome.storage.local.get(['query', 'settings']),
    ]);

    if (local.settings) ui.setSettings(local.settings);
    if (session.settings) ui.setSettings(session.settings);
    ui.setQuery(session.query || local.query || '');

    if (session.panelVisible || forceShow) ui.show();

    const seenIds = Array.isArray(session.seenIds) ? session.seenIds : [];
    const searchUrl = typeof session.searchUrl === 'string' ? session.searchUrl : '';
    if (session.running && session.query && session.owner === YS.engine.tabToken && !YS.engine.isRunning()) {
      YS.engine.start({
        query: session.query,
        getSettings: () => ui.getSettings(),
        ui,
        resume: true,
        seenIds,
        searchUrl,
      });
    }
  }
})();
