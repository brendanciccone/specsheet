import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { build } from '../src/build/index.js';
import { slug } from '../src/util.js';

const SAFE = /^[\p{L}\p{M}\p{N}-]+$/u;

test('a short Latin name keeps the slug it always had', () => {
  assert.equal(slug('Contact form'), 'contact-form');
  assert.equal(slug('Desktop'), 'desktop');
  assert.equal(slug('help/contact'), 'help-contact');
});

test('names in other scripts keep their letters, so different names stay different', () => {
  assert.equal(slug('Оплата'), 'оплата');
  assert.equal(slug('Контактная форма'), 'контактная-форма');
  assert.notEqual(slug('お問い合わせ'), slug('支払い'));
  assert.notEqual(slug('Café menu'), slug('Caf menu'));
});

test('names with no letters or digits get different slugs, not one shared fallback', () => {
  assert.match(slug('🚀'), /^item-[0-9a-f]{8}$/);
  assert.notEqual(slug('🚀'), slug('🛒'));
  assert.notEqual(slug(''), slug('!!!'));
  assert.equal(slug('🚀'), slug('🚀'), 'the same name always gets the same slug');
});

test('long names that share a beginning get different slugs, within 60 bytes', () => {
  const start = 'A visitor can send a message with their name, email and text when logged';
  const pairs = [
    [`${start} in`, `${start} out`],
    ['これはとても長いシナリオのタイトルで、六十バイトを超えるように書かれています。一', 'これはとても長いシナリオのタイトルで、六十バイトを超えるように書かれています。二'],
    ['🚀'.repeat(40) + 'a', '🚀'.repeat(40) + 'b'],
  ];
  for (const [a, b] of pairs) {
    assert.notEqual(slug(a), slug(b));
    for (const name of [slug(a), slug(b)]) {
      assert.ok(Buffer.byteLength(name) <= 60, `${name} is ${Buffer.byteLength(name)} bytes`);
      assert.match(name, SAFE);
    }
  }
});

test('flows and scenarios whose names make the same slug never share a file', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'specsheet-names-'));
  try {
    const out = path.join(dir, 'out');
    const viewport = { name: 'Desktop', width: 1440, height: 900 };
    fs.writeFileSync(path.join(dir, 'specsheet.config.json'), JSON.stringify({ title: 'Names', viewports: [viewport], videos: 'scenario' }));
    // A recording or screenshot whose content says whose it is, so an overwrite shows.
    const recording = (name, content) => {
      const file = path.join(out, '.run', name);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, content);
      return path.relative(out, file);
    };
    // "Sign in" and "Sign-in" have always shared a slug. The Cyrillic names all became
    // "item" before letters in other scripts were kept. The Greek ones make slugs that
    // differ only by case, which is one file on macOS and Windows.
    const flows = ['Sign in', 'Sign-in', 'Оплата', 'Доставка', 'ΟΔΟΣ', 'ΟΔΟσ'];
    const titles = ['Отправка', 'Ошибка'];
    const scenarios = flows.flatMap((flow, f) =>
      titles.map((title, t) => ({
        title,
        flow,
        declaredStates: {},
        notApplicable: {},
        covers: [],
        viewport,
        status: 'failed',
        durationMs: 1000,
        error: null,
        video: recording(`video-${f}-${t}.webm`, `video of ${flow} / ${title}`),
        steps: [
          {
            index: 0,
            title: 'Given I start',
            screen: 'start',
            state: 'ready',
            status: 'failed',
            checks: 1,
            error: 'Expected: visible',
            screenshot: recording(`shot-${f}-${t}.png`, `screenshot of ${flow} / ${title}`),
          },
        ],
      })),
    );
    fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify({ finishedAt: '2026-11-17T12:00:00.000Z', errors: [], scenarios }));

    const built = await build(dir, { png: false });

    const features = fs.readdirSync(path.join(out, 'features'));
    assert.equal(features.length, flows.length, `one feature file per flow: ${features.join(', ')}`);
    const folded = (names) => new Set(names.map((name) => name.toUpperCase().toLowerCase())).size;
    assert.equal(folded(features), features.length, 'no two feature files differ only by case');
    assert.equal(folded(fs.readdirSync(path.join(out, 'videos'))), flows.length * titles.length, 'no two videos differ only by case');
    const featureFlows = features.map((name) => /^Feature: (.*)$/m.exec(fs.readFileSync(path.join(out, 'features', name), 'utf8'))[1]);
    assert.deepEqual(featureFlows.sort(), [...flows].sort());

    const contents = (folder, filter) =>
      fs.readdirSync(path.join(out, folder)).filter(filter).map((name) => fs.readFileSync(path.join(out, folder, name), 'utf8'));
    const expected = (kind) => flows.flatMap((flow) => titles.map((title) => `${kind} of ${flow} / ${title}`)).sort();
    assert.deepEqual(contents('videos', () => true).sort(), expected('video'));
    assert.deepEqual(contents('screens', (name) => name.startsWith('failed-')).sort(), expected('screenshot'));

    const listed = built.files.map((file) => file.path);
    assert.equal(new Set(listed).size, listed.length, 'no file is listed twice');
    const attached = JSON.parse(fs.readFileSync(path.join(out, 'manifest.json'), 'utf8')).attachments.map((file) => file.path);
    assert.equal(new Set(attached).size, attached.length, 'no attachment is listed twice');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
