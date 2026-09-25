import DOMPurify from 'dompurify';

// Defense-in-depth sanitization for stored HTML (documents, cloud info) at the
// moment it is rendered. The server already sanitizes on write with DOMPurify,
// so this is a second barrier: if any unsanitized HTML ever reached the client
// (a new write path, a direct DB edit, legacy data), it still cannot execute
// script or steal the session token. Data: image URIs are preserved so DOCX
// conversions keep their embedded images.
export function cleanHtml(html) {
  try {
    return DOMPurify.sanitize(String(html || ''), {
      // Block anything that could run code or exfiltrate; keep normal rich text + images.
      FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'form', 'input', 'link', 'meta', 'base'],
      FORBID_ATTR: ['onerror', 'onload', 'onclick', 'onmouseover', 'onfocus', 'onanimationstart'],
    });
  } catch {
    // If sanitization is unavailable for any reason, fail closed to text-only.
    return String(html || '').replace(/<[^>]*>/g, '');
  }
}
