import { keywordOf } from '../util.js';

/** A step title as a Gherkin line. Titles without a keyword continue the previous step. */
export function gherkinLine(title) {
  const text = String(title).trim();
  const first = text.split(/\s+/)[0] ?? '';
  const hasKeyword = keywordOf(text).toLowerCase() === first.toLowerCase();
  return hasKeyword ? text : `And ${text}`;
}

export function scenarioText(scenario, indent = '  ') {
  const lines = [];
  const tags = (scenario.covers ?? []).map((id) => `@${id}`).join(' ');
  if (tags) lines.push(`${indent}${tags}`);
  lines.push(`${indent}Scenario: ${scenario.title}`);
  for (const step of scenario.steps) lines.push(`${indent}  ${gherkinLine(step.title)}`);
  return lines.join('\n');
}

/**
 * One feature file for a flow. `meta` adds an optional description under the feature line.
 * Scenarios that ran at several screen sizes appear once.
 */
export function featureText(flow, meta = {}) {
  const lines = [`Feature: ${flow.name}`];
  const description = [];
  if (meta.title) description.push(meta.ticketKey ? `${meta.ticketKey}: ${meta.title}` : meta.title);
  if (description.length) lines.push(...description.map((line) => `  ${line}`));

  const seen = new Set();
  for (const scenario of flow.scenarios) {
    if (seen.has(scenario.title)) continue;
    seen.add(scenario.title);
    lines.push('', scenarioText(scenario));
  }
  return `${lines.join('\n')}\n`;
}
