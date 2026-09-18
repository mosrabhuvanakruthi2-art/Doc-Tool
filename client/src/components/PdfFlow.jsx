import { useEffect, useRef, useState } from 'react';

// Renders a PDF as a vertical stack of page images (like a document), so it
// flows with the page scroll instead of trapping the reader in an iframe with
// its own inner scrollbar. pdf.js is imported lazily so it only loads when a
// PDF is actually viewed.
export default function PdfFlow({ url, downloadUrl }) {
  const containerRef = useRef(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    let pdfDoc = null;
    (async () => {
      setLoading(true);
      setError('');
      try {
        const pdfjs = await import('pdfjs-dist');
        const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
        pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

        const doc = await pdfjs.getDocument({ url }).promise;
        pdfDoc = doc;
        const container = containerRef.current;
        if (cancelled || !container) return;
        container.innerHTML = '';

        const width = Math.min(container.clientWidth || 900, 1000);
        const dpr = Math.min(window.devicePixelRatio || 1, 2);

        for (let i = 1; i <= doc.numPages; i++) {
          if (cancelled) return;
          const page = await doc.getPage(i);
          const base = page.getViewport({ scale: 1 });
          const viewport = page.getViewport({ scale: width / base.width });
          const canvas = document.createElement('canvas');
          canvas.className = 'pdf-flow-page';
          canvas.width = Math.floor(viewport.width * dpr);
          canvas.height = Math.floor(viewport.height * dpr);
          canvas.style.width = '100%';
          canvas.style.height = 'auto';
          const ctx = canvas.getContext('2d');
          ctx.scale(dpr, dpr);
          container.appendChild(canvas);
          await page.render({ canvasContext: ctx, viewport }).promise;
        }
        if (!cancelled) setLoading(false);
      } catch (e) {
        if (!cancelled) { setError(e && e.message ? e.message : 'render failed'); setLoading(false); }
      }
    })();
    return () => { cancelled = true; try { pdfDoc && pdfDoc.destroy(); } catch (_) {} };
  }, [url]);

  return (
    <div className="pdf-flow">
      {loading && <div className="pdf-flow-status">Loading PDF…</div>}
      {error && (
        <div className="pdf-flow-status pdf-flow-error">
          Couldn’t render this PDF inline.{' '}
          {downloadUrl && <a href={downloadUrl} download>Download it</a>} to open it.
        </div>
      )}
      <div ref={containerRef} className="pdf-flow-pages" />
    </div>
  );
}
