import React, { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Document, Packer, Paragraph, TextRun, HeadingLevel, ImageRun, BorderStyle as DocBorderStyle } from 'docx';
import { saveAs } from 'file-saver';
import SearchBar from './SearchBar';
import FilterTags from './FilterTags';
import DocumentView from './DocumentView';

function WelcomePage() {
  return (
    <div className="welcome-page">
      <div className="welcome-icon">
        <svg width="80" height="80" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
          <line x1="16" y1="13" x2="8" y2="13" />
          <line x1="16" y1="17" x2="8" y2="17" />
          <polyline points="10 9 9 9 8 9" />
        </svg>
      </div>
      <h1 className="welcome-title">Migration Feature Docs</h1>
      <p className="welcome-subtitle">
        Select a product type and combination from the sidebar to view the supported features and documentation.
      </p>
      <div className="welcome-steps">
        <div className="welcome-step">
          <span className="welcome-step-num">1</span>
          <span>Choose a <strong>Product Type</strong> (Message, Mail, Content)</span>
        </div>
        <div className="welcome-step">
          <span className="welcome-step-num">2</span>
          <span>Select a <strong>Combination</strong> (e.g. Slack to Teams)</span>
        </div>
        <div className="welcome-step">
          <span className="welcome-step-num">3</span>
          <span>View the <strong>Features</strong> with descriptions and screenshots</span>
        </div>
      </div>
    </div>
  );
}

function ScreenshotLightbox({ src, onClose }) {
  const [zoom, setZoom] = useState(1);

  const handleWheel = useCallback((e) => {
    e.preventDefault();
    setZoom(prev => Math.max(0.5, Math.min(4, prev + (e.deltaY > 0 ? -0.15 : 0.15))));
  }, []);

  useEffect(() => {
    const handleKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose]);

  return (
    <div className="lightbox-overlay" onClick={onClose}>
      <div className="lightbox-controls">
        <button onClick={(e) => { e.stopPropagation(); setZoom(z => Math.min(4, z + 0.25)); }} title="Zoom in">+</button>
        <span>{Math.round(zoom * 100)}%</span>
        <button onClick={(e) => { e.stopPropagation(); setZoom(z => Math.max(0.5, z - 0.25)); }} title="Zoom out">&minus;</button>
        <button onClick={onClose} title="Close">&times;</button>
      </div>
      <div className="lightbox-content" onClick={(e) => e.stopPropagation()} onWheel={handleWheel}>
        <img
          src={src}
          alt="Screenshot preview"
          style={{ transform: `scale(${zoom})` }}
          draggable={false}
        />
      </div>
    </div>
  );
}

function getDateStr() {
  const now = new Date();
  const dd = String(now.getDate()).padStart(2, '0');
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const yyyy = now.getFullYear();
  return `${dd}-${mm}-${yyyy}`;
}

