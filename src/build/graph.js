// The user flow: screens and states as boxes, the actions between them as arrows.
// It is built from the steps that ran, so every arrow is something the run performed.

import fs from 'node:fs';
import { escapeHtml, stripKeyword } from '../util.js';

// A state's box is wider for a wide screen and narrower for a phone, the way frames sit
// on a design canvas.
const NODE = { wide: 250, narrow: 190, text: 46 };
// Sizes of the words on the drawing, and the width one character takes at each.
const TEXT = { label: 14, labelLine: 17, chip: 13, name: 16 };
// A preview shows the whole screenshot, in its own proportions, up to this many times its
// width. Past that it is cut at the bottom and fades out, to say there is more.
const THUMB = { min: 96, wide: 1.2, narrow: 2.2 };
// A decision: a small diamond with its question beside it, and one branch per answer.
const DECISION = { offset: 60, radius: 16, row: 60, branch: 40, width: 340 };
// How far a state sits to the right of the state it branches from. The action is
// written on that stretch of line, so it has to hold a short label.
const INDENT = 224;
const LANE = { pad: 14, head: 40, gap: 28 };
const GUTTER = { label: 190, lane: 14, stub: 30 };
const CHIP = { line: 16, pad: 7 };
const PAD = 32;
const HEADER = 64;
const TRUNK = 24;
const AUTO = 'Automatically';

const nodeId = (screen, state) => `${screen}/${state ?? ''}`;

/**
 * Nodes and edges of one flow, for one screen size. `main` marks the path of the
 * scenario that goes furthest through the flow: the one a reader should follow first.
 */
export function buildGraph(flow, viewportName) {
  const nodes = new Map();
  const edges = new Map();
  const starts = new Set();
  const paths = [];

  const addNode = (screen, state, extra = {}) => {
    const id = nodeId(screen, state);
    if (!nodes.has(id)) nodes.set(id, { id, screen, state, missing: false, main: false, shot: null, order: nodes.size, ...extra });
    return nodes.get(id);
  };

  for (const scenario of flow.scenarios) {
    if (viewportName && scenario.viewport?.name !== viewportName) continue;
    let previous = null;
    let action = null;
    let choice = null;
    let used = false;
    // A scenario can fail after its last step, with every step passing. It is still not a path to follow.
    let complete = scenario.status === 'passed';
    const path = { nodes: [], edges: [] };
    for (const step of scenario.steps) {
      if (!step.groupPassed) {
        complete = false;
        break;
      }
      if (step.resolvedKeyword === 'When') {
        action = stripKeyword(step.title);
        choice = step.decision && step.answer ? { question: step.decision, answer: step.answer } : null;
        used = false;
      }
      if (!step.screen) continue;
      const node = addNode(step.screen, step.state);
      if (!previous) starts.add(node.id);
      if (previous && previous.id !== node.id) {
        // One action explains one arrow. A later change with no new action is the
        // prototype moving on by itself, such as "sending" turning into "sent".
        const label = (action && !used ? action : action ? AUTO : stripKeyword(step.title)) || step.title.trim() || AUTO;
        const decision = action && !used ? choice : null;
        used = true;
        const key = `${previous.id}→${node.id}→${label}${decision ? `→${decision.question}→${decision.answer}` : ''}`;
        if (!edges.has(key)) edges.set(key, { from: previous.id, to: node.id, label, main: false, decision });
        path.edges.push(key);
      }
      if (path.nodes[path.nodes.length - 1] !== node.id) path.nodes.push(node.id);
      previous = node;
    }
    if (complete && path.nodes.length) paths.push(path);
  }

  // The main path: the passing scenario that visits the most screens, then the most states.
  const screensOf = (path) => new Set(path.nodes.map((id) => nodes.get(id).screen)).size;
  const statesOf = (path) => new Set(path.nodes).size;
  const further = (path, best) => screensOf(path) > screensOf(best) || (screensOf(path) === screensOf(best) && statesOf(path) > statesOf(best));
  const mainPath = paths.reduce((best, path) => (!best || further(path, best) ? path : best), null);
  if (mainPath && mainPath.edges.length) {
    for (const id of mainPath.nodes) nodes.get(id).main = true;
    for (const key of mainPath.edges) edges.get(key).main = true;
  }

  for (const screen of flow.screens) {
    for (const state of screen.states) {
      const id = nodeId(screen.name, state.name);
      if (state.status === 'missing' || state.status === 'failing') {
        addNode(screen.name, state.name, {
          missing: true,
          note: state.status === 'failing' ? 'Fails in a scenario' : 'Not shown by any scenario',
        });
      } else if (state.status === 'reached' && nodes.has(id)) {
        const shots = state.shots.filter((shot) => !viewportName || shot.viewport?.name === viewportName);
        const best = shots.find((shot) => shot.verified) ?? shots[0];
        if (best) nodes.get(id).shot = best.file;
        nodes.get(id).outFile = state.outFile ?? null;
      }
    }
  }

  return {
    name: flow.name,
    nodes: [...nodes.values()],
    edges: [...edges.values()],
    starts: [...starts],
    mainPath: mainPath?.edges.length ? mainPath.nodes : [],
  };
}

