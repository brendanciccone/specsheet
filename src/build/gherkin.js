import { keywordOf, resolveKeywords } from '../util.js';

/** A step title as a Gherkin line. Titles without a keyword continue the previous step. */
export function gherkinLine(title) {
  const text = String(title).trim();
  const first = text.split(/\s+/)[0] ?? '';
  const hasKeyword = keywordOf(text).toLowerCase() === first.toLowerCase();
  return hasKeyword ? text : `And ${text}`;
}

/**
 * The opening Given steps that every scenario shares, as Gherkin lines. Each scenario has
 * to start from the page on its own, so they all repeat the same opening. A handoff says
 * it once instead. Only Given steps count, there must be two scenarios or more, and every
 * scenario keeps at least one step of its own.
 */
export function sharedStart(scenarios) {
  if (scenarios.length < 2) return [];
  const lines = scenarios.map((scenario) => scenario.steps.map((step) => gherkinLine(step.title)));
  const keywords = scenarios.map((scenario) => resolveKeywords(scenario.steps.map((step) => step.title)));
  let count = 0;
  while (
    lines.every(
      (steps, index) => count < steps.length - 1 && keywords[index][count] === 'Given' && steps[count] === lines[0][count],
    )
  ) {
    count += 1;
  }
  return lines[0].slice(0, count);
}

/**
 * A scenario's steps as Gherkin lines, leaving out the first `skip` of them. When the
 * first step left over continues one that was left out ("And ..."), it takes the keyword
 * it continues, so the scenario still starts with Given, When or Then.
 */
export function stepLines(scenario, skip = 0) {
  const titles = scenario.steps.map((step) => step.title);
  const keywords = resolveKeywords(titles);
  return titles.slice(skip).map((title, index) => {
    const line = gherkinLine(title);
    if (index > 0 || skip === 0) return line;
    const first = line.split(/\s+/)[0];
    return ['And', 'But'].includes(first) ? `${keywords[skip]}${line.slice(first.length)}` : line;
  });
}

export function scenarioText(scenario, indent = '  ', skip = 0) {
  const lines = [];
  const tags = (scenario.covers ?? []).map((id) => `@${id}`).join(' ');
  if (tags) lines.push(`${indent}${tags}`);
  lines.push(`${indent}Scenario: ${scenario.title}`);
  for (const line of stepLines(scenario, skip)) lines.push(`${indent}  ${line}`);
  return lines.join('\n');
}

/** The scenarios of a flow, once each: a scenario that ran at several screen sizes counts once. */
export function uniqueScenarios(flow) {
  const seen = new Set();
  return flow.scenarios.filter((scenario) => {
    if (seen.has(scenario.title)) return false;
    seen.add(scenario.title);
    return true;
  });
}

/**
 * One feature file for a flow. `meta` adds an optional description under the feature line.
 * Steps that every scenario opens with go in a Background.
 */
export function featureText(flow, meta = {}) {
  const lines = [`Feature: ${flow.name}`];
  const description = [];
  if (meta.title) description.push(meta.ticketKey ? `${meta.ticketKey}: ${meta.title}` : meta.title);
  if (description.length) lines.push(...description.map((line) => `  ${line}`));

  const scenarios = uniqueScenarios(flow);
  const background = sharedStart(scenarios);
  if (background.length) lines.push('', '  Background:', ...background.map((line) => `    ${line}`));
  for (const scenario of scenarios) lines.push('', scenarioText(scenario, '  ', background.length));
  return `${lines.join('\n')}\n`;
}
