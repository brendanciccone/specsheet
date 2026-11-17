// The Playwright configuration Specsheet runs with. `specsheet run` points Playwright at this file
// and sets SPECSHEET_DIR to the handoff folder.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from '@playwright/test';
import { loadConfig } from './config.js';

const dir = process.env.SPECSHEET_DIR;
if (!dir) {
  throw new Error('SPECSHEET_DIR is not set. Start a run with "specsheet run <folder>".');
}

const config = loadConfig(dir);
const out = path.join(dir, 'out');
const pace = Number(process.env.SPECSHEET_PACE ?? config.pace);

function video(viewport) {
  return {
    mode: 'on',
    size: { width: viewport.width, height: viewport.height },
    show: {
      // Highlight what is clicked or typed into. The step captions come from the scenario helper.
      actions: {
        duration: Math.max(300, pace),
        cursor: 'pointer',
        style: {
          highlight: 'outline: 3px solid #7F77DD; background: rgba(127, 119, 221, 0.12); border-radius: 6px',
          point: 'width: 22px; height: 22px; border-radius: 50%; background: rgba(239, 159, 39, 0.75)',
          title: 'display: none',
        },
      },
    },
  };
}

export default defineConfig({
  testDir: path.join(dir, 'scenarios'),
  testMatch: /.*\.scenario\.(js|mjs|ts)$/,
  outputDir: path.join(out, '.run'),
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: config.timeout,
  expect: { timeout: config.expectTimeout },
  reporter: [[fileURLToPath(new URL('./reporter.js', import.meta.url)), { outputFile: path.join(out, 'results.json') }]],
  use: {
    baseURL: config.baseURL,
    screenshot: 'off',
    trace: 'off',
    // Slow every action down a little so the video can be followed.
    launchOptions: { slowMo: Math.round(pace / 3) },
  },
  projects: config.viewports.map((viewport) => ({
    name: viewport.name,
    use: {
      viewport: { width: viewport.width, height: viewport.height },
      deviceScaleFactor: viewport.scale ?? 1,
      isMobile: viewport.mobile ?? false,
      hasTouch: viewport.mobile ?? false,
      video: video(viewport),
    },
  })),
  webServer: config.webServer
    ? {
        command: config.webServer.command,
        url: config.webServer.url ?? config.baseURL,
        cwd: path.resolve(dir, config.webServer.cwd ?? '.'),
        reuseExistingServer: true,
        timeout: 60000,
        stdout: 'ignore',
        stderr: 'pipe',
      }
    : undefined,
});
