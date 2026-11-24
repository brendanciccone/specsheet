// The scenario helper. Scenario files import `flow`, `scenario` and `expect` from here.
//
//   flow('Contact form', { states: { 'help/contact': ['ready', 'sent'] } }, () => {
//     scenario('Message is sent', { covers: ['R1'] }, async ({ page, step }) => {
//       await step('Given I am on the Help page', { screen: 'help/contact', state: 'ready' }, async () => {
//         await page.goto('/help');
//       });
//     });
//   });

import fs from 'node:fs';
import path from 'node:path';
import { test as base, expect as baseExpect } from '@playwright/test';
import { loadConfig } from './config.js';
import { cleanError, escapeHtml, keywordOf, stripKeyword } from './util.js';

const CAPTURE_MODES = ['page', 'viewport', 'none'];

let cachedConfig;
function runConfig() {
  if (cachedConfig === undefined) {
    cachedConfig = process.env.SPECSHEET_DIR ? loadConfig(process.env.SPECSHEET_DIR) : null;
  }
  return cachedConfig;
}

/**
 * The caption shown at the bottom of the video while a step runs. It fades in, unless
 * it is `still`: one that takes the place of the same caption, which must not blink.
 */
function captionHtml(title, still = false) {
  const keyword = keywordOf(title);
  const rest = stripKeyword(title);
  const hasKeyword = rest !== title.trim();
  return (
    '<style>@keyframes specsheet-caption{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}</style>' +
    '<div style="position:fixed;left:0;right:0;bottom:28px;display:flex;justify-content:center;pointer-events:none;' +
    `${still ? '' : 'animation:specsheet-caption 180ms ease-out both'}">` +
    '<div style="max-width:78%;padding:10px 18px;border-radius:10px;background:rgba(24,24,24,0.93);color:#e6e6e6;' +
    'font:500 18px/1.35 system-ui,-apple-system,Segoe UI,sans-serif;box-shadow:0 6px 24px rgba(0,0,0,0.28)">' +
    (hasKeyword ? `<span style="color:#fff;font-weight:700">${escapeHtml(keyword)}</span> ` : '') +
    `${escapeHtml(rest)}</div></div>`
  );
}

/**
 * How long a caption stays up after its step, in milliseconds. Never less than the pace,
 * and long enough to read the text: longer captions stay longer, up to four seconds.
 */
export function readingTime(text, pace) {
  return Math.round(Math.max(pace, Math.min(4000, 700 + 45 * text.trim().length)));
}

/** The card that opens each scenario in the video: its number and its name, and nothing else. */
function titleCardHtml(title, number) {
  return (
    // A recording only takes a picture when the page changes, and it can start a moment
    // after the card is drawn. A card that never changed would then be missed altogether,
    // so one dot in the corner keeps changing, too faintly to see.
    '<style>@keyframes specsheet-live{from{opacity:.02}to{opacity:.07}}</style>' +
    '<div style="position:fixed;left:0;top:0;width:3px;height:3px;background:#fff;animation:specsheet-live 300ms linear infinite alternate"></div>' +
    '<div style="position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:#1a1a1a;pointer-events:none">' +
    '<div style="max-width:76%;text-align:center;font:600 44px/1.2 system-ui,-apple-system,Segoe UI,sans-serif;color:#fff">' +
    `${number ? `<span style="color:#9a9a9a">${number}.</span> ` : ''}${escapeHtml(title)}</div></div>`
  );
}

/**
 * A small sign at the top of the video for a change of page that nobody clicks for: an
 * address opened directly, Back, a reload. Without it the page seems to jump by itself.
 */