/** The order of the screens, left to right: the main path first, the rest after the screen that leads to them. */
function laneOrder(graph, byId) {
  const order = [];
  for (const id of graph.mainPath) {
    const screen = byId.get(id).screen;
    if (!order.includes(screen)) order.push(screen);
  }
  let waiting = [...new Set(graph.nodes.map((node) => node.screen))].filter((screen) => !order.includes(screen));
  while (waiting.length) {
    let placed = false;
    for (const screen of waiting) {
      const before = graph.edges
        .filter((edge) => byId.get(edge.to).screen === screen && byId.get(edge.from).screen !== screen)
        .map((edge) => order.indexOf(byId.get(edge.from).screen));
      const known = before.filter((index) => index >= 0);
      const isStart = graph.starts.some((id) => byId.get(id).screen === screen);
      if (!known.length && before.length && !isStart) continue;
      if (known.length) order.splice(Math.max(...known) + 1, 0, screen);
      else order.push(screen);
      waiting = waiting.filter((item) => item !== screen);
      placed = true;
      break;
    }
    if (!placed) order.push(waiting.shift());
  }
  return order;
}

/** The width and height of a PNG file, read from its first bytes. */
function pngSize(file) {
  try {
    const handle = fs.openSync(file, 'r');
    const head = Buffer.alloc(24);
    fs.readSync(handle, head, 0, 24, 0);
    fs.closeSync(handle);
    if (head.toString('ascii', 12, 16) !== 'IHDR') return null;
    return { width: head.readUInt32BE(16), height: head.readUInt32BE(20) };
  } catch {
    return null;
  }
}

/**
 * The size of each state's box. Its preview has the proportions of its own screenshot, so
 * a long page is drawn long and a dialog short, and a state with no screenshot takes the
 * proportions of the screen size.
 */
function nodeSizes(graph, viewport) {
  const portrait = Boolean(viewport?.width && viewport?.height && viewport.height > viewport.width);
  const width = portrait ? NODE.narrow : NODE.wide;
  const inner = width - 20;
  const screen = viewport?.width && viewport?.height ? viewport.height / viewport.width : 0.64;
  const limit = inner * (portrait ? THUMB.narrow : THUMB.wide);
  const sizes = new Map();
  for (const node of graph.nodes) {
    const image = node.shot ? pngSize(node.shot) : null;
    const full = inner * (image ? image.height / image.width : screen);
    // A real screenshot keeps its shape even when it is short. Only an empty box has a least height.
    const thumb = Math.round(Math.min(limit, Math.max(image ? 24 : THUMB.min, full)));
    sizes.set(node.id, { width, thumb, height: thumb + NODE.text, cut: full > limit + 1 });
  }
  return { width, sizes };
}

/**
 * One lane per screen, left to right. Inside a lane the states form a tree: the state a
 * visitor arrives on at the top, and each state it can turn into indented below it, the
 * way folders are drawn. Where the scenarios name a decision, its question is drawn once
 * and each answer is a branch. Arrows only ever run forward. An action that goes back,
 * such as closing a dialog or returning to an earlier screen, is a line of text under its
 * state, so a busy flow does not become a knot of crossing lines.
 */
