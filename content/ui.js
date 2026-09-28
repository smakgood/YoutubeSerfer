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
  ];

  function create() {
    const state = {
      query: '',
      settings: { ...DEFAULTS },
      status: 'Ожидание',
      log: [],
      running: false,
      visible: false,
    };
    let onStart = () => {};
    let onStop = () => {};
    let onQuery = () => {};
    let onSettings = () => {};
    let root = null;
    let queryInput = null;
    let startBtn = null;
    let stopBtn = null;
    let statusEl = null;
    let logEl = null;
    const inputs = {};

    function mount() {
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

      const label = document.createElement('label');
      label.className = 'ys-label';
      label.textContent = 'Запрос';
      queryInput = document.createElement('input');
      queryInput.type = 'text';
      queryInput.className = 'ys-query';
      queryInput.placeholder = 'подкаст';
      queryInput.maxLength = 200;
      queryInput.autocomplete = 'off';
      queryInput.spellcheck = false;
      queryInput.setAttribute('aria-label', 'Поисковый запрос');
      label.append(queryInput);

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

      root.append(head, label, actions, details, statusEl, logEl);
      document.documentElement.appendChild(root);

      for (const type of ['click', 'pointerdown', 'mousedown', 'mouseup', 'keydown', 'keyup']) {
        root.addEventListener(type, (event) => event.stopPropagation());
      }
      close.addEventListener('click', () => hide());
      startBtn.addEventListener('click', handleStart);
      stopBtn.addEventListener('click', () => onStop());
      queryInput.addEventListener('input', () => {
        state.query = queryInput.value;
        onQuery(state.query);
      });
      queryInput.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') handleStart();
      });
      for (const [key] of FIELDS) {
        inputs[key].addEventListener('input', () => {
          state.settings[key] = inputs[key].value;
          onSettings(getSettings());
        });
      }
      render();
    }

    function handleStart() {
      const query = queryInput.value.trim();
      state.query = query;
      queryInput.value = query;
      if (!query) {
        setStatus('Введите запрос');
        queryInput.focus();
        return;
      }
      onStart(query, getSettings());
    }

    function render() {
      if (!root) return;
      root.classList.toggle('ys-hidden', !state.visible);
      root.classList.toggle('ys-running', state.running);
      statusEl.textContent = state.status;
      startBtn.disabled = state.running;
      stopBtn.disabled = !state.running;
      queryInput.disabled = state.running;
      if (document.activeElement !== queryInput && queryInput.value !== state.query) {
        queryInput.value = state.query;
      }
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

    function setQuery(query) {
      state.query = query || '';
      render();
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
      setQuery,
      setSettings,
      getSettings,
      onStart(callback) { onStart = callback; },
      onStop(callback) { onStop = callback; },
      onQuery(callback) { onQuery = callback; },
      onSettings(callback) { onSettings = callback; },
    };
  }

  YS.ui = { create };
})(globalThis.YS = globalThis.YS || {});
