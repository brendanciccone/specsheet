// The handoff as one HTML file. It is a plain document on purpose: real headings, paragraphs,
// tables and images, so a selection pastes cleanly into Jira, Confluence, Notion or a doc.

import fs from 'node:fs';
import { clock, escapeHtml, formatBytes, stripKeyword } from '../util.js';
import { gherkinLine, scenarioText, sharedStart, stepLines, uniqueScenarios } from './gherkin.js';
import {
  checklistLines,
  commentSections,
  filesMarkdown,
  problemLines,
  questionsMarkdown,
  rebuiltNote,
  requirementSource,
  requirementStatus,
  requirementsMarkdown,
  scenariosMarkdown,
  stateStatus,
  statesMarkdown,
  summaryFacts,
  summaryMarkdown,
} from './markdown.js';

const STYLE = `
:root {
  color-scheme: light dark;
  --ink: #1d1c2b; --muted: #5f5e6e; --line: #dcdbe6; --page: #ffffff; --soft: #f6f5fa;
  --accent: #4a3fb8; --good: #2f5f0d; --bad: #a32d2d; --warn: #7a4708;
}
@media (prefers-color-scheme: dark) {
  :root {
    --ink: #eceaf5; --muted: #a9a7b8; --line: #3a3948; --page: #17161f; --soft: #211f2c;
    --accent: #afa9ec; --good: #b7da8a; --bad: #f4a9a9; --warn: #f3c275;
  }
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--page); color: var(--ink); font: 16px/1.6 system-ui, -apple-system, "Segoe UI", sans-serif; }
main { max-width: 880px; margin: 0 auto; padding: 36px 20px 96px; }
.eyebrow { display: flex; align-items: center; gap: 8px; margin: 0; color: var(--muted); font-size: 14px; }
.eyebrow svg { width: 20px; height: 20px; flex: none; }
h1 { margin: 6px 0 0; font-size: 30px; line-height: 1.2; text-wrap: balance; }
h2 { margin: 0; font-size: 21px; line-height: 1.3; }
h3 { margin: 0; font-size: 17px; line-height: 1.35; }
p { margin: 0 0 10px; }
a { color: var(--accent); }
section { margin-top: 44px; }
.head { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap;
  margin-bottom: 14px; padding-bottom: 8px; border-bottom: 1px solid var(--line); }
.tools { display: flex; gap: 6px; flex-wrap: wrap; }
button { font: inherit; font-size: 13px; line-height: 1.2; padding: 6px 10px; color: var(--ink); background: var(--soft);
  border: 1px solid var(--line); border-radius: 6px; cursor: pointer; }
button:hover { border-color: var(--muted); }
button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.table-wrap { overflow-x: auto; }
table { width: 100%; border-collapse: collapse; font-size: 15px; }
th, td { padding: 8px 10px; text-align: left; vertical-align: top; border: 1px solid var(--line); }
th { background: var(--soft); font-weight: 600; white-space: nowrap; }
table.facts th { width: 150px; }
.good { color: var(--good); font-weight: 600; }
.bad { color: var(--bad); font-weight: 600; }
.warn { color: var(--warn); font-weight: 600; }
.scenario { margin-top: 30px; }
.scenario-head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.scenario-meta { margin: 4px 0 12px; color: var(--muted); font-size: 14px; }
video.walkthrough { display: block; width: 100%; max-width: 720px; height: auto; margin: 0 0 16px; border: 1px solid var(--line, #dcdbe6); border-radius: 8px; background: var(--soft); aspect-ratio: 16 / 10; object-fit: cover; object-position: top; }
video.walkthrough[hidden] { display: none; }
.step { margin: 0 0 6px; }
.flag { font-style: normal; font-size: 14px; }
pre.error { margin: 4px 0 10px; padding: 10px 12px; overflow-x: auto; font: 13px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace;
  color: var(--bad); background: var(--soft); border: 1px solid var(--line); border-radius: 6px; white-space: pre-wrap; }
figure { margin: 12px 0 22px; }
.same-shot { margin: 2px 0 18px; color: var(--muted); font-size: 14px; }
figure img { display: block; max-width: 100%; height: auto; border: 1px solid var(--line); border-radius: 8px; background: #fff; }
figcaption { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-top: 6px; color: var(--muted); font-size: 13px; }
ul, ol { margin: 0 0 10px; padding-left: 22px; }
li { margin-bottom: 4px; }
.note { padding: 10px 14px; background: var(--soft); border: 1px solid var(--line); border-radius: 8px; }
footer { margin-top: 56px; padding-top: 14px; border-top: 1px solid var(--line); color: var(--muted); font-size: 13px; }
.flow-viewer { display: none; }
.js .flow-viewer { display: block; }
.js .flow-static img { display: none; }
.flow-tools { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin-bottom: 8px; }
.flow-tools button { min-width: 34px; }
.flow-hint { margin-left: 6px; color: var(--muted); font-size: 13px; }
.flow-stage { position: relative; height: min(76vh, 720px); overflow: hidden; border: 1px solid var(--line); border-radius: 8px;
  background: #fff; cursor: grab; touch-action: none; user-select: none; }
.flow-stage.dragging { cursor: grabbing; }
.flow-canvas { position: absolute; left: 0; top: 0; transform-origin: 0 0; }
.flow-canvas svg { display: block; }
.flow-node { cursor: pointer; outline: none; }
.flow-node:hover > rect:first-of-type, .flow-node:focus-visible > rect:first-of-type { stroke: #534ab7; stroke-width: 3; }
.js article.scenario figure img { cursor: zoom-in; }
.lightbox { position: fixed; inset: 0; z-index: 10; display: none; overflow: auto; padding: 20px 24px 40px; background: rgba(15, 14, 20, 0.86); }
.lightbox.open { display: block; }
.lightbox-bar { position: sticky; top: 0; z-index: 1; display: flex; align-items: center; justify-content: space-between; gap: 12px;
  max-width: 1200px; margin: 0 auto 14px; color: #fff; font-size: 14px; }
.lightbox-tip { margin-right: 10px; opacity: 0.75; }
.lightbox img { display: block; max-width: min(100%, 1200px); height: auto; margin: 0 auto; border-radius: 8px; background: #fff; cursor: zoom-in; }
.lightbox.zoomed img { max-width: none; cursor: zoom-out; }
@media print { .no-copy { display: none !important; } .flow-static img { display: block !important; } }
`;

