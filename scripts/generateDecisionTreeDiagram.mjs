import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { jsPDF } from 'jspdf';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const outDir = path.join(repoRoot, 'docs');

const NODE_W = 340;
const NODE_H = 124;
const COL_GAP = 170;
const ROW_GAP = 48;
const MARGIN = 48;
const EDGE_CHANNEL_PAD = 34;

const COLORS = {
  question: { fill: '#ffffff', stroke: '#94a3b8', text: '#0f172a' },
  leaf: { fill: '#ecfdf5', stroke: '#22c55e', text: '#064e3b' },
  warning: { fill: '#fff7ed', stroke: '#f97316', text: '#7c2d12' },
  dora: { fill: '#eff6ff', stroke: '#38bdf8', text: '#0f172a' },
  edge: '#64748b',
};

/**
 * Lädt die Entscheidungsbaum-Struktur aus der JS-Modellquelle.
 */
async function loadBaseDecisionTree() {
  const source = await fs.readFile(path.join(repoRoot, 'src/decisionTreeModel.js'), 'utf8');
  const start = source.indexOf('export const EU_AI_ACT_LINKS_DE');
  const end = source.indexOf('const LOCALIZED_MODEL_CACHE');

  if (start < 0 || end < 0) {
    throw new Error('Could not locate decision tree model block.');
  }

  const evaluable = source
    .slice(start, end)
    .replaceAll('export const ', 'const ')
    .replaceAll('export function ', 'function ');

  return Function(`${evaluable}\nreturn baseDecisionTree;`)();
}

/**
 * Lädt lokalisierte Labels aus model.json und merged sie in die Basisstruktur.
 */
async function loadLocalizedDecisionTree(locale) {
  const baseTree = await loadBaseDecisionTree();
  const localePath = path.join(repoRoot, `src/locales/${locale}/model.json`);
  const translations = JSON.parse(await fs.readFile(localePath, 'utf8')).decisionTree ?? {};

  return Object.fromEntries(
    Object.entries(baseTree).map(([id, node]) => [
      id,
      {
        ...node,
        label: translations[id]?.label ?? node.label ?? id,
        reference: translations[id]?.reference ?? node.reference,
      },
    ])
  );
}

/**
 * Erzeugt alle gerichteten Kanten aus yes/no/next-Transitionen.
 */
function collectEdges(tree) {
  const edges = [];

  for (const [id, node] of Object.entries(tree)) {
    for (const key of ['yes', 'no', 'next']) {
      const target = node?.[key];
      if (!target || !tree[target]) continue;
      edges.push({ from: id, to: target, label: key });
    }
  }

  return edges;
}

/**
 * Sammelt alle ab A1 erreichbaren Knoten per BFS.
 */
function collectReachable(tree, edges) {
  const outgoing = new Map();
  for (const edge of edges) {
    if (!outgoing.has(edge.from)) outgoing.set(edge.from, []);
    outgoing.get(edge.from).push(edge);
  }

  const depth = new Map([['A1', 0]]);
  const queue = ['A1'];

  for (let i = 0; i < queue.length; i += 1) {
    const id = queue[i];
    const currentDepth = depth.get(id) ?? 0;

    for (const edge of outgoing.get(id) ?? []) {
      if (!depth.has(edge.to)) {
        depth.set(edge.to, currentDepth + 1);
        queue.push(edge.to);
      }
    }
  }

  return { ids: new Set(queue), depth };
}

/**
 * Berechnet ein einfaches links-nach-rechts-Layout für den Graphen.
 */
function layoutGraph(tree, edges) {
  const { ids, depth } = collectReachable(tree, edges);
  const nodesByDepth = new Map();
  const incoming = new Map();

  for (const edge of edges) {
    if (!incoming.has(edge.to)) incoming.set(edge.to, []);
    incoming.get(edge.to).push(edge.from);
  }

  for (const id of ids) {
    const d = depth.get(id) ?? 0;
    if (!nodesByDepth.has(d)) nodesByDepth.set(d, []);
    nodesByDepth.get(d).push(id);
  }

  const positions = new Map();
  let maxWidth = 0;
  let maxHeight = 0;
  const sortedDepths = [...nodesByDepth.keys()].sort((a, b) => a - b);

  for (const d of sortedDepths) {
    const idsAtDepth = nodesByDepth.get(d);
    idsAtDepth.sort((a, b) => {
      const aParentScore = averageParentRow(a, incoming, positions);
      const bParentScore = averageParentRow(b, incoming, positions);
      if (aParentScore !== bParentScore) return aParentScore - bParentScore;
      return a.localeCompare(b);
    });

    idsAtDepth.forEach((id, row) => {
      const x = MARGIN + d * (NODE_W + COL_GAP);
      const y = MARGIN + row * (NODE_H + ROW_GAP);
      positions.set(id, { x, y, row, depth: d });
      maxWidth = Math.max(maxWidth, x + NODE_W + MARGIN);
      maxHeight = Math.max(maxHeight, y + NODE_H + MARGIN);
    });
  }

  return {
    ids,
    positions,
    width: maxWidth,
    height: maxHeight,
    edges: edges.filter((edge) => ids.has(edge.from) && ids.has(edge.to)),
  };
}

