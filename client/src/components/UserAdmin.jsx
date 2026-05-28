import { useState, useEffect } from 'react';
import { showToast } from './Toast';

const PERM_KEYS = [
  { key: 'productTypes', label: 'Product Types' },
  { key: 'compatibility', label: 'Compatibility' },
  { key: 'cloudInfo', label: 'Cloud Info' },
  { key: 'documents', label: 'Documents' },
];

function UserAdmin() {
  const token = sessionStorage.getItem('admin_token') || '';
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState('list');
  const [editingUser, setEditingUser] = useState(null);
  const [form, setForm] = useState({ email: '', password: '', name: '', role: 'viewer', permissions: { productTypes: true, compatibility: true, cloudInfo: true, documents: true } });
  const [saving, setSaving] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(null);

  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };

  const fetchUsers = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/users', { headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json();
      setUsers(data.users || []);
    } catch (_) {}
    setLoading(false);
  };

  useEffect(() => { fetchUsers(); }, []);

  const resetForm = () => {
    setForm({ email: '', password: '', name: '', role: 'viewer', permissions: { productTypes: true, compatibility: true, cloudInfo: true, documents: true } });
    setEditingUser(null);
    setMode('list');
  };

  const handleEdit = (user) => {
    setEditingUser(user);
    setForm({
      email: user.email,
      password: '',
      name: user.name || '',
      role: user.role,
      permissions: { productTypes: true, compatibility: true, cloudInfo: true, documents: true, ...user.permissions },
    });
    setMode('edit');
  };

  const handleSave = async () => {
    if (!form.email.trim()) { showToast('Email is required', 'error'); return; }
    if (mode === 'create' && !form.password) { showToast('Password is required', 'error'); return; }
    setSaving(true);
    try {
      const body = { name: form.name.trim(), role: form.role, permissions: form.permissions };
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
    return (
      <div className="user-admin">
        <div className="user-admin-header">
          <h3>User Management</h3>
          <button className="btn-save" onClick={() => { resetForm(); setMode('create'); }}>+ New User</button>
        </div>
        {loading ? <p>Loading users...</p> : users.length === 0 ? (
          <p className="user-admin-empty">No users yet. Click "+ New User" to create one.</p>
        ) : (
          <div className="user-admin-table-wrap">
            <table className="user-admin-table">
              <thead>
                <tr>
                  <th>Email</th>
                  <th>Name</th>
                  <th>Role</th>
                  <th>Permissions</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.map(u => (
                  <tr key={u.id || u._id} className={!u.isActive ? 'user-row-inactive' : ''}>
                    <td>{u.email}</td>
                    <td>{u.name || '—'}</td>
                    <td><span className={`role-badge role-${u.role}`}>{u.role}</span></td>
                    <td className="user-perms-cell">
                      {PERM_KEYS.map(p => (
                        <span key={p.key} className={`perm-chip ${u.permissions?.[p.key] !== false ? 'perm-on' : 'perm-off'}`}>
                          {p.label}
                        </span>
                      ))}
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
        <div className="form-actions">
          <button className="btn-save" onClick={handleSave} disabled={saving}>{saving ? 'Saving...' : 'Save'}</button>
          <button className="btn-cancel" onClick={resetForm}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

export default UserAdmin;
