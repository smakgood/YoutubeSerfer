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

  ui.onStart((queries, settings) => {
    const saved = YS.engine.normalizeQueries(queries);
    chrome.storage.local.set({ queries: saved, query: saved[0] || '', settings }).catch(() => {});
    YS.engine.start({
      query: '',
      queries: saved,
      getQueries: () => ui.getQueries(),
      getSettings: () => ui.getSettings(),
      ui,
      resume: false,
      seenIds: [],
      searchUrl: '',
    });
  });

  ui.onStop(() => YS.engine.stop());

  ui.onQueries((queries) => {
    const saved = YS.engine.normalizeQueries(queries);
    chrome.storage.local.set({ queries: saved, query: saved[0] || '' }).catch(() => {});
    YS.session.set({ queries: saved }).catch(() => {});
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

  function storedQueries(session, local) {
    if (Array.isArray(session.queries)) return session.queries;
    if (Array.isArray(local.queries)) return local.queries;
    const single = String(session.query || local.query || '').trim();
    return single ? [single] : [];
  }

  async function restore() {
    const [session, local] = await Promise.all([
      YS.session.get([
        'panelVisible',
        'running',
        'owner',
        'query',
        'queries',
        'settings',
        'seenIds',
        'searchUrl',
        'actionsOnQuery',
        'switchAfter',
      ]),
      chrome.storage.local.get(['query', 'queries', 'settings']),
    ]);

    if (local.settings) ui.setSettings(local.settings);
    if (session.settings) ui.setSettings(session.settings);
    ui.setQueries(storedQueries(session, local));

    if (session.panelVisible || forceShow) ui.show();

    const seenIds = Array.isArray(session.seenIds) ? session.seenIds : [];
    const searchUrl = typeof session.searchUrl === 'string' ? session.searchUrl : '';
    if (session.running && ui.getQueries().length && session.owner === YS.engine.tabToken && !YS.engine.isRunning()) {
      YS.engine.start({
        query: session.query || '',
        queries: ui.getQueries(),
        getQueries: () => ui.getQueries(),
        getSettings: () => ui.getSettings(),
        ui,
        resume: true,
        seenIds,
        searchUrl,
        actionsOnQuery: session.actionsOnQuery,
        switchAfter: session.switchAfter,
      });
    }
  }
})();
