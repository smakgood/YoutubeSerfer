'use strict';

(function initDom(YS) {
  const SEARCH_SELECTORS = [
    'input[name="search_query"]',
    'input#search',
    'input.ytSearchboxComponentInput',
  ];

  const AD_SELECTOR = [
    'ytd-ad-slot-renderer',
    'ytd-promoted-video-renderer',
    'ytd-search-pyv-renderer',
    'ytd-promoted-sparkles-web-renderer',
    'ytd-promoted-sparkles-text-search-renderer',
    'ytd-banner-promo-renderer',
    'ytd-statement-banner-renderer',
    'ytd-inline-survey-renderer',
    'ytd-brand-video-singleton-renderer',
  ].join(', ');

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

  function abortError() {
    return new DOMException('Остановлено', 'AbortError');
  }

  function skip(message) {
    const error = new Error(message);
    error.name = 'SkipError';
    return error;
  }

  function rand(min, max) {
    return min + Math.random() * (max - min);
  }

  function pauseMs() {
    let ms = 1000 + Math.random() * 7000;
    if (Math.random() < 0.15) ms += 4000 + Math.random() * 10000;
    return Math.round(ms);
  }

  function sleep(ms, signal) {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(abortError());
        return;
      }
      const timer = setTimeout(() => {
        signal?.removeEventListener('abort', onAbort);
        resolve();
      }, Math.max(0, ms));
      const onAbort = () => {
        clearTimeout(timer);
        reject(abortError());
      };
      signal?.addEventListener('abort', onAbort, { once: true });
    });
  }

  function waitFor(predicate, timeout, signal) {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(abortError());
        return;
      }
      const started = Date.now();
      let timer = 0;

      function cleanup() {
        document.removeEventListener('yt-navigate-finish', check);
        signal?.removeEventListener('abort', onAbort);
        clearInterval(timer);
      }

      function onAbort() {
        cleanup();
        reject(abortError());
      }

      function check() {
        if (signal?.aborted) {
          onAbort();
          return;
        }
        try {
          if (predicate()) {
            cleanup();
            resolve();
            return;
          }
        } catch (error) {
          cleanup();
          reject(error);
          return;
        }
        if (Date.now() - started >= timeout) {
          cleanup();
          reject(skip('Таймаут ожидания страницы'));
        }
      }

      document.addEventListener('yt-navigate-finish', check);
      signal?.addEventListener('abort', onAbort, { once: true });
      timer = setInterval(check, 200);
      check();
    });
  }

  function queryFirst(selectors, root = document) {
    for (const selector of selectors) {
      const node = root.querySelector(selector);
      if (node) return node;
    }
    return null;
  }

  function deepQuery(selector, root) {
    if (!root) return null;
    const direct = root.querySelector?.(selector);
    if (direct) return direct;
    if (root.shadowRoot) {
      const inShadow = deepQuery(selector, root.shadowRoot);
      if (inShadow) return inShadow;
    }
    const nodes = root.querySelectorAll?.('*') || [];
    for (const node of nodes) {
      if (!node.shadowRoot) continue;
      const found = deepQuery(selector, node.shadowRoot);
      if (found) return found;
    }
    return null;
  }

  function deepCollect(root, predicate, limit = 60) {
    const found = [];
    walk(root, predicate, found, limit, 0);
    return found;
  }

  function walk(root, predicate, found, limit, depth) {
    if (!root || depth > 8 || found.length >= limit) return;
    if (root instanceof Element && predicate(root)) found.push(root);
    const nodes = root.querySelectorAll?.('*');
    if (!nodes) return;
    for (const node of nodes) {
      if (found.length >= limit) return;
      if (predicate(node)) found.push(node);
      if (node.shadowRoot) walk(node.shadowRoot, predicate, found, limit, depth + 1);
    }
  }

  function findSearchInput() {
    for (const selector of SEARCH_SELECTORS) {
      const direct = document.querySelector(selector);
      if (direct) return direct;
    }
    const hosts = document.querySelectorAll('yt-searchbox, ytd-searchbox, ytd-masthead, #masthead');
    for (const host of hosts) {
      for (const selector of SEARCH_SELECTORS) {
        const found = deepQuery(selector, host);
        if (found) return found;
      }
    }
    for (const selector of SEARCH_SELECTORS) {
      const found = deepQuery(selector, document);
      if (found) return found;
    }
    return null;
  }

  function isSearchSubmit(element) {
    if (!isButton(element)) return false;
    const label = (element.getAttribute('aria-label') || '').toLowerCase();
    if (/голос|voice|микрофон|microphone/.test(label)) return false;
    if (element.id === 'search-icon-legacy') return true;
    if ([...element.classList].some((name) => /searchbutton/i.test(name))) return true;
    return label === 'search' || label === 'поиск' || label === 'ввести запрос';
  }

  function findSearchButton(input) {
    const root = input.getRootNode();
    const buttons = root.querySelectorAll?.('button, [role="button"]') || [];
    for (const button of buttons) {
      if (isSearchSubmit(button)) return button;
    }
    return null;
  }

  function setNativeValue(element, value) {
    const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
    if (descriptor?.set) descriptor.set.call(element, value);
    else element.value = value;
  }

  function dispatchEnter(element) {
    const init = {
      key: 'Enter',
      code: 'Enter',
      keyCode: 13,
      which: 13,
      bubbles: true,
      composed: true,
      cancelable: true,
    };
    element.dispatchEvent(new KeyboardEvent('keydown', init));
    element.dispatchEvent(new KeyboardEvent('keyup', init));
  }

  async function revealSearch(signal) {
    const started = Date.now();
    while (Date.now() - started < 8000) {
      const input = findSearchInput();
      if (input && input.getBoundingClientRect().width > 20) return input;
      if (!input) {
        const opener = deepCollect(document, (element) => {
          if (!isButton(element)) return false;
          const label = (element.getAttribute('aria-label') || '').toLowerCase();
          if (/голос|voice/.test(label)) return false;
          return label === 'поиск' || label === 'search' || element.id === 'search-button';
        }, 8)[0];
        opener?.click();
      }
      await sleep(300, signal);
    }
    return findSearchInput();
  }

  function isResultsPage(query) {
    if (location.pathname !== '/results') return false;
    const wanted = String(query || '').trim().toLowerCase();
    const fromUrl = (new URL(location.href).searchParams.get('search_query') || '').trim().toLowerCase();
    return wanted.length > 0 && fromUrl === wanted;
  }

  function hasNavigatedToResults(previousHref) {
    if (location.pathname !== '/results' || !previousHref) return false;
    return location.href !== previousHref;
  }

  async function typeAndSubmit(query, signal) {
    const input = await revealSearch(signal);
    if (!input) throw skip('Не нашёл поле поиска');
    input.focus();
    input.click();
    await sleep(rand(150, 400), signal);
    setNativeValue(input, '');
    input.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, inputType: 'deleteContentBackward' }));

    let typed = '';
    for (const ch of Array.from(query)) {
      typed += ch;
      setNativeValue(input, typed);
      input.dispatchEvent(new InputEvent('input', {
        bubbles: true,
        composed: true,
        data: ch,
        inputType: 'insertText',
      }));
      await sleep(rand(45, 140), signal);
    }

    await sleep(rand(200, 500), signal);
    dispatchEnter(input);
    const before = location.href;
    await sleep(1200, signal);
    if (location.href === before && !isResultsPage(query)) {
      const form = input.form || input.closest('form');
      if (typeof form?.requestSubmit === 'function') form.requestSubmit();
      else findSearchButton(input)?.click();
      await sleep(700, signal);
      if (!isResultsPage(query)) findSearchButton(input)?.click();
    }
  }

  function videoIdFromHref(href) {
    try {
      const url = new URL(href, location.origin);
      if (url.pathname !== '/watch') return null;
      const id = url.searchParams.get('v');
      if (!id || !/^[\w-]{6,}$/.test(id)) return null;
      return id;
    } catch {
      return null;
    }
  }

  function currentVideoId() {
    if (location.pathname !== '/watch') return null;
    return new URL(location.href).searchParams.get('v');
  }

  function cleanText(value) {
    return value.trim().replace(/\s+/g, ' ').slice(0, 80);
  }

  function linkTitle(anchor) {
    const card = anchor.closest([
      'ytd-video-renderer',
      'ytd-compact-video-renderer',
      'ytd-rich-item-renderer',
      'ytd-grid-video-renderer',
      'yt-lockup-view-model',
    ].join(', '));
    const heading = card?.querySelector('#video-title, h3 a, h3, [title]');
    const titled = heading?.getAttribute('title')
      || heading?.textContent
      || anchor.getAttribute('title')
      || anchor.textContent
      || '';
    return cleanText(titled);
  }

  function videoTitle() {
    const node = queryFirst([
      'ytd-watch-metadata h1 yt-formatted-string',
      'h1.ytd-watch-metadata yt-formatted-string',
      'ytd-watch-metadata h1',
      '#title h1',
    ]);
    return cleanText(node?.textContent || '');
  }

  function isVisible(element) {
    const rect = element.getBoundingClientRect();
    if (rect.width < 40 || rect.height < 24) return false;
    if (rect.bottom < 90 || rect.top > window.innerHeight - 24) return false;
    const style = getComputedStyle(element);
    return style.visibility !== 'hidden' && style.display !== 'none';
  }

  function isClickable(element) {
    const rect = element.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return false;
    const style = getComputedStyle(element);
    return style.visibility !== 'hidden' && style.display !== 'none' && style.pointerEvents !== 'none';
  }

  function searchRoots() {
    const root = queryFirst([
      'ytd-two-column-search-results-renderer #primary',
      'ytd-two-column-search-results-renderer',
      'ytd-search #contents',
      'ytd-section-list-renderer',
    ]);
    return root ? [root] : [];
  }

  function relatedRoots() {
    const root = queryFirst([
      'ytd-watch-next-secondary-results-renderer',
      '#related',
      '#secondary',
    ]);
    return root ? [root] : [];
  }

  function listVideoLinks(roots, { visibleOnly = false, seen = new Set() } = {}) {
    const current = currentVideoId();
    const byId = new Map();
    for (const root of roots) {
      const anchors = root.querySelectorAll('a[href*="watch?v="]');
      for (const anchor of anchors) {
        if (anchor.closest(AD_SELECTOR)) continue;
        if (anchor.closest('ytd-reel-shelf-renderer, ytd-reel-item-renderer')) continue;
        const id = videoIdFromHref(anchor.href);
        if (!id || id === current || seen.has(id)) continue;
        if (visibleOnly && !isVisible(anchor)) continue;
        if (!byId.has(id)) byId.set(id, anchor);
      }
    }
    return [...byId.values()];
  }

  function pickVideoLink(roots, options) {
    const links = listVideoLinks(roots, options);
    if (!links.length) return null;
    return links[Math.floor(Math.random() * links.length)];
  }

  async function openVideo(anchor, signal) {
    const id = videoIdFromHref(anchor.href);
    if (!id) throw skip('Некорректная ссылка на видео');
    anchor.target = '_self';
    anchor.scrollIntoView({ block: 'center', inline: 'nearest' });
    await sleep(rand(300, 800), signal);
    anchor.click();
    await waitFor(() => currentVideoId() === id, 15000, signal);
    await sleep(rand(500, 1200), signal);
    await waitFor(() => document.querySelector('video'), 10000, signal);
    return id;
  }

  function scrollContainer() {
    const candidates = [
      document.scrollingElement,
      document.querySelector('ytd-app'),
      document.documentElement,
      document.body,
    ];
    for (const element of candidates) {
      if (element && element.scrollHeight > element.clientHeight + 80) return element;
    }
    return document.scrollingElement || document.documentElement;
  }

  function scrollBy(distance) {
    const element = scrollContainer();
    const before = element.scrollTop;
    element.scrollTop = before + distance;
    if (Math.abs(element.scrollTop - before) < 1) window.scrollBy(0, distance);
  }

  async function stepScroll(distance, signal) {
    const steps = 3 + Math.floor(Math.random() * 3);
    const delta = distance / steps;
    for (let index = 0; index < steps; index += 1) {
      scrollBy(delta);
      await sleep(rand(180, 520), signal);
    }
  }

  function buttonText(element) {
    return [
      element.getAttribute('aria-label'),
      element.getAttribute('title'),
      element.parentElement?.getAttribute('aria-label'),
      element.innerText,
    ].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
  }

  function isButton(element) {
    return element.tagName === 'BUTTON' || element.getAttribute('role') === 'button';
  }

  function findButton(scopes, classify) {
    for (const scope of scopes) {
      if (!scope) continue;
      const buttons = deepCollect(scope, isButton, 80);
      for (const button of buttons) {
        if (!isClickable(button)) continue;
        const kind = classify(button);
        if (kind) return { button, kind };
      }
    }
    return null;
  }

  function likeKind(button) {
    const text = buttonText(button).toLowerCase();
    if (!text || text.includes('не нравится') || text.includes('dislike')) return null;
    const looksLike = text.includes('нравится') || /\blikes?\b/.test(text) || text.includes('unlike');
    if (!looksLike) return null;
    const pressed = button.getAttribute('aria-pressed') === 'true'
      || text.includes('unlike')
      || text.includes('убрать отметку');
    return pressed ? 'done' : 'open';
  }

  function subscribeKind(button) {
    const text = buttonText(button).toLowerCase();
    if (!text) return null;
    if (/отписать|unsubscribe|вы подписаны|подписаны|subscribed/.test(text)) return 'done';
    if (/подписаться|subscribe/.test(text)) return 'open';
    return null;
  }

  function likeScopes() {
    return [
      document.querySelector('#top-level-buttons-computed'),
      document.querySelector('#actions-inner'),
      document.querySelector('#actions'),
      document.querySelector('ytd-watch-metadata'),
      document.querySelector('#above-the-fold'),
    ];
  }

  function subscribeScopes() {
    return [
      document.querySelector('ytd-subscribe-button-renderer'),
      document.querySelector('yt-subscribe-button-view-model'),
      document.querySelector('#subscribe-button'),
      document.querySelector('#owner'),
      document.querySelector('ytd-watch-metadata #owner'),
    ];
  }

  function loginDialog() {
    const dialogs = document.querySelectorAll('tp-yt-paper-dialog, ytd-popup-container');
    for (const dialog of dialogs) {
      const rect = dialog.getBoundingClientRect();
      if (rect.width < 40 || rect.height < 40) continue;
      const text = (dialog.innerText || '').toLowerCase();
      if (/войти|sign in/.test(text)) return dialog;
    }
    return null;
  }

  function closeDialog(dialog) {
    const close = queryFirst([
      '#close-button button',
      'button[aria-label="Закрыть"]',
      'button[aria-label="Close"]',
    ], dialog);
    close?.click();
  }

  async function ensurePlaying() {
    const video = queryFirst([
      'video.html5-main-video',
      '#movie_player video',
      'video',
    ]);
    if (!video || (!video.paused && !video.ended)) return;
    try {
      await video.play();
    } catch {
      // Autoplay can reject without a fresh user gesture. The watch timer still runs.
    }
  }

  async function like(signal) {
    const found = findButton(likeScopes(), likeKind);
    if (!found) return 'Кнопка лайка не найдена';
    if (found.kind === 'done') return 'Лайк уже стоит';
    found.button.click();
    await sleep(700, signal);
    const dialog = loginDialog();
    if (dialog) {
      closeDialog(dialog);
      return 'Нет входа в аккаунт, лайк пропущен';
    }
    const again = findButton(likeScopes(), likeKind);
    if (again?.kind === 'done') return 'Лайк';
    return 'Не удалось поставить лайк';
  }

  async function subscribe(signal) {
    const found = findButton(subscribeScopes(), subscribeKind);
    if (!found) return 'Кнопка подписки не найдена';
    if (found.kind === 'done') return 'Подписка уже есть';
    found.button.click();
    await sleep(800, signal);
    const dialog = loginDialog();
    if (dialog) {
      closeDialog(dialog);
      return 'Нет входа в аккаунт, подписка пропущена';
    }
    const again = findButton(subscribeScopes(), subscribeKind);
    if (again?.kind === 'done') return 'Подписка';
    return 'Не удалось подписаться';
  }

  async function comment(signal) {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const host = document.querySelector('ytd-comments, #comments');
      if (host && queryFirst([
        'ytd-comment-simplebox-renderer',
        'ytd-comment-thread-renderer',
        '#message',
      ], host)) break;
      scrollBy(560);
      await sleep(450, signal);
    }

    const host = document.querySelector('ytd-comments, #comments');
    if (!host) return 'Комментарии не найдены';
    const blocked = queryFirst(['#message', 'ytd-message-renderer'], host);
    const blockedText = (blocked?.innerText || '').toLowerCase();
    if (/комментарии отключены|comments are turned off|комментирование отключено/.test(blockedText)) {
      return 'Комментарии отключены';
    }

    host.scrollIntoView({ behavior: 'smooth', block: 'center' });
    await sleep(rand(500, 900), signal);

    const box = document.querySelector('ytd-comment-simplebox-renderer');
    if (!box) return 'Поле комментария недоступно';
    const boxText = (box.innerText || '').toLowerCase();
    if (/войдите|sign in|войти/.test(boxText)) return 'Нет входа в аккаунт, комментарий пропущен';

    const placeholder = queryFirst(['#simplebox-placeholder', '#placeholder-area'], box);
    placeholder?.click();
    await sleep(rand(400, 800), signal);

    const editor = queryFirst(['#contenteditable-root'], box) || deepQuery('#contenteditable-root', box);
    if (!editor) return 'Редактор комментария не открылся';
    const phrase = COMMENTS[Math.floor(Math.random() * COMMENTS.length)];
    editor.focus();
    const selection = document.getSelection();
    if (selection) {
      const range = document.createRange();
      range.selectNodeContents(editor);
      range.collapse(false);
      selection.removeAllRanges();
      selection.addRange(range);
    }
    document.execCommand('insertText', false, phrase);
    if (!editor.textContent.includes(phrase)) editor.textContent = phrase;
    editor.dispatchEvent(new InputEvent('input', {
      bubbles: true,
      composed: true,
      data: phrase,
      inputType: 'insertText',
    }));
    await sleep(rand(350, 700), signal);

    const dialog = loginDialog();
    if (dialog) {
      closeDialog(dialog);
      return 'Нет входа в аккаунт, комментарий пропущен';
    }

    const submit = queryFirst([
      '#submit-button button',
      '#submit-button [role="button"]',
    ], box);
    const submitHost = submit?.closest('#submit-button');
    const disabled = !submit
      || submit.disabled
      || submit.hasAttribute('disabled')
      || submit.getAttribute('aria-disabled') === 'true'
      || submitHost?.hasAttribute('disabled')
      || submitHost?.getAttribute('aria-disabled') === 'true';
    if (disabled) {
      const cancel = queryFirst(['#cancel-button button'], box);
      cancel?.click();
      return 'Кнопка отправки комментария недоступна';
    }
    submit.click();
    await sleep(600, signal);
    return 'Комментарий: ' + phrase;
  }

  function sameDestination(target) {
    if (location.pathname !== target.pathname) return false;
    if (target.pathname !== '/results') return location.search === target.search;
    const wanted = target.searchParams.get('search_query') || '';
    const current = new URL(location.href).searchParams.get('search_query') || '';
    return wanted === current;
  }

  async function goTo(url, signal) {
    const target = new URL(url, location.origin);
    if (sameDestination(target)) return;
    const anchor = document.createElement('a');
    anchor.href = target.pathname + target.search;
    anchor.className = 'yt-simple-endpoint';
    anchor.style.display = 'none';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    try {
      await waitFor(() => sameDestination(target), 4000, signal);
    } catch (error) {
      if (error.name === 'AbortError') throw error;
      location.assign(target.href);
    }
  }

  YS.dom = {
    abortError,
    rand,
    pauseMs,
    sleep,
    waitFor,
    isResultsPage,
    hasNavigatedToResults,
    typeAndSubmit,
    videoIdFromHref,
    currentVideoId,
    linkTitle,
    videoTitle,
    searchRoots,
    relatedRoots,
    listVideoLinks,
    pickVideoLink,
    openVideo,
    stepScroll,
    scrollContainer,
    ensurePlaying,
    like,
    subscribe,
    comment,
    goTo,
  };
})(globalThis.YS = globalThis.YS || {});
