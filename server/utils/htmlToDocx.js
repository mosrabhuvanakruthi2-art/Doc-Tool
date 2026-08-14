const { parse } = require('node-html-parser');
const {
  Paragraph, TextRun, HeadingLevel, ImageRun,
  Table, TableRow, TableCell, WidthType, AlignmentType, BorderStyle,
} = require('docx');

// Server-side twin of parseHtmlToDocxChildren() in CloudInfoPage.jsx. The browser
// version relies on DOMParser, atob and new Image(); here those become
// node-html-parser, Buffer, and reading the dimensions out of the image header.

const IMG_MAX_WIDTH = 580;
const IMG_MAX_HEIGHT = 700;
const ELEMENT_NODE = 1;
const TEXT_NODE = 3;

const BLOCK_TAGS = new Set(['div', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'table', 'blockquote', 'section', 'article', 'pre']);

// Enough of PNG / JPEG / GIF to recover pixel dimensions without an image library.
function imageSize(buffer) {
  try {
    if (buffer.length > 24 && buffer.readUInt32BE(0) === 0x89504e47) {
      return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20), type: 'png' };
    }
    if (buffer.length > 6 && buffer.toString('ascii', 0, 3) === 'GIF') {
      return { width: buffer.readUInt16LE(6), height: buffer.readUInt16LE(8), type: 'gif' };
    }
    if (buffer.length > 4 && buffer[0] === 0xff && buffer[1] === 0xd8) {
      let offset = 2;
      while (offset + 9 < buffer.length) {
        if (buffer[offset] !== 0xff) { offset++; continue; }
        const marker = buffer[offset + 1];
        // Start-of-frame markers carry the dimensions; skip the rest by their length.
        if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
          return { width: buffer.readUInt16BE(offset + 7), height: buffer.readUInt16BE(offset + 5), type: 'jpg' };
        }
        offset += 2 + buffer.readUInt16BE(offset + 2);
      }
      return { width: 0, height: 0, type: 'jpg' };
    }
  } catch { /* fall through to the default below */ }
  return { width: 0, height: 0, type: 'png' };
}

function fitImageSize(naturalW, naturalH) {
  let w = naturalW || IMG_MAX_WIDTH;
  let h = naturalH || 300;
  if (w > IMG_MAX_WIDTH) {
    h = Math.round(h * (IMG_MAX_WIDTH / w));
    w = IMG_MAX_WIDTH;
  }
  if (h > IMG_MAX_HEIGHT) {
    w = Math.round(w * (IMG_MAX_HEIGHT / h));
    h = IMG_MAX_HEIGHT;
  }
  return { width: Math.max(w, 1), height: Math.max(h, 1) };
}

function buildImageParagraph(src, counters) {
  const match = /^data:image\/([^;]+);base64,(.+)$/i.exec(src);
  if (!match) return null;
  try {
    const data = Buffer.from(match[2], 'base64');
    if (!data.length) return null;
    const natural = imageSize(data);
    const declared = String(match[1]).toLowerCase();
    const type = ['png', 'jpg', 'jpeg', 'gif', 'bmp'].includes(declared)
      ? (declared === 'jpeg' ? 'jpg' : declared)
      : natural.type;
    counters.images += 1;
    return new Paragraph({
      children: [new ImageRun({ data, transformation: fitImageSize(natural.width, natural.height), type })],
      spacing: { before: 120, after: 120 },
    });
  } catch {
    counters.imagesFailed += 1;
    return null;
  }
}

// contentEditable writes formatting as inline styles, so those matter as much as tags.
function inlineStyleFlags(node) {
  const raw = node.getAttribute && node.getAttribute('style');
  if (!raw) return {};
  const value = String(raw).toLowerCase();
  const weight = /font-weight\s*:\s*([^;]+)/.exec(value);
  const flags = {};
  if (weight && (weight[1].includes('bold') || Number(weight[1]) >= 600)) flags.bold = true;
  if (/font-style\s*:\s*italic/.test(value)) flags.italic = true;
  if (/text-decoration[^:]*:\s*[^;]*underline/.test(value)) flags.underline = true;
  return flags;
}

function tagOf(node) {
  return node && node.rawTagName ? String(node.rawTagName).toLowerCase() : '';
}

