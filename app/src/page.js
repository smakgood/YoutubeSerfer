const AD = [
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

function script(body) {
  return `(() => {\n${body}\n})()`;
}

export function offlineExpression() {
  return script(`
    if (location.protocol === 'chrome-error:' || document.querySelector('body.neterror, #main-frame-error')) return true;
    const promo = document.querySelector('ytd-background-promo-renderer');
    if (!promo) return false;
    const text = (promo.innerText || '').replace(/\\s+/g, ' ').toLowerCase();
    if (/нет подключения|подключитесь к интернет|проверьте подключение|no internet|you.?re offline|connect to the internet/.test(text)) return true;
    return Boolean(promo.querySelector('svg[viewBox="0 0 192 195"]'));
  `);
}

export function pageStateExpression() {
  return script(`
    const params = new URL(location.href).searchParams;
    const titleNode = document.querySelector('ytd-watch-metadata h1 yt-formatted-string, h1.ytd-watch-metadata yt-formatted-string, ytd-watch-metadata h1, #title h1');
    return {
      href: location.href,
      path: location.pathname,
      query: params.get('search_query') || '',
      videoId: params.get('v') || '',
      title: (titleNode?.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 80),
    };
  `);
}

export function scrollMetricsExpression() {
  return script(`
    const element = document.scrollingElement || document.documentElement;
    return {
      top: element.scrollTop,
      height: element.scrollHeight,
      client: element.clientHeight,
    };
  `);
}

export function pickVideoExpression(seen, mode) {
  const seenJson = JSON.stringify(seen);
  const roots = mode === 'related'
    ? `['ytd-watch-next-secondary-results-renderer','#related','#secondary']`
    : `['ytd-two-column-search-results-renderer #primary','ytd-two-column-search-results-renderer','ytd-search #contents','ytd-section-list-renderer']`;
  return script(`
    const seen = new Set(${seenJson});
    const current = new URL(location.href).searchParams.get('v') || '';
    const roots = ${roots}.map((selector) => document.querySelector(selector)).filter(Boolean);
    const ads = ${JSON.stringify(AD)};
    const byId = new Map();
    for (const root of roots) {
      for (const anchor of root.querySelectorAll('a[href*="watch?v="]')) {
        if (anchor.closest(ads)) continue;
        if (anchor.closest('ytd-reel-shelf-renderer, ytd-reel-item-renderer')) continue;
        let id = '';
        try { id = new URL(anchor.href, location.origin).searchParams.get('v') || ''; } catch { id = ''; }
        if (!id || id === current || seen.has(id) || byId.has(id)) continue;
        const rect = anchor.getBoundingClientRect();
        const visible = rect.width >= 40 && rect.height >= 24 && rect.bottom > 90 && rect.top < window.innerHeight - 24;
        if (!visible) continue;
        const card = anchor.closest('ytd-video-renderer, ytd-compact-video-renderer, ytd-rich-item-renderer, ytd-grid-video-renderer, yt-lockup-view-model');
        const heading = card?.querySelector('#video-title, h3 a, h3, [title]');
        const title = (heading?.getAttribute('title') || heading?.textContent || anchor.getAttribute('title') || anchor.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 80);
        byId.set(id, { id, title, x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2) });
      }
    }
    const list = [...byId.values()];
    if (!list.length) return null;
    return list[Math.floor(Math.random() * list.length)];
  `);
}

export function showPlayerExpression() {
  return script(`
    const player = document.querySelector('#movie_player, ytd-player, video.html5-main-video');
    if (!player) {
      window.scrollTo(0, 0);
      return false;
    }
    const top = player.getBoundingClientRect().top + window.scrollY;
    window.scrollTo(0, Math.max(0, top - 12));
    return true;
  `);
}

export function scrollRelatedExpression() {
  return script(`
    const root = document.querySelector('#related, ytd-watch-next-secondary-results-renderer, #secondary');
    if (!root) return false;
    const before = root.scrollTop;
    root.scrollTop = before + 420;
    if (Math.abs(root.scrollTop - before) < 20) {
      const top = root.getBoundingClientRect().top + window.scrollY;
      window.scrollTo(0, Math.max(0, top - 80));
    }
    return true;
  `);
}

export function controlExpression(kind) {
  return script(`
    const kind = ${JSON.stringify(kind)};
    function collect(root, found, depth) {
      if (!root || depth > 7 || !root.querySelectorAll) return;
      for (const node of root.querySelectorAll('button, [role="button"]')) found.push(node);
      for (const node of root.querySelectorAll('*')) {
        if (node.shadowRoot) collect(node.shadowRoot, found, depth + 1);
      }
    }
    function inComments(node) {
      let current = node;
      while (current) {
        if (current.nodeType === 1) {
          const tag = current.localName || '';
          if (tag === 'ytd-comments' || tag === 'ytd-comment-thread-renderer' || tag === 'ytd-comment-view-model' || current.id === 'comments') return true;
        }
        if (current.parentElement) {
          current = current.parentElement;
          continue;
        }
        const root = current.getRootNode && current.getRootNode();
        if (root && root.host && root.host !== current) {
          current = root.host;
          continue;
        }
        break;
      }
      return false;
    }
    function clean(value) {
      return String(value || '').replace(/\\u00a0/g, ' ').replace(/\\s+/g, ' ').trim().toLowerCase();
    }
    function labelOf(button) {
      const aria = button.getAttribute('aria-label') || '';
      const title = button.getAttribute('title') || '';
      const text = kind === 'like' ? '' : (button.innerText || '');
      return clean(aria || title || text);
    }
    function hiddenButton(button) {
      let current = button;
      while (current) {
        if (current.nodeType === 1 && (current.hasAttribute('hidden') || current.hasAttribute('invisible'))) return true;
        if (current.parentElement) {
          current = current.parentElement;
          continue;
        }
        const root = current.getRootNode && current.getRootNode();
        if (root && root.host && root.host !== current) {
          current = root.host;
          continue;
        }
        break;
      }
      return false;
    }
    function subscribeState(button) {
      const aria = clean(button.getAttribute('aria-label') || '');
      const text = clean(button.innerText || '');
      const blob = aria + ' ' + text;
      if (/вы подписаны|отписаться|unsubscribe|subscribed/.test(blob) || text === 'вы подписаны') return 'done';
      if (/оформить подписку|подписаться|\\bsubscribe\\b/.test(aria) || text === 'подписаться' || text === 'subscribe') return 'open';
      return '';
    }
    function measure(button) {
      const rect = button.getBoundingClientRect();
      if (rect.width < 8 || rect.height < 8) return null;
      return rect;
    }
    function reveal(button) {
      const rect = button.getBoundingClientRect();
      if (rect.bottom > window.innerHeight - 8) window.scrollBy(0, rect.bottom - window.innerHeight + 24);
      else if (rect.top < 56) window.scrollBy(0, rect.top - 64);
      const next = button.getBoundingClientRect();
      return { x: Math.round(next.x + next.width / 2), y: Math.round(next.y + next.height / 2) };
    }
    const buttons = [];
    const starts = [
      document.querySelector('#subscribe-button'),
      document.querySelector('ytd-subscribe-button-renderer'),
      document.querySelector('ytd-watch-metadata'),
      document.querySelector('#above-the-fold'),
      document.querySelector('#actions'),
      document.querySelector('#menu-container'),
      document.querySelector('ytd-watch-flexy #primary'),
      document.querySelector('ytd-watch-flexy'),
    ].filter(Boolean);
    for (const root of (starts.length ? starts : [document.body])) collect(root, buttons, 0);
    const seen = new Set();
    let best = null;
    for (const button of buttons) {
      if (seen.has(button) || inComments(button) || hiddenButton(button)) continue;
      seen.add(button);
      const label = labelOf(button);
      const rect = measure(button);
      if (!rect || (kind !== 'like' && kind !== 'subscribe' && !label)) continue;
      if (kind === 'like') {
        if (label && /не нравится|dislike/.test(label)) continue;
        const icon = button.querySelector('[animated-icon-type="LIKE"], [icon="like"]');
        if (!((label && /нравится|\\blikes?\\b|unlike/.test(label)) || icon)) continue;
        const pressed = button.getAttribute('aria-pressed') === 'true' || /убрать отметку|unlike/.test(label);
        const candidate = { button, y: rect.top, state: pressed ? 'done' : 'open' };
        if (!best || candidate.y < best.y) best = candidate;
        continue;
      }
      const state = subscribeState(button);
      if (!state) continue;
      const shaped = Boolean(button.closest('#subscribe-button-shape, #subscribe-button'));
      const candidate = { button, y: rect.top, state, rank: shaped ? 0 : 1 };
      if (!best || candidate.rank < best.rank || (candidate.rank === best.rank && candidate.y < best.y)) best = candidate;
    }
    if (!best) return null;
    return { ...reveal(best.button), state: best.state };
  `);
}

export function commentStepExpression(step) {
  return script(`
    const step = ${JSON.stringify(step)};
    const host = document.querySelector('ytd-comments, #comments');
    if (step === 'ready') {
      if (!host) return { ok: false, message: 'Комментарии не найдены' };
      const blocked = host.querySelector('#message, ytd-message-renderer');
      const blockedText = (blocked?.innerText || '').toLowerCase();
      if (/комментарии отключены|comments are turned off|комментирование отключено/.test(blockedText)) {
        return { ok: false, message: 'Комментарии отключены' };
      }
      host.scrollIntoView({ block: 'center' });
      return { ok: true };
    }
    const box = document.querySelector('ytd-comment-simplebox-renderer');
    if (!box) return { ok: false, message: 'Поле комментария недоступно' };
    const boxText = (box.innerText || '').toLowerCase();
    if (/войдите|sign in|войти/.test(boxText)) return { ok: false, message: 'Нет входа в аккаунт, комментарий пропущен' };
    const target = step === 'submit'
      ? box.querySelector('#submit-button button, #submit-button [role="button"]')
      : box.querySelector('#simplebox-placeholder, #placeholder-area, #contenteditable-root');
    if (!target) return { ok: false, message: step === 'submit' ? 'Кнопка отправки комментария недоступна' : 'Редактор комментария не открылся' };
    if (step === 'submit') {
      const submitHost = target.closest('#submit-button');
      const disabled = target.disabled || target.hasAttribute('disabled') || target.getAttribute('aria-disabled') === 'true'
        || submitHost?.hasAttribute('disabled') || submitHost?.getAttribute('aria-disabled') === 'true';
      if (disabled) {
        box.querySelector('#cancel-button button')?.click();
        return { ok: false, message: 'Кнопка отправки комментария недоступна' };
      }
    }
    const rect = target.getBoundingClientRect();
    return { ok: true, x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2) };
  `);
}

export function closeLoginExpression() {
  return script(`
    const dialogs = document.querySelectorAll('tp-yt-paper-dialog, ytd-popup-container');
    for (const dialog of dialogs) {
      const rect = dialog.getBoundingClientRect();
      if (rect.width < 40 || rect.height < 40) continue;
      const text = (dialog.innerText || '').toLowerCase();
      if (!/войти|sign in/.test(text)) continue;
      const close = dialog.querySelector('#close-button button, button[aria-label="Закрыть"], button[aria-label="Close"]');
      close?.click();
      return true;
    }
    return false;
  `);
}

export function skipAdExpression() {
  return script(`
    function pointOf(node) {
      if (!node) return null;
      const button = node.closest ? (node.closest('button, [role="button"]') || node) : node;
      if (button.disabled || button.getAttribute?.('aria-disabled') === 'true') return null;
      if (button.hasAttribute?.('hidden') || button.hasAttribute?.('invisible')) return null;
      const style = getComputedStyle(button);
      if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return null;
      const rect = button.getBoundingClientRect();
      if (rect.width < 16 || rect.height < 12) return null;
      if (rect.bottom < 0 || rect.top > window.innerHeight || rect.right < 0 || rect.left > window.innerWidth) return null;
      return { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2) };
    }
    function search(root, depth) {
      if (!root || depth > 6) return null;
      const nodes = root.querySelectorAll?.([
        'button.ytp-skip-ad-button',
        '.ytp-skip-ad-button',
        '.ytp-skip-ad-button__text',
        'button.ytp-ad-skip-button',
        '.ytp-ad-skip-button',
        '.ytp-ad-skip-button-modern',
        '.ytp-ad-skip-button-container button',
        'button[id^="skip-button"]',
      ].join(', ')) || [];
      for (const node of nodes) {
        const label = ((node.innerText || node.getAttribute?.('aria-label') || node.textContent || '') + '').toLowerCase();
        if (label && !/skip|пропуст/.test(label)) continue;
        const point = pointOf(node);
        if (point) return point;
      }
      const nested = root.querySelectorAll ? root.querySelectorAll('*') : [];
      for (const node of nested) {
        if (!node.shadowRoot) continue;
        const found = search(node.shadowRoot, depth + 1);
        if (found) return found;
      }
      return null;
    }
    return search(document, 0);
  `);
}

export function playExpression() {
  return script(`
    const video = document.querySelector('video.html5-main-video, #movie_player video, video');
    if (!video) return false;
    if (!video.paused && !video.ended) return true;
    try { video.play(); } catch {}
    return true;
  `);
}
