'use strict';

(function initStore(YS) {
  const FALLBACK_KEY = 'ysSession';
  let mode = null;

  async function sessionWorks() {
    try {
      await chrome.storage.session.get('panelVisible');
      return true;
    } catch {
      return false;
    }
  }

  async function resolveMode() {
    if (mode) return mode;
    if (await sessionWorks()) {
      mode = 'session';
      return mode;
    }
    try {
      await chrome.runtime.sendMessage({ type: 'UNLOCK_SESSION_STORAGE' });
    } catch {
      // The background worker may be asleep or blocked by the browser.
    }
    mode = (await sessionWorks()) ? 'session' : 'local';
    return mode;
  }

  async function readFallback() {
    const data = await chrome.storage.local.get(FALLBACK_KEY);
    return data[FALLBACK_KEY] || {};
  }

  async function get(keys) {
    if ((await resolveMode()) === 'session') return chrome.storage.session.get(keys);
    const all = await readFallback();
    const list = Array.isArray(keys) ? keys : [keys];
    const result = {};
    for (const key of list) {
      if (key in all) result[key] = all[key];
    }
    return result;
  }

  async function set(values) {
    if ((await resolveMode()) === 'session') return chrome.storage.session.set(values);
    const all = await readFallback();
    await chrome.storage.local.set({ [FALLBACK_KEY]: { ...all, ...values } });
    return undefined;
  }

  YS.session = { get, set };
})(globalThis.YS = globalThis.YS || {});
