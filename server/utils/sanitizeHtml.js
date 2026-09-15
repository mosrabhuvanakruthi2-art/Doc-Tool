const createDOMPurify = require('isomorphic-dompurify');

// Strips scripts, event handlers and dangerous URLs from stored HTML so a
// document or cloud-info body can never execute in a reader's browser. The
// allowlist matches what the rich-text editor and DOCX/mammoth import produce
// (text, lists, tables, inline base64 images). Idempotent: sanitizing already
// clean HTML returns identical output.
function sanitizeHtml(html) {
  if (typeof html !== 'string' || !html) return '';
  return createDOMPurify.sanitize(html, {
    ALLOWED_TAGS: [
      'p','br','hr','span','div','strong','b','em','i','u','s','strike','sub','sup',
      'h1','h2','h3','h4','h5','h6','blockquote','pre','code',
      'ul','ol','li','a','img','table','thead','tbody','tfoot','tr','th','td','caption','figure','figcaption'],
    ALLOWED_ATTR: ['href','title','alt','src','width','height','colspan','rowspan','style','class','target','rel'],
    ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|tel):|data:image\/(?:png|jpe?g|gif|webp|bmp);base64,|[^a-z]|\/|#)/i,
    ADD_ATTR: ['target'],
    FORBID_TAGS: ['script','style','iframe','object','embed','form','input','svg','math'],
    FORBID_ATTR: ['onerror','onload','onclick','onmouseover'],
  });
}

module.exports = { sanitizeHtml };
