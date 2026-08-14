import { useState, useEffect, createContext, useContext } from 'react';
import CfLoader from './CfLoader';

// Lets any image chip, however deeply nested, open itself full screen.
const ZoomContext = createContext(null);

function formatWhen(value) {
  if (!value) return '';
  const date = new Date(value);
  if (isNaN(date.getTime())) return '';
  return date.toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

function formatBytes(bytes) {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

const STAGE_LABEL = { created: 'created', updated: 'updated to', current: 'current' };

// Words, whitespace and punctuation are separate tokens. Splitting on whitespace
// alone glues punctuation to words, so "history." and "history," compare as
// unrelated — which made appending a clause look like the previous word had been
// deleted.
function tokenize(text) {
  return String(text || '').match(/[\wÀ-ɏ']+|\s+|[^\s\wÀ-ɏ']+/g) || [];
}

// Word-level diff so a one-word edit in a long sentence reads as a one-word
// edit, instead of two walls of red and green.
function diffWords(before, after) {
  const a = tokenize(before);
  const b = tokenize(after);
  const n = a.length;
  const m = b.length;

  const table = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      table[i][j] = a[i] === b[j]
        ? table[i + 1][j + 1] + 1
        : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }

  const parts = [];
  const push = (type, text) => {
    if (!text) return;
    const last = parts[parts.length - 1];
    if (last && last.type === type) last.text += text;
    else parts.push({ type, text });
  };

  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { push('same', a[i]); i++; j++; }
    else if (table[i + 1][j] >= table[i][j + 1]) { push('del', a[i++]); }
    else { push('ins', b[j++]); }
  }
  while (i < n) push('del', a[i++]);
  while (j < m) push('ins', b[j++]);
  return parts;
}

function WordDiff({ before, after }) {
  const isEmpty = (v) => !String(v ?? '').trim();
  if (isEmpty(before) && isEmpty(after)) return <div className="diff-block diff-inline"><em>(empty)</em></div>;
  if (isEmpty(before)) return <div className="diff-block diff-ins">{after}</div>;
  if (isEmpty(after)) return <div className="diff-block diff-del">{before}</div>;

  return (
    <div className="diff-block diff-inline">
      {diffWords(before, after).map((part, idx) => {
        if (part.type === 'same') return <span key={idx}>{part.text}</span>;
        return (
          <span key={idx} className={part.type === 'ins' ? 'diff-word-ins' : 'diff-word-del'}>
            {part.text}
          </span>
        );
      })}
    </div>
  );
}

// data: URIs are included for changed images so a removed one is still viewable —
// the document no longer holds it.
function ImageChip({ src, bytes, tone }) {
  const zoom = useContext(ZoomContext);
  const isThumbable = src && /^(https?:|data:image\/|\/)/.test(src);
  const note = tone === 'ins' ? 'added' : tone === 'del' ? 'removed' : '';
  return (
    <div className={`diff-img-chip diff-img-${tone}`}>
      {isThumbable ? (
        <img
          src={src}
          alt=""
          loading="lazy"
          className="diff-img-zoomable"
          title="Click to view full screen"
          onClick={(e) => { e.stopPropagation(); if (zoom) zoom({ src, bytes, note }); }}
        />
      ) : (
        <div className="diff-img-placeholder" title="Image too large to keep a preview of">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><polyline points="21 15 16 10 5 21" />
          </svg>
          <span className="diff-img-nopreview">no preview</span>
        </div>
      )}
      {(note || bytes) && (
        <span className="diff-img-meta">{note}{bytes ? `${note ? ' · ' : ''}${formatBytes(bytes)}` : ''}</span>
      )}
    </div>
  );
}

// A chain step for a plain value: highlight what changed against the step before it.
function ValueStep({ step, previous }) {
  if (!previous) {
    const value = step.value;
    const empty = !String(value ?? '').trim();
    return <div className="diff-block diff-inline">{empty ? <em>(empty)</em> : String(value)}</div>;
  }
  return <WordDiff before={previous.value} after={step.value} />;
}

// Screenshots and simple lists: show the whole list at each step, marking what
// arrived and what dropped out relative to the previous step.
function ListStep({ step, previous, kind }) {
  const current = (step.items || []).map(String);
  const prior = previous ? (previous.items || []).map(String) : null;
  const priorSet = prior ? new Set(prior) : null;
  const currentSet = new Set(current);
  const dropped = prior ? prior.filter(v => !currentSet.has(v)) : [];

  if (!current.length && !dropped.length) {
    return <div className="diff-block diff-inline"><em>(none)</em></div>;
  }

  if (kind === 'images') {
    return (
      <div className="diff-img-row">
        {current.map((src, idx) => (
          <ImageChip key={'c' + idx} src={src} tone={priorSet && !priorSet.has(src) ? 'ins' : 'same'} />
        ))}
        {dropped.map((src, idx) => <ImageChip key={'d' + idx} src={src} tone="del" />)}
      </div>
    );
  }

  return (
    <div className="diff-chip-row">
      {current.map((value, idx) => (
        <span key={'c' + idx} className={`diff-chip ${priorSet && !priorSet.has(value) ? 'diff-chip-ins' : 'diff-chip-same'}`}>{value}</span>
      ))}
      {dropped.map((value, idx) => (
        <span key={'d' + idx} className="diff-chip diff-chip-del">{value}</span>
      ))}
    </div>
  );
}

