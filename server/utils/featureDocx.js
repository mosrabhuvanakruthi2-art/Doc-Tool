const {
  Document, Packer, Paragraph, TextRun,
  Table, TableRow, TableCell, WidthType, AlignmentType, BorderStyle, VerticalAlign,
} = require('docx');

// Builds the Word document served by the internal API for a product type /
// combination: a single table, one merged heading row, then a name and description
// per feature. No screenshots, no numbering column.
//
// The heading follows the scope — in scope lists what the migration includes, out of
// scope lists what it does not:
//   inscope  -> "INCLUDED IN TEAMS TO SLACK MIGRATION FEATURES"
//   outscope -> "NOT INCLUDED IN TEAMS TO SLACK MIGRATION FEATURES"

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

function headingFor(productType, combination, scope) {
  const subject = String(combination || productType).toUpperCase();
  const prefix = scope === 'outscope' ? 'NOT INCLUDED IN' : 'INCLUDED IN';
  return `${prefix} ${subject} MIGRATION FEATURES`;
}

const BORDER = { style: BorderStyle.SINGLE, size: 4, color: '000000' };
const CELL_BORDERS = { top: BORDER, bottom: BORDER, left: BORDER, right: BORDER };
const HEADER_FILL = 'A6A6A6';
const NAME_WIDTH = 40;
const DESC_WIDTH = 60;

function cell(text, { width, bold = false, span, fill } = {}) {
  return new TableCell({
    children: [new Paragraph({
      children: [new TextRun({ text: text || '', bold, size: 20, font: 'Calibri' })],
      alignment: AlignmentType.CENTER,
      spacing: { before: 40, after: 40 },
    })],
    borders: CELL_BORDERS,
    verticalAlign: VerticalAlign.CENTER,
    ...(width ? { width: { size: width, type: WidthType.PERCENTAGE } } : {}),
    ...(span ? { columnSpan: span } : {}),
    ...(fill ? { shading: { fill } } : {}),
  });
}

async function buildFeatureTableDocx({ features, productType, combination, scope }) {
  const rows = [
    // One merged cell across both columns carries the heading, as in the sample.
    new TableRow({
      tableHeader: true,
      children: [cell(headingFor(productType, combination, scope), { span: 2, bold: true, fill: HEADER_FILL })],
    }),
    ...features.map(feature => new TableRow({
      children: [
        cell(feature.name, { width: NAME_WIDTH }),
        cell(feature.description, { width: DESC_WIDTH }),
      ],
    })),
  ];

  const doc = new Document({
    sections: [{
      children: [new Table({ rows, width: { size: 100, type: WidthType.PERCENTAGE } })],
    }],
  });
  const buffer = await Packer.toBuffer(doc);

  return {
    buffer,
    filename: filenameFor(productType, combination),
    heading: headingFor(productType, combination, scope),
    stats: {
      features: features.length,
      withDescription: features.filter(f => String(f.description || '').trim()).length,
    },
  };
}

module.exports = { buildFeatureTableDocx, headingFor, getDateStr };
