import { useState } from 'react';
import { AppDialog } from './AppDialog';

// Upload window opened by the Upload Folder / Upload Files buttons: one drop line.
// mode 'folder': drop a folder, or browse opens the folder picker.
// mode 'files':  drop files, or browse opens the multi-file picker.
// Either way the next step is our "Upload into" window with the Upload button.
export function UploadDialog({ mode, onClose, onDropData, onBrowse }) {
  const [over, setOver] = useState(false);
  const isFiles = (e) => Array.from((e.dataTransfer && e.dataTransfer.types) || []).includes('Files');
  const what = mode === 'files' ? 'files' : 'folder';
  return (
    <AppDialog open={!!mode} onClose={onClose} wide showClose>
      <div
        className={`doc-dropzone upload-folder-zone${over ? ' doc-dropzone-over' : ''}`}
        onDragEnter={(e) => { if (isFiles(e)) { e.preventDefault(); e.stopPropagation(); setOver(true); } }}
        onDragOver={(e) => { if (isFiles(e)) { e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = 'copy'; if (!over) setOver(true); } }}
        onDragLeave={(e) => { e.stopPropagation(); if (!e.currentTarget.contains(e.relatedTarget)) setOver(false); }}
        onDrop={(e) => { if (!isFiles(e)) return; e.preventDefault(); e.stopPropagation(); setOver(false); onDropData(e.dataTransfer); }}
        onClick={onBrowse}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onBrowse(); } }}
      >
        <svg className="doc-dropzone-icon" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" /></svg>
        <div className="doc-dropzone-text">
          <strong>{over ? 'Drop to upload' : 'Drag & drop'}</strong> {what} here, or <span className="doc-dropzone-link">browse</span>
        </div>
      </div>
    </AppDialog>
  );
}

// Progress window for importing a folder into Documents.
//
// job = {
//   stage: 'confirm' | 'running' | 'done',
//   rootLabel: 'RFI, RFQ & Security Assessments',
//   items: [{ path, status: 'waiting'|'uploading'|'done'|'skipped'|'failed', error }],
//   unsupported: 2,          // system files left out (e.g. .DS_Store)
//   ignoredLoose: 0,         // single files dropped next to a folder (not imported)
//   stopped: false,
// }

const STATUS_LABEL = {
  waiting: 'Waiting',
  uploading: 'Uploading…',
  done: 'Uploaded',
  skipped: 'Already exists',
  failed: 'Failed',
};

function counts(items) {
  const c = { waiting: 0, uploading: 0, done: 0, skipped: 0, failed: 0 };
  items.forEach((it) => { c[it.status] = (c[it.status] || 0) + 1; });
  return c;
}