export function layoutGraph(graph, viewport) {
  const { width: boxWidth, sizes } = nodeSizes(graph, viewport);
  const chipRoom = boxWidth - TRUNK - 14;
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  const screens = laneOrder(graph, byId);
  const laneOf = (id) => screens.indexOf(byId.get(id).screen);

  // Arrows between the same two states are drawn once, with every action on the label.
  const pairs = new Map();
  for (const edge of graph.edges) {
    // A decision's arrows are kept apart from plain ones, and one question from another.
    const key = `${edge.from}→${edge.to}${edge.decision ? `→${edge.decision.question}` : ''}`;
    if (!pairs.has(key)) {
      const decision = edge.decision ? { question: edge.decision.question, answers: [] } : null;
      pairs.set(key, { from: edge.from, to: edge.to, labels: [], main: false, decision });
    }
    const pair = pairs.get(key);
    if (!pair.labels.includes(edge.label)) pair.labels.push(edge.label);
    if (edge.decision && !pair.decision.answers.includes(edge.decision.answer)) pair.decision.answers.push(edge.decision.answer);
    pair.main ||= edge.main;
  }
  const leavingFrom = (id) => [...pairs.values()].filter((pair) => pair.from === id);
  const backText = (pair) => {
    const target = byId.get(pair.to);
    return target.screen === byId.get(pair.from).screen ? target.state ?? target.screen : [target.screen, target.state].filter(Boolean).join(' · ');
  };

  // The tree inside each lane, as rows from top to bottom: states, decisions, and the
  // answers of a decision that lead out of the lane or back.
  const depth = new Map();
  const parent = new Map();
  const tree = [];
  const forward = [];
  const decisions = [];
  const chips = new Map(graph.nodes.map((node) => [node.id, []]));
  const lanes = screens.map((screen, index) => {
    const members = graph.nodes.filter((node) => node.screen === screen);
    const shown = members.filter((node) => !node.missing);
    const rows = [];
    const notes = [];
    const visit = (node, level) => {
      depth.set(node.id, level);
      rows.push({ kind: 'node', node });
      const out = leavingFrom(node.id).sort((a, b) => Number(b.main) - Number(a.main) || byId.get(a.to).order - byId.get(b.to).order);
      // Claim the children first, so a state is drawn under the nearest state that leads to it.
      const mine = [];
      for (const pair of out) {
        if (laneOf(pair.to) !== index || depth.has(pair.to)) continue;
        mine.push(pair);
        depth.set(pair.to, level + 1);
        parent.set(pair.to, node.id);
      }
      const plain = out.filter((pair) => !pair.decision);
      for (const pair of plain) {
        if (mine.includes(pair)) {
          tree.push(pair);
          visit(byId.get(pair.to), level + 1);
        } else if (laneOf(pair.to) > index) {
          forward.push(pair);
        } else {
          for (const label of pair.labels) notes.push({ from: node.id, to: pair.to, text: `${label} → ${backText(pair)}` });
        }
      }
      // Decisions come last, so the line down to the other states does not pass through them.
      const questions = [...new Set(out.filter((pair) => pair.decision).map((pair) => pair.decision.question))];
      for (const question of questions) {
        const answers = out.filter((pair) => pair.decision?.question === question);
        const decision = { from: node.id, question, lines: wrap(question, DECISION.width - DECISION.offset - DECISION.radius - 14, 15, { bold: true }), main: answers.some((pair) => pair.main), branches: [] };
        decisions.push(decision);
        rows.push({ kind: 'decision', decision });
        for (const pair of answers) {
          const branch = { pair, answer: pair.decision.answers.join(' / '), kind: 'state' };
          decision.branches.push(branch);
          if (mine.includes(pair)) {
            visit(byId.get(pair.to), level + 1);
            continue;
          }
          branch.kind = laneOf(pair.to) > index ? 'forward' : 'back';
          if (branch.kind === 'forward') forward.push(pair);
          else notes.push({ branch, to: pair.to, from: node.id, text: backText(pair) });
          pair.branch = branch;
          rows.push({ kind: 'branch', branch });
        }
      }
    };
    const entry = (node) => (node.main ? 0 : graph.starts.includes(node.id) ? 1 : 2);
    for (const root of [...shown].sort((a, b) => entry(a) - entry(b) || a.order - b.order)) {
      if (!depth.has(root.id)) visit(root, 0);
    }
    const deepest = Math.max(0, ...shown.map((node) => depth.get(node.id)));
    for (const node of members.filter((item) => item.missing)) {
      depth.set(node.id, Math.min(1, deepest));
      rows.push({ kind: 'node', node });
    }
    // An arrow that is not drawn is a note. It goes back, unless the state it leads to
    // sits further down the same lane, where "back" would be wrong.
    const rowOf = (id) => rows.findIndex((row) => row.kind === 'node' && row.node.id === id);
    for (const note of notes) {
      const down = laneOf(note.to) === index && rowOf(note.to) > rowOf(note.from);
      const mark = down ? '↳' : '↩';
      if (note.branch) note.branch.back = `${mark} ${note.text}`;
      else chips.get(note.from).push(wrap(`${mark} ${note.text}`, chipRoom, TEXT.chip));
    }
    // The lane is as wide as whatever reaches furthest right: a state, or a question.
    const asked = rows.filter((row) => row.kind === 'decision').map((row) => depth.get(row.decision.from) * INDENT + DECISION.width);
    return { screen, index, rows, width: Math.max(boxWidth + deepest * INDENT, ...asked) };
  });

  // Arrows that pass over a whole screen travel above the lanes, each at its own height.
  const skips = forward.filter((pair) => laneOf(pair.to) - laneOf(pair.from) > 1);
  const top = PAD + HEADER + (skips.length ? skips.length * 14 + 8 : 0);

  // Where the lanes sit. The room between two lanes depends on how many arrows turn there.
  const channels = lanes.map(() => []);
  const channel = (gutter, key) => {
    if (!channels[gutter].includes(key)) channels[gutter].push(key);
    return channels[gutter].indexOf(key);
  };
  for (const pair of forward) {
    const from = laneOf(pair.from);
    const to = laneOf(pair.to);
    if (to - from > 1) channel(from, `up:${pair.from}→${pair.to}`);
    channel(to - 1, `in:${pair.to}`);
  }
  const positions = new Map();
  const bands = [];
  let x = PAD;
  let bottom = top;
  lanes.forEach((lane, index) => {
    let y = top + LANE.head;
    lane.rows.forEach((row, at) => {
      const next = lane.rows[at + 1];
      if (row.kind === 'node') {
        const { node } = row;
        const lines = chips.get(node.id).reduce((sum, chip) => sum + chip.length, 0);
        const extra = lines ? lines * CHIP.line + chips.get(node.id).length * 3 + CHIP.pad : 0;
        positions.set(node.id, { x: x + LANE.pad + depth.get(node.id) * INDENT, y, lane: index, column: index, depth: depth.get(node.id) });
        y += sizes.get(node.id).height + extra + (next && next.kind !== 'node' ? 8 : LANE.gap);
      } else if (row.kind === 'decision') {
        const from = positions.get(row.decision.from);
        row.decision.x = from.x + DECISION.offset;
        row.decision.y = y + DECISION.row / 2;
        row.decision.lane = index;
        y += DECISION.row;
      } else {
        row.branch.y = y + DECISION.branch / 2;
        y += DECISION.branch + (next && next.kind === 'branch' ? 0 : LANE.gap - 8);
      }
      if (!next) y += row.kind === 'node' ? 0 : 8;
    });
    const last = lane.rows[lane.rows.length - 1];
    const height = y - (last?.kind === 'node' ? LANE.gap : 0) + LANE.pad - top;
    bands.push({ screen: lane.screen, x, y: top, width: lane.width + LANE.pad * 2, height });
    bottom = Math.max(bottom, top + height);
    x += lane.width + LANE.pad * 2 + GUTTER.lane + GUTTER.label + channels[index].length * 12 + GUTTER.stub;
  });
  const last = bands[bands.length - 1];
  for (const band of bands) band.height = bottom - top;

  return {
    boxWidth,
    sizes,
    positions,
    bands,
    tree,
    forward,
    skips,
    decisions,
    chips,
    channels,
    top,
    width: Math.max(560, (last ? last.x + last.width : PAD) + PAD),
    height: bottom + 52,
  };
}