function wayHtml(text) {
  return (
    '<style>@keyframes specsheet-way{from{opacity:0;transform:translateY(-6px)}to{opacity:1;transform:none}}</style>' +
    '<div style="position:fixed;left:0;right:0;top:18px;display:flex;justify-content:center;pointer-events:none;' +
    'animation:specsheet-way 160ms ease-out both">' +
    '<div style="max-width:70%;padding:7px 16px;border-radius:999px;background:rgba(24,24,24,0.93);color:#fff;white-space:nowrap;overflow:hidden;' +
    'text-overflow:ellipsis;font:500 16px/1.35 system-ui,-apple-system,Segoe UI,sans-serif;box-shadow:0 6px 24px rgba(0,0,0,0.28)">' +
    `${escapeHtml(text)}</div></div>`
  );
}

/** The part of an address worth showing: where on the site, without the site. */
function shortAddress(address) {
  try {
    const url = new URL(String(address), 'http://site.invalid');
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return String(address);
  }
}

// Ways to change the page that are not a click on it, and what the video says for each.
const WAYS = {
  goto: (address) => `Opens ${shortAddress(address)}`,
  goBack: () => 'Back',
  goForward: () => 'Forward',
  reload: () => 'Reloads the page',
};

/** How long a caption is shown before its step starts, so the viewer knows what they are about to see. */
export function leadTime(text, pace) {
  return Math.round(Math.min(1800, Math.max(pace, 350 + 22 * text.trim().length)));
}

const HUMAN = Symbol.for('specsheet.human');

// The pointer drawn in the video. A recording has no mouse pointer of its own, so
// without one, things on the page seem to press themselves.
// It is drawn with plain shapes, since the recording's overlay does not take pictures.
const ARROW = 'polygon(0 0, 0 78%, 21% 61%, 36% 96%, 50% 90%, 36% 56%, 64% 56%)';
const POINTER =
  '<div style="position:relative;width:30px;height:30px;filter:drop-shadow(0 1px 2px rgba(0,0,0,.4))">' +
  `<div style="position:absolute;inset:0;background:#fff;clip-path:${ARROW}"></div>` +
  `<div style="position:absolute;left:2px;top:3.5px;width:24px;height:24px;background:#111;clip-path:${ARROW}"></div></div>`;
const pointers = new WeakMap();

function pointerHtml(from, to, ms) {
  const at = (point) => `translate(${Math.round(point.x)}px,${Math.round(point.y)}px)`;
  const name = `specsheet-pointer-${Date.now()}`;
  return (
    `<style>@keyframes ${name}{from{transform:${at(from)}}to{transform:${at(to)}}}</style>` +
    `<div style="position:fixed;left:-1px;top:-1px;pointer-events:none;transform:${at(to)};` +
    `animation:${name} ${ms}ms cubic-bezier(.35,.05,.25,1) both">${POINTER}</div>`
  );
}

/** Move the drawn pointer to a point on the screen, taking longer the further it has to go. */
async function movePointer(page, to) {
  if (!page.screencast?.showOverlay) return;
  const size = page.viewportSize() ?? { width: 1280, height: 720 };
  const state = pointers.get(page) ?? { at: { x: size.width * 0.55, y: size.height * 0.62 }, overlay: null };
  pointers.set(page, state);
  to ??= state.at;
  const distance = Math.hypot(to.x - state.at.x, to.y - state.at.y);
  const ms = distance < 4 ? 0 : Math.round(Math.min(750, Math.max(260, 180 + distance * 0.55)));
  try {
    if (ms) {
      const moving = await page.screencast.showOverlay(pointerHtml(state.at, to, ms));
      await state.overlay?.dispose?.().catch(() => {});
      state.overlay = moving;
      await page.waitForTimeout(ms + 60);
    }
    // Leave a pointer that does not move. An overlay plays its movement again whenever
    // the overlays are hidden and shown, as they are around every screenshot.
    const still = await page.screencast.showOverlay(pointerHtml(to, to, 0));
    await state.overlay?.dispose?.().catch(() => {});
    state.overlay = still;
    state.at = to;
  } catch {
    // No pointer in the video is not a reason to fail a step.
  }
}

