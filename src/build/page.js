// The handoff as one HTML file. It is a plain document on purpose: real headings, paragraphs,
// tables and images, so a selection pastes cleanly into Jira, Confluence, Notion or a doc.

import fs from 'node:fs';
import { clock, escapeHtml, formatBytes, plural, stripKeyword } from '../util.js';
import { FIT_LABELS } from './graph.js';
import { gherkinLine, scenarioText, sharedStart, stepLines, uniqueScenarios } from './gherkin.js';
import {
  ASSUMED_INTRO,
  assumedMarkdown,
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
  stateRows,
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
.toc { max-width: 880px; margin: 0 auto; padding: 20px 20px 0; font-size: 14px; }
.toc-title { margin: 0 0 6px; color: var(--muted); font-size: 12px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; }
.toc ul { margin: 0; padding: 0; list-style: none; }
.toc > ul { display: flex; flex-wrap: wrap; gap: 2px 14px; }
.toc li { margin: 0; }
.toc ul ul { display: none; }
.toc a { display: block; padding: 3px 8px; color: var(--ink); text-decoration: none; border-radius: 6px; }
.toc a:hover { background: var(--soft); }
.toc a.current { background: var(--soft); color: var(--accent); font-weight: 600; }
.toc ul ul a { display: flex; gap: 6px; padding-left: 10px; color: var(--muted); line-height: 1.35; }
.toc ul ul a.current { color: var(--accent); }
.mark { flex: none; width: 14px; text-align: center; font-weight: 700; }
@media (min-width: 1240px) {
  body { display: grid; grid-template-columns: 260px minmax(0, 880px); justify-content: center; column-gap: 28px; }
  main { margin: 0; width: 100%; }
  .toc { position: sticky; top: 0; align-self: start; max-height: 100vh; overflow-y: auto; margin: 0; padding: 40px 0 40px 16px; }
  .toc > ul { display: block; }
  .toc ul ul { display: block; margin: 2px 0 8px; }
}
.stats { display: flex; flex-wrap: wrap; gap: 8px; margin: 18px 0 0; padding: 0; list-style: none; }
.stats li { margin: 0; }
.stats a { display: block; padding: 8px 14px; color: var(--ink); text-decoration: none; background: var(--soft); border: 1px solid var(--line); border-radius: 10px; }
.stats a:hover { border-color: var(--muted); }
.stats strong { display: block; font-size: 20px; line-height: 1.2; }
.stats span { color: var(--muted); font-size: 13px; }
.stats .is-bad strong { color: var(--bad); }
.stats .is-warn strong { color: var(--warn); }
.stats .is-good strong { color: var(--good); }
footer svg { width: 16px; height: 16px; margin-right: 6px; vertical-align: -3px; }
h1 { margin: 0; font-size: 30px; line-height: 1.2; text-wrap: balance; }
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
.scenario { margin-top: 12px; border: 1px solid var(--line); border-radius: 10px; scroll-margin-top: 12px; }
.scenario > details > summary { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; padding: 12px 16px; cursor: pointer; list-style: none; border-radius: 10px; }
.scenario > details > summary::-webkit-details-marker { display: none; }
.scenario > details > summary::before { content: "▸"; flex: none; color: var(--muted); }
.scenario > details[open] > summary::before { content: "▾"; }
.scenario > details > summary:hover { background: var(--soft); }
.scenario > details > summary:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.scenario > details > summary h3 { flex: 1 1 260px; }
.scenario-brief { color: var(--muted); font-size: 14px; }
.scenario-body { padding: 0 16px 6px; }
.scenario-body .tools { float: right; margin: 0 0 8px 12px; }
.scenario figure img { max-height: 460px; }
section, article { scroll-margin-top: 12px; }
details.fold > summary { cursor: pointer; margin-bottom: 10px; color: var(--accent); }
.scenario-meta { margin: 4px 0 12px; color: var(--muted); font-size: 14px; }
video.walkthrough { display: block; width: 100%; max-width: 720px; height: auto; margin: 0 0 16px; border: 1px solid var(--line, #dcdbe6); border-radius: 8px; background: var(--soft); aspect-ratio: 16 / 10; object-fit: cover; object-position: top; }
video.walkthrough[hidden] { display: none; }
.step { margin: 0 0 6px; }
.scenario-number { color: var(--muted); font-weight: 600; margin-right: 2px; }
.flag { font-style: normal; font-size: 14px; }
pre.error { margin: 4px 0 10px; padding: 10px 12px; overflow-x: auto; font: 13px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace;
  color: var(--bad); background: var(--soft); border: 1px solid var(--line); border-radius: 6px; white-space: pre-wrap; }
figure { margin: 12px 0 22px; }
.same-shot { margin-left: 6px; color: var(--muted); font-size: 13px; white-space: nowrap; }
.meta { margin: 8px 0 0; color: var(--muted); font-size: 14px; }
.meta a { color: inherit; }
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
.flow-zoom { min-width: 44px; text-align: center; color: var(--muted); font-size: 13px; font-variant-numeric: tabular-nums; }
.flow-canvas.gliding { transition: transform 0.18s ease-out; }
.flow-viewer.full { position: fixed; inset: 0; z-index: 9; display: flex; flex-direction: column; padding: 12px 16px 16px; background: var(--page); }
.flow-viewer.full .flow-stage { flex: 1; height: auto; }
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
@media print { body { display: block; } .no-copy { display: none !important; } .flow-static img { display: block !important; } }
`;

const VIEW_SCRIPT = `
(function () {
  document.documentElement.classList.add('js');

  // Until a video is played, show the scenario's first screenshot. The video's own
  // first frame is blank.
  document.querySelectorAll('video.walkthrough').forEach(function (video) {
    var first = (video.closest('article') || video.closest('section')).querySelector('article figure img, article .same-shot');
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

  // ----- Folded scenarios -----
  // A link to something inside a folded scenario opens it first.
  function reveal(target) {
    for (var node = target; node; node = node.parentElement) {
      if (node.tagName === 'DETAILS') node.open = true;
    }
  }
  function follow() {
    var target = location.hash ? document.getElementById(decodeURIComponent(location.hash.slice(1))) : null;
    if (!target) return;
    reveal(target);
    var inner = target.querySelector(':scope > details');
    if (inner) inner.open = true;
    target.scrollIntoView();
  }
  window.addEventListener('hashchange', follow);
  follow();
  document.addEventListener('click', function (event) {
    var button = event.target.closest('button[data-fold]');
    if (!button) return;
    var open = button.dataset.fold === 'open';
    button.closest('section').querySelectorAll('article.scenario > details').forEach(function (fold) { fold.open = open; });
  });
  window.addEventListener('beforeprint', function () {
    document.querySelectorAll('details').forEach(function (fold) { fold.open = true; });
  });

  // ----- Contents: mark the part of the page being read -----
  var links = {};
  document.querySelectorAll('.toc a').forEach(function (link) { links[link.getAttribute('href').slice(1)] = link; });
  var marked = [];
  function mark() {
    var line = window.innerHeight * 0.3;
    var current = [];
    document.querySelectorAll('main section[id], main article[id]').forEach(function (part) {
      var box = part.getBoundingClientRect();
      if (box.top <= line && box.bottom > line && links[part.id]) current.push(links[part.id]);
    });
    marked.forEach(function (link) { link.classList.remove('current'); });
    current.forEach(function (link) { link.classList.add('current'); });
    marked = current;
  }
  var waiting = false;
  window.addEventListener('scroll', function () {
    if (waiting) return;
    waiting = true;
    requestAnimationFrame(function () { waiting = false; mark(); });
  }, { passive: true });
  // Opening or folding a scenario moves the page without scrolling it.
  document.addEventListener('toggle', mark, true);
  mark();

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

  // ----- The user flow: move, zoom, and click a screen -----
  var stage = document.querySelector('.flow-stage');
  if (!stage) return;
  var viewer = stage.closest('.flow-viewer');
  var canvas = stage.querySelector('.flow-canvas');
  var drawing = canvas.querySelector('svg');
  var hint = document.querySelector('.flow-hint');
  var readout = document.querySelector('.flow-zoom');
  var width = drawing.width.baseVal.value;
  var height = drawing.height.baseVal.value;
  // Fit each label's box to its words in this browser's own font.
  try { (FIT_LABELS_SOURCE)(drawing); } catch (error) {}
  var view = { scale: 1, x: 0, y: 0 };
  var touched = false;
  var LIMITS = { min: 0.1, max: 4 };

  // Keep at least a strip of the drawing in sight, so it cannot be lost off the edge.
  function clamp() {
    var keep = 120;
    view.x = Math.min(stage.clientWidth - keep, Math.max(keep - width * view.scale, view.x));
    view.y = Math.min(stage.clientHeight - keep, Math.max(keep - height * view.scale, view.y));
  }
  function apply(glide) {
    clamp();
    canvas.classList.toggle('gliding', !!glide);
    canvas.style.transform = 'translate(' + view.x + 'px,' + view.y + 'px) scale(' + view.scale + ')';
    readout.textContent = Math.round(view.scale * 100) + '%';
  }
  function fitScale() {
    return Math.min(stage.clientWidth / width, stage.clientHeight / height, 1);
  }
  function fit(glide) {
    view.scale = fitScale();
    view.x = (stage.clientWidth - width * view.scale) / 2;
    view.y = (stage.clientHeight - height * view.scale) / 2;
    touched = false;
    apply(glide);
  }
  // The first view: large enough to read, starting where the flow starts. A drawing
  // that fits at that size is shown whole.
  function start() {
    var whole = fitScale();
    if (whole >= 0.6) return fit();
    view.scale = Math.min(1, Math.max(0.6, stage.clientHeight / height));
    view.x = 0;
    view.y = 0;
    touched = false;
    apply();
  }
  function zoomTo(scale, originX, originY, glide) {
    var next = Math.min(LIMITS.max, Math.max(LIMITS.min, scale));
    var ratio = next / view.scale;
    view.x = originX - (originX - view.x) * ratio;
    view.y = originY - (originY - view.y) * ratio;
    view.scale = next;
    touched = true;
    apply(glide);
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
  function setFull(on) {
    viewer.classList.toggle('full', on);
    viewer.querySelector('[data-flow="full"]').textContent = on ? 'Close' : 'Full screen';
    document.documentElement.style.overflow = on ? 'hidden' : '';
    start();
  }

  viewer.querySelector('.flow-tools').addEventListener('click', function (event) {
    var button = event.target.closest('button[data-flow]');
    if (!button) return;
    var centerX = stage.clientWidth / 2;
    var centerY = stage.clientHeight / 2;
    if (button.dataset.flow === 'fit') fit(true);
    else if (button.dataset.flow === 'actual') zoomTo(1, centerX, centerY, true);
    else if (button.dataset.flow === 'full') setFull(!viewer.classList.contains('full'));
    else zoomTo(view.scale * (button.dataset.flow === 'in' ? 1.25 : 0.8), centerX, centerY, true);
  });

  // A pinch on a trackpad arrives as a wheel event with the control key held, and zooms
  // around the pointer by as much as the fingers moved. A plain scroll moves the drawing.
  // Scrolling up and down is left to the page, unless the drawing is full screen or there
  // is more of it above or below to show.
  stage.addEventListener('wheel', function (event) {
    var bounds = stage.getBoundingClientRect();
    var unit = event.deltaMode === 1 ? 16 : 1;
    if (event.ctrlKey || event.metaKey) {
      event.preventDefault();
      var amount = Math.max(-60, Math.min(60, event.deltaY * unit));
      zoomTo(view.scale * Math.exp(-amount * 0.01), event.clientX - bounds.left, event.clientY - bounds.top);
      return;
    }
    var dx = event.deltaX * unit;
    var dy = event.deltaY * unit;
    if (event.shiftKey && !dx) { dx = dy; dy = 0; }
    var full = viewer.classList.contains('full');
    var before = { x: view.x, y: view.y };
    view.x -= dx;
    if (full || touched) view.y -= dy;
    clamp();
    var moved = view.x !== before.x || view.y !== before.y;
    if (!moved && !full) return;
    event.preventDefault();
    if (Math.abs(dx) > Math.abs(dy)) touched = true;
    apply();
  }, { passive: false });

  // One finger or the mouse drags. Two fingers pinch.
  var pointers = {};
  var drag = null;
  var pinch = null;
  function fingers() { return Object.keys(pointers).map(function (id) { return pointers[id]; }); }
  stage.addEventListener('pointerdown', function (event) {
    pointers[event.pointerId] = { x: event.clientX, y: event.clientY };
    stage.setPointerCapture(event.pointerId);
    var held = fingers();
    if (held.length === 2) {
      drag = null;
      pinch = { distance: Math.hypot(held[0].x - held[1].x, held[0].y - held[1].y), scale: view.scale };
      return;
    }
    drag = { x: event.clientX, y: event.clientY, startX: view.x, startY: view.y, moved: false, target: event.target };
  });
  stage.addEventListener('pointermove', function (event) {
    if (!pointers[event.pointerId]) return;
    pointers[event.pointerId] = { x: event.clientX, y: event.clientY };
    var held = fingers();
    if (pinch && held.length === 2) {
      var bounds = stage.getBoundingClientRect();
      var distance = Math.hypot(held[0].x - held[1].x, held[0].y - held[1].y);
      zoomTo(pinch.scale * (distance / pinch.distance), (held[0].x + held[1].x) / 2 - bounds.left, (held[0].y + held[1].y) / 2 - bounds.top);
      return;
    }
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
    delete pointers[event.pointerId];
    if (fingers().length < 2) pinch = null;
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
    zoomTo(view.scale * 1.6, event.clientX - bounds.left, event.clientY - bounds.top, true);
  });
  stage.tabIndex = 0;
  stage.addEventListener('keydown', function (event) {
    var node = event.target.closest ? event.target.closest('.flow-node') : null;
    if (node && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault();
      return openNode(node);
    }
    var centerX = stage.clientWidth / 2;
    var centerY = stage.clientHeight / 2;
    var step = 80;
    if (event.key === '+' || event.key === '=') zoomTo(view.scale * 1.25, centerX, centerY, true);
    else if (event.key === '-') zoomTo(view.scale * 0.8, centerX, centerY, true);
    else if (event.key === '0') fit(true);
    else if (event.key === '1') zoomTo(1, centerX, centerY, true);
    else if (event.key === 'ArrowLeft') { view.x += step; touched = true; apply(true); }
    else if (event.key === 'ArrowRight') { view.x -= step; touched = true; apply(true); }
    else if (event.key === 'ArrowUp') { view.y += step; touched = true; apply(true); }
    else if (event.key === 'ArrowDown') { view.y -= step; touched = true; apply(true); }
    else return;
    event.preventDefault();
  });
  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && viewer.classList.contains('full') && !box.classList.contains('open')) setFull(false);
  });
  window.addEventListener('resize', function () { if (!touched) start(); });
  start();
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
    // A folded scenario is copied whole, as plain headings and paragraphs.
    clone.querySelectorAll('summary').forEach(function (summary) {
      summary.replaceWith.apply(summary, Array.prototype.slice.call(summary.childNodes));
    });
    clone.querySelectorAll('details').forEach(function (fold) {
      fold.replaceWith.apply(fold, Array.prototype.slice.call(fold.childNodes));
    });
    clone.querySelectorAll('.same-shot').forEach(function (reference) {
      var selector = 'figure[data-file="' + CSS.escape(reference.dataset.file) + '"]';
      var step = reference.closest('p');
      var original = clone.querySelector(selector) ? null : document.querySelector(selector);
      reference.remove();
      if (!original || !step) return;
      var copy = original.cloneNode(true);
      copy.removeAttribute('id');
      step.after(copy);
    });
    // After the screenshots shown earlier are back, so their buttons go too.
    clone.querySelectorAll('.no-copy').forEach(function (node) { node.remove(); });
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
    return { inline: `<a class="same-shot no-copy" data-file="${escapeHtml(file)}" href="#${earlier.id}" title="${escapeHtml(where)}">screenshot ↑</a>` };
  }
  shown.count += 1;
  const id = `shot-${shown.count}`;
  const html = figure(step.shot, `${scenario.title}, ${step.title}`, scenario.viewportLabel, id);
  if (html && file) shown.files.set(file, { id });
  return { block: html };
}

function stepHtml(step, inline = '') {
  const line = gherkinLine(step.title);
  const keyword = line.split(/\s+/)[0];
  const rest = stripKeyword(line);
  let flag = '';
  if (step.status === 'failed') flag = ' <em class="flag bad">(Failing)</em>';
  else if (step.status === 'not-run') flag = ' <em class="flag warn">(Did not run)</em>';
  else if (step.resolvedKeyword === 'Then' && step.checks === 0) flag = ' <em class="flag warn">(Not verified)</em>';
  let html = `<p class="step"><strong>${escapeHtml(keyword)}</strong> ${escapeHtml(rest)}${flag}${inline}</p>`;
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

function scenarioHtml(scenario, key, manyViewports, flowKey, shown, open) {
  let video = '';
  if (scenario.videoFile) {
    video = `<a href="${escapeHtml(scenario.videoFile)}">Video: ${escapeHtml(scenario.videoFile)}</a>`;
  } else if (scenario.chapter) {
    // A link that also works with no script: the browser opens the file at this second.
    const second = Math.floor(scenario.chapter.start);
    video =
      `<a class="chapter" href="${escapeHtml(scenario.chapter.file)}#t=${second}" ` +
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
      const shot = step.shot ? shotHtml(step, scenario, shown) : {};
      return stepHtml(step, shot.inline) + (shot.block ?? '');
    })
    .join('');

  const empty =
    scenario.steps.length === 0
      ? `<p class="bad">This scenario could not start.</p>${scenario.error ? `<pre class="error">${escapeHtml(scenario.error)}</pre>` : ''}`
      : '';

  const passed = scenario.status === 'passed';
  const brief = [
    scenario.covers.join(', '),
    `<span class="${passed ? 'good' : 'bad'}">${passed ? 'Passes' : 'Fails'}</span>`,
  ]
    .filter(Boolean)
    .join(' · ');

  // Folded to one line each when there are many, so the list can be read at a glance.
  return (
    `<article class="scenario" id="${key}" data-block="${key}"><details${open ? ' open' : ''}>` +
    `<summary><h3><span class="scenario-number">${scenario.number}.</span> ${escapeHtml(title)}</h3> <span class="scenario-brief">${brief}</span></summary>` +
    `<div class="scenario-body">${tools({ images: true })}` +
    (video ? `<p class="scenario-meta">${video}</p>` : '') +
    player +
    empty +
    body +
    '</div></details></article>'
  );
}

/** Scenarios are shown open while the page is short. Past this many, only failing ones are. */
export const FOLD_ABOVE = 6;

export function renderPage(model, { flowImage, flowSvg = null, files = [], icon = '' } = {}) {
  embeddedVideoBytes = 0;
  const { meta } = model;
  const manyViewports = meta.viewports.length > 1;
  const markdown = {};
  const parts = [];
  const toc = [];
  const total = model.flows.reduce((sum, flow) => sum + flow.scenarios.length, 0);
  const fold = total > FOLD_ABOVE;
  const scenarioIds = new Map();
  model.flows.forEach((flow, flowIndex) => {
    flow.scenarios.forEach((scenario, index) => {
      if (!scenarioIds.has(scenario.title)) scenarioIds.set(scenario.title, `flow-${flowIndex}-scenario-${index}`);
    });
  });

  // What needs attention comes first. The plain facts are one line under the title.
  const note = rebuiltNote(model);
  const problems = problemLines(model);
  markdown.summary = `## Summary\n\n${summaryMarkdown(model)}`;
  if (problems.length) markdown.summary += `\n\n### To be aware of\n\n${problems.map((line) => `- ${line}`).join('\n')}`;
  if (problems.length || note) {
    parts.push(
      `<section id="summary" data-block="summary">${head('To be aware of')}` +
        (problems.length ? `<ul>${problems.map((line) => `<li>${escapeHtml(line)}</li>`).join('')}</ul>` : '') +
        (note ? `<p class="note">${escapeHtml(note)}</p>` : '') +
        '</section>',
    );
  }

  // Requirements
  const requirementRows = model.requirements
    .map(
      (item) =>
        `<tr><td>${escapeHtml(item.id)}</td><td>${escapeHtml(item.text)}</td><td>${escapeHtml(requirementSource(item.source))}</td>` +
        `<td class="${statusClass(item.status)}">${escapeHtml(requirementStatus(item.status))}</td>` +
        `<td>${item.scenarioTitles.map((title, index) => `<a href="#${scenarioIds.get(title)}">${escapeHtml(item.scenarios[index])}</a>`).join('; ') || 'None'}</td></tr>`,
    )
    .join('');
  markdown.requirements = `## Requirements\n\n${requirementsMarkdown(model)}`;
  parts.push(
    `<section id="requirements" data-block="requirements">${head('Requirements')}` +
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
      `<section id="flow" data-block="flow">${head('User flow', { images: true })}` +
        // The interactive drawing. The picture below it is what gets copied and printed.
        (flowSvg
          ? '<div class="flow-viewer no-copy"><div class="flow-tools">' +
            '<button type="button" data-flow="out" aria-label="Zoom out">−</button>' +
            '<span class="flow-zoom" aria-live="polite">100%</span>' +
            '<button type="button" data-flow="in" aria-label="Zoom in">+</button>' +
            '<button type="button" data-flow="fit">Fit</button>' +
            '<button type="button" data-flow="actual">100%</button>' +
            '<button type="button" data-flow="full">Full screen</button>' +
            '<span class="flow-hint" data-default="Scroll or drag to move. Pinch or Ctrl + scroll to zoom.">Scroll or drag to move. Pinch or Ctrl + scroll to zoom.</span>' +
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
        return scenarioHtml(scenario, scenarioKey, manyViewports, key, shown, !fold || scenario.status !== 'passed');
      })
      .join('');
    const failed = flow.scenarios.filter((scenario) => scenario.status !== 'passed').length;
    const count =
      `<p class="scenario-meta no-copy">${plural(flow.scenarios.length, 'scenario')}` +
      `${failed ? ` · <span class="bad">${failed} failing</span>` : ''} ` +
      '<button type="button" data-fold="open">Open all</button> <button type="button" data-fold="close">Fold all</button></p>';
    toc.push({
      id: key,
      label: `Scenarios: ${flow.name}`,
      items: flow.scenarios.map((scenario, index) => ({
        id: `${key}-scenario-${index}`,
        label: `${scenario.number}. ${manyViewports ? `${scenario.title} (${scenario.viewport.name})` : scenario.title}`,
        passed: scenario.status === 'passed',
      })),
    });
    parts.push(
      `<section id="${key}" data-block="${key}">${head(`Scenarios: ${flow.name}`, { images: true })}${flowVideosHtml(flow, key)}${count}${scenarios}</section>`,
    );
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
          return `<li><strong>${scenario.number}. ${escapeHtml(scenario.title)}</strong>${escapeHtml(ids)}<ul>${steps}</ul></li>`;
        })
        .join('');
      return `${start}<ul>${items}</ul>`;
    })
    .join('');
  // The checklist says the scenarios again as a list, so it starts folded unless it is
  // the format this handoff was set up to use.
  const checklistBody =
    meta.format !== 'checklist'
      ? `<details class="fold"><summary class="no-copy">Show as a checklist</summary>${checklist}</details>`
      : checklist;
  parts.push(`<section id="checklist" data-block="checklist">${head('Acceptance checklist')}${checklistBody}</section>`);

  // States: one row per screen.
  const states = stateRows(model)
    .map(
      (row) =>
        `<tr><td>${escapeHtml(row.screen)}</td><td>${escapeHtml(row.shown.join(', ') || 'None')}</td><td>` +
        (row.rest.map((item) => `<span class="${statusClass(item.status)}">${escapeHtml(item.text)}</span>`).join('; ') || 'None') +
        '</td></tr>',
    )
    .join('');
  markdown.states = `## States\n\n${statesMarkdown(model)}`;
  parts.push(
    `<section id="states" data-block="states">${head('States')}` +
      (states
        ? `<div class="table-wrap"><table><thead><tr><th>Screen</th><th>Shown</th><th>Missing</th></tr></thead><tbody>${states}</tbody></table></div>`
        : '<p>No states were declared.</p>') +
      '</section>',
  );

  // Standard behaviour that was relied on, not tested
  if (model.assumed?.length) {
    markdown.assumed = `## Assumed standard behaviour\n\n${assumedMarkdown(model)}`;
    parts.push(
      `<section id="assumed" data-block="assumed">${head('Assumed standard behaviour')}` +
        `<p>${escapeHtml(ASSUMED_INTRO)}</p>` +
        `<ul>${model.assumed.map((line) => `<li>${escapeHtml(line)}</li>`).join('')}</ul></section>`,
    );
  }

  // Open questions
  markdown.questions = `## Open questions\n\n${questionsMarkdown(model)}`;
  parts.push(
    `<section id="questions" data-block="questions">${head('Open questions')}` +
      (model.openQuestions.length
        ? `<ol>${model.openQuestions.map((question) => `<li>${escapeHtml(question)}</li>`).join('')}</ol>`
        : '<p>None.</p>') +
      '</section>',
  );

  // Files
  if (files.length) {
    markdown.files = `## Files\n\n${filesMarkdown(files)}`;
    parts.push(
      `<section id="files" data-block="files">${head('Files')}` +
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
  // The facts of the run, on one line.
  const line = summaryFacts(model)
    .filter(([label]) => label !== 'Result')
    .map(([label, value, link]) => {
      const text = label === 'Run on' ? `Run on ${value}` : value;
      return link ? `<a href="${escapeHtml(link)}">${escapeHtml(text)}</a>` : escapeHtml(text);
    })
    .join(' · ');

  // The contents, beside the page on a wide screen and above it on a narrow one.
  const entries = [
    problems.length || note ? { id: 'summary', label: `To be aware of${problems.length ? ` (${problems.length})` : ''}` } : null,
    { id: 'requirements', label: 'Requirements' },
    flowImage ? { id: 'flow', label: 'User flow' } : null,
    ...toc,
    { id: 'checklist', label: 'Acceptance checklist' },
    { id: 'states', label: 'States' },
    model.assumed?.length ? { id: 'assumed', label: 'Assumed standard behaviour' } : null,
    { id: 'questions', label: `Open questions${model.openQuestions.length ? ` (${model.openQuestions.length})` : ''}` },
    files.length ? { id: 'files', label: 'Files' } : null,
  ].filter(Boolean);
  const nav =
    '<nav class="toc no-copy" aria-label="Contents"><p class="toc-title">Contents</p><ul>' +
    entries
      .map((entry) => {
        const items = (entry.items ?? [])
          .map(
            (item) =>
              `<li><a href="#${item.id}"><span class="mark ${item.passed ? 'good' : 'bad'}" aria-hidden="true">${item.passed ? '✓' : '✕'}</span>` +
              `<span>${escapeHtml(item.label)}${item.passed ? '' : ' (fails)'}</span></a></li>`,
          )
          .join('');
        return `<li><a href="#${entry.id}">${escapeHtml(entry.label)}</a>${items ? `<ul>${items}</ul>` : ''}</li>`;
      })
      .join('') +
    '</ul></nav>\n';

  // The numbers a reader wants first, each a link to where it is explained.
  const { counts } = model;
  const firstFlow = toc[0]?.id ?? 'summary';
  const failing = toc.flatMap((entry) => entry.items).find((item) => !item.passed);
  const tiles = [
    [`${counts.scenariosPassed} of ${counts.scenarios}`, counts.scenarios === 1 ? 'scenario passes' : 'scenarios pass', failing?.id ?? firstFlow, model.passed ? 'good' : 'bad'],
    [`${counts.requirementsCovered} of ${counts.requirements}`, 'requirements proven', 'requirements', counts.requirementsCovered === counts.requirements ? 'good' : 'warn'],
    [String(counts.statesMissing), counts.statesMissing === 1 ? 'state not shown' : 'states not shown', 'states', counts.statesMissing ? 'warn' : 'good'],
    [String(model.openQuestions.length), model.openQuestions.length === 1 ? 'open question' : 'open questions', 'questions', model.openQuestions.length ? 'warn' : 'good'],
  ];
  const stats =
    '<ul class="stats no-copy">' +
    tiles.map(([value, label, id, tone]) => `<li class="is-${tone}"><a href="#${id}"><strong>${escapeHtml(value)}</strong><span>${escapeHtml(label)}</span></a></li>`).join('') +
    '</ul>';

  return (
    '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8" />\n' +
    '<meta name="viewport" content="width=device-width, initial-scale=1" />\n' +
    `<title>Handoff: ${escapeHtml(meta.title)}</title>\n<style>${STYLE}</style>\n</head>\n<body>\n` +
    nav +
    '<main data-block="all">\n' +
    `<header><div class="head" style="border:0;margin:0;padding:0;align-items:flex-start"><h1>${escapeHtml(meta.title)}</h1>` +
    '<span class="tools no-copy"><button type="button" data-copy="text">Copy whole page as text</button></span></div>' +
    `<p class="meta">${line}</p>${stats}</header>\n` +
    parts.join('\n') +
    `\n<footer class="no-copy">${icon}Made with Specsheet.</footer>\n` +
    '</main>\n' +
    '<div class="lightbox no-copy" role="dialog" aria-modal="true" aria-label="Screenshot">' +
    '<div class="lightbox-bar"><span class="lightbox-title"></span>' +
    '<span><span class="lightbox-tip">Click the picture to zoom</span> <button type="button" data-lightbox="close">Close</button></span></div>' +
    '<img alt="" /></div>\n' +
    `<script type="application/json" id="specsheet-markdown">${blob}</script>\n` +
    `<script>${SCRIPT}</script>\n<script>${VIEW_SCRIPT.replace('(FIT_LABELS_SOURCE)', FIT_LABELS)}</script>\n</body>\n</html>\n`
  );
}
