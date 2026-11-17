// Renders the chosen logo: the PNG files in assets/, and one sheet showing it in use.
//   node docs/logo/final.mjs

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (name) => fs.readFileSync(path.join(root, 'assets', name), 'utf8');
const INK = '#15141B';
const PAPER = '#F6F4EE';

// Fix the theme-following colours to one value, for rendering a specific version.
const fixed = (svg, colour) =>
  svg.replace(/<style>[\s\S]*?<\/style>/, `<style>.specsheet-ink { fill: ${colour}; stroke: ${colour}; }</style>`);
const resize = (svg, width, height = width) => svg.replace(/width="\d+" height="\d+"/, `width="${width}" height="${height}"`);
// Each version is shown as its own image, so one version's colours cannot leak into another.
const sized = (svg, width, height = width) =>
  `<img width="${width}" height="${height}" alt="" src="data:image/svg+xml;base64,${Buffer.from(resize(svg, width, height)).toString('base64')}">`;

const mark = read('mark.svg');
const icon = read('icon.svg');
const logo = read('logo.svg');

const browser = await chromium.launch();

async function png(svg, file, width, height) {
  const page = await browser.newPage({ viewport: { width, height } });
  await page.setContent(`<body style="margin:0;background:transparent">${resize(svg, width, height)}</body>`);
  await page.locator('svg').screenshot({ path: path.join(root, 'assets', file), omitBackground: true });
  await page.close();
}
await png(icon, 'icon.png', 512, 512);
await png(fixed(logo, INK), 'logo.png', 652, 160);

const small = [48, 32, 24, 16].map((size) => sized(fixed(mark, INK), size)).join('');
const html = `<body><style>
  body { margin: 0; padding: 26px; background: #fff; font: 14px/1.4 system-ui, -apple-system, sans-serif; color: ${INK}; }
  .grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 16px; }
  .box { display: flex; align-items: center; justify-content: center; height: 230px; border-radius: 14px; }
  .light { background: ${PAPER}; } .dark { background: ${INK}; } .white { background: #fff; border: 1px solid #dcdbe6; }
  .row { display: flex; align-items: flex-end; gap: 22px; }
  .cap { color: #5f5e6e; font-size: 13px; margin: 8px 2px 0; }
</style>
<div class="grid">
  <div><div class="box light">${sized(fixed(mark, INK), 150)}</div><div class="cap">The mark on light</div></div>
  <div><div class="box dark">${sized(fixed(mark, PAPER), 150)}</div><div class="cap">The mark on dark</div></div>
  <div><div class="box white">${sized(icon, 132)}</div><div class="cap">As an app icon</div></div>
  <div><div class="box light">${sized(fixed(logo, INK), 326, 80)}</div><div class="cap">With the name, on light</div></div>
  <div><div class="box dark">${sized(fixed(logo, PAPER), 326, 80)}</div><div class="cap">With the name, on dark</div></div>
  <div><div class="box white"><div class="row">${small}${sized(icon, 32)}${sized(icon, 16)}</div></div><div class="cap">At 48, 32, 24 and 16 pixels, then the icon at 32 and 16</div></div>
</div></body>`;
const page = await browser.newPage({ viewport: { width: 1180, height: 400 } });
await page.setContent(html);
await page.screenshot({ path: path.join(root, 'docs', 'logo', 'final.png'), fullPage: true });

// The mark alone, with no name, for asking people what it looks like.
const alone = await browser.newPage({ viewport: { width: 520, height: 300 } });
await alone.setContent(
  `<body style="margin:0;display:flex;gap:40px;align-items:center;justify-content:center;height:300px;background:${PAPER}">` +
    `${sized(fixed(mark, INK), 170)}${sized(fixed(mark, INK), 48)}${sized(fixed(mark, INK), 20)}</body>`,
);
await alone.screenshot({ path: path.join(root, 'docs', 'logo', 'final-mark-only.png') });

await browser.close();
console.log('written assets/icon.png, assets/logo.png, docs/logo/final.png and docs/logo/final-mark-only.png');
