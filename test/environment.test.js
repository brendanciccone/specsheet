import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from '../src/build/index.js';
import { launchOptions, loadConfig } from '../src/config.js';
import { environmentProblem } from '../src/doctor.js';

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

test('a missing browser or recorder is reported as that, not as failing scenarios', () => {
  const failed = (error) => ({ scenarios: [{ error, steps: [] }, { error, steps: [] }] });
  const noBrowser = "Error: browserType.launch: Executable doesn't exist at /cache/chromium_headless_shell-1254/chrome-headless-shell";
  const noChannel = "Error: browserType.launch: Chromium distribution 'msedge' is not found at /opt/microsoft/msedge/msedge";
  const noRecorder = "Error: browserContext.newPage: Executable doesn't exist at /cache/ffmpeg-1013/ffmpeg-linux";

  assert.match(environmentProblem(failed(noBrowser), { browser: 'chromium' }), /npx playwright install chromium[\s\S]*"browser" to "chrome"/);
  assert.match(environmentProblem(failed(noChannel), { browser: 'msedge' }), /Microsoft Edge is not installed/);
  assert.match(environmentProblem(failed(noRecorder), { browser: 'chrome' }), /npx playwright install ffmpeg[\s\S]*"videos": "none"/);

  // A real failure, or a run where only some scenarios hit the problem, keeps its findings.
  assert.equal(environmentProblem(failed('Error: expect(locator).toBeVisible() failed'), { browser: 'chromium' }), null);
  assert.equal(environmentProblem({ scenarios: [{ error: noBrowser }, { error: null }] }, { browser: 'chromium' }), null);
  assert.equal(environmentProblem({ scenarios: [] }, { browser: 'chromium' }), null);
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
