// Draws docs/screenshot/screenshot.webp, the picture of a handoff at the top of the README.
//   node docs/screenshot/screenshot.mjs
//
// It runs the example for real, then shows two parts of the handoff page it produced,
// each in a window: the top of the page, and the user flow.

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from '@playwright/test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const handoff = 'examples/contact-form/handoff/HELP-12';
const page = path.join(root, handoff, 'out', 'handoff.html');
const target = path.join(root, 'docs', 'screenshot', 'screenshot.webp');
const INK = '#15141B';
const GREEN = '#1F9F78';
// Each window shows the page at this size, in CSS pixels.
const VIEW = { width: 900, height: 980 };
const SHOWN = 880;

// A failed run can leave the page of an earlier run behind, so only a passing run counts.
const run = spawnSync(process.execPath, ['bin/specsheet.mjs', 'run', handoff], { cwd: root, encoding: 'utf8' });
if (run.status !== 0 || !fs.existsSync(page)) {
  throw new Error(`The example did not pass, so the picture was not redrawn.\n${run.stdout ?? ''}${run.stderr ?? ''}`);
}

const browser = await chromium.launch();

async function view(scrollTo) {
  const tab = await browser.newPage({ viewport: VIEW, deviceScaleFactor: 2 });
  await tab.goto(pathToFileURL(page).href);
  await tab.waitForLoadState('networkidle');
  if (scrollTo) {
    await tab.evaluate((selector) => {
      const element = document.querySelector(selector);
      window.scrollTo(0, element.getBoundingClientRect().top + window.scrollY - 24);
    }, scrollTo);
  }
  await tab.waitForTimeout(300);
  const png = await tab.screenshot();
  await tab.close();
  return `data:image/png;base64,${png.toString('base64')}`;
}

const top = await view(null);
const flow = await view('section[data-block="flow"]');

const height = Math.round((VIEW.height * SHOWN) / VIEW.width);
const window = (image, title) =>
  `<div class="window"><div class="bar"><span></span><span></span><span></span><b>${title}</b></div>` +
  `<img src="${image}" width="${SHOWN}" height="${height}" alt=""></div>`;
const composition = await browser.newPage({ viewport: { width: 2 * SHOWN + 200, height: height + 196 } });
await composition.setContent(`<body><style>
  body { margin: 0; height: 100vh; display: flex; align-items: center; justify-content: center; gap: 40px;
    background: radial-gradient(1200px 700px at 50% 120%, ${GREEN}55, transparent 70%), ${INK};
    font: 600 14px system-ui, -apple-system, sans-serif; }
  .window { border-radius: 12px; overflow: hidden; background: #fff; box-shadow: 0 30px 80px rgba(0, 0, 0, 0.5); }
  .bar { position: relative; height: 36px; display: flex; align-items: center; gap: 8px; padding: 0 14px; background: #ECEAE3; }
  .bar span { width: 12px; height: 12px; border-radius: 50%; background: #C9C6BD; }
  .bar b { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; color: #5F5E6E; font-weight: 600; }
  img { display: block; }
</style>${window(top, 'handoff.html')}${window(flow, 'handoff.html · User flow')}</body>`);
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