/** Put the pointer back where it was, after a new page or a screenshot took it away. */
async function restorePointer(page) {
  await movePointer(page, null);
}

// Pages still showing the title card of a scenario that has not opened its first page yet.
const cards = new WeakMap();

/** A ring that spreads from the pointer when it clicks. */
function clickHtml(point) {
  const name = `specsheet-click-${Date.now()}`;
  return (
    `<style>@keyframes ${name}{from{transform:scale(.3);opacity:.9}to{transform:scale(1);opacity:0}}</style>` +
    `<div style="position:fixed;left:${Math.round(point.x) - 18}px;top:${Math.round(point.y) - 18}px;width:36px;height:36px;` +
    `border-radius:50%;border:3px solid rgba(20,20,20,.85);box-shadow:0 0 0 2px rgba(255,255,255,.85);pointer-events:none;animation:${name} 420ms ease-out both"></div>`
  );
}
const TYPED = ['text', 'email', 'search', 'tel', 'url', 'password', ''];

// Pages whose scenario is being recorded at a watchable pace.
const paced = new WeakSet();

/**
 * Runs in the page. Scrolls smoothly to an element that is off screen, under the caption
 * or outside the part of a scrolling panel that shows, and answers once the page has
 * stopped moving. Answers false when the element is already in view. `wait` is how long
 * to stay on what is showing now before leaving it.
 */
function scrollToward(element, wait) {
  const box = element.getBoundingClientRect();
  if (!box.width && !box.height) return false;
  const top = 70;
  const bottom = window.innerHeight - 130;
  let block = 'center';
  let inView = box.top >= top && box.bottom <= bottom && box.right > 0 && box.left < window.innerWidth;
  if (box.height > bottom - top) {
    // Taller than the screen: it is in view once it fills half of it.
    inView = Math.min(box.bottom, window.innerHeight) - Math.max(box.top, 0) >= window.innerHeight * 0.5;
    block = 'start';
  }
  // Inside a panel that scrolls on its own, it also has to be in the part the panel shows.
  // Sideways it only has to be within reach: a wide table is in view while part of it shows.
  for (let node = element.parentElement; inView && node && node !== document.documentElement; node = node.parentElement) {
    const style = getComputedStyle(node);
    const frame = node.getBoundingClientRect();
    if (/auto|scroll/.test(style.overflowY) && (box.top < frame.top - 1 || box.bottom > frame.bottom + 1)) inView = false;
    if (/auto|scroll/.test(style.overflowX) && (box.right <= frame.left || box.left >= frame.right)) inView = false;
  }
  if (inView) return false;
  return new Promise((resolve) => {
    // Wait until the page has stopped moving, so the pointer goes to where the element
    // ends up and nothing is clicked while it is still sliding.
    const settle = () => {
      const started = performance.now();
      let last = null;
      let still = 0;
      const check = () => {
        const now = element.getBoundingClientRect().top;
        still = now === last ? still + 1 : 0;
        last = now;
        if (still >= 6 || performance.now() - started > 2200) resolve(true);
        else requestAnimationFrame(check);
      };
      requestAnimationFrame(check);
    };
    // What the page's own scroll could not bring into view, such as a row inside a
    // panel that scrolls by itself, is left to the browser.
    const finish = () => {
      element.scrollIntoView({ behavior: 'smooth', block: block === 'start' ? 'nearest' : block, inline: 'nearest' });
      settle();
    };
    setTimeout(() => {
      // Scroll the page at the speed of a hand: further takes longer. The browser's own
      // smooth scroll covers any distance in a fraction of a second, which reads as a jump.
      const page = document.scrollingElement || document.documentElement;
      const now = element.getBoundingClientRect();
      const from = window.scrollY;
      const aim = block === 'start' ? now.top - top : now.top + now.height / 2 - window.innerHeight / 2;
      const to = Math.max(0, Math.min(page.scrollHeight - window.innerHeight, from + aim));
      const distance = Math.abs(to - from);
      if (distance < 2) return finish();
      const ms = Math.min(1300, Math.max(380, 320 + distance * 0.5));
      const started = performance.now();
      const frame = (time) => {
        const part = Math.min(1, Math.max(0, (time - started) / ms));
        const eased = part < 0.5 ? 4 * part ** 3 : 1 - (-2 * part + 2) ** 3 / 2;
        window.scrollTo({ top: from + (to - from) * eased, behavior: 'instant' });
        if (part < 1) requestAnimationFrame(frame);
        else finish();
      };
      requestAnimationFrame(frame);
    }, wait);
  });
}

