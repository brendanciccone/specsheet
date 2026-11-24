import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { formatSizeCheck, parseScenarioSource, questionNotes, sizeCheck } from '../src/check.js';
import { loadRequirements } from '../src/config.js';

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
    { requirements: 2, stated: 1, inferred: 1, flows: 1, scenarios: 3, steps: 3, screens: 3, states: 3, viewports: 1, openQuestions: 0 },
  );
  assert.deepEqual(result.warnings, []);
  assert.match(formatSizeCheck(result), /No warning\. A split is recommended above 12 scenarios or 8 screens\.$/);
  assert.match(formatSizeCheck(sizeCheck(handoffFolder(), { screens: 2 })), /or 8 requirements before scenarios are written\.$/);
});

test('recommends a split, without blocking, beyond the thresholds', () => {
  assert.deepEqual(sizeCheck(handoffFolder({ scenarios: 8 })).warnings, []);

  const screens = sizeCheck(handoffFolder({ scenarios: 9 }));
  assert.match(screens.warnings[0], /^This story covers 9 screens\./);

  const result = sizeCheck(handoffFolder({ scenarios: 13 }));
  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0], /13 scenarios and 13 screens/);
  assert.match(result.warnings[0], /Splitting it into smaller stories is recommended/);
  assert.match(formatSizeCheck(result), /WARNING/);
});

test('the thresholds can be changed in the config, together or one at a time', () => {
  const handoffNull = handoffFolder({ scenarios: 1 });
  assert.equal(sizeCheck(handoffFolder({ scenarios: 3, warnAt: 2 })).warnings.length, 1);
  assert.deepEqual(sizeCheck(handoffFolder({ scenarios: 13, warnAt: 20 })).warnings, []);
  const result = sizeCheck(handoffFolder({ scenarios: 9, warnAt: { screens: 30 } }));
  assert.deepEqual(result.warnings, []);
  assert.deepEqual(result.limits, { scenarios: 12, screens: 30, requirements: 8 });
  assert.throws(() => sizeCheck(handoffFolder({ warnAt: { pages: 3 } })), /"warnAt" takes a number/);
  // null means the usual limits, as leaving it out does.
  fs.writeFileSync(path.join(handoffNull, 'specsheet.config.json'), JSON.stringify({ title: 'Test', warnAt: null }));
  assert.deepEqual(sizeCheck(handoffNull).limits, { scenarios: 12, screens: 8, requirements: 8 });
  for (const bad of [true, 'twelve', [12], { toString: 1 }, { scenarios: 0 }]) {
    assert.throws(() => sizeCheck(handoffFolder({ warnAt: bad })), /"warnAt" takes a number/, JSON.stringify(bad));
  }
});

test('a warning says where the story could be split', () => {
  const dir = handoffFolder({ scenarios: 0, requirements: 2 });
  fs.mkdirSync(path.join(dir, 'scenarios'));
  const body = (count, covers) =>
    Array.from({ length: count }, (_, index) => `scenario('S${covers}${index}', { covers: ['${covers}'] }, async ({ step }) => {
      await step('Given a', { screen: 'a', state: 'ready' }, async () => {});
    });`).join('\n');
  fs.writeFileSync(path.join(dir, 'scenarios', 'a.scenario.js'), `flow('Sign in', () => {${body(9, 'R1')}});\nflow('Reset password', () => {${body(5, 'R2')}});`);
  const text = formatSizeCheck(sizeCheck(dir));
  assert.match(text, /It could be split by flow: "Sign in" \(9 scenarios\), "Reset password" \(5 scenarios\)\./);
  assert.match(text, /Most scenarios go to: R1 \(9\), R2 \(5\)\./);
});

test('the early check recommends a split on requirements alone', () => {
  assert.deepEqual(sizeCheck(handoffFolder({ requirements: 8 }), { screens: 3 }).warnings, []);
  const result = sizeCheck(handoffFolder({ requirements: 9 }), { screens: 3 });
  assert.match(result.warnings[0], /9 requirements/);
  assert.match(formatSizeCheck(result), /Group the requirements by the screen or the goal/);
});

test('the early check uses the screen count Claude found in the design', () => {
  const quiet = sizeCheck(handoffFolder(), { screens: 8 });
  assert.equal(quiet.early, true);
  assert.equal(quiet.counts.screens, 8);
  assert.deepEqual(quiet.warnings, []);

  const loud = sizeCheck(handoffFolder(), { screens: 9 });
  assert.match(loud.warnings[0], /9 screens/);
});

test('the early check says so when there are no requirements to count', () => {
  const result = sizeCheck(handoffFolder({ requirements: 0 }), { screens: 4 });
  assert.ok(result.notes.some((note) => note.includes('screen count alone')));
});

test('an open question has to be one a person can answer', () => {
  const dir = handoffFolder({ scenarios: 1 });
  const file = path.join(dir, 'requirements.json');
  const write = (openQuestions) => fs.writeFileSync(file, JSON.stringify({ requirements: [{ id: 'R1', text: 'Pay by card', note: ' Cards only. ' }], openQuestions }));

  write([{ question: 'Is a receipt emailed?', who: 'Product', default: 'No receipt is sent.' }]);
  const good = sizeCheck(dir);
  assert.equal(good.counts.openQuestions, 1);
  assert.deepEqual(good.notes, []);
  assert.match(formatSizeCheck(good), /\n  1 open question\n/);
  // A note on a requirement is kept, trimmed.
  assert.equal(loadRequirements(dir).requirements[0].note, 'Cards only.');

  // A plain line is still read, and the check says what it lacks.
  write(['No loading state is designed.', { question: 'Is a receipt emailed?', who: 'Product' }]);
  const notes = sizeCheck(dir).notes;
  assert.ok(notes.some((note) => /^Open question 1: not written as a question/.test(note)), notes.join('\n'));
  assert.ok(notes.some((note) => /^Open question 1: missing "who"/.test(note)));
  assert.ok(notes.some((note) => /^Open questions 1, 2: missing "default"/.test(note)));

  write([{ who: 'Product' }]);
  assert.throws(() => sizeCheck(dir), /open question 1 needs a "question"/);
});

test('many open questions are called out, with where the rest belong', () => {
  const ask = (count) => Array.from({ length: count }, (_, index) => ({ question: `Question ${index + 1}?`, who: 'Design', default: 'As drawn.' }));
  assert.deepEqual(questionNotes(ask(5)), []);
  const [note] = questionNotes(ask(6));
  assert.match(note, /^6 open questions is a lot/);
  assert.match(note, /"note".*"assumed".*designer/);
});