const VIEW_SCRIPT = `
(function () {
  document.documentElement.classList.add('js');

  // Until a video is played, show the scenario's first screenshot. The video's own
  // first frame is blank.
  document.querySelectorAll('video.walkthrough').forEach(function (video) {
    var first = (video.closest('article') || video.closest('section')).querySelector('figure img, .same-shot');
    if (first && first.classList.contains('same-shot')) {
      first = document.querySelector('figure[data-file="' + CSS.escape(first.dataset.file) + '"] img');
    }
    if (first) video.poster = first.src;
  });

  // "In the video at 0:12" jumps the walkthrough above to that scenario and plays it.
  // If the player is not there, the link opens the video file as usual.
  document.addEventListener('click', function (event) {
    var link = event.target.closest('a.chapter');
    if (!link) return;
    var video = document.getElementById(link.dataset.video);
    if (!video || video.hidden) return;
    event.preventDefault();
    video.currentTime = Number(link.dataset.start) + 0.05;
    video.scrollIntoView({ behavior: 'smooth', block: 'center' });
    var playing = video.play();
    if (playing && playing.catch) playing.catch(function () {});
  });

  // ----- Full-size screenshots -----
  var box = document.querySelector('.lightbox');
  var boxImage = box.querySelector('img');
  var boxTitle = box.querySelector('.lightbox-title');
  function openBox(source, title) {
    boxImage.src = source;
    boxTitle.textContent = title || '';
    box.classList.remove('zoomed');
    box.classList.add('open');
    box.scrollTop = 0;
    box.scrollLeft = 0;
  }
  function closeBox() {
    box.classList.remove('open');
    boxImage.removeAttribute('src');
  }
  box.addEventListener('click', function (event) {
    if (event.target === boxImage) box.classList.toggle('zoomed');
    else if (event.target === box || event.target.closest('[data-lightbox="close"]')) closeBox();
  });
  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && box.classList.contains('open')) closeBox();
  });
  document.addEventListener('click', function (event) {
    var image = event.target.closest('article.scenario figure img');
    if (!image) return;
    var caption = image.closest('figure').querySelector('figcaption span');
    openBox(image.src, caption ? caption.textContent : '');
  });

  // ----- The user flow: zoom, drag, and click a screen -----
  var stage = document.querySelector('.flow-stage');
  if (!stage) return;
  var canvas = stage.querySelector('.flow-canvas');
  var drawing = canvas.querySelector('svg');
  var hint = document.querySelector('.flow-hint');
  var width = drawing.width.baseVal.value;
  var height = drawing.height.baseVal.value;
  var view = { scale: 1, x: 0, y: 0 };
  var touched = false;

  function apply() {
    canvas.style.transform = 'translate(' + view.x + 'px,' + view.y + 'px) scale(' + view.scale + ')';
  }
  function fit() {
    var scale = Math.min(stage.clientWidth / width, stage.clientHeight / height);
    view.scale = scale;
    view.x = (stage.clientWidth - width * scale) / 2;
    view.y = (stage.clientHeight - height * scale) / 2;
    touched = false;
    apply();
  }
  function zoom(factor, originX, originY) {
    var next = Math.min(8, Math.max(0.15, view.scale * factor));
    var ratio = next / view.scale;
    view.x = originX - (originX - view.x) * ratio;
    view.y = originY - (originY - view.y) * ratio;
    view.scale = next;
    touched = true;
    apply();
  }
  function say(text) {
    hint.textContent = text;
    clearTimeout(say.timer);
    say.timer = setTimeout(function () { hint.textContent = hint.dataset.default; }, 3200);
  }
  function openNode(node) {
    var file = node.dataset.file;
    var picture = file ? document.querySelector('figure[data-file="' + file + '"] img') : null;
    if (picture) openBox(picture.src, node.dataset.label);
    else say(node.dataset.label + ': ' + (node.dataset.note || 'no screenshot for this state') + '.');
  }

  document.querySelector('.flow-tools').addEventListener('click', function (event) {
    var button = event.target.closest('button[data-flow]');
    if (!button) return;
    if (button.dataset.flow === 'fit') fit();
    else zoom(button.dataset.flow === 'in' ? 1.3 : 1 / 1.3, stage.clientWidth / 2, stage.clientHeight / 2);
  });
  stage.addEventListener('wheel', function (event) {
    // Pinching on a trackpad arrives as a wheel event with the control key held.
    if (!event.ctrlKey && !event.metaKey) return;
    event.preventDefault();
    var bounds = stage.getBoundingClientRect();
    zoom(event.deltaY < 0 ? 1.12 : 1 / 1.12, event.clientX - bounds.left, event.clientY - bounds.top);
  }, { passive: false });

  var drag = null;
  stage.addEventListener('pointerdown', function (event) {
    drag = { x: event.clientX, y: event.clientY, startX: view.x, startY: view.y, moved: false, target: event.target };
    stage.setPointerCapture(event.pointerId);
  });
  stage.addEventListener('pointermove', function (event) {
    if (!drag) return;
    var dx = event.clientX - drag.x;
    var dy = event.clientY - drag.y;
    if (!drag.moved && Math.abs(dx) + Math.abs(dy) < 5) return;
    drag.moved = true;
    touched = true;
    stage.classList.add('dragging');
    view.x = drag.startX + dx;
    view.y = drag.startY + dy;
    apply();
  });
  function release(event) {
    if (!drag) return;
    var finished = drag;
    drag = null;
    stage.classList.remove('dragging');
    if (finished.moved || event.type === 'pointercancel') return;
    var node = finished.target.closest ? finished.target.closest('.flow-node') : null;
    if (node) openNode(node);
  }
  stage.addEventListener('pointerup', release);
  stage.addEventListener('pointercancel', release);
  stage.addEventListener('dblclick', function (event) {
    if (event.target.closest('.flow-node')) return;
    var bounds = stage.getBoundingClientRect();
    zoom(1.6, event.clientX - bounds.left, event.clientY - bounds.top);
  });
  stage.addEventListener('keydown', function (event) {
    var node = event.target.closest ? event.target.closest('.flow-node') : null;
    if (node && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault();
      openNode(node);
    }
  });
  window.addEventListener('resize', function () { if (!touched) fit(); });
  fit();
})();
`;

