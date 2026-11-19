// What a run needs from this computer, and what to say when something is missing.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { BROWSERS, launchOptions } from './config.js';

const NAMES = { chromium: "Playwright's Chromium", chrome: 'Google Chrome', msedge: 'Microsoft Edge' };

export function browserLabel(browser) {
  return NAMES[browser] ?? browser;
}

/** What to do when the chosen browser cannot start. */
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
const NO_BROWSER = /Executable doesn't exist at|distribution '[^']+' is not found/;

/**
 * When every scenario failed because the browser or the recorder is missing, the message
 * to show instead of findings. Those findings would blame the design for a problem with
 * the computer. Null when the run was a real one.
 */
export function environmentProblem(results, config) {
  const errors = (results.scenarios ?? []).map((scenario) => scenario.error ?? '');
  if (!errors.length) return null;
  if (errors.every((error) => NO_FFMPEG.test(error))) return RECORDING_MISSING;
  if (errors.every((error) => NO_BROWSER.test(error))) return browserMissing(config.browser);
  return null;
}

/** Start a browser for real, and record a moment of video with it. */
export async function probe(browser, { recording = true } = {}) {
  const { chromium } = await import('@playwright/test');
  let instance;
  try {
    instance = await chromium.launch(launchOptions(browser));
  } catch {
    return { launches: false, records: false };
  }
  let records = null;
  if (recording) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'specsheet-doctor-'));
    try {
      const context = await instance.newContext({ recordVideo: { dir } });
      await context.newPage();
      await context.close();
      records = true;
    } catch {
      records = false;
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
  await instance.close().catch(() => {});
  return { launches: true, records };
}

/** The lines "specsheet doctor" prints about the browser and recording. */
export async function browserReport(browser = 'chromium') {
  const lines = [];
  const chosen = await probe(browser);
  let working = chosen.launches ? chosen : null;
  if (chosen.launches) {
    lines.push(`Browser: ${browserLabel(browser)} is installed.`);
  } else {
    lines.push(`Browser: ${browserMissing(browser).split('\n')[0]}`);
    for (const other of BROWSERS.filter((name) => name !== browser)) {
      const result = await probe(other);
      if (!result.launches) continue;
      working ??= result;
      const how = other === 'chromium' ? 'remove "browser" from' : `set "browser": "${other}" in`;
      lines.push(`  ${browserLabel(other)} is installed and can be used instead: ${how} specsheet.config.json.`);
    }
    if (!working) lines.push('  No other browser Specsheet can use was found.');
  }
  if (working) {
    lines.push(working.records ? 'Recording: videos can be recorded.' : `Recording: v${RECORDING_MISSING.slice(1)}`);
  }
  return lines;
}
