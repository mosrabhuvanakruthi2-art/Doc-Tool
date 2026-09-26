import { useEffect, useRef, useState } from 'react';

// In-page dialogs, used instead of the browser's own alert/confirm/prompt boxes
// (which cannot be styled and look out of place).

// Base dialog: dimmed overlay + centred card. Escape and a click on the overlay
// close it unless `dismissable` is false (e.g. while an upload is running).
export function AppDialog({ open, title, children, actions, onClose, dismissable = true, wide = false, tone }) {
  useEffect(() => {
    if (!open || !dismissable) return undefined;
    const onKey = (e) => { if (e.key === 'Escape' && onClose) onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, dismissable, onClose]);

  if (!open) return null;
  return (
    <div className="app-dialog-overlay" onMouseDown={() => { if (dismissable && onClose) onClose(); }}>
      <div
        className={`app-dialog${wide ? ' app-dialog-wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === 'string' ? title : undefined}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {title && <h3 className={`app-dialog-title${tone ? ` is-${tone}` : ''}`}>{title}</h3>}
        <div className="app-dialog-body">{children}</div>
        {actions && <div className="app-dialog-actions">{actions}</div>}
      </div>
    </div>
  );
}

// Ask for a single value (e.g. a link URL). Enter confirms, Escape cancels.
export function PromptDialog({ open, title, label, placeholder, initialValue = '', confirmText = 'OK', onConfirm, onCancel, validate }) {
  const [value, setValue] = useState(initialValue);
  const [error, setError] = useState('');
  const inputRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    setValue(initialValue);
    setError('');
    setTimeout(() => inputRef.current && inputRef.current.focus(), 0);
  }, [open, initialValue]);

  const submit = () => {
    const v = value.trim();
    const problem = validate ? validate(v) : (!v ? 'Please enter a value.' : '');
    if (problem) { setError(problem); return; }
    onConfirm(v);
  };

  return (
    <AppDialog
      open={open}
      title={title}
      onClose={onCancel}
      actions={(
        <>
          <button type="button" className="app-dialog-btn" onClick={onCancel}>Cancel</button>
          <button type="button" className="app-dialog-btn is-primary" onClick={submit}>{confirmText}</button>
        </>
      )}
    >
      {label && <label className="app-dialog-label">{label}</label>}
      <input
        ref={inputRef}
        className={`app-dialog-input${error ? ' has-error' : ''}`}
        value={value}
        placeholder={placeholder}
        onChange={(e) => { setValue(e.target.value); setError(''); }}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } }}
      />
      {error && <p className="app-dialog-error">{error}</p>}
    </AppDialog>
  );
}

const escapeHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// "Insert link" for a contentEditable editor, using PromptDialog instead of the
// browser's prompt(). The selection is saved when the dialog opens (focusing the
// dialog's input would otherwise lose it) and restored before the link is added.
// With text selected it becomes a link; with nothing selected the URL itself is
// inserted as a link.
export function useLinkDialog(editorRef) {
  const [open, setOpen] = useState(false);
  const rangeRef = useRef(null);

  const openLinkDialog = () => {
    const sel = window.getSelection();
    const editor = editorRef.current;
    rangeRef.current = sel && sel.rangeCount && editor && editor.contains(sel.anchorNode)
      ? sel.getRangeAt(0).cloneRange()
      : null;
    setOpen(true);
  };

  const insert = (url) => {
    setOpen(false);
    const editor = editorRef.current;
    if (!editor || !url) return;
    editor.focus();
    const sel = window.getSelection();
    if (rangeRef.current) { sel.removeAllRanges(); sel.addRange(rangeRef.current); }
    if (sel && sel.rangeCount && !sel.getRangeAt(0).collapsed) document.execCommand('createLink', false, url);
    else document.execCommand('insertHTML', false, `<a href="${escapeHtml(url)}">${escapeHtml(url)}</a>`);
  };

  const linkDialog = (
    <PromptDialog
      open={open}
      title="Insert link"
      label="Link address"
      placeholder="https://example.com"
      confirmText="Insert link"
      validate={(v) => (!v ? 'Enter a link address.' : normalizeLinkUrl(v) ? '' : 'Only web (https://) or email (mailto:) links are allowed.')}
      onConfirm={(v) => insert(normalizeLinkUrl(v))}
      onCancel={() => setOpen(false)}
    />
  );

  return { openLinkDialog, linkDialog };
}

// Link URLs: accept "example.com" by adding https://, reject anything that is
// not a web or mail link (e.g. javascript:).
export function normalizeLinkUrl(raw) {
  const v = String(raw || '').trim();
  if (!v) return '';
  if (/^(https?:|mailto:)/i.test(v)) return v;
  if (/^[a-z][a-z0-9+.-]*:/i.test(v)) return ''; // some other scheme: refuse
  return 'https://' + v;
}