function averageParentRow(id, incoming, positions) {
  const parents = incoming.get(id) ?? [];
  const rows = parents
    .map((parentId) => positions.get(parentId)?.row)
    .filter((row) => Number.isFinite(row));

  if (!rows.length) return Number.MAX_SAFE_INTEGER;
  return rows.reduce((sum, row) => sum + row, 0) / rows.length;
}

/**
 * Schneidet Text in SVG-taugliche Zeilen.
 */
function wrapText(text, maxChars = 40, maxLines = 6) {
  const words = String(text ?? '').replace(/\s+/g, ' ').trim().split(' ');
  const lines = [];
  let line = '';

  for (const word of words) {
    for (const piece of splitLongWord(word, maxChars)) {
      const next = line ? `${line} ${piece}` : piece;
      if (next.length > maxChars && line) {
        lines.push(line);
        line = piece;
      } else {
        line = next;
      }
    }
  }

  if (line) lines.push(line);
  if (lines.length > maxLines) {
    return [...lines.slice(0, maxLines - 1), `${lines[maxLines - 1].slice(0, maxChars - 1)}…`];
  }
  return lines;
}

function splitLongWord(word, maxChars) {
  if (word.length <= maxChars) return [word];

  const pieces = [];
  for (let i = 0; i < word.length; i += maxChars - 1) {
    const chunk = word.slice(i, i + maxChars - 1);
    pieces.push(i + maxChars - 1 < word.length ? `${chunk}-` : chunk);
  }
  return pieces;
}

function getEdgePath(edge, layout) {
  const from = layout.positions.get(edge.from);
  const to = layout.positions.get(edge.to);
  if (!from || !to) return null;

  const x1 = from.x + NODE_W;
  const y1 = from.y + NODE_H / 2;
  const x2 = to.x;
  const y2 = to.y + NODE_H / 2;
  const fromDepth = from.depth ?? 0;
  const toDepth = to.depth ?? fromDepth + 1;

  if (toDepth >= fromDepth) {
    const channelX = Math.min(
      x2 - EDGE_CHANNEL_PAD,
      x1 + Math.max(EDGE_CHANNEL_PAD, (x2 - x1) * 0.42)
    );
    const points = [
      [x1, y1],
      [channelX, y1],
      [channelX, y2],
      [x2 - 8, y2],
    ];
    return {
      d: pointsToPath(points),
      points,
      labelX: channelX + 4,
      labelY: (y1 + y2) / 2 - 5,
    };
  }

  const loopX = x1 + EDGE_CHANNEL_PAD;
  const targetX = x2 + NODE_W + EDGE_CHANNEL_PAD;
  const topY = Math.min(y1, y2) - NODE_H * 0.55;
  const points = [
    [x1, y1],
    [loopX, y1],
    [loopX, topY],
    [targetX, topY],
    [targetX, y2],
    [x2 + NODE_W, y2],
  ];
  return {
    d: pointsToPath(points),
    points,
    labelX: loopX + 4,
    labelY: topY - 4,
  };
}

function pointsToPath(points) {
  return points.map(([x, y], index) => `${index === 0 ? 'M' : 'L'} ${x} ${y}`).join(' ');
}

/**
 * Rendert den Graphen als eigenständige SVG-Datei.
 */
function renderSvg(tree, layout, locale) {
  const parts = [];
  const defs = [
    `<marker id="arrow" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto"><path d="M0,0 L0,6 L9,3 z" fill="${COLORS.edge}"/></marker>`,
  ];

  for (const id of layout.ids) {
    const pos = layout.positions.get(id);
    const clipId = getClipId(id);
    defs.push(`<clipPath id="${clipId}"><rect x="${pos.x + 10}" y="${pos.y + 26}" width="${NODE_W - 20}" height="${NODE_H - 48}" rx="4"/></clipPath>`);
  }

  parts.push(`<?xml version="1.0" encoding="UTF-8"?>`);
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${layout.width}" height="${layout.height}" viewBox="0 0 ${layout.width} ${layout.height}">`);
  parts.push(`<defs>${defs.join('\n')}</defs>`);
  parts.push(`<rect width="100%" height="100%" fill="#f8fafc"/>`);
  parts.push(`<text x="${MARGIN}" y="28" font-family="Arial, sans-serif" font-size="18" font-weight="700" fill="#0f172a">Decision tree (${locale})</text>`);

  for (const edge of layout.edges) {
    const route = getEdgePath(edge, layout);
    if (!route) continue;

    parts.push(`<path d="${route.d}" fill="none" stroke="${COLORS.edge}" stroke-width="1.2" stroke-opacity="0.78" marker-end="url(#arrow)"/>`);
    parts.push(`<text x="${route.labelX}" y="${route.labelY}" font-family="Arial, sans-serif" font-size="10" fill="#475569">${escapeXml(edge.label)}</text>`);
  }

  for (const id of layout.ids) {
    const node = tree[id];
    const pos = layout.positions.get(id);
    const color = getNodeColor(node);
    const lines = wrapText(node.label ?? id);
    const clipId = getClipId(id);

    parts.push(`<rect x="${pos.x}" y="${pos.y}" width="${NODE_W}" height="${NODE_H}" rx="10" fill="${color.fill}" stroke="${color.stroke}" stroke-width="1.6"/>`);
    parts.push(`<text x="${pos.x + 12}" y="${pos.y + 18}" font-family="Arial, sans-serif" font-size="11" font-weight="700" fill="${color.text}">${escapeXml(id)} · ${escapeXml(node.type ?? 'node')}</text>`);

    parts.push(`<g clip-path="url(#${clipId})">`);
    lines.forEach((line, index) => {
      parts.push(`<text x="${pos.x + 12}" y="${pos.y + 40 + index * 14}" font-family="Arial, sans-serif" font-size="12" fill="${color.text}">${escapeXml(line)}</text>`);
    });
    parts.push(`</g>`);

    if (node.reference) {
      parts.push(`<text x="${pos.x + 12}" y="${pos.y + NODE_H - 10}" font-family="Arial, sans-serif" font-size="9" fill="#64748b">${escapeXml(String(node.reference).slice(0, 48))}</text>`);
    }
  }

  parts.push(`</svg>`);
  return parts.join('\n');
}

