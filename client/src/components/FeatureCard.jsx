import { useRef, useEffect } from 'react';

function FeatureCard({ feature, index, onChange, onRemove, showRemove, nameError }) {
  const fileInputRef = useRef(null);
  const cardRef = useRef(null);

  const handleFieldChange = (field, value) => {
    onChange(index, { ...feature, [field]: value });
  };

  const addFilesAsScreenshots = (files) => {
    if (!files.length) return;

    const newPreviews = [];
    let loaded = 0;

    files.forEach(file => {
      const reader = new FileReader();
      reader.onload = (ev) => {
        newPreviews.push({ file, preview: ev.target.result });
        loaded++;
        if (loaded === files.length) {
          const existing = feature._pendingFiles || [];
          const existingPreviews = feature._localPreviews || [];
          onChange(index, {
            ...feature,
            _pendingFiles: [...existing, ...files],
            _localPreviews: [...existingPreviews, ...newPreviews.map(p => p.preview)],
          });
        }
      };
      reader.readAsDataURL(file);
    });
  };

  const handleScreenshotSelect = (e) => {
    const files = Array.from(e.target.files);
    if (!files.length) return;
    addFilesAsScreenshots(files);
    e.target.value = '';
  };

  useEffect(() => {
    const card = cardRef.current;
    if (!card) return;

    const handlePaste = (e) => {
      const items = e.clipboardData?.items;
      if (!items) return;

      const imageFiles = [];
      for (const item of items) {
        if (item.type.startsWith('image/')) {
          const file = item.getAsFile();
          if (file) imageFiles.push(file);
        }
      }

      if (imageFiles.length > 0) {
        e.preventDefault();
        addFilesAsScreenshots(imageFiles);
      }
    };

    card.addEventListener('paste', handlePaste);
    return () => card.removeEventListener('paste', handlePaste);
  });

  const removeLocalScreenshot = (idx) => {
    const files = [...(feature._pendingFiles || [])];
    const previews = [...(feature._localPreviews || [])];
    files.splice(idx, 1);
    previews.splice(idx, 1);
    onChange(index, { ...feature, _pendingFiles: files, _localPreviews: previews });
  };

  const removeUploadedScreenshot = (idx) => {
    const screenshots = [...(feature.screenshots || [])];
    screenshots.splice(idx, 1);
    handleFieldChange('screenshots', screenshots);
  };

  const uploadedScreenshots = feature.screenshots || [];
  const localPreviews = feature._localPreviews || [];
  const totalScreenshots = uploadedScreenshots.length + localPreviews.length;

  return (
    <div className="feature-card" ref={cardRef} tabIndex={-1}>
      <div className="feature-card-header">
        <span className="feature-card-number">Feature #{index + 1}</span>
        {showRemove && (
          <button type="button" className="btn-remove-feature" onClick={() => onRemove(index)}>
            &times;
          </button>
        )}
      </div>

      <div className="feature-card-body">
        <div className="form-group">
          <label>Feature Name <span className="required">*</span></label>
          <input
            type="text"
            className={nameError ? 'input-error' : ''}
            placeholder="e.g. One Time Migration"
            value={feature.name || ''}
            onChange={(e) => handleFieldChange('name', e.target.value)}
            required
            aria-invalid={nameError ? 'true' : 'false'}
            aria-describedby={nameError ? `feature-name-error-${index}` : undefined}
          />
          {nameError ? (
            <p id={`feature-name-error-${index}`} className="field-error-text" role="alert">
              {nameError}
            </p>
          ) : null}
        </div>

        <div className="form-group">
          <label>Description</label>
          <textarea
            placeholder="Describe what this feature does..."
            value={feature.description || ''}
            onChange={(e) => handleFieldChange('description', e.target.value)}
            rows={3}
          />
        </div>

        <div className="form-group">
          <label>Family</label>
          <input
            type="text"
            placeholder="e.g. Migration, Channels, Direct Messages"
            value={feature.family || ''}
            onChange={(e) => handleFieldChange('family', e.target.value)}
          />
        </div>

        <div className="form-group">
          <label>Screenshots</label>
          <div className="screenshot-count-label">{totalScreenshots} screenshot{totalScreenshots !== 1 ? 's' : ''} selected</div>
          <div className="screenshot-upload-area">
            {uploadedScreenshots.map((src, idx) => (
              <div key={`uploaded-${idx}`} className="screenshot-thumb">
                <img src={src} alt={`Screenshot ${idx + 1}`} />
                <button
                  type="button"
                  className="btn-remove-thumb"
                  onClick={() => removeUploadedScreenshot(idx)}
                >
                  &times;
                </button>
              </div>
            ))}
            {localPreviews.map((src, idx) => (
              <div key={`local-${idx}`} className="screenshot-thumb">
                <img src={src} alt={`New ${idx + 1}`} />
                <button
                  type="button"
                  className="btn-remove-thumb"
                  onClick={() => removeLocalScreenshot(idx)}
                >
                  &times;
                </button>
              </div>
            ))}
            <label className="screenshot-add-btn">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                onChange={handleScreenshotSelect}
                hidden
              />
              {totalScreenshots > 0 ? '+ Upload More' : '+ Add'}
            </label>
          </div>
          <span className="screenshot-hint">You can also paste images from clipboard (Ctrl+V)</span>
        </div>
      </div>
    </div>
  );
}

export default FeatureCard;
