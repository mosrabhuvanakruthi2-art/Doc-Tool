import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';

// URL-backed page state for the admin panel, like the docs site: whatever is
// open (product, combination, the item being edited, filters...) lives in the
// query string, so refresh reopens it, Back/Forward step through it, and a link
// can be shared.
//
//   const [param, setParams] = useUrlParams();
//   param('product')                          -> '' when absent
//   setParams({ product: 'Mail', combination: '' })   // '' / null removes a key
//   setParams({ q: text }, { replace: true })         // no new history entry
//
// Keys not mentioned are kept (e.g. ?tab=). Put every change for one user action
// in a single call: several calls in the same tick do not compose.
export function useUrlParams() {
  const [params, setSearchParams] = useSearchParams();

  const param = useCallback((key) => params.get(key) || '', [params]);

  const setParams = useCallback((updates, { replace = false } = {}) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      Object.entries(updates).forEach(([k, v]) => {
        if (v === '' || v === null || v === undefined || v === false) next.delete(k);
        else next.set(k, String(v));
      });
      return next;
    }, { replace });
  }, [setSearchParams]);

  return [param, setParams, params];
}
