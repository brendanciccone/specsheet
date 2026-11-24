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
import { test as base, expect } from '@playwright/test';
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

/** The caption shown at the bottom of the video while a step runs. */
function captionHtml(title) {
  const keyword = keywordOf(title);
  const rest = stripKeyword(title);
  const hasKeyword = rest !== title.trim();
  return (
    '<div style="position:fixed;left:0;right:0;bottom:28px;display:flex;justify-content:center;pointer-events:none">' +
    '<div style="max-width:78%;padding:10px 18px;border-radius:10px;background:rgba(29,28,43,0.93);color:#fff;' +
    'font:500 18px/1.35 system-ui,-apple-system,Segoe UI,sans-serif;box-shadow:0 6px 24px rgba(0,0,0,0.28)">' +
    (hasKeyword ? `<span style="color:#F2B45A;font-weight:700">${escapeHtml(keyword)}</span> ` : '') +
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
    '<div style="position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:#1b1b1f;pointer-events:none">' +
    '<div style="max-width:76%;text-align:center;font:600 44px/1.2 system-ui,-apple-system,Segoe UI,sans-serif;color:#fff">' +
    `${number ? `<span style="color:#9a9aa5">${number}.</span> ` : ''}${escapeHtml(title)}</div></div>`
  );
}

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
  const distance = Math.hypot(to.x - state.at.x, to.y - state.at.y);
  const ms = distance < 4 ? 0 : Math.round(Math.min(750, Math.max(260, 180 + distance * 0.55)));
  try {
    const next = await page.screencast.showOverlay(pointerHtml(state.at, to, ms));
    await state.overlay?.dispose?.().catch(() => {});
    state.overlay = next;
    state.at = to;
    if (ms) await page.waitForTimeout(ms + 90);
  } catch {
    // No pointer in the video is not a reason to fail a step.
  }
}

/** Put the pointer back where it was, after a new page or a screenshot took it away. */
async function restorePointer(page) {
  const state = pointers.get(page);
  if (state) await movePointer(page, state.at);
}

/** A ring that spreads from the pointer when it clicks. */
function clickHtml(point) {
  const name = `specsheet-click-${Date.now()}`;
  return (
    `<style>@keyframes ${name}{from{transform:scale(.3);opacity:.9}to{transform:scale(1);opacity:0}}</style>` +
    `<div style="position:fixed;left:${Math.round(point.x) - 18}px;top:${Math.round(point.y) - 18}px;width:36px;height:36px;` +
    `border-radius:50%;border:3px solid #4a3fb8;pointer-events:none;animation:${name} 420ms ease-out both"></div>`
  );
}
const TYPED = ['text', 'email', 'search', 'tel', 'url', 'password', ''];

/**
 * Make the actions in a paced run look like a person doing them, for the video: scroll to
 * a control before using it, and type text a key at a time. Every change falls back to
 * what Playwright does on its own, so a scenario behaves the same as in a fast run.
 */
function humanize(page) {
  const proto = Object.getPrototypeOf(page.locator('html'));
  if (proto[HUMAN]) return;
  proto[HUMAN] = true;

  // Scroll smoothly to a control that is off screen or under the caption, as a person
  // would, then move the pointer onto it.
  const approach = async (locator, options, press) => {
    try {
      const moved = await locator.evaluate(
        (element) => {
          const box = element.getBoundingClientRect();
          if (box.top >= 70 && box.bottom <= window.innerHeight - 130) return false;
          element.scrollIntoView({ behavior: 'smooth', block: 'center' });
          return true;
        },
        null,
        { timeout: 1500 },
      );
      const view = locator.page();
      if (moved) await view.waitForTimeout(450);
      const box = await locator.boundingBox({ timeout: 1500 });
      if (!box) return;
      const point = options?.position
        ? { x: box.x + options.position.x, y: box.y + options.position.y }
        : { x: box.x + box.width / 2, y: box.y + box.height / 2 };
      await movePointer(view, point);
      if (press) await view.screencast?.showOverlay?.(clickHtml(point), { duration: 450 }).catch(() => {});
    } catch {
      // Not there yet, or not scrollable: the action itself will wait and report.
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
        if ((await this.inputValue()) === text) return;
      }
    } catch {
      // Fall through to the plain fill, which waits for the field and reports any problem.
    }
    await fill.call(this, value, options);
  };
}

async function showCaption(page, title) {
  try {
    return (await page.screencast?.showOverlay?.(captionHtml(title))) ?? null;
  } catch {
    return null;
  }
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

export const test = base.extend({
  step: async ({ page }, use, testInfo) => {
    const records = [];
    const pace = Number(process.env.SPECSHEET_PACE ?? runConfig()?.pace ?? 0);
    // The page has just been made, which is also when its recording starts.
    const opened = Date.now();

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

      if (Boolean(meta?.decision) !== Boolean(meta?.answer)) {
        throw new Error(`step("${title}"): "decision" and "answer" go together. Give both, or neither.`);
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
      let caption = pace > 0 ? await showCaption(page, record.title) : null;
      const before = pace > 0 ? page.url() : null;
      // Say what is about to happen, then do it. On a blank page there is nothing to
      // look at yet, so the first step starts straight away.
      if (pace > 0 && before !== 'about:blank') {
        await page.waitForTimeout(leadTime(record.title, pace)).catch(() => {});
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
          await caption?.dispose?.().catch(() => {});
          caption = await showCaption(page, record.title);
          if (moved) await restorePointer(page);
          const acted = record.durationMs - (before !== 'about:blank' ? leadTime(record.title, pace) : 0) > 400;
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
        humanize(page);
        // A title card at the start of the video: the scenario's name, then straight on.
        const card = await page.screencast?.showOverlay?.(titleCardHtml(title, current.count > 1 ? number : null)).catch(() => null);
        await page.waitForTimeout(Math.min(2600, 1100 + 30 * title.length)).catch(() => {});
        await card?.dispose?.().catch(() => {});
      }
      await body({ page, step, context, request, testInfo });
    },
  );
}

export { expect };