const SCRIPT = `
(function () {
  var markdown = JSON.parse(document.getElementById('specsheet-markdown').textContent);

  function flash(button, text) {
    var label = button.dataset.label || button.textContent;
    button.dataset.label = label;
    button.textContent = text;
    setTimeout(function () { button.textContent = label; }, 1600);
  }

  function prepare(target, withImages) {
    var clone = target.cloneNode(true);
    clone.querySelectorAll('.no-copy').forEach(function (node) { node.remove(); });
    clone.querySelectorAll('.same-shot').forEach(function (reference) {
      var selector = 'figure[data-file="' + CSS.escape(reference.dataset.file) + '"]';
      if (clone.querySelector(selector)) {
        reference.querySelectorAll('a').forEach(function (link) { link.replaceWith(link.textContent); });
        return;
      }
      var original = document.querySelector(selector);
      if (!original) return;
      var copy = original.cloneNode(true);
      copy.removeAttribute('id');
      reference.replaceWith(copy);
    });
    if (!withImages) {
      clone.querySelectorAll('figure').forEach(function (figure) {
        var note = document.createElement('p');
        note.textContent = 'Screenshot: ' + (figure.dataset.file || 'see the attached files');
        figure.replaceWith(note);
      });
    }
    return clone;
  }

  function fallbackCopy(html) {
    var holder = document.createElement('div');
    holder.contentEditable = 'true';
    holder.style.position = 'fixed';
    holder.style.left = '-9999px';
    holder.innerHTML = html;
    document.body.appendChild(holder);
    var range = document.createRange();
    range.selectNodeContents(holder);
    var selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    var ok = document.execCommand('copy');
    selection.removeAllRanges();
    holder.remove();
    if (!ok) throw new Error('Copy failed');
  }

  async function copyRich(html, text) {
    if (navigator.clipboard && window.ClipboardItem) {
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/html': new Blob([html], { type: 'text/html' }),
          'text/plain': new Blob([text], { type: 'text/plain' })
        })
      ]);
      return;
    }
    fallbackCopy(html);
  }

  document.addEventListener('click', async function (event) {
    var button = event.target.closest('button[data-copy]');
    if (!button) return;
    try {
      if (button.dataset.copy === 'image') {
        var image = button.closest('figure').querySelector('img');
        var blob = await (await fetch(image.src)).blob();
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      } else {
        var target = button.closest('[data-block]');
        var clone = prepare(target, button.dataset.copy === 'with-images');
        await copyRich(clone.innerHTML, markdown[target.dataset.block] || clone.textContent);
      }
      flash(button, 'Copied');
    } catch (error) {
      flash(button, 'Copy failed');
    }
  });
})();
`;

