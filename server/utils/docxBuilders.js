const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const {
  Document, Packer, Paragraph, TextRun, HeadingLevel, ImageRun,
  Table, TableRow, TableCell, WidthType, AlignmentType, BorderStyle,
} = require('docx');

// Server-side twin of the browser download buttons. Kept deliberately in step with
// the client generators in FeatureTable.jsx and CompatibilityTable.jsx so a file
// fetched through the API is the same document a user downloads from the page.

function getDateStr(now = new Date()) {
  const dd = String(now.getDate()).padStart(2, '0');
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  return `${dd}-${mm}-${now.getFullYear()}`;
}

function featuresFilename(productType, combination) {
  const combo = combination ? '_' + combination.replace(/\s+/g, '') : '';
  return `${productType}${combo}_(${getDateStr()}).docx`;
}

function matrixFilename(matrixName) {
  const safe = String(matrixName).replace(/[^a-zA-Z0-9 ]/g, '').replace(/\s+/g, '_');
  return `${safe}_(${getDateStr()}).docx`;
}

function groupByFamily(features) {
  const grouped = {};
  features.forEach((f) => {
    const family = f.family || 'General';
    if (!grouped[family]) grouped[family] = [];
    grouped[family].push(f);
  });
  return grouped;
}

function extensionType(contentTypeOrPath) {
  const value = String(contentTypeOrPath).toLowerCase();
  if (value.includes('jpeg') || value.includes('jpg')) return 'jpg';
  if (value.includes('gif')) return 'gif';
  if (value.includes('bmp')) return 'bmp';
  return 'png';
}

function fetchRemote(url) {
  return new Promise((resolve) => {
    const client = url.startsWith('https:') ? https : http;
    const request = client.get(url, (res) => {
      if (res.statusCode !== 200) { res.resume(); return resolve(null); }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const data = Buffer.concat(chunks);
        if (!data.length) return resolve(null);
        resolve({ data, type: extensionType(res.headers['content-type'] || url) });
      });
    });
    request.on('error', () => resolve(null));
    request.setTimeout(15000, () => { request.destroy(); resolve(null); });
  });
}

