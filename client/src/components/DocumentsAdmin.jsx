import { useState, useEffect, useRef, useMemo } from 'react';
import mammoth from 'mammoth';
import { showToast } from './Toast';
import FilePreview, { previewKindOf, TEXT_EXTS } from './FilePreview';
import SpreadsheetEditor from './SpreadsheetEditor';

// Spreadsheets open in the grid editor (edit cells, save back to the file).
const SHEET_EXTS = ['xlsx', 'xls', 'xlsm', 'csv', 'tsv'];

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

// Text-like files open straight in the editor for inline editing; DOCX converts
// via mammoth; everything else uploads as a file and previews inline where the
// browser can. Uploads are otherwise unrestricted.
const escapeText = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

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
  const [fileUrl, setFileUrl] = useState('');   // saved uploaded file, if any
  const [formFolderId, setFormFolderId] = useState('');
  // A chosen file staged for preview; it uploads only when the user hits Save.
  const [pendingFile, setPendingFile] = useState(null);
  const [pendingPreview, setPendingPreview] = useState(null); // { url, kind, ext, name }
  // Spreadsheet being edited in the grid: { file?, url?, ext, replaceId? }.
  const [sheetEdit, setSheetEdit] = useState(null);
  const sheetRef = useRef(null);
  // Multiple files staged in Create mode: [{ id, file, ext, kind, url, name }].
  const [pendingBatch, setPendingBatch] = useState(null);
  const [batchProgress, setBatchProgress] = useState(null); // { done, total }
  const [dragOver, setDragOver] = useState(false);          // upload drop-zone highlight
  // Move a document or folder into another folder: { kind, id, name, parentId }.
  const [moveTarget, setMoveTarget] = useState(null);
  const [moveDest, setMoveDest] = useState('');
  const [moving, setMoving] = useState(false);
  // The last saved/loaded state, so Cancel can revert unsaved name/folder edits.
  const original = useRef(null);
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
  const [reorderMode, setReorderMode] = useState(false); // drag-to-reorder is opt-in, off by default

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

  // ---------------- move a document / folder ----------------
  const openMove = (kind, row) => {
    const id = kind === 'folder' ? row.id : row._id;
    const parentId = kind === 'folder'
      ? (row.parentId || '')
      : (row.folderId ? String(row.folderId) : '');
    setMoveTarget({ kind, id, name: row.name, parentId });
    setMoveDest(parentId);
  };

  const handleMove = async () => {
    if (!moveTarget) return;
    setMoving(true);
    try {
      const { kind, id } = moveTarget;
      const url = kind === 'folder' ? `/api/document-folders/${id}` : `/api/documents/${id}`;
      const body = kind === 'folder' ? { parentId: moveDest || null } : { folderId: moveDest || null };
      const res = await fetch(url, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || 'Move failed');
      showToast(`Moved "${moveTarget.name}"`);
      if (moveDest) setExpanded(prev => ({ ...prev, [moveDest]: true }));
      setMoveTarget(null);
      await fetchAll();
      notifyChanged();
    } catch (err) { showToast(err.message, 'error'); }
    setMoving(false);
  };

  const renderMoveModal = () => {
    if (!moveTarget) return null;
    // A folder can't move into itself or its own descendants.
    const invalid = moveTarget.kind === 'folder'
      ? new Set([moveTarget.id, ...descendantsOf(moveTarget.id)])
      : new Set();
    const options = folderOptions.filter(o => !invalid.has(o.id));
    return (
      <div className="permanent-delete-modal" onClick={() => !moving && setMoveTarget(null)}>
        <div className="permanent-delete-card" onClick={e => e.stopPropagation()}>
          <h4>Move {moveTarget.kind === 'folder' ? 'Folder' : 'Document'}</h4>
          <p>Move <strong>&quot;{moveTarget.name}&quot;</strong> to:</p>
          <select className="doc-move-select" value={moveDest} onChange={e => setMoveDest(e.target.value)} autoFocus>
            <option value="">Top level</option>
            {options.map(o => (
              <option key={o.id} value={o.id}>{'  '.repeat(o.depth) + (o.depth ? '└ ' : '') + o.name}</option>
            ))}
          </select>
          <div className="permanent-delete-actions">
            <button className="btn-save" disabled={moving || moveDest === moveTarget.parentId} onClick={handleMove}>
              {moving ? 'Moving…' : 'Move'}
            </button>
            <button className="btn-cancel" onClick={() => setMoveTarget(null)} disabled={moving}>Cancel</button>
          </div>
        </div>
      </div>
    );
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

  const dragProps = (kind, row, parentId) => (!reorderMode ? {} : {
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
    setFileUrl('');
    setFormFolderId('');
    setSelectedId('');
    setIsEditing(false);
    setDeleteConfirm(null);
    if (pendingPreview && pendingPreview.url) URL.revokeObjectURL(pendingPreview.url);
    if (pendingBatch) pendingBatch.forEach(it => it.url && URL.revokeObjectURL(it.url));
    setPendingFile(null);
    setPendingPreview(null);
    setSheetEdit(null);
    setPendingBatch(null);
    setBatchProgress(null);
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
      setFileUrl(data.item.fileUrl || '');
      setFormFolderId(data.item.folderId ? String(data.item.folderId) : '');
      // A spreadsheet doc opens in the grid editor, loaded from its saved file.
      const et = String(data.item.fileType || '').toLowerCase();
      if (data.item.fileUrl && SHEET_EXTS.includes(et)) {
        setSheetEdit({ url: data.item.fileUrl, ext: et, replaceId: data.item.id || data.item._id });
      } else {
        setSheetEdit(null);
      }
      snapshotOriginal(data.item);
      setMode('edit');
      // Open straight into edit mode — a single click on Edit starts editing.
      setIsEditing(true);
      const html = data.item.content || '';
      if (html) setTimeout(() => { if (editorRef.current) editorRef.current.innerHTML = html; }, 0);
    } catch (err) { showToast(err.message, 'error'); }
    setLoading(false);
  };

  // Remember the saved state so Cancel can undo unsaved edits.
  const snapshotOriginal = (item) => {
    original.current = {
      name: item.name || '',
      folderId: item.folderId ? String(item.folderId) : '',
      content: item.content || '',
      fileType: item.fileType || 'manual',
      fileUrl: item.fileUrl || '',
    };
  };

  const handleFileUpload = (e) => processFiles(Array.from(e.target.files || []));

  const processFiles = async (files) => {
    if (!files.length) return;

    // Choosing any new file clears whatever was previously staged/open, so the
    // grid, text editor and file preview never fight over the same Save.
    const clearStaged = () => {
      if (pendingPreview && pendingPreview.url) URL.revokeObjectURL(pendingPreview.url);
      if (pendingBatch) pendingBatch.forEach(it => it.url && URL.revokeObjectURL(it.url));
      setPendingPreview(null);
      setPendingFile(null);
      setSheetEdit(null);
      setPendingBatch(null);
    };

    // Multiple files in Create mode: stage them all, each previewed, "Save All".
    if (mode === 'create' && files.length > 1) {
      clearStaged();
      const batch = files.map((f, i) => {
        const fext = f.name.split('.').pop().toLowerCase();
        const kind = previewKindOf(fext);
        const url = ['image', 'pdf', 'video', 'audio'].includes(kind) ? URL.createObjectURL(f) : '';
        return { id: i + '_' + f.name, file: f, ext: fext, kind, url, name: f.name.replace(/\.[^.]+$/, '') };
      });
      setPendingBatch(batch);
      setIsEditing(true);
      showToast(`${files.length} files ready — review and click Save All`);
      return;
    }

    const file = files[0];
    const ext = file.name.split('.').pop().toLowerCase();

    if (ext === 'docx') {
      try {
        clearStaged();
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
        setFileUrl('');
        if (editorRef.current) editorRef.current.innerHTML = result.value;
        showToast('DOCX parsed — edit and Save');
      } catch (err) { showToast('Failed to parse: ' + err.message, 'error'); }
    } else if (SHEET_EXTS.includes(ext)) {
      // Spreadsheets open in the grid editor; the edited file saves on Save.
      clearStaged();
      setSheetEdit({ file, ext, replaceId: mode === 'edit' ? selectedId : undefined });
      setFileType(ext);
      setContent('');
      if (!name.trim()) setName(file.name.replace(/\.[^.]+$/, ''));
      setIsEditing(true);
      showToast(`${ext.toUpperCase()} opened — edit cells, then click Save`);
    } else if (TEXT_EXTS.includes(ext)) {
      // Read text files straight into the editor so they open inline for editing.
      try {
        clearStaged();
        const raw = await file.text();
        const html = '<pre>' + escapeText(raw) + '</pre>';
        setContent(html);
        setFileType(ext);
        setFileUrl('');
        if (editorRef.current) editorRef.current.innerHTML = html;
        showToast(`${ext.toUpperCase()} loaded — edit and Save`);
      } catch (err) { showToast('Failed to read file: ' + err.message, 'error'); }
    } else {
      // Everything else (pdf, images, audio, video, etc.): stage the file and
      // preview it locally. It uploads (or replaces) only when the user Saves.
      clearStaged();
      const url = URL.createObjectURL(file);
      setPendingFile(file);
      setPendingPreview({ url, kind: previewKindOf(ext), ext, name: file.name });
      setFileType(ext);
      setContent('');
      if (!name.trim()) setName(file.name.replace(/\.[^.]+$/, ''));
      showToast(`${ext.toUpperCase()} ready — preview below, then click Save`);
    }
  };

  // Import a folder from the computer, recreating its structure under Documents
  // and uploading every file into the matching folder. Folders that already
  // exist (by name, in the same parent) are reused, not duplicated. All file
  // types are accepted; hidden/system files are skipped.
  const isSkippableFile = (f) => {
    const base = (f.name || '').split('/').pop();
    return !base || base.startsWith('.') || base.toLowerCase() === 'thumbs.db' || base === 'desktop.ini';
  };

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

  const uploadOneFile = async (file, folderId, nameOverride) => {
    const ext = file.name.split('.').pop().toLowerCase();
    const baseName = (nameOverride && nameOverride.trim()) || file.name.replace(/\.[^.]+$/, '');
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
    } else if (TEXT_EXTS.includes(ext) && !SHEET_EXTS.includes(ext)) {
      const raw = await file.text();
      const res = await fetch('/api/documents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: baseName, content: '<pre>' + escapeText(raw) + '</pre>', fileType: ext, folderId: folderId || null }),
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
    const files = picked.filter(f => !isSkippableFile(f));
    if (!files.length) { showToast('No files found in that folder', 'error'); return; }

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
    // Batch: several files staged in Create mode — create one document each.
    if (pendingBatch) {
      const named = pendingBatch.filter(it => it.name.trim());
      if (!named.length) { showToast('Give each file a name', 'error'); return; }
      const folderId = formFolderId || '';
      setSaving(true);
      setBatchProgress({ done: 0, total: pendingBatch.length });
      let done = 0, dup = 0; const failed = [];
      for (let i = 0; i < pendingBatch.length; i++) {
        const it = pendingBatch[i];
        try { await uploadOneFile(it.file, folderId, it.name); done++; }
        catch (err) { if (err.duplicate) dup++; else failed.push(it.name); }
        setBatchProgress({ done: i + 1, total: pendingBatch.length });
      }
      pendingBatch.forEach(it => it.url && URL.revokeObjectURL(it.url));
      setPendingBatch(null);
      setBatchProgress(null);
      await fetchAll();
      notifyChanged();
      if (folderId) setExpanded(prev => ({ ...prev, [folderId]: true }));
      showToast(
        `Saved ${done} document${done !== 1 ? 's' : ''}`
        + (dup ? `, skipped ${dup} duplicate${dup !== 1 ? 's' : ''}` : '')
        + (failed.length ? `, ${failed.length} failed` : '') + '.',
        failed.length ? 'error' : 'success',
      );
      resetForm();
      setMode('list');
      setSaving(false);
      return;
    }

    if (!name.trim()) { showToast('Name is required', 'error'); return; }

    // A spreadsheet being edited in the grid: write the edited workbook and
    // either replace the existing file or create a new document.
    if (sheetEdit) {
      if (!sheetRef.current) { showToast('Editor not ready', 'error'); return; }
      setSaving(true);
      try {
        const { blob, fname } = sheetRef.current.getBlob();
        const fd = new FormData();
        fd.append('file', blob, fname);
        fd.append('name', name.trim());
        if (formFolderId) fd.append('folderId', formFolderId);
        const endpoint = sheetEdit.replaceId
          ? `/api/documents/${sheetEdit.replaceId}/file`
          : '/api/documents/upload';
        const res = await fetch(endpoint, { method: 'POST', body: fd });
        const data = await res.json();
        if (!res.ok || data.error) throw new Error(data.error || 'Save failed');
        showToast(sheetEdit.replaceId ? 'Spreadsheet saved!' : 'Spreadsheet created!');
        const newId = data.item.id || data.item._id;
        // Keep the grid open (read-only) on the freshly saved file.
        setSheetEdit({ url: data.item.fileUrl, ext: data.item.fileType || sheetEdit.ext, replaceId: newId });
        setSelectedId(newId);
        setName(data.item.name);
        setContent('');
        setFileType(data.item.fileType || sheetEdit.ext);
        setFileUrl(data.item.fileUrl || '');
        setFormFolderId(data.item.folderId ? String(data.item.folderId) : '');
        snapshotOriginal(data.item);
        setMode('edit');
        setIsEditing(false);
        if (formFolderId) setExpanded(prev => ({ ...prev, [formFolderId]: true }));
        notifyChanged();
        await fetchAll();
      } catch (err) { showToast(err.message, 'error'); }
      setSaving(false);
      return;
    }

    // A staged file (pdf/image/media/other) uploads now. When editing an
    // existing document it REPLACES that document's file in place; otherwise it
    // creates a new one.
    if (pendingFile) {
      setSaving(true);
      try {
        const rid = mode === 'edit' && selectedId ? selectedId : null;
        const fd = new FormData();
        fd.append('file', pendingFile);
        fd.append('name', name.trim());
        if (formFolderId) fd.append('folderId', formFolderId);
        const endpoint = rid ? `/api/documents/${rid}/file` : '/api/documents/upload';
        const res = await fetch(endpoint, { method: 'POST', body: fd });
        const data = await res.json();
        if (!res.ok || data.error) throw new Error(data.error || 'Upload failed');
        showToast(rid ? 'File replaced!' : 'Document saved!');
        // Point the view at the NEW file before any awaited render, so a
        // just-replaced (deleted) file URL is never requested again.
        if (pendingPreview && pendingPreview.url) URL.revokeObjectURL(pendingPreview.url);
        setPendingFile(null);
        setPendingPreview(null);
        setSelectedId(data.item.id || data.item._id);
        setName(data.item.name);
        setContent(data.item.content || '');
        setFileType(data.item.fileType || '');
        setFileUrl(data.item.fileUrl || '');
        setFormFolderId(data.item.folderId ? String(data.item.folderId) : '');
        snapshotOriginal(data.item);
        setMode('edit');
        setIsEditing(false);
        if (formFolderId) setExpanded(prev => ({ ...prev, [formFolderId]: true }));
        notifyChanged();
        await fetchAll();
      } catch (err) { showToast(err.message, 'error'); }
      setSaving(false);
      return;
    }

    const finalContent = editorRef.current ? editorRef.current.innerHTML : content;
    setSaving(true);
    try {
      const url = mode === 'create' ? '/api/documents' : `/api/documents/${selectedId}`;
      const method = mode === 'create' ? 'POST' : 'PUT';
      // Editing turned a file-backed doc into editable content: drop the old file.
      const clearFile = mode === 'edit' && !!fileUrl && !!finalContent;
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), content: finalContent, fileType, folderId: formFolderId || null, clearFile }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      if (clearFile) setFileUrl('');
      showToast(mode === 'create' ? 'Document created!' : 'Document updated!');
      await fetchAll();
      notifyChanged();
      if (formFolderId) setExpanded(prev => ({ ...prev, [formFolderId]: true }));
      if (mode === 'create') {
        setSelectedId(data.item.id || data.item._id);
        setMode('edit');
      }
      snapshotOriginal(data.item);
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
    // A spreadsheet always edits through the grid: make sure it's wired up.
    if (isSheetDoc && !sheetEdit) {
      setSheetEdit({ url: fileUrl, ext: fileType, replaceId: selectedId });
    }
    setIsEditing(true);
    setTimeout(() => { if (editorRef.current) editorRef.current.innerHTML = content; }, 0);
  };
  const cancelEditing = () => {
    const o = original.current;
    if (o) {
      // Revert any unsaved edits (name, folder, content, chosen file).
      setName(o.name);
      setFormFolderId(o.folderId);
      setContent(o.content);
      setFileType(o.fileType);
      setFileUrl(o.fileUrl);
      if (pendingPreview && pendingPreview.url) URL.revokeObjectURL(pendingPreview.url);
      setPendingFile(null);
      setPendingPreview(null);
      if (o.fileUrl && SHEET_EXTS.includes(String(o.fileType).toLowerCase())) {
        setSheetEdit({ url: o.fileUrl, ext: o.fileType, replaceId: selectedId });
      } else {
        setSheetEdit(null);
      }
      if (fileInputRef.current) fileInputRef.current.value = '';
      setTimeout(() => { if (editorRef.current) editorRef.current.innerHTML = o.content; }, 0);
    }
    setIsEditing(false);
  };
  const execCmd = (cmd, value = null) => { document.execCommand(cmd, false, value); editorRef.current?.focus(); };
  const handleInsertLink = () => { const url = prompt('Enter URL:'); if (url) execCmd('createLink', url); };

  const setBatchName = (id, val) =>
    setPendingBatch(prev => prev.map(it => (it.id === id ? { ...it, name: val } : it)));
  const removeBatchItem = (id) =>
    setPendingBatch(prev => {
      const it = prev.find(x => x.id === id);
      if (it && it.url) URL.revokeObjectURL(it.url);
      const next = prev.filter(x => x.id !== id);
      return next.length ? next : null;
    });

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
            {reorderMode && GRIP}
            <span className="doc-tree-name">{doc.name}</span>
          </div>
          <div className="doc-tree-actions">
            <button className="btn-edit-sm" onClick={() => handleEdit(doc)}>Edit</button>
            <button className="btn-tree-action" onClick={() => openMove('doc', doc)}>Move</button>
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
            {reorderMode && GRIP}
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
                <button className="btn-tree-action" onClick={() => openMove('folder', folder)}>Move</button>
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
            <div className="reorder-toggle-section">
              <button
                className={`btn-reorder-toggle${reorderMode ? ' btn-reorder-toggle-active' : ''}`}
                onClick={() => { setReorderMode(prev => !prev); setDrag(null); setHint(null); }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="4" y1="9" x2="20" y2="9"/><line x1="4" y1="15" x2="20" y2="15"/><polyline points="10 3 8 6 6 3"/><polyline points="14 21 16 18 18 21"/></svg>
                {reorderMode ? 'Done Reordering' : 'Reorder Items'}
              </button>
              {reorderMode && (
                <span className="drag-hint-inline reorder-mode-hint">Drag a row by its handle to reorder it within its own folder. Items never move into another folder.</span>
              )}
            </div>
            <div className={`doc-tree${reorderMode ? ' doc-tree-reordering' : ''}`}>
              {newFolderIn === '' && renderNewFolderInput(0)}
              {rootFolders.map(folder => renderFolderNode(folder, 0))}
              {rootDocs.map(doc => renderDocRow(doc, 0))}
            </div>
          </>
        )}
        {renderDeleteModal()}
        {renderMoveModal()}
      </div>
    );
  }

  // A spreadsheet doc always uses the grid editor (never raw text / download).
  const isSheetDoc = !!fileUrl && !content && SHEET_EXTS.includes(String(fileType).toLowerCase());
  // A file-backed document (pdf/image/media/office) has no editable text body:
  // we keep showing the file itself and only let the user rename, move or
  // replace it — never a blank rich-text editor.
  const isFileDoc = !!fileUrl && !content && !isSheetDoc;

  return (
    <div className="cloud-info-admin doc-admin-flow" ref={formTopRef}>
      <div className="cloud-info-sticky-top">
        <div className="cloud-info-header">
          <button className="btn-back" onClick={handleBack}>&larr; Back</button>
          <h3>{mode === 'create' ? 'Create Document' : `Edit: ${name}`}</h3>
          <div className="cloud-info-header-actions">
            {!loading && (
              isEditing ? (
                <>
                  <button className="btn-save" onClick={handleSave} disabled={saving}>
                    {saving ? (batchProgress ? `Saving ${batchProgress.done}/${batchProgress.total}…` : 'Saving...')
                      : pendingBatch ? `Save All (${pendingBatch.length})` : 'Save'}
                  </button>
                  {mode === 'edit' && <button className="btn-cancel" onClick={cancelEditing}>Cancel</button>}
                </>
              ) : (
                <button className="btn-edit-sm" onClick={startEditing}>{(sheetEdit || isSheetDoc) ? 'Edit' : isFileDoc ? 'Edit Details' : 'Edit Content'}</button>
              )
            )}
          </div>
        </div>
        {!loading && (
          <>
            {!pendingBatch && (
              <div className="form-group">
                <label>Name</label>
                <input type="text" value={name} onChange={e => setName(e.target.value)} disabled={!isEditing} placeholder="e.g. Migration Guide" />
              </div>
            )}
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
                <label>Upload File{mode === 'create' ? 's' : ''} (any type)</label>
                <div
                  className={`doc-dropzone${dragOver ? ' doc-dropzone-over' : ''}`}
                  onDragOver={(e) => { e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'; if (!dragOver) setDragOver(true); }}
                  onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setDragOver(false); }}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDragOver(false);
                    const files = Array.from(e.dataTransfer.files || []);
                    if (files.length) processFiles(mode === 'create' ? files : files.slice(0, 1));
                  }}
                  onClick={() => fileInputRef.current && fileInputRef.current.click()}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInputRef.current && fileInputRef.current.click(); } }}
                >
                  <svg className="doc-dropzone-icon" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                  <div className="doc-dropzone-text">
                    <strong>{dragOver ? 'Drop to add' : 'Drag & drop'}</strong> {mode === 'create' ? 'file(s) here' : 'a file here'}, or <span className="doc-dropzone-link">browse</span>
                  </div>
                </div>
                <input type="file" ref={fileInputRef} multiple={mode === 'create'} onChange={handleFileUpload} hidden />
                <small className="cloud-upload-meta">
                  {mode === 'create'
                    ? 'Pick one file to edit it inline, or add several at once (Save All).'
                    : 'Choose a file to replace this document.'}
                  {' '}DOCX/text open in the editor, spreadsheets in a grid, PDF/images/media preview inline.
                </small>
              </div>
            )}
            {isEditing && !pendingPreview && !isFileDoc && !pendingBatch && !sheetEdit && !isSheetDoc && (
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
          {pendingBatch ? (
            <div className="doc-batch">
              <div className="doc-staged-preview-hint">
                {pendingBatch.length} file{pendingBatch.length !== 1 ? 's' : ''} into <strong>{folders.find(f => f.id === formFolderId)?.name || 'Documents (top level)'}</strong> — review names, then <strong>Save All</strong>.
                {batchProgress && <span> &nbsp;Uploading {batchProgress.done}/{batchProgress.total}…</span>}
              </div>
              {pendingBatch.map((it) => (
                <div className="doc-batch-item" key={it.id}>
                  <div
                    className={`doc-batch-thumb${it.url ? ' doc-batch-thumb-clickable' : ''}`}
                    onClick={() => it.url && window.open(it.url, '_blank', 'noopener')}
                    title={it.url ? 'Open in a new tab' : undefined}
                  >
                    {it.kind === 'image' ? <img src={it.url} alt={it.name} />
                      : it.kind === 'pdf' ? <iframe className="doc-batch-pdf" src={it.url + '#toolbar=0&navpanes=0&scrollbar=0&view=Fit&page=1'} title={it.name} tabIndex={-1} />
                        : it.kind === 'video' ? <video src={it.url} />
                          : it.kind === 'audio' ? <span className="doc-batch-typebadge">♪ {it.ext.toUpperCase()}</span>
                            : <span className="doc-batch-typebadge">{it.ext.toUpperCase()}</span>}
                  </div>
                  <div className="doc-batch-fields">
                    <input
                      className="doc-batch-name"
                      value={it.name}
                      onChange={(e) => setBatchName(it.id, e.target.value)}
                      placeholder="Document name"
                    />
                    <span className="doc-batch-meta">{it.ext.toUpperCase()} · {(it.file.size / 1024).toFixed(0)} KB</span>
                  </div>
                  <button type="button" className="btn-delete-inline" onClick={() => removeBatchItem(it.id)}>Remove</button>
                </div>
              ))}
            </div>
          ) : (sheetEdit || isSheetDoc) ? (
            <>
              {isEditing && <div className="doc-staged-preview-hint">Edit the cells, then click <strong>Save</strong>.</div>}
              <SpreadsheetEditor
                ref={sheetRef}
                file={sheetEdit ? sheetEdit.file : undefined}
                url={sheetEdit ? sheetEdit.url : fileUrl}
                ext={sheetEdit ? sheetEdit.ext : fileType}
                readOnly={!isEditing}
              />
            </>
          ) : pendingPreview ? (
            <>
              <div className="doc-staged-preview-hint">Not saved yet — click <strong>Save</strong> to upload.</div>
              <FilePreview src={pendingPreview.url} ext={pendingPreview.ext} name={pendingPreview.name} />
            </>
          ) : isFileDoc ? (
            <FilePreview
              src={fileUrl + (fileUrl.includes('?') ? '&' : '?') + 'inline=1'}
              ext={fileType}
              name={name}
              downloadUrl={fileUrl}
            />
          ) : isEditing ? (
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
