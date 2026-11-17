// The user flow: screens and states as boxes, the actions between them as arrows.
// It is built from the steps that ran, so every arrow is something the run performed.

import fs from 'node:fs';
import { escapeHtml, stripKeyword } from '../util.js';

const NODE = { width: 220, height: 184, thumb: 128 };
const GAP = { x: 300, y: 34 };
const PAD = 32;
const HEADER = 56;

const nodeId = (screen, state) => `${screen}/${state ?? ''}`;

/** Nodes and edges for one screen size. */
export function buildGraph(model, viewportName = model.meta.viewports[0]?.name) {
  const nodes = new Map();
  const edges = new Map();
  const starts = new Set();

  const addNode = (screen, state, extra = {}) => {
    const id = nodeId(screen, state);
    if (!nodes.has(id)) nodes.set(id, { id, screen, state, missing: false, shot: null, order: nodes.size, ...extra });
    return nodes.get(id);
  };

  for (const flow of model.flows) {
    for (const scenario of flow.scenarios) {
      if (scenario.viewport?.name !== viewportName) continue;
      let previous = null;
      let action = null;
      for (const step of scenario.steps) {
        if (!step.groupPassed) break;
        if (step.resolvedKeyword === 'When') action = stripKeyword(step.title);
        if (!step.screen) continue;
        const node = addNode(step.screen, step.state);
        if (!previous) starts.add(node.id);
        if (previous && previous.id !== node.id) {
          const label = action ?? stripKeyword(step.title);
          const key = `${previous.id}→${node.id}→${label}`;
          if (!edges.has(key)) edges.set(key, { from: previous.id, to: node.id, label });
        }
        previous = node;
      }
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
          const shots = state.shots.filter((shot) => shot.viewport?.name === viewportName);
          const best = shots.find((shot) => shot.verified) ?? shots[0];
          if (best) nodes.get(id).shot = best.file;
          nodes.get(id).outFile = state.outFile ?? null;
        }
      }
    }
  }

  return { nodes: [...nodes.values()], edges: [...edges.values()], starts: [...starts] };
}