function dataUri(file) {
  try {
    return `data:image/png;base64,${fs.readFileSync(file).toString('base64')}`;
  } catch {
    return null;
  }
}

// The page carries its videos inside itself, so the one file can be moved or sent on its
// own. Past this total the rest are played from the videos folder beside the page, to
// keep the file a size that still opens and sends easily.
export const EMBED_VIDEO_LIMIT = 15 * 1024 * 1024;
let embeddedVideoBytes = 0;

/** The video as a data URI, or null when it is missing or the page is already full. */
function videoUri(file) {
  try {
    const size = fs.statSync(file).size;
    if (embeddedVideoBytes + size > EMBED_VIDEO_LIMIT) return null;
    embeddedVideoBytes += size;
    const type = file.endsWith('.webm') ? 'video/webm' : 'video/mp4';
    return `data:${type};base64,${fs.readFileSync(file).toString('base64')}`;
  } catch {
    return null;
  }
}

function tools({ images = false } = {}) {
  return (
    '<span class="tools no-copy">' +
    '<button type="button" data-copy="text">Copy text</button>' +
    (images ? '<button type="button" data-copy="with-images">Copy with images</button>' : '') +
    '</span>'
  );
}

function head(title, options) {
  return `<div class="head"><h2>${escapeHtml(title)}</h2>${tools(options)}</div>`;
}

