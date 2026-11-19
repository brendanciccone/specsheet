#!/usr/bin/env node
// Specsheet's command line: check the size of a handoff, run it, and build its files.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build, hasFfmpeg } from '../src/build/index.js';
import { formatSizeCheck, readStaticFlows, sizeCheck } from '../src/check.js';
import { CONFIG_FILE, REQUIREMENTS_FILE, VIDEO_MODES, loadConfig } from '../src/config.js';
import { browserReport, environmentProblem } from '../src/doctor.js';
import { formatBytes, plural, readJson, viewportLabel, writeFile } from '../src/util.js';

const HELP = `Specsheet: turn a ticket and a design into everything engineering needs.

Usage
  specsheet init <folder> [--ticket KEY] [--title "..."]   Create a handoff folder with starter files
  specsheet check <folder> [--screens N]                    Count what the handoff contains and warn if it is very large
  specsheet run <folder> [--fast] [--videos MODE]           Run every scenario, then build the handoff files
  specsheet build <folder> [--videos MODE]                  Rebuild the handoff files from the last run, without running again
  specsheet doctor [folder]                                 Say whether this computer has what a run needs: a browser, recording, ffmpeg
  specsheet install-skill [--project]                       Give Claude the Specsheet skill, for you or for this project only
  specsheet version                                         Print the version

Options
  --fast        Skip the pauses and captions that make the videos watchable. Use while fixing findings.
  --videos MODE flow: one walkthrough video per flow (the default). scenario: one video per scenario.
                none: no videos, and nothing is recorded. Overrides "videos" in specsheet.config.json.
                Switching between flow and scenario only needs "build".
  --screens N   For "check" before any scenario exists: the number of screens in the design.
  --project     For "install-skill": put the skill in this project's .claude folder, not your own.

Exit codes for "run"
  0  every scenario passed     1  at least one step failed     2  the run could not start
`;

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('--')) {
      positional.push(arg);
      continue;
    }
    const [name, inline] = arg.slice(2).split('=');
    if (inline !== undefined) flags[name] = inline;
    else if (argv[index + 1] !== undefined && !argv[index + 1].startsWith('--') && ['ticket', 'title', 'screens', 'videos'].includes(name)) {
      flags[name] = argv[index + 1];
      index += 1;
    } else flags[name] = true;
  }
  return { command: positional[0], target: positional[1], flags };
}

function videoMode(flags) {
  if (flags.videos === undefined) return undefined;
  if (!VIDEO_MODES.includes(flags.videos)) throw new Error(`--videos must be one of ${VIDEO_MODES.join(', ')}.`);
  return flags.videos;
}

const VERSION = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;

const FFMPEG_MISSING =
  'ffmpeg is not installed. It is what joins the scenarios of a flow into one walkthrough video.\n' +
  'Without it you get one video per scenario, and everything else is the same.\n' +
  'To install it: "brew install ffmpeg" on macOS, "sudo apt install ffmpeg" on Debian or Ubuntu,\n' +
  '"winget install ffmpeg" on Windows. If you install it after a run, "specsheet build <folder>" remakes the videos.';

/** A note when one video per flow was asked for and cannot be made. Never stops anything. */
function videoNote(mode) {
  return mode === 'flow' && !hasFfmpeg() ? `\nNote: ${FFMPEG_MISSING}` : '';
}

/** Copy the skill to where Claude Code looks for skills. Replaces an earlier copy of it. */
function installSkill(flags) {
  const source = fileURLToPath(new URL('../skills/specsheet', import.meta.url));
  const base = flags.project ? path.resolve('.claude') : path.join(os.homedir(), '.claude');
  const target = path.join(base, 'skills', 'specsheet');
  const existed = fs.existsSync(target);
  fs.rmSync(target, { recursive: true, force: true });
  fs.cpSync(source, target, { recursive: true });
  console.log(`${existed ? 'Updated' : 'Installed'} the Specsheet skill in ${target}`);
  console.log('Start a new Claude Code session, then ask: "Hand off this design with Specsheet."');
}

