import { useState, useEffect, useRef } from 'react';
import FeatureCard from './FeatureCard';
import { useProductConfig } from '../ProductConfigContext';
import CustomSelect from './CustomSelect';

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

  const [scope, setScope] = useState('');
  const [productType, setProductType] = useState('');
  const [combination, setCombination] = useState('');
  const [features, setFeatures] = useState([emptyFeature()]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const [showNewPT, setShowNewPT] = useState(false);
  const [newPTName, setNewPTName] = useState('');
  const [savingPT, setSavingPT] = useState(false);

  const [showNewCombo, setShowNewCombo] = useState(false);
  const [newComboName, setNewComboName] = useState('');
  const [savingCombo, setSavingCombo] = useState(false);

  const combinations = productType ? (combinationsByProduct[productType] || []) : [];

  const ptSectionRef = useRef(null);
  const comboSectionRef = useRef(null);
  const featuresSectionRef = useRef(null);

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
    if (productType && featuresSectionRef.current) {
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
    if (!newPTName.trim()) { setError('Product type name is required.'); return; }
    setSavingPT(true);
    setError('');
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
      setSuccess(`Product type "${newPTName.trim()}" created!`);
      cancelNewPT();
    } catch (err) {
      setError(err.message);
    }
    setSavingPT(false);
  };

  const handleCreateCombination = async () => {
    if (!newComboName.trim()) { setError('Combination name is required.'); return; }
    const config = configs.find(c => c.name === productType);
    if (!config) { setError('Select a product type first.'); return; }
    setSavingCombo(true);
    setError('');
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
      setSuccess(`Combination "${newComboName.trim()}" created!`);
      cancelNewCombo();
    } catch (err) {
      setError(err.message);
    }
    setSavingCombo(false);
  };

  const handleSave = async () => {
    setError('');
    setSuccess('');

    if (!scope) { setError('Please select a Scope Status.'); return; }
    if (!productType) { setError('Please select a Product Type.'); return; }
    if (combinations.length > 0 && !combination) { setError('Please select a Combination.'); return; }

    const validFeatures = features.filter(f => f.name.trim());
    if (validFeatures.length === 0) { setError('Please add at least one feature with a name.'); return; }

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

      setSuccess(`${data.count} feature(s) saved successfully!`);
      setFeatures([emptyFeature()]);
      if (onSaved) onSaved();
    } catch (err) {
      setError('Save failed: ' + err.message);
    }

    setSaving(false);
  };

  const resetForm = () => {
    setScope('');
    setProductType('');
    setCombination('');
    setFeatures([emptyFeature()]);
    setError('');
    setSuccess('');
    cancelNewPT();
    cancelNewCombo();
  };

  return (
    <div className="scope-form">
      <h2 className="scope-form-title">Add Features</h2>

      <div className="form-section">
        <div className="form-group">
          <label>Scope Status <span className="required">*</span></label>
          <CustomSelect
            value={scope}
            onChange={(e) => { setScope(e.target.value); setSuccess(''); }}
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
                onChange={(e) => { setProductType(e.target.value); setCombination(''); setSuccess(''); cancelNewPT(); }}
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
      )}

      {scope && productType && (
        <div className="form-section" ref={comboSectionRef}>
          <div className="form-group">
            <label>Combination</label>
            <div className="select-with-action">
              <CustomSelect
                value={combination}
                onChange={(e) => { setCombination(e.target.value); setSuccess(''); cancelNewCombo(); }}
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

      {scope && productType && (
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
              />
            ))}
          </div>

          <button type="button" className="btn-add-feature" onClick={addFeature}>
            + Add Another Feature
          </button>

          {error && <div className="form-error">{error}</div>}
          {success && <div className="form-success">{success}</div>}

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
