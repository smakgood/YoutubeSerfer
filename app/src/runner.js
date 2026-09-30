import { normalizeQueries, normalizeSettings } from './settings.js';
import {
  closeLoginExpression,
  commentStepExpression,
  controlExpression,
  offlineExpression,
  pageStateExpression,
  pickVideoExpression,
  playExpression,
  scrollMetricsExpression,
  scrollRelatedExpression,
  showPlayerExpression,
  skipAdExpression,
} from './page.js';

const COMMENTS = [
  'Интересно, спасибо',
  'Хороший выпуск',
  'Послушаю ещё',
  'Полезно, сохраню',
  'Приятно смотреть',
  'Спасибо за видео',
  'Неплохо рассказано',
  'Зашло',
];

const SEARCH_SELECTOR = 'input[name="search_query"], input#search, input.ytSearchboxComponentInput';
const STALL_LIMIT = 5;

function rand(min, max) {
  return min + Math.random() * (max - min);
}

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(finish, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortError());
    };
    function finish() {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }
    if (signal?.aborted) {
      clearTimeout(timer);
      reject(abortError());
      return;
    }
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function abortError() {
  const error = new Error('Остановлено');
  error.name = 'AbortError';
  return error;
}

function stallError(message) {
  const error = new Error(message);
  error.name = 'StallError';
  return error;
}

function offlineError() {
  const error = new Error('Нет подключения к интернету');
  error.name = 'OfflineError';
  return error;
}

function chance(percent) {
  return Math.random() * 100 < percent;
}

function watchMs(minSec, maxSec) {
  const unit = (Math.random() + Math.random() + Math.random()) / 3;
  return Math.round((minSec + unit * (maxSec - minSec)) * 1000);
}

function pauseMs() {
  let ms = 1000 + Math.random() * 7000;
  if (Math.random() < 0.15) ms += 4000 + Math.random() * 10000;
  return Math.round(ms);
}

function rollSwitch(settings) {
  const span = settings.switchMax - settings.switchMin;
  return settings.switchMin + Math.floor(Math.random() * (span + 1));
}

function pickQuery(list, avoid) {
  if (!list.length) return '';
  const avoidKey = String(avoid || '').trim().toLowerCase();
  const others = avoidKey ? list.filter((item) => item.toLowerCase() !== avoidKey) : list;
  const pool = others.length ? others : list;
  return pool[Math.floor(Math.random() * pool.length)];
}

