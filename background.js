'use strict';

function unlockSessionStorage() {
  return chrome.storage.session
    .setAccessLevel({ accessLevel: 'TRUSTED_AND_UNTRUSTED_CONTEXTS' })
    .catch(() => {});
}

unlockSessionStorage();

chrome.runtime.onStartup.addListener(() => chrome.storage.local.remove('ysSession'));

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== 'UNLOCK_SESSION_STORAGE') return false;
  unlockSessionStorage().then(() => sendResponse({ ok: true }));
  return true;
});

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason !== 'install') return undefined;
  return openPanel();
});

chrome.action.onClicked.addListener(() => openPanel());

chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (info.status !== 'complete') return undefined;
  if (!tab.url?.startsWith('https://www.youtube.com/')) return undefined;
  return chrome.storage.session.get('panelVisible').then(({ panelVisible }) => {
    if (!panelVisible) return undefined;
    return chrome.tabs.sendMessage(tabId, { type: 'SHOW_PANEL' }).catch(() => {});
  });
});

async function openPanel() {
  await unlockSessionStorage();
  await chrome.storage.session.set({ panelVisible: true });
  const tabs = await chrome.tabs.query({ url: 'https://www.youtube.com/*' });
  let tab = tabs.find((item) => item.active) || tabs[0];
  if (tab?.id != null) {
    await chrome.tabs.update(tab.id, { active: true });
    if (tab.windowId != null) {
      await chrome.windows.update(tab.windowId, { focused: true }).catch(() => {});
    }
  } else {
    tab = await chrome.tabs.create({ url: 'https://www.youtube.com/' });
  }
  if (tab?.id != null) await showInTab(tab.id);
}

async function showInTab(tabId) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await chrome.tabs.sendMessage(tabId, { type: 'SHOW_PANEL' });
      return;
    } catch {
      await delay(400);
    }
  }
  try {
    await chrome.scripting.insertCSS({ target: { tabId }, files: ['content/ui.css'] });
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content/store.js', 'content/dom.js', 'content/engine.js', 'content/ui.js', 'content/content.js'],
    });
    await chrome.tabs.sendMessage(tabId, { type: 'SHOW_PANEL' });
  } catch {
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (tab?.status === 'complete') await chrome.tabs.reload(tabId);
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
