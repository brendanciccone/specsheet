import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from '../src/build/index.js';
import { launchOptions, loadConfig } from '../src/config.js';
import { browserLabel, browserReport, environmentProblem, probe } from '../src/doctor.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const cli = path.join(root, 'bin', 'specsheet.mjs');
const temp = (name) => fs.mkdtempSync(path.join(os.tmpdir(), `specsheet-${name}-`));
const writeConfig = (dir, value) => fs.writeFileSync(path.join(dir, 'specsheet.config.json'), JSON.stringify(value));

test('the browser setting accepts chromium, chrome and msedge only', () => {
  const dir = temp('browser');
  try {
    writeConfig(dir, {});
    assert.equal(loadConfig(dir).browser, 'chromium');
    assert.deepEqual(launchOptions('chromium'), {});
    writeConfig(dir, { browser: 'chrome' });
    assert.deepEqual(launchOptions(loadConfig(dir).browser), { channel: 'chrome' });
    writeConfig(dir, { browser: 'firefox' });
    assert.throws(() => loadConfig(dir), /"browser" must be one of chromium, chrome, msedge/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a run records nothing when videos are off, and uses the chosen browser', async () => {
  const dir = temp('playwright');
  const load = async (config, env = {}) => {
    writeConfig(dir, config);
    const before = { ...process.env };
    Object.assign(process.env, { SPECSHEET_DIR: dir }, env);
    try {
      // A new address each time, so the settings are read again.
      const url = `${pathToFileURL(path.join(root, 'src', 'playwright.config.js')).href}?${Math.random()}`;
      return (await import(url)).default;
    } finally {
      for (const key of Object.keys(process.env)) if (!(key in before)) delete process.env[key];
      Object.assign(process.env, before);
    }
  };
  try {
    const recorded = await load({});
    assert.equal(recorded.projects[0].use.video.mode, 'on');
    assert.equal(recorded.use.channel, undefined);

    const off = await load({ videos: 'none', browser: 'chrome' });
    assert.equal(off.projects[0].use.video, 'off');
    assert.equal(off.use.channel, 'chrome');

    // "specsheet run --videos none" turns recording off for one run.
    const flag = await load({ videos: 'flow' }, { SPECSHEET_VIDEOS: 'none' });
    assert.equal(flag.projects[0].use.video, 'off');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

const NO_BROWSER = "Error: browserType.launch: Executable doesn't exist at /cache/chromium_headless_shell-1254/chrome-headless-shell";
const NO_CHANNEL = "Error: browserType.launch: Chromium distribution 'msedge' is not found at /opt/microsoft/msedge/msedge";
const NO_RECORDER = "Error: browserContext.newPage: Executable doesn't exist at /cache/ffmpeg-1013/ffmpeg-linux";
const NO_LIBRARIES =
  'Error: browserType.launch: \n╔══════════════════════════════════════════════════════╗\n║ Host system is missing dependencies to run browsers. ║\n╚══════════════════════════════════════════════════════╝';

test('a missing browser or recorder is reported as that, not as failing scenarios', () => {
  const failed = (...errors) => ({ scenarios: errors.map((error) => ({ error, steps: [] })) });

  assert.match(environmentProblem(failed(NO_BROWSER, NO_BROWSER), { browser: 'chromium' }), /npx playwright install chromium[\s\S]*"browser" to "chrome"/);
  assert.match(environmentProblem(failed(NO_CHANNEL), { browser: 'msedge' }), /Microsoft Edge is not installed/);
  assert.match(environmentProblem(failed(NO_RECORDER, NO_RECORDER), { browser: 'chrome' }), /npx playwright install ffmpeg[\s\S]*"videos": "none"/);

  // The recorder's error also says "Executable doesn't exist". It is not a browser problem.
  assert.doesNotMatch(environmentProblem(failed(NO_RECORDER), { browser: 'chrome' }), /is not installed\. Install it with "npx playwright install chromium"/);
  // Some scenarios stopped by one and some by the other: both are reported.
  const both = environmentProblem(failed(NO_RECORDER, NO_BROWSER), { browser: 'chromium' });
  assert.match(both, /npx playwright install chromium/);
  assert.match(both, /npx playwright install ffmpeg/);

  // A real failure, or a run where only some scenarios hit the problem, keeps its findings.
  assert.equal(environmentProblem(failed('Error: expect(locator).toBeVisible() failed'), { browser: 'chromium' }), null);
  assert.equal(environmentProblem(failed(NO_BROWSER, null), { browser: 'chromium' }), null);
  assert.equal(environmentProblem({ scenarios: [{ error: NO_BROWSER, steps: [{ title: 'Given I ran' }] }] }, { browser: 'chromium' }), null);
  assert.equal(environmentProblem({ scenarios: [] }, { browser: 'chromium' }), null);
});

test('a browser that is installed but cannot start is not called missing', () => {
  const failed = { scenarios: [{ error: NO_LIBRARIES, steps: [] }] };
  const message = environmentProblem(failed, { browser: 'chromium' });
  assert.match(message, /Playwright's Chromium is installed but could not start: Host system is missing dependencies/);
  assert.match(message, /npx playwright install-deps chromium/);
  assert.doesNotMatch(message, /is not installed/);

  const other = environmentProblem({ scenarios: [{ error: 'Error: browserType.launch: Target page, context or browser has been closed', steps: [] }] }, { browser: 'chrome' });
  assert.match(other, /Google Chrome is installed but could not start: Target page, context or browser has been closed/);
  assert.doesNotMatch(other, /install-deps/);
});

test('a browser name is only ever shown as text', () => {
  assert.equal(browserLabel('chrome'), 'Google Chrome');
  assert.equal(browserLabel('toString'), 'toString');
  assert.equal(browserLabel('firefox'), 'firefox');
});

test('the browser check reports what it found, and always closes the browser', async () => {
  // A browser that starts, with a recorder that works or does not.
  const browser = (recorder) => {
    const state = { closed: false };
    return {
      state,
      newContext: async () => {
        if (!recorder) throw new Error(NO_RECORDER);
        return { newPage: async () => {}, close: async () => {} };
      },
      close: async () => {
        state.closed = true;
      },
    };
  };

  const missing = await probe('chromium', { launch: async () => { throw new Error(NO_BROWSER); } });
  assert.deepEqual({ launches: missing.launches, records: missing.records }, { launches: false, records: false });
  assert.match(missing.error, /Executable doesn't exist/);

  const works = browser(true);
  assert.deepEqual(await probe('chrome', { launch: async (options) => (assert.deepEqual(options, { channel: 'chrome' }), works) }), { launches: true, records: true, error: null });
  assert.ok(works.state.closed);

  const silent = browser(false);
  assert.deepEqual(await probe('chromium', { launch: async () => silent }), { launches: true, records: false, error: null });
  assert.ok(silent.state.closed, 'the browser is closed after a failed recording too');

  const unasked = browser(false);
  assert.equal((await probe('chromium', { recording: false, launch: async () => unasked })).records, null);
});

test('doctor says what to do for each way the browser can be missing', async () => {
  const found = (table) => async (name) => table[name] ?? { launches: false, records: false, error: NO_BROWSER };
  const fine = { launches: true, records: true, error: null };

  const ready = await browserReport('chromium', { check: found({ chromium: fine }) });
  assert.deepEqual(ready, { lines: ["Browser: Playwright's Chromium starts.", 'Recording: videos can be recorded.'], ready: true });

  // The download is blocked, and Chrome is on the computer without Playwright's recorder.
  const blocked = await browserReport('chromium', { check: found({ chrome: { launches: true, records: false, error: null } }) });
  assert.equal(blocked.ready, false);
  assert.match(blocked.lines[0], /Playwright's Chromium is not installed\. Install it with "npx playwright install chromium"/);
  assert.match(blocked.lines[1], /Google Chrome starts and can be used instead: set "browser": "chrome"/);
  assert.match(blocked.lines[2], /^Recording: videos cannot be recorded/);

  // Chrome is chosen, with no recorder: fine when no videos are wanted, not otherwise.
  const chrome = { chrome: { launches: true, records: false, error: null } };
  assert.equal((await browserReport('chrome', { check: found(chrome) })).ready, false);
  const quiet = await browserReport('chrome', { videos: false, check: found(chrome) });
  assert.equal(quiet.ready, true);
  assert.match(quiet.lines[1], /not needed: specsheet.config.json sets "videos": "none"/);

  // The chosen browser is not there and nothing else is: the report still says what to do.
  const nothing = await browserReport('msedge', { check: async () => ({ launches: false, records: false, error: NO_CHANNEL }) });
  assert.equal(nothing.ready, false);
  assert.match(nothing.lines.join('\n'), /Microsoft Edge is not installed[\s\S]*No other browser[\s\S]*Install Microsoft Edge, or run "npx playwright install chromium" and remove "browser"/);

  // Installed, but it cannot start: the reason is shown, and reinstalling is not suggested.
  const broken = await browserReport('chromium', { check: async () => ({ launches: false, records: false, error: NO_LIBRARIES }) });
  assert.match(broken.lines[0], /installed but could not start: Host system is missing dependencies/);
  assert.match(broken.lines[1], /npx playwright install-deps chromium/);
  assert.doesNotMatch(broken.lines.join('\n'), /npx playwright install chromium"/);
});

test('the command line prints its version, and init keeps run output out of git', () => {
  const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
  // "version" is the form to use through npx, which keeps --version for itself.
  for (const form of ['version', '--version']) {
    assert.equal(spawnSync(process.execPath, [cli, form], { encoding: 'utf8' }).stdout.trim(), version);
  }

  const dir = temp('init');
  try {
    const made = spawnSync(process.execPath, [cli, 'init', path.join(dir, 'handoff', 'HELP-1')], { encoding: 'utf8' });
    assert.equal(made.status, 0, made.stderr);
    assert.equal(fs.readFileSync(path.join(dir, 'handoff', 'HELP-1', '.gitignore'), 'utf8'), 'out/\n');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('doctor exits with 1 when the browser is not there', () => {
  // An empty folder for Playwright's downloads: its Chromium is absent whatever this computer has.
  const empty = temp('nobrowsers');
  try {
    const result = spawnSync(process.execPath, [cli, 'doctor'], { encoding: 'utf8', env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: empty } });
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stdout, /Browser: Playwright's Chromium is not installed/);
  } finally {
    fs.rmSync(empty, { recursive: true, force: true });
  }
});

test('a build says so when videos are wanted and the last run recorded none', async () => {
  const dir = temp('norecording');
  try {
    const viewport = { name: 'Desktop', width: 1440, height: 900 };
    writeConfig(dir, { title: 'No recording', viewports: [viewport], videos: 'flow' });
    const scenario = {
      title: 'Page loads', flow: 'Home', declaredStates: {}, notApplicable: {}, covers: [], viewport,
      status: 'passed', durationMs: 10, error: null, video: null,
      steps: [{ index: 0, title: 'Given I am on the page', screen: 'home', state: 'ready', status: 'passed', checks: 1, error: null, screenshot: null }],
    };
    fs.mkdirSync(path.join(dir, 'out'));
    fs.writeFileSync(path.join(dir, 'out', 'results.json'), JSON.stringify({ finishedAt: '2026-11-19T12:00:00.000Z', errors: [], scenarios: [scenario] }));
    const said = [];
    await build(dir, { png: false, log: (message) => said.push(message) });
    assert.ok(said.some((message) => /recorded no video/.test(message)), said.join('\n'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
