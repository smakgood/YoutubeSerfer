import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_CONFIG, normalizeQueries, normalizeSettings } from './settings.js';

const filePath = path.join(import.meta.dirname, '..', 'data.json');

function readRaw() {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return {};
  }
}

export function loadConfig() {
  const raw = readRaw();
  return {
    mcpPath: String(raw.mcpPath || DEFAULT_CONFIG.mcpPath),
    api: String(raw.api || DEFAULT_CONFIG.api),
    token: String(raw.token || ''),
    queries: normalizeQueries(raw.queries),
    settings: normalizeSettings(raw.settings),
  };
}

export function saveConfig(patch) {
  const next = { ...loadConfig(), ...patch };
  next.queries = normalizeQueries(next.queries);
  next.settings = normalizeSettings(next.settings);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(next, null, 2));
  return next;
}
