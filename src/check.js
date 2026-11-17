// The size check. It reads scenario files as text, without running anything, and counts
// what a handoff contains. It warns when a story is very large and never blocks.

import fs from 'node:fs';
import path from 'node:path';
import { loadConfig, loadRequirements } from './config.js';
import { featureText } from './build/gherkin.js';
import { plural } from './util.js';

// A quoted string. Named groups, so the pattern can sit inside a larger one.
const STRING = String.raw`(?<q>['"\`])(?<s>(?:\\.|(?!\k<q>)[^\\])*)\k<q>`;
const SCENARIO_FILE = /\.scenario\.(js|mjs|ts)$/;

function unescape(text) {
  return text.replace(/\\(.)/g, '$1');
}

export function findScenarioFiles(dir) {
  const root = path.join(dir, 'scenarios');
  if (!fs.existsSync(root)) return [];
  const files = [];
  const visit = (folder) => {
    for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
      const full = path.join(folder, entry.name);
      if (entry.isDirectory()) visit(full);
      else if (SCENARIO_FILE.test(entry.name)) files.push(full);
    }
  };
  visit(root);
  return files.sort();
}

function firstString(text, key) {
  const match = new RegExp(String.raw`\b${key}\s*:\s*` + STRING).exec(text);
  return match ? unescape(match.groups.s) : null;
}

function stringList(text) {
  const items = [];
  const pattern = new RegExp(STRING, 'g');
  let match;
  while ((match = pattern.exec(text))) items.push(unescape(match.groups.s));
  return items;
}

/** Read flows, scenarios and steps out of one scenario file's source text. */
export function parseScenarioSource(source) {
  const calls = [];
  const pattern = new RegExp(String.raw`\b(flow|scenario|step)\(\s*` + STRING, 'g');
  let match;
  while ((match = pattern.exec(source))) {
    calls.push({ kind: match[1], title: unescape(match.groups.s), start: match.index, end: pattern.lastIndex });
  }

  const flows = [];
  let flow = null;
  let scenario = null;

  calls.forEach((call, index) => {
    const next = calls[index + 1];
    const tail = source.slice(call.end, next ? next.start : source.length);

    if (call.kind === 'flow') {
      const states = {};
      const entry = new RegExp(STRING + String.raw`\s*:\s*\[(?<list>[^\]]*)\]`, 'g');
      let found;
      while ((found = entry.exec(tail))) states[unescape(found.groups.s)] = stringList(found.groups.list);
      flow = { name: call.title, states, scenarios: [] };
      flows.push(flow);
      scenario = null;
    } else if (call.kind === 'scenario') {
      if (!flow) {
        flow = { name: 'Unnamed flow', states: {}, scenarios: [] };
        flows.push(flow);
      }
      const covers = /\bcovers\s*:\s*\[([^\]]*)\]/.exec(tail);
      scenario = { title: call.title, covers: covers ? stringList(covers[1]) : [], steps: [] };
      flow.scenarios.push(scenario);
    } else if (scenario) {
      // Only look at the step's own options, which sit before its function body.
      const head = tail.split(/=>|\bfunction\b/)[0];
      scenario.steps.push({
        title: call.title,
        screen: firstString(head, 'screen'),
        state: firstString(head, 'state'),
      });
    }
  });

  return flows;
}

/** Read every scenario file in a handoff folder and merge flows with the same name. */
export function readStaticFlows(dir) {
  const merged = new Map();
  for (const file of findScenarioFiles(dir)) {
    for (const flow of parseScenarioSource(fs.readFileSync(file, 'utf8'))) {
      const existing = merged.get(flow.name);
      if (!existing) {
        merged.set(flow.name, flow);
        continue;
      }
      existing.scenarios.push(...flow.scenarios);
      for (const [screen, states] of Object.entries(flow.states)) {
        existing.states[screen] = [...new Set([...(existing.states[screen] ?? []), ...states])];
      }
    }
  }
  return [...merged.values()];
}

/**
 * Count what the handoff contains and decide whether to warn.
 * `screens` is the number of screens Claude counted in the design, for the early check
 * that runs before any scenario exists.
 */
