import { useState, useEffect } from 'react';
import * as XLSX from 'xlsx';
import { Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType, AlignmentType, BorderStyle } from 'docx';
import { saveAs } from 'file-saver';

function getDateStr() {
  const now = new Date();
  const dd = String(now.getDate()).padStart(2, '0');
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const yyyy = now.getFullYear();
  return `${dd}-${mm}-${yyyy}`;
}

function getFilename(matrixName, ext) {
  const safe = matrixName.replace(/[^a-zA-Z0-9 ]/g, '').replace(/\s+/g, '_');
  return `${safe}_(${getDateStr()}).${ext}`;
}

function CompatibilityTable({ matrixSlug }) {
  const [matrix, setMatrix] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showDescriptions, setShowDescriptions] = useState(false);
  const [downloading, setDownloading] = useState('');

  useEffect(() => {
    if (!matrixSlug) return;
    setLoading(true);
    setError('');
    fetch(`/api/compatibility/${matrixSlug}`)
      .then(res => res.json())
      .then(data => {
        if (data.error) throw new Error(data.error);
        setMatrix(data.matrix);
      })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, [matrixSlug]);

  const downloadExcel = () => {
    if (!matrix) return;
    setDownloading('excel');
    try {
      const { name, columns, rows, notes } = matrix;
      const header = ['S.No', 'Features', ...columns];
      const dataRows = rows.map((row, idx) => [
        idx + 1,
        row.feature,
        ...columns.map((_, ci) => (row.values && row.values[ci]) || ''),
      ]);

      const wsData = [header, ...dataRows];

      if (notes && notes.trim()) {
        wsData.push([]);
        wsData.push(['Notes:', notes.trim()]);
      }

      const hasDesc = rows.some(r => r.description && r.description.trim());
      if (hasDesc) {
        wsData.push([]);
        wsData.push(['Feature Descriptions']);
        wsData.push(['S.No', 'Feature', 'Description']);
        rows.filter(r => r.description && r.description.trim()).forEach((r, i) => {
          wsData.push([i + 1, r.feature, r.description]);
        });
      }

      const ws = XLSX.utils.aoa_to_sheet(wsData);
      const wb = XLSX.utils.book_new();
      const safeName = name.replace(/[\\/*?:\[\]]/g, '_').slice(0, 31);
      XLSX.utils.book_append_sheet(wb, ws, safeName);
      XLSX.writeFile(wb, getFilename(name, 'xlsx'));
    } catch (err) {
      console.error('Excel download error:', err);
    }
    setDownloading('');
  };

  const downloadDOCX = async () => {
    if (!matrix) return;
    setDownloading('docx');
    try {
      const { name, columns, rows, notes } = matrix;
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
        const cells = [
          new TableCell({
            children: [new Paragraph({ children: [new TextRun({ text: String(idx + 1), size: 20, font: 'Calibri' })], alignment: AlignmentType.CENTER })],
            borders: cellBorders,
          }),
          new TableCell({
            children: [new Paragraph({ children: [new TextRun({ text: row.feature, size: 20, font: 'Calibri' })] })],
            borders: cellBorders,
          }),
          ...columns.map((_, ci) =>
            new TableCell({
              children: [new Paragraph({ children: [new TextRun({ text: (row.values && row.values[ci]) || '', size: 20, font: 'Calibri' })], alignment: AlignmentType.CENTER })],
              borders: cellBorders,
            })
          ),
        ];
        tableRows.push(new TableRow({ children: cells }));
      });

      const docTable = new Table({ rows: tableRows, width: { size: 100, type: WidthType.PERCENTAGE } });

      const children = [
        new Paragraph({ text: name, heading: HeadingLevel.TITLE, spacing: { after: 200 } }),
        docTable,
      ];

      if (notes && notes.trim()) {
        children.push(new Paragraph({ spacing: { before: 400 } }));
        children.push(new Paragraph({ text: 'Notes', heading: HeadingLevel.HEADING_2, spacing: { after: 100 } }));
        children.push(new Paragraph({ text: notes.trim(), spacing: { after: 200 } }));
      }

      const hasDesc = rows.some(r => r.description && r.description.trim());
      if (hasDesc) {
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
        rows.filter(r => r.description && r.description.trim()).forEach((r, i) => {
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
      const blob = await Packer.toBlob(doc);
      saveAs(blob, getFilename(name, 'docx'));
    } catch (_) {}
    setDownloading('');
  };

  if (loading) {
    return <div className="compat-loading">Loading compatibility data...</div>;
  }

  if (error) {
    return <div className="compat-error">Failed to load: {error}</div>;
  }

  if (!matrix) {
    return <div className="compat-empty">No data found.</div>;
  }

  const { name, columns, rows, notes } = matrix;
  const hasDescriptions = rows.some(r => r.description && r.description.trim());

  return (
    <div className="compat-container">
      <div className="compat-header-row">
        <h1 className="compat-title">{name}</h1>
        <div className="compat-header-actions">
          {hasDescriptions && (
            <button
              className="btn-toggle-desc"
              onClick={() => setShowDescriptions(prev => !prev)}
            >
              {showDescriptions ? 'Hide Descriptions' : 'Show Descriptions'}
            </button>
          )}
          <div className="compat-export-btns">
            <button className="btn-export-sm" onClick={downloadExcel} disabled={!!downloading} title="Download Excel">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
              </svg>
              {downloading === 'excel' ? 'Downloading...' : 'Excel'}
            </button>
            <button className="btn-export-sm" onClick={downloadDOCX} disabled={!!downloading} title="Download DOCX">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
              </svg>
              {downloading === 'docx' ? 'Downloading...' : 'Doc'}
            </button>
          </div>
        </div>
      </div>

      <div className="compat-table-wrapper">
        <table className="compat-table">
          <thead>
            <tr>
              <th className="compat-th-sno">S.No</th>
              <th className="compat-th-feature">Features</th>
              {columns.map((col, i) => (
                <th key={i} className="compat-th-col">{col}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, rIdx) => (
              <tr key={rIdx} className={rIdx % 2 === 0 ? 'compat-row-even' : 'compat-row-odd'}>
                <td className="compat-td-sno">{rIdx + 1}</td>
                <td className="compat-td-feature">{row.feature}</td>
                {columns.map((_, cIdx) => {
                  const val = (row.values && row.values[cIdx]) || '';
                  return (
                    <td key={cIdx} className="compat-td-cell">
                      {val}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {notes && notes.trim() && (
        <div className="compat-notes">
          <h3 className="compat-notes-title">Notes</h3>
          <p className="compat-notes-text">{notes}</p>
        </div>
      )}

      {showDescriptions && hasDescriptions && (
        <div className="compat-descriptions">
          <h3 className="compat-desc-title">Feature Descriptions</h3>
          <table className="compat-desc-table">
            <thead>
              <tr>
                <th className="compat-desc-th-sno">S.No</th>
                <th className="compat-desc-th-feature">Feature</th>
                <th className="compat-desc-th-desc">Description</th>
              </tr>
            </thead>
            <tbody>
              {rows.filter(r => r.description && r.description.trim()).map((row, idx) => (
                <tr key={idx}>
                  <td className="compat-desc-td-sno">{idx + 1}</td>
                  <td className="compat-desc-td-feature">{row.feature}</td>
                  <td className="compat-desc-td-desc">{row.description}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default CompatibilityTable;