/**
 * Bring what a step uses or checks into view, the way a person scrolls to it. `look` is
 * for a check: a moment on what is showing before the page moves, and a moment on what
 * it moved to, so each thing a step checks is seen.
 */
async function bringIntoView(locator, timeout, look = false) {
  try {
    const moved = await locator.evaluate(scrollToward, look ? 380 : 0, { timeout });
    if (moved) await locator.page().waitForTimeout(look ? 420 : 140);
    return moved;
  } catch {
    // Not there yet, or not scrollable: the action or the check will wait and report.
    return false;
  }
}

/**
 * Make the actions in a paced run look like a person doing them, for the video: scroll to
 * a control before using it, and type text a key at a time. Every change falls back to
 * what Playwright does on its own, so a scenario behaves the same as in a fast run.
 */
function humanize(page) {
  if (!paced.has(page)) {
    paced.add(page);
    for (const [name, say] of Object.entries(WAYS)) {
      const original = page[name];
      if (typeof original !== 'function') continue;
      page[name] = async (...args) => {
        // The page a scenario opens on needs no sign: its title card has just named it.
        if (!cards.get(page) && page.url() !== 'about:blank') {
          await page.screencast?.showOverlay?.(wayHtml(say(args[0])), { duration: 1800 }).catch(() => {});
          await page.waitForTimeout(700).catch(() => {});
        }
        return original.apply(page, args);
      };
    }
  }
  const proto = Object.getPrototypeOf(page.locator('html'));
  if (proto[HUMAN]) return;
  proto[HUMAN] = true;

  // Scroll to the control, then move the pointer onto it and, for a press, let it rest
  // there for a moment first, as a hand does.
  const approach = async (locator, options, press) => {
    try {
      await bringIntoView(locator, 3000);
      const view = locator.page();
      const box = await locator.boundingBox({ timeout: 1500 });
      if (!box) return;
      const point = options?.position
        ? { x: box.x + options.position.x, y: box.y + options.position.y }
        : { x: box.x + box.width / 2, y: box.y + box.height / 2 };
      await movePointer(view, point);
      if (!press) return;
      await view.waitForTimeout(110);
      await view.screencast?.showOverlay?.(clickHtml(point), { duration: 450 }).catch(() => {});
      await view.waitForTimeout(70);
    } catch {
      // Not there yet: the action itself will wait and report.
    }
  };

  for (const name of ['click', 'dblclick', 'check', 'uncheck', 'setChecked', 'selectOption', 'hover', 'tap']) {
    const original = proto[name];
    if (typeof original !== 'function') continue;
    proto[name] = async function (...args) {
      const options = args.find((item) => item && typeof item === 'object' && !Array.isArray(item) && 'position' in item);
      await approach(this, options, name !== 'hover');
      return original.apply(this, args);
    };
  }

  // Actions with no press of their own still happen where the viewer can see them.
  for (const name of ['press', 'pressSequentially', 'type', 'focus', 'clear', 'setInputFiles', 'dragTo']) {
    const original = proto[name];
    if (typeof original !== 'function') continue;
    proto[name] = async function (...args) {
      await bringIntoView(this, 3000);
      return original.apply(this, args);
    };
  }

  const fill = proto.fill;
  proto.fill = async function (value, options) {
    const text = String(value);
    try {
      const kind = await this.evaluate(
        (element) => (element.tagName === 'TEXTAREA' ? 'area' : element.tagName === 'INPUT' ? element.type : null),
        null,
        { timeout: 1500 },
      );
      const typed = kind === 'area' || (TYPED.includes(kind) && !text.includes('\n'));
      if (typed && text.length > 0 && text.length <= 400) {
        await this.click(options);
        if ((await this.inputValue()) !== '') await fill.call(this, '', options);
        // A long text is typed faster, so no field takes more than about two seconds.
        await this.pressSequentially(text, { delay: Math.max(6, Math.min(38, 1800 / text.length)) });
        // The text has been typed. Check it only if the field is still there: a field
        // that takes its last character and goes away, such as a one-time code, is done.
        const now = await this.inputValue({ timeout: 800 }).catch(() => null);
        if (now === null || now === text) {
          // A breath before the hand moves on to the next thing.
          await this.page().waitForTimeout(160).catch(() => {});
          return;
        }
      } else {
        await bringIntoView(this, 1500);
      }
    } catch {
      // Fall through to the plain fill, which waits for the field and reports any problem.
    }
    await fill.call(this, value, options);
  };
}