function CellChange({ cell }) {
  return (
    <div className="diff-cell-line">
      <span className="diff-cell-col">{cell.column || `Column ${cell.index + 1}`}</span>
      <span className="diff-word-del">{cell.from || '(empty)'}</span>
      <span className="diff-arrow">→</span>
      <span className="diff-word-ins">{cell.to || '(empty)'}</span>
    </div>
  );
}

// A compatibility matrix stores its whole table in one field, so a step reports the
// individual cell flips (Yes → No), renamed rows, and rows added or removed.
function RowsStep({ step }) {
  const changed = step.changed || [];
  const renamed = step.renamed || [];
  const added = step.added || [];
  const removed = step.removed || [];

  if (!changed.length && !renamed.length && !added.length && !removed.length) {
    return (
      <div className="diff-block diff-inline">
        {step.summary || (step.stage === 'created'
          ? 'original table — details not recorded'
          : 'table changed')}
      </div>
    );
  }

  return (
    <div className="diff-stack">
      {changed.map((row, idx) => (
        <div key={'c' + idx} className="diff-row-card">
          <div className="diff-row-name">{row.feature}</div>
          {(row.cells || []).map((cell, ci) => <CellChange key={ci} cell={cell} />)}
          {row.descriptionTo !== undefined && (
            <div className="diff-cell-line diff-cell-line-stack">
              <span className="diff-cell-col">Description</span>
              <WordDiff before={row.descriptionFrom} after={row.descriptionTo} />
            </div>
          )}
        </div>
      ))}

      {renamed.map((row, idx) => (
        <div key={'r' + idx} className="diff-row-card">
          <div className="diff-row-name">
            <span className="diff-word-del">{row.from}</span>
            <span className="diff-arrow"> → </span>
            <span className="diff-word-ins">{row.to}</span>
          </div>
          {(row.cells || []).map((cell, ci) => <CellChange key={ci} cell={cell} />)}
        </div>
      ))}

      {!!removed.length && (
        <div className="diff-sub">
          <span className="diff-sub-label">Rows removed</span>
          <div className="diff-chip-row">
            {removed.map((row, idx) => (
              <span key={idx} className="diff-chip diff-chip-del">{row.feature}</span>
            ))}
          </div>
        </div>
      )}

      {!!added.length && (
        <div className="diff-sub">
          <span className="diff-sub-label">Rows added</span>
          <div className="diff-chip-row">
            {added.map((row, idx) => (
              <span key={idx} className="diff-chip diff-chip-ins">{row.feature}</span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// Rich content is too large to store per version, so a step shows what that edit
// did rather than the full value.
function DetailStep({ step }) {
  const blocks = (list, tone) => (list || []).map((block, idx) => (
    block && block.type === 'image'
      ? <ImageChip key={tone + idx} src={block.src} bytes={block.bytes} tone={tone} />
      : <div key={tone + idx} className={`diff-block diff-${tone}`}>{block && (block.text ?? block.feature ?? JSON.stringify(block))}</div>
  ));

  const edited = step.changed || [];
  const hasDetail = edited.length || (step.added || []).length || (step.removed || []).length;
  if (!hasDetail) {
    return (
      <div className="diff-block diff-inline">
        {step.summary || (step.stage === 'created'
          ? 'original content — details not recorded'
          : 'content changed')}
      </div>
    );
  }

  return (
    <div className="diff-stack">
      {edited.map((pair, idx) => (
        pair && pair.from !== undefined
          ? <WordDiff key={'e' + idx} before={pair.from} after={pair.to} />
          : <div key={'e' + idx} className="diff-block diff-inline">{JSON.stringify(pair)}</div>
      ))}
      {blocks(step.removed, 'del')}
      {blocks(step.added, 'ins')}
    </div>
  );
}

function FieldChain({ field }) {
  const literal = field.kind !== 'html' && field.kind !== 'rows';
  const listy = field.kind === 'images' || field.kind === 'list';

  return (
    <div className="chain-field">
      <div className="chain-field-label">{field.label}</div>
      {field.steps.map((step, idx) => {
        const previous = idx > 0 ? field.steps[idx - 1] : null;
        return (
          <div key={idx} className={`chain-step chain-step-${step.stage}`}>
            <div className="chain-stage">
              {STAGE_LABEL[step.stage] || step.stage}
              {step.at && <span className="chain-at">{formatWhen(step.at)}</span>}
              {step.untracked && <span className="chain-at">not recorded</span>}
            </div>
            <div className="chain-body">
              {field.kind === 'rows' && <RowsStep step={step} />}
              {field.kind === 'html' && <DetailStep step={step} />}
              {literal && listy && <ListStep step={step} previous={previous} kind={field.kind} />}
              {literal && !listy && <ValueStep step={step} previous={previous} />}
              {step.truncated && <div className="diff-note-hint">Large change — display trimmed.</div>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function RowHistory({ row, showName }) {
  return (
    <div className="diff-entry">
      {showName && (
        <div className="diff-entry-head">
          <span className="diff-entry-name">{row.name}</span>
          {row.isDeleted && <span className="diff-action diff-action-deleted">removed</span>}
          {row.lastAction === 'created' && !row.isDeleted && (
            <span className="diff-action diff-action-created">new</span>
          )}
        </div>
      )}
      {row.fields.map(field => <FieldChain key={field.field} field={field} />)}
    </div>
  );
}

// Full-screen view of one changed image, opened from a chip.
function ImageZoom({ image, onClose }) {
  return (
    <div className="diff-zoom-overlay" onClick={(e) => { e.stopPropagation(); onClose(); }}>
      <button
        type="button"
        className="diff-zoom-close"
        onClick={(e) => { e.stopPropagation(); onClose(); }}
        aria-label="Close full screen"
      >
        ×
      </button>
      <img
        className="diff-zoom-img"
        src={image.src}
        alt=""
        onClick={(e) => e.stopPropagation()}
      />
      {(image.note || image.bytes) && (
        <div className="diff-zoom-meta" onClick={(e) => e.stopPropagation()}>
          {image.note}{image.bytes ? `${image.note ? ' · ' : ''}${formatBytes(image.bytes)}` : ''}
        </div>
      )}
    </div>
  );
}

// Version history. Pass `scope` for a whole features page (every row on it), or
// entityType + entityId for a single matrix / cloud info page / document.
function RevisionDiffModal({ entityType, entityId, entityName, scope, title, onClose }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [zoomImage, setZoomImage] = useState(null);

  const isScopeMode = !!scope;

  useEffect(() => {
    const handleKey = (e) => {
      if (e.key !== 'Escape') return;
      // Escape backs out of the full-screen image first, not the whole dialog.
      if (zoomImage) { setZoomImage(null); return; }
      onClose();
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose, zoomImage]);

  useEffect(() => {
    let url = '';
    if (isScopeMode) {
      const params = new URLSearchParams();
      if (scope.productType) params.set('productType', scope.productType);
      if (scope.combination) params.set('combination', scope.combination);
      if (scope.section) params.set('scope', scope.section);
      url = `/api/feature-history?${params.toString()}`;
    } else if (entityType && entityId) {
      url = `/api/history/${entityType}/${entityId}`;
    } else {
      setLoading(false);
      return;
    }

    let active = true;
    fetch(url)
      .then(res => res.json())
      .then(data => {
        if (!active) return;
        if (data.error) throw new Error(data.error);
        setRows(data.rows || []);
      })
      .catch(err => { if (active) setError(err.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [isScopeMode, entityType, entityId, scope?.productType, scope?.combination, scope?.section]);

  return (
    <ZoomContext.Provider value={setZoomImage}>
    <div className="diff-overlay" onClick={onClose}>
      <div className="diff-modal" onClick={e => e.stopPropagation()}>
        {zoomImage && <ImageZoom image={zoomImage} onClose={() => setZoomImage(null)} />}
        <div className="diff-modal-header">
          <div>
            <h3 className="diff-modal-title">Version history</h3>
            {(isScopeMode ? title : entityName) && (
              <p className="diff-modal-sub">{isScopeMode ? title : entityName}</p>
            )}
          </div>
          <button className="diff-close" onClick={onClose} aria-label="Close">×</button>
        </div>

        <div className="diff-modal-body">
          {loading && <CfLoader inline />}

          {!loading && error && (
            <div className="diff-note diff-note-error">Could not load history: {error}</div>
          )}

          {!loading && !error && !rows.length && (
            <div className="diff-note">
              Nothing has been recorded here yet.
              <div className="diff-note-hint">
                History starts from the point version tracking was switched on. The next
                create, edit or delete will appear here with its full before and after.
              </div>
            </div>
          )}

          {!loading && !error && rows.map(row => (
            <RowHistory key={row.entityId} row={row} showName={isScopeMode} />
          ))}
        </div>
      </div>
    </div>
    </ZoomContext.Provider>
  );
}

export default RevisionDiffModal;