/** Put each node in a column by how many actions it is from a starting screen. */
export function layoutGraph(graph) {
  const level = new Map();
  const queue = [];
  for (const id of graph.starts) {
    level.set(id, 0);
    queue.push(id);
  }
  while (queue.length) {
    const id = queue.shift();
    for (const edge of graph.edges) {
      if (edge.from !== id || level.has(edge.to)) continue;
      level.set(edge.to, level.get(id) + 1);
      queue.push(edge.to);
    }
  }

  // States that no scenario shows sit beside the other states of the same screen.
  for (const node of graph.nodes) {
    if (level.has(node.id)) continue;
    const siblings = graph.nodes.filter((other) => other.screen === node.screen && level.has(other.id));
    const deepest = siblings.length ? Math.max(...siblings.map((other) => level.get(other.id))) : 0;
    level.set(node.id, graph.nodes.length > 1 ? Math.max(deepest, 1) : 0);
  }

  const columns = [];
  for (const node of [...graph.nodes].sort((a, b) => Number(a.missing) - Number(b.missing) || a.order - b.order)) {
    const column = level.get(node.id);
    (columns[column] ??= []).push(node);
  }
  for (let index = 0; index < columns.length; index += 1) columns[index] ??= [];

  const tallest = Math.max(1, ...columns.map((column) => column.length));
  const innerHeight = tallest * NODE.height + (tallest - 1) * GAP.y;
  const positions = new Map();
  columns.forEach((column, columnIndex) => {
    const height = column.length * NODE.height + Math.max(0, column.length - 1) * GAP.y;
    const top = PAD + HEADER + (innerHeight - height) / 2;
    column.forEach((node, row) => {
      positions.set(node.id, {
        x: PAD + columnIndex * (NODE.width + GAP.x),
        y: top + row * (NODE.height + GAP.y),
        column: columnIndex,
      });
    });
  });

  const columnCount = Math.max(1, columns.length);
  return {
    positions,
    width: PAD * 2 + columnCount * NODE.width + (columnCount - 1) * GAP.x,
    height: PAD * 2 + HEADER + innerHeight + 34,
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

function edgeSvg(edge, positions, index) {
  const from = positions.get(edge.from);
  const to = positions.get(edge.to);
  if (!from || !to) return { path: '', label: '' };
  const lines = wrap(edge.label, 24);
  const labelWidth = Math.max(...lines.map((line) => line.length)) * 6.3 + 14;
  const labelHeight = lines.length * 15 + 8;
  let path;
  let labelX;
  let labelY;

  if (to.column > from.column) {
    // Leave the source, change height close to it, then run straight into the target.
    // The label sits on the straight part, so other arrows do not pass behind it.
    const x1 = from.x + NODE.width;
    const y1 = from.y + NODE.height / 2;
    const x2 = to.x - 7;
    const y2 = to.y + NODE.height / 2;
    const bend = x1 + 110;
    path = `M ${x1} ${y1} C ${x1 + 80} ${y1}, ${x1 + 40} ${y2}, ${bend} ${y2} L ${x2} ${y2}`;
    labelX = x2 - labelWidth / 2 - 16;
    labelY = y2;
  } else {
    // Back to an earlier screen, or between two states in the same column: loop underneath.
    const x1 = from.x + NODE.width / 2 + 24;
    const y1 = from.y + NODE.height;
    const x2 = to.x + NODE.width / 2 - 24;
    const y2 = to.y + NODE.height + 7;
    const dip = Math.max(y1, y2) + 46 + (index % 3) * 16;
    path = `M ${x1} ${y1} C ${x1} ${dip}, ${x2} ${dip}, ${x2} ${y2}`;
    labelX = (x1 + x2) / 2;
    labelY = dip - 12;
  }

  const text = lines
    .map((line, lineIndex) => {
      const y = labelY - ((lines.length - 1) * 15) / 2 + lineIndex * 15;
      return `<text x="${labelX}" y="${y}" text-anchor="middle" dominant-baseline="central" class="edge-label">${escapeHtml(line)}</text>`;
    })
    .join('');

  return {
    path: `<path d="${path}" class="edge" marker-end="url(#arrowhead)"/>`,
    label:
      `<rect x="${labelX - labelWidth / 2}" y="${labelY - labelHeight / 2}" width="${labelWidth}" height="${labelHeight}" rx="6" class="edge-label-box"/>` +
      text,
  };
}

function nodeSvg(node, position, isStart) {
  const { x, y } = position;
  const inner = NODE.width - 20;
  const parts = [];
  parts.push(`<rect x="${x}" y="${y}" width="${NODE.width}" height="${NODE.height}" rx="12" class="${node.missing ? 'node node-missing' : 'node'}"/>`);

  const image = node.shot ? dataUri(node.shot) : null;
  if (image) {
    const clip = `clip-${node.order}`;
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

  const textY = y + 10 + NODE.thumb + 16;
  parts.push(
    `<text x="${x + 12}" y="${textY}" dominant-baseline="central" class="node-screen">${escapeHtml(node.screen)}</text>` +
      `<text x="${x + 12}" y="${textY + 19}" dominant-baseline="central" class="node-state">${escapeHtml(node.state ?? '')}</text>`,
  );
  if (isStart) {
    parts.push(
      `<rect x="${x + NODE.width - 56}" y="${textY - 10}" width="44" height="20" rx="10" class="start-pill"/>` +
        `<text x="${x + NODE.width - 34}" y="${textY}" text-anchor="middle" dominant-baseline="central" class="start-text">Start</text>`,
    );
  }
  // One group per node, so the handoff page can make each screen clickable.
  const label = [node.screen, node.state].filter(Boolean).join(' · ');
  return (
    `<g class="flow-node${node.missing ? ' flow-node-missing' : ''}" tabindex="0" role="button" ` +
    `data-label="${escapeHtml(label)}" data-file="${escapeHtml(node.outFile ?? '')}" data-note="${escapeHtml(node.note ?? '')}">` +
    `<title>${escapeHtml(label)}</title>${parts.join('')}</g>`
  );
}

/** The user flow as a self-contained SVG. */
export function renderFlowSvg(model, viewportName = model.meta.viewports[0]?.name) {
  const graph = buildGraph(model, viewportName);
  const layout = layoutGraph(graph);
  const viewport = model.meta.viewports.find((item) => item.name === viewportName);
  const subtitle = [
    model.flows.map((flow) => flow.name).join(', '),
    viewport ? `${viewport.name}, ${viewport.width} × ${viewport.height}` : null,
  ]
    .filter(Boolean)
    .join(' · ');
  const hasMissing = graph.nodes.some((node) => node.missing);
  const legendY = layout.height - PAD + 4;

  const style = `
    .bg { fill: #ffffff; }
    .title { font: 600 18px system-ui, -apple-system, 'Segoe UI', sans-serif; fill: #1d1c2b; }
    .subtitle { font: 400 13px system-ui, -apple-system, 'Segoe UI', sans-serif; fill: #5f5e6e; }
    .node { fill: #ffffff; stroke: #b9b8c6; stroke-width: 1.5; }
    .node-missing { fill: #fbfbfd; stroke: #8a8998; stroke-dasharray: 6 5; }
    .thumb-frame { fill: none; stroke: #dcdbe6; }
    .thumb-empty { fill: #f3f2f8; stroke: #dcdbe6; stroke-dasharray: 4 4; }
    .thumb-text { font: 400 12px system-ui, -apple-system, 'Segoe UI', sans-serif; fill: #5f5e6e; }
    .node-screen { font: 400 12px system-ui, -apple-system, 'Segoe UI', sans-serif; fill: #5f5e6e; }
    .node-state { font: 600 15px system-ui, -apple-system, 'Segoe UI', sans-serif; fill: #1d1c2b; }
    .start-pill { fill: #eeedfe; }
    .start-text { font: 600 11px system-ui, -apple-system, 'Segoe UI', sans-serif; fill: #3c3489; }
    .edge { fill: none; stroke: #534ab7; stroke-width: 1.75; }
    .edge-label-box { fill: #ffffff; stroke: #cecbf6; }
    .edge-label { font: 400 12px system-ui, -apple-system, 'Segoe UI', sans-serif; fill: #26215c; }
    .legend { font: 400 12px system-ui, -apple-system, 'Segoe UI', sans-serif; fill: #5f5e6e; }
  `;

  const nodes = graph.nodes
    .map((node) => nodeSvg(node, layout.positions.get(node.id), graph.starts.includes(node.id)))
    .join('');
  // Every arrow is drawn before any label, so a label is never hidden behind a line.
  const drawn = graph.edges.map((edge, index) => edgeSvg(edge, layout.positions, index));
  const edges = drawn.map((item) => item.path).join('') + drawn.map((item) => item.label).join('');

  const legend =
    `<rect x="${PAD}" y="${legendY - 7}" width="22" height="14" rx="4" class="node"/>` +
    `<text x="${PAD + 30}" y="${legendY}" dominant-baseline="central" class="legend">Shown in a scenario</text>` +
    (hasMissing
      ? `<rect x="${PAD + 170}" y="${legendY - 7}" width="22" height="14" rx="4" class="node node-missing"/>` +
        `<text x="${PAD + 200}" y="${legendY}" dominant-baseline="central" class="legend">Needed, but not shown or failing</text>`
      : '');

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" class="specsheet-flow" width="${layout.width}" height="${layout.height}" viewBox="0 0 ${layout.width} ${layout.height}" role="img">` +
    `<title>User flow: ${escapeHtml(model.meta.title)}</title>` +
    // Scoped to this drawing, so the rules cannot leak into a page it is placed in.
    `<style>${style.replace(/^(\s*)\./gm, '$1.specsheet-flow .')}</style>` +
    `<defs><marker id="arrowhead" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M1 1 L9 5 L1 9 z" fill="#534ab7"/></marker></defs>` +
    `<rect class="bg" width="${layout.width}" height="${layout.height}"/>` +
    `<text x="${PAD}" y="${PAD + 10}" dominant-baseline="central" class="title">User flow: ${escapeHtml(model.meta.title)}</text>` +
    `<text x="${PAD}" y="${PAD + 34}" dominant-baseline="central" class="subtitle">${escapeHtml(subtitle)}</text>` +
    edges +
    nodes +
    legend +
    `</svg>`
  );
}
