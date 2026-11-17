// Playwright reporter that writes one results file for the whole run.
// Everything Specsheet builds afterwards (page, user flow, feature files, comment) reads this file.

import fs from 'node:fs';
import path from 'node:path';
import { cleanError } from './util.js';

function parse(text, fallback) {
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

function walk(steps, visit) {
  for (const step of steps ?? []) {
    visit(step);
    walk(step.steps, visit);
  }
}

function countChecks(step) {
  let count = 0;
  walk(step.steps, (child) => {
    if (child.category === 'expect') count += 1;
  });
  return count;
}

export default class SpecsheetReporter {
  constructor(options = {}) {
    this.outputFile = options.outputFile;
    this.scenarios = [];
  }

  // Specsheet prints its own short summary, so Playwright should not add a terminal reporter.
  printsToStdio() {
    return true;
  }

  onBegin(config) {
    this.rootDir = config.rootDir;
    this.startedAt = new Date().toISOString();
    this.errors = [];
  }

  // Errors outside any scenario, such as a scenario file that cannot be loaded.
  onError(error) {
    this.errors.push(cleanError(error?.message ?? String(error)));
  }

  onTestEnd(test, result) {
    const annotations = Object.fromEntries(
      test.annotations
        .filter((item) => item.type.startsWith('specsheet:'))
        .map((item) => [item.type.slice('specsheet:'.length), parse(item.description, null)]),
    );

    const attachment = result.attachments.find((item) => item.name === 'specsheet-steps');
    const steps = attachment?.body ? parse(attachment.body.toString('utf8'), []) : [];

    // Match each recorded step to Playwright's own step tree to count its checks.
    const stepNodes = [];
    walk(result.steps, (node) => {
      if (node.category === 'test.step') stepNodes.push(node);
    });
    steps.forEach((step, index) => {
      const node = stepNodes[index];
      step.checks = node && node.title === step.title ? countChecks(node) : 0;
    });

    // Store file paths relative to the output folder, so the folder can be moved later.
    const base = this.outputFile ? path.dirname(this.outputFile) : null;
    const portable = (file) => (file && base ? path.relative(base, file) : file);
    for (const step of steps) step.screenshot = portable(step.screenshot);

    const project = test.parent.project();
    const size = project?.use?.viewport ?? null;
    const video = portable(result.attachments.find((item) => item.name === 'video')?.path ?? null);
    const flow = annotations.flow ?? { name: 'Unnamed flow', states: {}, notApplicable: {} };

    const record = {
      title: test.title,
      flow: flow.name,
      declaredStates: flow.states ?? {},
      notApplicable: flow.notApplicable ?? {},
      covers: annotations.covers ?? [],
      viewport: { name: project?.name ?? 'Default', width: size?.width ?? null, height: size?.height ?? null },
      file: path.relative(this.rootDir, test.location.file),
      status: result.status, // passed | failed | timedOut | skipped | interrupted
      durationMs: result.duration,
      error: cleanError(result.error?.message),
      steps,
      video,
    };

    // With retries, keep only the last attempt of each scenario at each screen size.
    const key = `${record.file}::${record.flow}::${record.title}::${record.viewport.name}`;
    const existing = this.scenarios.findIndex((item) => item.key === key);
    if (existing >= 0) this.scenarios[existing] = { key, ...record };
    else this.scenarios.push({ key, ...record });
  }

  onEnd(result) {
    const output = {
      version: 1,
      startedAt: this.startedAt,
      finishedAt: new Date().toISOString(),
      status: result.status,
      errors: this.errors ?? [],
      scenarios: this.scenarios.map(({ key, ...rest }) => rest),
    };
    if (this.outputFile) {
      fs.mkdirSync(path.dirname(this.outputFile), { recursive: true });
      fs.writeFileSync(this.outputFile, JSON.stringify(output, null, 2));
    }
  }
}
