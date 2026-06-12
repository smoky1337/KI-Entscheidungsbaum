import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { jsPDF } from 'jspdf';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const outDir = path.join(repoRoot, 'docs');

/**
 * Loads the base decision-tree object from the JS model source.
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
 * Applies localized model.json text over the base tree.
 */
async function loadLocalizedDecisionTree(locale) {
  const baseTree = await loadBaseDecisionTree();
  const localePath = path.join(repoRoot, `src/locales/${locale}/model.json`);
  const translations = JSON.parse(await fs.readFile(localePath, 'utf8')).decisionTree ?? {};

  return Object.fromEntries(
    Object.entries(baseTree).map(([id, node]) => {
      const translation = translations[id] ?? {};
      return [
        id,
        {
          ...node,
          label: translation.label ?? node.label ?? id,
          info: translation.info ?? node.info ?? '',
          reference: translation.reference ?? node.reference ?? '',
        },
      ];
    })
  );
}

/**
 * Returns all rows in stable source order.
 */
function buildRows(tree) {
  return Object.entries(tree).map(([id, node]) => ({
    id,
    type: node.type ?? '',
    question: normalizeText(node.label ?? id),
    description: normalizeText(node.info ?? ''),
    yes: node.yes ?? '',
    no: node.no ?? '',
    next: node.next ?? '',
    reference: normalizeText(node.reference ?? ''),
  }));
}

/**
 * Renders the matrix as a Markdown table.
 */
function renderMarkdown(rows, locale) {
  const lines = [
    `# Full Decision Tree Question Matrix (${locale})`,
    '',
    `Generated from \`src/decisionTreeModel.js\` and \`src/locales/${locale}/model.json\`.`,
    '',
    '| ID | Type | Question | Description | Yes | No | Next | Reference |',
    '|---|---|---|---|---|---|---|---|',
  ];

  for (const row of rows) {
    lines.push([
      row.id,
      row.type,
      row.question,
      row.description,
      row.yes,
      row.no,
      row.next,
      row.reference,
    ].map(escapeMarkdownCell).join(' | ').replace(/^/, '| ').replace(/$/, ' |'));
  }

  lines.push('');
  return lines.join('\n');
}

/**
 * Renders the matrix as multi-page structured PDF text.
 */
function renderPdf(rows, locale) {
  const doc = new jsPDF({ unit: 'pt', format: 'a4', compress: true });
  const marginX = 40;
  const pageHeight = doc.internal.pageSize.getHeight();
  const contentWidth = doc.internal.pageSize.getWidth() - marginX * 2;
  let y = 42;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.text(`Full Decision Tree Question Matrix (${locale})`, marginX, y);
  y += 14;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.text(`Generated from decisionTreeModel.js and src/locales/${locale}/model.json`, marginX, y);
  y += 22;

  for (const row of rows) {
    const block = [
      `${row.id} (${row.type})`,
      `Question: ${row.question}`,
      `Description: ${row.description || '-'}`,
      `Yes: ${row.yes || '-'}    No: ${row.no || '-'}    Next: ${row.next || '-'}`,
      `Reference: ${row.reference || '-'}`,
    ];

    const wrappedLines = block.flatMap((line, index) => {
      const width = index === 0 ? contentWidth : contentWidth - 12;
      return doc.splitTextToSize(line, width);
    });

    const blockHeight = wrappedLines.length * 9 + 18;
    if (y + blockHeight > pageHeight - 36) {
      doc.addPage();
      y = 42;
    }

    doc.setDrawColor(226, 232, 240);
    doc.setFillColor(248, 250, 252);
    doc.roundedRect(marginX - 6, y - 10, contentWidth + 12, blockHeight, 6, 6, 'FD');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.text(wrappedLines[0], marginX, y);
    y += 10;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    for (const line of wrappedLines.slice(1)) {
      doc.text(line, marginX + 12, y);
      y += 9;
    }
    y += 14;
  }

  return Buffer.from(doc.output('arraybuffer'));
}

function normalizeText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function escapeMarkdownCell(value) {
  return normalizeText(value)
    .replaceAll('|', '\\|')
    .replaceAll('\n', '<br>');
}


await fs.mkdir(outDir, { recursive: true });

for (const locale of ['en', 'de']) {
  const tree = await loadLocalizedDecisionTree(locale);
  const rows = buildRows(tree);

  await fs.writeFile(
    path.join(outDir, `full-question-matrix-${locale}.md`),
    renderMarkdown(rows, locale)
  );

  await fs.writeFile(
    path.join(outDir, `full-question-matrix-${locale}.pdf`),
    renderPdf(rows, locale)
  );

  console.log(`Generated ${locale}: ${rows.length} rows`);
}
