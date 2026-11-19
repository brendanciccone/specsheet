import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';

const read = (file) => JSON.parse(fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'));

test('the plugin, the npm package and its lockfile carry the same name and version', () => {
  const pkg = read('package.json');
  const lock = read('package-lock.json');
  const plugin = read('.claude-plugin/plugin.json');
  const marketplace = read('.claude-plugin/marketplace.json');
  const bump = 'run "npm version <x.y.z> --no-git-tag-version", then set the same version in .claude-plugin/plugin.json';
  assert.equal(lock.version, pkg.version, bump);
  assert.equal(lock.packages[''].version, pkg.version, bump);
  assert.equal(plugin.version, pkg.version, bump);
  assert.equal(plugin.name, pkg.name);
  assert.deepEqual(marketplace.plugins.map((entry) => entry.name), [pkg.name]);
});

test('the skill asks for a program version that exists', () => {
  const skill = fs.readFileSync(new URL('../skills/specsheet/SKILL.md', import.meta.url), 'utf8');
  const needed = /This skill needs Specsheet (\d+)\.(\d+)\.(\d+) or later/.exec(skill);
  assert.ok(needed, 'SKILL.md names the program version it needs, under "Set up the project first"');
  const current = read('package.json').version.split('.').map(Number);
  const asked = needed.slice(1).map(Number);
  const order = asked.map((part, index) => part - current[index]).find((difference) => difference !== 0) ?? 0;
  assert.ok(order <= 0, `the skill asks for ${asked.join('.')}, which is later than this package (${current.join('.')})`);
});