function resolveFolder(target) {
  if (!target) throw new Error('Name the handoff folder, for example: specsheet run handoff/HELP-12');
  const dir = path.resolve(target);
  if (!fs.existsSync(path.join(dir, CONFIG_FILE))) {
    throw new Error(`${dir} has no ${CONFIG_FILE}. Create one with "specsheet init ${target}".`);
  }
  return dir;
}

function init(target, flags) {
  if (!target) throw new Error('Name the folder to create, for example: specsheet init handoff/HELP-12');
  const dir = path.resolve(target);
  if (fs.existsSync(path.join(dir, CONFIG_FILE))) {
    throw new Error(`${dir} already has a ${CONFIG_FILE}. Nothing was changed.`);
  }
  const key = typeof flags.ticket === 'string' ? flags.ticket : null;
  writeFile(
    path.join(dir, CONFIG_FILE),
    `${JSON.stringify(
      {
        title: typeof flags.title === 'string' ? flags.title : 'Describe the story here',
        ticket: { key, url: null },
        design: { source: 'claude-code', link: null, rebuilt: false },
        baseURL: 'http://localhost:3000',
        webServer: null,
        viewports: [{ name: 'Desktop', width: 1440, height: 900 }],
        data: 'mock',
        format: 'gherkin',
        videos: 'flow',
      },
      null,
      2,
    )}\n`,
  );
  writeFile(
    path.join(dir, REQUIREMENTS_FILE),
    `${JSON.stringify(
      {
        requirements: [{ id: 'R1', text: 'Describe the first requirement.', source: 'stated' }],
        openQuestions: [],
      },
      null,
      2,
    )}\n`,
  );
  writeFile(
    path.join(dir, 'scenarios', 'example.scenario.js'),
    `import { expect, flow, scenario } from 'specsheet';

flow('Name of the flow', { states: { 'screen-name': ['ready'] } }, () => {
  scenario('Name of the scenario', { covers: ['R1'] }, async ({ page, step }) => {
    await step('Given I am on the page', { screen: 'screen-name', state: 'ready' }, async () => {
      await page.goto('/');
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    });
  });
});
`,
  );
  // Everything a run writes can be made again, and it is large: keep it out of git.
  writeFile(path.join(dir, '.gitignore'), 'out/\n');
  console.log(`Created ${path.relative(process.cwd(), dir) || '.'} with ${CONFIG_FILE}, ${REQUIREMENTS_FILE}, scenarios/example.scenario.js and a .gitignore for out/`);
}

function printFiles(built) {
  const { files, commentFiles, out } = built;
  const limit = loadConfig(path.dirname(out)).commentLimit;
  console.log(`\nFiles in ${path.relative(process.cwd(), out) || '.'}:`);
  for (const file of files.filter((item) => ['page', 'flow', 'checklist', 'feature'].includes(item.kind))) {
    console.log(`  ${file.path} (${formatBytes(file.bytes)})`);
  }
  const screenshots = files.filter((file) => file.kind === 'screenshot');
  const videos = files.filter((file) => file.kind === 'video');
  if (screenshots.length) console.log(`  screens/ ${plural(screenshots.length, 'screenshot')} (${formatBytes(screenshots.reduce((sum, file) => sum + file.bytes, 0))})`);
  if (videos.length) console.log(`  videos/ ${plural(videos.length, 'video')} (${formatBytes(videos.reduce((sum, file) => sum + file.bytes, 0))})`);
  for (const comment of commentFiles) {
    console.log(`  ${comment.path} (${comment.chars.toLocaleString('en-US')} of ${limit.toLocaleString('en-US')} characters for one Jira comment)`);
  }
  console.log('  manifest.json lists every file with its size, for the preview before posting.');
}

