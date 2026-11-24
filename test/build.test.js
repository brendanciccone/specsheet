import assert from 'node:assert/strict';
import { test } from 'node:test';
import { featureText, gherkinLine } from '../src/build/gherkin.js';
import { buildGraph, layoutGraph, renderFlowSvg, textWidth } from '../src/build/graph.js';
import { commentSections, splitComment } from '../src/build/markdown.js';
import { buildModel, formatFindings } from '../src/build/model.js';
import { keywordOf, resolveKeywords, stripKeyword } from '../src/util.js';

const viewport = { name: 'Desktop', width: 1440, height: 900 };
const config = { title: 'Pay by card', ticket: { key: 'SHOP-7', url: null }, design: { source: 'figma', link: 'https://example.com/file', rebuilt: true }, data: 'mock', format: 'gherkin', viewports: [viewport] };

const step = (title, screen, state, extra = {}) => ({ title, screen, state, status: 'passed', checks: 1, error: null, screenshot: null, ...extra });
const scenario = (title, covers, steps, status = 'passed') => ({
  title,
  flow: 'Checkout',
  declaredStates: { 'checkout/payment': ['ready', 'submitting', 'declined'], 'checkout/done': ['loaded'] },
  notApplicable: {},
  covers,
  viewport,
  status,
  durationMs: 1000,
  error: null,
  video: null,
  steps: steps.map((item, index) => ({ index, ...item })),
});

function results() {
  return {
    finishedAt: '2026-11-15T12:00:00.000Z',
    errors: [],
    scenarios: [
      scenario('Payment succeeds', ['R1'], [
        step('Given I am on the payment step', 'checkout/payment', 'ready'),
        step('When I pay with a valid card', 'checkout/done', 'loaded', { checks: 0 }),
        step('Then I see my order confirmation', 'checkout/done', 'loaded'),
      ]),
      scenario('Card is declined', ['R2', 'R9'], [
        step('Given I am on the payment step', 'checkout/payment', 'ready'),
        step('When I pay with a card the bank declines', 'checkout/payment', 'declined', { checks: 0 }),
        step('Then I see why it failed', 'checkout/payment', 'declined', { status: 'failed', error: 'Expected: visible\nReceived: hidden' }),
      ], 'failed'),
      scenario('Receipt is offered', ['R1'], [
        step('Given I have paid', 'checkout/done', 'loaded'),
        step('Then I can download a receipt', 'checkout/done', 'loaded', { checks: 0 }),
      ]),
    ],
  };
}

const requirements = [
  { id: 'R1', text: 'Pay by card', source: 'stated' },
  { id: 'R2', text: 'Show a clear error when a card is declined', source: 'stated' },
  { id: 'R3', text: 'Email a receipt', source: 'inferred' },
];

const staticFlows = [
  {
    name: 'Checkout',
    states: {},
    scenarios: [
      {
        title: 'Card is declined',
        covers: ['R2'],
        steps: [
          { title: 'Given I am on the payment step', screen: 'checkout/payment', state: 'ready' },
          { title: 'When I pay with a card the bank declines', screen: 'checkout/payment', state: 'declined' },
          { title: 'Then I see why it failed', screen: 'checkout/payment', state: 'declined' },
          { title: 'And I can try another card', screen: 'checkout/payment', state: 'declined' },
        ],
      },
    ],
  },
];

const model = () => buildModel({ results: results(), config, requirements, openQuestions: ['Is a receipt needed?'], staticFlows });

test('step keywords', () => {
  assert.equal(keywordOf('Given I am here'), 'Given');
  assert.equal(keywordOf('then it works'), 'Then');
  assert.equal(keywordOf('I do a thing'), 'And');
  assert.equal(stripKeyword('When I send the form'), 'I send the form');
  assert.deepEqual(resolveKeywords(['Given a', 'And b', 'When c', 'Then d', 'But e']), ['Given', 'Given', 'When', 'Then', 'Then']);
  assert.equal(gherkinLine('I do a thing'), 'And I do a thing');
});

test('requirements are covered, failing or not covered', () => {
  const status = Object.fromEntries(model().requirements.map((item) => [item.id, item.status]));
  assert.deepEqual(status, { R1: 'covered', R2: 'failing', R3: 'not-covered' });
});

