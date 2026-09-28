import path from 'node:path';

export const DEFAULT_SETTINGS = Object.freeze({
  like: 25,
  subscribe: 8,
  comment: 5,
  recommended: 60,
  watchMin: 20,
  watchMax: 180,
  switchMin: 1,
  switchMax: 1,
});

export const DEFAULT_CONFIG = {
  mcpPath: path.join(import.meta.dirname, '..', '..', 'mcp', 'index.js'),
  api: 'http://127.0.0.1:40325',
  token: '',
  queries: [],
  settings: { ...DEFAULT_SETTINGS },
};

export function normalizeSettings(raw) {
  const defaults = DEFAULT_SETTINGS;
  const source = raw || {};
  const percent = (key) => {
    const value = Number(source[key]);
    if (!Number.isFinite(value)) return defaults[key];
    return Math.min(100, Math.max(0, Math.round(value)));
  };
  let watchMin = Number(source.watchMin);
  let watchMax = Number(source.watchMax);
  if (!Number.isFinite(watchMin)) watchMin = defaults.watchMin;
  if (!Number.isFinite(watchMax)) watchMax = defaults.watchMax;
  watchMin = Math.min(600, Math.max(5, Math.round(watchMin)));
  watchMax = Math.min(900, Math.max(5, Math.round(watchMax)));
  if (watchMax < watchMin) watchMax = watchMin;
  const count = (key) => {
    const value = Number(source[key]);
    if (!Number.isFinite(value)) return defaults[key];
    return Math.min(999, Math.max(1, Math.round(value)));
  };
  let switchMin = count('switchMin');
  let switchMax = count('switchMax');
  if (switchMax < switchMin) switchMax = switchMin;
  return {
    like: percent('like'),
    subscribe: percent('subscribe'),
    comment: percent('comment'),
    recommended: percent('recommended'),
    watchMin,
    watchMax,
    switchMin,
    switchMax,
  };
}

export function normalizeQueries(raw) {
  const source = Array.isArray(raw) ? raw : [];
  const seen = new Set();
  const result = [];
  for (const item of source) {
    const text = String(item ?? '').trim().slice(0, 200);
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(text);
    if (result.length >= 30) break;
  }
  return result;
}

export function folderName(profile) {
  const folder = profile?.folder
    ?? profile?._meta?.folder
    ?? profile?.folder_name
    ?? profile?.folderName
    ?? profile?.group
    ?? '';
  if (folder && typeof folder === 'object') {
    return String(folder.name ?? folder.title ?? folder.id ?? '');
  }
  return String(folder || '');
}

export function isYoutubeProfile(profile) {
  return folderName(profile).toLowerCase().includes('youtube');
}

export function profileLabel(profile) {
  return String(profile?.name ?? profile?.title ?? profile?.id ?? 'Профиль');
}

export function profileId(profile) {
  return String(profile?.id ?? profile?.profile_id ?? profile?._meta?.id ?? '');
}
