// The handoff as Markdown. The same text is used for the Jira comment and for the
// "copy" buttons on the HTML page, so both always say the same thing.

import { sourceLabel } from '../config.js';
import { clock, escapeMarkdown, formatBytes, plural } from '../util.js';
import { featureText, sharedStart, stepLines, uniqueScenarios } from './gherkin.js';

const REQUIREMENT_STATUS = { covered: 'Covered', failing: 'Failing', 'not-covered': 'Not covered' };
const SOURCE = { stated: 'Stated in ticket', inferred: 'Inferred from design' };
const STATE_STATUS = {
  reached: 'Shown',
  missing: 'Not shown',
  failing: 'Failing',
  'not-applicable': 'Does not apply',
};

export function requirementStatus(status) {
  return REQUIREMENT_STATUS[status] ?? status;
}
export function requirementSource(source) {
  return SOURCE[source] ?? source;
}
export function stateStatus(status) {
  return STATE_STATUS[status] ?? status;
}

export function formatDate(iso) {
  const date = iso ? new Date(iso) : new Date();
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

export function designText(design) {
  if (!design) return 'Not stated';
  const label = sourceLabel(design.source);
  return design.rebuilt ? `${label}, rebuilt as a browser prototype` : label;
}

export function resultText(model) {
  const { counts } = model;
  const base = `${counts.scenariosPassed} of ${plural(counts.scenarios, 'scenario')} pass, ${counts.stepsPassed} of ${plural(counts.steps, 'step')}`;
  return model.passed ? base : `${base}. This handoff has failing steps.`;
}

/** Facts shown at the top of the handoff: [label, value, link]. */
export function summaryFacts(model) {
  const { meta } = model;
  const facts = [];
  if (meta.ticket?.key) facts.push(['Ticket', meta.ticket.key, meta.ticket.url ?? null]);
  facts.push(['Design', designText(meta.design), meta.design?.link ?? null]);
  facts.push(['Screen size', meta.viewportLabels.join('; '), null]);
  facts.push(['Data', meta.data === 'real' ? 'Real data' : 'Mock data', null]);
  facts.push(['Result', resultText(model), null]);
  facts.push(['Run on', formatDate(meta.ranAt), null]);
  return facts;
}

export function rebuiltNote(model) {
  const design = model.meta.design;
  if (!design?.rebuilt) return null;
  const label = sourceLabel(design.source);
  return (
    `The prototype was rebuilt from the ${label} design. ${label} is the reference for how it looks. ` +
    'The prototype, videos and screenshots show how it behaves.'
  );
}

export function summaryMarkdown(model) {
  const lines = summaryFacts(model).map(([label, value, link]) =>
    link ? `- ${label}: [${value}](${link})` : `- ${label}: ${value}`,
  );
  const note = rebuiltNote(model);
  if (note) lines.push('', note);
  return lines.join('\n');
}

export function requirementsMarkdown(model) {
  if (!model.requirements.length) return 'No requirements were listed.';
  const lines = ['| ID | Requirement | From | Status | Proved by |', '|---|---|---|---|---|'];
  for (const item of model.requirements) {
    lines.push(
      `| ${item.id} | ${escapeMarkdown(item.text)} | ${requirementSource(item.source)} | ` +
        `${requirementStatus(item.status)} | ${item.scenarios.map(escapeMarkdown).join('; ') || 'None'} |`,
    );
  }
  return lines.join('\n');
}

export function gherkinMarkdown(flow, model) {
  const text = featureText(flow, { title: model.meta.title, ticketKey: model.meta.ticket?.key });
  return '```gherkin\n' + text.trimEnd() + '\n```';
}

export function checklistLines(flow) {
  const lines = [];
  const scenarios = uniqueScenarios(flow);
  const shared = sharedStart(scenarios);
  if (shared.length) lines.push('Every scenario starts with:', ...shared.map((line) => `- ${line}`), '');
  for (const scenario of scenarios) {
    const ids = scenario.covers.length ? ` (${scenario.covers.join(', ')})` : '';
    lines.push(`- [ ] **${scenario.title}**${ids}`);
    for (const line of stepLines(scenario, shared.length)) lines.push(`  - ${line}`);
  }
  return lines;
}

/** Where each scenario starts in the flow's walkthrough video. Empty when there is none. */
export function videoChapterLines(flow) {
  const lines = [];
  for (const [index, video] of (flow.videos ?? []).entries()) {
    lines.push(`Walkthrough video (${video.viewportLabel}): ${video.file}`);
    for (const scenario of flow.scenarios) {
      if (scenario.chapter?.index === index) lines.push(`- ${clock(scenario.chapter.start)} ${scenario.title}`);
    }
  }
  return lines;
}

export function scenariosMarkdown(flow, model, format = model.meta.format) {
  const text = format === 'checklist' ? checklistLines(flow).join('\n') : gherkinMarkdown(flow, model);
  const chapters = videoChapterLines(flow);
  return chapters.length ? `${text}\n\n${chapters.join('\n')}` : text;
}

export function statesMarkdown(model) {
  const rows = [];
  for (const flow of model.flows) {
    for (const screen of flow.screens) {
      for (const state of screen.states) {
        const status = state.reason ? `${stateStatus(state.status)}: ${state.reason}` : stateStatus(state.status);
        rows.push(`| ${escapeMarkdown(screen.name)} | ${escapeMarkdown(state.name)} | ${escapeMarkdown(status)} |`);
      }
    }
  }
  if (!rows.length) return 'No states were declared.';
  return ['| Screen | State | Status |', '|---|---|---|', ...rows].join('\n');
}

export function questionsMarkdown(model) {
  if (!model.openQuestions.length) return 'None.';
  return model.openQuestions.map((question, index) => `${index + 1}. ${question}`).join('\n');
}

/** Problems a reader of the ticket should know about. Empty when the run is clean. */
export function problemLines(model) {
  const lines = [];
  for (const item of model.findings.failedSteps) {
    lines.push(`Failing step in "${item.scenario}": ${item.step}`);
  }
  for (const item of model.findings.unverified) {
    lines.push(`Not verified in "${item.scenario}": ${item.step}`);
  }
  for (const item of model.findings.missingStates) {
    lines.push(`No scenario shows the "${item.state}" state of ${item.screen}.`);
  }
  for (const id of model.findings.uncovered) {
    lines.push(`No scenario covers requirement ${id}.`);
  }
  return lines;
}

export function checklistMarkdown(model) {
  const lines = [`# Acceptance checklist: ${model.meta.title}`, ''];
  for (const flow of model.flows) {
    lines.push(`## ${flow.name}`, '', ...checklistLines(flow), '');
  }
  return `${lines.join('\n').trimEnd()}\n`;
}

export function filesMarkdown(files) {
  return files.map((file) => `- ${file.path} (${formatBytes(file.bytes)}): ${file.description}`).join('\n');
}

/** The Jira comment as a list of sections, each a block of Markdown. */
export function commentSections(model, files) {
  const sections = [];
  sections.push(`## Design handoff: ${model.meta.title}\n\n${summaryMarkdown(model)}`);

  const problems = problemLines(model);
  if (problems.length) sections.push(`### To be aware of\n\n${problems.map((line) => `- ${line}`).join('\n')}`);

  sections.push(`### Requirements\n\n${requirementsMarkdown(model)}`);
  for (const flow of model.flows) {
    sections.push(`### Scenarios: ${flow.name}\n\n${scenariosMarkdown(flow, model)}`);
  }
  sections.push(`### States\n\n${statesMarkdown(model)}`);
  sections.push(`### Open questions\n\n${questionsMarkdown(model)}`);
  if (files?.length) sections.push(`### Files\n\n${filesMarkdown(files)}`);
  return sections;
}

function splitLong(text, limit) {
  const parts = [];
  let current = '';
  for (const line of text.split('\n')) {
    const candidate = current ? `${current}\n${line}` : line;
    if (candidate.length > limit && current) {
      parts.push(current);
      current = line.slice(0, limit);
    } else {
      current = candidate.slice(0, limit);
    }
  }
  if (current) parts.push(current);
  return parts;
}

/** Join sections into as few comments as possible, each within the character limit. */
export function splitComment(sections, limit) {
  const room = limit - 40; // leave space for the "part 1 of 2" line
  const parts = [];
  let current = '';
  for (const section of sections) {
    const pieces = section.length > room ? splitLong(section, room) : [section];
    for (const piece of pieces) {
      const candidate = current ? `${current}\n\n${piece}` : piece;
      if (candidate.length > room && current) {
        parts.push(current);
        current = piece;
      } else {
        current = candidate;
      }
    }
  }
  if (current) parts.push(current);
  if (parts.length <= 1) return parts;
  return parts.map((part, index) => `_Part ${index + 1} of ${parts.length}_\n\n${part}`);
}
