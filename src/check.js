// The size check. It reads scenario files as text, without running anything, and counts
// what a handoff contains. It warns when a story is very large and never blocks.

import fs from 'node:fs';
import path from 'node:path';
import { loadConfig, loadRequirements } from './config.js';
import { featureText } from './build/gherkin.js';
import { openQuestion, plural } from './util.js';

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
        // After a scenario's first step, a page opened by its address is a jump nobody clicked for.
        jumps: scenario.steps.length > 0 && /\.goto\(/.test(tail),
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

/** Where a large story could be divided: by flow, or by the requirements that take the most scenarios. */
function splitHints(flows, requirements, limits) {
  const hints = [];
  const sized = flows.filter((flow) => flow.scenarios.length);
  if (sized.length > 1) {
    const list = sized.map((flow) => `"${flow.name}" (${plural(flow.scenarios.length, 'scenario')})`).join(', ');
    hints.push(`It could be split by flow: ${list}.`);
  }
  const perRequirement = requirements
    .map((item) => ({ id: item.id, count: sized.flatMap((flow) => flow.scenarios).filter((scenario) => scenario.covers.includes(item.id)).length }))
    .filter((item) => item.count >= 3)
    .sort((a, b) => b.count - a.count)
    .slice(0, 3);
  if (perRequirement.length) {
    hints.push(`Most scenarios go to: ${perRequirement.map((item) => `${item.id} (${item.count})`).join(', ')}. Each could be a story of its own.`);
  }
  if (!sized.length && requirements.length > limits.requirements) {
    hints.push('Group the requirements by the screen or the goal they belong to, and hand off one group at a time.');
  }
  return hints;
}

// More open questions than this is more than a reader will answer.
const QUESTIONS_AT = 5;

/**
 * What to put right in the open questions. Each is for a person to answer, so it has to
 * be a question, name who can answer it, and say what is built if nobody does.
 */
export function questionNotes(list) {
  const notes = [];
  const questions = list.map(openQuestion);
  const numbers = (test) =>
    questions
      .map((entry, index) => (test(entry) ? index + 1 : 0))
      .filter(Boolean)
      .join(', ');
  const lacks = [
    [(entry) => !entry.question, 'has no "question" text, so the handoff leaves it out'],
    [
      (entry) => entry.question && !entry.question.endsWith('?'),
      'does not end in a question mark. If it is a decision you made, it goes in the "note" of the requirement it belongs to',
    ],
    [(entry) => !entry.who, 'missing "who": the person or role that can answer it'],
    [(entry) => !entry.default, 'missing "default": what is built if nobody answers'],
  ];
  for (const [test, problem] of lacks) {
    const list = numbers(test);
    if (list) notes.push(`Open ${list.includes(',') ? 'questions' : 'question'} ${list}: ${problem}.`);
  }
  if (questions.length > QUESTIONS_AT) {
    notes.push(
      `${questions.length} open questions is a lot to ask of a reader. Keep the ones whose answer changes what is built or tested. ` +
        'A decision you made goes in a requirement\'s "note", standard behaviour in "assumed", and a place where the design disagrees with itself goes to the designer.',
    );
  }
  return notes;
}

/**
 * Count what the handoff contains and decide whether to warn.
 * `screens` is the number of screens Claude counted in the design, for the early check
 * that runs before any scenario exists.
 */
export function sizeCheck(dir, { screens: screensHint } = {}) {
  const config = loadConfig(dir);
  const { requirements, openQuestions } = loadRequirements(dir);
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
    openQuestions: openQuestions.length,
  };

  const warnings = [];
  const notes = [];
  const limits = config.warnAt;
  const over = [];
  if (counts.scenarios > limits.scenarios) over.push(plural(counts.scenarios, 'scenario'));
  if (counts.screens > limits.screens) over.push(plural(counts.screens, 'screen'));
  if (early && counts.requirements > limits.requirements) over.push(plural(counts.requirements, 'requirement'));
  if (over.length) {
    warnings.push(
      `This story covers ${over.join(' and ')}. A handoff that size is slow to read and its user flow is hard to follow. ` +
        'Splitting it into smaller stories is recommended. Continue as one, or split?',
    );
    notes.push(...splitHints(flows, requirements, limits));
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
  notes.push(...questionNotes(openQuestions));
  const jumps = scenarios.flatMap((scenario) => scenario.steps.filter((step) => step.jumps).map((step) => `"${step.title}" in "${scenario.title}"`));
  if (jumps.length) {
    notes.push(
      `${plural(jumps.length, 'step opens', 'steps open')} a page by its address after the scenario has started: ${jumps.slice(0, 3).join(', ')}` +
        `${jumps.length > 3 ? `, and ${jumps.length - 3} more` : ''}. In the video the page jumps there with nothing clicked. ` +
        'If a user gets there through a link or a button, click that instead.',
    );
  }

  return { early, counts, commentChars, warnings, notes, limits };
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
  if (counts.openQuestions) lines.push(`  ${plural(counts.openQuestions, 'open question')}`);
  for (const warning of result.warnings) lines.push(`  WARNING: ${warning}`);
  for (const note of result.notes) lines.push(`  Note: ${note}`);
  if (!result.warnings.length) {
    lines.push(
      `  No warning. A split is recommended above ${result.limits.scenarios} scenarios or ${result.limits.screens} screens` +
        (result.early ? `, or ${result.limits.requirements} requirements before scenarios are written.` : '.'),
    );
  }
  return lines.join('\n');
}
