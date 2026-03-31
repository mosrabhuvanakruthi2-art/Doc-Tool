import { useState, useEffect } from 'react';
import CfLoader from './CfLoader';
import { Document, Packer, Paragraph, TextRun, HeadingLevel, ImageRun, AlignmentType, Table, TableRow, TableCell, WidthType, BorderStyle } from 'docx';
import { saveAs } from 'file-saver';

const IMG_MAX_WIDTH = 580;
const IMG_MAX_HEIGHT = 700;

function base64ToBytes(base64) {
  const raw = atob(base64);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

function getImageNaturalSize(src) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => resolve({ width: IMG_MAX_WIDTH, height: 300 });
    img.src = src;
  });
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

async function buildImageParagraph(src) {
  const base64Match = src.match(/^data:image\/([^;]+);base64,(.+)$/);
  if (!base64Match) return null;
  try {
    const bytes = base64ToBytes(base64Match[2]);
    const natural = await getImageNaturalSize(src);
    const size = fitImageSize(natural.width, natural.height);
    return new Paragraph({
      children: [new ImageRun({ data: bytes, transformation: size, type: 'png' })],
      spacing: { before: 120, after: 120 },
    });
  } catch (_) {
    return null;
  }
}

async function parseHtmlToDocxChildren(html) {
  const parser = new DOMParser();
  const parsed = parser.parseFromString(html, 'text/html');
  const children = [];

  function getStyle(node) {
    const style = { bold: false, italic: false, underline: false, color: undefined, href: undefined };
    let cur = node;
    while (cur && cur !== parsed.body) {
      if (cur.nodeType === Node.ELEMENT_NODE) {
        const t = cur.tagName.toLowerCase();
        if (t === 'strong' || t === 'b') style.bold = true;
        if (t === 'em' || t === 'i') style.italic = true;
        if (t === 'u') style.underline = true;
        if (t === 'a' && cur.getAttribute('href')) {
          style.href = cur.getAttribute('href');
          style.color = '0563C1';
          style.underline = true;
        }
      }
      cur = cur.parentNode;
    }
    return style;
  }

  function collectInlineRuns(container) {
    const runs = [];
    const images = [];

    function walk(node) {
      if (node.nodeType === Node.TEXT_NODE) {
        const text = node.textContent;
        if (!text) return;
        const s = getStyle(node);
        const opts = { text, size: 22, font: 'Calibri' };
        if (s.bold) opts.bold = true;
        if (s.italic) opts.italics = true;
        if (s.underline) opts.underline = {};
        if (s.color) opts.color = s.color;
        runs.push(new TextRun(opts));
        return;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return;
      const tag = node.tagName.toLowerCase();
      if (tag === 'br') {
        runs.push(new TextRun({ break: 1 }));
        return;
      }
      if (tag === 'img') {
        const src = node.getAttribute('src') || '';
        if (src.startsWith('data:')) {
          images.push({ index: runs.length, src });
        }
        return;
      }
      node.childNodes.forEach(walk);
    }

    walk(container);
    return { runs, images };
  }

  async function processNode(node) {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent.trim();
      if (text) {
        children.push(new Paragraph({ children: [new TextRun({ text, size: 22, font: 'Calibri' })], spacing: { after: 120 } }));
      }
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;

    const tag = node.tagName.toLowerCase();

    if (tag === 'h1') {
      children.push(new Paragraph({ text: node.textContent, heading: HeadingLevel.HEADING_1, spacing: { before: 240, after: 120 } }));
    } else if (tag === 'h2') {
      children.push(new Paragraph({ text: node.textContent, heading: HeadingLevel.HEADING_2, spacing: { before: 200, after: 100 } }));
    } else if (tag === 'h3') {
      children.push(new Paragraph({ text: node.textContent, heading: HeadingLevel.HEADING_3, spacing: { before: 160, after: 80 } }));
    } else if (tag === 'h4') {
      children.push(new Paragraph({
        children: [new TextRun({ text: node.textContent, bold: true, size: 24, font: 'Calibri' })],
        spacing: { before: 160, after: 80 },
      }));
    } else if (tag === 'p' || tag === 'div' || tag === 'section' || tag === 'article') {
      const { runs, images } = collectInlineRuns(node);

      if (runs.length > 0 && runs.some((r) => r.root && r.root[1])) {
        children.push(new Paragraph({ children: runs, spacing: { after: 120 } }));
      } else if (runs.length > 0) {
        children.push(new Paragraph({ children: runs, spacing: { after: 120 } }));
      }

      for (const img of images) {
        const para = await buildImageParagraph(img.src);
        if (para) children.push(para);
      }

      if (runs.length === 0 && images.length === 0) {
        for (const child of node.childNodes) {
          await processNode(child);
        }
      }
    } else if (tag === 'img') {
      const src = node.getAttribute('src') || '';
      if (src.startsWith('data:')) {
        const para = await buildImageParagraph(src);
        if (para) children.push(para);
      }
    } else if (tag === 'ul' || tag === 'ol') {
      const items = node.querySelectorAll(':scope > li');
      for (let idx = 0; idx < items.length; idx++) {
        const li = items[idx];
        const prefix = tag === 'ol' ? `${idx + 1}. ` : '• ';
        const { runs, images } = collectInlineRuns(li);
        runs.unshift(new TextRun({ text: prefix, size: 22, font: 'Calibri' }));
        children.push(new Paragraph({ children: runs, spacing: { after: 60 }, indent: { left: 360 } }));
        for (const img of images) {
          const para = await buildImageParagraph(img.src);
          if (para) children.push(para);
        }
      }
    } else if (tag === 'blockquote') {
      const { runs, images } = collectInlineRuns(node);
      if (runs.length > 0) {
        children.push(new Paragraph({ children: runs, spacing: { before: 120, after: 120 }, indent: { left: 720 } }));
      }
      for (const img of images) {
        const para = await buildImageParagraph(img.src);
        if (para) children.push(para);
      }
    } else if (tag === 'table') {
      try {
        const trs = node.querySelectorAll('tr');
        if (trs.length > 0) {
          const borderStyle = { style: BorderStyle.SINGLE, size: 1, color: '999999' };
          const cellBorders = { top: borderStyle, bottom: borderStyle, left: borderStyle, right: borderStyle };
          const tableRows = [];
          trs.forEach((tr, trIdx) => {
            const cells = [];
            tr.querySelectorAll('th, td').forEach((cell) => {
              const isHeader = cell.tagName.toLowerCase() === 'th' || trIdx === 0;
              const text = cell.textContent || '';
              cells.push(new TableCell({
                children: [new Paragraph({
                  children: [new TextRun({ text, bold: isHeader, size: 20, font: 'Calibri' })],
                  alignment: AlignmentType.LEFT,
                })],
                borders: cellBorders,
                ...(isHeader ? { shading: { fill: 'd6e4ff' } } : {}),
              }));
            });
            if (cells.length > 0) tableRows.push(new TableRow({ children: cells }));
          });
          if (tableRows.length > 0) {
            children.push(new Table({ rows: tableRows, width: { size: 100, type: WidthType.PERCENTAGE } }));
            children.push(new Paragraph({ spacing: { after: 120 } }));
          }
        }
      } catch (_) {
        children.push(new Paragraph({
          children: [new TextRun({ text: '[Table — see original document]', italics: true, size: 20, font: 'Calibri', color: '666666' })],
          spacing: { before: 120, after: 120 },
        }));
      }
    } else if (tag === 'br') {
      children.push(new Paragraph({ children: [new TextRun({ break: 1 })] }));
    } else if (tag === 'span') {
      const { runs, images } = collectInlineRuns(node);
      if (runs.length > 0) {
        children.push(new Paragraph({ children: runs, spacing: { after: 60 } }));
      }
      for (const img of images) {
        const para = await buildImageParagraph(img.src);
        if (para) children.push(para);
      }
    } else {
      for (const child of node.childNodes) {
        await processNode(child);
      }
    }
  }

  for (const child of parsed.body.childNodes) {
    await processNode(child);
  }
  return children;
}

function CloudInfoPage({ slug }) {
  const [item, setItem] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    if (!slug) return;
    setLoading(true);
    setError('');
    fetch(`/api/cloud-info/${slug}`)
      .then(res => res.json())
      .then(data => {
        if (data.error) throw new Error(data.error);
        setItem(data.item);
      })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, [slug]);

  if (loading) {
    return <div className="cloud-info-page"><CfLoader /></div>;
  }

  if (error) {
    return <div className="cloud-info-page"><p className="error-msg">{error}</p></div>;
  }

  if (!item) {
    return <div className="cloud-info-page"><p>Select a Cloud Info item from the sidebar.</p></div>;
  }

  const handleExport = async () => {
    if (!item || exporting) return;
    setExporting(true);
    try {
      const title = item.name || 'Cloud Info';
      const docChildren = [
        new Paragraph({ text: title, heading: HeadingLevel.TITLE, spacing: { after: 200 } }),
        ...(await parseHtmlToDocxChildren(item.content || '')),
      ];

      const doc = new Document({ sections: [{ children: docChildren }] });
      const blob = await Packer.toBlob(doc);
      const filename = title.replace(/[^a-zA-Z0-9 ]/g, '').replace(/\s+/g, '_') + '.docx';
      saveAs(blob, filename);
    } catch (err) {
      console.error('Cloud Info export failed:', err);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="cloud-info-page cloud-info-page-full">
      <div className="cloud-info-page-header">
        <h2 className="cloud-info-page-title">{item.name}</h2>
        <button className="btn-export-cloud-info" onClick={handleExport} disabled={exporting}>
          {exporting ? 'Exporting...' : 'Download Doc'}
        </button>
      </div>
      <div
        className="cloud-info-page-content"
        dangerouslySetInnerHTML={{ __html: item.content || '<em>No content available.</em>' }}
      />
    </div>
  );
}

export default CloudInfoPage;
