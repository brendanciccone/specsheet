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

/** The card that opens each scenario in the video. */
function titleCardHtml(title, flowName, position) {
  return (
    '<div style="position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:#15141B;pointer-events:none">' +
    '<div style="width:74%;max-width:1040px;font-family:system-ui,-apple-system,Segoe UI,sans-serif">' +
    '<div style="display:flex;align-items:center;gap:14px;font-size:20px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:#1F9F78">' +
    '<span style="width:36px;height:4px;border-radius:2px;background:#1F9F78"></span>' +
    `${escapeHtml(position)}</div>` +
    `<div style="margin-top:22px;font-size:60px;line-height:1.1;font-weight:700;letter-spacing:-0.02em;color:#F6F4EE">${escapeHtml(title)}</div>` +
    `<div style="margin-top:20px;font-size:26px;color:#A9A7B8">${escapeHtml(flowName)}</div>` +
    '</div></div>'
  );
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

      const record = {
        index: records.length,
        title: title.trim(),
        keyword: keywordOf(title),
        screen: meta?.screen ?? null,
        state: meta?.state ?? null,
        capture: captureMode,
        status: 'passed',
        error: null,
        screenshot: null,
        durationMs: 0,
      };
      records.push(record);

      const started = Date.now();
      let caption = pace > 0 ? await showCaption(page, record.title) : null;
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
          // A step that navigates loses its caption, so show it again for the pause.
          await caption?.dispose?.().catch(() => {});
          caption = await showCaption(page, record.title);
          await page.waitForTimeout(readingTime(record.title, pace)).catch(() => {});
          await caption?.dispose?.().catch(() => {});
        }
        // Take the screenshot after the pause and after the caption is gone. The page has
        // had time to settle, and the caption does not flicker in the video.
        if (record.capture !== 'none') {
          record.screenshot = await capture(page, testInfo, record);
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
        // A title card at the start of the video, held long enough to read.
        const position = current.count > 1 ? `Scenario ${number} of ${current.count}` : 'Scenario';
        const card = await page.screencast?.showOverlay?.(titleCardHtml(title, current.name, position)).catch(() => null);
        await page.waitForTimeout(Math.max(2400, readingTime(title, 0))).catch(() => {});
        await card?.dispose?.().catch(() => {});
      }
      await body({ page, step, context, request, testInfo });
    },
  );
}

export { expect };