test('findings: failed steps, unverified Then steps, missing states, unknown ids', () => {
  const { findings } = model();
  assert.equal(findings.failedSteps.length, 1);
  assert.equal(findings.failedSteps[0].step, 'Then I see why it failed');
  assert.deepEqual(findings.unverified.map((item) => item.step), ['Then I can download a receipt']);
  assert.deepEqual(findings.missingStates.map((item) => item.state), ['submitting']);
  assert.deepEqual(findings.uncovered, ['R3']);
  assert.deepEqual(findings.unknownIds, [{ scenario: 'Card is declined', id: 'R9' }]);

  const text = formatFindings(model());
  assert.match(text, /2 of 3 scenarios passed/);
  assert.match(text, /States never reached/);
});

test('a state only counts as shown when the steps that land on it pass', () => {
  const states = Object.fromEntries(
    model().flows[0].screens.flatMap((screen) => screen.states.map((state) => [`${screen.name}/${state.name}`, state.status])),
  );
  assert.deepEqual(states, {
    'checkout/payment/ready': 'reached',
    'checkout/payment/submitting': 'missing',
    'checkout/payment/declined': 'failing',
    'checkout/done/loaded': 'reached',
  });
});

test('steps that never ran after a failure are added from the source text', () => {
  const declined = model().flows[0].scenarios[1];
  assert.deepEqual(declined.steps.map((item) => item.status), ['passed', 'passed', 'failed', 'not-run']);
  assert.equal(declined.steps[3].title, 'And I can try another card');
});

test('feature file has tags, scenarios and steps', () => {
  const text = featureText(model().flows[0], { title: 'Pay by card', ticketKey: 'SHOP-7' });
  assert.match(text, /^Feature: Checkout\n {2}SHOP-7: Pay by card\n/);
  assert.match(text, /@R2 @R9\n {2}Scenario: Card is declined\n {4}Given I am on the payment step/);
  assert.match(text, /And I can try another card/);
});

test('user flow: one node per screen and state, one arrow per action', () => {
  const graph = buildGraph(model().flows[0], 'Desktop');
  assert.deepEqual(graph.starts, ['checkout/payment/ready', 'checkout/done/loaded']);
  assert.deepEqual(
    graph.edges.map((edge) => [edge.from, edge.to, edge.label, edge.main]),
    [['checkout/payment/ready', 'checkout/done/loaded', 'I pay with a valid card', true]],
  );
  const missing = graph.nodes.filter((node) => node.missing).map((node) => node.id);
  assert.deepEqual(missing.sort(), ['checkout/payment/declined', 'checkout/payment/submitting']);

  const layout = layoutGraph(graph);
  for (const node of graph.nodes) assert.ok(layout.positions.has(node.id));
  const svg = renderFlowSvg(model());
  assert.match(svg, /^<svg /);
  assert.match(svg, /I pay with a valid/);
});

// A flow with branches inside a screen, a way back, and a change nobody asked for.
function branching() {
  const run = (title, steps) => scenario(title, [], steps.map(([text, screen, state]) => step(text, screen, state)));
  const cart = ['Given I have items in my cart', 'cart', 'ready'];
  const toPay = ['When I check out', 'pay', 'ready'];
  const raw = {
    finishedAt: '2026-11-15T12:00:00.000Z',
    errors: [],
    scenarios: [
      run('Order is placed', [cart, toPay, ['When I pay with a valid card', 'pay', 'sending'], ['Then I see my order number', 'done', 'ready']]),
      run('Card is declined', [cart, toPay, ['When I pay with a bad card', 'pay', 'declined'], ['When I try again', 'pay', 'ready']]),
      run('Back to the cart', [cart, toPay, ['When I go back', 'cart', 'ready']]),
      run('Promo code', [cart, ['When I apply a code', 'cart', 'promo'], ['When I skip to the end', 'done', 'ready']]),
    ].map((item) => ({ ...item, declaredStates: {} })),
  };
  return buildModel({ results: raw, config, requirements: [], openQuestions: [] }).flows[0];
}

