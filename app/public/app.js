const fields = ['like', 'subscribe', 'comment', 'recommended', 'watchMin', 'watchMax', 'switchMin', 'switchMax'];
const state = { queries: [], profiles: [], checked: new Set() };

const errorEl = document.querySelector('#error');
const profilesEl = document.querySelector('#profiles');
const queriesEl = document.querySelector('#queries');
const draftEl = document.querySelector('#draft');
const connectionEl = document.querySelector('#connection');
const dotEl = document.querySelector('#dot');

function showError(message) {
  errorEl.hidden = !message;
  errorEl.textContent = message || '';
}

async function request(url, body) {
  const response = await fetch(url, {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Ошибка');
  return data;
}

function settingsFromForm() {
  const settings = {};
  for (const key of fields) settings[key] = Number(document.querySelector(`#${key}`).value);
  return settings;
}

function setIfIdle(selector, value) {
  const input = document.querySelector(selector);
  if (document.activeElement !== input) input.value = value;
}

function applyConfig(config) {
  setIfIdle('#mcpPath', config.mcpPath || '');
  setIfIdle('#api', config.api || '');
  setIfIdle('#token', config.token || '');
  state.queries = Array.isArray(config.queries) ? config.queries.slice() : [];
  for (const key of fields) {
    const input = document.querySelector(`#${key}`);
    if (document.activeElement !== input) input.value = String(config.settings?.[key] ?? '');
  }
  renderQueries();
}

function renderQueries() {
  queriesEl.replaceChildren();
  for (const text of state.queries) {
    const chip = document.createElement('div');
    chip.className = 'chip';
    const label = document.createElement('span');
    label.textContent = text;
    label.title = text;
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.setAttribute('aria-label', 'Удалить запрос');
    remove.textContent = '×';
    remove.addEventListener('click', () => {
      state.queries = state.queries.filter((item) => item.toLowerCase() !== text.toLowerCase());
      renderQueries();
      saveSettings();
    });
    chip.append(label, remove);
    queriesEl.appendChild(chip);
  }
}

function renderProfiles() {
  const running = state.profiles.some((profile) => profile.running);
  dotEl.classList.toggle('on', running);
  profilesEl.replaceChildren();
  if (!state.profiles.length) {
    const empty = document.createElement('li');
    empty.className = 'muted';
    empty.textContent = 'Нет профилей в папках youtube';
    profilesEl.appendChild(empty);
    return;
  }
  for (const profile of state.profiles) {
    const item = document.createElement('li');
    item.className = 'account';
    const head = document.createElement('div');
    head.className = 'account-head';
    const label = document.createElement('label');
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = state.checked.has(profile.id);
    box.addEventListener('change', () => {
      if (box.checked) state.checked.add(profile.id);
      else state.checked.delete(profile.id);
    });
    const name = document.createElement('span');
    name.textContent = profile.name;
    label.append(box, name);
    const folder = document.createElement('span');
    folder.className = 'folder';
    folder.textContent = profile.folder;
    const status = document.createElement('span');
    status.className = 'status';
    status.textContent = profile.status || 'Ожидание';
    const stop = document.createElement('button');
    stop.type = 'button';
    stop.textContent = 'Стоп';
    stop.disabled = !profile.running;
    stop.addEventListener('click', () => request('/api/stop', { ids: [profile.id] }).then(applyState).catch((error) => showError(error.message)));
    head.append(label, folder, status, stop);
    item.appendChild(head);
    if (profile.log?.length) {
      const log = document.createElement('div');
      log.className = 'log';
      for (const line of profile.log) {
        const row = document.createElement('div');
        row.textContent = line;
        log.appendChild(row);
      }
      item.appendChild(log);
    }
    profilesEl.appendChild(item);
  }
}

function applyState(data) {
  applyConfig(data.config);
  state.profiles = data.profiles || [];
  connectionEl.textContent = data.connected ? `Подключено · профилей: ${state.profiles.length}` : 'Нет подключения';
  showError(data.connectError || '');
  renderProfiles();
}

async function saveSettings() {
  const data = await request('/api/settings', { queries: state.queries, settings: settingsFromForm() });
  applyState(data);
}

function addDraft() {
  const text = draftEl.value.trim().slice(0, 200);
  if (!text) return;
  draftEl.value = '';
  if (state.queries.some((item) => item.toLowerCase() === text.toLowerCase())) return;
  if (state.queries.length >= 30) {
    showError('Не больше 30 запросов');
    return;
  }
  state.queries.push(text);
  renderQueries();
  saveSettings().catch((error) => showError(error.message));
}

document.querySelector('#add').addEventListener('click', addDraft);
draftEl.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter') return;
  event.preventDefault();
  addDraft();
});

for (const key of fields) {
  document.querySelector(`#${key}`).addEventListener('change', () => {
    saveSettings().catch((error) => showError(error.message));
  });
}

document.querySelector('#connect').addEventListener('click', () => {
  request('/api/connect', {
    mcpPath: document.querySelector('#mcpPath').value,
    api: document.querySelector('#api').value,
    token: document.querySelector('#token').value,
  }).then(applyState).catch((error) => showError(error.message));
});

document.querySelector('#refresh').addEventListener('click', () => {
  request('/api/profiles/refresh', {}).then(applyState).catch((error) => showError(error.message));
});

document.querySelector('#start').addEventListener('click', async () => {
  if (draftEl.value.trim()) addDraft();
  const ids = [...state.checked];
  if (!ids.length) {
    showError('Отметьте аккаунт');
    return;
  }
  try {
    await saveSettings();
    applyState(await request('/api/start', { ids }));
  } catch (error) {
    showError(error.message);
  }
});

document.querySelector('#stopAll').addEventListener('click', () => {
  request('/api/stop', { ids: [] }).then(applyState).catch((error) => showError(error.message));
});

async function poll() {
  try {
    applyState(await request('/api/state'));
  } catch (error) {
    showError(error.message);
  }
}

poll();
setInterval(poll, 1500);