function parseHtmlToDocxChildren(html, counters) {
  const root = parse(String(html || ''), { blockTextElements: { script: false, style: false } });
  const children = [];

  function styleFor(node) {
    const style = { bold: false, italic: false, underline: false, color: undefined };
    let cur = node.parentNode;
    while (cur && cur !== root) {
      if (cur.nodeType === ELEMENT_NODE) {
        const t = tagOf(cur);
        if (t === 'strong' || t === 'b') style.bold = true;
        if (t === 'em' || t === 'i') style.italic = true;
        if (t === 'u') style.underline = true;
        if (t === 'a' && cur.getAttribute('href')) {
          style.color = '0563C1';
          style.underline = true;
        }
        const flags = inlineStyleFlags(cur);
        if (flags.bold) style.bold = true;
        if (flags.italic) style.italic = true;
        if (flags.underline) style.underline = true;
      }
      cur = cur.parentNode;
    }
    return style;
  }

  function collectInlineRuns(container) {
    const runs = [];
    const images = [];

    function walk(node) {
      if (node.nodeType === TEXT_NODE) {
        const text = node.textContent;
        if (!text) return;
        const s = styleFor(node);
        const opts = { text, size: 22, font: 'Calibri' };
        if (s.bold) opts.bold = true;
        if (s.italic) opts.italics = true;
        if (s.underline) opts.underline = {};
        if (s.color) opts.color = s.color;
        runs.push(new TextRun(opts));
        return;
      }
      if (node.nodeType !== ELEMENT_NODE) return;
      const tag = tagOf(node);
      if (tag === 'br') { runs.push(new TextRun({ break: 1 })); return; }
      if (tag === 'img') {
        const src = node.getAttribute('src') || '';
        if (src.startsWith('data:')) images.push({ src });
        return;
      }
      node.childNodes.forEach(walk);
    }

    walk(container);
    return { runs, images };
  }

  const pushImages = (images) => {
    images.forEach(({ src }) => {
      const para = buildImageParagraph(src, counters);
      if (para) children.push(para);
    });
  };

  function processNode(node) {
    if (node.nodeType === TEXT_NODE) {
      const text = node.textContent.trim();
      if (text) {
        children.push(new Paragraph({ children: [new TextRun({ text, size: 22, font: 'Calibri' })], spacing: { after: 120 } }));
      }
      return;
    }
    if (node.nodeType !== ELEMENT_NODE) return;

    const tag = tagOf(node);

    if (tag === 'h1') {
      children.push(new Paragraph({ text: node.textContent, heading: HeadingLevel.HEADING_1, spacing: { before: 240, after: 120 } }));
    } else if (tag === 'h2') {
      children.push(new Paragraph({ text: node.textContent, heading: HeadingLevel.HEADING_2, spacing: { before: 200, after: 100 } }));
    } else if (tag === 'h3') {
      children.push(new Paragraph({ text: node.textContent, heading: HeadingLevel.HEADING_3, spacing: { before: 160, after: 80 } }));
    } else if (tag === 'h4' || tag === 'h5' || tag === 'h6') {
      children.push(new Paragraph({
        children: [new TextRun({ text: node.textContent, bold: true, size: 24, font: 'Calibri' })],
        spacing: { before: 160, after: 80 },
      }));
    } else if (tag === 'p' || tag === 'div' || tag === 'section' || tag === 'article') {
      // A container holding block-level children keeps its structure by recursing;
      // flattening it would merge nested text into one paragraph and lose the order.
      const hasBlockChild = node.childNodes.some(
        c => c.nodeType === ELEMENT_NODE && BLOCK_TAGS.has(tagOf(c))
      );
      if (hasBlockChild) {
        node.childNodes.forEach(processNode);
      } else {
        const { runs, images } = collectInlineRuns(node);
        if (runs.length) children.push(new Paragraph({ children: runs, spacing: { after: 120 } }));
        pushImages(images);
      }
    } else if (tag === 'img') {
      const src = node.getAttribute('src') || '';
      if (src.startsWith('data:')) {
        const para = buildImageParagraph(src, counters);
        if (para) children.push(para);
      }
    } else if (tag === 'ul' || tag === 'ol') {
      const items = node.childNodes.filter(c => c.nodeType === ELEMENT_NODE && tagOf(c) === 'li');
      items.forEach((li, idx) => {
        const prefix = tag === 'ol' ? `${idx + 1}. ` : '• ';
        const { runs, images } = collectInlineRuns(li);
        runs.unshift(new TextRun({ text: prefix, size: 22, font: 'Calibri' }));
        children.push(new Paragraph({ children: runs, spacing: { after: 60 }, indent: { left: 360 } }));
        pushImages(images);
      });
    } else if (tag === 'blockquote') {
      const { runs, images } = collectInlineRuns(node);
      if (runs.length) {
        children.push(new Paragraph({ children: runs, spacing: { before: 120, after: 120 }, indent: { left: 720 } }));
      }
      pushImages(images);
    } else if (tag === 'table') {
      try {
        const trs = node.querySelectorAll('tr');
        if (trs.length) {
          const borderStyle = { style: BorderStyle.SINGLE, size: 1, color: '999999' };
          const cellBorders = { top: borderStyle, bottom: borderStyle, left: borderStyle, right: borderStyle };
          const tableRows = [];
          trs.forEach((tr, trIdx) => {
            const cells = [];
            tr.querySelectorAll('th, td').forEach((cell) => {
              const isHeader = tagOf(cell) === 'th' || trIdx === 0;
              cells.push(new TableCell({
                children: [new Paragraph({
                  children: [new TextRun({ text: cell.textContent || '', bold: isHeader, size: 20, font: 'Calibri' })],
                  alignment: AlignmentType.LEFT,
                })],
                borders: cellBorders,
                ...(isHeader ? { shading: { fill: 'd6e4ff' } } : {}),
              }));
            });
            if (cells.length) tableRows.push(new TableRow({ children: cells }));
          });
          if (tableRows.length) {
            counters.tables += 1;
            children.push(new Table({ rows: tableRows, width: { size: 100, type: WidthType.PERCENTAGE } }));
            children.push(new Paragraph({ spacing: { after: 120 } }));
          }
        }
      } catch {
        children.push(new Paragraph({
          children: [new TextRun({ text: '[Table — see original document]', italics: true, size: 20, font: 'Calibri', color: '666666' })],
          spacing: { before: 120, after: 120 },
        }));
      }
    } else if (tag === 'br') {
      children.push(new Paragraph({ children: [new TextRun({ break: 1 })] }));
    } else if (tag === 'span') {
      const { runs, images } = collectInlineRuns(node);
      if (runs.length) children.push(new Paragraph({ children: runs, spacing: { after: 60 } }));
      pushImages(images);
    } else if (tag === 'script' || tag === 'style') {
      // ignore
    } else {
      node.childNodes.forEach(processNode);
    }
  }

  root.childNodes.forEach(processNode);
  return children;
}

module.exports = { parseHtmlToDocxChildren, imageSize, fitImageSize };
