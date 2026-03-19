import { useState, useEffect, useRef, useCallback } from 'react';
import FeatureCard from './FeatureCard';
import { useProductConfig } from '../ProductConfigContext';
import CustomSelect from './CustomSelect';

function getEditCacheKey(productType, scope, combination) {
  return `edit_cache_${productType}_${scope}_${combination}`;
}

function ReadOnlyFeature({ feature, index }) {
  const screenshots = feature.screenshots || [];
  return (
    <div className="feature-card">
      <div className="feature-card-header">
        <span className="feature-card-number">#{index + 1}</span>
      </div>
      <div className="feature-card-body">
        <div className="form-group">
          <label>Feature Name</label>
          <div className="readonly-value">{feature.name || '—'}</div>
        </div>
        <div className="form-group">
          <label>Description</label>
          <div className="readonly-value">{feature.description || '—'}</div>
        </div>
        <div className="form-group">
          <label>Family</label>
          <div className="readonly-value">{feature.family || '—'}</div>
        </div>
        {screenshots.length > 0 && (
          <div className="form-group">
            <label>Screenshots</label>
            <div className="screenshot-upload-area">
              {screenshots.map((src, idx) => (
                <div key={idx} className="screenshot-thumb">
                  <img src={src} alt={`Screenshot ${idx + 1}`} />
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function OrderInput({ index, total, onReorder, disabled }) {
  const [value, setValue] = useState(String(index + 1));
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    if (!editing) setValue(String(index + 1));
  }, [index, editing]);

  const commit = () => {
    setEditing(false);
    const num = parseInt(value, 10);
    if (isNaN(num) || num < 1 || num > total || num === index + 1) {
      setValue(String(index + 1));
      return;
    }
    onReorder(index, num - 1);
  };

  return (
    <input
      className="order-number-input"
      type="text"
      inputMode="numeric"
      value={value}
      disabled={disabled}
      onFocus={() => { setEditing(true); }}
      onChange={(e) => {
        const v = e.target.value.replace(/\D/g, '');
        setValue(v);
      }}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') { e.target.blur(); }
        if (e.key === 'Escape') { setEditing(false); setValue(String(index + 1)); }
      }}
      title={`Position ${index + 1} of ${total} — type a number to move`}
    />
  );
}

function MoveButtons({ index, total, onMove, disabled }) {
  return (
    <span className="move-btns">
      <button
        className="btn-move"
        disabled={disabled || index === 0}
        onClick={() => onMove(index, index - 1)}
        title="Move up"
      >▲</button>
      <button
        className="btn-move"
        disabled={disabled || index === total - 1}
        onClick={() => onMove(index, index + 1)}
        title="Move down"
      >▼</button>
    </span>
  );
}

function EditFeatureTab({ refreshKey, onChanged }) {
  const { productTypes, combinationsByProduct, configs, refresh } = useProductConfig();

  const [scope, setScope] = useState('');
  const [productType, setProductType] = useState('');
  const [combination, setCombination] = useState('');
  const [features, setFeatures] = useState([]);
  const [originalFeatures, setOriginalFeatures] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [reordering, setReordering] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [isOffline, setIsOffline] = useState(false);
  const [editingIds, setEditingIds] = useState(new Set());
  const [deletePTConfirm, setDeletePTConfirm] = useState(false);
  const [deleteComboConfirm, setDeleteComboConfirm] = useState(false);

  const dragItem = useRef(null);
  const dragOverItem = useRef(null);
  const [dragOverIndex, setDragOverIndex] = useState(null);

  const ptSectionRef = useRef(null);
  const comboSectionRef = useRef(null);
  const featuresSectionRef = useRef(null);

  const ptDragItem = useRef(null);
  const ptDragOver = useRef(null);
  const comboDragItem = useRef(null);
  const comboDragOver = useRef(null);

  const combinations = productType ? (combinationsByProduct[productType] || []) : [];
  const readyToFetch = scope && productType && (combinations.length === 0 || combination);

  useEffect(() => {
    if (scope && ptSectionRef.current) {
      ptSectionRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [scope]);

  useEffect(() => {
    if (productType && comboSectionRef.current) {
      comboSectionRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [productType]);

  useEffect(() => {
    if (combination && featuresSectionRef.current) {
      setTimeout(() => {
        featuresSectionRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }, 100);
    }
  }, [combination]);

  useEffect(() => {
    if (readyToFetch) {
      fetchFiltered();
    } else {
      setFeatures([]);
      setOriginalFeatures([]);
    }
  }, [scope, productType, combination, refreshKey]);

  const addMeta = (list) =>
    list.map(f => ({
      ...f,
      _pendingFiles: [],
      _localPreviews: [],
      _dirty: false,
    }));

  const fetchFiltered = async () => {
    setLoading(true);
    setError('');
    setEditingIds(new Set());
    const cacheKey = getEditCacheKey(productType, scope, combination);
    try {
      const params = new URLSearchParams({ productType, scope });
      if (combination) params.set('combination', combination);
      const res = await fetch(`/api/features?${params}`);
      const data = await res.json();
      const withMeta = addMeta(data.features || []);
      setFeatures(withMeta);
      setOriginalFeatures(JSON.parse(JSON.stringify(withMeta)));
      setIsOffline(false);

      try {
        localStorage.setItem(cacheKey, JSON.stringify(data));
      } catch (_) { /* quota exceeded */ }
    } catch (err) {
      const cached = localStorage.getItem(cacheKey);
      if (cached) {
        const data = JSON.parse(cached);
        const withMeta = addMeta(data.features || []);
        setFeatures(withMeta);
        setOriginalFeatures(JSON.parse(JSON.stringify(withMeta)));
        setIsOffline(true);
      } else {
        setError('Failed to load features: ' + err.message);
      }
    }
    setLoading(false);
  };

  const toggleEdit = (featureId) => {
    setEditingIds(prev => {
      const next = new Set(prev);
      if (next.has(featureId)) {
        next.delete(featureId);
        const orig = originalFeatures.find(f => f.id === featureId);
        if (orig) {
          setFeatures(prev =>
            prev.map(f =>
              f.id === featureId
                ? { ...JSON.parse(JSON.stringify(orig)), _pendingFiles: [], _localPreviews: [], _dirty: false }
                : f
            )
          );
        }
      } else {
        next.add(featureId);
      }
      return next;
    });
  };

  const handleFeatureChange = (index, updated) => {
    setFeatures(prev => prev.map((f, i) =>
      i === index ? { ...updated, _dirty: true } : f
    ));
  };

  const uploadScreenshots = async (files, featureName) => {
    if (!files || files.length === 0) return [];
    const formData = new FormData();
    if (featureName) formData.append('featureName', featureName);
    files.forEach(f => formData.append('screenshots', f));
    const res = await fetch('/api/screenshots', { method: 'POST', body: formData });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    return data.paths;
  };

  const handleSaveAll = async () => {
    const dirtyFeatures = features.filter(f => f._dirty);
    if (dirtyFeatures.length === 0) {
      setError('No changes to save.');
      return;
    }

    setSaving(true);
    setError('');
    setSuccessMsg('');
    let savedCount = 0;

    try {
      const familyRenames = new Map();
      for (const feature of dirtyFeatures) {
        const orig = originalFeatures.find(f => f.id === feature.id);
        if (orig && orig.family && feature.family && orig.family.trim() !== feature.family.trim()) {
          familyRenames.set(orig.family.trim(), feature.family.trim());
        }
      }

      for (const [oldFamily, newFamily] of familyRenames) {
        await fetch('/api/features/rename-family', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            productType,
            scope,
            combination: combination || '',
            oldFamily,
            newFamily,
          }),
        });
      }

      for (let i = 0; i < features.length; i++) {
        const feature = features[i];
        if (!feature._dirty) continue;
        if (!feature.name.trim()) continue;

        let screenshotPaths = [...(feature.screenshots || [])];
        if (feature._pendingFiles && feature._pendingFiles.length > 0) {
          const uploaded = await uploadScreenshots(feature._pendingFiles, feature.name.trim());
          screenshotPaths = [...screenshotPaths, ...uploaded];
        }

        const newFamily = feature.family ? feature.family.trim() : '';
        const res = await fetch(`/api/features/${feature.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: feature.name.trim(),
            description: (feature.description || '').trim(),
            family: newFamily,
            screenshots: screenshotPaths,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        savedCount++;
      }

      const renameCount = familyRenames.size;
      let msg = `${savedCount} feature${savedCount !== 1 ? 's' : ''} updated successfully!`;
      if (renameCount > 0) {
        msg += ` ${renameCount} family name${renameCount !== 1 ? 's' : ''} renamed across all features.`;
      }
      setSuccessMsg(msg);
      if (onChanged) onChanged();
      setEditingIds(new Set());
      fetchFiltered();
    } catch (err) {
      setError('Update failed: ' + err.message);
    }

    setSaving(false);
  };

  const handleDelete = async (id) => {
    setError('');
    try {
      await fetch(`/api/features/${id}`, { method: 'DELETE' });
      setFeatures(prev => prev.filter(f => f.id !== id));
      setOriginalFeatures(prev => prev.filter(f => f.id !== id));
      setEditingIds(prev => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      setDeleteConfirm(null);
      setSuccessMsg('Feature deleted.');
      setTimeout(() => setSuccessMsg(''), 3000);
      if (onChanged) onChanged();
    } catch (err) {
      setError('Delete failed: ' + err.message);
    }
  };

  const handleDeleteProductType = async () => {
    const scopeLabel = scope === 'inscope' ? 'In Scope' : 'Out of Scope';
    try {
      const params = new URLSearchParams({ productType, scope });
      await fetch(`/api/features/by-scope?${params}`, { method: 'DELETE' });
      setFeatures([]);
      setOriginalFeatures([]);
      setDeletePTConfirm(false);
      setSuccessMsg(`All ${scopeLabel} features for "${productType}" deleted. The product type itself is preserved.`);
      if (onChanged) onChanged();
    } catch (err) {
      setError('Delete failed: ' + err.message);
    }
  };

  const handleDeleteCombination = async () => {
    const scopeLabel = scope === 'inscope' ? 'In Scope' : 'Out of Scope';
    try {
      const params = new URLSearchParams({ productType, scope, combination });
      await fetch(`/api/features/by-scope?${params}`, { method: 'DELETE' });
      setFeatures([]);
      setOriginalFeatures([]);
      setDeleteComboConfirm(false);
      setSuccessMsg(`All ${scopeLabel} features for "${combination}" deleted. The combination itself is preserved.`);
      if (onChanged) onChanged();
    } catch (err) {
      setError('Delete failed: ' + err.message);
    }
  };

  const handleMoveProductType = async (fromIdx, toIdx) => {
    try {
      const reordered = [...configs];
      const [moved] = reordered.splice(fromIdx, 1);
      reordered.splice(toIdx, 0, moved);
      const orderedIds = reordered.map(c => c.id);
      const res = await fetch('/api/product-config/reorder', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderedIds }),
      });
      if (!res.ok) throw new Error('Reorder failed');
      await refresh();
      setSuccessMsg('Product type order updated.');
      setTimeout(() => setSuccessMsg(''), 2000);
    } catch (err) {
      setError('Reorder failed: ' + err.message);
    }
  };

  const handlePTDragEnd = async () => {
    const from = ptDragItem.current;
    const to = ptDragOver.current;
    ptDragItem.current = null;
    ptDragOver.current = null;
    if (from === null || to === null || from === to) return;
    handleMoveProductType(from, to);
  };

  const handleMoveCombination = async (fromIdx, toIdx) => {
    const config = configs.find(c => c.name === productType);
    if (!config) return;
    try {
      const reordered = [...combinations];
      const [moved] = reordered.splice(fromIdx, 1);
      reordered.splice(toIdx, 0, moved);
      const res = await fetch(`/api/product-config/${config.id}/reorder-combinations`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ combinations: reordered }),
      });
      if (!res.ok) throw new Error('Reorder failed');
      await refresh();
      setSuccessMsg('Combination order updated.');
      setTimeout(() => setSuccessMsg(''), 2000);
    } catch (err) {
      setError('Reorder failed: ' + err.message);
    }
  };

  const handleComboDragEnd = async () => {
    const from = comboDragItem.current;
    const to = comboDragOver.current;
    comboDragItem.current = null;
    comboDragOver.current = null;
    if (from === null || to === null || from === to) return;
    handleMoveCombination(from, to);
  };

  const persistOrder = async (reordered) => {
    setReordering(true);
    try {
      const orderedIds = reordered.map(f => f.id);
      const res = await fetch('/api/features/reorder', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderedIds }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error);
      }
      setOriginalFeatures(JSON.parse(JSON.stringify(reordered)));
      setSuccessMsg('Order updated.');
      setTimeout(() => setSuccessMsg(''), 2000);
      if (onChanged) onChanged();
    } catch (err) {
      setError('Reorder failed: ' + err.message);
      fetchFiltered();
    }
    setReordering(false);
  };

  const handleNumberReorder = useCallback((fromIndex, toIndex) => {
    const reordered = [...features];
    const [moved] = reordered.splice(fromIndex, 1);
    reordered.splice(toIndex, 0, moved);
    setFeatures(reordered);
    persistOrder(reordered);
  }, [features]);

  const handleDragStart = useCallback((index) => {
    dragItem.current = index;
  }, []);

  const handleDragEnter = useCallback((index) => {
    dragOverItem.current = index;
    setDragOverIndex(index);
  }, []);

  const handleDragEnd = useCallback(async () => {
    const from = dragItem.current;
    const to = dragOverItem.current;
    setDragOverIndex(null);

    if (from === null || to === null || from === to) {
      dragItem.current = null;
      dragOverItem.current = null;
      return;
    }

    const reordered = [...features];
    const [moved] = reordered.splice(from, 1);
    reordered.splice(to, 0, moved);
    setFeatures(reordered);

    dragItem.current = null;
    dragOverItem.current = null;

    persistOrder(reordered);
  }, [features, onChanged]);

  const dirtyCount = features.filter(f => f._dirty).length;

  return (
    <div className="scope-form">
      <h2 className="scope-form-title">Edit Features</h2>

      {successMsg && <div className="form-success">{successMsg}</div>}

      <div className="form-section">
        <div className="form-group">
          <label>Scope Status <span className="required">*</span></label>
          <CustomSelect
            value={scope}
            onChange={(e) => { setScope(e.target.value); setSuccessMsg(''); }}
            options={[
              { value: 'inscope', label: 'In Scope' },
              { value: 'outscope', label: 'Out of Scope' },
            ]}
            placeholder="-- Select Scope --"
          />
        </div>
      </div>

      {scope && (
        <div className="form-section" ref={ptSectionRef}>
          <div className="form-group">
            <label>Product Type <span className="required">*</span></label>
            <div className="select-with-action">
              <CustomSelect
                value={productType}
                onChange={(e) => { setProductType(e.target.value); setCombination(''); setSuccessMsg(''); setDeletePTConfirm(false); }}
                options={productTypes.map(pt => ({ value: pt, label: pt }))}
                placeholder="-- Select Product Type --"
              />
              {productType && !deletePTConfirm && (
                <button className="btn-delete-inline" onClick={() => setDeletePTConfirm(true)} title={`Delete all ${scope === 'inscope' ? 'In Scope' : 'Out of Scope'} features for this product type`}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                  Delete
                </button>
              )}
            </div>
          </div>
          {deletePTConfirm && (
            <div className="delete-confirm-bar">
              <span className="delete-confirm-msg">
                Delete all <strong>{scope === 'inscope' ? 'In Scope' : 'Out of Scope'}</strong> features for <strong>{productType}</strong>?
                <br /><small>Only features in this scope will be removed. The product type itself will remain.</small>
              </span>
              <button className="btn-yes" onClick={handleDeleteProductType}>Yes, Delete</button>
              <button className="btn-no" onClick={() => setDeletePTConfirm(false)}>Cancel</button>
            </div>
          )}

          {productTypes.length > 1 && (
            <div className="reorder-list">
              <label className="reorder-label">Product Type Order <span className="drag-hint-inline">(drag to reorder)</span></label>
              {configs.map((c, idx) => (
                <div
                  key={c.id}
                  className={`reorder-item${c.name === productType ? ' reorder-item-active' : ''}`}
                  draggable
                  onDragStart={() => { ptDragItem.current = idx; }}
                  onDragEnter={() => { ptDragOver.current = idx; }}
                  onDragOver={e => e.preventDefault()}
                  onDragEnd={handlePTDragEnd}
                >
                  <span className="drag-dots reorder-drag-handle">⠿</span>
                  <span className="reorder-item-name">{idx + 1}. {c.name}</span>
                  <MoveButtons index={idx} total={configs.length} onMove={handleMoveProductType} disabled={false} />
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {scope && productType && combinations.length > 0 && (
        <div className="form-section" ref={comboSectionRef}>
          <div className="form-group">
            <label>Combination <span className="required">*</span></label>
            <div className="select-with-action">
              <CustomSelect
                value={combination}
                onChange={(e) => { setCombination(e.target.value); setSuccessMsg(''); setDeleteComboConfirm(false); }}
                options={combinations.map(c => ({ value: c, label: c }))}
                placeholder="-- Select Combination --"
              />
              {combination && !deleteComboConfirm && (
                <button className="btn-delete-inline" onClick={() => setDeleteComboConfirm(true)} title={`Delete all ${scope === 'inscope' ? 'In Scope' : 'Out of Scope'} features for this combination`}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                  Delete
                </button>
              )}
            </div>
          </div>
          {deleteComboConfirm && (
            <div className="delete-confirm-bar">
              <span className="delete-confirm-msg">
                Delete all <strong>{scope === 'inscope' ? 'In Scope' : 'Out of Scope'}</strong> features for <strong>{combination}</strong>?
                <br /><small>Only features in this scope will be removed. The combination itself will remain.</small>
              </span>
              <button className="btn-yes" onClick={handleDeleteCombination}>Yes, Delete</button>
              <button className="btn-no" onClick={() => setDeleteComboConfirm(false)}>Cancel</button>
            </div>
          )}

          {combinations.length > 1 && (
            <div className="reorder-list">
              <label className="reorder-label">Combination Order <span className="drag-hint-inline">(drag to reorder)</span></label>
              {combinations.map((c, idx) => (
                <div
                  key={c}
                  className={`reorder-item${c === combination ? ' reorder-item-active' : ''}`}
                  draggable
                  onDragStart={() => { comboDragItem.current = idx; }}
                  onDragEnter={() => { comboDragOver.current = idx; }}
                  onDragOver={e => e.preventDefault()}
                  onDragEnd={handleComboDragEnd}
                >
                  <span className="drag-dots reorder-drag-handle">⠿</span>
                  <span className="reorder-item-name">{idx + 1}. {c}</span>
                  <MoveButtons index={idx} total={combinations.length} onMove={handleMoveCombination} disabled={false} />
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {readyToFetch && (
        <div ref={featuresSectionRef}>
          <div className="form-section-header">
            <span className="scope-badge" data-scope={scope}>
              {scope === 'inscope' ? 'In Scope' : 'Out of Scope'}
            </span>
            <span className="product-badge">{productType}</span>
            {combination && <span className="combination-badge">{combination}</span>}
            {features.length > 0 && (
              <span className="count-badge">{features.length} feature{features.length !== 1 ? 's' : ''}</span>
            )}
          </div>

          {isOffline && (
            <div className="offline-banner" style={{ marginBottom: 16 }}>
              Server is offline — showing cached data. Save and delete are unavailable until the server is back.
            </div>
          )}

          {error && <div className="form-error">{error}</div>}

          {loading ? (
            <div className="saved-loading">Loading features...</div>
          ) : features.length === 0 ? (
            <div className="saved-empty">
              No features found for {scope === 'inscope' ? 'In Scope' : 'Out of Scope'} / {productType}
              {combination ? ` / ${combination}` : ''}.
            </div>
          ) : (
            <>
              <p className="drag-hint">Drag features or type a position number to reorder.</p>
              <div className="edit-features-list">
                {features.map((feature, idx) => {
                  const isEditing = editingIds.has(feature.id);
                  const isDragOver = dragOverIndex === idx;
                  return (
                    <div
                      key={feature.id}
                      className={`edit-feature-wrapper${isDragOver ? ' drag-over' : ''}`}
                      draggable={!isEditing}
                      onDragStart={() => handleDragStart(idx)}
                      onDragEnter={() => handleDragEnter(idx)}
                      onDragOver={(e) => e.preventDefault()}
                      onDragEnd={handleDragEnd}
                    >
                      <div className="drag-handle" title="Drag to reorder">
                        <span className="drag-dots">⠿</span>
                        <OrderInput
                          index={idx}
                          total={features.length}
                          onReorder={handleNumberReorder}
                          disabled={isOffline || reordering}
                        />
                      </div>
                      <div className="edit-feature-content">
                        {isEditing ? (
                          <FeatureCard
                            feature={feature}
                            index={idx}
                            onChange={handleFeatureChange}
                            onRemove={() => {}}
                            showRemove={false}
                          />
                        ) : (
                          <ReadOnlyFeature feature={feature} index={idx} />
                        )}
                        <div className="edit-feature-actions">
                          <button
                            className={`btn-edit ${isEditing ? 'active' : ''}`}
                            onClick={() => toggleEdit(feature.id)}
                            disabled={isOffline}
                          >
                            {isEditing ? 'Cancel Edit' : 'Edit'}
                          </button>
                          {deleteConfirm === feature.id ? (
                            <div className="delete-confirm">
                              <span>Delete this feature?</span>
                              <button className="btn-yes" onClick={() => handleDelete(feature.id)}>Yes</button>
                              <button className="btn-no" onClick={() => setDeleteConfirm(null)}>No</button>
                            </div>
                          ) : (
                            <button
                              className="btn-delete"
                              onClick={() => setDeleteConfirm(feature.id)}
                              disabled={isOffline}
                            >
                              Delete
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {dirtyCount > 0 && (
                <div className="form-actions">
                  <button
                    type="button"
                    className="btn-save"
                    onClick={handleSaveAll}
                    disabled={saving || isOffline}
                  >
                    {saving ? 'Saving...' : `Save All Changes (${dirtyCount})`}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

export default EditFeatureTab;
