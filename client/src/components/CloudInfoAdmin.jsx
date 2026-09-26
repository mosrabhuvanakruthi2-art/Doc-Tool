import { useState, useEffect, useRef } from 'react';
// mammoth (DOCX -> HTML) is only needed when a Word file is imported, so it loads then.
const loadMammoth = () => import('mammoth').then((m) => m.default);
import { showToast } from './Toast';
import CfLoader from './CfLoader';
import { useUrlParams } from '../useUrlParams';
import { useLinkDialog } from './AppDialog';
import { TEXT_EXTS } from './FilePreview';
import { cleanHtml } from '../sanitize';

const MAX_CLOUD_INFO_PAGES = 50;
const MAX_CLOUD_INFO_IMAGES = 200;
// Cloud Info keeps formatted text only (no file storage), so an upload is turned
// into editor content: Word and HTML keep their formatting, text-type files come
// in as text, and images are added into the page.
const IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'gif', 'webp'];
const CSV_EXTS = ['csv', 'tsv'];
const escapeText = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const readAsDataUrl = (file) => new Promise((resolve, reject) => {
  const r = new FileReader(); r.onload = () => resolve(r.result); r.onerror = () => reject(r.error); r.readAsDataURL(file);
});

function getCloudInfoStatsFromHtml(html = '') {
  const safeHtml = String(html || '');
  const imageCount = (safeHtml.match(/<img\b/gi) || []).length;
  const plainText = safeHtml.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  const pageCount = Math.max(1, Math.ceil(plainText.length / 3200));
  return { pageCount, imageCount };
}

// Does editor HTML hold anything real (text, an image, a table…), not just empty tags?
const htmlHasContent = (html) => {
  const h = String(html || '');
  if (/<(img|table|video|audio|iframe|hr)\b/i.test(h)) return true;
  return h.replace(/<[^>]*>/g, '').replace(/&nbsp;|\u00a0/g, ' ').trim().length > 0;
};

