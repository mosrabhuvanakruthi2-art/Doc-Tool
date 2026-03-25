import { useState, useEffect, useRef } from 'react';
import * as XLSX from 'xlsx';
import CustomSelect from './CustomSelect';
import { showToast } from './Toast';

const COMPAT_MATRICES_CHANGED = 'docproject:compat-matrices-changed';

function notifyCompatMatricesChanged() {
  window.dispatchEvent(new CustomEvent(COMPAT_MATRICES_CHANGED));
}

function CompatibilityAdmin({ onChanged }) {
  const [matrices, setMatrices] = useState([]);
  const [selectedId, setSelectedId] = useState('');
  const [mode, setMode] = useState('select');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);

  const [name, setName] = useState('');
  const [columns, setColumns] = useState([]);
  const [rows, setRows] = useState([]);
  const [notes, setNotes] = useState('');

  const [pasteText, setPasteText] = useState('');
  const [importMode, setImportMode] = useState('none');
  const [parsedPreview, setParsedPreview] = useState(null);
  const [showReorder, setShowReorder] = useState(false);
  const fileInputRef = useRef(null);
  const editorRef = useRef(null);
  const matrixDragItem = useRef(null);
  const matrixDragOver = useRef(null);

  useEffect(() => {
    fetchMatrices();
  }, []);

  useEffect(() => {
    if ((mode === 'create' || mode === 'edit') && editorRef.current) {
      editorRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [mode]);

  const fetchMatrices = async () => {
    try {
      const res = await fetch('/api/compatibility');
      const data = await res.json();
      setMatrices(data.matrices || []);
    } catch (_) {}
  };

  const loadMatrix = async (id) => {
    if (!id) return;
    setLoading(true);
    try {
      const m = matrices.find(x => x._id === id || x.slug === id);
      if (!m) throw new Error('Not found');
      const res = await fetch(`/api/compatibility/${m.slug}`);
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      const mx = data.matrix;
      setName(mx.name);
      setColumns([...mx.columns]);
      setRows(mx.rows.map(r => ({ feature: r.feature, values: [...r.values], description: r.description || '' })));
      setNotes(mx.notes || '');
      setSelectedId(mx.id || mx._id);
      setMode('edit');
    } catch (err) {
      showToast(err.message, 'error');
    }
    setLoading(false);
  };

  const resetForm = () => {
    setName('');
    setColumns([]);
    setRows([]);
    setNotes('');
    setSelectedId('');
    setPasteText('');
    setImportMode('none');
    setParsedPreview(null);
    setDeleteConfirm(false);
  };

  const startNew = () => {
    resetForm();
    setMode('create');
  };

  const addColumn = () => {
    setColumns(prev => [...prev, '']);
    setRows(prev => prev.map(r => ({ ...r, values: [...r.values, ''] })));
  };

  const removeColumn = (idx) => {
    setColumns(prev => prev.filter((_, i) => i !== idx));
    setRows(prev => prev.map(r => ({ ...r, values: r.values.filter((_, i) => i !== idx) })));
  };

  const updateColumn = (idx, val) => {
    setColumns(prev => prev.map((c, i) => i === idx ? val : c));
  };

  const addRow = () => {
    setRows(prev => [...prev, { feature: '', values: columns.map(() => ''), description: '' }]);
  };

  const removeRow = (idx) => {
    setRows(prev => prev.filter((_, i) => i !== idx));
  };

  const updateRowFeature = (idx, val) => {
    setRows(prev => prev.map((r, i) => i === idx ? { ...r, feature: val } : r));
  };

  const updateRowDescription = (idx, val) => {
    setRows(prev => prev.map((r, i) => i === idx ? { ...r, description: val } : r));
  };

  const setCellValue = (rIdx, cIdx, val) => {
    setRows(prev => prev.map((r, i) => {
      if (i !== rIdx) return r;
      const newValues = [...r.values];
      newValues[cIdx] = val;
      return { ...r, values: newValues };
    }));
  };

  // --- Parse tabular data (from paste or Excel) ---
  const parseTabularData = (lines) => {
    if (lines.length < 2) {
      showToast('Need at least a header row and one data row.', 'error');
      return null;
    }
    const headerRow = lines[0];
    const featureColLabel = headerRow[0] || 'Features';
    const allCols = headerRow.slice(1).map(h => String(h || '').trim());

    let lastNonEmpty = -1;
    for (let i = allCols.length - 1; i >= 0; i--) {
      if (allCols[i] !== '') { lastNonEmpty = i; break; }
    }
    const parsedCols = lastNonEmpty >= 0 ? allCols.slice(0, lastNonEmpty + 1) : [];

    if (parsedCols.length === 0) {
      showToast('No columns found in the header row.', 'error');
      return null;
    }

    const parsedRows = [];
    for (let i = 1; i < lines.length; i++) {
      const cells = lines[i];
      const feature = String(cells[0] || '').trim();
      if (!feature) continue;
      const values = parsedCols.map((_, ci) => String(cells[ci + 1] || '').trim());
      parsedRows.push({ feature, values, description: '' });
    }

    if (parsedRows.length === 0) {
      showToast('No valid rows found.', 'error');
      return null;
    }

    return { columns: parsedCols, rows: parsedRows, featureColLabel };
  };

  const applyResult = (result) => {
    setColumns([...result.columns]);
    setRows(result.rows.map(r => ({ ...r, values: [...r.values] })));
    setImportMode('none');
    setPasteText('');
    setParsedPreview(null);
    showToast(`Imported ${result.rows.length} rows and ${result.columns.length} columns.`);
  };

  // --- Paste from clipboard ---
  const parsePaste = () => {
    if (!pasteText.trim()) {
      showToast('Please paste some data first.', 'error');
      return;
    }
    const lines = pasteText.trim().split('\n').map(line => line.split('\t'));
    const result = parseTabularData(lines);
    if (result) {
      applyResult(result);
    }
  };

  // --- Upload Excel file ---
  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const data = new Uint8Array(evt.target.result);
        const workbook = XLSX.read(data, { type: 'array' });
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];
        const jsonData = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

        const result = parseTabularData(jsonData);
        if (result) {
          applyResult(result);
        }
      } catch (err) {
        showToast('Failed to parse Excel file: ' + err.message, 'error');
      }
    };
    reader.readAsArrayBuffer(file);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const applyParsed = () => {
    if (!parsedPreview) return;
    applyResult(parsedPreview);
  };

  const handleSave = async () => {
    if (!name.trim()) { showToast('Matrix name is required.', 'error'); return; }
    if (columns.length === 0) { showToast('Add at least one column.', 'error'); return; }
    if (rows.length === 0) { showToast('Add at least one row.', 'error'); return; }

    setSaving(true);

    try {
      const body = {
        name: name.trim(),
        columns: columns.map(c => c.trim()),
        rows: rows.map(r => ({
          feature: r.feature.trim(),
          values: r.values,
          description: (r.description || '').trim(),
        })),
        notes: notes.trim(),
      };

      let res;
      if (mode === 'edit' && selectedId) {
        res = await fetch(`/api/compatibility/${selectedId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
      } else {
        res = await fetch('/api/compatibility', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
      }

      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      const msg = mode === 'edit' ? 'Matrix updated successfully!' : 'Matrix created successfully!';
      await fetchMatrices();
      notifyCompatMatricesChanged();
      if (onChanged) onChanged();
      resetForm();
      setMode('select');
      showToast(msg);
    } catch (err) {
      showToast('Save failed: ' + err.message, 'error');
    }
    setSaving(false);
  };

  const handleMatrixDragEnd = async () => {
    const from = matrixDragItem.current;
    const to = matrixDragOver.current;
    matrixDragItem.current = null;
    matrixDragOver.current = null;
    if (from === null || to === null || from === to) return;
    const reordered = [...matrices];
    const [moved] = reordered.splice(from, 1);
    reordered.splice(to, 0, moved);
    setMatrices(reordered);
    try {
      const orderedIds = reordered.map((m) => String(m._id));
      const res = await fetch('/api/compatibility/reorder', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderedIds }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || res.statusText || 'Request failed');
      }
      showToast('Matrix order updated.');
      notifyCompatMatricesChanged();
      if (onChanged) onChanged();
    } catch (err) {
      showToast('Reorder failed: ' + err.message, 'error');
      fetchMatrices();
    }
  };

  const handleDelete = async () => {
    if (!selectedId) return;
    try {
      await fetch(`/api/compatibility/${selectedId}`, { method: 'DELETE' });
      showToast('Matrix deleted.');
      fetchMatrices();
      notifyCompatMatricesChanged();
      resetForm();
      setMode('select');
      if (onChanged) onChanged();
    } catch (err) {
      showToast('Delete failed: ' + err.message, 'error');
    }
    setDeleteConfirm(false);
  };

  return (
    <div className="scope-form">
      <h2 className="scope-form-title">Compatibility Matrix</h2>

      {mode === 'select' && (
        <div className="compat-admin-select">
          <div className="form-actions" style={{ marginBottom: 16 }}>
            <button className="btn-save" onClick={startNew}>+ Create New Matrix</button>
          </div>
          <div className="form-section">
            <div className="form-group">
              <label>Select an existing matrix to edit</label>
              <CustomSelect
                value=""
                onChange={(e) => { if (e.target.value) loadMatrix(e.target.value); }}
                options={matrices.map(m => ({ value: m._id, label: m.name }))}
                placeholder="-- Select Matrix --"
              />
            </div>
          </div>
          {matrices.length > 1 && (
            <div className="reorder-toggle-section">
              <button className="btn-reorder-toggle" onClick={() => setShowReorder(prev => !prev)}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="4" y1="9" x2="20" y2="9"/><line x1="4" y1="15" x2="20" y2="15"/><polyline points="10 3 8 6 6 3"/><polyline points="14 21 16 18 18 21"/></svg>
                {showReorder ? 'Hide Reorder' : 'Reorder Matrices'}
              </button>
              {showReorder && (
                <div className="reorder-list">
                  <label className="reorder-label">Matrix Order <span className="drag-hint-inline">(drag to reorder)</span></label>
                  {matrices.map((m, idx) => (
                    <div
                      key={m._id}
                      className="reorder-item"
                      draggable
                      onDragStart={(e) => {
                        matrixDragItem.current = idx;
                        e.dataTransfer.effectAllowed = 'move';
                        e.dataTransfer.setData('text/plain', String(idx));
                      }}
                      onDragOver={(e) => {
                        e.preventDefault();
                        matrixDragOver.current = idx;
                      }}
                      onDragEnd={handleMatrixDragEnd}
                    >
                      <span className="drag-dots reorder-drag-handle">⠿</span>
                      <span className="reorder-item-name">{idx + 1}. {m.name}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {(mode === 'create' || mode === 'edit') && (
        <div ref={editorRef}>
          <div className="compat-admin-toolbar">
            <button className="btn-secondary" onClick={() => { resetForm(); setMode('select'); }}>
              Back to List
            </button>
            <button
              className={`btn-secondary ${importMode === 'paste' ? 'active' : ''}`}
              onClick={() => { setImportMode(importMode === 'paste' ? 'none' : 'paste'); setParsedPreview(null); }}
            >
              Paste from Excel
            </button>
            <button
              className={`btn-secondary ${importMode === 'upload' ? 'active' : ''}`}
              onClick={() => { setImportMode(importMode === 'upload' ? 'none' : 'upload'); setParsedPreview(null); }}
            >
              Upload Excel File
            </button>
          </div>

          <div className="form-section">
            <div className="form-group">
              <label>Matrix Name <span className="required">*</span></label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Box for Business as a Source Combinations"
              />
            </div>
          </div>

          {importMode === 'upload' && (
            <div className="compat-paste-section">
              <div className="form-group">
                <label>Upload an Excel file (.xlsx, .xls, .csv)</label>
                <p className="paste-hint">
                  The first row should be headers (first cell = feature label, remaining = column names).
                  Each subsequent row = feature name + cell values.
                </p>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  onChange={handleFileUpload}
                  className="file-upload-input"
                />
              </div>
            </div>
          )}

          {importMode === 'paste' && (
            <div className="compat-paste-section">
              <div className="form-group">
                <label>Paste tab-separated data from Excel</label>
                <p className="paste-hint">
                  Copy your table from Excel (including header row) and paste below.
                  First column = feature names, remaining columns = combination headers with values.
                </p>
                <textarea
                  className="paste-textarea"
                  value={pasteText}
                  onChange={(e) => setPasteText(e.target.value)}
                  placeholder={'Features\tColumn 1\tColumn 2\nFeature A\tYes\tNo\nFeature B\tYes\tYes'}
                  rows={12}
                />
              </div>
              <div className="form-actions">
                <button className="btn-save" onClick={parsePaste}>Apply Data</button>
              </div>
            </div>
          )}

          {parsedPreview && (
            <div className="compat-paste-preview">
              <h3>Preview ({parsedPreview.rows.length} rows, {parsedPreview.columns.length} columns)</h3>
              <div className="compat-table-wrapper">
                <table className="compat-table compat-table-sm">
                  <thead>
                    <tr>
                      <th className="compat-th-sno">S.No</th>
                      <th className="compat-th-feature">{parsedPreview.featureColLabel}</th>
                      {parsedPreview.columns.map((c, i) => (
                        <th key={i} className="compat-th-col">{c}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {parsedPreview.rows.map((r, ri) => (
                      <tr key={ri}>
                        <td className="compat-td-sno">{ri + 1}</td>
                        <td className="compat-td-feature">{r.feature}</td>
                        {r.values.map((v, ci) => (
                          <td key={ci} className="compat-td-cell">{v}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="form-actions" style={{ marginTop: 12 }}>
                <button className="btn-save" onClick={applyParsed}>Apply to Editor</button>
                <button className="btn-secondary" onClick={() => setParsedPreview(null)}>Cancel</button>
              </div>
            </div>
          )}

          {importMode === 'none' && (
            <>
              {/* Column Editor */}
              <div className="form-section">
                <div className="compat-section-header">
                  <label>Columns (Combinations)</label>
                  <button className="btn-add-small" onClick={addColumn} title="Add column">+ Add Column</button>
                </div>
                {columns.length === 0 ? (
                  <p className="compat-empty-hint">No columns yet. Add columns or import from Excel.</p>
                ) : (
                  <div className="compat-columns-list">
                    {columns.map((col, i) => (
                      <div key={i} className="compat-column-item">
                        <span className="compat-col-num">{i + 1}</span>
                        <input
                          type="text"
                          value={col}
                          onChange={(e) => updateColumn(i, e.target.value)}
                          placeholder={`Column ${i + 1}`}
                        />
                        <button className="btn-remove-small" onClick={() => removeColumn(i)} title="Remove column">&times;</button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Row / Cell Editor */}
              {columns.length > 0 && (
                <div className="form-section">
                  <div className="compat-section-header">
                    <label>Features &amp; Values</label>
                    <button className="btn-add-small" onClick={addRow} title="Add row">+ Add Row</button>
                  </div>
                  {rows.length === 0 ? (
                    <p className="compat-empty-hint">No rows yet. Add rows or import from Excel.</p>
                  ) : (
                    <div className="compat-editor-table-wrapper">
                      <table className="compat-editor-table">
                        <thead>
                          <tr>
                            <th className="compat-eth-num">#</th>
                            <th className="compat-eth-feature">Feature</th>
                            {columns.map((col, i) => (
                              <th key={i} className="compat-eth-cell" title={col}>
                                {col.length > 20 ? col.slice(0, 18) + '...' : col}
                              </th>
                            ))}
                            <th className="compat-eth-desc">Description</th>
                            <th className="compat-eth-actions"></th>
                          </tr>
                        </thead>
                        <tbody>
                          {rows.map((row, rIdx) => (
                            <tr key={rIdx}>
                              <td className="compat-etd-num">{rIdx + 1}</td>
                              <td className="compat-etd-feature">
                                <input
                                  type="text"
                                  value={row.feature}
                                  onChange={(e) => updateRowFeature(rIdx, e.target.value)}
                                  placeholder="Feature name"
                                />
                              </td>
                              {columns.map((_, cIdx) => (
                                <td key={cIdx} className="compat-etd-cell">
                                  <input
                                    type="text"
                                    value={row.values[cIdx] || ''}
                                    onChange={(e) => setCellValue(rIdx, cIdx, e.target.value)}
                                    className="compat-cell-input"
                                  />
                                </td>
                              ))}
                              <td className="compat-etd-desc">
                                <input
                                  type="text"
                                  value={row.description}
                                  onChange={(e) => updateRowDescription(rIdx, e.target.value)}
                                  placeholder="Description (optional)"
                                />
                              </td>
                              <td className="compat-etd-actions">
                                <button className="btn-remove-small" onClick={() => removeRow(rIdx)} title="Remove row">&times;</button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </>
          )}

          {/* Show editor table even after import, once data is applied */}
          {importMode !== 'none' && columns.length > 0 && rows.length > 0 && !parsedPreview && (
            <div className="form-section">
              <div className="compat-section-header">
                <label>Imported Data (editable)</label>
                <button className="btn-add-small" onClick={addRow} title="Add row">+ Add Row</button>
              </div>
              <div className="compat-editor-table-wrapper">
                <table className="compat-editor-table">
                  <thead>
                    <tr>
                      <th className="compat-eth-num">#</th>
                      <th className="compat-eth-feature">Feature</th>
                      {columns.map((col, i) => (
                        <th key={i} className="compat-eth-cell" title={col}>
                          {col.length > 20 ? col.slice(0, 18) + '...' : col}
                        </th>
                      ))}
                      <th className="compat-eth-desc">Description</th>
                      <th className="compat-eth-actions"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row, rIdx) => (
                      <tr key={rIdx}>
                        <td className="compat-etd-num">{rIdx + 1}</td>
                        <td className="compat-etd-feature">
                          <input
                            type="text"
                            value={row.feature}
                            onChange={(e) => updateRowFeature(rIdx, e.target.value)}
                            placeholder="Feature name"
                          />
                        </td>
                        {columns.map((_, cIdx) => (
                          <td key={cIdx} className="compat-etd-cell">
                            <input
                              type="text"
                              value={row.values[cIdx] || ''}
                              onChange={(e) => setCellValue(rIdx, cIdx, e.target.value)}
                              className="compat-cell-input"
                            />
                          </td>
                        ))}
                        <td className="compat-etd-desc">
                          <input
                            type="text"
                            value={row.description}
                            onChange={(e) => updateRowDescription(rIdx, e.target.value)}
                            placeholder="Description (optional)"
                          />
                        </td>
                        <td className="compat-etd-actions">
                          <button className="btn-remove-small" onClick={() => removeRow(rIdx)} title="Remove row">&times;</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="form-section">
            <div className="form-group">
              <label>Notes (optional)</label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Any additional notes to display below the table..."
                rows={4}
              />
            </div>
          </div>

          <div className="form-actions compat-admin-actions">
            <button className="btn-save" onClick={handleSave} disabled={saving}>
              {saving ? 'Saving...' : mode === 'edit' ? 'Update Matrix' : 'Create Matrix'}
            </button>
            {mode === 'edit' && (
              <>
                {deleteConfirm ? (
                  <div className="delete-confirm">
                    <span>Delete this matrix?</span>
                    <button className="btn-yes" onClick={handleDelete}>Yes</button>
                    <button className="btn-no" onClick={() => setDeleteConfirm(false)}>No</button>
                  </div>
                ) : (
                  <button className="btn-delete" onClick={() => setDeleteConfirm(true)}>Delete Matrix</button>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default CompatibilityAdmin;
