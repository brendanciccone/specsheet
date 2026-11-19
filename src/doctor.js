// What a run needs from this computer, and what to say when something is missing.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { BROWSERS, launchOptions } from './config.js';

const NAMES = { chromium: "Playwright's Chromium", chrome: 'Google Chrome', msedge: 'Microsoft Edge' };

export function browserLabel(browser) {
  return Object.hasOwn(NAMES, browser) ? NAMES[browser] : String(browser);
}

/** What to do when the chosen browser is not on this computer. */
export function browserMissing(browser) {
  if (browser === 'chromium') {
    return (
      "Playwright's Chromium is not installed. Install it with \"npx playwright install chromium\".\n" +
      'If that download is blocked, use a browser already on this computer: set "browser" to "chrome" or\n' +
      '"msedge" in specsheet.config.json. "specsheet doctor" says which are installed.'
    );
  }
  return (
    `${browserLabel(browser)} is not installed, and specsheet.config.json sets "browser": "${browser}".\n` +
    'Install it, or set "browser" to one that is installed. "specsheet doctor" says which are.'
  );
}

/** What to do when the browser starts but video cannot be recorded. */
export const RECORDING_MISSING =
  "Videos cannot be recorded, because Playwright's ffmpeg is not installed. It is separate from the ffmpeg\n" +
  'that joins videos. Install it with "npx playwright install ffmpeg", or set "videos": "none" in\n' +
  'specsheet.config.json to run without videos.';

const NO_FFMPEG = /Executable doesn't exist at .*ffmpeg/;
const NOT_INSTALLED = /Executable doesn't exist at|distribution '[^']+' is not found/;
const LAUNCH_FAILED = /browserType\.launch/;
const NEEDS_LIBRARIES = /missing dependencies|shared librar/i;

/**
 * The first line of an error that says something. Playwright starts with its own prefixes,
 * and draws a box around some reasons.
 */
function gist(error) {
  const lines = String(error ?? '')
    .split('\n')
    .map((text) => text.replace(/[║╔╗╚╝═]/g, '').replace(/^\s*(Error:\s*)?(browserType\.launch:\s*)?/, '').trim());
  return lines.find((text) => /[a-z]/i.test(text)) ?? 'no reason was given';
}

/**
 * What to say about a browser that did not start. Only an absent browser gets the advice
 * to install it. Any other failure keeps its own reason: installing again would not help.
 */
export function browserProblem(browser, error) {
  if (NOT_INSTALLED.test(error ?? '')) return browserMissing(browser);
  const lines = [`${browserLabel(browser)} is installed but could not start: ${gist(error)}`];
  if (NEEDS_LIBRARIES.test(error ?? '')) {
    lines.push('On Linux, install the system libraries it needs with "npx playwright install-deps chromium".');
  }
  return lines.join('\n');
}

/** Why a scenario did not run, when the computer is the cause: 'recorder', 'browser' or null. */
function environmentCause(scenario) {
  const error = scenario.error ?? '';
  if (scenario.steps?.length) return null;
  if (NO_FFMPEG.test(error)) return 'recorder';
  if (LAUNCH_FAILED.test(error) || NOT_INSTALLED.test(error)) return 'browser';
  return null;
}

/**
 * When every scenario failed because the browser or the recorder could not start, the
 * message to show instead of findings. Those findings would blame the design for a
 * problem with the computer. Null when any scenario really ran.
 */
export function environmentProblem(results, config) {
  const scenarios = results.scenarios ?? [];
  const causes = scenarios.map(environmentCause);
  if (!causes.length || causes.includes(null)) return null;
  const messages = [];
  const browser = causes.indexOf('browser');
  if (browser >= 0) messages.push(browserProblem(config.browser, scenarios[browser].error));
  if (causes.includes('recorder')) messages.push(RECORDING_MISSING);
  return messages.join('\n\n');
}

async function launchChromium(options) {
  const { chromium } = await import('@playwright/test');
  return chromium.launch(options);
}

/** Start a browser for real, and record a moment of video with it. */
export async function probe(browser, { recording = true, launch = launchChromium } = {}) {
  let instance;
  try {
    instance = await launch(launchOptions(browser));
  } catch (error) {
    return { launches: false, records: false, error: String(error?.message ?? error) };
  }
  let records = null;
  if (recording) {
    let dir = null;
    try {
      dir = fs.mkdtempSync(path.join(os.tmpdir(), 'specsheet-doctor-'));
      const context = await instance.newContext({ recordVideo: { dir } });
      await context.newPage();
      await context.close();
      records = true;
    } catch {
      records = false;
    } finally {
      if (dir) fs.rmSync(dir, { recursive: true, force: true });
    }
  }
  await instance.close().catch(() => {});
  return { launches: true, records, error: null };
}

/**
 * What "specsheet doctor" says about the browser and recording. `ready` is false when a
 * run could not start: the chosen browser does not start, or videos are wanted and
 * cannot be recorded.
 */
export async function browserReport(browser = 'chromium', { videos = true, check = probe } = {}) {
  const lines = [];
  const chosen = await check(browser);
  let working = chosen.launches ? chosen : null;
  if (chosen.launches) {
    lines.push(`Browser: ${browserLabel(browser)} starts.`);
  } else {
    const absent = NOT_INSTALLED.test(chosen.error ?? '');
    const [headline, ...more] = browserProblem(browser, chosen.error).split('\n');
    lines.push(`Browser: ${headline}`);
    // An absent browser's other lines are general advice. What follows is specific to this computer.
    if (!absent) lines.push(...more.map((line) => `  ${line}`));
    let alternatives = 0;
    for (const other of BROWSERS.filter((name) => name !== browser)) {
      const result = await check(other);
      if (!result.launches) continue;
      working ??= result;
      alternatives += 1;
      const how = other === 'chromium' ? 'remove "browser" from' : `set "browser": "${other}" in`;
      lines.push(`  ${browserLabel(other)} starts and can be used instead: ${how} specsheet.config.json.`);
    }
    if (!alternatives) {
      lines.push('  No other browser Specsheet can use was found.');
      if (absent && browser !== 'chromium') {
        lines.push(`  Install ${browserLabel(browser)}, or run "npx playwright install chromium" and remove "browser" from specsheet.config.json.`);
      }
    }
  }
  if (working?.records) lines.push('Recording: videos can be recorded.');
  else if (working && videos) lines.push(`Recording: v${RECORDING_MISSING.slice(1)}`);
  else if (working) lines.push('Recording: not available, and not needed: specsheet.config.json sets "videos": "none".');
  return { lines, ready: chosen.launches && (chosen.records !== false || !videos) };
}
