// Records the demo video, docs/demo/specsheet-demo.mp4. Needs ffmpeg.
//   node docs/demo/record.mjs
//
// It runs the example for real, then records three parts and joins them:
//   1. Title cards and the command with the output it really printed. The terminal
//      window is drawn for the video; the text in it is the real output.
//   2. The walkthrough video the run produced, unchanged.
//   3. A tour of the handoff page the run produced.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const handoff = 'examples/contact-form/handoff/HELP-12';
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'specsheet-demo-'));
const SIZE = { width: 1440, height: 900 };
const INK = '#15141B';
const PAPER = '#F6F4EE';
const TAGLINE = 'Turn a ticket and a design into everything engineering needs.';

const run = spawnSync(process.execPath, ['bin/specsheet.mjs', 'run', handoff], { cwd: root, encoding: 'utf8' });
const output = `${run.stdout}${run.stderr}`.trimEnd().split('\n');
const walkthrough = path.join(root, handoff, 'out', 'videos', 'contact-form.desktop.mp4');
if (!fs.existsSync(walkthrough)) throw new Error(`The run did not produce ${walkthrough}.`);

const mark = fs
  .readFileSync(path.join(root, 'assets', 'mark.svg'), 'utf8')
  .replace(/<style>[\s\S]*?<\/style>/, `<style>.specsheet-ink { fill: ${PAPER}; stroke: ${PAPER}; }</style>`)
  .replace(/width="\d+" height="\d+"/, 'width="132" height="132"');

// Cards match the scenario title cards inside the walkthrough video: dark, left-aligned,
// a small green label above a large title. They fade in, and stay long enough to read.
const shell = (inner) =>
  `<body style="margin:0;height:100vh;display:flex;align-items:center;justify-content:center;background:${INK};font-family:system-ui,-apple-system,sans-serif">` +
  '<style>@keyframes rise { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: none; } } .rise { animation: rise 0.5s ease-out both; }</style>' +
  `${inner}</body>`;
const brandCard = () =>
  shell(
    `<div class="rise" style="display:flex;flex-direction:column;align-items:center;text-align:center">${mark}` +
      `<div style="margin-top:22px;font-size:76px;font-weight:700;letter-spacing:-0.03em;color:${PAPER}">specsheet</div>` +
      `<div style="margin-top:16px;font-size:28px;color:#A9A7B8;max-width:900px;line-height:1.35">${TAGLINE}</div></div>`,
  );
const stepCard = (number, title, sub) =>
  shell(
    '<div class="rise" style="width:74%;max-width:1040px">' +
      '<div style="display:flex;align-items:center;gap:14px;font-size:20px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:#1F9F78">' +
      `<span style="width:36px;height:4px;border-radius:2px;background:#1F9F78"></span>Step ${number} of 3</div>` +
      `<div style="margin-top:22px;font-size:64px;line-height:1.1;font-weight:700;letter-spacing:-0.02em;color:${PAPER}">${title}</div>` +
      `<div style="margin-top:20px;font-size:28px;line-height:1.35;color:#A9A7B8;max-width:880px">${sub}</div>` +
      '<div style="display:flex;gap:10px;margin-top:44px">' +
      [1, 2, 3].map((dot) => `<span style="width:${dot === number ? 44 : 12}px;height:12px;border-radius:6px;background:${dot === number ? '#1F9F78' : '#3A3948'}"></span>`).join('') +
      '</div></div>',
  );
const BRAND_HOLD = 3600;
const STEP_HOLD = 4200;

// The page's video is H.264, which Playwright's own Chromium may not play. Use the
// installed Chrome when there is one, and note which was used.
let browser;
let canPlay = true;
try {
  browser = await chromium.launch({ channel: 'chrome' });
} catch {
  browser = await chromium.launch();
}

