import { useState, useRef } from 'react';
import html2pdf from 'html2pdf.js';
import { Document, Packer, Paragraph, TextRun, HeadingLevel } from 'docx';
import { saveAs } from 'file-saver';
import { useProductConfig } from '../ProductConfigContext';
import CustomSelect from './CustomSelect';

function getExportFilename(productType, combination, ext) {
  const now = new Date();
  const dd = String(now.getDate()).padStart(2, '0');
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const yyyy = now.getFullYear();
  const date = `${dd}-${mm}-${yyyy}`;
  const combo = combination ? '_' + combination.replace(/\s+/g, '') : '';
  return `${productType}${combo}_(${date}).${ext}`;
}

function groupByFamily(features) {
  const grouped = {};
  features.forEach(f => {
    const family = f.family || 'General';
    if (!grouped[family]) grouped[family] = [];
    grouped[family].push(f);
  });
  return grouped;
}

function buildDocxChildren(productType, combination, scopeLabel, features) {
  const grouped = groupByFamily(features);
  const children = [];

  children.push(new Paragraph({ text: 'Migration Feature Documentation', heading: HeadingLevel.TITLE, spacing: { after: 200 } }));
  children.push(new Paragraph({ children: [new TextRun({ text: 'Product Type: ', bold: true }), new TextRun(productType)], spacing: { after: 80 } }));
  if (combination) {
    children.push(new Paragraph({ children: [new TextRun({ text: 'Combination: ', bold: true }), new TextRun(combination)], spacing: { after: 80 } }));
  }
  children.push(new Paragraph({ children: [new TextRun({ text: 'Scope: ', bold: true }), new TextRun(scopeLabel)], spacing: { after: 80 } }));
  children.push(new Paragraph({ children: [new TextRun({ text: 'Total Features: ', bold: true }), new TextRun(String(features.length))], spacing: { after: 400 } }));

  Object.entries(grouped).forEach(([family, items], groupIdx) => {
    children.push(new Paragraph({
      text: `${groupIdx + 1}. ${family} (${items.length} feature${items.length !== 1 ? 's' : ''})`,
      heading: HeadingLevel.HEADING_1,
      spacing: { before: 400, after: 200 },
    }));

    items.forEach((feature, idx) => {
      children.push(new Paragraph({ text: `${groupIdx + 1}.${idx + 1} ${feature.name}`, heading: HeadingLevel.HEADING_2, spacing: { before: 240, after: 100 } }));
      if (feature.description) {
        children.push(new Paragraph({ text: feature.description, spacing: { after: 100 } }));
      }
      if (feature.family) {
        children.push(new Paragraph({ children: [new TextRun({ text: `Family: ${feature.family}`, italics: true, color: '666666', size: 20 })], spacing: { after: 160 } }));
      }
    });
  });

  return children;
}