// Checks that pass with nothing on the page to look at, as written and after `.not`.
// Being in or out of the viewport is the very thing those two check, so the page is
// left where it is for them.
const UNSEEN = ['toBeHidden', 'toBeInViewport', 'toHaveScreenshot', 'toMatchAriaSnapshot'];
const UNSEEN_NOT = ['toBeVisible', 'toBeAttached', 'toBeInViewport', 'toHaveScreenshot', 'toMatchAriaSnapshot'];

/** How many checks have failed so far in this scenario. A soft check fails without throwing. */
function failures() {
  try {
    return base.info().errors.length;
  } catch {
    return 0;
  }
}

/** Scroll to what a check looked at, if it is there to be looked at. */
async function look(locator) {
  try {
    const target = locator.first();
    // Nothing matches, as after a check that something is gone: do not wait for it.
    if (!(await target.count())) return;
    await bringIntoView(target, 1500, true);
  } catch {
    // The page went away, or the check was the last thing on it.
  }
}

/**
 * In a paced run, a check that passes scrolls to what it checked, so the video shows the
 * thing the step is about. Nothing else about the check changes, and a check that fails
 * is left exactly as it was.
 */
function shown(matchers, locator, negated = false) {
  return new Proxy(matchers, {
    get(target, name) {
      const value = Reflect.get(target, name);
      // `expect(x).not.toBeChecked()` is still about something on the page.
      if (name === 'not' && value && typeof value === 'object') return shown(value, locator, !negated);
      const unseen = negated ? UNSEEN_NOT : UNSEEN;
      if (typeof value !== 'function' || typeof name !== 'string' || !name.startsWith('to') || unseen.includes(name)) return value;
      return (...args) => {
        const before = failures();
        const outcome = value.apply(target, args);
        if (typeof outcome?.then !== 'function') return outcome;
        if (name === 'toHaveCount' && (args[0] === 0) !== negated) return outcome;
        return outcome.then(async (result) => {
          // A soft check that failed has been noted, not thrown. Leave the page as it is.
          if (failures() === before) await look(locator);
          return result;
        });
      };
    },
  });
}

const isLocator = (value) => typeof value?.page === 'function' && typeof value?.first === 'function' && typeof value?.evaluate === 'function';

function watching(value) {
  try {
    return isLocator(value) && paced.has(value.page());
  } catch {
    return false;
  }
}

