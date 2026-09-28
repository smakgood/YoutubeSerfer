'use strict';

(function initEngine(YS) {
  YS.DEFAULT_SETTINGS = Object.freeze({
    like: 25,
    subscribe: 8,
    comment: 5,
    recommended: 60,
    watchMin: 20,
    watchMax: 180,
    switchMin: 1,
    switchMax: 1,
  });

  const tabToken = (() => {
    const key = 'ys-tab-id';
    try {
      let id = sessionStorage.getItem(key);
      if (!id) {
        id = crypto.randomUUID();
        sessionStorage.setItem(key, id);
      }
      return id;
    } catch {
      return crypto.randomUUID();
    }
  })();

  let controller = null;
  let generation = 0;
  let storageQueue = Promise.resolve();

function enqueueStorage(task) {
  storageQueue = storageQueue.then(task, () => task());
  return storageQueue;
}

  function normalizeSettings(raw) {
    const defaults = YS.DEFAULT_SETTINGS;
    const source = raw || {};
    const percent = (key) => {
      const value = Number(source[key]);
      if (!Number.isFinite(value)) return defaults[key];
      return Math.min(100, Math.max(0, value));
    };
    let watchMin = Number(source.watchMin);
    let watchMax = Number(source.watchMax);
    if (!Number.isFinite(watchMin)) watchMin = defaults.watchMin;
    if (!Number.isFinite(watchMax)) watchMax = defaults.watchMax;
    watchMin = Math.min(600, Math.max(5, watchMin));
    watchMax = Math.min(900, Math.max(5, watchMax));
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

  function normalizeQueries(raw) {
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

  function chance(percent) {
    return Math.random() * 100 < percent;
  }

  function watchMs(minSec, maxSec) {
    const unit = (Math.random() + Math.random() + Math.random()) / 3;
    return Math.round((minSec + unit * (maxSec - minSec)) * 1000);
  }

  function start(options) {
    if (controller) return;
    const gen = ++generation;
    const active = new AbortController();
    const halt = { localStop: false, status: '' };
    controller = active;
    controller.requestStop = () => {
      halt.localStop = true;
    };

    run(active.signal, options, gen, halt).catch((error) => {
      if (generation !== gen) return;
      if (error?.name === 'AbortError') return;
      options.ui.log(error?.message || 'Сбой серфинга');
    }).finally(() => enqueueStorage(async () => {
      if (controller === active) controller = null;
      if (generation !== gen) return;
      options.ui.setRunning(false);
      if (!halt.localStop) return;
      await YS.session.set({ running: false });
      if (halt.status) {
        options.ui.setStatus(halt.status);
        return;
      }
      options.ui.setStatus('Остановлено');
      options.ui.log('Остановлено');
    }));
  }

  function stop() {
    if (!controller) return;
    controller.requestStop?.();
    const active = controller;
    controller = null;
    active.abort();
  }

  function isRunning() {
    return Boolean(controller);
  }

  async function run(signal, options, gen, halt) {
    const ui = options.ui;
    const seen = new Set(Array.isArray(options.seenIds) ? options.seenIds : []);
    let query = '';
    let searchUrl = typeof options.searchUrl === 'string' ? options.searchUrl : '';
    let emptyPasses = 0;
    let actionsOnQuery = 0;
    let switchAfter = 0;

    function readQueries() {
      return normalizeQueries(options.getQueries?.() ?? options.queries);
    }

    function pickQuery(avoid) {
      const list = readQueries();
      if (!list.length) return '';
      const avoidKey = String(avoid || '').trim().toLowerCase();
      const others = avoidKey
        ? list.filter((item) => item.toLowerCase() !== avoidKey)
        : list;
      const pool = others.length ? others : list;
      return pool[Math.floor(Math.random() * pool.length)];
    }

    function stopForEmptyQueries() {
      halt.status = 'Добавьте запрос';
      halt.localStop = true;
      throw YS.dom.abortError();
    }

    const settingsNow = () => normalizeSettings(options.getSettings?.());

    function persist() {
      return enqueueStorage(async () => {
        if (generation !== gen || signal.aborted) return;
        const settings = settingsNow();
        const queries = readQueries();
        await YS.session.set({
          running: true,
          owner: tabToken,
          query,
          queries,
          settings,
          seenIds: [...seen].slice(-300),
          searchUrl,
          actionsOnQuery,
          switchAfter,
        });
        await chrome.storage.local.set({ query, queries, settings });
      });
    }

    function onSavedResults() {
      if (YS.dom.isResultsPage(query)) return true;
      if (!searchUrl || location.pathname !== '/results') return false;
      try {
        const savedQuery = new URL(searchUrl, location.origin).searchParams.get('search_query') || '';
        const currentQuery = new URL(location.href).searchParams.get('search_query') || '';
        return savedQuery.trim().toLowerCase() === currentQuery.trim().toLowerCase() && savedQuery.trim().length > 0;
      } catch {
        return false;
      }
    }

    function remember(id) {
      if (!id || seen.has(id)) return;
      seen.add(id);
      while (seen.size > 300) {
        const oldest = seen.values().next().value;
        seen.delete(oldest);
      }
    }

    function rememberSearchUrl() {
      if (location.pathname !== '/results') return;
      searchUrl = location.href;
    }

    async function assertOwner() {
      const data = await YS.session.get('owner');
      if (data.owner && data.owner !== tabToken) {
        ui.log('Сессия идёт в другой вкладке');
        throw YS.dom.abortError();
      }
    }

    async function ensureResults() {
      if (onSavedResults()) return;
      if (searchUrl) {
        ui.setStatus('Возвращаюсь к выдаче');
        try {
          await YS.dom.goTo(searchUrl, signal);
          await YS.dom.waitFor(() => onSavedResults(), 10000, signal);
          return;
        } catch (error) {
          if (error.name === 'AbortError') throw error;
        }
      }
      ui.setStatus('Печатаю запрос');
      ui.log('Ищу «' + query + '»');
      const previousHref = location.href;
      await YS.dom.typeAndSubmit(query, signal);
      await YS.dom.waitFor(
        () => YS.dom.isResultsPage(query) || YS.dom.hasNavigatedToResults(previousHref),
        12000,
        signal,
      );
    }

    async function watchCurrent() {
      await YS.dom.waitFor(() => location.pathname === '/watch' && document.querySelector('video'), 15000, signal);
      const settings = settingsNow();
      const total = watchMs(settings.watchMin, settings.watchMax);
      const started = Date.now();
      await YS.dom.waitFor(() => YS.dom.videoTitle(), 5000, signal).catch((error) => {
        if (error.name === 'AbortError') throw error;
      });
      const title = YS.dom.videoTitle();
      ui.setStatus('Смотрю видео');
      ui.log('Смотрю «' + (title || 'видео') + '» · ~' + Math.round(total / 1000) + ' с');
      await YS.dom.sleep(YS.dom.rand(1000, 3500), signal);
      await YS.dom.ensurePlaying();
      await maybeInteract(settings);
      const left = total - (Date.now() - started);
      if (left > 500) await browseWhileWatching(left);
    }

    async function maybeInteract(settings) {
      if (chance(settings.like)) {
        ui.log(await YS.dom.like(signal));
        await YS.dom.sleep(YS.dom.rand(400, 1400), signal);
      }
      if (chance(settings.subscribe)) {
        ui.log(await YS.dom.subscribe(signal));
        await YS.dom.sleep(YS.dom.rand(400, 1400), signal);
      }
      if (chance(settings.comment)) {
        ui.log(await YS.dom.comment(signal));
        await YS.dom.sleep(YS.dom.rand(400, 1400), signal);
      }
    }

    async function browseWhileWatching(ms) {
      const end = Date.now() + ms;
      while (Date.now() < end) {
        let slice = Math.min(end - Date.now(), YS.dom.rand(1000, 8000));
        if (Math.random() < 0.12) slice = Math.min(end - Date.now(), slice + YS.dom.rand(3000, 8000));
        if (slice < 200) break;
        await YS.dom.sleep(slice, signal);
        if (Date.now() >= end) break;
        const roll = Math.random();
        if (roll < 0.5) await YS.dom.stepScroll(YS.dom.rand(220, 640), signal);
        else if (roll < 0.7) await YS.dom.stepScroll(-YS.dom.rand(80, 280), signal);
      }
    }

    async function followRecommendations() {
      let hops = 0;
      while (hops < 3 && !signal.aborted) {
        const settings = settingsNow();
        if (!chance(settings.recommended)) return;
        ui.setStatus('Листаю рекомендации');
        await YS.dom.stepScroll(YS.dom.rand(280, 700), signal);
        await YS.dom.sleep(YS.dom.rand(400, 900), signal);
        const visible = YS.dom.pickVideoLink(YS.dom.relatedRoots(), { visibleOnly: true, seen });
        const link = visible || YS.dom.pickVideoLink(YS.dom.relatedRoots(), { visibleOnly: false, seen });
        if (!link) {
          ui.log('Рекомендации не найдены');
          return;
        }
        const title = YS.dom.linkTitle(link);
        ui.log('Рекомендация: «' + (title || 'видео') + '»');
        const id = YS.dom.videoIdFromHref(link.href);
        if (id) remember(id);
        await persist();
        try {
          await YS.dom.openVideo(link, signal);
          await watchCurrent();
          hops += 1;
        } catch (error) {
          if (error.name === 'AbortError') throw error;
          ui.log(error.message || 'Не открыл рекомендацию');
          return;
        }
      }
    }

    async function returnToResults() {
      if (onSavedResults()) return;
      ui.setStatus('Возвращаюсь к выдаче');
      if (!searchUrl) {
        await ensureResults();
        rememberSearchUrl();
        await persist();
        return;
      }
      await YS.dom.goTo(searchUrl, signal);
      await YS.dom.waitFor(() => onSavedResults(), 12000, signal);
    }

    async function handleEmptyResults() {
      const scrolling = YS.dom.scrollContainer();
      const beforeHeight = scrolling.scrollHeight;
      const beforeTop = scrolling.scrollTop;
      await YS.dom.stepScroll(YS.dom.rand(600, 1100), signal);
      await YS.dom.sleep(900, signal);
      const atBottom = scrolling.scrollTop + scrolling.clientHeight >= scrolling.scrollHeight - 120;
      const grew = scrolling.scrollHeight > beforeHeight + 40;
      const moved = scrolling.scrollTop > beforeTop + 40;
      if (grew || moved || !atBottom) return;
      emptyPasses += 1;
      if (emptyPasses < 2) {
        ui.log('Дальше в выдаче видео не видно');
        return;
      }
      seen.clear();
      emptyPasses = 0;
      scrolling.scrollTop = 0;
      ui.log('Выдача просмотрена, начинаю заново');
      await persist();
    }

    function adoptQuery(next) {
      if (!next) stopForEmptyQueries();
      if (next.toLowerCase() === query.toLowerCase()) return;
      query = next;
      searchUrl = '';
      emptyPasses = 0;
      ui.log('Запрос: «' + query + '»');
    }

    function rollSwitchAfter() {
      const settings = settingsNow();
      const span = settings.switchMax - settings.switchMin;
      return settings.switchMin + Math.floor(Math.random() * (span + 1));
    }

    function resetSwitchQuota() {
      actionsOnQuery = 0;
      switchAfter = rollSwitchAfter();
    }

    function noteAction() {
      actionsOnQuery += 1;
      if (actionsOnQuery < switchAfter) return;
      const before = query;
      adoptQuery(pickQuery(query));
      resetSwitchQuota();
      if (before.toLowerCase() !== query.toLowerCase()) {
        ui.log('Смена через ' + switchAfter + ' действий');
      }
    }

    async function cycle() {
      const list = readQueries();
      if (!list.length) stopForEmptyQueries();
      const currentKept = list.some((item) => item.toLowerCase() === query.toLowerCase());
      if (!currentKept) {
        adoptQuery(pickQuery(''));
        resetSwitchQuota();
      }

      ui.setStatus('Ищу видео');
      await ensureResults();
      rememberSearchUrl();
      await persist();

      ui.setStatus('Листаю выдачу');
      const scrolls = 1 + Math.floor(Math.random() * 4);
      for (let index = 0; index < scrolls; index += 1) {
        await YS.dom.stepScroll(YS.dom.rand(300, 760), signal);
        await YS.dom.sleep(YS.dom.rand(350, 1100), signal);
      }

      const link = YS.dom.pickVideoLink(YS.dom.searchRoots(), { visibleOnly: true, seen });
      if (!link) {
        await handleEmptyResults();
        return;
      }

      emptyPasses = 0;
      const id = YS.dom.videoIdFromHref(link.href);
      const title = YS.dom.linkTitle(link);
      ui.setStatus('Открываю видео');
      ui.log('Открываю «' + (title || 'видео') + '»');
      if (id) remember(id);
      await persist();
      await YS.dom.openVideo(link, signal);
      await watchCurrent();
      await followRecommendations();
      await returnToResults();
      await YS.dom.sleep(YS.dom.pauseMs(), signal);
      noteAction();
      await persist();
    }

    const savedQueries = readQueries();
    if (!savedQueries.length) {
      ui.setStatus('Добавьте запрос');
      return;
    }
    const preferred = String(options.query || '').trim().toLowerCase();
    const matched = savedQueries.find((item) => item.toLowerCase() === preferred);
    query = matched || savedQueries[Math.floor(Math.random() * savedQueries.length)];
    if (preferred && !matched) searchUrl = '';

    const restoredQuota = options.resume && Math.floor(Number(options.switchAfter) || 0) >= 1;
    if (restoredQuota) {
      actionsOnQuery = Math.max(0, Math.floor(Number(options.actionsOnQuery) || 0));
      switchAfter = Math.floor(Number(options.switchAfter));
    } else {
      resetSwitchQuota();
    }

    ui.setRunning(true);
    ui.setStatus(options.resume ? 'Продолжаю серфинг' : 'Запускаю');
    if (options.resume) ui.log('Сессия восстановлена');
    else ui.log('Старт: «' + query + '»');
    if (!restoredQuota) ui.log('Смена через ' + switchAfter + ' действий');
    await persist();

    if (options.resume && YS.dom.currentVideoId()) {
      try {
        await watchCurrent();
        await followRecommendations();
        await returnToResults();
        noteAction();
        await persist();
      } catch (error) {
        if (error.name === 'AbortError') throw error;
        ui.log(error.message || 'Не удалось продолжить просмотр');
      }
    }

    while (!signal.aborted) {
      await assertOwner();
      try {
        await cycle();
      } catch (error) {
        if (error.name === 'AbortError') throw error;
        ui.log(error.message || 'Шаг пропущен');
        await YS.dom.sleep(1500, signal);
      }
    }
  }

  YS.engine = {
    tabToken,
    start,
    stop,
    isRunning,
    normalizeSettings,
    normalizeQueries,
  };
})(globalThis.YS = globalThis.YS || {});