export function createRunner({ id, name, mcp, getConfig, onUpdate }) {
  let controller = null;
  let stopRequested = false;
  let openVideoFails = 0;
  let offlineReloads = 0;
  const state = {
    id,
    name,
    running: false,
    status: 'Ожидание',
    log: [],
  };

  function publish() {
    onUpdate?.({ ...state, log: state.log.slice() });
  }

  function setStatus(status) {
    if (stopRequested && status !== 'Остановлено' && status !== 'Добавьте запрос') {
      state.status = 'Останавливаюсь';
    } else {
      state.status = status;
    }
    publish();
  }

  function log(line) {
    const now = new Date();
    const stamp = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    state.log.push(`${stamp}  ${line}`);
    if (state.log.length > 12) state.log.splice(0, state.log.length - 12);
    publish();
  }

  function snapshot() {
    return { ...state, log: state.log.slice() };
  }

  async function call(tool, args) {
    if (controller?.signal.aborted) throw abortError();
    return mcp.call(tool, { profile_id: id, ...args });
  }

  async function evaluate(expression) {
    return call('browser_evaluate', { expression });
  }

  async function pageState() {
    const value = await evaluate(pageStateExpression());
    return value && typeof value === 'object' ? value : { href: '', path: '', query: '', videoId: '', title: '' };
  }

  function motionMissing(error) {
    return /Motion\./i.test(String(error?.message || error));
  }

  async function clickAt(point) {
    try {
      await call('human_click', { x: point.x, y: point.y });
    } catch (error) {
      if (!motionMissing(error)) throw error;
      await call('browser_mouse_click', { x: point.x, y: point.y });
    }
  }

  async function clickSelector(selector) {
    try {
      await call('human_click', { selector });
    } catch (error) {
      if (!motionMissing(error)) throw error;
      await call('browser_click', { selector });
    }
  }

  async function fillQuery(text) {
    try {
      await call('human_fill', {
        selector: SEARCH_SELECTOR,
        text,
        clear: true,
        allow_typos: false,
      });
    } catch (error) {
      if (!motionMissing(error)) throw error;
      await call('browser_fill', { selector: SEARCH_SELECTOR, text });
    }
  }

  async function typePhrase(text) {
    try {
      await call('human_type', { text, allow_typos: false });
    } catch (error) {
      if (!motionMissing(error)) throw error;
      await call('browser_type', {
        selector: '#contenteditable-root',
        text,
        delay_ms: 35,
      });
    }
  }

  async function ensureOnline() {
    if (await evaluate(offlineExpression())) throw offlineError();
  }

  async function dismissLogin(action) {
    const closed = await evaluate(closeLoginExpression());
    if (closed) return `Нет входа в аккаунт, ${action} пропущен`;
    return '';
  }

  async function ensureResults(query, searchUrl) {
    const stateNow = await pageState();
    const wanted = query.trim().toLowerCase();
    const current = String(stateNow.query || '').trim().toLowerCase();
    if (stateNow.path === '/results' && current === wanted && wanted) return stateNow.href;
    if (searchUrl) {
      setStatus('Возвращаюсь к выдаче');
      await call('browser_navigate', { url: searchUrl });
      await sleep(1200, controller.signal);
      const again = await pageState();
      if (String(again.query || '').trim().toLowerCase() === wanted) return again.href;
    }
    setStatus('Печатаю запрос');
    log(`Ищу «${query}»`);
    try {
      await fillQuery(query);
    } catch {
      await clickSelector('button[aria-label="Поиск"], button[aria-label="Search"], #search-button');
      await sleep(400, controller.signal);
      await fillQuery(query);
    }
    await call('browser_press', { key: 'Enter' });
    const started = Date.now();
    while (Date.now() - started < 12000) {
      await sleep(700, controller.signal);
      await ensureOnline();
      const next = await pageState();
      if (next.path === '/results' && String(next.query || '').trim().toLowerCase() === wanted) return next.href;
    }
    await ensureOnline();
    throw new Error(`Не открыл выдачу «${query}»`);
  }

  async function openVideo(video) {
    try {
      await clickAt(video);
      const started = Date.now();
      while (Date.now() - started < 15000) {
        await sleep(500, controller.signal);
        await ensureOnline();
        await skipAd();
        const next = await pageState();
        if (next.path === '/watch' && next.videoId === video.id) {
          openVideoFails = 0;
          return next;
        }
      }
      await ensureOnline();
      throw new Error('Не открыл видео');
    } catch (error) {
      if (error.name === 'AbortError' || error.name === 'StallError' || error.name === 'OfflineError') throw error;
      openVideoFails += 1;
      if (openVideoFails >= STALL_LIMIT) {
        throw stallError(`Остановлено: ${STALL_LIMIT} неудачных попыток открыть видео подряд`);
      }
      throw error;
    }
  }

  async function rest(ms) {
    const end = Date.now() + ms;
    while (Date.now() < end && !stopRequested) {
      await sleep(Math.min(end - Date.now(), 300), controller.signal);
    }
  }

  async function skipAd() {
    try {
      const point = await evaluate(skipAdExpression());
      if (!point?.x) return false;
      await clickAt(point);
      log('Пропуск рекламы');
      await sleep(400, controller.signal);
      await evaluate(playExpression());
      return true;
    } catch (error) {
      if (error.name === 'AbortError' || error.name === 'StallError' || error.name === 'OfflineError') throw error;
      return false;
    }
  }

  async function pause(ms) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      await skipAd();
      const left = end - Date.now();
      if (left <= 0) break;
      await sleep(Math.min(left, 1500), controller.signal);
    }
  }

  async function findControl(kind) {
    const started = Date.now();
    while (Date.now() - started < 8000) {
      if (controller?.signal.aborted) throw abortError();
      await skipAd();
      const found = await evaluate(controlExpression(kind));
      if (found?.x) return found;
      await sleep(500, controller.signal);
    }
    return null;
  }

  async function interact(settings) {
    await skipAd();
    await evaluate(showPlayerExpression());
    if (chance(settings.like)) {
      const found = await findControl('like');
      if (!found) log('Кнопка лайка не найдена');
      else if (found.state === 'done') log('Лайк уже стоит');
      else {
        await clickAt(found);
        await sleep(700, controller.signal);
        const blocked = await dismissLogin('лайк');
        log(blocked || 'Лайк');
      }
      await sleep(rand(400, 1400), controller.signal);
    }
    if (chance(settings.subscribe)) {
      const found = await findControl('subscribe');
      if (!found) log('Кнопка подписки не найдена');
      else if (found.state === 'done') log('Подписка уже есть');
      else {
        await clickAt(found);
        await sleep(800, controller.signal);
        const blocked = await dismissLogin('подписка');
        log(blocked || 'Подписка');
      }
      await sleep(rand(400, 1400), controller.signal);
    }
    if (chance(settings.comment)) {
      log(await comment());
      await evaluate(showPlayerExpression());
      await sleep(rand(400, 1400), controller.signal);
    }
  }

  function commentFieldMissing(message) {
    return message === 'Поле комментария недоступно'
      || message === 'Комментарии не найдены'
      || message === 'Редактор комментария не открылся';
  }

  async function commentOnce() {
    for (let attempt = 0; attempt < 6; attempt += 1) {
      await skipAd();
      const ready = await evaluate(commentStepExpression('ready'));
      if (ready?.ok) break;
      if (ready?.message && attempt === 5) return ready.message;
      await call('browser_scroll', { dy: 560 });
      await sleep(450, controller.signal);
    }
    const place = await evaluate(commentStepExpression('place'));
    if (!place?.ok) return place?.message || 'Поле комментария недоступно';
    await clickAt(place);
    await sleep(rand(400, 800), controller.signal);
    const phrase = COMMENTS[Math.floor(Math.random() * COMMENTS.length)];
    await typePhrase(phrase);
    await sleep(rand(350, 700), controller.signal);
    const blocked = await dismissLogin('комментарий');
    if (blocked) return blocked;
    const submit = await evaluate(commentStepExpression('submit'));
    if (!submit?.ok) return submit?.message || 'Кнопка отправки комментария недоступна';
    await clickAt(submit);
    await sleep(600, controller.signal);
    return `Комментарий: ${phrase}`;
  }

  async function comment() {
    for (let reloads = 0; ; reloads += 1) {
      const result = await commentOnce();
      if (!commentFieldMissing(result)) return result;
      if (reloads >= STALL_LIMIT) {
        throw stallError(`Остановлено: ${STALL_LIMIT} неудачных попыток обновить страницу для комментария`);
      }
      log('Поле комментария недоступно, обновляю страницу');
      setStatus('Обновляю страницу');
      await call('browser_reload', {});
      await sleep(rand(6000, 9000), controller.signal);
      const started = Date.now();
      let page = await pageState();
      while (page.path !== '/watch' && Date.now() - started < 15000) {
        await skipAd();
        await sleep(500, controller.signal);
        page = await pageState();
      }
      await evaluate(playExpression());
    }
  }

  async function watchCurrent(settings) {
    const startedWait = Date.now();
    let page = await pageState();
    while (page.path !== '/watch' && Date.now() - startedWait < 15000) {
      await skipAd();
      await sleep(500, controller.signal);
      page = await pageState();
    }
    await ensureOnline();
    const total = watchMs(settings.watchMin, settings.watchMax);
    const started = Date.now();
    setStatus('Смотрю видео');
    log(`Смотрю «${page.title || 'видео'}» · ~${Math.round(total / 1000)} с`);
    await evaluate(showPlayerExpression());
    await pause(rand(1000, 3500));
    await evaluate(playExpression());
    await interact(settings);
    while (Date.now() - started < total) {
      await ensureOnline();
      await skipAd();
      const left = total - (Date.now() - started);
      if (left <= 0) break;
      await sleep(Math.min(left, 1500), controller.signal);
    }
  }

  async function followRecommendations(settings, seen) {
    let hops = 0;
    while (hops < 3 && !controller.signal.aborted && !stopRequested) {
      const live = normalizeSettings(getConfig().settings);
      if (!chance(live.recommended)) return;
      setStatus('Листаю рекомендации');
      await evaluate(scrollRelatedExpression());
      await sleep(rand(400, 900), controller.signal);
      if (stopRequested) return;
      let video = await evaluate(pickVideoExpression(seen, 'related'));
      if (!video?.id) {
        await evaluate(scrollRelatedExpression());
        await sleep(rand(400, 900), controller.signal);
        if (stopRequested) return;
        video = await evaluate(pickVideoExpression(seen, 'related'));
      }
      if (!video?.id) {
        log('Рекомендации не найдены');
        return;
      }
      if (stopRequested) return;
      log(`Рекомендация: «${video.title || 'видео'}»`);
      seen.push(video.id);
      try {
        await openVideo(video);
        await watchCurrent(settings);
        hops += 1;
      } catch (error) {
        if (error.name === 'AbortError') throw error;
        log(error.message || 'Не открыл рекомендацию');
        return;
      }
    }
  }

  async function loop() {
    const signal = controller.signal;
    const initial = getConfig();
    const queries = normalizeQueries(initial.queries);
    if (!queries.length) {
      setStatus('Добавьте запрос');
      return;
    }
    let query = pickQuery(queries, '');
    let searchUrl = '';
    let emptyPasses = 0;
    const seen = [];
    let actionsOnQuery = 0;
    let switchAfter = rollSwitch(normalizeSettings(initial.settings));
    setStatus('Запускаю');
    log(`Старт: «${query}»`);
    log(`Смена через ${switchAfter} действий`);
    await call('browser_navigate', { url: 'https://www.youtube.com/' });

    while (!signal.aborted && !stopRequested) {
      try {
        const config = getConfig();
        const list = normalizeQueries(config.queries);
        const settings = normalizeSettings(config.settings);
        if (!list.length) {
          setStatus('Добавьте запрос');
          return;
        }
        await ensureOnline();
        if (stopRequested) break;
        offlineReloads = 0;
        if (!list.some((item) => item.toLowerCase() === query.toLowerCase())) {
          query = pickQuery(list, '');
          searchUrl = '';
          actionsOnQuery = 0;
          switchAfter = rollSwitch(settings);
          emptyPasses = 0;
          log(`Запрос: «${query}»`);
        }

        setStatus('Ищу видео');
        searchUrl = await ensureResults(query, searchUrl);
        if (stopRequested) break;
        setStatus('Листаю выдачу');
        const scrolls = 1 + Math.floor(Math.random() * 4);
        for (let index = 0; index < scrolls; index += 1) {
          if (stopRequested) break;
          await call('browser_scroll', { dy: Math.round(rand(300, 760)) });
          await sleep(rand(350, 1100), signal);
        }
        if (stopRequested) break;
        const video = await evaluate(pickVideoExpression(seen, 'search'));
        if (!video?.id) {
          const before = await evaluate(scrollMetricsExpression());
          await call('browser_scroll', { dy: Math.round(rand(600, 1100)) });
          await sleep(900, signal);
          const after = await evaluate(scrollMetricsExpression());
          const grew = after.height > before.height + 40;
          const moved = after.top > before.top + 40;
          const atBottom = after.top + after.client >= after.height - 120;
          if (grew || moved || !atBottom) continue;
          emptyPasses += 1;
          if (emptyPasses < 2) {
            log('Дальше в выдаче видео не видно');
            continue;
          }
          seen.splice(0, seen.length);
          emptyPasses = 0;
          log('Выдача просмотрена, начинаю заново');
          continue;
        }
        if (stopRequested) break;
        emptyPasses = 0;
        seen.push(video.id);
        if (seen.length > 300) seen.splice(0, seen.length - 300);
        setStatus('Открываю видео');
        log(`Открываю «${video.title || 'видео'}»`);
        await openVideo(video);
        await watchCurrent(settings);
        if (!stopRequested) await followRecommendations(settings, seen);
        if (stopRequested) break;
        setStatus('Возвращаюсь к выдаче');
        await call('browser_navigate', { url: searchUrl });
        await rest(pauseMs());

        actionsOnQuery += 1;
        if (actionsOnQuery >= switchAfter) {
          const before = query;
          query = pickQuery(normalizeQueries(getConfig().queries), query);
          searchUrl = '';
          actionsOnQuery = 0;
          switchAfter = rollSwitch(normalizeSettings(getConfig().settings));
          emptyPasses = 0;
          if (before.toLowerCase() !== query.toLowerCase()) {
            log(`Запрос: «${query}»`);
            log(`Смена через ${switchAfter} действий`);
          }
        }
      } catch (error) {
        if (error.name === 'AbortError' || signal.aborted) throw abortError();
        if (error.name === 'StallError') throw error;
        if (error.name === 'OfflineError') {
          offlineReloads += 1;
          if (offlineReloads >= STALL_LIMIT) {
            throw stallError(`Остановлено: ${STALL_LIMIT} неудачных попыток обновить страницу`);
          }
          log('Нет подключения к интернету, обновляю страницу');
          setStatus('Обновляю страницу');
          await call('browser_reload', {});
          await rest(rand(5000, 8000));
          if (stopRequested) break;
          continue;
        }
        log(error.message || 'Шаг пропущен');
        await rest(1500);
      }
    }
  }

  async function start() {
    if (controller) return;
    controller = new AbortController();
    stopRequested = false;
    openVideoFails = 0;
    offlineReloads = 0;
    state.running = true;
    setStatus('Запускаю');
    const active = controller;
    try {
      await loop();
    } catch (error) {
      if (error.name === 'AbortError') {
        // Stopped by the user.
      } else {
        log(error.message || 'Сбой серфинга');
      }
    } finally {
      if (controller === active) controller = null;
      state.running = false;
      if (state.status !== 'Добавьте запрос') setStatus('Остановлено');
      else publish();
      try {
        await mcp.call('stop_profile', { id });
      } catch {
        // The profile may already be closed.
      }
    }
  }

  function stop() {
    if (!controller) return;
    if (stopRequested) {
      controller.abort();
      return;
    }
    stopRequested = true;
    setStatus('Останавливаюсь');
    log('Остановка после текущего действия');
  }

  return { start, stop, snapshot, id };
}
