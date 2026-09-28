'use strict';

(function initUi(YS) {
  const DEFAULTS = YS.DEFAULT_SETTINGS;
  const FIELDS = [
    ['like', 'Лайк, %', 0, 100],
    ['subscribe', 'Подписка, %', 0, 100],
    ['comment', 'Комментарий, %', 0, 100],
    ['recommended', 'Рекомендации, %', 0, 100],
    ['watchMin', 'Просмотр от, сек', 5, 600],
    ['watchMax', 'Просмотр до, сек', 5, 900],
    ['switchMin', 'Действий от', 1, 999],
    ['switchMax', 'Действий до', 1, 999],
  ];

  function create() {
    const state = {
      draft: '',
      queries: [],
      settings: { ...DEFAULTS },
      status: 'Ожидание',
      log: [],
      running: false,
      visible: false,
    };
    let onStart = () => {};
    let onStop = () => {};
    let onQueries = () => {};
    let onSettings = () => {};
    let root = null;
    let queryInput = null;
    let addBtn = null;
    let queriesEl = null;
    let queriesStamp = '';
    let startBtn = null;
    let stopBtn = null;
    let statusEl = null;
    let logEl = null;
    const inputs = {};

    function mount() {
      queriesStamp = '';
      root?.remove();
      for (const stale of document.querySelectorAll('[id="ys-root"]')) stale.remove();
      root = document.createElement('section');
      root.id = 'ys-root';
      root.setAttribute('role', 'region');
      root.setAttribute('aria-label', 'YouTube Serfer');
      root.className = 'ys-hidden';

      const head = document.createElement('div');
      head.className = 'ys-head';
      const title = document.createElement('div');
      title.className = 'ys-title';
      const dot = document.createElement('span');
      dot.className = 'ys-dot';
      dot.setAttribute('aria-hidden', 'true');
      const name = document.createElement('span');
      name.textContent = 'YouTube Serfer';
      title.append(dot, name);
      const close = document.createElement('button');
      close.type = 'button';
      close.className = 'ys-close';
      close.setAttribute('aria-label', 'Скрыть');
      close.textContent = '×';
      head.append(title, close);

      const label = document.createElement('div');
      label.className = 'ys-label';
      label.textContent = 'Запрос';
      const queryRow = document.createElement('div');
      queryRow.className = 'ys-query-row';
      queryInput = document.createElement('input');
      queryInput.type = 'text';
      queryInput.className = 'ys-query';
      queryInput.placeholder = 'подкаст';
      queryInput.maxLength = 200;
      queryInput.autocomplete = 'off';
      queryInput.spellcheck = false;
      queryInput.setAttribute('aria-label', 'Поисковый запрос');
      addBtn = document.createElement('button');
      addBtn.type = 'button';
      addBtn.className = 'ys-add';
      addBtn.setAttribute('aria-label', 'Добавить запрос');
      addBtn.textContent = '+';
      queryRow.append(queryInput, addBtn);
      queriesEl = document.createElement('div');
      queriesEl.className = 'ys-queries';

      const actions = document.createElement('div');
      actions.className = 'ys-actions';
      startBtn = document.createElement('button');
      startBtn.type = 'button';
      startBtn.className = 'ys-start';
      startBtn.textContent = 'Запустить';
      stopBtn = document.createElement('button');
      stopBtn.type = 'button';
      stopBtn.className = 'ys-stop';
      stopBtn.textContent = 'Стоп';
      actions.append(startBtn, stopBtn);

      const details = document.createElement('details');
      details.className = 'ys-settings';
      const summary = document.createElement('summary');
      summary.textContent = 'Вероятности';
      details.append(summary);
      for (const [key, caption, min, max] of FIELDS) {
        const row = document.createElement('label');
        row.className = 'ys-row';
        const captionEl = document.createElement('span');
        captionEl.textContent = caption;
        const input = document.createElement('input');
        input.type = 'number';
        input.min = String(min);
        input.max = String(max);
        input.step = '1';
        input.value = String(state.settings[key]);
        input.setAttribute('aria-label', caption);
        inputs[key] = input;
        row.append(captionEl, input);
        details.append(row);
      }

      statusEl = document.createElement('div');
      statusEl.className = 'ys-status';
      statusEl.setAttribute('aria-live', 'polite');
      logEl = document.createElement('div');
      logEl.className = 'ys-log';
      logEl.setAttribute('aria-live', 'polite');

      root.append(head, label, queryRow, queriesEl, actions, details, statusEl, logEl);
      document.documentElement.appendChild(root);

      for (const type of ['click', 'pointerdown', 'mousedown', 'mouseup', 'keydown', 'keyup']) {
        root.addEventListener(type, (event) => event.stopPropagation());
      }
      close.addEventListener('click', () => hide());
      startBtn.addEventListener('click', handleStart);
      stopBtn.addEventListener('click', () => onStop());
      addBtn.addEventListener('click', () => commitDraft());
      queryInput.addEventListener('input', () => {
        state.draft = queryInput.value;
      });
      queryInput.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        commitDraft();
      });
      for (const [key] of FIELDS) {
        inputs[key].addEventListener('input', () => {
          state.settings[key] = inputs[key].value;
          onSettings(getSettings());
        });
      }
      render();
    }

    function commitDraft() {
      const text = queryInput.value.trim().slice(0, 200);
      if (!text) {
        if (queryInput.value) {
          queryInput.value = '';
          state.draft = '';
        }
        return 'empty';
      }
      if (state.queries.some((item) => item.toLowerCase() === text.toLowerCase())) {
        queryInput.value = '';
        state.draft = '';
        return 'duplicate';
      }
      if (state.queries.length >= 30) {
        setStatus('Не больше 30 запросов');
        return 'full';
      }
      queryInput.value = '';
      state.draft = '';
      state.queries = YS.engine.normalizeQueries([...state.queries, text]);
      onQueries(getQueries());
      renderQueries();
      return 'added';
    }

    function removeQuery(text) {
      const key = text.toLowerCase();
      state.queries = state.queries.filter((item) => item.toLowerCase() !== key);
      onQueries(getQueries());
      renderQueries();
    }

    function renderQueries() {
      if (!queriesEl) return;
      const stamp = state.queries.join('\n');
      if (stamp === queriesStamp && queriesEl.childElementCount === state.queries.length) return;
      queriesStamp = stamp;
      queriesEl.replaceChildren();
      for (const text of state.queries) {
        const chip = document.createElement('div');
        chip.className = 'ys-chip';
        const label = document.createElement('span');
        label.className = 'ys-chip-text';
        label.textContent = text;
        label.title = text;
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'ys-chip-remove';
        remove.setAttribute('aria-label', 'Удалить запрос');
        remove.textContent = '×';
        remove.addEventListener('click', () => removeQuery(text));
        chip.append(label, remove);
        queriesEl.appendChild(chip);
      }
    }

    function handleStart() {
      const committed = commitDraft();
      if (committed === 'full') {
        queryInput.focus();
        return;
      }
      if (!state.queries.length) {
        setStatus('Добавьте запрос');
        queryInput.focus();
        return;
      }
      onStart(getQueries(), getSettings());
    }

    function render() {
      if (!root) return;
      root.classList.toggle('ys-hidden', !state.visible);
      root.classList.toggle('ys-running', state.running);
      statusEl.textContent = state.status;
      startBtn.disabled = state.running;
      stopBtn.disabled = !state.running;
      if (document.activeElement !== queryInput && queryInput.value !== state.draft) {
        queryInput.value = state.draft;
      }
      renderQueries();
      for (const [key] of FIELDS) {
        const input = inputs[key];
        const next = String(state.settings[key]);
        if (document.activeElement !== input && input.value !== next) input.value = next;
      }
      logEl.replaceChildren();
      for (const line of state.log) {
        const row = document.createElement('div');
        row.textContent = line;
        logEl.appendChild(row);
      }
      logEl.scrollTop = logEl.scrollHeight;
    }

    function show() {
      if (!root?.isConnected) mount();
      state.visible = true;
      render();
    }

    function hide() {
      state.visible = false;
      render();
      YS.session.set({ panelVisible: false }).catch(() => {});
    }

    function setStatus(text) {
      state.status = text;
      if (statusEl) statusEl.textContent = text;
    }

    function log(text) {
      const now = new Date();
      const stamp = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
      state.log.push(stamp + '  ' + text);
      if (state.log.length > 12) state.log.splice(0, state.log.length - 12);
      render();
    }

    function setRunning(running) {
      state.running = running;
      render();
    }

    function setQueries(queries) {
      state.queries = YS.engine.normalizeQueries(queries);
      queriesStamp = '';
      render();
    }

    function getQueries() {
      return state.queries.slice();
    }

    function setSettings(settings) {
      state.settings = { ...state.settings, ...settings };
      render();
    }

    function getSettings() {
      const settings = {};
      for (const [key] of FIELDS) {
        settings[key] = Number(inputs[key]?.value ?? state.settings[key]);
      }
      return settings;
    }

    function destroy() {
      root?.remove();
      root = null;
    }

    mount();

    return {
      mount,
      destroy,
      show,
      hide,
      setStatus,
      log,
      setRunning,
      setQueries,
      getQueries,
      setSettings,
      getSettings,
      onStart(callback) { onStart = callback; },
      onStop(callback) { onStop = callback; },
      onQueries(callback) { onQueries = callback; },
      onSettings(callback) { onSettings = callback; },
    };
  }

  YS.ui = { create };
})(globalThis.YS = globalThis.YS || {});