function statusClass(status) {
  if (status === 'covered' || status === 'reached' || status === 'passed') return 'good';
  if (status === 'failing' || status === 'failed') return 'bad';
  return 'warn';
}

function figure(shot, label, viewportLabel, id) {
  const uri = dataUri(shot.file);
  if (!uri) return '';
  const where = [shot.screen, shot.state].filter(Boolean).join(' · ');
  const caption = [where, viewportLabel, shot.failed ? 'when the step failed' : null].filter(Boolean).join(' — ');
  return (
    `<figure id="${id}" data-file="${escapeHtml(shot.outFile ?? '')}">` +
    `<img src="${uri}" alt="${escapeHtml(`Screenshot: ${label}`)}" loading="lazy" />` +
    `<figcaption><span>${escapeHtml(caption)}</span>` +
    '<button type="button" class="no-copy" data-copy="image">Copy image</button></figcaption>' +
    '</figure>'
  );
}

/**
 * A step's screenshot. A screen and state that an earlier step already shows get a link to
 * that picture instead of the same picture again, so scenarios that all start on one page
 * do not repeat it. The screenshot of a failed step is always shown.
 */
function shotHtml(step, scenario, shown) {
  const file = step.shot.failed ? null : step.shot.outFile;
  const earlier = file ? shown.files.get(file) : null;
  if (earlier) {
    const where = [step.shot.screen, step.shot.state].filter(Boolean).join(' · ');
    return (
      `<p class="same-shot" data-file="${escapeHtml(file)}">Same screen as ` +
      `<a href="#${earlier.id}">step ${earlier.step} of "${escapeHtml(earlier.scenario)}"</a>` +
      `${where ? ` (${escapeHtml(where)})` : ''}.</p>`
    );
  }
  shown.count += 1;
  const id = `shot-${shown.count}`;
  const html = figure(step.shot, `${scenario.title}, ${step.title}`, scenario.viewportLabel, id);
  if (html && file) shown.files.set(file, { id, step: step.index + 1, scenario: scenario.title });
  return html;
}

function stepHtml(step) {
  const line = gherkinLine(step.title);
  const keyword = line.split(/\s+/)[0];
  const rest = stripKeyword(line);
  let flag = '';
  if (step.status === 'failed') flag = ' <em class="flag bad">(Failing)</em>';
  else if (step.status === 'not-run') flag = ' <em class="flag warn">(Did not run)</em>';
  else if (step.resolvedKeyword === 'Then' && step.checks === 0) flag = ' <em class="flag warn">(Not verified)</em>';
  let html = `<p class="step"><strong>${escapeHtml(keyword)}</strong> ${escapeHtml(rest)}${flag}</p>`;
  if (step.status === 'failed' && step.error) html += `<pre class="error">${escapeHtml(step.error)}</pre>`;
  return html;
}

/** The walkthrough videos of a flow: one player per screen size, with the file named beside it. */
function flowVideosHtml(flow, flowKey) {
  return (flow.videos ?? [])
    .map((video, index) => {
      const source = videoUri(video.path) || video.file;
      return (
        `<p class="scenario-meta">Walkthrough video, every scenario in order (${escapeHtml(video.viewportLabel)}, ${clock(video.seconds)}): ` +
        `<a href="${escapeHtml(video.file)}">${escapeHtml(video.file)}</a></p>` +
        `<video class="walkthrough no-copy" id="${flowKey}-video-${index}" controls preload="metadata" src="${escapeHtml(source)}" ` +
        `aria-label="${escapeHtml(`Walkthrough video of ${flow.name}`)}" onerror="this.hidden=true"></video>`
      );
    })
    .join('');
}