// How wide each character is, in thousandths of the font size, for the kind of plain
// sans-serif the drawing is set in. It is what lets a box be drawn to fit its words
// without a browser to measure them. Where a browser is at hand, fitLabels corrects it.
const WIDTHS = { narrow: "ijl|.,:;'!", slim: 'ftrI ()[]/-·"', wide: 'mwMW@', broad: '→↩…' };
function charWidth(char) {
  if (WIDTHS.narrow.includes(char)) return 250;
  if (WIDTHS.slim.includes(char)) return 320;
  if (WIDTHS.wide.includes(char)) return 860;
  if (WIDTHS.broad.includes(char)) return 1000;
  if (char >= 'A' && char <= 'Z') return 680;
  if (char >= '0' && char <= '9') return 580;
  return char.charCodeAt(0) > 0x2e7f ? 1000 : 550;
}

/** About how many pixels a line of text takes at a font size. */
export function textWidth(text, size, bold = false) {
  let total = 0;
  for (const char of String(text)) total += charWidth(char);
  return (total / 1000) * size * (bold ? 1.06 : 1);
}

/** Break text into lines no wider than `room` pixels. Past `maxLines`, the last line ends in "…". */
function wrap(text, room, size, { bold = false, maxLines = 3 } = {}) {
  const fits = (line) => textWidth(line, size, bold) <= room;
  const lines = [];
  let current = '';
  for (const word of String(text).split(/\s+/)) {
    const candidate = current ? `${current} ${word}` : word;
    if (!fits(candidate) && current) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  const kept = lines.slice(0, maxLines);
  const cut = (line, more) => {
    let out = line;
    while (out.length > 1 && !fits(`${out}${more ? '…' : ''}`)) out = out.slice(0, -1);
    return out === line && !more ? line : `${out.replace(/[\s.,;:]+$/, '')}…`;
  };
  return kept.map((line, index) => cut(line, index === kept.length - 1 && lines.length > maxLines));
}

/**
 * Run in a browser, on the drawing: make every label's box fit its words as that browser
 * draws them, keeping each box centred where it was. The sizes worked out above are close,
 * and fonts differ from one computer to the next.
 */
export const FIT_LABELS = `(function (root) {
  root.querySelectorAll('g.flow-label').forEach(function (label) {
    var box = label.querySelector('rect');
    var lines = label.querySelectorAll('text.edge-label');
    var widest = 0;
    lines.forEach(function (line) { widest = Math.max(widest, line.getComputedTextLength()); });
    if (!box || !widest) return;
    var width = Math.ceil(widest) + 2 * Number(label.dataset.pad);
    var left = label.dataset.left ? Number(label.dataset.left) : Number(label.dataset.center) - width / 2;
    box.setAttribute('x', left);
    box.setAttribute('width', width);
    lines.forEach(function (line) { line.setAttribute('x', left + width / 2); });
    var trail = label.querySelector('text.trail');
    if (trail) trail.setAttribute('x', left + width + 10);
  });
})`;

function dataUri(file) {
  try {
    return `data:image/png;base64,${fs.readFileSync(file).toString('base64')}`;
  } catch {
    return null;
  }
}

/** A path through the points, with the corners rounded. */
function route(points, radius = 16) {
  const clean = points.filter((point, index) => index === 0 || point[0] !== points[index - 1][0] || point[1] !== points[index - 1][1]);
  let path = `M ${clean[0][0]} ${clean[0][1]}`;
  for (let index = 1; index < clean.length - 1; index += 1) {
    const [px, py] = clean[index - 1];
    const [x, y] = clean[index];
    const [nx, ny] = clean[index + 1];
    const before = Math.min(radius, Math.hypot(x - px, y - py) / 2);
    const after = Math.min(radius, Math.hypot(nx - x, ny - y) / 2);
    const ax = x - Math.sign(x - px) * before;
    const ay = y - Math.sign(y - py) * before;
    const bx = x + Math.sign(nx - x) * after;
    const by = y + Math.sign(ny - y) * after;
    path += ` L ${ax} ${ay} Q ${x} ${y} ${bx} ${by}`;
  }
  const end = clean[clean.length - 1];
  return `${path} L ${end[0]} ${end[1]}`;
}

const LABEL = { pad: 12, margin: 12 };

/**
 * An action, written on its arrow: words centred in a box that sits on the line. The box
 * is centred between `from` and `to`, the ends of the stretch of line it sits on, or
 * starts at `from` when `to` is not given. `trail` is plain text that follows the box.
 */
function labelSvg(labels, y, { from, to = null, room = 170, tone = '', maxLines = 3, trail = '' }) {
  const space = to === null ? room : Math.max(60, to - from - 2 * LABEL.margin - 2 * LABEL.pad);
  const lines = wrap(labels.join(' / '), space, TEXT.label, { bold: Boolean(tone), maxLines });
  if (!lines.length) return '';
  const width = Math.ceil(Math.max(...lines.map((line) => textWidth(line, TEXT.label, Boolean(tone))))) + 2 * LABEL.pad;
  const height = lines.length * TEXT.labelLine + 10;
  const left = to === null ? from : (from + to) / 2 - width / 2;
  const center = left + width / 2;
  const auto = labels.length === 1 && labels[0] === AUTO;
  const place = to === null ? `data-left="${left}"` : `data-center="${center}"`;
  return (
    `<g class="flow-label" data-pad="${LABEL.pad}" ${place}>` +
    `<rect x="${left}" y="${y - height / 2}" width="${width}" height="${height}" rx="${lines.length === 1 ? height / 2 : 10}" class="edge-label-box${tone ? ` answer-${tone}` : ''}"/>` +
    lines
      .map((line, index) => {
        const lineY = y - ((lines.length - 1) * TEXT.labelLine) / 2 + index * TEXT.labelLine + 0.5;
        return (
          `<text x="${center}" y="${lineY}" text-anchor="middle" dominant-baseline="central" ` +
          `class="edge-label${auto ? ' edge-label-auto' : ''}${tone ? ` answer-text-${tone}` : ''}">${escapeHtml(line)}</text>`
        );
      })
      .join('') +
    (trail ? `<text x="${left + width + 10}" y="${y + 0.5}" dominant-baseline="central" class="chip trail">${escapeHtml(trail)}</text>` : '') +
    '</g>'
  );
}

/** A "Yes" answer is green and a "No" answer is red. Any other answer keeps the plain colour. */
function tone(answer) {
  if (/^(yes|true|ok)\b/i.test(answer.trim())) return 'yes';
  if (/^(no|false)\b/i.test(answer.trim())) return 'no';
  return '';
}

/** Every arrow of a flow, and the labels that sit on them. */
function edgesSvg(layout, marker) {
  const { positions, sizes, boxWidth } = layout;
  const tall = (id) => sizes.get(id).height;
  const paths = [];
  // The main path is drawn last, so where lines meet it is the one on top.
  const mainPaths = [];
  const labels = [];
  // Where a line leaves the bottom of a state, marked with a dot so it reads as joined on.
  const ports = new Set();
  const draw = (points, main, arrow = true) => {
    (main ? mainPaths : paths).push(`<path d="${route(points)}" class="edge${main ? ' edge-main' : ''}"${arrow ? ` marker-end="url(#${marker}${main ? '-main' : ''})"` : ''}/>`);
  };
  const middle = (id) => positions.get(id).y + tall(id) / 2;
  const turn = (lane, key) => {
    const side = layout.bands[lane];
    return side.x + side.width + GUTTER.lane + GUTTER.label + 8 + layout.channels[lane].indexOf(key) * 12;
  };
  /** The rest of the way to a state in a later lane, from a point on the way out of this one. */
  const onward = (pair, lane, y1) => {
    const to = positions.get(pair.to);
    const y2 = middle(pair.to);
    const into = turn(to.lane - 1, `in:${pair.to}`);
    if (to.lane - lane === 1) return [[into, y1], [into, y2], [to.x - 3, y2]];
    const up = turn(lane, `up:${pair.from}→${pair.to}`);
    const above = layout.top - 12 - layout.skips.indexOf(pair) * 14;
    return [[up, y1], [up, above], [into, above], [into, y2], [to.x - 3, y2]];
  };

  // Down the tree: out of the bottom of a state, then right into the state it becomes.
  for (const pair of layout.tree) {
    const from = positions.get(pair.from);
    const to = positions.get(pair.to);
    const trunk = from.x + TRUNK;
    draw([[trunk, from.y + tall(pair.from)], [trunk, middle(pair.to)], [to.x - 3, middle(pair.to)]], pair.main);
    ports.add(`${trunk},${from.y + tall(pair.from)}`);
    labels.push(labelSvg(pair.labels, middle(pair.to), { from: trunk, to: to.x - 16, maxLines: 4 }));
  }

  // Forward to a later screen: right, along the gap between the lanes, and in from the left.
  const plain = layout.forward.filter((pair) => !pair.branch);
  const leaving = new Map();
  for (const pair of plain) leaving.set(pair.from, [...(leaving.get(pair.from) ?? []), pair]);
  // An arrow that passes over a screen leaves from the top, since it climbs above the lanes.
  const over = (pair) => (positions.get(pair.to).lane - positions.get(pair.from).lane > 1 ? 0 : 1);
  for (const list of leaving.values()) {
    list.sort((a, b) => over(a) - over(b) || positions.get(a.to).y - positions.get(b.to).y || Number(b.main) - Number(a.main));
  }
  for (const pair of plain) {
    const from = positions.get(pair.from);
    const list = leaving.get(pair.from);
    const spread = Math.min(66, (tall(pair.from) - 24) / list.length);
    const y1 = middle(pair.from) + (list.indexOf(pair) - (list.length - 1) / 2) * spread;
    const x1 = from.x + boxWidth;
    const way = onward(pair, from.lane, y1);
    draw([[x1, y1], ...way], pair.main);
    // The label sits in the middle of the first straight stretch, but never far from its state.
    labels.push(labelSvg(pair.labels, y1, { from: x1, to: Math.min(way[0][0], x1 + GUTTER.label + 40) }));
  }

  // Decisions: into the diamond from the state, and out of it once for each answer.
  for (const decision of layout.decisions) {
    const from = positions.get(decision.from);
    const trunk = from.x + TRUNK;
    const { x, y } = decision;
    const r = DECISION.radius;
    draw([[trunk, from.y + tall(decision.from)], [trunk, y], [x - r, y]], decision.main, false);
    ports.add(`${trunk},${from.y + tall(decision.from)}`);
    for (const branch of decision.branches) {
      const { pair } = branch;
      if (branch.kind === 'state') {
        const to = positions.get(pair.to);
        draw([[x, y + r], [x, middle(pair.to)], [to.x - 3, middle(pair.to)]], pair.main);
        labels.push(labelSvg([branch.answer], middle(pair.to), { from: x, to: to.x - 16, tone: tone(branch.answer) }));
      } else if (branch.kind === 'forward') {
        draw([[x, y + r], [x, branch.y], ...onward(pair, decision.lane, branch.y)], pair.main);
        labels.push(labelSvg([branch.answer], branch.y, { from: x + 12, room: 120, tone: tone(branch.answer) }));
      } else {
        const room = 120;
        const answer = wrap(branch.answer, room, TEXT.label, { bold: true });
        const end = x + 12 + Math.max(...answer.map((line) => textWidth(line, TEXT.label, true))) + 2 * LABEL.pad;
        draw([[x, y + r], [x, branch.y], [end + 4, branch.y]], pair.main, false);
        const back = wrap(branch.back, 200, TEXT.chip, { maxLines: 1 })[0];
        labels.push(labelSvg([branch.answer], branch.y, { from: x + 12, room, tone: tone(branch.answer), trail: back }));
      }
    }
    labels.push(
      `<path d="M ${x} ${y - r} L ${x + r} ${y} L ${x} ${y + r} L ${x - r} ${y} Z" class="decision${decision.main ? ' decision-main' : ''}"/>` +
        `<text x="${x - 0.4}" y="${y}" text-anchor="middle" dominant-baseline="central" class="decision-mark">?</text>` +
        decision.lines
          .map((line, index) => {
            const lineY = y - ((decision.lines.length - 1) * 18) / 2 + index * 18;
            return `<text x="${x + r + 9}" y="${lineY}" dominant-baseline="central" class="decision-text">${escapeHtml(line)}</text>`;
          })
          .join(''),
    );
  }

  // Every line is drawn before any label, so a label is never hidden behind a line.
  const dots = [...ports].map((at) => `<circle cx="${at.split(',')[0]}" cy="${at.split(',')[1]}" r="3.5" class="port"/>`).join('');
  return { lines: paths.join('') + mainPaths.join(''), marks: dots + labels.join('') };
}

function nodeSvg(node, position, isStart, chips, prefix, hasChildren, size) {
  const { x, y } = position;
  const NODE = size;
  const inner = NODE.width - 20;
  const parts = [];
  parts.push(`<rect x="${x}" y="${y}" width="${NODE.width}" height="${NODE.height}" rx="14" class="${node.missing ? 'node node-missing' : 'node'}"/>`);

  const image = node.shot ? dataUri(node.shot) : null;
  if (image) {
    const clip = `${prefix}clip-${node.order}`;
    parts.push(
      `<clipPath id="${clip}"><rect x="${x + 10}" y="${y + 10}" width="${inner}" height="${NODE.thumb}" rx="6"/></clipPath>` +
        `<image href="${image}" x="${x + 10}" y="${y + 10}" width="${inner}" height="${NODE.thumb}" preserveAspectRatio="xMidYMin slice" clip-path="url(#${clip})"/>` +
        (NODE.cut ? `<rect x="${x + 10}" y="${y + 10 + NODE.thumb - 44}" width="${inner}" height="44" fill="url(#specsheet-fade)" clip-path="url(#${clip})"/>` : '') +
        `<rect x="${x + 10}" y="${y + 10}" width="${inner}" height="${NODE.thumb}" rx="6" class="thumb-frame"/>`,
    );
  } else {
    parts.push(
      `<rect x="${x + 10}" y="${y + 10}" width="${inner}" height="${NODE.thumb}" rx="6" class="thumb-empty"/>` +
        `<text x="${x + NODE.width / 2}" y="${y + 10 + NODE.thumb / 2}" text-anchor="middle" dominant-baseline="central" class="thumb-text">${escapeHtml(node.note ?? 'No screenshot')}</text>`,
    );
  }

  // The lane names the screen, so the box only names the state.
  const textY = y + 10 + NODE.thumb + 18;
  const name = node.state ?? node.screen;
  const shown = wrap(name, NODE.width - 24 - (isStart ? 54 : 0), TEXT.name, { bold: true, maxLines: 1 })[0];
  parts.push(`<text x="${x + 12}" y="${textY}" dominant-baseline="central" class="node-state">${escapeHtml(shown)}</text>`);
  if (isStart) {
    parts.push(
      `<rect x="${x + NODE.width - 56}" y="${textY - 10}" width="44" height="20" rx="10" class="start-pill"/>` +
        `<text x="${x + NODE.width - 34}" y="${textY}" text-anchor="middle" dominant-baseline="central" class="start-text">Start</text>`,
    );
  }

  // Actions that go back, as text under the state they start from.
  let chipY = y + NODE.height + CHIP.pad + CHIP.line / 2;
  let back = '';
  for (const chip of chips) {
    for (const line of chip) {
      back += `<text x="${x + (hasChildren ? TRUNK + 12 : 4)}" y="${chipY}" dominant-baseline="central" class="chip">${escapeHtml(line)}</text>`;
      chipY += CHIP.line;
    }
    chipY += 3;
  }

  // One group per node, so the handoff page can make each screen clickable.
  const label = [node.screen, node.state].filter(Boolean).join(' · ');
  return (
    `<g class="flow-node${node.missing ? ' flow-node-missing' : ''}" tabindex="0" role="button" ` +
    `data-label="${escapeHtml(label)}" data-file="${escapeHtml(node.outFile ?? '')}" data-note="${escapeHtml(node.note ?? '')}">` +
    `<title>${escapeHtml(label)}</title>${parts.join('')}</g>${back}`
  );
}

/** One flow's drawing, without the frame around it. */
function flowSvg(graph, layout, prefix, marker) {
  const bands = layout.bands
    .map(
      (band) =>
        `<rect x="${band.x}" y="${band.y}" width="${band.width}" height="${band.height}" rx="14" class="lane"/>` +
        `<text x="${band.x + LANE.pad}" y="${band.y + LANE.head / 2 + 2}" dominant-baseline="central" class="lane-name">${escapeHtml(band.screen)}</text>`,
    )
    .join('');
  // A state with something below it has a line leaving its bottom edge.
  const hangs = new Set([...layout.tree.map((pair) => pair.from), ...layout.decisions.map((decision) => decision.from)]);
  const nodes = graph.nodes
    .map((node) => nodeSvg(node, layout.positions.get(node.id), graph.starts.includes(node.id), layout.chips.get(node.id), prefix, hangs.has(node.id), layout.sizes.get(node.id)))
    .join('');
  // Lines go under the states, so they tuck in behind the boxes. Labels and dots go on top.
  const edges = edgesSvg(layout, marker);
  return bands + edges.lines + nodes + edges.marks;
}

/** The user flow as a self-contained SVG: one drawing per flow, one under the other. */
export function renderFlowSvg(model, viewportName = model.meta.viewports[0]?.name) {
  const viewport = model.meta.viewports.find((item) => item.name === viewportName);
  const drawings = model.flows.map((flow) => {
    const graph = buildGraph(flow, viewportName);
    return { graph, layout: layoutGraph(graph, viewport) };
  });
  const many = drawings.length > 1;
  const subtitle = [
    many ? `${drawings.length} flows` : model.flows[0]?.name,
    viewport ? `${viewport.name}, ${viewport.width} × ${viewport.height}` : null,
  ]
    .filter(Boolean)
    .join(' · ');
  const all = drawings.flatMap((item) => item.graph.nodes);
  const hasMissing = all.some((node) => node.missing);
  const hasMain = drawings.some((item) => item.graph.mainPath.length);
  const hasBack = drawings.some(
    (item) =>
      [...item.layout.chips.values()].some((list) => list.length) ||
      item.layout.decisions.some((decision) => decision.branches.some((branch) => branch.kind === 'back')),
  );

  const style = `
    .bg { fill: #ffffff; }
    .title { font: 600 20px system-ui, -apple-system, 'Segoe UI', sans-serif; fill: #1a1a1a; }
    .subtitle { font: 400 14px system-ui, -apple-system, 'Segoe UI', sans-serif; fill: #636363; }
    .flow-name { font: 600 15px system-ui, -apple-system, 'Segoe UI', sans-serif; fill: #1a1a1a; }
    .lane { fill: #f7f7f7; stroke: none; }
    .lane-name { font: 600 16px system-ui, -apple-system, 'Segoe UI', sans-serif; fill: #333333; }
    .node { fill: #ffffff; stroke: #d4d4d4; stroke-width: 1; filter: url(#specsheet-lift); }
    .node-missing { fill: #fbfbfb; stroke: #8c8c8c; stroke-dasharray: 6 5; }
    .thumb-frame { fill: none; stroke: #e6e6e6; }
    .thumb-empty { fill: #f1f1f1; stroke: #dedede; stroke-dasharray: 4 4; }
    .thumb-text { font: 400 13px system-ui, -apple-system, 'Segoe UI', sans-serif; fill: #636363; }
    .node-state { font: 600 16px system-ui, -apple-system, 'Segoe UI', sans-serif; fill: #1a1a1a; }
    .start-pill { fill: #e9e9e9; }
    .start-text { font: 600 12px system-ui, -apple-system, 'Segoe UI', sans-serif; fill: #333333; }
    .edge { fill: none; stroke: #a3a3a3; stroke-width: 2.25; stroke-linecap: round; stroke-linejoin: round; }
    .edge-main { stroke: #6b6b6b; stroke-width: 3.5; }
    .port { fill: #a3a3a3; stroke: #ffffff; stroke-width: 2; }
    .edge-label-box { fill: #ffffff; stroke: #d9d9d9; }
    .edge-label { font: 500 13.5px system-ui, -apple-system, 'Segoe UI', sans-serif; fill: #1a1a1a; }
    .decision { fill: #fff8e6; stroke: #b98a1e; stroke-width: 1.5; }
    .decision-main { stroke-width: 2.5; }
    .decision-mark { font: 700 14px system-ui, -apple-system, 'Segoe UI', sans-serif; fill: #7a4708; }
    .decision-text { font: 600 15px system-ui, -apple-system, 'Segoe UI', sans-serif; fill: #1a1a1a; }
    .answer-yes { fill: #e9f6e2; stroke: #5a9a3c; }
    .answer-no { fill: #fdecec; stroke: #c96a6a; }
    .answer-text-yes { fill: #24520d; font-weight: 600; }
    .answer-text-no { fill: #8f2020; font-weight: 600; }
    .edge-label-auto { font-style: italic; fill: #636363; }
    .chip { font: 400 13px system-ui, -apple-system, 'Segoe UI', sans-serif; fill: #636363; }
    .legend { font: 400 13px system-ui, -apple-system, 'Segoe UI', sans-serif; fill: #636363; }
  `;

  let y = 0;
  const panels = drawings
    .map((item, index) => {
      const heading = many
        ? `<text x="${PAD}" y="${y + PAD + HEADER - 14}" dominant-baseline="central" class="flow-name">${escapeHtml(item.graph.name)}</text>`
        : '';
      const panel = `<g transform="translate(0 ${y})">${flowSvg(item.graph, item.layout, `f${index}-`, 'arrowhead')}</g>`;
      y += item.layout.height - 52 + (index < drawings.length - 1 ? 0 : 52);
      return heading + panel;
    })
    .join('');
  const height = y;
  const legendY = height - PAD + 4;
  let width = Math.max(560, ...drawings.map((item) => item.layout.width));

  const legendItems = [['<rect x="0" y="-7" width="22" height="14" rx="4" class="node"/>', 'Shown in a scenario', 30]];
  if (hasMissing) legendItems.push(['<rect x="0" y="-7" width="22" height="14" rx="4" class="node node-missing"/>', 'Needed, but not shown or failing', 30]);
  if (hasMain) legendItems.push(['<path d="M0 0 H22" class="edge edge-main"/>', 'The main path', 30]);
  if (drawings.some((item) => item.layout.decisions.length)) {
    legendItems.push(['<path d="M11 -8 L19 0 L11 8 L3 0 Z" class="decision"/>', 'A decision, with one branch per answer', 30]);
  }
  if (hasBack) legendItems.push(['<text x="0" y="0" dominant-baseline="central" class="chip">↩</text>', 'Leads to a state shown elsewhere', 16]);
  let legendX = PAD;
  const legend = legendItems
    .map(([mark, text, offset]) => {
      const item = `<g transform="translate(${legendX} ${legendY})">${mark}<text x="${offset}" y="0" dominant-baseline="central" class="legend">${text}</text></g>`;
      legendX += offset + textWidth(text, 13) + 26;
      return item;
    })
    .join('');
  // A narrow drawing is widened to hold its legend.
  width = Math.max(width, Math.ceil(legendX - 26 + PAD));

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" class="specsheet-flow" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img">` +
    `<title>User flow: ${escapeHtml(model.meta.title)}</title>` +
    // Scoped to this drawing, so the rules cannot leak into a page it is placed in.
    `<style>${style.replace(/^(\s*)\./gm, '$1.specsheet-flow .')}</style>` +
    `<defs><linearGradient id="specsheet-fade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#fff"/></linearGradient>` +
    `<filter id="specsheet-lift" x="-10%" y="-10%" width="120%" height="130%"><feDropShadow dx="0" dy="1.5" stdDeviation="2.5" flood-color="#000" flood-opacity="0.08"/></filter>` +
    // Solid triangles, sized to the line they finish. The line stops inside the head, so its blunt end never shows.
    `<marker id="arrowhead" viewBox="0 0 16 14" refX="15" refY="7" markerWidth="16" markerHeight="14" markerUnits="userSpaceOnUse" orient="auto-start-reverse"><path d="M1 1 L15 7 L1 13 z" fill="#a3a3a3" stroke="#a3a3a3" stroke-width="1.5" stroke-linejoin="round"/></marker>` +
    `<marker id="arrowhead-main" viewBox="0 0 22 20" refX="21" refY="10" markerWidth="22" markerHeight="20" markerUnits="userSpaceOnUse" orient="auto-start-reverse"><path d="M1.5 1.5 L20.5 10 L1.5 18.5 z" fill="#6b6b6b" stroke="#6b6b6b" stroke-width="2" stroke-linejoin="round"/></marker></defs>` +
    `<rect class="bg" width="${width}" height="${height}"/>` +
    `<text x="${PAD}" y="${PAD + 10}" dominant-baseline="central" class="title">User flow: ${escapeHtml(model.meta.title)}</text>` +
    `<text x="${PAD}" y="${PAD + 34}" dominant-baseline="central" class="subtitle">${escapeHtml(subtitle)}</text>` +
    panels +
    legend +
    `</svg>`
  );
}