/** Playwright's `expect`. In a paced run it also brings what was checked into view. */
export const expect = new Proxy(baseExpect, {
  apply(target, self, args) {
    const matchers = Reflect.apply(target, self, args);
    return watching(args[0]) ? shown(matchers, args[0]) : matchers;
  },
  get(target, name) {
    const value = Reflect.get(target, name);
    if (name !== 'soft' || typeof value !== 'function') return value;
    return (...args) => {
      const matchers = value.apply(target, args);
      return watching(args[0]) ? shown(matchers, args[0]) : matchers;
    };
  },
});

async function showCaption(page, title, still = false) {
  try {
    return (await page.screencast?.showOverlay?.(captionHtml(title, still))) ?? null;
  } catch {
    return null;
  }
}

/**
 * Once a caption has faded in, put a still one in its place. An overlay plays its fade
 * again whenever the page changes under it or a screenshot hides it, and a still one
 * has nothing to play.
 */
async function steady(page, caption, title) {
  if (!caption) return caption;
  await page.waitForTimeout(220).catch(() => {});
  const still = await showCaption(page, title, true);
  if (!still) return caption;
  await caption.dispose?.().catch(() => {});
  return still;
}

/** Wait until the page has painted whatever it was about to paint. */
function settle(page) {
  return page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 80)))),
  );
}

/**
 * A full-page screenshot that disturbs the video as little as possible.
 * While the browser captures the area beyond the visible screen, any frame the page
 * paints is recorded shrunken. So this waits for the page to go quiet first, then asks
 * the browser directly, which is quicker than Playwright's own full-page screenshot.
 */
async function fullPageShot(page, file) {
  await settle(page);
  const session = await page.context().newCDPSession(page);
  try {
    const metrics = await session.send('Page.getLayoutMetrics');
    const size = metrics.cssContentSize ?? metrics.contentSize;
    const { data } = await session.send('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: true,
      clip: { x: 0, y: 0, width: Math.ceil(size.width), height: Math.ceil(size.height), scale: 1 },
    });
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, Buffer.from(data, 'base64'));
  } finally {
    await session.detach().catch(() => {});
  }
}

async function capture(page, testInfo, record) {
  const name = `step-${String(record.index + 1).padStart(2, '0')}.png`;
  const file = path.join(testInfo.outputDir, name);
  const screencast = page.screencast;
  let caretStyle = null;
  try {
    // Keep the video's step captions and click markers out of the screenshot.
    await screencast?.hideOverlays?.().catch(() => {});
    await screencast?.hideActions?.().catch(() => {});
    if (record.capture === 'page') {
      try {
        // Hide the blinking text cursor, as Playwright's own screenshot does.
        caretStyle = await page.addStyleTag({ content: '* { caret-color: transparent !important; }' });
        await fullPageShot(page, file);
        return file;
      } catch {
        // Not a Chromium browser, or the direct route failed: fall back to Playwright's.
      }
    }
    await page.screenshot({
      path: file,
      fullPage: record.capture === 'page',
      animations: 'disabled',
      caret: 'hide',
    });
    return file;
  } catch {
    return null;
  } finally {
    await caretStyle?.evaluate((element) => element.remove()).catch(() => {});
    await screencast?.showOverlays?.().catch(() => {});
    // Make the video draw a fresh frame straight away. If the capture did disturb a
    // frame, this stops that frame from lingering, which matters most at the very end.
    await screencast
      ?.showOverlay?.('<div style="position:fixed;left:0;top:0;width:2px;height:2px;background:rgba(0,0,0,0.02)"></div>', { duration: 120 })
      .catch(() => {});
  }
}

// When each page was made, which is when its recording starts. Screenshot times are
// counted from here, so they line up with the video even when a hook uses the page
// before the scenario's own steps begin.
const openedAt = new WeakMap();

