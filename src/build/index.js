// Builds every handoff file from one results file.

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { launchOptions, loadConfig, loadRequirements } from '../config.js';
import { readStaticFlows } from '../check.js';
import { fingerprint, readJson, slug, writeFile } from '../util.js';
import { featureText } from './gherkin.js';
import { FIT_LABELS, renderFlowSvg } from './graph.js';
import { checklistMarkdown, commentSections, splitComment } from './markdown.js';
import { buildModel, formatFindings } from './model.js';
import { renderPage } from './page.js';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Whether ffmpeg can be run. It is what joins a flow's scenarios into one video. */
export function hasFfmpeg() {
  return spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status === 0;
}

/**
 * The moments a full-page screenshot was taken, in seconds from the start of a scenario's
 * recording, with a margin either side. The page is still at those moments, so cutting
 * them is not noticed, and it removes the squashed frame a screenshot can leave behind.
 */
export function shotCuts(steps) {
  const cuts = [];
  for (const step of steps ?? []) {
    if (!Array.isArray(step.shotAt) || step.shotAt.length !== 2 || !step.shotAt.every(Number.isFinite)) continue;
    // The recording can start a moment after the page is made, which puts everything a
    // little earlier in the video than on the clock. So the cut starts well before.
    const from = Math.max(0, step.shotAt[0] / 1000 - 0.6);
    const to = step.shotAt[1] / 1000 + 0.45;
    const last = cuts[cuts.length - 1];
    if (last && from <= last[1]) last[1] = Math.max(last[1], to);
    else cuts.push([from, to]);
  }
  // A paced recording opens on an empty white page for a frame or two, before the
  // scenario's title card is up. Take that off the front as well.
  if (cuts.length) {
    if (cuts[0][0] <= 0.12) cuts[0][0] = 0;
    else cuts.unshift([0, 0.12]);
  }
  return cuts.map(([from, to]) => [Number(from.toFixed(2)), Number(to.toFixed(2))]);
}

/** The ffmpeg filter that leaves the cuts out of a video and closes the gaps. Empty when there are none. */
export function cutFilter(cuts) {
  if (!cuts.length) return '';
  return `select='not(${cuts.map(([from, to]) => `between(t,${from},${to})`).join('+')})',setpts=N/FRAME_RATE/TB,`;
}

/** Copy a recording into the output folder, as MP4 when ffmpeg is available. */
function exportVideo(source, target, useFfmpeg, cuts = []) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  if (useFfmpeg) {
    const mp4 = `${target}.mp4`;
    const keep = cutFilter(cuts);
    const result = spawnSync(
      'ffmpeg',
      ['-y', '-loglevel', 'error', '-i', source, '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
        '-vf', `${keep}pad=ceil(iw/2)*2:ceil(ih/2)*2`, '-movflags', '+faststart', '-an', mp4],
      { stdio: 'ignore' },
    );
    if (result.status === 0 && fs.existsSync(mp4)) return mp4;
  }
  const webm = `${target}.webm`;
  fs.copyFileSync(source, webm);
  return webm;
}

/** The length of a video in seconds, or null when it cannot be read. */
function videoSeconds(file) {
  const probe = spawnSync(
    'ffprobe',
    ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', file],
    { encoding: 'utf8' },
  );
  const seconds = probe.status === 0 ? Number(probe.stdout.trim()) : NaN;
  if (Number.isFinite(seconds) && seconds > 0) return seconds;
  // No ffprobe: read the length from what ffmpeg prints about the file.
  const info = spawnSync('ffmpeg', ['-hide_banner', '-i', file], { encoding: 'utf8' });
  const match = /Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/.exec(info.stderr ?? '');
  return match ? Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]) : null;
}

/**
 * Join recordings into one MP4, in order. Returns the file, its length, and the second
 * at which each recording starts, or null when it could not be done.
 */
