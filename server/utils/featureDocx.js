const {
  Document, Packer, Paragraph, TextRun,
  Table, TableRow, TableCell, WidthType, AlignmentType, BorderStyle,
} = require('docx');

// Builds the Word document served by the internal API for a product type /
// combination. Deliberately plain: a title, one line of context, and a single table
// of feature names and descriptions. No screenshots, no family grouping — those live
// in the browser export, which stays as it is.

function getDateStr(now = new Date()) {
  const dd = String(now.getDate()).padStart(2, '0');
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  return `${dd}-${mm}-${now.getFullYear()}`;
}

function filenameFor(productType, combination) {
  const combo = combination ? '_' + String(combination).replace(/\s+/g, '') : '';
  const safe = `${productType}${combo}`.replace(/[^a-zA-Z0-9_]/g, '');
  return `${safe}_(${getDateStr()}).docx`;
}

const BORDER = { style: BorderStyle.SINGLE, size: 1, color: '999999' };
const CELL_BORDERS = { top: BORDER, bottom: BORDER, left: BORDER, right: BORDER };

function headerCell(text, width) {
  return new TableCell({
    children: [new Paragraph({
      children: [new TextRun({ text, bold: true, size: 20, font: 'Calibri' })],
      alignment: AlignmentType.CENTER,
    })],
    shading: { fill: 'd6e4ff' },
    borders: CELL_BORDERS,
    width: { size: width, type: WidthType.PERCENTAGE },
  });
}

function bodyCell(text, { center = false, width } = {}) {
  return new TableCell({
    children: [new Paragraph({
      children: [new TextRun({ text: text || '', size: 20, font: 'Calibri' })],
      ...(center ? { alignment: AlignmentType.CENTER } : {}),
    })],
    borders: CELL_BORDERS,
    ...(width ? { width: { size: width, type: WidthType.PERCENTAGE } } : {}),
  });
}

async function buildFeatureTableDocx({ features, productType, combination, scope }) {
  const scopeLabel = scope === 'outscope' ? 'Out of Scope' : 'In Scope';

  const rows = [new TableRow({
    tableHeader: true,
    children: [headerCell('S.No', 8), headerCell('Name', 30), headerCell('Description', 62)],
  })];

  features.forEach((feature, idx) => {
    rows.push(new TableRow({
      children: [
        bodyCell(String(idx + 1), { center: true, width: 8 }),
        bodyCell(feature.name, { width: 30 }),
        bodyCell(feature.description, { width: 62 }),
      ],
    }));
  });

  const heading = combination || productType;
  const children = [
    new Paragraph({
      children: [new TextRun({ text: heading, bold: true, size: 40, font: 'Calibri' })],
      spacing: { after: 120 },
    }),
    new Paragraph({
      children: [
        new TextRun({ text: 'Product Type: ', bold: true, size: 22, font: 'Calibri' }),
        new TextRun({ text: `${productType}    `, size: 22, font: 'Calibri' }),
        ...(combination ? [
          new TextRun({ text: 'Combination: ', bold: true, size: 22, font: 'Calibri' }),
          new TextRun({ text: `${combination}    `, size: 22, font: 'Calibri' }),
        ] : []),
        new TextRun({ text: 'Scope: ', bold: true, size: 22, font: 'Calibri' }),
        new TextRun({ text: `${scopeLabel}    `, size: 22, font: 'Calibri' }),
        new TextRun({ text: 'Total: ', bold: true, size: 22, font: 'Calibri' }),
        new TextRun({ text: String(features.length), size: 22, font: 'Calibri' }),
      ],
      spacing: { after: 240 },
    }),
    new Table({ rows, width: { size: 100, type: WidthType.PERCENTAGE } }),
  ];

  const doc = new Document({ sections: [{ children }] });
  const buffer = await Packer.toBuffer(doc);

  return {
    buffer,
    filename: filenameFor(productType, combination),
    stats: {
      features: features.length,
      withDescription: features.filter(f => String(f.description || '').trim()).length,
    },
  };
}

module.exports = { buildFeatureTableDocx, getDateStr };
