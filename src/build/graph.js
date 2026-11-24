// The user flow: screens and states as boxes, the actions between them as arrows.
// It is built from the steps that ran, so every arrow is something the run performed.

import fs from 'node:fs';
import { escapeHtml, stripKeyword } from '../util.js';

const NODE = { width: 220, height: 172, thumb: 128 };
// How far a state sits to the right of the state it branches from. The action is
// written on that stretch of line, so it has to hold a short label.
const INDENT = 196;
const LANE = { pad: 14, head: 34, gap: 26 };
const GUTTER = { label: 176, lane: 14, stub: 30 };
const CHIP = { line: 15, pad: 6 };
const PAD = 32;
const HEADER = 64;
const TRUNK = 16;
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
    let used = false;
    let complete = true;
    const path = { nodes: [], edges: [] };
    for (const step of scenario.steps) {
      if (!step.groupPassed) {
        complete = false;
        break;
      }
      if (step.resolvedKeyword === 'When') {
        action = stripKeyword(step.title);
        used = false;
      }
      if (!step.screen) continue;
      const node = addNode(step.screen, step.state);
      if (!previous) starts.add(node.id);
      if (previous && previous.id !== node.id) {
        // One action explains one arrow. A later change with no new action is the
        // prototype moving on by itself, such as "sending" turning into "sent".
        const label = action && !used ? action : action ? AUTO : stripKeyword(step.title);
        used = true;
        const key = `${previous.id}→${node.id}→${label}`;
        if (!edges.has(key)) edges.set(key, { from: previous.id, to: node.id, label, main: false });
        path.edges.push(key);
      }
      if (path.nodes[path.nodes.length - 1] !== node.id) path.nodes.push(node.id);
      previous = node;
    }
    if (complete && path.nodes.length) paths.push(path);
  }

  // The main path: the passing scenario that visits the most screens, then the most states.
  const reach = (path) => new Set(path.nodes.map((id) => nodes.get(id).screen)).size * 1000 + new Set(path.nodes).size;
  const mainPath = paths.reduce((best, path) => (!best || reach(path) > reach(best) ? path : best), null);
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

/**
 * One lane per screen, left to right. Inside a lane the states form a tree: the state a
 * visitor arrives on at the top, and each state it can turn into indented below it, the
 * way folders are drawn. Arrows only ever run forward. An action that goes back, such as
 * closing a dialog or returning to an earlier screen, is a line of text under its state,
 * so a busy flow does not become a knot of crossing lines.
 */
export function layoutGraph(graph) {
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  const screens = laneOrder(graph, byId);
  const laneOf = (id) => screens.indexOf(byId.get(id).screen);

  // Arrows between the same two states are drawn once, with every action on the label.
  const pairs = new Map();
  for (const edge of graph.edges) {
    const key = `${edge.from}→${edge.to}`;
    if (!pairs.has(key)) pairs.set(key, { from: edge.from, to: edge.to, labels: [], main: false });
    const pair = pairs.get(key);
    if (!pair.labels.includes(edge.label)) pair.labels.push(edge.label);
    pair.main ||= edge.main;
  }

  // The tree inside each lane.
  const depth = new Map();
  const parent = new Map();
  const lanes = screens.map((screen, index) => {
    const members = graph.nodes.filter((node) => node.screen === screen);
    const shown = members.filter((node) => !node.missing);
    const inside = [...pairs.values()].filter((pair) => laneOf(pair.from) === index && laneOf(pair.to) === index);
    const ordered = [];
    const visit = (node, level) => {
      depth.set(node.id, level);
      ordered.push(node);
      const children = inside
        .filter((pair) => pair.from === node.id && !depth.has(pair.to))
        .map((pair) => byId.get(pair.to))
        .sort((a, b) => Number(b.main) - Number(a.main) || a.order - b.order);
      // Claim the children first, so a state is drawn under the nearest state that leads to it.
      const mine = children.filter((child) => !depth.has(child.id));
      for (const child of mine) {
        depth.set(child.id, level + 1);
        parent.set(child.id, node.id);
      }
      for (const child of mine) visit(child, level + 1);
    };
    const entry = (node) => (node.main ? 0 : graph.starts.includes(node.id) ? 1 : 2);
    for (const root of [...shown].sort((a, b) => entry(a) - entry(b) || a.order - b.order)) {
      if (!depth.has(root.id)) visit(root, 0);
    }
    const deepest = Math.max(0, ...ordered.map((node) => depth.get(node.id)));
    for (const node of members.filter((item) => item.missing)) {
      depth.set(node.id, Math.min(1, deepest));
      ordered.push(node);
    }
    return { screen, index, nodes: ordered, depth: deepest };
  });

  // Sort every arrow: down the tree, forward to a later screen, or back.
  const tree = [];
  const forward = [];
  const chips = new Map(graph.nodes.map((node) => [node.id, []]));
  for (const pair of pairs.values()) {
    if (parent.get(pair.to) === pair.from) tree.push(pair);
    else if (laneOf(pair.to) > laneOf(pair.from)) forward.push(pair);
    else {
      const target = byId.get(pair.to);
      const where = target.screen === byId.get(pair.from).screen ? target.state ?? target.screen : [target.screen, target.state].filter(Boolean).join(' · ');
      for (const label of pair.labels) chips.get(pair.from).push(wrap(`↩ ${label} → ${where}`, 31, 3));
    }
  }

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
    const width = NODE.width + lane.depth * INDENT;
    let y = top + LANE.head;
    for (const node of lane.nodes) {
      const lines = chips.get(node.id).reduce((sum, chip) => sum + chip.length, 0);
      const extra = lines ? lines * CHIP.line + chips.get(node.id).length * 3 + CHIP.pad : 0;
      positions.set(node.id, { x: x + LANE.pad + depth.get(node.id) * INDENT, y, lane: index, column: index, depth: depth.get(node.id) });
      y += NODE.height + extra + LANE.gap;
    }
    const height = y - LANE.gap + LANE.pad - top;
    bands.push({ screen: lane.screen, x, y: top, width: width + LANE.pad * 2, height });
    bottom = Math.max(bottom, top + height);
    x += width + LANE.pad * 2 + GUTTER.lane + GUTTER.label + channels[index].length * 12 + GUTTER.stub;
  });
  const last = bands[bands.length - 1];
  for (const band of bands) band.height = bottom - top;

  return {
    positions,
    bands,
    tree,
    forward,
    skips,
    chips,
    channels,
    top,
    width: Math.max(560, (last ? last.x + last.width : PAD) + PAD),
    height: bottom + 52,
  };
}

