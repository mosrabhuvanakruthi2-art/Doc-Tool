import { useRef, useState, useEffect, useImperativeHandle, forwardRef } from 'react';
import * as XLSX from 'xlsx';
import { showToast } from './Toast';

// An Excel-like grid editor for .xlsx/.xls/.csv/.tsv.
//
//   - Loads from a File (a freshly chosen upload) or a URL (an already-saved
//     file), parsing every sheet with SheetJS.
//   - Edits happen in place in contentEditable cells; add rows/columns as needed.
//   - Other sheets are preserved: on save the whole workbook is written back,
//     with only the sheets the user touched updated.
//   - Exposes getBlob() so the page's Save button can produce the final file.
//
// readOnly renders the same grid without editing, for inline preview.
const SHEET_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

function normalizeAoa(rows) {
  const cols = Math.max(1, ...rows.map((r) => r.length), 1);
  if (!rows.length) return [Array(cols).fill('')];
  return rows.map((r) => {
    const a = r.map((c) => (c == null ? '' : String(c)));
    while (a.length < cols) a.push('');
    return a;
  });
}

const SpreadsheetEditor = forwardRef(function SpreadsheetEditor({ file, url, ext, readOnly = false }, ref) {
  const wbRef = useRef(null);          // the parsed workbook (all sheets)
  const editedRef = useRef({});        // sheetName -> latest AOA the user edited
  const tableRef = useRef(null);
  const [names, setNames] = useState([]);
  const [active, setActive] = useState('');
  const [aoa, setAoa] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [file, url]);

  const sheetToAoa = (ws) => normalizeAoa(XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' }));

  const load = async () => {
    setLoading(true);
    try {
      let buf;
      if (file) buf = await file.arrayBuffer();
      else if (url) buf = await (await fetch(url)).arrayBuffer();
      if (!buf) { wbRef.current = XLSX.utils.book_new(); setNames([]); setAoa([['']]); setLoading(false); return; }
      const wb = XLSX.read(buf, { type: 'array' });
      wbRef.current = wb;
      editedRef.current = {};
      const first = wb.SheetNames[0];
      setNames(wb.SheetNames);
      setActive(first);
      setAoa(sheetToAoa(wb.Sheets[first]));
    } catch (e) {
      showToast('Could not read spreadsheet: ' + e.message, 'error');
      wbRef.current = XLSX.utils.book_new();
      setNames([]); setAoa([['']]);
    }
    setLoading(false);
  };

  // Read the current grid straight from the DOM (avoids per-keystroke state).
  const readDom = () => {
    const table = tableRef.current;
    if (!table) return aoa || [['']];
    const out = [];
    table.querySelectorAll('tbody tr').forEach((tr) => {
      const row = [];
      tr.querySelectorAll('td.sheet-cell').forEach((td) => row.push(td.innerText.replace(/\n$/, '')));
      out.push(row);
    });
    return out.length ? out : [['']];
  };

  // Persist the current sheet's edits before switching away or saving.
  const stashActive = () => { if (!readOnly && active) editedRef.current[active] = readDom(); };

  const switchSheet = (name) => {
    if (name === active) return;
    stashActive();
    setActive(name);
    setAoa(editedRef.current[name] || sheetToAoa(wbRef.current.Sheets[name]));
  };

  const addRow = () => { const cur = readDom(); setAoa([...cur, Array(cur[0]?.length || 1).fill('')]); };
  const addCol = () => { const cur = readDom(); setAoa(cur.map((r) => [...r, ''])); };

  // Build the final workbook (all sheets, edited ones updated) and hand back a Blob.
  const buildBlob = () => {
    stashActive();
    const wb = wbRef.current || XLSX.utils.book_new();
    if (!wb.SheetNames.length) {
      const ws = XLSX.utils.aoa_to_sheet(readDom());
      XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
    }
    Object.entries(editedRef.current).forEach(([name, data]) => {
      wb.Sheets[name] = XLSX.utils.aoa_to_sheet(data);
    });
    const outExt = String(ext || 'xlsx').toLowerCase();
    const bookType = outExt === 'csv' ? 'csv' : outExt === 'tsv' ? 'txt' : 'xlsx';
    const out = XLSX.write(wb, { type: 'array', bookType });
    const mime = bookType === 'xlsx' ? SHEET_MIME : 'text/csv';
    const fname = 'sheet.' + (bookType === 'txt' ? 'csv' : bookType);
    return { blob: new Blob([out], { type: mime }), fname };
  };

  useImperativeHandle(ref, () => ({ getBlob: buildBlob }), [active, aoa]);

  if (loading || !aoa) return <p style={{ padding: 20 }}>Loading spreadsheet…</p>;
  const cols = aoa[0]?.length || 1;

  return (
    <div className="sheet-editor">
      {!readOnly && (
        <div className="sheet-toolbar">
          <button type="button" className="btn-edit-sm" onClick={addRow}>+ Row</button>
          <button type="button" className="btn-edit-sm" onClick={addCol}>+ Column</button>
        </div>
      )}
      {names.length > 1 && (
        <div className="sheet-tabs">
          {names.map((n) => (
            <button
              key={n}
              type="button"
              className={`sheet-tab${n === active ? ' sheet-tab-active' : ''}`}
              onClick={() => switchSheet(n)}
            >{n}</button>
          ))}
        </div>
      )}
      <div className="sheet-scroll">
        <table className="sheet-table" ref={tableRef}>
          <thead>
            <tr>
              <th className="sheet-corner" />
              {Array.from({ length: cols }).map((_, c) => <th key={c}>{XLSX.utils.encode_col(c)}</th>)}
            </tr>
          </thead>
          <tbody>
            {aoa.map((row, r) => (
              <tr key={r}>
                <th className="sheet-rownum">{r + 1}</th>
                {Array.from({ length: cols }).map((_, c) => (
                  <td
                    key={c}
                    className="sheet-cell"
                    contentEditable={!readOnly}
                    suppressContentEditableWarning
                  >{row[c] ?? ''}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
});

export default SpreadsheetEditor;
