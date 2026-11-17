import fs from 'node:fs';
import path from 'node:path';

const KEYWORDS = ['Given', 'When', 'Then', 'And', 'But'];

/** "Given I am on the Help page" -> "Given". Steps without a keyword count as "And". */
export function keywordOf(title) {
  const first = String(title).trim().split(/\s+/)[0] ?? '';
  const match = KEYWORDS.find((k) => k.toLowerCase() === first.toLowerCase());
  return match ?? 'And';
}

/** "When I send the form" -> "I send the form". */
export function stripKeyword(title) {
  const text = String(title).trim();
  const first = text.split(/\s+/)[0] ?? '';
  return KEYWORDS.some((k) => k.toLowerCase() === first.toLowerCase())
    ? text.slice(first.length).trim()
    : text;
}

/** Given/When/Then for a step, resolving And/But to the keyword they continue. */
export function resolveKeywords(titles) {
  let current = 'Given';
  return titles.map((title) => {
    const keyword = keywordOf(title);
    if (keyword !== 'And' && keyword !== 'But') current = keyword;
    return current;
  });
}

export function slug(text) {
  return (
    String(text)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'item'
  );
}

export function escapeHtml(text) {
  return String(text ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

/** Escape the characters that would change meaning inside a Markdown table cell or line. */
export function escapeMarkdown(text) {
  return String(text ?? '').replace(/([|\\`*_])/g, '\\$1').replace(/\n/g, ' ');
}

export function readJson(file, fallback = undefined) {
  if (!fs.existsSync(file)) {
    if (fallback !== undefined) return fallback;
    throw new Error(`Missing file: ${file}`);
  }
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    throw new Error(`Could not read ${file}: ${error.message}`);
  }
}

export function writeFile(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

export function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function plural(count, singular, pluralForm = `${singular}s`) {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

/** "Desktop, 1440 × 900" */
export function viewportLabel(viewport) {
  if (!viewport) return '';
  return `${viewport.name}, ${viewport.width} × ${viewport.height}`;
}

/** Strip terminal colour codes and Playwright's call log from an error message. */
export function cleanError(message) {
  if (!message) return null;
  const text = String(message)
    // eslint-disable-next-line no-control-regex
    .replace(/\u001b\[[0-9;]*m/g, '')
    .split('\nCall log:')[0]
    .trim();
  const lines = text.split('\n').map((line) => line.trimEnd()).filter(Boolean);
  return lines.slice(0, 6).join('\n');
}

/** Seconds as minutes and seconds, for example 1:05. */
export function clock(seconds) {
  const whole = Math.floor(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}
