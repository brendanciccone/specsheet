import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { build } from '../src/build/index.js';
import { featureText, sharedStart } from '../src/build/gherkin.js';
import { checklistLines } from '../src/build/markdown.js';

const scenario = (title, steps) => ({ title, covers: [], steps: steps.map((step) => ({ title: step })) });

test('steps every scenario opens with go in a Background, said once', () => {
  const flow = {
    name: 'Contact form',
    scenarios: [
      scenario('Message is sent', ['Given I am on the Help page', 'When I send a message', 'Then I see it was sent']),
      scenario('Invalid email is rejected', ['Given I am on the Help page', 'When I send a bad email', 'Then I see an error']),
    ],
  };
  const text = featureText(flow);
  assert.match(text, /\n {2}Background:\n {4}Given I am on the Help page\n/);
  assert.equal(text.match(/Given I am on the Help page/g).length, 1);
  assert.match(text, /Scenario: Message is sent\n {4}When I send a message\n/);
});

test('a Background takes only the opening Given steps that every scenario shares', () => {
  const opening = 'Given I am on the Help page';
  // One scenario opens differently: no Background.
  assert.deepEqual(sharedStart([scenario('A', [opening, 'When a']), scenario('B', ['Given I am signed in', 'When b'])]), []);
  // One scenario only: nothing to share.
  assert.deepEqual(sharedStart([scenario('A', [opening, 'When a'])]), []);
  // Every scenario keeps at least one step of its own.
  assert.deepEqual(sharedStart([scenario('A', [opening]), scenario('B', [opening])]), []);
  // A When step is never moved, even when every scenario has the same one.
  assert.deepEqual(sharedStart([scenario('A', [opening, 'When I open the form', 'Then a']), scenario('B', [opening, 'When I open the form', 'Then b'])]), [opening]);
});

test('a scenario left starting with "And" takes the keyword it continues', () => {
  const flow = {
    name: 'Account',
    scenarios: [
      scenario('Signed in', ['Given I am on the Help page', 'And I am signed in', 'Then I see my name']),
      scenario('Signed out', ['Given I am on the Help page', 'And I am signed out', 'Then I see a sign-in link']),
    ],
  };
  const text = featureText(flow);
  assert.match(text, /Scenario: Signed in\n {4}Given I am signed in\n {4}Then I see my name/);
  assert.doesNotMatch(text, /Scenario: Signed in\n {4}And/);
});

test('the checklist says the shared opening once too', () => {
  const lines = checklistLines({
    scenarios: [
      scenario('Message is sent', ['Given I am on the Help page', 'When I send a message']),
      scenario('Sending fails', ['Given I am on the Help page', 'When the server is down']),
    ],
  });
  assert.deepEqual(lines.slice(0, 3), ['Every scenario starts with:', '- Given I am on the Help page', '']);
  assert.equal(lines.filter((line) => line.includes('Help page')).length, 1);
});

test('the handoff page shows each screenshot once, and points back to it after that', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'specsheet-repeat-'));
  try {
    const out = path.join(dir, 'out');
    const viewport = { name: 'Desktop', width: 1440, height: 900 };
    fs.writeFileSync(path.join(dir, 'specsheet.config.json'), JSON.stringify({ title: 'Contact form', viewports: [viewport], videos: 'none' }));
    let shots = 0;
    const screenshot = () => {
      shots += 1;
      const file = path.join(out, '.run', `shot-${shots}.png`);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, `picture ${shots}`);
      return path.relative(out, file);
    };
    const step = (title, state, status = 'passed') => ({ title, screen: 'help/contact', state, status, checks: 1, error: status === 'failed' ? 'Expected: visible' : null, screenshot: screenshot() });
    const run = (title, end, status = 'passed') => ({
      title,
      flow: 'Contact form',
      declaredStates: {},
      notApplicable: {},
      covers: [],
      viewport,
      status,
      durationMs: 1000,
      error: null,
      video: null,
      steps: [step('Given I am on the Help page', 'ready'), step(`Then I see the ${end} state`, end, status)].map((item, index) => ({ index, ...item })),
    });
    // Three scenarios that all start on the same page. The last one fails at its end.
    const scenarios = [run('Message is sent', 'sent'), run('Invalid email is rejected', 'invalid-email'), run('Sending fails', 'send-failed', 'failed')];
    fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify({ finishedAt: '2026-11-17T12:00:00.000Z', errors: [], scenarios }));

    await build(dir, { png: false });
    const html = fs.readFileSync(path.join(out, 'handoff.html'), 'utf8');

    const figures = [...html.matchAll(/<figure id="(shot-\d+)" data-file="([^"]+)"/g)];
    const files = figures.map((match) => match[2]);
    assert.equal(new Set(files).size, files.length, 'no screenshot is shown twice');
    const ready = files.find((file) => file.includes('ready'));
    const references = [...html.matchAll(/<p class="same-shot" data-file="([^"]+)">Same screen as <a href="#(shot-\d+)">step 1 of "Message is sent"<\/a>/g)];
    assert.equal(references.length, 2, 'the two later scenarios point back to the first one');
    for (const reference of references) {
      assert.equal(reference[1], ready);
      assert.equal(reference[2], figures.find((match) => match[2] === ready)[1]);
    }
    assert.ok(files.some((file) => file.startsWith('screens/failed-')), 'the failed step still shows its own screenshot');

    const feature = fs.readFileSync(path.join(out, 'features', 'contact-form.feature'), 'utf8');
    assert.match(feature, /Background:\n {4}Given I am on the Help page/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