export const test = base.extend({
  page: async ({ page }, use) => {
    openedAt.set(page, Date.now());
    await use(page);
  },
  step: async ({ page }, use, testInfo) => {
    const records = [];
    const pace = Number(process.env.SPECSHEET_PACE ?? runConfig()?.pace ?? 0);
    const opened = openedAt.get(page) ?? Date.now();

    const step = async (title, meta, body) => {
      if (typeof meta === 'function') {
        body = meta;
        meta = {};
      }
      if (typeof title !== 'string' || !title.trim()) {
        throw new Error('step() needs a title, for example "When I send the form".');
      }
      if (typeof body !== 'function') {
        throw new Error(`step("${title}") needs a function with the actions and checks for this step.`);
      }
      const captureMode = meta?.capture ?? 'page';
      if (!CAPTURE_MODES.includes(captureMode)) {
        throw new Error(`step("${title}"): capture must be one of ${CAPTURE_MODES.join(', ')}.`);
      }

      const given = (value) => value !== undefined && value !== null;
      const words = (value) => typeof value === 'string' && value.trim() !== '';
      if (given(meta?.decision) !== given(meta?.answer)) {
        throw new Error(`step("${title}"): "decision" and "answer" go together. Give both, or neither.`);
      }
      if (given(meta?.decision) && !(words(meta.decision) && words(meta.answer))) {
        throw new Error(`step("${title}"): "decision" and "answer" are each a few words of text.`);
      }

      const record = {
        index: records.length,
        title: title.trim(),
        keyword: keywordOf(title),
        screen: meta?.screen ?? null,
        state: meta?.state ?? null,
        decision: meta?.decision ?? null,
        answer: meta?.answer ?? null,
        capture: captureMode,
        status: 'passed',
        error: null,
        screenshot: null,
        durationMs: 0,
      };
      records.push(record);

      const started = Date.now();
      // The first step runs under the scenario's title card, which stays up until the
      // first page has loaded, so the video goes from the card straight to the page.
      const card = cards.get(page) ?? null;
      const led = pace > 0 && !card && page.url() !== 'about:blank';
      let caption = pace > 0 && !card ? await showCaption(page, record.title) : null;
      const before = pace > 0 ? page.url() : null;
      // Say what is about to happen, then do it.
      if (led) {
        caption = await steady(page, caption, record.title);
        await page.waitForTimeout(Math.max(0, leadTime(record.title, pace) - 220)).catch(() => {});
      }
      try {
        await base.step(record.title, async () => {
          await body();
        });
      } catch (error) {
        record.status = 'failed';
        record.error = cleanError(error?.message ?? String(error));
        throw error;
      } finally {
        record.durationMs = Date.now() - started;
        if (pace > 0) {
          // A step that opens a page loses its caption and has not been read yet, so
          // show it again for as long as it takes to read. Otherwise the caption was read
          // before the step, and a short look at the result is enough.
          const moved = page.url() !== before;
          if (card) {
            cards.delete(page);
            // A first step that opened no page would leave the card in its screenshot.
            // Take away the card alone: the step may have put its own content beside it.
            if (!moved) {
              await page
                .evaluate(() => {
                  const holder = document.getElementById('specsheet-title-card');
                  if (!holder) return;
                  holder.remove();
                  document.documentElement.style.background = '';
                })
                .catch(() => {});
            }
          }
          // The caption stays as it is, so it does not blink. Only a new page needs it
          // put back, along with the pointer.
          if (moved || !caption) {
            // The new one goes up before the old one comes down, and without the fade,
            // so a caption that survived the change of page is not seen to change.
            const old = caption;
            caption = await showCaption(page, record.title, Boolean(old));
            await old?.dispose?.().catch(() => {});
            if (!old) caption = await steady(page, caption, record.title);
          }
          if (moved) await restorePointer(page);
          const acted = record.durationMs - (led ? leadTime(record.title, pace) : 0) > 400;
          const hold = moved || !acted ? readingTime(record.title, pace) : Math.max(pace, 900);
          await page.waitForTimeout(hold).catch(() => {});
          await caption?.dispose?.().catch(() => {});
        }
        // Take the screenshot after the pause and after the caption is gone. The page has
        // had time to settle, and the caption does not flicker in the video.
        if (record.capture !== 'none') {
          const from = Date.now() - opened;
          record.screenshot = await capture(page, testInfo, record);
          // A full-page screenshot can leave a squashed frame in the recording. Note
          // when it was taken, so that moment can be cut from the video.
          if (pace > 0 && record.capture === 'page') record.shotAt = [from, Date.now() - opened];
        }
      }
    };

    await use(step);

    await testInfo.attach('specsheet-steps', {
      body: JSON.stringify(records),
      contentType: 'application/json',
    });
  },
});