test('user flow: a change with no new action is labelled as automatic, not with the last action', () => {
  const graph = buildGraph(branching(), 'Desktop');
  const labels = Object.fromEntries(graph.edges.map((edge) => [`${edge.from} > ${edge.to}`, edge.label]));
  assert.equal(labels['pay/ready > pay/sending'], 'I pay with a valid card');
  assert.equal(labels['pay/sending > done/ready'], 'Automatically');
});

test('user flow: the main path is the scenario that goes through the most screens', () => {
  const graph = buildGraph(branching(), 'Desktop');
  assert.deepEqual(graph.mainPath, ['cart/ready', 'pay/ready', 'pay/sending', 'done/ready']);
  assert.deepEqual(graph.edges.filter((edge) => edge.main).map((edge) => edge.label), ['I check out', 'I pay with a valid card', 'Automatically']);
});

test('user flow: one lane per screen, states branch below, and nothing is drawn backwards', () => {
  const graph = buildGraph(branching(), 'Desktop');
  const layout = layoutGraph(graph);
  assert.deepEqual(layout.bands.map((band) => band.screen), ['cart', 'pay', 'done']);

  const at = (id) => layout.positions.get(id);
  // States of one screen share a lane. A state reached from another sits below it, indented.
  assert.equal(at('pay/sending').lane, at('pay/ready').lane);
  assert.ok(at('pay/sending').x > at('pay/ready').x && at('pay/sending').y > at('pay/ready').y);
  assert.ok(at('pay/declined').y > at('pay/sending').y, 'the main path comes first');
  assert.deepEqual(layout.tree.map((pair) => `${pair.from} > ${pair.to}`).sort(), ['cart/ready > cart/promo', 'pay/ready > pay/declined', 'pay/ready > pay/sending']);

  // Arrows between lanes only go forward. One that passes over a screen is routed above it.
  for (const pair of layout.forward) assert.ok(at(pair.to).lane > at(pair.from).lane);
  assert.deepEqual(layout.skips.map((pair) => `${pair.from} > ${pair.to}`), ['cart/promo > done/ready']);

  // Going back is text under the state it starts from.
  assert.deepEqual(layout.chips.get('pay/declined'), [['↩ I try again → ready']]);
  assert.deepEqual(layout.chips.get('pay/ready'), [['↩ I go back → cart · ready']]);
  const svg = renderFlowSvg({ meta: { title: 'T', viewports: [viewport] }, flows: [branching()] });
  assert.match(svg, /I go back → cart · ready/);
});

test('user flow: a decision is drawn once, with a branch per answer', () => {
  const ask = (answer) => ({ decision: 'Does the bank accept the card?', answer });
  const raw = {
    finishedAt: '2026-11-15T12:00:00.000Z',
    errors: [],
    scenarios: [
      scenario('Paid', [], [step('Given I am paying', 'pay', 'ready'), step('When I pay with a valid card', 'done', 'ready', ask('Yes'))]),
      scenario('Declined', [], [step('Given I am paying', 'pay', 'ready'), step('When I pay with a bad card', 'pay', 'declined', ask('No'))]),
      scenario('Cancelled', [], [step('Given I am paying', 'pay', 'ready'), step('When I open help', 'pay', 'help'), step('When I close it', 'pay', 'ready', ask('Closed'))]),
    ].map((item) => ({ ...item, declaredStates: {} })),
  };
  const flow = buildModel({ results: raw, config, requirements: [], openQuestions: [] }).flows[0];
  const graph = buildGraph(flow, 'Desktop');
  assert.deepEqual(graph.edges.find((edge) => edge.to === 'pay/declined').decision, { question: 'Does the bank accept the card?', answer: 'No' });

  const layout = layoutGraph(graph, viewport);
  assert.equal(layout.decisions.length, 2);
  const bank = layout.decisions.find((decision) => decision.from === 'pay/ready');
  assert.deepEqual(bank.branches.map((branch) => [branch.answer, branch.kind]), [['Yes', 'forward'], ['No', 'state']]);
  // The question sits below the state it is asked on, and above the state an answer leads to.
  assert.ok(bank.y > layout.positions.get('pay/ready').y && bank.y < layout.positions.get('pay/declined').y);
  // An answer that goes back is text, like any other way back.
  assert.deepEqual(layout.decisions.find((decision) => decision.from === 'pay/help').branches.map((branch) => [branch.answer, branch.kind, branch.back]), [['Closed', 'back', 'ready']]);

  const svg = renderFlowSvg({ meta: { title: 'T', viewports: [viewport] }, flows: [flow] });
  assert.equal((svg.match(/class="decision-text">Does the bank accept the card\?</g) ?? []).length, 2);
  assert.match(svg, />No</);
});

