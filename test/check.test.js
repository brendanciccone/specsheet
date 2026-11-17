import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { formatSizeCheck, parseScenarioSource, sizeCheck } from '../src/check.js';

const SOURCE = `
import { expect, flow, scenario } from 'specsheet';

flow('Checkout', { states: { 'checkout/payment': ['ready', 'declined'], "checkout/done": ["loaded"] } }, () => {
  scenario('Card is declined', { covers: ['R1', "R2"] }, async ({ page, step }) => {
    await step('Given I am on the payment step', { screen: 'checkout/payment', state: 'ready' }, async () => {
      await page.goto('/pay');
    });
    await step("When I pay with a card the bank declines", { screen: 'checkout/payment', state: 'declined' }, async () => {
      await page.getByRole('button', { name: 'Pay now' }).click();
    });
    await step('Then I see why it failed', async () => {
      await expect(page.getByRole('alert')).toContainText("can't be used");
    });
  });
});

scenario('Loose scenario', async ({ step }) => {
  await step('Given something with a \\'quote\\' in it', async () => {});
});
`;

test('reads flows, scenarios, steps and declared states from source text', () => {
  const flows = parseScenarioSource(SOURCE);
  assert.equal(flows.length, 1);
  const [flow] = flows;
  assert.equal(flow.name, 'Checkout');
  assert.deepEqual(flow.states, { 'checkout/payment': ['ready', 'declined'], 'checkout/done': ['loaded'] });
  assert.equal(flow.scenarios.length, 2);

  const [declined, loose] = flow.scenarios;
  assert.equal(declined.title, 'Card is declined');
  assert.deepEqual(declined.covers, ['R1', 'R2']);
  assert.deepEqual(
    declined.steps.map((step) => [step.title, step.screen, step.state]),
    [
      ['Given I am on the payment step', 'checkout/payment', 'ready'],
      ['When I pay with a card the bank declines', 'checkout/payment', 'declined'],
      ['Then I see why it failed', null, null],
    ],
  );
  assert.equal(loose.steps[0].title, "Given something with a 'quote' in it");
});

test('a step does not pick up screen names from inside its own function', () => {
  const flows = parseScenarioSource(`
    flow('F', () => {
      scenario('S', async ({ page, step }) => {
        await step('When I do it', async () => {
          await page.evaluate(() => ({ screen: 'not-a-screen', state: 'nope' }));
        });
      });
    });
  `);
  assert.deepEqual(flows[0].scenarios[0].steps[0], { title: 'When I do it', screen: null, state: null });
});

function handoffFolder({ scenarios = 0, warnAt, requirements = 2 } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'specsheet-test-'));
  fs.writeFileSync(
    path.join(dir, 'specsheet.config.json'),
    JSON.stringify({ title: 'Test', ...(warnAt ? { warnAt } : {}) }),
  );
  fs.writeFileSync(
    path.join(dir, 'requirements.json'),
    JSON.stringify({
      requirements: Array.from({ length: requirements }, (_, index) => ({
        id: `R${index + 1}`,
        text: `Requirement ${index + 1}`,
        source: index === 0 ? 'inferred' : 'stated',
      })),
    }),
  );
  if (scenarios > 0) {
    fs.mkdirSync(path.join(dir, 'scenarios'));
    const body = Array.from(
      { length: scenarios },
      (_, index) => `
        scenario('Scenario ${index + 1}', async ({ step }) => {
          await step('Given screen ${index + 1}', { screen: 'screen-${index + 1}', state: 'ready' }, async () => {});
        });`,
    ).join('\n');
    fs.writeFileSync(path.join(dir, 'scenarios', 'all.scenario.js'), `flow('Flow', () => {${body}\n});`);
  }
  return dir;
}

test('counts a handoff and stays quiet below the threshold', () => {
  const result = sizeCheck(handoffFolder({ scenarios: 3 }));
  assert.equal(result.early, false);
  assert.deepEqual(
    { ...result.counts },
    { requirements: 2, stated: 1, inferred: 1, flows: 1, scenarios: 3, steps: 3, screens: 3, states: 3, viewports: 1 },
  );
  assert.deepEqual(result.warnings, []);
  assert.match(formatSizeCheck(result), /No warning/);
});

test('warns, without blocking, beyond the threshold', () => {
  const result = sizeCheck(handoffFolder({ scenarios: 21 }));
  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0], /21 screens and 21 scenarios/);
  assert.match(formatSizeCheck(result), /WARNING/);
});

test('the threshold can be changed in the config', () => {
  assert.equal(sizeCheck(handoffFolder({ scenarios: 3, warnAt: 2 })).warnings.length, 1);
});

test('the early check uses the screen count Claude found in the design', () => {
  const quiet = sizeCheck(handoffFolder(), { screens: 8 });
  assert.equal(quiet.early, true);
  assert.equal(quiet.counts.screens, 8);
  assert.deepEqual(quiet.warnings, []);

  const loud = sizeCheck(handoffFolder(), { screens: 24 });
  assert.match(loud.warnings[0], /24 screens/);
});

test('the early check says so when there are no requirements to count', () => {
  const result = sizeCheck(handoffFolder({ requirements: 0 }), { screens: 4 });
  assert.ok(result.notes.some((note) => note.includes('screen count alone')));
});