export function sizeCheck(dir, { screens: screensHint } = {}) {
  const config = loadConfig(dir);
  const { requirements } = loadRequirements(dir);
  const flows = readStaticFlows(dir);

  const scenarios = flows.flatMap((flow) => flow.scenarios);
  const steps = scenarios.flatMap((scenario) => scenario.steps);
  const screens = new Set();
  const states = new Set();
  for (const flow of flows) {
    for (const [screen, list] of Object.entries(flow.states)) {
      screens.add(screen);
      for (const state of list) states.add(`${screen}/${state}`);
    }
  }
  for (const step of steps) {
    if (!step.screen) continue;
    screens.add(step.screen);
    if (step.state) states.add(`${step.screen}/${step.state}`);
  }

  const early = scenarios.length === 0;
  const screenCount = early && Number.isFinite(screensHint) ? screensHint : screens.size;

  // The longest part of the ticket text is the Gherkin plus one line per requirement.
  const gherkin = flows.map((flow) => featureText(flow, {})).join('\n');
  const requirementText = requirements.map((item) => `| ${item.id} | ${item.text} | stated | Covered | |`).join('\n');
  const commentChars = early ? 0 : gherkin.length + requirementText.length + 900;

  const counts = {
    requirements: requirements.length,
    stated: requirements.filter((item) => item.source === 'stated').length,
    inferred: requirements.filter((item) => item.source === 'inferred').length,
    flows: flows.length,
    scenarios: scenarios.length,
    steps: steps.length,
    screens: screenCount,
    states: states.size,
    viewports: config.viewports.length,
  };

  const warnings = [];
  const notes = [];
  const over = [];
  if (counts.screens > config.warnAt) over.push(plural(counts.screens, 'screen'));
  if (counts.scenarios > config.warnAt) over.push(plural(counts.scenarios, 'scenario'));
  if (early && counts.requirements > config.warnAt) over.push(plural(counts.requirements, 'requirement'));
  if (over.length) {
    warnings.push(
      `This story covers ${over.join(' and ')}. That is large for one handoff and will cost more to process. ` +
        'Continue, or split the story first?',
    );
  }
  if (commentChars > config.commentLimit) {
    notes.push(
      `The ticket text is about ${commentChars.toLocaleString('en-US')} characters, more than the ` +
        `${config.commentLimit.toLocaleString('en-US')} that fit in one Jira comment. It will be split across comments.`,
    );
  }
  if (early && counts.requirements === 0) {
    notes.push('No requirements are listed, so this check relies on the screen count alone.');
  }
  if (counts.viewports > 1) {
    notes.push(`${counts.viewports} screen sizes are set, so every scenario runs ${counts.viewports} times.`);
  }

  return { early, counts, commentChars, warnings, notes, threshold: config.warnAt };
}

export function formatSizeCheck(result) {
  const { counts } = result;
  const lines = [];
  if (result.early) {
    lines.push('Size check (before scenarios are written)');
    lines.push(`  ${plural(counts.requirements, 'requirement')} (${counts.stated} stated, ${counts.inferred} inferred)`);
    lines.push(`  ${plural(counts.screens, 'screen')}`);
  } else {
    lines.push('Size check');
    lines.push(`  ${plural(counts.requirements, 'requirement')} (${counts.stated} stated, ${counts.inferred} inferred)`);
    lines.push(`  ${plural(counts.flows, 'flow')}, ${plural(counts.scenarios, 'scenario')}, ${plural(counts.steps, 'step')}`);
    lines.push(`  ${plural(counts.screens, 'screen')}, ${plural(counts.states, 'state')}`);
    lines.push(`  Ticket text: about ${result.commentChars.toLocaleString('en-US')} characters`);
  }
  for (const note of result.notes) lines.push(`  Note: ${note}`);
  if (result.warnings.length) {
    for (const warning of result.warnings) lines.push(`  WARNING: ${warning}`);
  } else {
    lines.push(`  No warning. The threshold is ${result.threshold} screens or scenarios.`);
  }
  return lines.join('\n');
}