function wrap(text, max, maxLines = 3) {
  const words = String(text).split(/\s+/);
  const lines = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length > max && current) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    kept[maxLines - 1] = `${kept[maxLines - 1].replace(/[.,;:]?$/, '')}…`;
    return kept;
  }
  return lines;
}

function dataUri(file) {
  try {
    return `data:image/png;base64,${fs.readFileSync(file).toString('base64')}`;
  } catch {
    return null;
  }
}

/** A path through the points, with the corners rounded. */
function route(points, radius = 10) {
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

/** An action, written on its arrow. `x` is the left edge of the label and `y` its middle. */
function labelSvg(labels, x, y, max) {
  const lines = wrap(labels.join(' / '), max);
  const width = Math.max(...lines.map((line) => line.length)) * 6.3 + 14;
  const height = lines.length * 15 + 8;
  const auto = labels.length === 1 && labels[0] === AUTO;
  return (
    `<rect x="${x}" y="${y - height / 2}" width="${width}" height="${height}" rx="6" class="edge-label-box"/>` +
    lines
      .map((line, index) => {
        const lineY = y - ((lines.length - 1) * 15) / 2 + index * 15;
        return `<text x="${x + 7}" y="${lineY}" dominant-baseline="central" class="edge-label${auto ? ' edge-label-auto' : ''}">${escapeHtml(line)}</text>`;
      })
      .join('')
  );
}

/** Every arrow of a flow, and the labels that sit on them. */
function edgesSvg(layout, marker) {
  const { positions } = layout;
  const paths = [];
  const labels = [];
  const draw = (points, pair) => {
    paths.push(`<path d="${route(points)}" class="edge${pair.main ? ' edge-main' : ''}" marker-end="url(#${marker})"/>`);
  };

  // Down the tree: out of the bottom of a state, then right into the state it becomes.
  for (const pair of layout.tree) {
    const from = positions.get(pair.from);
    const to = positions.get(pair.to);
    const trunk = from.x + TRUNK;
    const y = to.y + NODE.height / 2;
    draw([[trunk, from.y + NODE.height], [trunk, y], [to.x - 7, y]], pair);
    labels.push(labelSvg(pair.labels, trunk + 12, y, 20));
  }

  // Forward to a later screen: right, along the gap between the lanes, and in from the left.
  const leaving = new Map();
  for (const pair of layout.forward) leaving.set(pair.from, [...(leaving.get(pair.from) ?? []), pair]);
  // An arrow that passes over a screen leaves from the top, since it climbs above the lanes.
  const over = (pair) => (positions.get(pair.to).lane - positions.get(pair.from).lane > 1 ? 0 : 1);
  for (const list of leaving.values()) {
    list.sort((a, b) => over(a) - over(b) || positions.get(a.to).y - positions.get(b.to).y || Number(b.main) - Number(a.main));
  }

  for (const pair of layout.forward) {
    const from = positions.get(pair.from);
    const to = positions.get(pair.to);
    const band = layout.bands[from.lane];
    const edge = band.x + band.width + GUTTER.lane + GUTTER.label;
    const turn = (lane, key) => {
      const side = layout.bands[lane];
      return side.x + side.width + GUTTER.lane + GUTTER.label + 8 + layout.channels[lane].indexOf(key) * 12;
    };
    const list = leaving.get(pair.from);
    const spread = Math.min(56, (NODE.height - 24) / list.length);
    const y1 = from.y + NODE.height / 2 + (list.indexOf(pair) - (list.length - 1) / 2) * spread;
    const y2 = to.y + NODE.height / 2;
    const x1 = from.x + NODE.width;
    const x2 = to.x - 7;
    const into = turn(to.lane - 1, `in:${pair.to}`);
    if (to.lane - from.lane === 1) {
      draw([[x1, y1], [into, y1], [into, y2], [x2, y2]], pair);
    } else {
      const up = turn(from.lane, `up:${pair.from}→${pair.to}`);
      const above = layout.top - 12 - layout.skips.indexOf(pair) * 14;
      draw([[x1, y1], [up, y1], [up, above], [into, above], [into, y2], [x2, y2]], pair);
    }
    labels.push(labelSvg(pair.labels, Math.min(x1 + 12, edge - GUTTER.label + 4), y1, 24));
  }

  // Every line is drawn before any label, so a label is never hidden behind a line.
  return paths.join('') + labels.join('');
}

function nodeSvg(node, position, isStart, chips, prefix, hasChildren) {
  const { x, y } = position;
  const inner = NODE.width - 20;
  const parts = [];
  parts.push(`<rect x="${x}" y="${y}" width="${NODE.width}" height="${NODE.height}" rx="12" class="${node.missing ? 'node node-missing' : 'node'}"/>`);

  const image = node.shot ? dataUri(node.shot) : null;
  if (image) {
    const clip = `${prefix}clip-${node.order}`;
    parts.push(
      `<clipPath id="${clip}"><rect x="${x + 10}" y="${y + 10}" width="${inner}" height="${NODE.thumb}" rx="6"/></clipPath>` +
        `<image href="${image}" x="${x + 10}" y="${y + 10}" width="${inner}" height="${NODE.thumb}" preserveAspectRatio="xMidYMin slice" clip-path="url(#${clip})"/>` +
        `<rect x="${x + 10}" y="${y + 10}" width="${inner}" height="${NODE.thumb}" rx="6" class="thumb-frame"/>`,
    );
  } else {
    parts.push(
      `<rect x="${x + 10}" y="${y + 10}" width="${inner}" height="${NODE.thumb}" rx="6" class="thumb-empty"/>` +
        `<text x="${x + NODE.width / 2}" y="${y + 10 + NODE.thumb / 2}" text-anchor="middle" dominant-baseline="central" class="thumb-text">${escapeHtml(node.note ?? 'No screenshot')}</text>`,
    );
  }

  // The lane names the screen, so the box only names the state.
  const textY = y + 10 + NODE.thumb + 17;
  const name = node.state ?? node.screen;
  const room = isStart ? 20 : 26;
  parts.push(
    `<text x="${x + 12}" y="${textY}" dominant-baseline="central" class="node-state">${escapeHtml(name.length > room ? `${name.slice(0, room - 1)}…` : name)}</text>`,
  );
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
        `<text x="${band.x + LANE.pad}" y="${band.y + LANE.head / 2 + 1}" dominant-baseline="central" class="lane-name">${escapeHtml(band.screen)}</text>`,
    )
    .join('');
  const nodes = graph.nodes
    .map((node) => nodeSvg(node, layout.positions.get(node.id), graph.starts.includes(node.id), layout.chips.get(node.id), prefix, layout.tree.some((pair) => pair.from === node.id)))
    .join('');
  return bands + edgesSvg(layout, marker) + nodes;
}

