import path from 'node:path';
import { readJson } from './util.js';

export const CONFIG_FILE = 'specsheet.config.json';
export const REQUIREMENTS_FILE = 'requirements.json';

/** Jira Cloud's fixed limit for one comment or description. */
export const JIRA_COMMENT_LIMIT = 32767;

export const VIDEO_MODES = ['flow', 'scenario', 'none'];

/** chromium is the browser Playwright downloads. chrome and msedge are ones already on the computer. */
export const BROWSERS = ['chromium', 'chrome', 'msedge'];

export const DEFAULTS = {
  title: '',
  ticket: null, // { key, url }
  design: null, // { source, link, rebuilt }
  baseURL: 'http://localhost:3000',
  webServer: null, // { command, url, cwd }
  viewports: [{ name: 'Desktop', width: 1440, height: 900 }],
  data: 'mock', // 'mock' | 'real'
  format: 'gherkin', // 'gherkin' | 'checklist'
  warnAt: 20,
  commentLimit: JIRA_COMMENT_LIMIT,
  videos: 'flow', // 'flow' (one walkthrough per flow) | 'scenario' (one per scenario) | 'none' (nothing is recorded)
  browser: 'chromium', // 'chromium' (Playwright's own download) | 'chrome' | 'msedge' (already installed)
  pace: 700, // shortest pause after each step, in milliseconds. Captions stay longer when they need it
  timeout: 30000,
  expectTimeout: 5000,
};

const SOURCES = {
  'claude-code': 'Claude Code',
  'claude-design': 'Claude Design',
  paper: 'Paper',
  figma: 'Figma',
};

export function sourceLabel(source) {
  return SOURCES[source] ?? source ?? 'Not stated';
}

/** How Playwright starts the chosen browser: its own Chromium, or an installed Chrome or Edge. */
export function launchOptions(browser) {
  return browser && browser !== 'chromium' ? { channel: browser } : {};
}

export function loadConfig(dir) {
  const raw = readJson(path.join(dir, CONFIG_FILE));
  const config = { ...DEFAULTS, ...raw };

  if (!Array.isArray(config.viewports) || config.viewports.length === 0) {
    throw new Error(`${CONFIG_FILE}: "viewports" needs at least one screen size.`);
  }
  for (const viewport of config.viewports) {
    if (!viewport.name || !Number.isInteger(viewport.width) || !Number.isInteger(viewport.height)) {
      throw new Error(`${CONFIG_FILE}: each viewport needs a name, a width and a height.`);
    }
  }
  if (!['mock', 'real'].includes(config.data)) {
    throw new Error(`${CONFIG_FILE}: "data" must be "mock" or "real".`);
  }
  if (!['gherkin', 'checklist'].includes(config.format)) {
    throw new Error(`${CONFIG_FILE}: "format" must be "gherkin" or "checklist".`);
  }
  if (!VIDEO_MODES.includes(config.videos)) {
    throw new Error(`${CONFIG_FILE}: "videos" must be one of ${VIDEO_MODES.join(', ')}.`);
  }
  if (!BROWSERS.includes(config.browser)) {
    throw new Error(`${CONFIG_FILE}: "browser" must be one of ${BROWSERS.join(', ')}.`);
  }
  return config;
}

/**
 * requirements.json:
 * { "requirements": [{ "id": "R1", "text": "...", "source": "stated" | "inferred" }],
 *   "openQuestions": ["..."] }
 */
export function loadRequirements(dir) {
  const raw = readJson(path.join(dir, REQUIREMENTS_FILE), { requirements: [], openQuestions: [] });
  const requirements = (raw.requirements ?? []).map((item, index) => {
    if (!item.id || !item.text) {
      throw new Error(`${REQUIREMENTS_FILE}: requirement ${index + 1} needs an "id" and a "text".`);
    }
    const source = item.source ?? 'stated';
    if (!['stated', 'inferred'].includes(source)) {
      throw new Error(`${REQUIREMENTS_FILE}: ${item.id} has source "${source}". Use "stated" or "inferred".`);
    }
    return { id: String(item.id), text: String(item.text), source };
  });
  return { requirements, openQuestions: (raw.openQuestions ?? []).map(String) };
}