function CloudInfoAdmin({ onChanged }) {
  const [items, setItems] = useState([]);
  // True until the first list fetch settles, so the empty state never flashes.
  const [listLoading, setListLoading] = useState(true);
  const [mode, setMode] = useState('list');
  const [selectedId, setSelectedId] = useState('');
  const [name, setName] = useState('');
  const [content, setContent] = useState('');
  // What is typed in the editor right now (it is not a controlled input), so Save
  // can stay disabled until there is some content (same as Documents).
  const [editorHtml, setEditorHtml] = useState('');
  useEffect(() => { setEditorHtml(content); }, [content]);
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

  // Which entry is open lives in the URL: ?item=<slug> to edit it, ?new=1 to create
  // one. Refresh reopens it, Back/Forward move between list and editor, links work.
  const [param, setParams] = useUrlParams();
  const urlItem = param('item');
  const urlNew = param('new') === '1';
  // Search bar (?q=) at the right of the header; kept in the URL so refresh keeps it.
  const urlQ = param('q');
  const searchText = urlQ.trim().toLowerCase();
  const setSearch = (v) => { if (v) setShowReorder(false); setParams({ q: v }, { replace: true }); };
  const loadedSlugRef = useRef('');

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
    } catch (_) {
    } finally {
      setListLoading(false);
    }
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

  const handleNew = () => setParams({ new: 1, item: '' });
  const openItem = (item) => setParams({ item: item.slug, new: '' });

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
      setParams({ item: '' }, { replace: true }); // missing or deleted: back to the list
    } finally {
      setLoading(false);
    }
  };

  const [dragOver, setDragOver] = useState(false); // upload drop-zone highlight

  const handleFileUpload = (e) => {
    const file = e.target.files && e.target.files[0];
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (file) processFile(file);
  };

  // Put new HTML in the editor, after checking the page / image limits.
  const applyHtml = (html, message) => {
    const stats = getCloudInfoStatsFromHtml(html);
    if (stats.pageCount > MAX_CLOUD_INFO_PAGES) throw new Error(`It has ${stats.pageCount} pages. Maximum allowed is ${MAX_CLOUD_INFO_PAGES}.`);
    if (stats.imageCount > MAX_CLOUD_INFO_IMAGES) throw new Error(`It has ${stats.imageCount} images. Maximum allowed is ${MAX_CLOUD_INFO_IMAGES}.`);
    setContent(html);
    setUploadStats(stats);
    if (editorRef.current) editorRef.current.innerHTML = html;
    showToast(message(stats));
  };

  const processFile = async (file) => {
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    try {
      if (ext === 'docx') { await importDocx(file); return; }
      if (ext === 'html' || ext === 'htm') {
        applyHtml(cleanHtml(await file.text()), () => 'HTML loaded — edit and Save');
        return;
      }
      if (CSV_EXTS.includes(ext) || TEXT_EXTS.includes(ext)) {
        applyHtml('<pre>' + escapeText(await file.text()) + '</pre>', () => `${ext.toUpperCase()} loaded — edit and Save`);
        return;
      }
      if (IMAGE_EXTS.includes(ext)) {
        // Images are added to the end of the page (the rest is kept).
        const current = editorRef.current ? editorRef.current.innerHTML : content;
        const img = `<p><img src="${await readAsDataUrl(file)}" alt="${escapeText(file.name)}"></p>`;
        applyHtml(current + img, () => 'Image added — Save to keep it');
        return;
      }
      showToast(`.${ext || 'this'} files can't become editable text here. Use Word (.docx), HTML, text or images — or add the file in Documents.`, 'error');
    } catch (err) {
      showToast('Failed to read file: ' + err.message, 'error');
    }
  };

  const importDocx = async (file) => {
    const arrayBuffer = await file.arrayBuffer();
    const mammoth = await loadMammoth();
    const options = {
      convertImage: mammoth.images.imgElement(function(image) {
        return image.read('base64').then(function(imageBuffer) {
          return { src: 'data:' + image.contentType + ';base64,' + imageBuffer };
        });
      })
    };
    const result = await mammoth.convertToHtml({ arrayBuffer }, options);
    applyHtml(result.value, (stats) => `Document uploaded successfully (${stats.pageCount} pages, ${stats.imageCount} images).`);
  };

  const handleSave = async () => {
    if (!name.trim()) { showToast('Name is required', 'error'); return; }
    if (!htmlHasContent(editorRef.current ? editorRef.current.innerHTML : content)) {
      showToast('Add some content before saving', 'error');
      return;
    }

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
      if (data.item && data.item.slug) {
        loadedSlugRef.current = data.item.slug; // already on screen: no reload
        setParams({ item: data.item.slug, new: '' }, { replace: true });
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
        setParams({ item: '', new: '' }, { replace: true }); // it no longer exists
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

  const handleBack = () => setParams({ item: '', new: '' });

  // Keep the page in step with the URL (clicks, refresh, Back/Forward, links).
  useEffect(() => {
    if (urlNew) {
      if (mode !== 'create') { loadedSlugRef.current = ''; resetForm(); setMode('create'); setIsEditing(true); }
      return;
    }
    if (urlItem) {
      if (loadedSlugRef.current === urlItem && mode === 'edit') return;
      loadedSlugRef.current = urlItem;
      handleEdit({ slug: urlItem });
      return;
    }
    if (mode !== 'list') { loadedSlugRef.current = ''; resetForm(); setMode('list'); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlItem, urlNew]);

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

  // In-page link dialog instead of the browser's prompt().
  const { openLinkDialog, linkDialog } = useLinkDialog(editorRef);
  const handleInsertLink = openLinkDialog;

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
          {items.length > 1 && !searchText && (
            <button className="btn-reorder-toggle" onClick={() => setShowReorder(prev => !prev)}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="4" y1="9" x2="20" y2="9"/><line x1="4" y1="15" x2="20" y2="15"/><polyline points="10 3 8 6 6 3"/><polyline points="14 21 16 18 18 21"/></svg>
              {showReorder ? 'Hide Reorder' : 'Reorder Items'}
            </button>
          )}
          <button className="btn-create-new" onClick={handleNew}>+ New Cloud Info</button>
          {items.length > 0 && (
            <div className="ci-search-bar">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
              <input
                type="text"
                value={urlQ}
                placeholder="Search cloud info…"
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Escape') setSearch(''); }}
                aria-label="Search cloud info"
              />
              {urlQ && (
                <button type="button" className="ci-search-clear" onClick={() => setSearch('')} title="Clear" aria-label="Clear search">×</button>
              )}
            </div>
          )}
        </div>

        {listLoading && items.length === 0 ? (
          <CfLoader inline />
        ) : items.length === 0 ? (
          <p className="cloud-info-empty">No Cloud Info entries yet. Click "New Cloud Info" to create one.</p>
        ) : (
          <>
            {items.length > 1 && showReorder && !searchText && (
              <div className="reorder-toggle-section">
                {(
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
            {searchText && (() => {
              const n = items.filter(it => String(it.name || '').toLowerCase().includes(searchText)).length;
              return (
                <p className="doc-search-summary">
                  {n ? `${n} result${n !== 1 ? 's' : ''} for “${urlQ.trim()}”` : `No cloud info matches “${urlQ.trim()}”.`}
                </p>
              );
            })()}
            <div className="cloud-info-list">
              {items.filter(it => !searchText || String(it.name || '').toLowerCase().includes(searchText)).map((item) => (
                <div
                  key={item._id}
                  className="cloud-info-list-item cloud-info-list-open"
                  title="Open (read-only)"
                  onClick={(e) => { if (!e.target.closest('button, input, a')) openItem(item); }}
                >
                  <div className="cloud-info-list-name">
                    <svg className="cloud-info-list-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /></svg>
                    <span
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => { if (e.key === 'Enter') openItem(item); }}
                    >{item.name}</span>
                  </div>
                  <div className="cloud-info-list-actions">
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
    <div className="cloud-info-admin doc-admin-flow" ref={formTopRef}>
      <div className="cloud-info-sticky-top">
        <div className="cloud-info-header">
          <button className="btn-back" onClick={handleBack}>&larr; Back</button>
          <h3>{mode === 'create' ? 'Create Cloud Info' : name}</h3>
          <div className="cloud-info-header-actions">
            {!loading && (
              isEditing ? (
                <>
                  <button
                    className="btn-save"
                    onClick={handleSave}
                    disabled={saving || !htmlHasContent(editorHtml)}
                    title={htmlHasContent(editorHtml) ? undefined : 'Add some content first'}
                  >
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
                <label>Upload File</label>
                <div
                  className={`doc-dropzone${dragOver ? ' doc-dropzone-over' : ''}`}
                  onDragOver={(e) => { e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'; if (!dragOver) setDragOver(true); }}
                  onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setDragOver(false); }}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDragOver(false);
                    const file = e.dataTransfer.files && e.dataTransfer.files[0];
                    if (file) processFile(file);
                  }}
                  onClick={() => fileInputRef.current && fileInputRef.current.click()}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInputRef.current && fileInputRef.current.click(); } }}
                >
                  <svg className="doc-dropzone-icon" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                  <div className="doc-dropzone-text">
                    <strong>{dragOver ? 'Drop to add' : 'Drag & drop'}</strong> a file here, or <span className="doc-dropzone-link">browse</span>
                  </div>
                </div>
                <input type="file" ref={fileInputRef} onChange={handleFileUpload} hidden />
                <small className="cloud-upload-meta">
                  Word (.docx) and HTML keep their formatting, text files load as text, images are added to the page.{' '}
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
                {linkDialog}
                <span className="toolbar-sep">|</span>
                <button type="button" onClick={() => execCmd('removeFormat')} title="Clear Formatting">Clear</button>
              </div>
            )}
          </>
        )}
      </div>

      {loading && <CfLoader inline />}

      {!loading && (
        <div className="cloud-info-scroll-area">
          {isEditing ? (
            <div
              ref={editorRef}
              className="richtext-editor richtext-editor-no-top-radius"
              contentEditable
              suppressContentEditableWarning
              dangerouslySetInnerHTML={{ __html: content }}
              onInput={(e) => setEditorHtml(e.currentTarget.innerHTML)}
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