function ExportPage({ onBack }) {
  const { productTypes, combinationsByProduct } = useProductConfig();
  const [scope, setScope] = useState('');
  const [productType, setProductType] = useState('');
  const [combination, setCombination] = useState('');
  const [downloading, setDownloading] = useState('');
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [previewFeatures, setPreviewFeatures] = useState(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const printRef = useRef(null);

  const combinations = productType ? (combinationsByProduct[productType] || []) : [];
  const ready = scope && productType && (combinations.length === 0 || combination);
  const scopeLabel = scope === 'inscope' ? 'In Scope' : 'Out of Scope';

  const fetchData = async () => {
    const params = new URLSearchParams({ productType, scope });
    if (combination) params.set('combination', combination);
    const res = await fetch(`/api/features?${params}`);
    const data = await res.json();
    return data.features || [];
  };

  const loadPreview = async () => {
    setError('');
    setSuccessMsg('');
    setLoadingPreview(true);
    try {
      const features = await fetchData();
      if (features.length === 0) {
        setError('No features found for the selected filters.');
        setPreviewFeatures(null);
      } else {
        setPreviewFeatures(features);
      }
    } catch (err) {
      setError('Failed to load features: ' + err.message);
    }
    setLoadingPreview(false);
  };

  const resetPreview = () => {
    setPreviewFeatures(null);
    setError('');
    setSuccessMsg('');
  };

  const downloadPDF = async () => {
    setDownloading('pdf');
    setError('');
    setSuccessMsg('');
    try {
      let features = previewFeatures;
      if (!features) {
        features = await fetchData();
        if (features.length === 0) { setError('No features found.'); setDownloading(''); return; }
        setPreviewFeatures(features);
      }

      await new Promise(resolve => setTimeout(resolve, 100));

      const element = printRef.current;
      if (!element) { setError('Could not generate PDF.'); setDownloading(''); return; }

      const filename = getExportFilename(productType, combination, 'pdf');
      await html2pdf().set({
        margin: [10, 10, 10, 10],
        filename,
        image: { type: 'jpeg', quality: 0.95 },
        html2canvas: { scale: 2, useCORS: true, logging: false },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
        pagebreak: { mode: ['avoid-all', 'css', 'legacy'] },
      }).from(element).save();

      setSuccessMsg('PDF downloaded!');
      setTimeout(() => setSuccessMsg(''), 3000);
    } catch (err) {
      setError('PDF download failed: ' + err.message);
    }
    setDownloading('');
  };

  const downloadDOCX = async () => {
    setDownloading('docx');
    setError('');
    setSuccessMsg('');
    try {
      let features = previewFeatures;
      if (!features) {
        features = await fetchData();
        if (features.length === 0) { setError('No features found.'); setDownloading(''); return; }
        setPreviewFeatures(features);
      }

      const children = buildDocxChildren(productType, combination, scopeLabel, features);
      const docFile = new Document({ sections: [{ children }] });
      const blob = await Packer.toBlob(docFile);
      saveAs(blob, getExportFilename(productType, combination, 'docx'));

      setSuccessMsg('DOCX downloaded!');
      setTimeout(() => setSuccessMsg(''), 3000);
    } catch (err) {
      setError('DOCX download failed: ' + err.message);
    }
    setDownloading('');
  };

  const grouped = previewFeatures ? groupByFamily(previewFeatures) : null;

  return (
    <div className="export-page">
      <div className="scope-form">
        <div className="export-page-header">
          <h2 className="scope-form-title" style={{ marginBottom: 0, paddingBottom: 0, borderBottom: 'none' }}>Export Features</h2>
          <button className="btn-back" onClick={onBack}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
            Back
          </button>
        </div>

        <div className="form-section">
          <div className="form-group">
            <label>Scope <span className="required">*</span></label>
            <CustomSelect
              value={scope}
              onChange={(e) => { setScope(e.target.value); resetPreview(); }}
              options={[
                { value: 'inscope', label: 'In Scope' },
                { value: 'outscope', label: 'Out of Scope' },
              ]}
              placeholder="-- Select Scope --"
            />
          </div>
        </div>

        {scope && (
          <div className="form-section">
            <div className="form-group">
              <label>Product Type <span className="required">*</span></label>
              <CustomSelect
                value={productType}
                onChange={(e) => { setProductType(e.target.value); setCombination(''); resetPreview(); }}
                options={productTypes.map(pt => ({ value: pt, label: pt }))}
                placeholder="-- Select Product Type --"
              />
            </div>
          </div>
        )}

        {scope && productType && combinations.length > 0 && (
          <div className="form-section">
            <div className="form-group">
              <label>Combination <span className="required">*</span></label>
              <CustomSelect
                value={combination}
                onChange={(e) => { setCombination(e.target.value); resetPreview(); }}
                options={combinations.map(c => ({ value: c, label: c }))}
                placeholder="-- Select Combination --"
              />
            </div>
          </div>
        )}

        {error && <div className="form-error">{error}</div>}
        {successMsg && <div className="form-success">{successMsg}</div>}

        {ready && (
          <div className="form-actions">
            <button className="btn-save btn-preview" onClick={loadPreview} disabled={loadingPreview || !!downloading}>
              {loadingPreview ? 'Loading...' : 'Load Preview'}
            </button>
            <button className="btn-save btn-pdf" onClick={downloadPDF} disabled={!!downloading}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
              {downloading === 'pdf' ? 'Downloading...' : 'Download PDF'}
            </button>
            <button className="btn-save btn-docx" onClick={downloadDOCX} disabled={!!downloading}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
              {downloading === 'docx' ? 'Downloading...' : 'Download DOCX'}
            </button>
          </div>
        )}
      </div>

      {previewFeatures && (
        <div className="doc-view-paper" ref={printRef} style={{ marginTop: 20 }}>
          <div className="doc-header-section">
            <h1 className="doc-main-title">Migration Feature Documentation</h1>
            <div className="doc-meta">
              <span><strong>Product Type:</strong> {productType}</span>
              {combination && <span><strong>Combination:</strong> {combination}</span>}
              <span><strong>Scope:</strong> {scopeLabel}</span>
              <span><strong>Total Features:</strong> {previewFeatures.length}</span>
            </div>
            <div className="doc-divider" />
          </div>

          {Object.entries(grouped).map(([family, items], groupIdx) => (
            <div key={family} className="doc-section">
              <h2 className="doc-section-title">
                <span className="doc-section-num">{groupIdx + 1}.</span>
                {family}
                <span className="doc-section-count">({items.length} feature{items.length !== 1 ? 's' : ''})</span>
              </h2>

              {items.map((feature, idx) => (
                <div key={feature.id} className="doc-feature">
                  <h3 className="doc-feature-title">
                    {groupIdx + 1}.{idx + 1} {feature.name}
                  </h3>
                  {feature.description && (
                    <p className="doc-feature-desc">{feature.description}</p>
                  )}
                  {feature.screenshots && feature.screenshots.length > 0 && (
                    <div className="doc-feature-screenshots">
                      {feature.screenshots.map((src, sIdx) => (
                        <figure key={sIdx} className="doc-figure">
                          <img src={src} alt={`${feature.name} - Screenshot ${sIdx + 1}`} />
                          <figcaption>Figure {groupIdx + 1}.{idx + 1}.{sIdx + 1}: {feature.name}</figcaption>
                        </figure>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default ExportPage;
