// Turns the raw results of a run into the model every output is rendered from.

import { resolveKeywords, viewportLabel } from '../util.js';

const stateKey = (screen, state) => `${screen}/${state ?? ''}`;

function buildScenario(raw, staticScenario) {
  const steps = raw.steps.map((step) => ({ ...step }));

  // A failed step stops the scenario. Add the steps that never ran, from the source text.
  if (staticScenario && staticScenario.steps.length > steps.length) {
    for (const missing of staticScenario.steps.slice(steps.length)) {
      steps.push({
        index: steps.length,
        title: missing.title,
        screen: missing.screen,
        state: missing.state,
        status: 'not-run',
        checks: 0,
        error: null,
        screenshot: null,
      });
    }
  }

  const keywords = resolveKeywords(steps.map((step) => step.title));
  steps.forEach((step, index) => {
    step.resolvedKeyword = keywords[index];
    step.shot = null;
  });

  // Consecutive steps that land on the same screen and state share one screenshot,
  // taken after the last of them, when the page has settled and the checks have run.
  let index = 0;
  while (index < steps.length) {
    const step = steps[index];
    if (step.status === 'not-run') {
      index += 1;
      continue;
    }
    let last = index;
    if (step.screen) {
      while (
        last + 1 < steps.length &&
        steps[last + 1].status !== 'not-run' &&
        steps[last + 1].screen === step.screen &&
        steps[last + 1].state === step.state
      ) {
        last += 1;
      }
    }
    const group = steps.slice(index, last + 1);
    // A state only counts as shown when every step that lands on it passed.
    const groupPassed = group.every((item) => item.status === 'passed');
    for (const item of group) item.groupPassed = groupPassed;
    const shown = group[group.length - 1];
    if (shown.screenshot) {
      shown.shot = {
        file: shown.screenshot,
        screen: shown.screen,
        state: shown.state,
        failed: shown.status === 'failed',
        verified: groupPassed && group.some((item) => item.checks > 0),
      };
    }
    index = last + 1;
  }

  return {
    title: raw.title,
    flow: raw.flow,
    covers: raw.covers ?? [],
    viewport: raw.viewport,
    viewportLabel: viewportLabel(raw.viewport),
    status: raw.status === 'passed' ? 'passed' : 'failed',
    rawStatus: raw.status,
    error: raw.error,
    durationMs: raw.durationMs,
    video: raw.video,
    steps,
  };
}

export function buildModel({ results, config, requirements, openQuestions, assumed = [], staticFlows = [] }) {
  const staticByKey = new Map();
  for (const flow of staticFlows) {
    for (const scenario of flow.scenarios) staticByKey.set(`${flow.name}::${scenario.title}`, scenario);
  }

  // Flows, in the order they first appear.
  const flows = [];
  const flowByName = new Map();
  for (const raw of results.scenarios) {
    let flow = flowByName.get(raw.flow);
    if (!flow) {
      flow = { name: raw.flow, scenarios: [], declared: {}, notApplicable: {} };
      flowByName.set(raw.flow, flow);
      flows.push(flow);
    }
    for (const [screen, states] of Object.entries(raw.declaredStates ?? {})) {
      flow.declared[screen] = [...new Set([...(flow.declared[screen] ?? []), ...states])];
    }
    Object.assign(flow.notApplicable, raw.notApplicable ?? {});
    flow.scenarios.push(buildScenario(raw, staticByKey.get(`${raw.flow}::${raw.title}`)));
  }

  // Screens and states for each flow: what was declared, and what a passing step reached.
  for (const flow of flows) {
    const reached = new Map();
    const failing = new Map();
    for (const scenario of flow.scenarios) {
      for (const step of scenario.steps) {
        if (!step.screen || step.status === 'not-run') continue;
        if (!step.groupPassed) {
          failing.set(stateKey(step.screen, step.state), { screen: step.screen, state: step.state });
          continue;
        }
        const key = stateKey(step.screen, step.state);
        const entry = reached.get(key) ?? { screen: step.screen, state: step.state, shots: [] };
        if (step.shot) entry.shots.push({ ...step.shot, viewport: scenario.viewport, scenario: scenario.title });
        reached.set(key, entry);
      }
    }

    const screens = new Map();
    const ensure = (screen) => {
      if (!screens.has(screen)) screens.set(screen, { name: screen, states: [] });
      return screens.get(screen);
    };
    for (const [screen, states] of Object.entries(flow.declared)) {
      for (const state of states) {
        const key = stateKey(screen, state);
        const hit = reached.get(key);
        const reason = flow.notApplicable[key] ?? null;
        ensure(screen).states.push({
          name: state,
          declared: true,
          status: hit ? 'reached' : failing.has(key) ? 'failing' : reason ? 'not-applicable' : 'missing',
          reason,
          shots: hit?.shots ?? [],
        });
      }
    }
    for (const entry of reached.values()) {
      const screen = ensure(entry.screen);
      if (entry.state == null) continue;
      if (screen.states.some((state) => state.name === entry.state)) continue;
      screen.states.push({ name: entry.state, declared: false, status: 'reached', reason: null, shots: entry.shots });
    }
    for (const [key, entry] of failing) {
      if (reached.has(key) || entry.state == null) continue;
      const screen = ensure(entry.screen);
      if (screen.states.some((state) => state.name === entry.state)) continue;
      screen.states.push({ name: entry.state, declared: false, status: 'failing', reason: null, shots: [] });
    }
    flow.screens = [...screens.values()];
  }

  const allScenarios = flows.flatMap((flow) => flow.scenarios);
  const knownIds = new Set(requirements.map((item) => item.id));

  const requirementRows = requirements.map((item) => {
    const covering = allScenarios.filter((scenario) => scenario.covers.includes(item.id));
    let status = 'not-covered';
    if (covering.length) status = covering.every((scenario) => scenario.status === 'passed') ? 'covered' : 'failing';
    return { ...item, status, scenarios: [...new Set(covering.map((scenario) => scenario.title))] };
  });

  const findings = { failedSteps: [], unverified: [], missingStates: [], uncovered: [], unknownIds: [], noSteps: [] };
  for (const flow of flows) {
    for (const scenario of flow.scenarios) {
      if (scenario.steps.length === 0) {
        findings.noSteps.push({ flow: flow.name, scenario: scenario.title, error: scenario.error });
      }
      for (const step of scenario.steps) {
        if (step.status === 'failed') {
          findings.failedSteps.push({
            flow: flow.name,
            scenario: scenario.title,
            viewport: scenario.viewportLabel,
            step: step.title,
            error: step.error,
          });
        }
        if (step.status === 'passed' && step.resolvedKeyword === 'Then' && step.checks === 0) {
          findings.unverified.push({ flow: flow.name, scenario: scenario.title, step: step.title });
        }
      }
      for (const id of scenario.covers) {
        if (!knownIds.has(id)) findings.unknownIds.push({ scenario: scenario.title, id });
      }
    }
    for (const screen of flow.screens) {
      for (const state of screen.states) {
        if (state.status === 'missing') findings.missingStates.push({ flow: flow.name, screen: screen.name, state: state.name });
      }
    }
  }
  findings.uncovered = requirementRows.filter((item) => item.status === 'not-covered').map((item) => item.id);
  // The same Then step can be unverified at several screen sizes. Report it once.
  findings.unverified = findings.unverified.filter(
    (item, index, list) =>
      list.findIndex((other) => other.scenario === item.scenario && other.step === item.step) === index,
  );

  const executed = allScenarios.flatMap((scenario) => scenario.steps);
  const counts = {
    flows: flows.length,
    scenarios: allScenarios.length,
    scenariosPassed: allScenarios.filter((scenario) => scenario.status === 'passed').length,
    steps: executed.length,
    stepsPassed: executed.filter((step) => step.status === 'passed').length,
    stepsFailed: executed.filter((step) => step.status === 'failed').length,
    stepsNotRun: executed.filter((step) => step.status === 'not-run').length,
    requirements: requirementRows.length,
    requirementsCovered: requirementRows.filter((item) => item.status === 'covered').length,
    statesReached: flows.flatMap((flow) => flow.screens.flatMap((screen) => screen.states)).filter((s) => s.status === 'reached').length,
    statesMissing: findings.missingStates.length,
  };

  return {
    meta: {
      title: config.title || 'Design handoff',
      ticket: config.ticket,
      design: config.design,
      data: config.data,
      format: config.format,
      viewports: config.viewports,
      viewportLabels: config.viewports.map(viewportLabel),
      ranAt: results.finishedAt,
    },
    requirements: requirementRows,
    openQuestions,
    assumed,
    flows,
    findings,
    errors: results.errors ?? [],
    counts,
    passed: counts.scenarios > 0 && counts.scenariosPassed === counts.scenarios,
  };
}