/** The user flow as a self-contained SVG: one drawing per flow, one under the other. */
export function renderFlowSvg(model, viewportName = model.meta.viewports[0]?.name) {
  const viewport = model.meta.viewports.find((item) => item.name === viewportName);
  const drawings = model.flows.map((flow) => {
    const graph = buildGraph(flow, viewportName);
    return { graph, layout: layoutGraph(graph) };
  });
  const many = drawings.length > 1;
  const width = Math.max(560, ...drawings.map((item) => item.layout.width));
  const subtitle = [
    many ? `${drawings.length} flows` : model.flows[0]?.name,
    viewport ? `${viewport.name}, ${viewport.width} × ${viewport.height}` : null,
  ]
    .filter(Boolean)
    .join(' · ');
  const all = drawings.flatMap((item) => item.graph.nodes);
  const hasMissing = all.some((node) => node.missing);
  const hasMain = drawings.some((item) => item.graph.mainPath.length);
  const hasBack = drawings.some((item) => [...item.layout.chips.values()].some((list) => list.length));

  const style = `
    .bg { fill: #ffffff; }
    .title { font: 600 18px system-ui, -apple-system, 'Segoe UI', sans-serif; fill: #1d1c2b; }
    .subtitle { font: 400 13px system-ui, -apple-system, 'Segoe UI', sans-serif; fill: #5f5e6e; }
    .flow-name { font: 600 15px system-ui, -apple-system, 'Segoe UI', sans-serif; fill: #1d1c2b; }
    .lane { fill: #f7f6fb; stroke: #e6e5ef; }
    .lane-name { font: 600 13px system-ui, -apple-system, 'Segoe UI', sans-serif; fill: #3d3c4d; }
    .node { fill: #ffffff; stroke: #b9b8c6; stroke-width: 1.5; }
    .node-missing { fill: #fbfbfd; stroke: #8a8998; stroke-dasharray: 6 5; }
    .thumb-frame { fill: none; stroke: #dcdbe6; }
    .thumb-empty { fill: #f3f2f8; stroke: #dcdbe6; stroke-dasharray: 4 4; }
    .thumb-text { font: 400 12px system-ui, -apple-system, 'Segoe UI', sans-serif; fill: #5f5e6e; }
    .node-state { font: 600 15px system-ui, -apple-system, 'Segoe UI', sans-serif; fill: #1d1c2b; }
    .start-pill { fill: #eeedfe; }
    .start-text { font: 600 11px system-ui, -apple-system, 'Segoe UI', sans-serif; fill: #3c3489; }
    .edge { fill: none; stroke: #8f89d6; stroke-width: 1.5; }
    .edge-main { stroke: #4a3fb8; stroke-width: 3; }
    .edge-label-box { fill: #ffffff; stroke: #cecbf6; }
    .edge-label { font: 400 12px system-ui, -apple-system, 'Segoe UI', sans-serif; fill: #26215c; }
    .edge-label-auto { font-style: italic; fill: #5f5e6e; }
    .chip { font: 400 12px system-ui, -apple-system, 'Segoe UI', sans-serif; fill: #5f5e6e; }
    .legend { font: 400 12px system-ui, -apple-system, 'Segoe UI', sans-serif; fill: #5f5e6e; }
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

  const legendItems = [['<rect x="0" y="-7" width="22" height="14" rx="4" class="node"/>', 'Shown in a scenario', 30]];
  if (hasMissing) legendItems.push(['<rect x="0" y="-7" width="22" height="14" rx="4" class="node node-missing"/>', 'Needed, but not shown or failing', 30]);
  if (hasMain) legendItems.push(['<path d="M0 0 H22" class="edge edge-main"/>', 'The main path', 30]);
  if (hasBack) legendItems.push(['<text x="0" y="0" dominant-baseline="central" class="chip">↩</text>', 'Goes back to a state already shown', 16]);
  let legendX = PAD;
  const legend = legendItems
    .map(([mark, text, offset]) => {
      const item = `<g transform="translate(${legendX} ${legendY})">${mark}<text x="${offset}" y="0" dominant-baseline="central" class="legend">${text}</text></g>`;
      legendX += offset + text.length * 6.2 + 26;
      return item;
    })
    .join('');

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" class="specsheet-flow" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img">` +
    `<title>User flow: ${escapeHtml(model.meta.title)}</title>` +
    // Scoped to this drawing, so the rules cannot leak into a page it is placed in.
    `<style>${style.replace(/^(\s*)\./gm, '$1.specsheet-flow .')}</style>` +
    `<defs><marker id="arrowhead" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="9" markerHeight="9" markerUnits="userSpaceOnUse" orient="auto-start-reverse"><path d="M1 1 L9 5 L1 9 z" fill="#4a3fb8"/></marker></defs>` +
    `<rect class="bg" width="${width}" height="${height}"/>` +
    `<text x="${PAD}" y="${PAD + 10}" dominant-baseline="central" class="title">User flow: ${escapeHtml(model.meta.title)}</text>` +
    `<text x="${PAD}" y="${PAD + 34}" dominant-baseline="central" class="subtitle">${escapeHtml(subtitle)}</text>` +
    panels +
    legend +
    `</svg>`
  );
}