function getClipId(id) {
  return `clip-${id.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
}

/**
 * Rendert den Graphen als große Poster-PDF.
 */
function renderPdf(tree, layout, locale) {
  const maxPdfDim = 14000;
  const scale = Math.min(1, maxPdfDim / Math.max(layout.width, layout.height));
  const pdfWidth = layout.width * scale;
  const pdfHeight = layout.height * scale;
  const doc = new jsPDF({ unit: 'pt', format: [pdfWidth, pdfHeight], compress: true });

  doc.setFillColor('#f8fafc');
  doc.rect(0, 0, pdfWidth, pdfHeight, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18 * scale);
  doc.setTextColor('#0f172a');
  doc.text(`Decision tree (${locale})`, MARGIN * scale, 28 * scale);

  doc.setDrawColor('#64748b');
  doc.setLineWidth(1 * scale);
  for (const edge of layout.edges) {
    const route = getEdgePath(edge, layout);
    if (!route) continue;

    for (let i = 1; i < route.points.length; i += 1) {
      const [x1, y1] = route.points[i - 1];
      const [x2, y2] = route.points[i];
      doc.line(x1 * scale, y1 * scale, x2 * scale, y2 * scale);
    }

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8 * scale);
    doc.text(edge.label, route.labelX * scale, route.labelY * scale);
  }

  for (const id of layout.ids) {
    const node = tree[id];
    const pos = layout.positions.get(id);
    const color = getNodeColor(node);
    const x = pos.x * scale;
    const y = pos.y * scale;
    const w = NODE_W * scale;
    const h = NODE_H * scale;

    setPdfColor(doc, color.fill, 'fill');
    setPdfColor(doc, color.stroke, 'draw');
    doc.roundedRect(x, y, w, h, 8 * scale, 8 * scale, 'FD');
    setPdfColor(doc, color.text, 'text');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9 * scale);
    doc.text(`${id} · ${node.type ?? 'node'}`, x + 10 * scale, y + 17 * scale);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10 * scale);
    wrapText(node.label ?? id).forEach((line, index) => {
      doc.text(line, x + 10 * scale, y + (36 + index * 13) * scale);
    });
  }

  return Buffer.from(doc.output('arraybuffer'));
}

/**
 * Liefert Farben abhängig von Knotentyp und Cluster.
 */
function getNodeColor(node) {
  if (String(node.id ?? '').startsWith('W_')) return COLORS.warning;
  if (node.cluster === 'DORA') return COLORS.dora;
  if (node.type === 'leaf') return COLORS.leaf;
  return COLORS.question;
}

function setPdfColor(doc, hex, mode) {
  const [r, g, b] = hexToRgb(hex);
  if (mode === 'fill') doc.setFillColor(r, g, b);
  if (mode === 'draw') doc.setDrawColor(r, g, b);
  if (mode === 'text') doc.setTextColor(r, g, b);
}

function hexToRgb(hex) {
  const clean = hex.replace('#', '');
  return [
    parseInt(clean.slice(0, 2), 16),
    parseInt(clean.slice(2, 4), 16),
    parseInt(clean.slice(4, 6), 16),
  ];
}

function escapeXml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

await fs.mkdir(outDir, { recursive: true });

for (const locale of ['en', 'de']) {
  const tree = await loadLocalizedDecisionTree(locale);
  const edges = collectEdges(tree);
  const layout = layoutGraph(tree, edges);

  const svg = renderSvg(tree, layout, locale);
  const pdf = renderPdf(tree, layout, locale);

  await fs.writeFile(path.join(outDir, `decision-tree-${locale}.svg`), svg);
  await fs.writeFile(path.join(outDir, `decision-tree-${locale}.pdf`), pdf);

  console.log(`Generated ${locale}: ${layout.ids.size} nodes, ${layout.edges.length} edges`);
}
