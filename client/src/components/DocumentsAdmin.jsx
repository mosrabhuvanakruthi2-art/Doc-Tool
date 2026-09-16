import { useState, useEffect, useRef, useMemo } from 'react';
import mammoth from 'mammoth';
import { showToast } from './Toast';

const FOLDER_ICON = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
  </svg>
);

const FILE_ICON = (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <polyline points="14 2 14 8 20 8" />
  </svg>
);

const GRIP = <span className="doc-tree-grip" title="Drag to reorder">⠿</span>;

const CHEVRON = (expanded) => (
  <svg className={`doc-tree-chevron ${expanded ? 'expanded' : ''}`} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="9 18 15 12 9 6" />
  </svg>
);

function DocumentsAdmin({ onChanged }) {
  const [items, setItems] = useState([]);
  const [folders, setFolders] = useState([]);
  const [mode, setMode] = useState('list');
  const [selectedId, setSelectedId] = useState('');
  const [name, setName] = useState('');
  const [content, setContent] = useState('');
  const [fileType, setFileType] = useState('manual');
  const [formFolderId, setFormFolderId] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [isEditing, setIsEditing] = useState(false);

  // Tree state
  const [expanded, setExpanded] = useState({});          // folderId -> bool
  const [newFolderIn, setNewFolderIn] = useState(null);  // parentId ('' = root) while naming a new folder
  const [newFolderName, setNewFolderName] = useState('');
  const [renamingId, setRenamingId] = useState(null);
  const [renameValue, setRenameValue] = useState('');
  const [folderDeleteConfirm, setFolderDeleteConfirm] = useState(null);
  const [deleteInput, setDeleteInput] = useState('');
  const [deleting, setDeleting] = useState(false);

  // Drag state: what is being dragged, and where it would land.
  const [drag, setDrag] = useState(null);   // { kind: 'folder' | 'doc', id, parentId, name }
  const [hint, setHint] = useState(null);   // { id, mode: 'before' | 'after' }

  const fileInputRef = useRef(null);
  const folderInputRef = useRef(null);
  const editorRef = useRef(null);
  const formTopRef = useRef(null);
  const [folderUpload, setFolderUpload] = useState(null); // { done, total } while importing

  useEffect(() => { fetchAll(); }, []);

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

  const fetchFolders = async () => {
    try {
      const res = await fetch('/api/document-folders');
      const data = await res.json();
      setFolders(data.folders || []);
    } catch (_) {}
  };

  const fetchAll = async () => { await Promise.all([fetchItems(), fetchFolders()]); };

  const notifyChanged = () => { if (onChanged) onChanged(); };

  // ---------------- tree helpers ----------------

  const childFolders = (parentId) => folders.filter(f => (f.parentId || '') === (parentId || ''));
  const childDocs = (parentId) => items.filter(d => (d.folderId || '') === (parentId || ''));

  // "Guides / Migration", for the folder picker in the document form.
  const folderOptions = useMemo(() => {
    const out = [];
    const walk = (parentId, depth) => {
      folders.filter(f => (f.parentId || '') === (parentId || '')).forEach((f) => {
        out.push({ id: f.id, name: f.name, depth });
        walk(f.id, depth + 1);
      });
    };
    walk('', 0);
    return out;
  }, [folders]);

  const descendantsOf = (folderId) => {
    const out = [];
    const walk = (id) => {
      folders.filter(f => (f.parentId || '') === id).forEach((f) => { out.push(f.id); walk(f.id); });
    };
    walk(folderId);
    return out;
  };

  const toggleFolder = (id) => setExpanded(prev => ({ ...prev, [id]: !prev[id] }));

  // ---------------- folder actions ----------------

  const startNewFolder = (parentId) => {
    setNewFolderIn(parentId || '');
    setNewFolderName('');
    if (parentId) setExpanded(prev => ({ ...prev, [parentId]: true }));
  };

  const submitNewFolder = async () => {
    const value = newFolderName.trim();
    if (!value) { showToast('Folder name is required', 'error'); return; }
    try {
      const res = await fetch('/api/document-folders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: value, parentId: newFolderIn || null }),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || 'Failed to create folder');
      showToast('Folder created');
      setNewFolderIn(null);
      setNewFolderName('');
      await fetchFolders();
      notifyChanged();
    } catch (err) { showToast(err.message, 'error'); }
  };

  const submitRename = async (folder) => {
    const value = renameValue.trim();
    // Blank or unchanged: leave the folder as it was, no fuss.
    if (!value || value === folder.name) { setRenamingId(null); setRenameValue(''); return; }
    try {
      const res = await fetch(`/api/document-folders/${folder.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: value }),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || 'Failed to rename folder');
      showToast('Folder renamed');
      setRenamingId(null);
      await fetchFolders();
      notifyChanged();
    } catch (err) { showToast(err.message, 'error'); }
  };

  const deleteFolder = async (folder) => {
    setDeleting(true);
    try {
      const res = await fetch(`/api/document-folders/${folder.id}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || 'Failed to delete folder');
      const carried = [];
      if (data.subfolders) carried.push(`${data.subfolders} subfolder${data.subfolders > 1 ? 's' : ''}`);
      if (data.documents) carried.push(`${data.documents} document${data.documents > 1 ? 's' : ''}`);
      showToast(carried.length
        ? `Folder moved to Trash with ${carried.join(' and ')}`
        : 'Folder moved to Trash');
      closeDeleteModal();
      await fetchAll();
      notifyChanged();
    } catch (err) { showToast(err.message, 'error'); closeDeleteModal(); }
    setDeleting(false);
  };

  const closeDeleteModal = () => {
    setDeleteConfirm(null);
    setFolderDeleteConfirm(null);
    setDeleteInput('');
    setDeleting(false);
  };

  // ---------------- drag and drop (reorder only) ----------------
  //
  // Dragging a row repositions it among its own siblings — drop above or below a
  // row to sit before or after it. It never moves an item into another folder;
  // folders and documents keep separate
  // orders within a parent, so a drop beside the other kind lands at the end of
  // its own list rather than pretending the two interleave.

  const rowIdOf = (kind, row) => (kind === 'folder' ? row.id : row._id);

  // Drag reorders only — the drop lands before or after the row, never inside it.
  const dropZone = (e) => {
    const box = e.currentTarget.getBoundingClientRect();
    return (e.clientY - box.top) < box.height / 2 ? 'before' : 'after';
  };

  const parentOf = (kind, row) =>
    kind === 'folder' ? (row.parentId || '') : (row.folderId ? String(row.folderId) : '');

  // Reorder only: a row can be repositioned among its own siblings (same kind,
  // same parent). Dragging never moves anything into another folder.
  const dropAllowed = (targetKind, targetRow) => {
    if (!drag) return false;
    if (drag.kind !== targetKind) return false;
    if (drag.id === rowIdOf(targetKind, targetRow)) return false;
    return (drag.parentId || '') === parentOf(targetKind, targetRow);
  };

  const dragProps = (kind, row, parentId) => ({
    draggable: true,
    onDragStart: (e) => {
      e.stopPropagation();
      setDrag({ kind, id: rowIdOf(kind, row), parentId: parentId || '', name: row.name });
      e.dataTransfer.effectAllowed = 'move';
      try { e.dataTransfer.setData('text/plain', rowIdOf(kind, row)); } catch (_) {}
    },
    onDragEnd: () => { setDrag(null); setHint(null); },
  });

  const dropProps = (kind, row) => {
    const id = rowIdOf(kind, row);
    return {
      onDragOver: (e) => {
        if (!drag || !dropAllowed(kind, row)) return;
        const zone = dropZone(e);
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = 'move';
        setHint(prev => (prev && prev.id === id && prev.mode === zone ? prev : { id, mode: zone }));
      },
      onDragLeave: () => setHint(prev => (prev && prev.id === id ? null : prev)),
      onDrop: (e) => {
        if (!drag || !dropAllowed(kind, row)) return;
        const zone = dropZone(e);
        e.preventDefault();
        e.stopPropagation();
        applyDrop(kind, row, zone);
      },
    };
  };

  const hintClass = (kind, row) => {
    const id = rowIdOf(kind, row);
    if (!drag || !hint || hint.id !== id) return '';
    return ` doc-drop-${hint.mode}`;
  };

  // Works out the destination parent and the index within it, then writes the
  // move and the new order for that one level.
  const applyDrop = async (targetKind, targetRow, dropMode) => {
    const moving = drag;
    setDrag(null);
    setHint(null);
    if (!moving) return;

    const targetParent = targetKind === 'folder'
      ? (targetRow.parentId || '')
      : (targetRow.folderId ? String(targetRow.folderId) : '');
    const destParent = dropMode === 'inside' ? targetRow.id : targetParent;

    const siblings = (moving.kind === 'folder' ? childFolders(destParent) : childDocs(destParent))
      .filter(r => rowIdOf(moving.kind, r) !== moving.id);

    let index = siblings.length;
    if (dropMode !== 'inside' && targetKind === moving.kind) {
      const at = siblings.findIndex(r => rowIdOf(moving.kind, r) === rowIdOf(targetKind, targetRow));
      if (at !== -1) index = dropMode === 'after' ? at + 1 : at;
    }

    const movingRow = moving.kind === 'folder'
      ? folders.find(f => f.id === moving.id)
      : items.find(d => d._id === moving.id);
    const ordered = [...siblings];
    ordered.splice(index, 0, movingRow);

    const changedParent = (moving.parentId || '') !== destParent;

    try {
      if (moving.kind === 'folder') {
        if (changedParent) {
          const res = await fetch(`/api/document-folders/${moving.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ parentId: destParent || null }),
          });
          const data = await res.json();
          if (!res.ok || data.error) throw new Error(data.error || 'Move failed');
        }
        await fetch('/api/document-folders/reorder', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ orderedIds: ordered.filter(Boolean).map(r => r.id) }),
        });
      } else {
        if (changedParent) {
          const res = await fetch(`/api/documents/${moving.id}/folder`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ folderId: destParent || null }),
          });
          const data = await res.json();
          if (!res.ok || data.error) throw new Error(data.error || 'Move failed');
        }
        await fetch('/api/documents/reorder', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ orderedIds: ordered.filter(Boolean).map(r => r._id) }),
        });
      }
      if (destParent) setExpanded(prev => ({ ...prev, [destParent]: true }));
      showToast(changedParent ? `Moved "${moving.name}"` : 'Order updated');
      await fetchAll();
      notifyChanged();
    } catch (err) {
      showToast(err.message, 'error');
      await fetchAll();
    }
  };

  // ---------------- document form ----------------

  const resetForm = () => {
    setName('');
    setContent('');
    setFileType('manual');
    setFormFolderId('');
    setSelectedId('');
    setIsEditing(false);
    setDeleteConfirm(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleNew = (folderId = '') => {
    resetForm();
    setFormFolderId(folderId || '');
    setMode('create');
    setIsEditing(true);
  };

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
      setFormFolderId(data.item.folderId ? String(data.item.folderId) : '');
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
        if (formFolderId) formData.append('folderId', formFolderId);
        const res = await fetch('/api/documents/upload', { method: 'POST', body: formData });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        showToast('File uploaded successfully');
        await fetchAll();
        notifyChanged();
        setSelectedId(data.item.id || data.item._id);
        setName(data.item.name);
        setContent(data.item.content || '');
        setFileType(data.item.fileType || ext);
        setFormFolderId(data.item.folderId ? String(data.item.folderId) : '');
        setMode('edit');
        setIsEditing(false);
      } catch (err) { showToast(err.message, 'error'); }
    } else {
      showToast('Supported formats: .docx, .pdf, .xlsx', 'error');
    }
  };

  // Import a folder from the computer, recreating its structure under Documents
  // and uploading each supported file into the matching folder. Folders that
  // already exist (by name, in the same parent) are reused, not duplicated.
  const DOC_EXTS = ['docx', 'pdf', 'xlsx', 'xls'];

  const createFolder = async (folderName, parentId) => {
    const res = await fetch('/api/document-folders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: folderName, parentId: parentId || null }),
    });
    const data = await res.json();
    if (!res.ok || data.error) throw new Error(data.error || 'Failed to create folder');
    return data.folder;
  };

  const uploadOneFile = async (file, folderId) => {
    const ext = file.name.split('.').pop().toLowerCase();
    const baseName = file.name.replace(/\.[^.]+$/, '');
    if (ext === 'docx') {
      const arrayBuffer = await file.arrayBuffer();
      const result = await mammoth.convertToHtml({ arrayBuffer }, {
        convertImage: mammoth.images.imgElement((image) =>
          image.read('base64').then((b) => ({ src: 'data:' + image.contentType + ';base64,' + b }))),
      });
      const res = await fetch('/api/documents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: baseName, content: result.value, fileType: 'docx', folderId: folderId || null }),
      });
      const data = await res.json();
      if (res.status === 409) { const e = new Error(data.error); e.duplicate = true; throw e; }
      if (!res.ok || data.error) throw new Error(data.error || 'Upload failed');
    } else {
      const form = new FormData();
      form.append('file', file);
      form.append('name', baseName);
      if (folderId) form.append('folderId', folderId);
      const res = await fetch('/api/documents/upload', { method: 'POST', body: form });
      const data = await res.json();
      if (res.status === 409) { const e = new Error(data.error); e.duplicate = true; throw e; }
      if (!res.ok || data.error) throw new Error(data.error || 'Upload failed');
    }
  };

  const handleFolderUpload = async (e) => {
    const picked = Array.from(e.target.files || []);
    e.target.value = '';
    const files = picked.filter(f => DOC_EXTS.includes(f.name.split('.').pop().toLowerCase()));
    if (!files.length) { showToast('No PDF, DOCX or XLSX files found in that folder', 'error'); return; }

    // Live snapshot of the tree so we reuse folders that already exist and the
    // ones we create in this run. Keyed by "parentId/childName".
    const byKey = new Map(folders.map(f => [(f.parentId || '') + '/' + f.name, f.id]));

    const ensureFolderPath = async (segments) => {
      let parentId = '';
      for (const seg of segments) {
        const key = (parentId || '') + '/' + seg;
        let id = byKey.get(key);
        if (!id) {
          const made = await createFolder(seg, parentId || null);
          id = made.id;
          byKey.set(key, id);
        }
        parentId = id;
      }
      return parentId;
    };

    setFolderUpload({ done: 0, total: files.length });
    let ok = 0; let duplicates = 0; const failed = [];
    for (const file of files) {
      try {
        // webkitRelativePath is like "Guides/Migration/setup.pdf" — everything
        // before the filename is the folder path to recreate.
        const parts = (file.webkitRelativePath || file.name).split('/').filter(Boolean);
        const dirs = parts.slice(0, -1);
        const folderId = dirs.length ? await ensureFolderPath(dirs) : '';
        await uploadOneFile(file, folderId);
        ok += 1;
      } catch (err) {
        // A name that already exists in its folder is skipped, not a failure.
        if (err.duplicate) duplicates += 1;
        else failed.push(file.webkitRelativePath || file.name);
      }
      setFolderUpload({ done: ok + duplicates + failed.length, total: files.length });
    }
    setFolderUpload(null);
    await fetchAll();
    notifyChanged();
    const unsupported = picked.length - files.length;
    const skipped = duplicates + unsupported;
    showToast(
      `Imported ${ok} document${ok !== 1 ? 's' : ''}`
      + (failed.length ? `, ${failed.length} failed` : '')
      + (skipped ? `. Skipped ${skipped}${duplicates ? ` (${duplicates} already existed)` : ''}${unsupported ? `${duplicates ? ',' : ''} ${unsupported} unsupported` : ''}.` : ''),
      failed.length ? 'error' : 'success',
    );
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
        body: JSON.stringify({ name: name.trim(), content: finalContent, fileType, folderId: formFolderId || null }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      showToast(mode === 'create' ? 'Document created!' : 'Document updated!');
      await fetchAll();
      notifyChanged();
      if (formFolderId) setExpanded(prev => ({ ...prev, [formFolderId]: true }));
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
    setDeleting(true);
    try {
      await fetch(`/api/documents/${id}`, { method: 'DELETE' });
      closeDeleteModal();
      showToast('Document moved to Trash');
      await fetchItems();
      notifyChanged();
      if (selectedId === id) { resetForm(); setMode('list'); }
    } catch (err) { showToast(err.message, 'error'); }
    setDeleting(false);
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

  // ---------------- tree rendering ----------------
  //
  // Rendered as plain functions rather than nested components: a component
  // declared inside the body is a new type on every render, which would remount
  // these rows and knock the caret out of the name inputs mid-typing.

  const renderDocRow = (doc, depth) => {
    const parentId = doc.folderId ? String(doc.folderId) : '';
    const dim = drag && drag.kind === 'doc' && drag.id === doc._id ? ' doc-tree-dragging' : '';
    return (
      <div key={doc._id} className="doc-tree-item">
        <div
          className={`doc-tree-row doc-tree-file${dim}${hintClass('doc', doc)}`}
          style={{ paddingLeft: 12 + depth * 20 }}
          {...dragProps('doc', doc, parentId)}
          {...dropProps('doc', doc)}
        >
          <div className="doc-tree-label">
            {GRIP}
            <span className="doc-tree-icon">{FILE_ICON}</span>
            <span className="doc-tree-name">{doc.name}</span>
            {doc.fileType && doc.fileType !== 'manual' && (
              <span className="doc-type-badge">{doc.fileType.toUpperCase()}</span>
            )}
          </div>
          <div className="doc-tree-actions">
            <button className="btn-edit-sm" onClick={() => handleEdit(doc)}>Edit</button>
            <button className="btn-delete-inline" onClick={() => { setFolderDeleteConfirm(null); setDeleteInput(''); setDeleteConfirm(doc._id); }}>Delete</button>
          </div>
        </div>
      </div>
    );
  };

  const renderFolderNode = (folder, depth) => {
    const open = !!expanded[folder.id];
    const subfolders = childFolders(folder.id);
    const docs = childDocs(folder.id);
    const count = subfolders.length + docs.length;
    const dim = drag && drag.kind === 'folder' && drag.id === folder.id ? ' doc-tree-dragging' : '';

    return (
      <div key={folder.id} className="doc-tree-node">
        <div
          className={`doc-tree-row doc-tree-folder${dim}${hintClass('folder', folder)}`}
          style={{ paddingLeft: 12 + depth * 20 }}
          {...dragProps('folder', folder, folder.parentId || '')}
          {...dropProps('folder', folder)}
        >
          <div
            className="doc-tree-label doc-tree-toggle"
            role="button"
            tabIndex={0}
            onClick={() => toggleFolder(folder.id)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleFolder(folder.id); }
            }}
          >
            {GRIP}
            {CHEVRON(open)}
            <span className="doc-tree-icon doc-tree-icon-folder">{FOLDER_ICON}</span>
            {renamingId === folder.id ? (
              <input
                className="doc-tree-rename-input"
                value={renameValue}
                autoFocus
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => setRenameValue(e.target.value)}
                onBlur={() => submitRename(folder)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { e.target.blur(); }
                  if (e.key === 'Escape') { setRenameValue(folder.name); setRenamingId(null); }
                }}
              />
            ) : (
              <span
                className="doc-tree-name doc-tree-name-editable"
                title="Double-click to rename"
                onDoubleClick={(e) => { e.stopPropagation(); setRenamingId(folder.id); setRenameValue(folder.name); }}
              >
                {folder.name}
              </span>
            )}
            <span className="doc-tree-count">{count === 0 ? 'empty' : `${count} item${count > 1 ? 's' : ''}`}</span>
          </div>

          <div className="doc-tree-actions">
            {renamingId !== folder.id && (
              <>
                <button className="btn-tree-action" onClick={() => startNewFolder(folder.id)}>+ Subfolder</button>
                <button className="btn-tree-action" onClick={() => handleNew(folder.id)}>+ Document</button>
                <button className="btn-delete-inline" onClick={() => { setDeleteConfirm(null); setDeleteInput(''); setFolderDeleteConfirm(folder.id); }}>Delete</button>
              </>
            )}
          </div>
        </div>

        {open && (
          <div className="doc-tree-children">
            {newFolderIn === folder.id && renderNewFolderInput(depth + 1)}
            {subfolders.map(sub => renderFolderNode(sub, depth + 1))}
            {docs.map(doc => renderDocRow(doc, depth + 1))}
            {count === 0 && newFolderIn !== folder.id && (
              <div className="doc-tree-empty" style={{ paddingLeft: 12 + (depth + 1) * 20 }}>
                This folder is empty.
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  const renderNewFolderInput = (depth) => (
    <div className="doc-tree-row doc-tree-newfolder" style={{ paddingLeft: 12 + depth * 20 }}>
      <div className="doc-tree-label">
        <span className="doc-tree-icon doc-tree-icon-folder">{FOLDER_ICON}</span>
        <input
          className="doc-tree-rename-input"
          value={newFolderName}
          autoFocus
          placeholder="Folder name"
          onChange={(e) => setNewFolderName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submitNewFolder();
            if (e.key === 'Escape') setNewFolderIn(null);
          }}
        />
      </div>
      <div className="doc-tree-actions">
        <button className="btn-confirm-yes" onClick={submitNewFolder}>Create</button>
        <button className="btn-confirm-cancel" onClick={() => setNewFolderIn(null)}>Cancel</button>
      </div>
    </div>
  );

  // One modal for both kinds of delete, with the typed confirmation the rest of
  // the admin panel uses. Deleting a folder takes its whole subtree along, which
  // is spelled out here before you can type anything.
  const renderDeleteModal = () => {
    const doc = deleteConfirm ? items.find(d => d._id === deleteConfirm) : null;
    const folder = folderDeleteConfirm ? folders.find(f => f.id === folderDeleteConfirm) : null;
    if (!doc && !folder) return null;

    // Everything below the folder, not just its immediate children.
    const subtree = folder ? [folder.id, ...descendantsOf(folder.id)] : [];
    const subCount = folder ? descendantsOf(folder.id).length : 0;
    const docCount = folder ? items.filter(d => subtree.includes(String(d.folderId || ''))).length : 0;

    const carries = [];
    if (subCount) carries.push(`${subCount} subfolder${subCount > 1 ? 's' : ''}`);
    if (docCount) carries.push(`${docCount} document${docCount > 1 ? 's' : ''}`);

    return (
      <div className="permanent-delete-modal" onClick={closeDeleteModal}>
        <div className="permanent-delete-card" onClick={e => e.stopPropagation()}>
          <h4>{folder ? 'Delete Folder' : 'Delete Document'}</h4>
          <p>
            You are about to delete <strong>&quot;{folder ? folder.name : doc.name}&quot;</strong>
            {folder && carries.length ? <> along with <strong>{carries.join(' and ')}</strong> inside it</> : null}.
          </p>
          <p>Everything moves to Trash and can be restored from there.</p>
          <p>Type <strong>DELETE</strong> to confirm:</p>
          <input
            type="text"
            value={deleteInput}
            onChange={e => setDeleteInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && deleteInput === 'DELETE' && !deleting) {
                if (folder) deleteFolder(folder); else handleDelete(doc._id);
              }
              if (e.key === 'Escape') closeDeleteModal();
            }}
            placeholder="Type DELETE"
            autoFocus
          />
          <div className="permanent-delete-actions">
            <button
              className="btn-permanent-confirm"
              disabled={deleteInput !== 'DELETE' || deleting}
              onClick={() => { if (folder) { deleteFolder(folder); } else { handleDelete(doc._id); } }}
            >
              {deleting ? 'Deleting...' : (folder ? 'Delete Folder' : 'Delete Document')}
            </button>
            <button className="btn-cancel" onClick={closeDeleteModal}>Cancel</button>
          </div>
        </div>
      </div>
    );
  };

  if (mode === 'list') {
    const rootFolders = childFolders('');
    const rootDocs = childDocs('');
    const empty = rootFolders.length === 0 && rootDocs.length === 0 && newFolderIn === null;

    return (
      <div className="cloud-info-admin">
        <div className="cloud-info-header">
          <h3>Documents Management</h3>
          <div className="doc-tree-header-actions">
            <button
              className="btn-create-new btn-create-folder"
              onClick={() => folderInputRef.current && folderInputRef.current.click()}
              disabled={!!folderUpload}
            >
              {folderUpload ? `Importing ${folderUpload.done}/${folderUpload.total}…` : 'Upload Folder'}
            </button>
            <button className="btn-create-new btn-create-folder" onClick={() => startNewFolder('')}>+ New Folder</button>
            {/* webkitdirectory lets the browser hand us a whole folder, with each
                file's path in webkitRelativePath. */}
            <input
              ref={folderInputRef}
              type="file"
              webkitdirectory=""
              directory=""
              multiple
              hidden
              onChange={handleFolderUpload}
            />
          </div>
        </div>

        {empty ? (
          <p className="cloud-info-empty">No folders yet. Use "+ New Folder" to build a structure, then add documents inside a folder with "+ Document".</p>
        ) : (
          <>
            <div className="doc-tree">
              {newFolderIn === '' && renderNewFolderInput(0)}
              {rootFolders.map(folder => renderFolderNode(folder, 0))}
              {rootDocs.map(doc => renderDocRow(doc, 0))}
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
            <div className="form-group">
              <label>Folder</label>
              <select value={formFolderId} onChange={e => setFormFolderId(e.target.value)} disabled={!isEditing}>
                <option value="">Top level</option>
                {folderOptions.map(o => (
                  <option key={o.id} value={o.id}>{'  '.repeat(o.depth) + (o.depth ? '└ ' : '') + o.name}</option>
                ))}
              </select>
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