const flowStack = [];

function checkStates(name, states) {
  for (const [screen, list] of Object.entries(states)) {
    if (!Array.isArray(list) || list.some((state) => typeof state !== 'string')) {
      throw new Error(`flow("${name}"): states["${screen}"] must be a list of state names.`);
    }
  }
}

/**
 * Group scenarios into a flow and declare the states each screen should have.
 * `notApplicable` maps "screen/state" to the reason a state does not apply.
 */
export function flow(name, options, body) {
  if (typeof options === 'function') {
    body = options;
    options = {};
  }
  const entry = {
    name,
    states: options?.states ?? {},
    notApplicable: options?.notApplicable ?? {},
    count: 0, // scenarios in this flow, counted as they are declared
  };
  checkStates(name, entry.states);

  test.describe(name, () => {
    flowStack.push(entry);
    try {
      body();
    } finally {
      flowStack.pop();
    }
  });
}

/** One Gherkin scenario. `covers` lists the requirement ids this scenario proves. */
export function scenario(title, options, body) {
  if (typeof options === 'function') {
    body = options;
    options = {};
  }
  const current = flowStack.at(-1) ?? { name: 'Unnamed flow', states: {}, notApplicable: {}, count: 0 };
  current.count += 1;
  const number = current.count;

  test(
    title,
    {
      annotation: [
        { type: 'specsheet:flow', description: JSON.stringify({ name: current.name, states: current.states, notApplicable: current.notApplicable }) },
        { type: 'specsheet:covers', description: JSON.stringify(options?.covers ?? []) },
      ],
    },
    async ({ page, step, context, request }, testInfo) => {
      const pace = Number(process.env.SPECSHEET_PACE ?? runConfig()?.pace ?? 0);
      if (pace > 0) {
        // The title card, the captions and the hand-speed pointer all take time that
        // counts against the scenario's time limit. A paced run gets four times the limit,
        // so a scenario that passes in a fast run does not time out in the final one.
        testInfo.setTimeout(testInfo.timeout * 4);
        humanize(page);
        // A title card at the start of the video: the scenario's name, then straight on.
        // It is written into the empty page the scenario starts on, so it is what the
        // video shows until the first step's page replaces it, with nothing in between.
        // Only an empty page is written into. A page that something has already opened
        // is left alone, and that scenario has no card.
        const card = await page
          .evaluate((html) => {
            // Empty means nothing to read or see. The recorder may have put its own
            // empty holder in the page, which does not count.
            if (location.href !== 'about:blank' || document.body.innerText.trim() || document.querySelector('img, canvas, video, svg, input, button')) return false;
            document.documentElement.style.background = '#1a1a1a';
            const holder = document.createElement('div');
            holder.id = 'specsheet-title-card';
            holder.innerHTML = html;
            document.body.append(holder);
            return true;
          }, titleCardHtml(title, number))
          .catch(() => false);
        await page.waitForTimeout(Math.min(2600, 1100 + 30 * title.length)).catch(() => {});
        // The pointer is there from the first moment the first page is.
        if (card) cards.set(page, true);
        const size = page.viewportSize() ?? { width: 1280, height: 720 };
        pointers.set(page, { at: { x: size.width * 0.55, y: size.height * 0.62 }, overlay: null });
      }
      await body({ page, step, context, request, testInfo });
    },
  );
}
