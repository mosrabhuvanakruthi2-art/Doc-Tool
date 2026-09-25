import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { AUTH_CHANGED } from './authEvents';

const ProductConfigContext = createContext(null);

// Session tokens whose change means the product config must be re-read.
const TOKEN_KEYS = ['docs_token', 'admin_token'];

export function ProductConfigProvider({ children }) {
  const [productTypes, setProductTypes] = useState([]);
  const [combinationsByProduct, setCombinationsByProduct] = useState({});
  const [featureListUrls, setFeatureListUrls] = useState({});
  const [configs, setConfigs] = useState([]);
  const [loading, setLoading] = useState(true);
  // Each request gets a number; only the newest one may update state. Without
  // this, a slow request sent before sign-in (401 -> empty) could finish after
  // the signed-in request and wipe out the real data.
  const requestSeq = useRef(0);

  const fetchConfig = useCallback(async () => {
    const seq = ++requestSeq.current;
    try {
      const res = await fetch('/api/product-config');
      const data = await res.json();
      if (seq !== requestSeq.current) return; // superseded by a newer request
      setProductTypes(data.productTypes || []);
      setCombinationsByProduct(data.combinationsByProduct || {});
      setFeatureListUrls(data.featureListUrls || {});
      setConfigs(data.configs || []);
    } catch (_) {
      if (seq !== requestSeq.current) return;
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchConfig();

    // Re-read after sign-in / sign-out in this tab…
    const onAuthChanged = () => fetchConfig();
    // …and in any other tab (localStorage is shared across tabs).
    const onStorage = (e) => {
      if (e.key === null || TOKEN_KEYS.includes(e.key)) fetchConfig();
    };

    window.addEventListener(AUTH_CHANGED, onAuthChanged);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener(AUTH_CHANGED, onAuthChanged);
      window.removeEventListener('storage', onStorage);
    };
  }, [fetchConfig]);

  return (
    <ProductConfigContext.Provider value={{
      productTypes,
      combinationsByProduct,
      featureListUrls,
      configs,
      loading,
      refresh: fetchConfig,
    }}>
      {children}
    </ProductConfigContext.Provider>
  );
}

export function useProductConfig() {
  const ctx = useContext(ProductConfigContext);
  if (!ctx) throw new Error('useProductConfig must be used within ProductConfigProvider');
  return ctx;
}
