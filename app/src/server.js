import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { createMcp } from './mcp.js';
import { createRunner } from './runner.js';
import { loadConfig, saveConfig } from './store.js';
import { normalizeQueries, normalizeSettings } from './settings.js';

const publicDir = path.join(import.meta.dirname, '..', 'public');
const port = Number(process.env.PORT) || 8787;
const mcp = createMcp();
const runners = new Map();
let profiles = [];
let connectError = '';

function send(res, status, body, type = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', reject);
  });
}

function accountView(profile) {
  const runner = runners.get(profile.id);
  const snap = runner?.snapshot() ?? { running: false, status: 'Ожидание', log: [] };
  return {
    id: profile.id,
    name: profile.name,
    folder: profile.folder,
    running: snap.running,
    status: snap.status,
    log: snap.log,
  };
}

function statePayload() {
  const config = loadConfig();
  return {
    connected: mcp.connected(),
    connectError,
    config,
    profiles: profiles.map(accountView),
  };
}

async function refreshProfiles() {
  profiles = await mcp.listProfiles();
  connectError = '';
  return profiles;
}

async function connectFromConfig() {
  const config = loadConfig();
  await mcp.connect(config);
  await refreshProfiles();
}

function startProfiles(ids) {
  const config = loadConfig();
  if (!normalizeQueries(config.queries).length) {
    const error = new Error('Добавьте запрос');
    error.status = 400;
    throw error;
  }
  const chosen = profiles.filter((profile) => ids.includes(profile.id));
  for (const profile of chosen) {
    const existing = runners.get(profile.id);
    if (existing?.snapshot().running) continue;
    const runner = createRunner({
      id: profile.id,
      name: profile.name,
      mcp,
      getConfig: loadConfig,
      onUpdate: () => {},
    });
    runners.set(profile.id, runner);
    runner.start();
  }
}

function stopProfiles(ids) {
  const targets = ids?.length ? ids : [...runners.keys()];
  for (const id of targets) runners.get(id)?.stop();
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    if (req.method === 'GET' && url.pathname === '/api/state') {
      send(res, 200, JSON.stringify(statePayload()));
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/connect') {
      const body = await readBody(req);
      saveConfig({
        mcpPath: String(body.mcpPath || loadConfig().mcpPath),
        api: String(body.api || loadConfig().api),
        token: String(body.token ?? loadConfig().token),
      });
      await connectFromConfig();
      send(res, 200, JSON.stringify(statePayload()));
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/profiles/refresh') {
      await refreshProfiles();
      send(res, 200, JSON.stringify(statePayload()));
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/settings') {
      const body = await readBody(req);
      saveConfig({
        queries: normalizeQueries(body.queries),
        settings: normalizeSettings(body.settings),
      });
      send(res, 200, JSON.stringify(statePayload()));
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/start') {
      const body = await readBody(req);
      const ids = Array.isArray(body.ids) ? body.ids.map(String) : [];
      startProfiles(ids);
      send(res, 200, JSON.stringify(statePayload()));
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/stop') {
      const body = await readBody(req);
      const ids = Array.isArray(body.ids) ? body.ids.map(String) : [];
      stopProfiles(ids);
      send(res, 200, JSON.stringify(statePayload()));
      return;
    }
    if (req.method === 'GET') {
      const relative = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
      const filePath = path.resolve(publicDir, relative);
      if (path.relative(publicDir, filePath).startsWith('..')) {
        send(res, 403, JSON.stringify({ error: 'Запрещено' }));
        return;
      }
      const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };
      try {
        const body = fs.readFileSync(filePath);
        send(res, 200, body, types[path.extname(filePath)] || 'application/octet-stream');
      } catch {
        send(res, 404, 'Не найдено', 'text/plain; charset=utf-8');
      }
      return;
    }
    send(res, 404, JSON.stringify({ error: 'Не найдено' }));
  } catch (error) {
    const status = error.status || 500;
    if (status >= 500) connectError = error.message || 'Ошибка';
    send(res, status, JSON.stringify({ error: error.message || 'Ошибка', ...statePayload() }));
  }
});

server.listen(port, '127.0.0.1', () => {
  console.log(`YouTube Serfer: http://127.0.0.1:${port}`);
});
