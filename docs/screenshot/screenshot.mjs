// Draws docs/screenshot/screenshot.webp, the picture of a handoff at the top of the README.
//   node docs/screenshot/screenshot.mjs
//
// It runs the example for real, then shows four parts of the handoff page it produced,
// each in a window on paper: the summary and requirements, the user flow, the walkthrough video,
// and a scenario with its steps and screenshots.
//
// The walkthrough video is H.264, which Playwright's own Chromium cannot play, so this
// uses Google Chrome when it is installed.

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from '@playwright/test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const handoff = 'examples/contact-form/handoff/HELP-12';
const page = path.join(root, handoff, 'out', 'handoff.html');
const target = path.join(root, 'docs', 'screenshot', 'screenshot.webp');
// Each window shows the page at this size, in CSS pixels, drawn this wide.
const VIEW = { width: 900, height: 860 };
const SHOWN = 880;
// The moment of the walkthrough to show: scenario 2, with the email error on screen.
const VIDEO_SECOND = 23.5;

// A failed run can leave the page of an earlier run behind, so only a passing run counts.
const run = spawnSync(process.execPath, ['bin/specsheet.mjs', 'run', handoff], { cwd: root, encoding: 'utf8' });
if (run.status !== 0 || !fs.existsSync(page)) {
  throw new Error(`The example did not pass, so the picture was not redrawn.\n${run.stdout ?? ''}${run.stderr ?? ''}`);
}

let browser;
try {
  browser = await chromium.launch({ channel: 'chrome' });
} catch {
  browser = await chromium.launch();
}

async function view(scrollTo, prepare) {
  const tab = await browser.newPage({ viewport: VIEW, deviceScaleFactor: 2 });
  await tab.goto(pathToFileURL(page).href);
  await tab.waitForLoadState('networkidle');
  if (scrollTo) {
    await tab.evaluate((selector) => {
      const element = document.querySelector(selector);
      window.scrollTo(0, element.getBoundingClientRect().top + window.scrollY - 24);
    }, scrollTo);
  }
  if (prepare) await prepare(tab);
  await tab.waitForTimeout(300);
  const png = await tab.screenshot();
  await tab.close();
  return `data:image/png;base64,${png.toString('base64')}`;
}

// Show one moment of the walkthrough video in its player.
async function showVideoFrame(tab) {
  const shown = await tab.evaluate(async (second) => {
    // The flow's walkthrough, not a video of one scenario.
    const video = document.getElementById('flow-0-video-0');
    if (!video) return 'missing';
    if (video.hidden || video.error) return false;
    video.currentTime = second;
    await new Promise((resolve) => {
      video.addEventListener('seeked', resolve, { once: true });
      setTimeout(resolve, 5000);
    });
    video.pause();
    return !video.hidden && !video.error && video.readyState >= 2;
  }, VIDEO_SECOND);
  if (shown === 'missing') {
    throw new Error('The example has no walkthrough video. Install ffmpeg, which joins the scenarios into one video, and run this again.');
  }
  if (!shown) {
    throw new Error('The walkthrough video could not play. Install Google Chrome, which can play H.264 video, and run this again.');
  }
}

const panels = [
  [await view(null), 'handoff.html · Summary'],
  [await view('section[data-block="flow"]'), 'handoff.html · User flow'],
  [await view('section[data-block="flow-0"]', showVideoFrame), 'handoff.html · Walkthrough video'],
  [await view('article[data-block="flow-0-scenario-1"]'), 'handoff.html · Scenarios'],
];

const height = Math.round((VIEW.height * SHOWN) / VIEW.width);
const frame = ([image, title]) =>
  `<div class="window"><div class="bar"><span></span><span></span><span></span><b>${title}</b></div>` +
  `<img src="${image}" width="${SHOWN}" height="${height}" alt=""></div>`;
const side = 2 * SHOWN + 200;
const composition = await browser.newPage({ viewport: { width: side, height: 2 * (height + 36) + 200 } });
await composition.setContent(`<body><style>
  body { margin: 0; height: 100vh; background: #F6F4EE;
    display: grid; grid-template-columns: repeat(2, ${SHOWN}px); gap: 40px; place-content: center;
    font: 600 14px system-ui, -apple-system, sans-serif; }
  /* Paper, the logo's light colour, with a soft shadow under each window. */
  .window { border-radius: 12px; overflow: hidden; background: #fff;
    box-shadow: 0 6px 20px rgba(21, 20, 27, 0.06), 0 0 0 1px rgba(21, 20, 27, 0.08); }
  .bar { position: relative; height: 36px; display: flex; align-items: center; gap: 8px; padding: 0 14px; background: #ECEAE3; }
  .bar span { width: 12px; height: 12px; border-radius: 50%; background: #C9C6BD; }
  .bar b { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; color: #5F5E6E; font-weight: 600; }
  img { display: block; }
</style>${panels.map(frame).join('')}</body>`);
const png = await composition.screenshot();

// Encode as WebP in the browser, which keeps ffmpeg out of it.
const encoder = await browser.newPage();
const webp = await encoder.evaluate(async (source) => {
  const image = new Image();
  image.src = source;
  await image.decode();
  const canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  canvas.getContext('2d').drawImage(image, 0, 0);
  return canvas.toDataURL('image/webp', 0.86);
}, `data:image/png;base64,${png.toString('base64')}`);
await browser.close();
if (!webp.startsWith('data:image/webp')) throw new Error('This browser cannot encode WebP.');

fs.writeFileSync(target, Buffer.from(webp.split(',')[1], 'base64'));
console.log(`written ${path.relative(root, target)}`);
