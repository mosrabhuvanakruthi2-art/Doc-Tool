import { useState, useEffect, useRef, useMemo } from 'react';
import FeatureCard from './FeatureCard';
import { useProductConfig } from '../ProductConfigContext';
import CustomSelect from './CustomSelect';
import { showToast } from './Toast';

const DUPLICATE_FEATURE_NAME_MSG = 'This feature already exists. Enter a different name.';

const emptyFeature = () => ({
  name: '',
  description: '',
  family: '',
  screenshots: [],
  _pendingFiles: [],
  _localPreviews: [],
});

function FeatureScopeForm({ onSaved }) {
  const { productTypes, combinationsByProduct, configs, refresh } = useProductConfig();

  const [productType, setProductType] = useState('');
  const [scope, setScope] = useState('');
  const [combination, setCombination] = useState('');
  const [features, setFeatures] = useState([emptyFeature()]);
  const [saving, setSaving] = useState(false);

  const [showNewPT, setShowNewPT] = useState(false);
  const [newPTName, setNewPTName] = useState('');
  const [savingPT, setSavingPT] = useState(false);

  const [showNewCombo, setShowNewCombo] = useState(false);
  const [newComboName, setNewComboName] = useState('');
  const [savingCombo, setSavingCombo] = useState(false);

  const [existingNamesLower, setExistingNamesLower] = useState(() => new Set());

  const combinations = productType ? (combinationsByProduct[productType] || []) : [];

  useEffect(() => {
    if (!productType || !scope) {
      setExistingNamesLower(new Set());
      return;
    }
    if (combinations.length > 0 && !combination) {
      setExistingNamesLower(new Set());
      return;
    }
    const params = new URLSearchParams({
      productType,
      scope,
      combination: combination || '',
    });
    let cancelled = false;
    fetch(`/api/features?${params}`)
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        const names = new Set(
          (data.features || [])
            .map((f) => (f.name || '').trim().toLowerCase())
            .filter(Boolean),
        );
        setExistingNamesLower(names);
      })
      .catch(() => {
        if (!cancelled) setExistingNamesLower(new Set());
      });
    return () => {
      cancelled = true;
    };
  }, [productType, scope, combination, combinations.length]);

  const nameErrorsByIndex = useMemo(() => {
    const errors = {};
    const countByLower = {};
    features.forEach((f) => {
      const n = (f.name || '').trim().toLowerCase();
      if (!n) return;
      countByLower[n] = (countByLower[n] || 0) + 1;
    });
    features.forEach((f, i) => {
      const n = (f.name || '').trim().toLowerCase();
      if (!n) return;
      if (countByLower[n] > 1) errors[i] = DUPLICATE_FEATURE_NAME_MSG;
      else if (existingNamesLower.has(n)) errors[i] = DUPLICATE_FEATURE_NAME_MSG;
    });
    return errors;
  }, [features, existingNamesLower]);

  const scopeSectionRef = useRef(null);
  const comboSectionRef = useRef(null);
  const featuresSectionRef = useRef(null);

  useEffect(() => {
    if (productType && scopeSectionRef.current) {
      scopeSectionRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [productType]);

  useEffect(() => {
    if (scope && comboSectionRef.current) {
      comboSectionRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [scope]);

  useEffect(() => {
    if (scope && featuresSectionRef.current) {
      setTimeout(() => {
        featuresSectionRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }, 100);
    }
  }, [combination]);

  const handleFeatureChange = (index, updated) => {
    setFeatures(prev => prev.map((f, i) => (i === index ? updated : f)));
  };

  const addFeature = () => {
    setFeatures(prev => [...prev, emptyFeature()]);
  };

  const removeFeature = (index) => {
    setFeatures(prev => prev.filter((_, i) => i !== index));
  };

  const uploadScreenshots = async (files, featureName) => {
    if (!files || files.length === 0) return [];
    const formData = new FormData();
    formData.append('productType', productType || '');
    formData.append('combination', combination || '');
    if (featureName) formData.append('featureName', featureName);
    files.forEach(f => formData.append('screenshots', f));
    const res = await fetch('/api/screenshots', { method: 'POST', body: formData });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    return data.paths;
  };

  const cancelNewPT = () => {
    setShowNewPT(false);
    setNewPTName('');
  };

  const cancelNewCombo = () => {
    setShowNewCombo(false);
    setNewComboName('');
  };

  const handleCreateProductType = async () => {
    if (!newPTName.trim()) { showToast('Product type name is required.', 'error'); return; }
    setSavingPT(true);
    try {
      const res = await fetch('/api/product-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newPTName.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      await refresh();
      setProductType(newPTName.trim());
      showToast(`Product type "${newPTName.trim()}" created!`);
      cancelNewPT();
    } catch (err) {
      showToast(err.message, 'error');
    }
    setSavingPT(false);
  };

  const handleCreateCombination = async () => {
    if (!newComboName.trim()) { showToast('Combination name is required.', 'error'); return; }
    const config = configs.find(c => c.name === productType);
    if (!config) { showToast('Select a product type first.', 'error'); return; }
    setSavingCombo(true);
    try {
      const res = await fetch(`/api/product-config/${config.id}/combinations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ combination: newComboName.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      await refresh();
      setCombination(newComboName.trim());
      showToast(`Combination "${newComboName.trim()}" created!`);
      cancelNewCombo();
    } catch (err) {
      showToast(err.message, 'error');
    }
    setSavingCombo(false);
  };

  const handleSave = async () => {
    if (!productType) { showToast('Please select a Product Type.', 'error'); return; }
    if (!scope) { showToast('Please select a Scope Status.', 'error'); return; }
    if (combinations.length > 0 && !combination) { showToast('Please select a Combination.', 'error'); return; }

    const validFeatures = features.filter(f => f.name.trim());
    if (validFeatures.length === 0) { showToast('Please add at least one feature with a name.', 'error'); return; }

    if (Object.keys(nameErrorsByIndex).length > 0) {
      showToast(DUPLICATE_FEATURE_NAME_MSG, 'error');
      return;
    }

    setSaving(true);

    try {
      const featuresToSave = [];

      for (const f of validFeatures) {
        let screenshotPaths = [...(f.screenshots || [])];
        if (f._pendingFiles && f._pendingFiles.length > 0) {
          const uploaded = await uploadScreenshots(f._pendingFiles, f.name.trim());
          screenshotPaths = [...screenshotPaths, ...uploaded];
        }

        featuresToSave.push({
          productType,
          scope,
          combination: combination || '',
          name: f.name.trim(),
          description: f.description.trim(),
          family: f.family.trim(),
          screenshots: screenshotPaths,
        });
      }

      const res = await fetch('/api/features/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ features: featuresToSave }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      showToast(`${data.count} feature(s) saved successfully!`);
      resetForm();
      if (onSaved) onSaved();
    } catch (err) {
      showToast('Save failed: ' + err.message, 'error');
    }

    setSaving(false);
  };

  const resetForm = () => {
    setProductType('');
    setScope('');
    setCombination('');
    setFeatures([emptyFeature()]);
    cancelNewPT();
    cancelNewCombo();
  };

  return (
    <div className="scope-form">
      <h2 className="scope-form-title">Add Features</h2>

      {/* Step 1: Product Type */}
      <div className="form-section">
        <div className="form-group">
          <label>Product Type <span className="required">*</span></label>
          <div className="select-with-action">
            <CustomSelect
              value={productType}
              onChange={(e) => { setProductType(e.target.value); setScope(''); setCombination(''); cancelNewPT(); }}
              options={productTypes.map(pt => ({ value: pt, label: pt }))}
              placeholder="-- Select Product Type --"
            />
            {!showNewPT && (
              <button className="btn-create-new" onClick={() => setShowNewPT(true)} title="Create new product type">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                New Product Type
              </button>
            )}
          </div>
        </div>
        {showNewPT && (
          <div className="inline-create-form">
            <input
              type="text"
              value={newPTName}
              onChange={(e) => setNewPTName(e.target.value)}
              placeholder="Enter new product type name"
              onKeyDown={(e) => e.key === 'Enter' && handleCreateProductType()}
              autoFocus
            />
            <button className="btn-create-action" onClick={handleCreateProductType} disabled={savingPT}>
              {savingPT ? 'Creating...' : 'Create'}
            </button>
            <button className="btn-cancel-action" onClick={cancelNewPT}>
              Cancel
            </button>
          </div>
        )}
      </div>

      {/* Step 2: Scope (shown after product type) */}
      {productType && (
        <div className="form-section" ref={scopeSectionRef}>
          <div className="form-group">
            <label>Scope Status <span className="required">*</span></label>
            <CustomSelect
              value={scope}
              onChange={(e) => { setScope(e.target.value); setCombination(''); }}
              options={[
                { value: 'inscope', label: 'In Scope' },
                { value: 'outscope', label: 'Out of Scope' },
              ]}
              placeholder="-- Select Scope --"
            />
          </div>
        </div>
      )}

      {/* Step 3: Combination (shown after scope) */}
      {productType && scope && (
        <div className="form-section" ref={comboSectionRef}>
          <div className="form-group">
            <label>Combination</label>
            <div className="select-with-action">
              <CustomSelect
                value={combination}
                onChange={(e) => { setCombination(e.target.value); cancelNewCombo(); }}
                options={combinations.map(c => ({ value: c, label: c }))}
                placeholder="-- Select Combination --"
              />
              {!showNewCombo && (
                <button className="btn-create-new" onClick={() => setShowNewCombo(true)} title="Create new combination">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                  New Combination
                </button>
              )}
            </div>
          </div>
          {showNewCombo && (
            <div className="inline-create-form">
              <input
                type="text"
                value={newComboName}
                onChange={(e) => setNewComboName(e.target.value)}
                placeholder="Enter new combination name"
                onKeyDown={(e) => e.key === 'Enter' && handleCreateCombination()}
                autoFocus
              />
              <button className="btn-create-action" onClick={handleCreateCombination} disabled={savingCombo}>
                {savingCombo ? 'Creating...' : 'Create'}
              </button>
              <button className="btn-cancel-action" onClick={cancelNewCombo}>
                Cancel
              </button>
            </div>
          )}
        </div>
      )}

      {/* Step 4: Features (shown after scope is selected) */}
      {productType && scope && (
        <div ref={featuresSectionRef}>
          <div className="form-section-header">
            <span className="scope-badge" data-scope={scope}>
              {scope === 'inscope' ? 'In Scope' : 'Out of Scope'}
            </span>
            <span className="product-badge">{productType}</span>
            {combination && <span className="combination-badge">{combination}</span>}
          </div>

          <div className="features-list">
            {features.map((feature, idx) => (
              <FeatureCard
                key={idx}
                feature={feature}
                index={idx}
                onChange={handleFeatureChange}
                onRemove={removeFeature}
                showRemove={features.length > 1}
                nameError={nameErrorsByIndex[idx] || ''}
              />
            ))}
          </div>

          <button type="button" className="btn-add-feature" onClick={addFeature}>
            + Add Another Feature
          </button>

          <div className="form-actions">
            <button
              type="button"
              className="btn-save"
              onClick={handleSave}
              disabled={saving}
            >
              {saving ? 'Saving...' : 'Save All Features'}
            </button>
            <button type="button" className="btn-reset" onClick={resetForm}>
              Reset
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default FeatureScopeForm;
