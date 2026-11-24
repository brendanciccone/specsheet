import { createHash } from 'node:crypto';
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

/** Eight hex characters that stay the same for the same text, to tell names apart. */
export function fingerprint(text) {
  return createHash('sha256').update(String(text).normalize('NFC')).digest('hex').slice(0, 8);
}

const SLUG_BYTES = 60;

/**
 * A name for a file: "Contact form" -> "contact-form". Letters in any script are kept, so
 * "Оплата" stays "оплата" instead of disappearing. A name that is cut to fit, or that has
 * no letters or digits at all, ends in a fingerprint of the whole name, so two such names
 * never share a file. The result is at most 60 bytes, which keeps a file name made of
 * three of them under the 255-byte limit of common file systems.
 */
export function slug(text) {
  const source = String(text).normalize('NFC');
  const full = source.toLowerCase().replace(/[^\p{L}\p{M}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '');
  if (full && Buffer.byteLength(full) <= SLUG_BYTES) return full;
  const suffix = `-${fingerprint(source)}`;
  let kept = '';
  for (const character of full) {
    if (Buffer.byteLength(kept + character) > SLUG_BYTES - suffix.length) break;
    kept += character;
  }
  return `${kept.replace(/-+$/, '') || 'item'}${suffix}`;
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

/**
 * An open question as the outputs use it. requirements.json gives either a line of text,
 * or the question with who can answer it and what is built if nobody does.
 */
export function openQuestion(item) {
  const words = (value) => (typeof value === 'string' && value.trim() ? value.trim() : null);
  if (item && typeof item === 'object') {
    return { question: words(item.question) ?? '', who: words(item.who), default: words(item.default) };
  }
  return { question: String(item ?? '').trim(), who: null, default: null };
}