async function record(name, body) {
  const context = await browser.newContext({ viewport: SIZE, recordVideo: { dir: out, size: SIZE }, permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await context.newPage();
  // Load a real page first. Until the first navigation the window is not yet at its full
  // size, and the recording shows a grey strip along the bottom.
  await page.goto(`data:text/html,<body style="margin:0;background:${encodeURIComponent(INK)}"></body>`);
  await page.waitForTimeout(300);
  await body(page);
  await context.close();
  fs.renameSync(await page.video().path(), path.join(out, name));
}

await record('a-command.webm', async (page) => {
  await page.setContent(brandCard());
  await page.waitForTimeout(BRAND_HOLD);
  await page.setContent(stepCard(1, 'You run one command', 'With a ticket and a design that runs in a browser'));
  await page.waitForTimeout(STEP_HOLD);
  await page.setContent(`<body style="margin:0;height:100vh;display:flex;align-items:center;justify-content:center;background:${INK}">
    <div style="width:1180px;height:740px;border-radius:14px;background:#1B1A23;border:1px solid #3A3948;box-shadow:0 30px 80px rgba(0,0,0,.5);overflow:hidden">
      <div style="height:42px;background:#26252F;display:flex;align-items:center;gap:8px;padding:0 16px">
        <span style="width:12px;height:12px;border-radius:50%;background:#5c5b66"></span><span style="width:12px;height:12px;border-radius:50%;background:#5c5b66"></span><span style="width:12px;height:12px;border-radius:50%;background:#5c5b66"></span>
      </div>
      <pre id="term" style="margin:0;padding:22px 26px;font:17px/1.5 'SF Mono',Menlo,Consolas,monospace;color:#ECEAF5;white-space:pre-wrap"></pre>
    </div></body>`);
  const add = (html) => page.evaluate((value) => { document.querySelector('#term').insertAdjacentHTML('beforeend', value); }, html);
  const escape = (text) => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;');
  await add('<span style="color:#8f8da0">$ </span>');
  for (const character of `npx specsheet run ${handoff}`) {
    await add(escape(character));
    await page.waitForTimeout(28);
  }
  await page.waitForTimeout(500);
  await add('\n');
  for (const line of output) {
    let html = escape(line);
    if (line.startsWith('Run:')) html = `<span style="color:#b7da8a;font-weight:600">${html}</span>`;
    else if (line.startsWith('States never reached') || line.includes('help/contact: sending')) html = `<span style="color:#f3c275">${html}</span>`;
    else if (line.startsWith('Size check') || line.startsWith('Files in') || line.startsWith('Running')) html = `<span style="font-weight:600">${html}</span>`;
    await add(`${html}\n`);
    await page.waitForTimeout(line.startsWith('Running') ? 1900 : line === '' ? 160 : 260);
  }
  await page.waitForTimeout(4000);
  await page.setContent(stepCard(2, 'A robot user runs every scenario', 'It performs each step, checks the result, and records one walkthrough video'));
  await page.waitForTimeout(STEP_HOLD);
});

await record('c-handoff.webm', async (page) => {
  await page.setContent(stepCard(3, 'You get the handoff', 'One file with every step, its screenshot and the video, made for copy and paste'));
  await page.waitForTimeout(STEP_HOLD);
  await page.goto('file://' + path.join(root, handoff, 'out', 'handoff.html'));
  await page.waitForTimeout(1500);
  const glide = async (selector, hold, offset = 30) => {
    await page.evaluate(({ target, gap }) => {
      const element = document.querySelector(target);
      window.scrollTo({ top: element.getBoundingClientRect().top + window.scrollY - gap, behavior: 'smooth' });
    }, { target: selector, gap: offset });
    // Long enough to take in each part of the page.
    await page.waitForTimeout(Math.round(hold * 1.45));
  };
  const outline = (locator) =>
    locator.evaluate((element) => { element.style.outline = '3px solid #1F9F78'; element.style.outlineOffset = '3px'; element.style.borderRadius = '4px'; });

  await glide('section[data-block="requirements"]', 2200);
  await glide('section[data-block="flow"]', 2200);
  // Use the interactive user flow: zoom in, then open one screen full size.
  await page.locator('button[data-flow="in"]').click();
  await page.waitForTimeout(700);
  await page.locator('button[data-flow="in"]').click();
  await page.waitForTimeout(1300);
  await page.locator('button[data-flow="fit"]').click();
  await page.waitForTimeout(900);
  await page.locator('.flow-node[data-label="help/contact · send-failed"]').click();
  await page.waitForTimeout(2400);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(600);

  // The walkthrough video inside the page, and a jump to one scenario in it.
  await glide('section[data-block="flow-0"]', 2200);
  canPlay = await page.evaluate(() => {
    const video = document.querySelector('video.walkthrough');
    return Boolean(video) && !video.hidden && !video.error && video.readyState >= 1;
  });
  if (canPlay) {
    const link = page.locator('a.chapter').nth(1);
    await link.scrollIntoViewIfNeeded();
    await page.waitForTimeout(900);
    await outline(link);
    await page.waitForTimeout(1100);
    await link.click();
    await page.waitForTimeout(5200);
    await page.evaluate(() => document.querySelector('video.walkthrough').pause());
    await page.waitForTimeout(500);
  }

  await glide('article.scenario', 2000);
  await glide('article.scenario figure', 1800, 60);
  await glide('section[data-block="states"]', 2600);
  const button = page.locator('section[data-block="states"] button[data-copy="text"]');
  await outline(button);
  await page.waitForTimeout(700);
  await button.click();
  await page.waitForTimeout(1700);
  await glide('section[data-block="questions"]', 1800);
  await page.setContent(brandCard());
  await page.waitForTimeout(BRAND_HOLD);
});
await browser.close();

const target = path.join(root, 'docs', 'demo', 'specsheet-demo.mp4');
const clips = [path.join(out, 'a-command.webm'), walkthrough, path.join(out, 'c-handoff.webm')];
const prepared = clips.map((_, index) => `[${index}:v]fps=25,scale=1280:800,setsar=1,format=yuv420p[v${index}]`).join(';');
const joined = spawnSync(
  'ffmpeg',
  ['-y', '-loglevel', 'error', ...clips.flatMap((clip) => ['-i', clip]),
    '-filter_complex', `${prepared};${clips.map((_, index) => `[v${index}]`).join('')}concat=n=${clips.length}:v=1:a=0[v]`,
    '-map', '[v]', '-c:v', 'libx264', '-crf', '22', '-preset', 'medium', '-movflags', '+faststart', '-an', target],
  { stdio: 'inherit' },
);
fs.rmSync(out, { recursive: true, force: true });
if (joined.status !== 0) throw new Error('ffmpeg could not join the clips.');
console.log(`written ${path.relative(root, target)}${canPlay ? '' : ' (this browser could not play the video inside the page, so that part was skipped)'}`);
