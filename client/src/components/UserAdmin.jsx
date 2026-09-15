import { useState, useEffect } from 'react';
import { showToast } from './Toast';

const PERM_KEYS = [
  { key: 'productTypes', label: 'Product Types' },
  { key: 'compatibility', label: 'Compatibility' },
  { key: 'cloudInfo', label: 'Cloud Info' },
  { key: 'documents', label: 'Documents' },
];

function UserAdmin() {
  const token = localStorage.getItem('admin_token') || '';
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState('list');
  const [editingUser, setEditingUser] = useState(null);
  const [form, setForm] = useState({ email: '', password: '', name: '', role: 'viewer', permissions: { productTypes: true, compatibility: true, cloudInfo: true, documents: true }, documentFolders: [], documentAccess: [] });
  const [folders, setFolders] = useState([]);
  const [documents, setDocuments] = useState([]);
  const [search, setSearch] = useState('');
  const [bulkBusy, setBulkBusy] = useState('');
  const [saving, setSaving] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [accessRequests, setAccessRequests] = useState([]);
  const [respondingId, setRespondingId] = useState(null);
  const [reqPage, setReqPage] = useState(1);
  const [usersPage, setUsersPage] = useState(1);
  const PAGE_SIZE = 10;

  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };

  const fetchAccessRequests = async () => {
    try {
      const res = await fetch('/api/access-requests', { headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json();
      setAccessRequests(data.requests || []);
    } catch (_) {}
  };

  const handleApprove = async (id) => {
    setRespondingId(id);
    try {
      const res = await fetch(`/api/access-requests/${id}/approve`, { method: 'PUT', headers });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      showToast('Access approved — user can now view Documents');
      fetchAccessRequests();
      fetchUsers();
    } catch (err) { showToast(err.message, 'error'); }
    setRespondingId(null);
  };

  const handleDeny = async (id) => {
    setRespondingId(id);
    try {
      const res = await fetch(`/api/access-requests/${id}/deny`, { method: 'PUT', headers });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      showToast('Request denied');
      fetchAccessRequests();
    } catch (err) { showToast(err.message, 'error'); }
    setRespondingId(null);
  };

  // Runs the existing single-request endpoints one at a time: the same audit
  // entry, email and grant per document as deciding them by hand.
  const decideBatch = async (group, decision) => {
    setBulkBusy(group.email);
    let ok = 0;
    for (const row of group.rows) {
      try {
        const res = await fetch(`/api/access-requests/${row._id}/${decision}`, { method: 'PUT', headers });
        const data = await res.json();
        if (res.ok && data.success) ok += 1;
      } catch (_) { /* counted as failed below */ }
    }
    setBulkBusy('');
    const failed = group.rows.length - ok;
    showToast(
      failed
        ? `${ok} of ${group.rows.length} ${decision === 'approve' ? 'approved' : 'denied'} — ${failed} failed`
        : `${ok} request${ok > 1 ? 's' : ''} ${decision === 'approve' ? 'approved' : 'denied'}`,
      failed ? 'error' : 'success',
    );
    fetchAccessRequests();
    fetchUsers();
  };

  const handleRevoke = async (id) => {
    setRespondingId(id);
    try {
      const res = await fetch(`/api/access-requests/${id}/revoke`, { method: 'PUT', headers });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      showToast('Access revoked — user can no longer view Documents');
      fetchAccessRequests();
      fetchUsers();
    } catch (err) { showToast(err.message, 'error'); }
    setRespondingId(null);
  };

  const fetchUsers = async () => {
    setLoading(true);
    try {
      fetch('/api/document-folders', { headers: { Authorization: `Bearer ${token}` } })
        .then(r => r.json())
        .then(d => setFolders(d.folders || []))
        .catch(() => {});
      fetch('/api/documents', { headers: { Authorization: `Bearer ${token}` } })
        .then(r => r.json())
        .then(d => setDocuments(d.items || []))
        .catch(() => {});
      const res = await fetch('/api/users', { headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json();
      setUsers(data.users || []);
    } catch (_) {}
    setLoading(false);
  };

  useEffect(() => { fetchUsers(); fetchAccessRequests(); }, []);

  const resetForm = () => {
    setForm({ email: '', password: '', name: '', role: 'viewer', permissions: { productTypes: true, compatibility: true, cloudInfo: true, documents: true }, documentFolders: [], documentAccess: [] });
    setEditingUser(null);
    setMode('list');
  };

  // Folder paths read "Guides / Migration", so a subfolder grant is legible
  // without having to picture the tree.
  const folderPath = (folder) => {
    const byId = new Map(folders.map(f => [f.id, f]));
    const parts = [];
    let cursor = folder;
    const guard = new Set();
    while (cursor && !guard.has(cursor.id)) {
      guard.add(cursor.id);
      parts.unshift(cursor.name);
      cursor = cursor.parentId ? byId.get(cursor.parentId) : null;
    }
    return parts.join(' / ');
  };

  const folderToggle = (id) => {
    setForm(prev => ({
      ...prev,
      documentFolders: prev.documentFolders.includes(id)
        ? prev.documentFolders.filter(f => f !== id)
        : [...prev.documentFolders, id],
    }));
  };

  const docToggle = (id) => {
    setForm(prev => ({
      ...prev,
      documentAccess: prev.documentAccess.includes(id)
        ? prev.documentAccess.filter(d => d !== id)
        : [...prev.documentAccess, id],
    }));
  };

  // Documents grouped by the folder they live in, so the grant list reads the
  // way the sidebar does.
  const docsByFolder = (folderId) => documents.filter(d => String(d.folderId || '') === String(folderId || ''));

  // A whole-folder grant already covers everything inside it, so the individual
  // boxes below it are shown as covered rather than pretending to be separate.
  const coveredByFolder = (doc) => {
    let cursor = folders.find(f => f.id === String(doc.folderId || ''));
    const guard = new Set();
    while (cursor && !guard.has(cursor.id)) {
      if (form.documentFolders.includes(cursor.id)) return true;
      guard.add(cursor.id);
      cursor = cursor.parentId ? folders.find(f => f.id === cursor.parentId) : null;
    }
    return false;
  };

  const handleEdit = (user) => {
    setEditingUser(user);
    setForm({
      email: user.email,
      password: '',
      name: user.name || '',
      role: user.role,
      permissions: { productTypes: true, compatibility: true, cloudInfo: true, documents: true, ...user.permissions },
      documentFolders: (user.documentFolders || []).map(String),
      documentAccess: (user.documentAccess || []).map(String),
    });
    setMode('edit');
  };

  const handleSave = async () => {
    if (!form.email.trim()) { showToast('Email is required', 'error'); return; }
    if (mode === 'create' && !form.password) { showToast('Password is required', 'error'); return; }
    setSaving(true);
    try {
      const body = {
        name: form.name.trim(),
        role: form.role,
        permissions: form.permissions,
        documentFolders: form.documentFolders,
        documentAccess: form.documentAccess,
      };
      if (mode === 'create') {
        body.email = form.email.trim();
        body.password = form.password;
        const res = await fetch('/api/users', { method: 'POST', headers, body: JSON.stringify(body) });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        showToast('User created successfully!');
      } else {
        if (form.password) body.password = form.password;
        const res = await fetch(`/api/users/${editingUser.id || editingUser._id}`, { method: 'PUT', headers, body: JSON.stringify(body) });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        showToast('User updated successfully!');
      }
      await fetchUsers();
      resetForm();
    } catch (err) {
      showToast(err.message, 'error');
    }
    setSaving(false);
  };

  const handleToggleActive = async (user) => {
    try {
      const res = await fetch(`/api/users/${user.id || user._id}`, {
        method: 'PUT', headers,
        body: JSON.stringify({ isActive: !user.isActive }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      showToast(`User ${user.isActive ? 'deactivated' : 'activated'}.`);
      fetchUsers();
    } catch (err) { showToast(err.message, 'error'); }
  };

  const handleDelete = async (id, name) => {
    try {
      const res = await fetch(`/api/users/${id}`, { method: 'DELETE', headers });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      showToast(`User "${name}" deleted.`);
      setDeleteConfirm(null);
      fetchUsers();
    } catch (err) { showToast(err.message, 'error'); }
  };

  const permToggle = (key) => {
    setForm(prev => ({
      ...prev,
      permissions: { ...prev.permissions, [key]: !prev.permissions[key] },
    }));
  };

  if (mode === 'list') {
    const query = search.trim().toLowerCase();
    const byEmail = (row) => !query || String(row.email || '').toLowerCase().includes(query);

    const shownRequests = accessRequests.filter(byEmail);
    // Pending requests grouped per person, for the batch buttons.
    const pendingByEmail = Object.values(
      shownRequests.filter(r => r.status === 'pending').reduce((acc, r) => {
        acc[r.email] = acc[r.email] || { email: r.email, rows: [] };
        acc[r.email].rows.push(r);
        return acc;
      }, {})
    ).filter(g => g.rows.length > 1);
    const shownUsers = users.filter(byEmail);
    const pendingRequests = shownRequests.filter(r => r.status === 'pending');

    const reqTotalPages = Math.max(1, Math.ceil(shownRequests.length / PAGE_SIZE));
    const reqPageSafe = Math.min(reqPage, reqTotalPages);
    const pagedRequests = shownRequests.slice((reqPageSafe - 1) * PAGE_SIZE, reqPageSafe * PAGE_SIZE);

    const usersTotalPages = Math.max(1, Math.ceil(shownUsers.length / PAGE_SIZE));
    const usersPageSafe = Math.min(usersPage, usersTotalPages);
    const pagedUsers = shownUsers.slice((usersPageSafe - 1) * PAGE_SIZE, usersPageSafe * PAGE_SIZE);

    const Pagination = ({ page, totalPages, onPage }) => {
      if (totalPages <= 1) return null;
      const pages = [];
      for (let i = 1; i <= totalPages; i++) pages.push(i);
      return (
        <div className="pagination">
          <button className="pg-btn" onClick={() => onPage(page - 1)} disabled={page === 1}>&#8249;</button>
          {pages.map(p => (
            <button key={p} className={`pg-btn ${p === page ? 'pg-active' : ''}`} onClick={() => onPage(p)}>{p}</button>
          ))}
          <button className="pg-btn" onClick={() => onPage(page + 1)} disabled={page === totalPages}>&#8250;</button>
        </div>
      );
    };

    return (
      <div className="user-admin">
        <div className="user-search-bar">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            type="text"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setReqPage(1); setUsersPage(1); }}
            placeholder="Search by email…"
          />
          {search && (
            <button className="user-search-clear" onClick={() => { setSearch(''); setReqPage(1); setUsersPage(1); }} title="Clear">×</button>
          )}
        </div>

        {/* Access Requests Section */}
        {shownRequests.length > 0 && (
          <div className="access-requests-section">
            <div className="access-requests-header">
              <h3>
                Document Access Requests
                {pendingRequests.length > 0 && (
                  <span className="access-request-badge">{pendingRequests.length}</span>
                )}
              </h3>
            </div>

            {/* Somebody who asks for eight documents at once should not cost
                eight clicks, so each person's pending batch can be decided in one. */}
            {pendingByEmail.length > 0 && (
              <div className="access-batch-bar">
                {pendingByEmail.map(group => (
                  <div key={group.email} className="access-batch-row">
                    <span className="access-batch-label">
                      <strong>{group.email}</strong> — {group.rows.length} pending
                    </span>
                    <button
                      className="btn-approve"
                      disabled={bulkBusy === group.email}
                      onClick={() => decideBatch(group, 'approve')}
                    >
                      {bulkBusy === group.email ? 'Working…' : `Approve all ${group.rows.length}`}
                    </button>
                    <button
                      className="btn-deny"
                      disabled={bulkBusy === group.email}
                      onClick={() => decideBatch(group, 'deny')}
                    >
                      Deny all
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div className="access-requests-table-wrap">
              <table className="user-admin-table">
                <thead>
                  <tr>
                    <th>Email</th>
                    <th>Requested</th>
                    <th>Requested At</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {pagedRequests.map(r => (
                    <tr key={r._id}>
                      <td>{r.email}</td>
                      <td>
                        {r.documentName
                          ? <>{r.documentName}{r.folderName ? <span className="access-req-where"> in {r.folderName}</span> : null}</>
                          : (r.folderName ? `${r.folderName} (whole folder)` : 'Documents (whole section)')}
                      </td>
                      <td>{new Date(r.requestedAt).toLocaleString()}</td>
                      <td>
                        <span className={`access-status-badge status-${r.status}`}>
                          {r.status.charAt(0).toUpperCase() + r.status.slice(1)}
                        </span>
                      </td>
                      <td className="user-actions-cell">
                        {r.status === 'pending' ? (
                          <>
                            <button
                              className="btn-approve"
                              onClick={() => handleApprove(r._id)}
                              disabled={respondingId === r._id}
                            >
                              {respondingId === r._id ? '...' : 'Approve'}
                            </button>
                            <button
                              className="btn-deny"
                              onClick={() => handleDeny(r._id)}
                              disabled={respondingId === r._id}
                            >
                              Deny
                            </button>
                          </>
                        ) : r.status === 'approved' ? (
                          <>
                            <span className="access-responded-at">
                              {r.respondedAt ? new Date(r.respondedAt).toLocaleDateString() : '—'}
                            </span>
                            <button
                              className="btn-revoke"
                              onClick={() => handleRevoke(r._id)}
                              disabled={respondingId === r._id}
                            >
                              {respondingId === r._id ? '...' : 'Revoke'}
                            </button>
                          </>
                        ) : (
                          <span className="access-responded-at">
                            {r.respondedAt ? new Date(r.respondedAt).toLocaleDateString() : '—'}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={reqPageSafe} totalPages={reqTotalPages} onPage={p => setReqPage(Math.max(1, Math.min(p, reqTotalPages)))} />
          </div>
        )}

        {/* Users Section */}
        <div className="user-admin-header">
          <h3>User Management</h3>
          <button className="btn-save" onClick={() => { resetForm(); setMode('create'); }}>+ New User</button>
        </div>
        {loading ? <p>Loading users...</p> : shownUsers.length === 0 ? (
          <p className="user-admin-empty">
            {query ? `No users match "${search.trim()}".` : 'No users yet. Click "+ New User" to create one.'}
          </p>
        ) : (
          <div className="user-admin-table-wrap">
            <table className="user-admin-table">
              <thead>
                <tr>
                  <th>Email</th>
                  <th>Role</th>
                  <th>Document Access</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {pagedUsers.map(u => (
                  <tr key={u.id || u._id} className={!u.isActive ? 'user-row-inactive' : ''}>
                    <td>{u.email}</td>
                    <td><span className={`role-badge role-${u.role}`}>{u.role}</span></td>
                    <td className="user-folders-cell">
                      {/* The chips wrap in an inner box: a <td> made a flex
                          container stops behaving like a table cell, which threw
                          every column after it out of line. */}
                      <div className="user-folders-chips">
                        {u.role === 'admin' ? (
                          <span className="perm-chip perm-on">Everything</span>
                        ) : (u.documentFolders || []).length === 0 && (u.documentAccess || []).length === 0 ? (
                          <span className="perm-chip perm-off">None</span>
                        ) : (
                          <>
                            {(u.documentFolders || []).map(id => {
                              const f = folders.find(x => x.id === String(id));
                              return (
                                <span key={'f' + String(id)} className="perm-chip perm-on">
                                  {f ? folderPath(f) : 'removed folder'} (folder)
                                </span>
                              );
                            })}
                            {(u.documentAccess || []).map(id => {
                              const d = documents.find(x => x._id === String(id));
                              return (
                                <span key={'d' + String(id)} className="perm-chip perm-on">
                                  {d ? d.name : 'removed document'}
                                </span>
                              );
                            })}
                          </>
                        )}
                      </div>
                    </td>
                    <td>
                      <button className={`btn-status ${u.isActive ? 'active' : 'inactive'}`} onClick={() => handleToggleActive(u)}>
                        {u.isActive ? 'Active' : 'Inactive'}
                      </button>
                    </td>
                    <td className="user-actions-cell">
                      <button className="btn-edit-sm" onClick={() => handleEdit(u)}>Edit</button>
                      {deleteConfirm === (u.id || u._id) ? (
                        <span className="delete-inline">
                          <button className="btn-yes" onClick={() => handleDelete(u.id || u._id, u.email)}>Yes</button>
                          <button className="btn-no" onClick={() => setDeleteConfirm(null)}>No</button>
                        </span>
                      ) : (
                        <button className="btn-delete-inline" onClick={() => setDeleteConfirm(u.id || u._id)}>Delete</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Pagination page={usersPageSafe} totalPages={usersTotalPages} onPage={p => setUsersPage(Math.max(1, Math.min(p, usersTotalPages)))} />
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="user-admin">
      <div className="user-admin-header">
        <button className="btn-back" onClick={resetForm}>&larr; Back</button>
        <h3>{mode === 'create' ? 'Create User' : `Edit: ${editingUser?.email}`}</h3>
      </div>

      <div className="user-form">
        <div className="form-group">
          <label>Email <span className="required">*</span></label>
          <input type="email" value={form.email} onChange={e => setForm(p => ({ ...p, email: e.target.value }))} disabled={mode === 'edit'} placeholder="user@company.com" />
        </div>
        <div className="form-group">
          <label>{mode === 'create' ? 'Password' : 'New Password (leave blank to keep current)'} {mode === 'create' && <span className="required">*</span>}</label>
          <input type="password" value={form.password} onChange={e => setForm(p => ({ ...p, password: e.target.value }))} placeholder={mode === 'create' ? 'Enter password' : 'Leave blank to keep current'} />
        </div>
        <div className="form-group">
          <label>Name</label>
          <input type="text" value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} placeholder="Full name" />
        </div>
        <div className="form-group">
          <label>Role</label>
          <select value={form.role} onChange={e => setForm(p => ({ ...p, role: e.target.value }))}>
            <option value="viewer">Viewer</option>
            <option value="admin">Admin</option>
          </select>
        </div>
        <div className="form-group">
          <label>Tab Permissions</label>
          <div className="perm-toggles">
            {PERM_KEYS.map(p => (
              <label key={p.key} className="perm-toggle-label">
                <input type="checkbox" checked={form.permissions[p.key] !== false} onChange={() => permToggle(p.key)} />
                <span>{p.label}</span>
              </label>
            ))}
          </div>
        </div>
        {form.role !== 'admin' && (
          <div className="form-group">
            <label>Document Access</label>
            {folders.length === 0 && documents.length === 0 ? (
              <p className="folder-grant-empty">No documents yet.</p>
            ) : (
              <>
                <div className="doc-grant-list">
                  {folders.map(f => (
                    <div key={f.id} className="doc-grant-group">
                      <label className="perm-toggle-label doc-grant-folder">
                        <input
                          type="checkbox"
                          checked={form.documentFolders.includes(f.id)}
                          onChange={() => folderToggle(f.id)}
                        />
                        <span>{folderPath(f)} <em>— whole folder</em></span>
                      </label>
                      {docsByFolder(f.id).map(d => {
                        const covered = coveredByFolder(d);
                        return (
                          <label key={d._id} className="perm-toggle-label doc-grant-doc">
                            <input
                              type="checkbox"
                              checked={covered || form.documentAccess.includes(d._id)}
                              disabled={covered}
                              onChange={() => docToggle(d._id)}
                            />
                            <span>{d.name}{covered ? ' (covered by the folder grant)' : ''}</span>
                          </label>
                        );
                      })}
                    </div>
                  ))}
                  {docsByFolder('').length > 0 && (
                    <div className="doc-grant-group">
                      <span className="doc-grant-folder doc-grant-loose">Not in any folder</span>
                      {docsByFolder('').map(d => (
                        <label key={d._id} className="perm-toggle-label doc-grant-doc">
                          <input
                            type="checkbox"
                            checked={form.documentAccess.includes(d._id)}
                            onChange={() => docToggle(d._id)}
                          />
                          <span>{d.name}</span>
                        </label>
                      ))}
                    </div>
                  )}
                </div>
                <small className="folder-grant-hint">
                  Tick a document to grant just that one, or a folder to cover everything inside it, including documents added later. Admins always see everything.
                </small>
              </>
            )}
          </div>
        )}
        <div className="form-actions">
          <button className="btn-save" onClick={handleSave} disabled={saving}>{saving ? 'Saving...' : 'Save'}</button>
          <button className="btn-cancel" onClick={resetForm}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

export default UserAdmin;