/** The findings as short plain text, for the terminal and for Claude to read. */
export function formatFindings(model) {
  const { counts, findings } = model;
  const lines = [];
  lines.push(
    `Run: ${counts.scenariosPassed} of ${counts.scenarios} scenarios passed, ` +
      `${counts.stepsPassed} of ${counts.steps} steps passed.`,
  );

  if (model.errors.length) {
    lines.push('', 'The scenario files could not be loaded:');
    for (const error of model.errors) lines.push(...error.split('\n').map((line) => `  ${line}`));
  }
  if (findings.noSteps.length) {
    lines.push('', 'Scenarios that could not start:');
    for (const item of findings.noSteps) {
      lines.push(`  - ${item.flow} / ${item.scenario}`);
      if (item.error) lines.push(...item.error.split('\n').map((line) => `      ${line}`));
    }
  }
  if (findings.failedSteps.length) {
    lines.push('', 'Failed steps (the prototype does not do what the scenario says):');
    for (const item of findings.failedSteps) {
      lines.push(`  - ${item.flow} / ${item.scenario} (${item.viewport})`);
      lines.push(`    ${item.step}`);
      if (item.error) lines.push(...item.error.split('\n').map((line) => `      ${line}`));
    }
  }
  if (findings.unverified.length) {
    lines.push('', 'Unverified "Then" steps (no check inside the step):');
    for (const item of findings.unverified) lines.push(`  - ${item.scenario}: ${item.step}`);
  }
  if (findings.missingStates.length) {
    lines.push('', 'States never reached (declared, but no step lands on them):');
    for (const item of findings.missingStates) lines.push(`  - ${item.screen}: ${item.state}`);
  }
  const failing = model.requirements.filter((item) => item.status === 'failing');
  if (findings.uncovered.length || failing.length) {
    lines.push('', 'Requirements not proven:');
    for (const id of findings.uncovered) lines.push(`  - ${id}: no scenario covers it`);
    for (const item of failing) lines.push(`  - ${item.id}: a covering scenario fails`);
  }
  if (findings.unknownIds.length) {
    lines.push('', 'Scenarios that name a requirement id that is not in requirements.json:');
    for (const item of findings.unknownIds) lines.push(`  - ${item.scenario}: ${item.id}`);
  }
  const clean =
    !findings.failedSteps.length &&
    !findings.unverified.length &&
    !findings.missingStates.length &&
    !findings.uncovered.length &&
    !failing.length &&
    !findings.unknownIds.length &&
    !findings.noSteps.length &&
    !model.errors.length;
  if (clean) lines.push('', 'No findings.');
  return lines.join('\n');
}
