import { useState, useEffect } from 'react';

function TrashAdmin({ onChanged }) {
  const [trash, setTrash] = useState({ features: [], productConfigs: [], matrices: [], cloudInfos: [] });
  const [loading, setLoading] = useState(true);
  const [successMsg, setSuccessMsg] = useState('');
  const [error, setError] = useState('');
  const [permanentDelete, setPermanentDelete] = useState(null);
  const [deleteInput, setDeleteInput] = useState('');

  useEffect(() => { fetchTrash(); }, []);

  const fetchTrash = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/trash');
      const data = await res.json();
      setTrash(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const showSuccess = (msg) => {
    setSuccessMsg(msg);
    setTimeout(() => setSuccessMsg(''), 3000);
  };

  const handleRestore = async (type, id, name) => {
    setError('');
    try {
      const res = await fetch(`/api/trash/restore/${type}/${id}`, { method: 'PUT' });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      showSuccess(`"${name}" restored successfully!`);
      await fetchTrash();
      if (onChanged) onChanged();
    } catch (err) {
      setError(err.message);
    }
  };

  const handlePermanentDelete = async () => {
    if (!permanentDelete) return;
    if (deleteInput !== 'DELETE') {
      setError('Please type DELETE to confirm');
      return;
    }
    setError('');
    const { type, id, name } = permanentDelete;
    try {
      const res = await fetch(`/api/trash/permanent/${type}/${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      showSuccess(`"${name}" permanently deleted!`);
      setPermanentDelete(null);
      setDeleteInput('');
      await fetchTrash();
      if (onChanged) onChanged();
    } catch (err) {
      setError(err.message);
    }
  };

  const cancelPermanentDelete = () => {
    setPermanentDelete(null);
    setDeleteInput('');
    setError('');
  };

  const formatDate = (dateStr) => {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  };

  const totalItems = trash.features.length + trash.productConfigs.length + trash.matrices.length + trash.cloudInfos.length;

  const renderSection = (title, items, type, getLabel) => {
    if (items.length === 0) return null;
    return (
      <div className="trash-section">
        <h4 className="trash-section-title">{title} ({items.length})</h4>
        <div className="trash-items">
          {items.map(item => {
            const id = item.id || item._id;
            const label = getLabel(item);
            return (
              <div key={id} className="trash-item">
                <div className="trash-item-info">
                  <span className="trash-item-name">{label}</span>
                  <span className="trash-item-date">Deleted {formatDate(item.deletedAt)}</span>
                </div>
                <div className="trash-item-actions">
                  <button className="btn-restore" onClick={() => handleRestore(type, id, label)}>Restore</button>
                  <button className="btn-permanent-delete" onClick={() => setPermanentDelete({ type, id, name: label })}>Delete Permanently</button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <div className="trash-admin">
      <div className="trash-header">
        <h3>Trash</h3>
        <span className="trash-count">{totalItems} item{totalItems !== 1 ? 's' : ''} in trash</span>
      </div>

      {successMsg && <div className="success-msg">{successMsg}</div>}
      {error && <div className="error-msg">{error}</div>}

      {permanentDelete && (
        <div className="permanent-delete-modal">
          <div className="permanent-delete-card">
            <h4>Permanently Delete</h4>
            <p>You are about to permanently delete <strong>"{permanentDelete.name}"</strong>. This action cannot be undone.</p>
            <p>Type <strong>DELETE</strong> to confirm:</p>
            <input
              type="text"
              value={deleteInput}
              onChange={e => setDeleteInput(e.target.value)}
              placeholder="Type DELETE"
              autoFocus
            />
            <div className="permanent-delete-actions">
              <button
                className="btn-permanent-confirm"
                onClick={handlePermanentDelete}
                disabled={deleteInput !== 'DELETE'}
              >
                Delete Forever
              </button>
              <button className="btn-cancel" onClick={cancelPermanentDelete}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {loading ? (
        <p>Loading trash...</p>
      ) : totalItems === 0 ? (
        <div className="trash-empty">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="3 6 5 6 21 6" />
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
          </svg>
          <p>Trash is empty</p>
        </div>
      ) : (
        <>
          {renderSection('Features', trash.features, 'feature', f => `${f.name} (${f.productType} / ${f.combination || 'N/A'} / ${f.scope})`)}
          {renderSection('Product Types', trash.productConfigs, 'productConfig', c => c.name)}
          {renderSection('Compatibility Matrices', trash.matrices, 'compatibility', m => m.name)}
          {renderSection('Cloud Info', trash.cloudInfos, 'cloudInfo', i => i.name)}
        </>
      )}
    </div>
  );
}

export default TrashAdmin;
