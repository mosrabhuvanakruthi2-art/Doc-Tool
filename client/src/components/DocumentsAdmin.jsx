import { useState, useEffect, useRef } from 'react';
import mammoth from 'mammoth';
import { showToast } from './Toast';

function DocumentsAdmin({ onChanged }) {
  const [items, setItems] = useState([]);
  const [mode, setMode] = useState('list');
  const [selectedId, setSelectedId] = useState('');
  const [name, setName] = useState('');
  const [content, setContent] = useState('');
  const [fileType, setFileType] = useState('manual');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [isEditing, setIsEditing] = useState(false);
  const [showReorder, setShowReorder] = useState(false);
  const fileInputRef = useRef(null);
  const editorRef = useRef(null);
  const formTopRef = useRef(null);
  const dragItem = useRef(null);
  const dragOver = useRef(null);

  useEffect(() => { fetchItems(); }, []);

  useEffect(() => {
    if ((mode === 'create' || mode === 'edit') && formTopRef.current) {
      formTopRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [mode]);

  const fetchItems = async () => {
    try {
      const res = await fetch('/api/documents');
      const data = await res.json();
      setItems(data.items || []);
    } catch (_) {}
  };

  const resetForm = () => {
    setName('');
    setContent('');
    setFileType('manual');
    setSelectedId('');
    setIsEditing(false);
    setDeleteConfirm(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleNew = () => { resetForm(); setMode('create'); setIsEditing(true); };

  const handleEdit = async (item) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/documents/${item.slug}`);
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setSelectedId(data.item.id || data.item._id);
      setName(data.item.name);
      setContent(data.item.content || '');
      setFileType(data.item.fileType || 'manual');
      setMode('edit');
      setIsEditing(false);
    } catch (err) { showToast(err.message, 'error'); }
    setLoading(false);
  };

  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const ext = file.name.split('.').pop().toLowerCase();

    if (ext === 'docx') {
      try {
        const arrayBuffer = await file.arrayBuffer();
        const options = {
          convertImage: mammoth.images.imgElement(function (image) {
            return image.read('base64').then(function (imageBuffer) {
              return { src: 'data:' + image.contentType + ';base64,' + imageBuffer };
            });
          }),
        };
        const result = await mammoth.convertToHtml({ arrayBuffer }, options);
        setContent(result.value);
        setFileType('docx');
        if (editorRef.current) editorRef.current.innerHTML = result.value;
        showToast('DOCX parsed successfully');
      } catch (err) { showToast('Failed to parse: ' + err.message, 'error'); }
    } else if (ext === 'pdf' || ext === 'xlsx' || ext === 'xls') {
      try {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('name', name || file.name);
        const res = await fetch('/api/documents/upload', { method: 'POST', body: formData });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        showToast('File uploaded successfully');
        await fetchItems();
        if (onChanged) onChanged();
        setSelectedId(data.item.id || data.item._id);
        setName(data.item.name);
        setContent(data.item.content || '');
        setFileType(data.item.fileType || ext);
        setMode('edit');
        setIsEditing(false);
      } catch (err) { showToast(err.message, 'error'); }
    } else {
      showToast('Supported formats: .docx, .pdf, .xlsx', 'error');
    }
  };

  const handleSave = async () => {
    if (!name.trim()) { showToast('Name is required', 'error'); return; }
    const finalContent = editorRef.current ? editorRef.current.innerHTML : content;
    setSaving(true);
    try {
      const url = mode === 'create' ? '/api/documents' : `/api/documents/${selectedId}`;
      const method = mode === 'create' ? 'POST' : 'PUT';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), content: finalContent, fileType }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      showToast(mode === 'create' ? 'Document created!' : 'Document updated!');
      await fetchItems();
      if (onChanged) onChanged();
      if (mode === 'create') {
        setSelectedId(data.item.id || data.item._id);
        setMode('edit');
      }
      setIsEditing(false);
      setContent(finalContent);
    } catch (err) { showToast(err.message, 'error'); }
    setSaving(false);
  };

  const handleDelete = async (id) => {
    try {
      await fetch(`/api/documents/${id}`, { method: 'DELETE' });
      setDeleteConfirm(null);
      showToast('Deleted successfully');
      await fetchItems();
      if (onChanged) onChanged();
      if (selectedId === id) { resetForm(); setMode('list'); }
    } catch (err) { showToast(err.message, 'error'); }
  };

  const handleBack = () => { resetForm(); setMode('list'); };
  const startEditing = () => {
    setIsEditing(true);
    setTimeout(() => { if (editorRef.current) editorRef.current.innerHTML = content; }, 0);
  };
  const cancelEditing = () => {
    setIsEditing(false);
    if (editorRef.current) editorRef.current.innerHTML = content;
  };
  const execCmd = (cmd, value = null) => { document.execCommand(cmd, false, value); editorRef.current?.focus(); };
  const handleInsertLink = () => { const url = prompt('Enter URL:'); if (url) execCmd('createLink', url); };

  const handleDragEnd = async () => {
    const from = dragItem.current;
    const to = dragOver.current;
    dragItem.current = null;
    dragOver.current = null;
    if (from === null || to === null || from === to) return;
    const reordered = [...items];
    const [moved] = reordered.splice(from, 1);
    reordered.splice(to, 0, moved);
    setItems(reordered);
    try {
      await fetch('/api/documents/reorder', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderedIds: reordered.map(i => i._id) }),
      });
      showToast('Order updated.');
      if (onChanged) onChanged();
    } catch (err) { showToast('Reorder failed', 'error'); fetchItems(); }
  };

  if (mode === 'list') {
    return (
      <div className="cloud-info-admin">
        <div className="cloud-info-header">
          <h3>Documents Management</h3>
          <button className="btn-create-new" onClick={handleNew}>+ New Document</button>
        </div>
        {items.length === 0 ? (
          <p className="cloud-info-empty">No documents yet. Click "+ New Document" to create one.</p>
        ) : (
          <>
            <div className="cloud-info-list">
              {items.map((item) => (
                <div key={item._id} className="cloud-info-list-item">
                  <div className="cloud-info-list-name">
                    {item.name}
                    {item.fileType && item.fileType !== 'manual' && (
                      <span className="doc-type-badge">{item.fileType.toUpperCase()}</span>
                    )}
                  </div>
                  <div className="cloud-info-list-actions">
                    <button className="btn-edit-sm" onClick={() => handleEdit(item)}>Edit</button>
                    {deleteConfirm === item._id ? (
                      <div className="delete-confirm-bar">
                        <span>Delete?</span>
                        <button className="btn-confirm-yes" onClick={() => handleDelete(item._id)}>Yes</button>
                        <button className="btn-confirm-cancel" onClick={() => setDeleteConfirm(null)}>Cancel</button>
                      </div>
                    ) : (
                      <button className="btn-delete-inline" onClick={() => setDeleteConfirm(item._id)}>Delete</button>
                    )}
                  </div>
                </div>
              ))}
            </div>
            {items.length > 1 && (
              <div className="reorder-toggle-section">
                <button className="btn-reorder-toggle" onClick={() => setShowReorder(prev => !prev)}>
                  {showReorder ? 'Hide Reorder' : 'Reorder Documents'}
                </button>
                {showReorder && (
                  <div className="reorder-list">
                    <label className="reorder-label">Document Order <span className="drag-hint-inline">(drag to reorder)</span></label>
                    {items.map((item, idx) => (
                      <div key={item._id} className="reorder-item" draggable
                        onDragStart={() => { dragItem.current = idx; }}
                        onDragOver={(e) => { e.preventDefault(); dragOver.current = idx; }}
                        onDragEnd={handleDragEnd}
                      >
                        <span className="drag-dots reorder-drag-handle">⠿</span>
                        <span className="reorder-item-name">{idx + 1}. {item.name}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    );
  }

  return (
    <div className="cloud-info-admin cloud-info-admin-fixed" ref={formTopRef}>
      <div className="cloud-info-sticky-top">
        <div className="cloud-info-header">
          <button className="btn-back" onClick={handleBack}>&larr; Back</button>
          <h3>{mode === 'create' ? 'Create Document' : `Edit: ${name}`}</h3>
          <div className="cloud-info-header-actions">
            {!loading && (
              isEditing ? (
                <>
                  <button className="btn-save" onClick={handleSave} disabled={saving}>{saving ? 'Saving...' : 'Save'}</button>
                  {mode === 'edit' && <button className="btn-cancel" onClick={cancelEditing}>Cancel</button>}
                </>
              ) : (
                <button className="btn-edit-sm" onClick={startEditing}>Edit Content</button>
              )
            )}
          </div>
        </div>
        {!loading && (
          <>
            <div className="form-group">
              <label>Name</label>
              <input type="text" value={name} onChange={e => setName(e.target.value)} disabled={!isEditing} placeholder="e.g. Migration Guide" />
            </div>
            {isEditing && (
              <div className="form-group">
                <label>Upload File (.docx, .pdf, .xlsx)</label>
                <input type="file" ref={fileInputRef} accept=".docx,.pdf,.xlsx,.xls" onChange={handleFileUpload} />
                <small className="cloud-upload-meta">DOCX files are parsed inline. PDF/XLSX are stored as downloadable files.</small>
              </div>
            )}
            {isEditing && (
              <div className="richtext-toolbar">
                <button type="button" onClick={() => execCmd('bold')} title="Bold"><b>B</b></button>
                <button type="button" onClick={() => execCmd('italic')} title="Italic"><i>I</i></button>
                <button type="button" onClick={() => execCmd('underline')} title="Underline"><u>U</u></button>
                <span className="toolbar-sep">|</span>
                <button type="button" onClick={() => execCmd('insertUnorderedList')} title="Bullet List">&#8226; List</button>
                <button type="button" onClick={() => execCmd('insertOrderedList')} title="Numbered List">1. List</button>
                <span className="toolbar-sep">|</span>
                <select onChange={e => { if (e.target.value) execCmd('formatBlock', e.target.value); e.target.value = ''; }} defaultValue="">
                  <option value="">Heading</option>
                  <option value="h1">H1</option>
                  <option value="h2">H2</option>
                  <option value="h3">H3</option>
                  <option value="p">Paragraph</option>
                </select>
                <span className="toolbar-sep">|</span>
                <button type="button" onClick={handleInsertLink} title="Insert Link">Link</button>
                <button type="button" onClick={() => execCmd('removeFormat')} title="Clear Formatting">Clear</button>
              </div>
            )}
          </>
        )}
      </div>
      {loading && <p style={{ padding: '20px' }}>Loading...</p>}
      {!loading && (
        <div className="cloud-info-scroll-area">
          {isEditing ? (
            <div ref={editorRef} className="richtext-editor richtext-editor-no-top-radius" contentEditable suppressContentEditableWarning dangerouslySetInnerHTML={{ __html: content }} />
          ) : (
            <div className="cloud-info-preview" dangerouslySetInnerHTML={{ __html: content || '<em>No content yet</em>' }} />
          )}
        </div>
      )}
    </div>
  );
}

export default DocumentsAdmin;