function joinVideos(sources, target, workDir, cuts = []) {
  fs.rmSync(workDir, { recursive: true, force: true });
  fs.mkdirSync(workDir, { recursive: true });
  try {
    const parts = [];
    const starts = [];
    let seconds = 0;
    for (const [index, source] of sources.entries()) {
      const part = exportVideo(source, path.join(workDir, `part-${index}`), true, cuts[index]);
      const length = part.endsWith('.mp4') ? videoSeconds(part) : null;
      if (length === null) return null;
      parts.push(part);
      starts.push(seconds);
      seconds += length;
    }
    const file = `${target}.mp4`;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    if (parts.length === 1) {
      fs.copyFileSync(parts[0], file);
      return { file, seconds, starts };
    }
    const list = path.join(workDir, 'list.txt');
    fs.writeFileSync(list, parts.map((part) => `file '${part.replaceAll("'", "'\\''")}'`).join('\n'));
    // Every part was made with the same settings, so they can be joined without re-encoding.
    const result = spawnSync(
      'ffmpeg',
      ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', '-movflags', '+faststart', file],
      { stdio: 'ignore' },
    );
    return result.status === 0 && fs.existsSync(file) ? { file, seconds, starts } : null;
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
}

/**
 * Hands out file names made from flow and scenario names, each one once. Different names
 * can make the same slug ("Sign in" and "Sign-in"), and the second file would then
 * replace the first. So a name that is taken gets a fingerprint of what it is for, and a
 * number if even that is taken. Names are compared ignoring case, because macOS and
 * Windows treat "οδος" and "οδοσ" as one file. The build hands them out in the same order
 * every time, so a rebuild gives the same names.
 */
function fileNames() {
  const taken = new Set();
  const key = (name) => name.normalize('NFKC').toUpperCase().toLowerCase();
  return (name, owner) => {
    let unique = name;
    if (taken.has(key(unique))) unique = `${name}-${fingerprint(owner)}`;
    for (let number = 2; taken.has(key(unique)); number += 1) unique = `${name}-${fingerprint(owner)}-${number}`;
    taken.add(key(unique));
    return unique;
  };
}

async function renderPng(svg, file, width, browserName) {
  const { chromium } = await import('@playwright/test');
  const browser = await chromium.launch(launchOptions(browserName));
  try {
    const page = await browser.newPage({ viewport: { width: Math.ceil(width), height: 600 }, deviceScaleFactor: 2 });
    await page.setContent(`<body style="margin:0;background:#fff">${svg}</body>`);
    // Fit each label's box to its words as this browser draws them.
    await page.evaluate(`${FIT_LABELS}(document)`);
    await page.locator('svg').screenshot({ path: file });
  } finally {
    await browser.close();
  }
}

function iconMarkup() {
  try {
    return fs
      .readFileSync(path.join(packageRoot, 'assets', 'mark.svg'), 'utf8')
      .replace(/<\?xml[^>]*\?>/, '')
      .replace('<svg ', '<svg aria-hidden="true" ')
      .trim();
  } catch {
    return '';
  }
}

export async function build(dir, { png = true, videos, log = () => {} } = {}) {
  const out = path.join(dir, 'out');
  const resultsFile = path.join(out, 'results.json');
  if (!fs.existsSync(resultsFile)) {
    throw new Error(`No results found in ${out}. Run "specsheet run" first.`);
  }

  const config = loadConfig(dir);
  const { requirements, openQuestions, assumed } = loadRequirements(dir);
  const results = readJson(resultsFile);
  for (const scenario of results.scenarios ?? []) {
    if (scenario.video) scenario.video = path.resolve(out, scenario.video);
    for (const step of scenario.steps ?? []) {
      if (step.screenshot) step.screenshot = path.resolve(out, step.screenshot);
    }
  }
  const model = buildModel({ results, config, requirements, openQuestions, assumed, staticFlows: readStaticFlows(dir) });

  for (const folder of ['screens', 'videos', 'features']) {
    fs.rmSync(path.join(out, folder), { recursive: true, force: true });
  }
  for (const name of fs.readdirSync(out)) {
    if (/^comment(-\d+)?\.md$/.test(name)) fs.rmSync(path.join(out, name));
  }

  const files = [];
  const add = (file, description, kind) => {
    files.push({ path: path.relative(out, file).split(path.sep).join('/'), bytes: fs.statSync(file).size, description, kind });
  };

  // Screenshots: one file per screen, state and screen size.
  const canonical = new Map();
  let number = 0;
  for (const flow of model.flows) {
    for (const screen of flow.screens) {
      for (const state of screen.states) {
        for (const viewport of config.viewports) {
          const shots = state.shots.filter((shot) => shot.viewport?.name === viewport.name);
          const best = shots.find((shot) => shot.verified) ?? shots[0];
          if (!best || !fs.existsSync(best.file)) continue;
          number += 1;
          const name = `${String(number).padStart(2, '0')}-${slug(screen.name)}--${slug(state.name)}.${slug(viewport.name)}.png`;
          const target = path.join(out, 'screens', name);
          fs.mkdirSync(path.dirname(target), { recursive: true });
          fs.copyFileSync(best.file, target);
          canonical.set(`${viewport.name}::${screen.name}/${state.name}`, `screens/${name}`);
          if (viewport.name === config.viewports[0].name) state.outFile = `screens/${name}`;
          add(target, `${screen.name}, ${state.name} (${viewport.name}, ${viewport.width} × ${viewport.height})`, 'screenshot');
        }
      }
    }
  }

  // Point every step's screenshot at its file, and keep the screenshots of failed steps.
  const failedName = fileNames();
  for (const flow of model.flows) {
    for (const scenario of flow.scenarios) {
      for (const step of scenario.steps) {
        if (!step.shot) continue;
        const key = `${scenario.viewport.name}::${step.shot.screen}/${step.shot.state}`;
        if (step.shot.failed) {
          const name = `${failedName(
            `failed-${slug(scenario.title)}-step-${step.index + 1}.${slug(scenario.viewport.name)}`,
            [flow.name, scenario.title, step.index, scenario.viewport.name].join('\n'),
          )}.png`;
          const target = path.join(out, 'screens', name);
          fs.mkdirSync(path.dirname(target), { recursive: true });
          fs.copyFileSync(step.shot.file, target);
          step.shot.outFile = `screens/${name}`;
          add(target, `What was on screen when "${step.title}" failed`, 'screenshot');
        } else {
          step.shot.outFile = canonical.get(key) ?? null;
        }
      }
    }
  }

  // Videos. One walkthrough per flow and screen size, with the scenarios back to back,
  // or one per scenario. Either way they are made from the recordings of the last run,
  // so changing the choice only needs a rebuild.
  const videoMode = videos ?? config.videos;
  model.meta.videos = videoMode;
  if (videoMode !== 'none') {
    const videoName = fileNames();
    const useFfmpeg = hasFfmpeg();
    const scenarios = model.flows.flatMap((flow) => flow.scenarios);
    if (scenarios.length && !scenarios.some((scenario) => scenario.video && fs.existsSync(scenario.video))) {
      log('The last run recorded no video, so there are no videos. Run again with videos on to record them.');
    }
    if (!useFfmpeg && scenarios.some((scenario) => shotCuts(scenario.steps).length)) {
      log('ffmpeg is not installed, so the moment each screenshot is taken could not be cut from the videos. The picture can jump there.');
    }
    if (videoMode === 'flow' && !useFfmpeg) {
      log('ffmpeg is not installed, so the scenarios could not be joined into one video per flow. Wrote one video per scenario.');
    }
    for (const flow of model.flows) {
      flow.videos = [];
      for (const viewport of config.viewports) {
        const recorded = flow.scenarios.filter(
          (scenario) => scenario.viewport?.name === viewport.name && scenario.video && fs.existsSync(scenario.video),
        );
        if (!recorded.length) continue;

        if (videoMode === 'flow' && useFfmpeg) {
          const base = path.join(
            out,
            'videos',
            videoName(`${slug(flow.name)}.${slug(viewport.name)}`, [flow.name, viewport.name].join('\n')),
          );
          const joined = joinVideos(
            recorded.map((scenario) => scenario.video),
            base,
            path.join(out, '.run', 'join'),
            recorded.map((scenario) => shotCuts(scenario.steps)),
          );
          if (joined) {
            const file = path.relative(out, joined.file).split(path.sep).join('/');
            const video = { file, path: joined.file, viewport, viewportLabel: recorded[0].viewportLabel, seconds: joined.seconds };
            flow.videos.push(video);
            recorded.forEach((scenario, index) => {
              scenario.chapter = { file, index: flow.videos.length - 1, start: joined.starts[index] };
            });
            add(joined.file, `Walkthrough video of the "${flow.name}" flow, every scenario in order (${video.viewportLabel})`, 'video');
            continue;
          }
          log(`Could not join the videos of "${flow.name}". Wrote one video per scenario.`);
        }

        for (const scenario of recorded) {
          const base = path.join(
            out,
            'videos',
            videoName(
              `${slug(flow.name)}--${slug(scenario.title)}.${slug(viewport.name)}`,
              [flow.name, scenario.title, viewport.name].join('\n'),
            ),
          );
          const file = exportVideo(scenario.video, base, useFfmpeg, shotCuts(scenario.steps));
          scenario.videoFile = path.relative(out, file).split(path.sep).join('/');
          scenario.videoPath = file;
          add(file, `Video of "${scenario.title}" (${scenario.viewportLabel})`, 'video');
        }
      }
    }
  }

  // Feature files and checklist.
  const featureName = fileNames();
  for (const flow of model.flows) {
    const file = path.join(out, 'features', `${featureName(slug(flow.name), flow.name)}.feature`);
    writeFile(file, featureText(flow, { title: model.meta.title, ticketKey: model.meta.ticket?.key }));
    add(file, `Gherkin for the "${flow.name}" flow, for QA to import`, 'feature');
  }
  const checklistFile = path.join(out, 'checklist.md');
  writeFile(checklistFile, checklistMarkdown(model));
  add(checklistFile, 'Acceptance checklist', 'checklist');

  // User flow.
  let flowImage = null;
  let flowSvg = null;
  if (model.flows.length) {
    const svg = renderFlowSvg(model);
    flowSvg = svg;
    const svgFile = path.join(out, 'flow.svg');
    writeFile(svgFile, svg);
    if (png) {
      const pngFile = path.join(out, 'flow.png');
      const width = Number(/width="(\d+(?:\.\d+)?)"/.exec(svg)?.[1] ?? 1200);
      try {
        await renderPng(svg, pngFile, width, config.browser);
        add(pngFile, 'User flow', 'flow');
        flowImage = `data:image/png;base64,${fs.readFileSync(pngFile).toString('base64')}`;
      } catch (error) {
        log(`Could not render flow.png (${error.message}). flow.svg was written.`);
      }
    }
    if (!flowImage) {
      add(svgFile, 'User flow', 'flow');
      flowImage = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
    }
  }

  // The page. It lists the other files, so it is written last and added to the list first.
  const pageFile = path.join(out, 'handoff.html');
  writeFile(pageFile, renderPage(model, { flowImage, flowSvg, files, icon: iconMarkup() }));
  files.unshift({
    path: 'handoff.html',
    bytes: fs.statSync(pageFile).size,
    description: 'The full handoff, with a screenshot beside each step',
    kind: 'page',
  });

  // The Jira comment, split when it would not fit in one.
  const attachments = files.filter((file) => file.kind !== 'checklist');
  const comments = splitComment(commentSections(model, attachments), config.commentLimit);
  const commentFiles = comments.map((text, index) => {
    const name = index === 0 ? 'comment.md' : `comment-${index + 1}.md`;
    writeFile(path.join(out, name), `${text}\n`);
    return { path: name, chars: text.length };
  });

  const findings = formatFindings(model);
  writeFile(path.join(out, 'findings.txt'), `${findings}\n`);
  writeFile(
    path.join(out, 'manifest.json'),
    `${JSON.stringify(
      {
        title: model.meta.title,
        ticket: model.meta.ticket,
        passed: model.passed,
        counts: model.counts,
        comment: commentFiles,
        commentLimit: config.commentLimit,
        attachments,
        totalBytes: attachments.reduce((sum, file) => sum + file.bytes, 0),
      },
      null,
      2,
    )}\n`,
  );

  return { model, files, commentFiles, findings, out };
}