export default function FolderImportDialog({ job, onStart, onCancel, onStop, onClose, folderOptions = [], onDestination }) {
  if (!job) return null;
  const total = job.items.length;
  const c = counts(job.items);
  const finished = c.done + c.skipped + c.failed;
  const pct = total ? Math.round((finished / total) * 100) : 0;
  const current = job.items.find((it) => it.status === 'uploading');
  const folderCount = new Set(job.items.map((it) => it.path.split('/').slice(0, -1).join('/')).filter(Boolean)).size;

  // ---------- 1. confirm: our only confirmation (no browser box) ----------
  if (job.stage === 'confirm') {
    return (
      <AppDialog
        open
        title="Upload into Documents?"
        onClose={onCancel}
        wide
        actions={(
          <>
            <button type="button" className="app-dialog-btn" onClick={onCancel}>Cancel</button>
            <button type="button" className="app-dialog-btn is-primary" onClick={onStart}>
              Upload {total} file{total !== 1 ? 's' : ''}
            </button>
          </>
        )}
      >
        <label className="app-dialog-label" htmlFor="import-destination">Upload into</label>
        <select
          id="import-destination"
          className="app-dialog-input"
          value={job.destinationId || ''}
          onChange={(e) => onDestination && onDestination(e.target.value)}
        >
          <option value="">Top level</option>
          {folderOptions.map((o) => (
            <option key={o.id} value={o.id}>{'  '.repeat(o.depth) + (o.depth ? '└ ' : '') + o.name}</option>
          ))}
        </select>
        <p className="app-dialog-text">
          <strong>{total}</strong> file{total !== 1 ? 's' : ''}{folderCount ? <> from <strong>“{job.rootLabel}”</strong></> : ''}
          {folderCount > 1 ? ` in ${folderCount} folders` : ''} will be uploaded{folderCount ? ', keeping the same folder structure' : ''}.
          Files whose name already exists in the same folder are skipped.
        </p>
        <ul className="import-list import-list-preview">
          {job.items.slice(0, 8).map((it) => <li key={it.path} className="import-row"><span className="import-path">{it.path}</span></li>)}
          {total > 8 && <li className="import-more">and {total - 8} more…</li>}
        </ul>
        {(job.unsupported > 0 || job.ignoredLoose > 0) && (
          <p className="app-dialog-note">
            {job.unsupported > 0 && `${job.unsupported} system file${job.unsupported !== 1 ? 's' : ''} (like .DS_Store) will be left out. `}
            {job.ignoredLoose > 0 && `${job.ignoredLoose} single file${job.ignoredLoose !== 1 ? 's' : ''} dropped outside a folder will be ignored — add those with “+ Document”.`}
          </p>
        )}
      </AppDialog>
    );
  }

  // ---------- 2. running / 3. done ----------
  const running = job.stage === 'running';
  const title = running
    ? `Uploading ${total} file${total !== 1 ? 's' : ''}…`
    : job.stopped ? 'Import stopped' : (c.failed ? 'Import finished with errors' : 'Import complete');
  const tone = running ? undefined : (c.failed ? 'warn' : 'good');
  // Failures first once finished, so errors are the first thing you see.
  const rows = running ? job.items : [...job.items].sort((a, b) => (a.status === 'failed' ? -1 : 0) - (b.status === 'failed' ? -1 : 0));

  return (
    <AppDialog
      open
      title={title}
      tone={tone}
      wide
      dismissable={!running}
      onClose={onClose}
      actions={running ? (
        <button type="button" className="app-dialog-btn" onClick={onStop} disabled={job.stopped}>
          {job.stopped ? 'Stopping after this file…' : 'Stop'}
        </button>
      ) : (
        <button type="button" className="app-dialog-btn is-primary" onClick={onClose}>Close</button>
      )}
    >
      <p className="app-dialog-text">From <strong>“{job.rootLabel}”</strong></p>

      <div className="import-progress" aria-label={`${pct}% done`}>
        <div className={`import-progress-bar${running ? '' : c.failed ? ' is-warn' : ' is-good'}`} style={{ width: `${pct}%` }} />
      </div>
      <div className="import-progress-meta">
        <span>{finished} of {total} · {pct}%</span>
        {running && current && <span className="import-current" title={current.path}>{current.path}</span>}
      </div>

      <div className="import-chips">
        <span className="import-chip is-done">{c.done} uploaded</span>
        {c.skipped > 0 && <span className="import-chip is-skipped">{c.skipped} already existed</span>}
        {c.failed > 0 && <span className="import-chip is-failed">{c.failed} failed</span>}
        {running && c.waiting > 0 && <span className="import-chip">{c.waiting} waiting</span>}
        {!running && job.stopped && c.waiting > 0 && <span className="import-chip">{c.waiting} not uploaded (stopped)</span>}
      </div>

      <ul className="import-list">
        {rows.map((it) => (
          <li key={it.path} className={`import-row is-${it.status}`}>
            <span className="import-path" title={it.path}>{it.path}</span>
            <span className={`import-status is-${it.status}`}>{STATUS_LABEL[it.status]}</span>
            {it.status === 'failed' && it.error && <span className="import-error">{it.error}</span>}
          </li>
        ))}
      </ul>
    </AppDialog>
  );
}