// Screenshots are either local files under the assets directory or absolute URLs
// (Cloudinary). The browser goes through /api/image-proxy for remote ones; here we
// can read the disk or make the request directly.
async function loadImage(url, assetsDir) {
  try {
    if (!url) return null;
    if (/^https?:\/\//i.test(url)) return await fetchRemote(url);

    const relative = String(url).replace(/^\/?assets\//, '');
    const filePath = path.join(assetsDir, relative.split('/').join(path.sep));
    if (!fs.existsSync(filePath)) return null;
    const data = fs.readFileSync(filePath);
    if (!data.length) return null;
    return { data, type: extensionType(filePath) };
  } catch {
    return null;
  }
}

async function buildFeaturesDocx({ features, productType, combination, scope, assetsDir }) {
  const grouped = groupByFamily(features);
  const scopeLabel = scope === 'outscope' ? 'Out of Scope' : 'In Scope';
  const children = [];

  children.push(new Paragraph({
    children: [new TextRun({ text: 'Migration Feature Documentation', bold: true, size: 52, font: 'Calibri' })],
    spacing: { after: 200 },
  }));

  const metaParts = [
    new TextRun({ text: 'Product Type: ', bold: true, size: 22, font: 'Calibri' }),
    new TextRun({ text: productType + '    ', size: 22, font: 'Calibri' }),
  ];
  if (combination) {
    metaParts.push(new TextRun({ text: 'Combination: ', bold: true, size: 22, font: 'Calibri' }));
    metaParts.push(new TextRun({ text: combination + '    ', size: 22, font: 'Calibri' }));
  }
  metaParts.push(new TextRun({ text: 'Scope: ', bold: true, size: 22, font: 'Calibri' }));
  metaParts.push(new TextRun({ text: scopeLabel + '    ', size: 22, font: 'Calibri' }));
  metaParts.push(new TextRun({ text: 'Total Features: ', bold: true, size: 22, font: 'Calibri' }));
  metaParts.push(new TextRun({ text: String(features.length), size: 22, font: 'Calibri' }));
  children.push(new Paragraph({ children: metaParts, spacing: { after: 120 } }));

  children.push(new Paragraph({
    border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: '3366cc' } },
    spacing: { after: 300 },
  }));

  let imagesEmbedded = 0;
  let imagesSkipped = 0;
  const groupEntries = Object.entries(grouped);

  for (let groupIdx = 0; groupIdx < groupEntries.length; groupIdx++) {
    const [family, items] = groupEntries[groupIdx];

    children.push(new Paragraph({
      children: [
        new TextRun({ text: `${groupIdx + 1}. ${family} `, bold: true, size: 36, color: '2952a3', font: 'Calibri' }),
        new TextRun({ text: `(${items.length} feature${items.length !== 1 ? 's' : ''})`, size: 26, color: '888888', font: 'Calibri' }),
      ],
      spacing: { before: 360, after: 200 },
    }));

    for (let idx = 0; idx < items.length; idx++) {
      const feature = items[idx];

      children.push(new Paragraph({
        children: [new TextRun({ text: `${groupIdx + 1}.${idx + 1} ${feature.name}`, bold: true, size: 26, font: 'Calibri' })],
        spacing: { before: 200, after: 80 },
      }));

      if (feature.description) {
        children.push(new Paragraph({
          children: [new TextRun({ text: feature.description, size: 22, font: 'Calibri', color: '444444' })],
          spacing: { after: 100 },
        }));
      }

      const screenshots = feature.screenshots || [];
      for (let sIdx = 0; sIdx < screenshots.length; sIdx++) {
        const image = await loadImage(screenshots[sIdx], assetsDir);
        if (!image) { imagesSkipped++; continue; }
        imagesEmbedded++;
        children.push(new Paragraph({
          children: [new ImageRun({
            data: image.data,
            type: image.type,
            transformation: { width: 580, height: 380 },
          })],
          spacing: { before: 120, after: 40 },
        }));
        children.push(new Paragraph({
          children: [new TextRun({
            text: `Figure ${groupIdx + 1}.${idx + 1}.${sIdx + 1}: ${feature.name}`,
            italics: true, size: 18, color: '999999', font: 'Calibri',
          })],
          spacing: { after: 200 },
        }));
      }
    }
  }

  const doc = new Document({ sections: [{ children }] });
  const buffer = await Packer.toBuffer(doc);
  return {
    buffer,
    filename: featuresFilename(productType, combination),
    stats: { features: features.length, families: groupEntries.length, imagesEmbedded, imagesSkipped },
  };
}