function getExportFilename(productType, combination, ext) {
  const combo = combination ? '_' + combination.replace(/\s+/g, '') : '';
  return `${productType}${combo}_(${getDateStr()}).${ext}`;
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

async function fetchImageViaProxy(url) {
  try {
    const proxyUrl = `/api/image-proxy?url=${encodeURIComponent(url)}`;
    const res = await fetch(proxyUrl);
    if (!res.ok) return null;
    const contentType = res.headers.get('content-type') || '';
    const buf = await res.arrayBuffer();
    if (!buf || buf.byteLength === 0) return null;
    let type = 'png';
    if (contentType.includes('jpeg') || contentType.includes('jpg')) type = 'jpg';
    else if (contentType.includes('gif')) type = 'gif';
    else if (contentType.includes('bmp')) type = 'bmp';
    return { data: buf, type };
  } catch {
    return null;
  }
}

function getCacheKey(productType, combination, section, search, activeTag) {
  return `features_cache_${productType}_${combination}_${section}_${search}_${activeTag}`;
}

function FeatureTable() {
  const [searchParams] = useSearchParams();
  const productType = searchParams.get('product') || '';
  const combination = searchParams.get('combination') || '';
  const section = searchParams.get('section') || 'inscope';

  const [features, setFeatures] = useState([]);
  const [tags, setTags] = useState(['All']);
  const [activeTag, setActiveTag] = useState('All');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [expandedRow, setExpandedRow] = useState(null);
  const [isOffline, setIsOffline] = useState(false);
  const [lightboxSrc, setLightboxSrc] = useState(null);
  const [showDocView, setShowDocView] = useState(false);
  const [downloading, setDownloading] = useState('');

  const showWelcome = !productType && !combination;

  useEffect(() => {
    setExpandedRow(null);
    setShowDocView(false);
    setActiveTag('All');
  }, [productType, combination, section]);

  useEffect(() => {
    if (!showWelcome) {
      fetchFeatures();
    }
  }, [productType, combination, section, activeTag, search]);

  const fetchFeatures = async () => {
    setLoading(true);
    const cacheKey = getCacheKey(productType, combination, section, search, activeTag);
    try {
      const params = new URLSearchParams();
      if (productType) params.set('productType', productType);
      if (combination) params.set('combination', combination);
      params.set('scope', section);
      if (search) params.set('search', search);
      if (activeTag !== 'All') params.set('tag', activeTag);

      const res = await fetch(`/api/features?${params.toString()}`);
      const data = await res.json();
      setFeatures(data.features || []);
      setTags(data.tags || ['All']);
      setIsOffline(false);

      try {
        localStorage.setItem(cacheKey, JSON.stringify(data));
      } catch (_) { /* quota exceeded */ }
    } catch (err) {
      console.error('Failed to fetch features:', err);
      const cached = localStorage.getItem(cacheKey);
      if (cached) {
        const data = JSON.parse(cached);
        setFeatures(data.features || []);
        setTags(data.tags || ['All']);
        setIsOffline(true);
      }
    }
    setLoading(false);
  };

  const toggleScreenshots = (featureId) => {
    setExpandedRow(prev => prev === featureId ? null : featureId);
  };

  const downloadDoc = async () => {
    if (features.length === 0) return;
    setDownloading('doc');
    try {
      const grouped = groupByFamily(features);
      const scopeLabel = section === 'inscope' ? 'In Scope' : 'Out of Scope';
      const children = [];

      // Title
      children.push(new Paragraph({
        children: [new TextRun({ text: 'Migration Feature Documentation', bold: true, size: 52, font: 'Calibri' })],
        spacing: { after: 200 },
      }));

      // Metadata row
      const metaParts = [
        new TextRun({ text: 'Product Type: ', bold: true, size: 22, font: 'Calibri' }),
        new TextRun({ text: productType + '    ', size: 22, font: 'Calibri' }),
      ];
      if (combination) {
        metaParts.push(new TextRun({ text: 'Combination: ', bold: true, size: 22, font: 'Calibri' }));
        metaParts.push(new TextRun({ text: combination + '    ', size: 22, font: 'Calibri' }));
      }
      metaParts.push(new TextRun({ text: 'Scope: ', bold: true, size: 22, font: 'Calibri' }));
      metaParts.push(new TextRun({ text: scopeLabel + '    ', size: 22, font: 'Calibri' }));
      metaParts.push(new TextRun({ text: 'Total Features: ', bold: true, size: 22, font: 'Calibri' }));
      metaParts.push(new TextRun({ text: String(features.length), size: 22, font: 'Calibri' }));
      children.push(new Paragraph({ children: metaParts, spacing: { after: 120 } }));

      // Blue divider
      children.push(new Paragraph({
        border: { bottom: { style: DocBorderStyle.SINGLE, size: 6, color: '3366cc' } },
        spacing: { after: 300 },
      }));

      const groupEntries = Object.entries(grouped);
      for (let groupIdx = 0; groupIdx < groupEntries.length; groupIdx++) {
        const [family, items] = groupEntries[groupIdx];

        // Family heading: "1. Onetime (1 feature)"
        children.push(new Paragraph({
          children: [
            new TextRun({ text: `${groupIdx + 1}. ${family} `, bold: true, size: 36, color: '2952a3', font: 'Calibri' }),
            new TextRun({ text: `(${items.length} feature${items.length !== 1 ? 's' : ''})`, size: 26, color: '888888', font: 'Calibri' }),
          ],
          spacing: { before: 360, after: 200 },
        }));

        for (let idx = 0; idx < items.length; idx++) {
          const feature = items[idx];

          // Feature title: "1.1 onetime migration"
          children.push(new Paragraph({
            children: [new TextRun({ text: `${groupIdx + 1}.${idx + 1} ${feature.name}`, bold: true, size: 26, font: 'Calibri' })],
            spacing: { before: 200, after: 80 },
          }));

          // Description
          if (feature.description) {
            children.push(new Paragraph({
              children: [new TextRun({ text: feature.description, size: 22, font: 'Calibri', color: '444444' })],
              spacing: { after: 100 },
            }));
          }

          // Screenshots
          if (feature.screenshots && feature.screenshots.length > 0) {
            for (let sIdx = 0; sIdx < feature.screenshots.length; sIdx++) {
              const imgUrl = feature.screenshots[sIdx];
              const imgResult = await fetchImageViaProxy(imgUrl);
              if (imgResult) {
                children.push(new Paragraph({
                  children: [
                    new ImageRun({
                      data: imgResult.data,
                      type: imgResult.type,
                      transformation: { width: 580, height: 380 },
                    }),
                  ],
                  spacing: { before: 120, after: 40 },
                }));
                children.push(new Paragraph({
                  children: [new TextRun({
                    text: `Figure ${groupIdx + 1}.${idx + 1}.${sIdx + 1}: ${feature.name}`,
                    italics: true, size: 18, color: '999999', font: 'Calibri',
                  })],
                  spacing: { after: 200 },
                }));
              }
            }
          }
        }
      }

      const doc = new Document({ sections: [{ children }] });
      const blob = await Packer.toBlob(doc);
      saveAs(blob, getExportFilename(productType, combination, 'docx'));
    } catch (err) {
      console.error('DOCX download error:', err);
    }
    setDownloading('');
  };

  if (showWelcome) {
    return <WelcomePage />;
  }

  const scopeLabel = combination || productType || '';

  if (showDocView) {
    return (
      <div className="feature-table-container">
        <DocumentView
          features={features}
          productType={productType}
          combination={combination}
          section={section}
          onBack={() => setShowDocView(false)}
        />
      </div>
    );
  }

  return (
    <div className="feature-table-container">
      {isOffline && (
        <div className="offline-banner">
          Server is offline — showing cached data. Changes will sync when the server is back.
        </div>
      )}
      <div className="page-title-row">
        <h1 className="page-title">
          {scopeLabel}
        </h1>
        <div className="page-title-actions">
          {features.length > 0 && (
            <>
              <button className="btn-export-sm" onClick={downloadDoc} disabled={!!downloading} title="Download Document">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
                </svg>
                {downloading === 'doc' ? 'Downloading...' : 'Download Doc'}
              </button>
              <button className="btn-doc-view" onClick={() => setShowDocView(true)}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                  <line x1="16" y1="13" x2="8" y2="13" />
                  <line x1="16" y1="17" x2="8" y2="17" />
                </svg>
                View Document Format
              </button>
            </>
          )}
        </div>
      </div>

      <SearchBar value={search} onChange={setSearch} />
      <FilterTags tags={tags} activeTag={activeTag} onTagClick={setActiveTag} />

      <div className="table-wrapper">
        <table className="feature-table">
          <thead>
            <tr>
              <th className="col-sno">S.No</th>
              <th className="col-name">Name</th>
              <th className="col-description">Description</th>
              <th className="col-screenshots">Screenshots</th>
              <th className="col-family">Family</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan="5" className="table-loading">Loading...</td>
              </tr>
            ) : features.length === 0 ? (
              <tr>
                <td colSpan="5" className="table-empty">
                  No {section === 'inscope' ? 'In Scope' : 'Out of Scope'} features found for {productType}{combination ? ` / ${combination}` : ''}.
                </td>
              </tr>
            ) : (
              features.map((feature, featureIndex) => {
                const hasScreenshots = feature.screenshots && feature.screenshots.length > 0;
                const isExpanded = expandedRow === feature.id;
                return (
                  <React.Fragment key={feature.id}>
                    <tr>
                      <td className="col-sno">{featureIndex + 1}</td>
                      <td className="col-name">
                        <span className="feature-name-link">{feature.name}</span>
                      </td>
                      <td className="col-description">{feature.description}</td>
                      <td className="col-screenshots">
                        {hasScreenshots ? (
                          <button
                            className="screenshot-toggle-btn"
                            onClick={() => toggleScreenshots(feature.id)}
                          >
                            Screenshots
                            <span className={`toggle-icon ${isExpanded ? 'open' : ''}`}>&#9662;</span>
                          </button>
                        ) : (
                          <span className="no-screenshots-text">--</span>
                        )}
                      </td>
                      <td className="col-family">
                        {feature.family && (
                          <span className="family-badge">{feature.family}</span>
                        )}
                      </td>
                    </tr>
                    {isExpanded && hasScreenshots && (
                      <tr className="screenshot-expand-row">
                        <td colSpan="5">
                          <div className="screenshot-expand-content">
                            {feature.screenshots.map((src, idx) => (
                              <div key={idx} className="screenshot-expand-item">
                                <img
                                  src={src}
                                  alt={`Screenshot ${idx + 1}`}
                                  onClick={() => setLightboxSrc(src)}
                                  style={{ cursor: 'pointer' }}
                                />
                              </div>
                            ))}
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {lightboxSrc && (
        <ScreenshotLightbox src={lightboxSrc} onClose={() => setLightboxSrc(null)} />
      )}
    </div>
  );
}

export default FeatureTable;
