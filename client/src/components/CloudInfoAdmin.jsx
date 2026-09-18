import { useState, useEffect, useRef } from 'react';
import mammoth from 'mammoth';
import { showToast } from './Toast';

const MAX_CLOUD_INFO_PAGES = 50;
const MAX_CLOUD_INFO_IMAGES = 200;

function getCloudInfoStatsFromHtml(html = '') {
  const safeHtml = String(html || '');
  const imageCount = (safeHtml.match(/<img\b/gi) || []).length;
  const plainText = safeHtml.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  const pageCount = Math.max(1, Math.ceil(plainText.length / 3200));
  return { pageCount, imageCount };
}

function CloudInfoAdmin({ onChanged }) {
  const [items, setItems] = useState([]);
  const [mode, setMode] = useState('list');
  const [selectedId, setSelectedId] = useState('');
  const [name, setName] = useState('');
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [deleteInput, setDeleteInput] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [uploadStats, setUploadStats] = useState({ pageCount: 0, imageCount: 0 });
  const fileInputRef = useRef(null);
  const editorRef = useRef(null);
  const formTopRef = useRef(null);
  const infoDragItem = useRef(null);
  const infoDragOver = useRef(null);
  const [dragIdx, setDragIdx] = useState(null);
  const [showReorder, setShowReorder] = useState(false);

  useEffect(() => { fetchItems(); }, []);

  useEffect(() => {
    if ((mode === 'create' || mode === 'edit') && formTopRef.current) {
      formTopRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [mode]);

  const fetchItems = async () => {
    try {
      const res = await fetch('/api/cloud-info');
      const data = await res.json();
      setItems(data.items || []);
    } catch (_) {}
  };

  const resetForm = () => {
    setName('');
    setContent('');
    setSelectedId('');
    setIsEditing(false);
    setDeleteConfirm(null);
    setUploadStats({ pageCount: 0, imageCount: 0 });
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleNew = () => {
    resetForm();
    setMode('create');
    setIsEditing(true);
  };

  const handleEdit = async (item) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/cloud-info/${item.slug}`);
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setSelectedId(data.item.id || data.item._id);
      setName(data.item.name);
      setContent(data.item.content || '');
      setUploadStats(getCloudInfoStatsFromHtml(data.item.content || ''));
      setMode('edit');
      setIsEditing(false);
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    try {
      const arrayBuffer = await file.arrayBuffer();
      const options = {
        convertImage: mammoth.images.imgElement(function(image) {
          return image.read('base64').then(function(imageBuffer) {
            return { src: 'data:' + image.contentType + ';base64,' + imageBuffer };
          });
        })
      };
      const result = await mammoth.convertToHtml({ arrayBuffer }, options);
      const html = result.value;
      const stats = getCloudInfoStatsFromHtml(html);
      if (stats.pageCount > MAX_CLOUD_INFO_PAGES) {
        throw new Error(`Document has ${stats.pageCount} pages. Maximum allowed is ${MAX_CLOUD_INFO_PAGES}.`);
      }
      if (stats.imageCount > MAX_CLOUD_INFO_IMAGES) {
        throw new Error(`Document has ${stats.imageCount} images. Maximum allowed is ${MAX_CLOUD_INFO_IMAGES}.`);
      }
      setContent(html);
      setUploadStats(stats);
      if (editorRef.current) editorRef.current.innerHTML = html;
      showToast(`Document uploaded successfully (${stats.pageCount} pages, ${stats.imageCount} images).`);
    } catch (err) {
      showToast('Failed to parse document: ' + err.message, 'error');
    }
  };

  const handleSave = async () => {
    if (!name.trim()) { showToast('Name is required', 'error'); return; }

    const finalContent = editorRef.current ? editorRef.current.innerHTML : content;
    setSaving(true);

    try {
      const url = mode === 'create' ? '/api/cloud-info' : `/api/cloud-info/${selectedId}`;
      const method = mode === 'create' ? 'POST' : 'PUT';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), content: finalContent }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      if (data.stats) setUploadStats(data.stats);

      showToast(mode === 'create' ? 'Cloud Info created successfully!' : 'Cloud Info updated successfully!');
      await fetchItems();
      if (onChanged) onChanged();

      if (mode === 'create') {
        setSelectedId(data.item.id || data.item._id);
        setMode('edit');
      }
      setIsEditing(false);
      setContent(finalContent);
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id) => {
    setDeleting(true);
    try {
      await fetch(`/api/cloud-info/${id}`, { method: 'DELETE' });
      closeDeleteModal();
      showToast('Deleted successfully');
      await fetchItems();
      if (onChanged) onChanged();
      if (selectedId === id) {
        resetForm();
        setMode('list');
      }
    } catch (err) {
      showToast(err.message, 'error');
    }
    setDeleting(false);
  };

  const closeDeleteModal = () => { setDeleteConfirm(null); setDeleteInput(''); setDeleting(false); };

  // Same typed-DELETE confirmation the Documents tab uses.
  const renderDeleteModal = () => {
    const item = deleteConfirm ? items.find(i => i._id === deleteConfirm) : null;
    if (!item) return null;
    return (
      <div className="permanent-delete-modal" onClick={closeDeleteModal}>
        <div className="permanent-delete-card" onClick={e => e.stopPropagation()}>
          <h4>Delete Cloud Info</h4>
          <p>You are about to delete <strong>&quot;{item.name}&quot;</strong>.</p>
          <p>It moves to Trash and can be restored from there.</p>
          <p>Type <strong>DELETE</strong> to confirm:</p>
          <input
            type="text"
            value={deleteInput}
            onChange={e => setDeleteInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && deleteInput === 'DELETE' && !deleting) handleDelete(item._id);
              if (e.key === 'Escape') closeDeleteModal();
            }}
            placeholder="Type DELETE"
            autoFocus
          />
          <div className="permanent-delete-actions">
            <button className="btn-permanent-confirm" disabled={deleteInput !== 'DELETE' || deleting} onClick={() => handleDelete(item._id)}>
              {deleting ? 'Deleting...' : 'Delete'}
            </button>
            <button className="btn-cancel" onClick={closeDeleteModal}>Cancel</button>
          </div>
        </div>
      </div>
    );
  };

  const handleBack = () => {
    resetForm();
    setMode('list');
  };

  const startEditing = () => {
    setIsEditing(true);
    setTimeout(() => {
      if (editorRef.current) editorRef.current.innerHTML = content;
    }, 0);
  };

  const cancelEditing = () => {
    setIsEditing(false);
    if (editorRef.current) editorRef.current.innerHTML = content;
  };

  const execCmd = (cmd, value = null) => {
    document.execCommand(cmd, false, value);
    editorRef.current?.focus();
  };

  const handleInsertLink = () => {
    const url = prompt('Enter URL:');
    if (url) execCmd('createLink', url);
  };

  const handleInfoDragEnd = async () => {
    const from = infoDragItem.current;
    const to = infoDragOver.current;
    infoDragItem.current = null;
    infoDragOver.current = null;
    setDragIdx(null);
    if (from === null || to === null || from === to) return;
    const reordered = [...items];
    const [moved] = reordered.splice(from, 1);
    reordered.splice(to, 0, moved);
    setItems(reordered);
    try {
      const orderedIds = reordered.map(i => i._id);
      await fetch('/api/cloud-info-reorder', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderedIds }),
      });
      showToast('Order updated.');
      if (onChanged) onChanged();
    } catch (err) {
      showToast('Reorder failed: ' + err.message, 'error');
      fetchItems();
    }
  };

  if (mode === 'list') {
    return (
      <div className="cloud-info-admin">
        <div className="cloud-info-header">
          <h3>Cloud Info Management</h3>
          <button className="btn-create-new" onClick={handleNew}>+ New Cloud Info</button>
        </div>

        {items.length === 0 ? (
          <p className="cloud-info-empty">No Cloud Info entries yet. Click "New Cloud Info" to create one.</p>
        ) : (
          <>
            {items.length > 1 && (
              <div className="reorder-toggle-section">
                <button className="btn-reorder-toggle" onClick={() => setShowReorder(prev => !prev)}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="4" y1="9" x2="20" y2="9"/><line x1="4" y1="15" x2="20" y2="15"/><polyline points="10 3 8 6 6 3"/><polyline points="14 21 16 18 18 21"/></svg>
                  {showReorder ? 'Hide Reorder' : 'Reorder Items'}
                </button>
                {showReorder && (
                  <div className="reorder-list">
                    <label className="reorder-label">Cloud Info Order <span className="drag-hint-inline">(drag to reorder)</span></label>
                    {items.map((item, idx) => (
                      <div
                        key={item._id}
                        className={`reorder-item${dragIdx === idx ? ' reorder-item-dragging' : ''}`}
                        draggable
                        onDragStart={(e) => {
                          infoDragItem.current = idx;
                          setDragIdx(idx);
                          e.dataTransfer.effectAllowed = 'move';
                          e.dataTransfer.setData('text/plain', String(idx));
                        }}
                        onDragEnter={() => { infoDragOver.current = idx; }}
                        onDragOver={e => e.preventDefault()}
                        onDragEnd={handleInfoDragEnd}
                      >
                        <span className="drag-dots reorder-drag-handle">⠿</span>
                        <span className="reorder-item-name">{idx + 1}. {item.name}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
            <div className="cloud-info-list">
              {items.map((item) => (
                <div key={item._id} className="cloud-info-list-item">
                  <div className="cloud-info-list-name">{item.name}</div>
                  <div className="cloud-info-list-actions">
                    <button className="btn-edit-sm" onClick={() => handleEdit(item)}>Edit</button>
                    <button className="btn-delete-inline" onClick={() => { setDeleteInput(''); setDeleteConfirm(item._id); }}>Delete</button>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
        {renderDeleteModal()}
      </div>
    );
  }

  return (
    <div className="cloud-info-admin cloud-info-admin-fixed" ref={formTopRef}>
      <div className="cloud-info-sticky-top">
        <div className="cloud-info-header">
          <button className="btn-back" onClick={handleBack}>&larr; Back</button>
          <h3>{mode === 'create' ? 'Create Cloud Info' : `Edit: ${name}`}</h3>
          <div className="cloud-info-header-actions">
            {!loading && (
              isEditing ? (
                <>
                  <button className="btn-save" onClick={handleSave} disabled={saving}>
                    {saving ? 'Saving...' : 'Save'}
                  </button>
                  {mode === 'edit' && (
                    <button className="btn-cancel" onClick={cancelEditing}>Cancel</button>
                  )}
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
              <input
                type="text"
                value={name}
                onChange={e => setName(e.target.value)}
                disabled={!isEditing}
                placeholder="e.g. API Documentation"
              />
            </div>

            {isEditing && (
              <div className="form-group">
                <label>Upload Document (.docx)</label>
                <input
                  type="file"
                  ref={fileInputRef}
                  accept=".docx"
                  onChange={handleFileUpload}
                />
                <small className="cloud-upload-meta">
                  Supports up to {MAX_CLOUD_INFO_PAGES} pages and {MAX_CLOUD_INFO_IMAGES}+ images. Current: {uploadStats.pageCount || 0} pages, {uploadStats.imageCount || 0} images.
                </small>
              </div>
            )}

            {isEditing && (
              <div className="richtext-toolbar">
                <button type="button" onClick={() => execCmd('bold')} title="Bold"><b>B</b></button>
                <button type="button" onClick={() => execCmd('italic')} title="Italic"><i>I</i></button>
                <button type="button" onClick={() => execCmd('underline')} title="Underline"><u>U</u></button>
                <span className="toolbar-sep">|</span>
                <button type="button" onClick={() => execCmd('insertUnorderedList')} title="Bullet List">• List</button>
                <button type="button" onClick={() => execCmd('insertOrderedList')} title="Numbered List">1. List</button>
                <span className="toolbar-sep">|</span>
                <select onChange={e => { if (e.target.value) execCmd('formatBlock', e.target.value); e.target.value = ''; }} defaultValue="">
                  <option value="">Heading</option>
                  <option value="h1">H1</option>
                  <option value="h2">H2</option>
                  <option value="h3">H3</option>
                  <option value="h4">H4</option>
                  <option value="p">Paragraph</option>
                </select>
                <span className="toolbar-sep">|</span>
                <button type="button" onClick={handleInsertLink} title="Insert Link">Link</button>
                <span className="toolbar-sep">|</span>
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
            <div
              ref={editorRef}
              className="richtext-editor richtext-editor-no-top-radius"
              contentEditable
              suppressContentEditableWarning
              dangerouslySetInnerHTML={{ __html: content }}
            />
          ) : (
            <div className="cloud-info-preview" dangerouslySetInnerHTML={{ __html: content || '<em>No content yet</em>' }} />
          )}
        </div>
      )}
    </div>
  );
}

export default CloudInfoAdmin;