async function buildCompatibilityDocx({ matrix }) {
  const { name, columns = [], rows = [], notes } = matrix;
  const borderStyle = { style: BorderStyle.SINGLE, size: 1, color: '999999' };
  const cellBorders = { top: borderStyle, bottom: borderStyle, left: borderStyle, right: borderStyle };

  const headerCells = ['S.No', 'Features', ...columns].map(text =>
    new TableCell({
      children: [new Paragraph({ children: [new TextRun({ text, bold: true, size: 20, font: 'Calibri' })], alignment: AlignmentType.CENTER })],
      shading: { fill: 'd6e4ff' },
      borders: cellBorders,
      width: { size: text === 'S.No' ? 600 : 2000, type: WidthType.DXA },
    })
  );

  const tableRows = [new TableRow({ children: headerCells, tableHeader: true })];
  rows.forEach((row, idx) => {
    tableRows.push(new TableRow({
      children: [
        new TableCell({
          children: [new Paragraph({ children: [new TextRun({ text: String(idx + 1), size: 20, font: 'Calibri' })], alignment: AlignmentType.CENTER })],
          borders: cellBorders,
        }),
        new TableCell({
          children: [new Paragraph({ children: [new TextRun({ text: row.feature || '', size: 20, font: 'Calibri' })] })],
          borders: cellBorders,
        }),
        ...columns.map((_, ci) =>
          new TableCell({
            children: [new Paragraph({ children: [new TextRun({ text: (row.values && row.values[ci]) || '', size: 20, font: 'Calibri' })], alignment: AlignmentType.CENTER })],
            borders: cellBorders,
          })
        ),
      ],
    }));
  });

  const children = [
    new Paragraph({ text: name, heading: HeadingLevel.TITLE, spacing: { after: 200 } }),
    new Table({ rows: tableRows, width: { size: 100, type: WidthType.PERCENTAGE } }),
  ];

  if (notes && notes.trim()) {
    children.push(new Paragraph({ spacing: { before: 400 } }));
    children.push(new Paragraph({ text: 'Notes', heading: HeadingLevel.HEADING_2, spacing: { after: 100 } }));
    children.push(new Paragraph({ text: notes.trim(), spacing: { after: 200 } }));
  }

  const described = rows.filter(r => r.description && r.description.trim());
  if (described.length) {
    children.push(new Paragraph({ spacing: { before: 400 } }));
    children.push(new Paragraph({ text: 'Feature Descriptions', heading: HeadingLevel.HEADING_2, spacing: { after: 100 } }));

    const descHeaderCells = ['S.No', 'Feature', 'Description'].map(text =>
      new TableCell({
        children: [new Paragraph({ children: [new TextRun({ text, bold: true, size: 20, font: 'Calibri' })], alignment: AlignmentType.CENTER })],
        shading: { fill: 'd6e4ff' },
        borders: cellBorders,
      })
    );
    const descRows = [new TableRow({ children: descHeaderCells, tableHeader: true })];
    described.forEach((r, i) => {
      descRows.push(new TableRow({
        children: [
          new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: String(i + 1), size: 20, font: 'Calibri' })], alignment: AlignmentType.CENTER })], borders: cellBorders }),
          new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: r.feature, size: 20, font: 'Calibri' })] })], borders: cellBorders }),
          new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: r.description, size: 20, font: 'Calibri' })] })], borders: cellBorders }),
        ],
      }));
    });
    children.push(new Table({ rows: descRows, width: { size: 100, type: WidthType.PERCENTAGE } }));
  }

  const doc = new Document({ sections: [{ children }] });
  const buffer = await Packer.toBuffer(doc);
  return {
    buffer,
    filename: matrixFilename(name),
    stats: { columns: columns.length, rows: rows.length, described: described.length },
  };
}

// Cloud info pages and documents are stored as rich HTML, so their Word file is the
// parsed content under a title. Matches the browser exports, which use the plain
// name as the filename (no date suffix).
async function buildContentDocx({ record, fallbackTitle = 'Document' }) {
  const { parseHtmlToDocxChildren } = require('./htmlToDocx');
  const title = record.name || fallbackTitle;
  const counters = { images: 0, imagesFailed: 0, tables: 0 };

  const body = parseHtmlToDocxChildren(record.content || '', counters);
  const children = [
    new Paragraph({ text: title, heading: HeadingLevel.TITLE, spacing: { after: 200 } }),
    ...body,
  ];

  const doc = new Document({ sections: [{ children }] });
  const buffer = await Packer.toBuffer(doc);
  return {
    buffer,
    filename: String(title).replace(/[^a-zA-Z0-9 ]/g, '').replace(/\s+/g, '_') + '.docx',
    stats: {
      blocks: body.length,
      imagesEmbedded: counters.images,
      imagesFailed: counters.imagesFailed,
      tables: counters.tables,
      sourceKB: Math.round((record.content || '').length / 1024),
    },
  };
}

module.exports = { buildFeaturesDocx, buildCompatibilityDocx, buildContentDocx, getDateStr };