function scenarioHtml(scenario, key, manyViewports, flowKey, shown) {
  const meta = [];
  if (scenario.covers.length) meta.push(`Proves ${scenario.covers.join(', ')}`);
  meta.push(scenario.status === 'passed' ? 'Passes' : 'Fails');
  meta.push(scenario.viewportLabel);
  const metaHtml = meta.map(escapeHtml).join(' · ');
  let video = '';
  if (scenario.videoFile) {
    video = ` · <a href="${escapeHtml(scenario.videoFile)}">Video: ${escapeHtml(scenario.videoFile)}</a>`;
  } else if (scenario.chapter) {
    // A link that also works with no script: the browser opens the file at this second.
    const second = Math.floor(scenario.chapter.start);
    video =
      ` · <a class="chapter" href="${escapeHtml(scenario.chapter.file)}#t=${second}" ` +
      `data-video="${flowKey}-video-${scenario.chapter.index}" data-start="${scenario.chapter.start.toFixed(2)}">` +
      `In the video at ${clock(scenario.chapter.start)}</a>`;
  }
  // The player is left out of copies, where the link above stands in for it. The video
  // is carried inside the page. A video too large for that plays from the videos folder,
  // and its player hides itself if the page has been moved away from that folder.
  const source = scenario.videoFile ? (scenario.videoPath && videoUri(scenario.videoPath)) || scenario.videoFile : null;
  const player = source
    ? `<video class="walkthrough no-copy" controls preload="metadata" src="${escapeHtml(source)}" ` +
      `aria-label="${escapeHtml(`Video of ${scenario.title}`)}" onerror="this.hidden=true"></video>`
    : '';
  const title = manyViewports ? `${scenario.title} (${scenario.viewport.name})` : scenario.title;

  const body = scenario.steps
    .map((step) => {
      let html = stepHtml(step);
      if (step.shot) html += shotHtml(step, scenario, shown);
      return html;
    })
    .join('');

  const empty =
    scenario.steps.length === 0
      ? `<p class="bad">This scenario could not start.</p>${scenario.error ? `<pre class="error">${escapeHtml(scenario.error)}</pre>` : ''}`
      : '';

  return (
    `<article class="scenario" data-block="${key}">` +
    `<div class="scenario-head"><h3>Scenario: ${escapeHtml(title)}</h3>${tools({ images: true })}</div>` +
    `<p class="scenario-meta">${metaHtml}${video}</p>` +
    player +
    empty +
    body +
    '</article>'
  );
}

