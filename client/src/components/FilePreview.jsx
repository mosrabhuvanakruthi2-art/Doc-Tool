import PdfFlow from './PdfFlow';

// One place that decides how any uploaded file is previewed, so the staged
// upload, the admin edit view and the reader page all behave identically.
//
// The browser can render these categories inline; everything else (office
// binaries like xlsx/pptx, archives, etc.) has no in-browser viewer and falls
// back to a clean download card.

export const IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'avif', 'ico', 'apng', 'jfif'];
export const VIDEO_EXTS = ['mp4', 'webm', 'ogv', 'mov', 'm4v', 'mpeg', 'mpg'];
export const AUDIO_EXTS = ['mp3', 'wav', 'm4a', 'ogg', 'oga', 'opus', 'aac', 'flac', 'weba'];
// Note: csv/tsv are spreadsheets (grid editor), so they are NOT text here.
export const TEXT_EXTS = ['txt', 'log', 'md', 'markdown', 'json', 'xml', 'yaml', 'yml', 'ini', 'sql', 'sh', 'ps1', 'html', 'htm'];

// What kind of viewer a file extension maps to.
export function previewKindOf(ext) {
  const e = String(ext || '').toLowerCase().replace(/^\./, '');
  if (e === 'pdf') return 'pdf';
  if (IMAGE_EXTS.includes(e)) return 'image';
  if (VIDEO_EXTS.includes(e)) return 'video';
  if (AUDIO_EXTS.includes(e)) return 'audio';
  if (TEXT_EXTS.includes(e)) return 'text';
  return 'other';
}

// True when the browser can show this file without downloading it.
export function canPreviewInline(ext) {
  return previewKindOf(ext) !== 'other';
}

// Renders the inline preview for a file.
//   src         - URL to view (blob: for a staged file, or fileUrl+?inline=1)
//   ext         - file extension / fileType (drives the viewer choice)
//   name        - display name
//   downloadUrl - optional; when set, a Download link is shown in the header bar
export default function FilePreview({ src, ext, name, downloadUrl, hideBar }) {
  const kind = previewKindOf(ext);
  return (
    <div className="doc-staged-preview">
      {!hideBar && (
        <div className="doc-staged-preview-bar">
          <span className="doc-preview-name">{name}</span>
          {downloadUrl && (
            <a href={downloadUrl} download className="btn-edit-sm doc-preview-download">Download</a>
          )}
        </div>
      )}
      {kind === 'pdf' ? (
        <PdfFlow url={src} downloadUrl={downloadUrl} />
      ) : kind === 'image' ? (
        <img src={src} alt={name} className="doc-media-image" />
      ) : kind === 'video' ? (
        <video src={src} controls className="doc-media-video" />
      ) : kind === 'audio' ? (
        <audio src={src} controls className="doc-media-audio" />
      ) : kind === 'text' ? (
        <iframe src={src} title={name} className="doc-pdf-frame doc-text-frame" />
      ) : (
        <div className="doc-file-only">
          <p>This is a <strong>{(String(ext || 'file')).toUpperCase()}</strong> file. Your browser can’t preview it inline.</p>
          {downloadUrl && <a href={downloadUrl} download className="btn-save">Download {String(ext || 'File').toUpperCase()}</a>}
        </div>
      )}
    </div>
  );
}