async function run(target, flags) {
  const dir = resolveFolder(target);
  const config = loadConfig(dir);
  const videos = videoMode(flags);
  console.log(formatSizeCheck(sizeCheck(dir)) + videoNote(videos ?? config.videos));

  const scenarioCount = readStaticFlows(dir).reduce((sum, flow) => sum + flow.scenarios.length, 0);
  if (scenarioCount === 0) {
    console.error('\nNo scenarios found. Add files ending in .scenario.js to the scenarios folder.');
    process.exit(2);
  }
  console.log(`\nRunning ${plural(scenarioCount, 'scenario')} at ${config.viewports.map(viewportLabel).join(' and ')}...`);

  const require = createRequire(import.meta.url);
  const cli = require.resolve('@playwright/test/cli');
  const playwrightConfig = fileURLToPath(new URL('../src/playwright.config.js', import.meta.url));
  const resultsFile = path.join(dir, 'out', 'results.json');
  fs.rmSync(resultsFile, { force: true });

  const env = { ...process.env, SPECSHEET_DIR: dir };
  if (videos) env.SPECSHEET_VIDEOS = videos;
  if (flags.fast) env.SPECSHEET_PACE = '0';
  spawnSync(process.execPath, [cli, 'test', '-c', playwrightConfig], { stdio: ['ignore', 'inherit', 'inherit'], env });

  if (!fs.existsSync(resultsFile)) {
    console.error('\nThe run did not start. Check that the prototype is running and the address in specsheet.config.json is right.');
    process.exit(2);
  }

  const results = readJson(resultsFile);
  if (results.scenarios.length === 0) {
    console.error('\nNo scenario ran, so no handoff files were built.');
    for (const error of results.errors ?? []) {
      if (error === 'Error: No tests found') continue;
      console.error(`  ${error.replaceAll(`${process.cwd()}${path.sep}`, '').split('\n').join('\n  ')}`);
    }
    process.exit(2);
  }

  const problem = environmentProblem(results, config);
  if (problem) {
    console.error(`\nThe run could not start. ${problem}`);
    process.exit(2);
  }

  const built = await build(dir, { videos, log: (message) => console.log(message) });
  console.log(`\n${built.findings}`);
  printFiles(built);
  if (flags.fast) console.log('\nThis was a fast run. Run again without --fast before handing off, so the videos are watchable.');
  process.exit(built.model.passed ? 0 : 1);
}

async function main() {
  const { command, target, flags } = parseArgs(process.argv.slice(2));
  if (flags.version || command === 'version') {
    console.log(VERSION);
    return;
  }
  if (!command || command === 'help' || flags.help) {
    console.log(HELP);
    return;
  }
  if (command === 'init') return init(target, flags);
  if (command === 'install-skill') return installSkill(flags);
  if (command === 'doctor') {
    const node = process.versions.node;
    console.log(`Specsheet ${VERSION} on Node ${node}.${Number(node.split('.')[0]) < 22 ? ' Specsheet needs Node 22 or later.' : ''}`);
    const browser = target ? loadConfig(resolveFolder(target)).browser : 'chromium';
    for (const line of await browserReport(browser)) console.log(line);
    console.log(hasFfmpeg() ? 'ffmpeg is installed. A flow\'s scenarios can be joined into one walkthrough video.' : FFMPEG_MISSING);
    return;
  }
  if (command === 'check') {
    const dir = resolveFolder(target);
    const screens = flags.screens !== undefined ? Number(flags.screens) : undefined;
    console.log(formatSizeCheck(sizeCheck(dir, { screens })) + videoNote(videoMode(flags) ?? loadConfig(dir).videos));
    return;
  }
  if (command === 'run') return run(target, flags);
  if (command === 'build') {
    const built = await build(resolveFolder(target), { videos: videoMode(flags), log: (message) => console.log(message) });
    console.log(built.findings);
    printFiles(built);
    return;
  }
  throw new Error(`Unknown command "${command}". Run "specsheet help" to see the commands.`);
}

main().catch((error) => {
  console.error(`specsheet: ${error.message}`);
  process.exit(2);
});