export function renderPage(model, { flowImage, flowSvg = null, files = [], icon = '' } = {}) {
  embeddedVideoBytes = 0;
  const { meta } = model;
  const manyViewports = meta.viewports.length > 1;
  const markdown = {};
  const parts = [];

  // Summary
  const facts = summaryFacts(model)
    .map(([label, value, link]) => {
      const cell = link ? `<a href="${escapeHtml(link)}">${escapeHtml(value)}</a>` : escapeHtml(value);
      return `<tr><th scope="row">${escapeHtml(label)}</th><td>${cell}</td></tr>`;
    })
    .join('');
  const note = rebuiltNote(model);
  const problems = problemLines(model);
  markdown.summary = `## Summary\n\n${summaryMarkdown(model)}`;
  parts.push(
    `<section data-block="summary">${head('Summary')}` +
      `<div class="table-wrap"><table class="facts"><tbody>${facts}</tbody></table></div>` +
      (note ? `<p class="note" style="margin-top:12px">${escapeHtml(note)}</p>` : '') +
      (problems.length
        ? `<h3 style="margin-top:20px">To be aware of</h3><ul>${problems.map((line) => `<li>${escapeHtml(line)}</li>`).join('')}</ul>`
        : '') +
      '</section>',
  );
  if (problems.length) markdown.summary += `\n\n### To be aware of\n\n${problems.map((line) => `- ${line}`).join('\n')}`;

  // Requirements
  const requirementRows = model.requirements
    .map(
      (item) =>
        `<tr><td>${escapeHtml(item.id)}</td><td>${escapeHtml(item.text)}</td><td>${escapeHtml(requirementSource(item.source))}</td>` +
        `<td class="${statusClass(item.status)}">${escapeHtml(requirementStatus(item.status))}</td>` +
        `<td>${escapeHtml(item.scenarios.join('; ') || 'None')}</td></tr>`,
    )
    .join('');
  markdown.requirements = `## Requirements\n\n${requirementsMarkdown(model)}`;
  parts.push(
    `<section data-block="requirements">${head('Requirements')}` +
      (model.requirements.length
        ? '<div class="table-wrap"><table><thead><tr><th>ID</th><th>Requirement</th><th>From</th><th>Status</th><th>Proved by</th></tr></thead>' +
          `<tbody>${requirementRows}</tbody></table></div>`
        : '<p>No requirements were listed.</p>') +
      '</section>',
  );

  // User flow
  if (flowImage) {
    markdown.flow = '## User flow\n\nSee the attached image: flow.png';
    parts.push(
      `<section data-block="flow">${head('User flow', { images: true })}` +
        '<p>Screens and states as boxes, and the actions between them as arrows. Every arrow is an action the run performed.</p>' +
        // The interactive drawing. The picture below it is what gets copied and printed.
        (flowSvg
          ? '<div class="flow-viewer no-copy"><div class="flow-tools">' +
            '<button type="button" data-flow="out" aria-label="Zoom out">−</button>' +
            '<button type="button" data-flow="in" aria-label="Zoom in">+</button>' +
            '<button type="button" data-flow="fit">Fit</button>' +
            '<span class="flow-hint" data-default="Drag to move. Click a screen to see it full size.">Drag to move. Click a screen to see it full size.</span>' +
            `</div><div class="flow-stage"><div class="flow-canvas">${flowSvg}</div></div></div>`
          : '') +
        `<figure class="flow-static" data-file="flow.png"><img src="${flowImage}" alt="User flow diagram for ${escapeHtml(meta.title)}" />` +
        '<figcaption><span>flow.png</span><button type="button" class="no-copy" data-copy="image">Copy image</button></figcaption></figure>' +
        '</section>',
    );
  }

  // Scenarios, one section per flow. Each screenshot appears once on the page.
  const shown = { files: new Map(), count: 0 };
  model.flows.forEach((flow, flowIndex) => {
    const key = `flow-${flowIndex}`;
    markdown[key] = `## Scenarios: ${flow.name}\n\n${scenariosMarkdown(flow, model, 'gherkin')}`;
    const scenarios = flow.scenarios
      .map((scenario, index) => {
        const scenarioKey = `${key}-scenario-${index}`;
        markdown[scenarioKey] = '```gherkin\n' + scenarioText(scenario, '') + '\n```';
        return scenarioHtml(scenario, scenarioKey, manyViewports, key, shown);
      })
      .join('');
    parts.push(`<section data-block="${key}">${head(`Scenarios: ${flow.name}`, { images: true })}${flowVideosHtml(flow, key)}${scenarios}</section>`);
  });

  // Checklist
  markdown.checklist = `## Acceptance checklist\n\n${model.flows.map((flow) => checklistLines(flow).join('\n')).join('\n')}`;
  const checklist = model.flows
    .map((flow) => {
      const scenarios = uniqueScenarios(flow);
      const shared = sharedStart(scenarios);
      const start = shared.length
        ? `<p>Every scenario starts with:</p><ul>${shared.map((line) => `<li>${escapeHtml(line)}</li>`).join('')}</ul>`
        : '';
      const items = scenarios
        .map((scenario) => {
          const ids = scenario.covers.length ? ` (${scenario.covers.join(', ')})` : '';
          const steps = stepLines(scenario, shared.length).map((line) => `<li>${escapeHtml(line)}</li>`).join('');
          return `<li><strong>${escapeHtml(scenario.title)}</strong>${escapeHtml(ids)}<ul>${steps}</ul></li>`;
        })
        .join('');
      return `${start}<ul>${items}</ul>`;
    })
    .join('');
  parts.push(`<section data-block="checklist">${head('Acceptance checklist')}${checklist}</section>`);

  // States
  const stateRows = model.flows
    .flatMap((flow) =>
      flow.screens.flatMap((screen) =>
        screen.states.map((state) => {
          const label = state.reason ? `${stateStatus(state.status)}: ${state.reason}` : stateStatus(state.status);
          return `<tr><td>${escapeHtml(screen.name)}</td><td>${escapeHtml(state.name)}</td><td class="${statusClass(state.status)}">${escapeHtml(label)}</td></tr>`;
        }),
      ),
    )
    .join('');
  markdown.states = `## States\n\n${statesMarkdown(model)}`;
  parts.push(
    `<section data-block="states">${head('States')}` +
      '<p>The states each screen needs, and whether a scenario shows them. "Not shown" means no step lands on that state: ' +
      'either it has not been designed yet, or no scenario covers it.</p>' +
      (stateRows
        ? `<div class="table-wrap"><table><thead><tr><th>Screen</th><th>State</th><th>Status</th></tr></thead><tbody>${stateRows}</tbody></table></div>`
        : '<p>No states were declared.</p>') +
      '</section>',
  );

  // Open questions
  markdown.questions = `## Open questions\n\n${questionsMarkdown(model)}`;
  parts.push(
    `<section data-block="questions">${head('Open questions')}` +
      (model.openQuestions.length
        ? `<ol>${model.openQuestions.map((question) => `<li>${escapeHtml(question)}</li>`).join('')}</ol>`
        : '<p>None.</p>') +
      '</section>',
  );

  // Files
  if (files.length) {
    markdown.files = `## Files\n\n${filesMarkdown(files)}`;
    parts.push(
      `<section data-block="files">${head('Files')}` +
        '<p>These sit in the same folder as this page.</p>' +
        `<ul>${files
          .map(
            (file) =>
              `<li><a href="${escapeHtml(file.path)}">${escapeHtml(file.path)}</a> (${escapeHtml(formatBytes(file.bytes))}): ${escapeHtml(file.description)}</li>`,
          )
          .join('')}</ul>` +
        '</section>',
    );
  }

  markdown.all = commentSections(model, files).join('\n\n');
  const blob = JSON.stringify(markdown).replaceAll('<', '\\u003c');
  const eyebrow = ['Design handoff', meta.ticket?.key].filter(Boolean).join(' · ');

  return (
    '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8" />\n' +
    '<meta name="viewport" content="width=device-width, initial-scale=1" />\n' +
    `<title>Handoff: ${escapeHtml(meta.title)}</title>\n<style>${STYLE}</style>\n</head>\n<body>\n` +
    '<main data-block="all">\n' +
    `<header><div class="head" style="border:0;margin:0;padding:0"><p class="eyebrow">${icon}<span>${escapeHtml(eyebrow)}</span></p>` +
    '<span class="tools no-copy"><button type="button" data-copy="text">Copy whole page as text</button></span></div>' +
    `<h1>${escapeHtml(meta.title)}</h1></header>\n` +
    parts.join('\n') +
    '\n<footer class="no-copy">Made with Specsheet. Every step on this page was run against the prototype in a browser.</footer>\n' +
    '</main>\n' +
    '<div class="lightbox no-copy" role="dialog" aria-modal="true" aria-label="Screenshot">' +
    '<div class="lightbox-bar"><span class="lightbox-title"></span>' +
    '<span><span class="lightbox-tip">Click the picture to zoom</span> <button type="button" data-lightbox="close">Close</button></span></div>' +
    '<img alt="" /></div>\n' +
    `<script type="application/json" id="specsheet-markdown">${blob}</script>\n` +
    `<script>${SCRIPT}</script>\n<script>${VIEW_SCRIPT}</script>\n</body>\n</html>\n`
  );
}