test('user flow: a preview has the shape of its own screenshot', async () => {
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'specsheet-shape-'));
  try {
    // Only the size in a PNG's header is read, so a header is enough.
    const png = (name, width, height) => {
      const head = Buffer.alloc(24);
      head.write('\x89PNG\r\n\x1a\n', 0, 'latin1');
      head.writeUInt32BE(13, 8);
      head.write('IHDR', 12, 'ascii');
      head.writeUInt32BE(width, 16);
      head.writeUInt32BE(height, 20);
      const file = path.join(dir, name);
      fs.writeFileSync(file, head);
      return file;
    };
    const graph = buildGraph(branching(), 'Desktop');
    const node = (id) => graph.nodes.find((item) => item.id === id);
    node('cart/ready').shot = png('page.png', 1440, 900);
    node('pay/ready').shot = png('dialog.png', 1440, 480);
    node('done/ready').shot = png('long.png', 1440, 6000);

    const desktop = layoutGraph(graph, { width: 1440, height: 900 });
    const size = (id) => desktop.sizes.get(id);
    assert.equal(desktop.boxWidth, 250);
    assert.equal(size('cart/ready').thumb, Math.round((230 * 900) / 1440));
    assert.ok(size('pay/ready').thumb < size('cart/ready').thumb, 'a short screenshot gets a short box');
    assert.equal(size('done/ready').thumb, 276, 'a very long page stops at a limit');
    assert.equal(size('done/ready').cut, true);
    assert.equal(size('cart/ready').cut, false);
    // No screenshot: the proportions of the screen size.
    assert.equal(size('cart/promo').thumb, size('cart/ready').thumb);
    // States below a tall box start below it.
    assert.ok(desktop.positions.get('pay/sending').y >= desktop.positions.get('pay/ready').y + size('pay/ready').height);

    const phone = layoutGraph(graph, { width: 390, height: 844 });
    assert.equal(phone.boxWidth, 190, 'a phone screen gets a narrower box');
    assert.ok(phone.sizes.get('cart/promo').thumb > 300, 'and a taller one');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('user flow: the words of a label are centred in a box that fits them', () => {
  assert.ok(textWidth('Will it fit', 14) < textWidth('WILL IT FIT', 14), 'capitals are wider');
  assert.ok(textWidth('illicit', 14) < textWidth('mammoth', 14), 'narrow letters are narrower');
  assert.ok(textWidth('Yes', 14, true) > textWidth('Yes', 14), 'bold is wider');

  const svg = renderFlowSvg({ meta: { title: 'T', viewports: [viewport] }, flows: [branching()] });
  const labels = [...svg.matchAll(/<g class="flow-label" data-pad="(\d+)"[^>]*><rect x="([\d.]+)" y="[\d.]+" width="([\d.]+)"[^>]*\/>(.*?)<\/g>/g)];
  assert.ok(labels.length >= 5);
  for (const [, pad, x, width, inside] of labels) {
    const lines = [...inside.matchAll(/<text x="([\d.]+)"[^>]*text-anchor="middle"[^>]*>([^<]*)<\/text>/g)];
    assert.ok(lines.length >= 1);
    for (const [, textX, words] of lines) {
      assert.ok(Math.abs(Number(textX) - (Number(x) + Number(width) / 2)) < 0.01, `"${words}" sits in the middle of its box`);
      assert.ok(textWidth(words, 14) + 2 * Number(pad) <= Number(width) + 1, `"${words}" fits its box with room either side`);
    }
  }
});

test('user flow: each flow gets its own drawing', () => {
  const first = branching();
  const second = { ...branching(), name: 'Returns' };
  const svg = renderFlowSvg({ meta: { title: 'T', viewports: [viewport] }, flows: [first, second] });
  assert.match(svg, /class="flow-name">Checkout</);
  assert.match(svg, /class="flow-name">Returns</);
  const ids = svg.match(/clipPath id="[^"]+"/g) ?? [];
  assert.equal(new Set(ids).size, ids.length);
});

test('the page folds passing scenarios once there are many, and lists them in the contents', async () => {
  const { FOLD_ABOVE, renderPage } = await import('../src/build/page.js');
  const few = renderPage(model(), { flowImage: null });
  assert.equal((few.match(/<details open>/g) ?? []).length, 3, 'a short page shows every scenario');
  assert.match(few, /<nav class="toc no-copy"/);
  assert.match(few, /<a href="#flow-0-scenario-1"><span class="mark bad"/);
  assert.match(few, /<td><a href="#flow-0-scenario-0">1\. Payment succeeds<\/a>/);
  assert.match(few, /<h3><span class="scenario-number">2\.<\/span> Card is declined<\/h3>/);

  const raw = results();
  for (let index = 0; index < FOLD_ABOVE; index += 1) {
    raw.scenarios.push(scenario(`Extra ${index}`, [], [step('Given I am on the payment step', 'checkout/payment', 'ready')]));
  }
  const many = renderPage(buildModel({ results: raw, config, requirements, openQuestions: [], staticFlows }), { flowImage: null });
  assert.equal((many.match(/<article class="scenario"/g) ?? []).length, 3 + FOLD_ABOVE);
  assert.equal((many.match(/<details open>/g) ?? []).length, 1, 'only the failing scenario is open');
  assert.match(many, /<details class="fold">/);
});

test('scenarios are numbered within their flow, once per scenario', () => {
  const raw = results();
  raw.scenarios.push({ ...raw.scenarios[0], viewport: { name: 'Phone', width: 390, height: 844 } });
  const built = buildModel({ results: raw, config, requirements, openQuestions: [], staticFlows });
  assert.deepEqual(built.flows[0].scenarios.map((item) => item.number), [1, 2, 3, 1]);
  assert.deepEqual(built.requirements[0].scenarios, ['1. Payment succeeds', '3. Receipt is offered']);
});

test('states are listed one screen to a row', async () => {
  const { statesMarkdown } = await import('../src/build/markdown.js');
  assert.equal(
    statesMarkdown(model()),
    ['| Screen | Shown | Missing |', '|---|---|---|', '| checkout/payment | ready | submitting: not shown; declined: failing |', '| checkout/done | loaded | None |'].join('\n'),
  );
});

test('the video: a caption leads its step, and screenshot moments are cut', async () => {
  const { leadTime } = await import('../src/index.js');
  const { shotCuts } = await import('../src/build/index.js');
  assert.equal(leadTime('Then I see it', 700), 700);
  assert.equal(leadTime('When I send a message with my name, email and text', 700), 350 + 22 * 50);
  assert.equal(leadTime('x'.repeat(300), 700), 1800);
  // Two screenshots close together become one cut. Steps with no full-page screenshot have none.
  assert.deepEqual(shotCuts([{ shotAt: [4000, 4300] }, {}, { shotAt: [4600, 4900] }, { shotAt: [9000, 9200] }]), [[3.8, 5.35], [8.8, 9.65]]);
  assert.deepEqual(shotCuts([]), []);
});

test('assumed standard behaviour is listed once, and only when there is some', async () => {
  const { renderPage } = await import('../src/build/page.js');
  const without = model();
  assert.doesNotMatch(commentSections(without, []).join('\n'), /Assumed standard behaviour/);
  assert.doesNotMatch(renderPage(without, { flowImage: null }), /id="assumed"/);

  const built = buildModel({ results: results(), config, requirements, openQuestions: [], assumed: ['Dialogs close on Escape.'], staticFlows });
  assert.match(commentSections(built, []).join('\n'), /### Assumed standard behaviour\n\n[^\n]+\n\n- Dialogs close on Escape\./);
  assert.match(renderPage(built, { flowImage: null }), /<section id="assumed"[\s\S]*<li>Dialogs close on Escape\.<\/li>/);
});

test('the comment says which source is the truth when a design was rebuilt', () => {
  const text = commentSections(model(), []).join('\n\n');
  assert.match(text, /The prototype was rebuilt from the Figma design/);
  assert.match(text, /\| R3 \| Email a receipt \| Inferred from design \| Not covered \| None \|/);
  assert.match(text, /1\. Is a receipt needed\?/);
});

test('a long comment is split into parts that each fit the limit', () => {
  const sections = ['## Title\n\nIntro', `### Big\n\n${'line of text\n'.repeat(300)}`, '### End\n\nDone'];
  const parts = splitComment(sections, 1000);
  assert.ok(parts.length > 1);
  for (const part of parts) assert.ok(part.length <= 1000, `part is ${part.length} characters`);
  assert.match(parts[0], /^_Part 1 of \d+_/);
  assert.equal(splitComment(['short'], 1000).length, 1);
  assert.doesNotMatch(splitComment(['short'], 1000)[0], /Part 1/);
});

test('videos go inside the page while they fit, and stay out once it is full', async () => {
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const { EMBED_VIDEO_LIMIT, renderPage } = await import('../src/build/page.js');

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'specsheet-video-'));
  try {
    const built = model();
    const scenarios = built.flows.flatMap((flow) => flow.scenarios);
    assert.ok(scenarios.length >= 2);
    // The first fits. The second would take the page past the limit.
    const sizes = [1024, EMBED_VIDEO_LIMIT];
    scenarios.slice(0, 2).forEach((scenario, index) => {
      scenario.videoFile = `videos/video-${index}.mp4`;
      scenario.videoPath = path.join(dir, `video-${index}.mp4`);
      fs.writeFileSync(scenario.videoPath, Buffer.alloc(sizes[index], 1));
    });

    const html = renderPage(built, { flowImage: null });
    const players = html.match(/<video [^>]*>/g) ?? [];
    assert.equal(players.length, 2);
    assert.match(players[0], /src="data:video\/mp4;base64,/);
    assert.match(players[1], /src="videos\/video-1\.mp4"/);
    assert.ok(html.length < EMBED_VIDEO_LIMIT, 'the large video is not in the page');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a flow video gets a player, and each scenario a link to its start', async () => {
  const { renderPage } = await import('../src/build/page.js');
  const { scenariosMarkdown } = await import('../src/build/markdown.js');
  const built = model();
  const flow = built.flows[0];
  flow.videos = [{ file: 'videos/flow.desktop.mp4', path: '/nowhere/flow.mp4', viewportLabel: 'Desktop', seconds: 75 }];
  flow.scenarios.forEach((scenario, index) => {
    scenario.chapter = { file: 'videos/flow.desktop.mp4', index: 0, start: index * 65.4 };
  });

  const html = renderPage(built, { flowImage: null });
  assert.equal((html.match(/<video /g) ?? []).length, 1);
  assert.match(html, /id="flow-0-video-0"[^>]*src="videos\/flow\.desktop\.mp4"/);
  assert.match(html, /href="videos\/flow\.desktop\.mp4#t=65" data-video="flow-0-video-0" data-start="65\.40">In the video at 1:05</);

  const text = scenariosMarkdown(flow, built);
  assert.match(text, /Walkthrough video \(Desktop\): videos\/flow\.desktop\.mp4\n- 0:00 /);
  assert.match(text, /\n- 1:05 /);
});

test('the videos setting accepts flow, scenario and none only', async () => {
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const { loadConfig } = await import('../src/config.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'specsheet-config-'));
  try {
    const write = (value) => fs.writeFileSync(path.join(dir, 'specsheet.config.json'), JSON.stringify(value));
    write({});
    assert.equal(loadConfig(dir).videos, 'flow');
    write({ videos: 'scenario' });
    assert.equal(loadConfig(dir).videos, 'scenario');
    write({ videos: 'all' });
    assert.throws(() => loadConfig(dir), /"videos" must be one of flow, scenario, none/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a caption stays up long enough to read, and never less than the pace', async () => {
  // The helper needs Playwright loaded, which is fine here: nothing is launched.
  const { readingTime } = await import('../src/index.js');
  assert.equal(readingTime('Then I see it', 3000), 3000);
  assert.equal(readingTime('Given I am on the Help page', 700), 700 + 45 * 27);
  assert.equal(readingTime('x'.repeat(200), 700), 4000);
});
