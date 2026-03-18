import { createContext, useContext, useState, useEffect, useCallback } from 'react';

const ProductConfigContext = createContext(null);

export function ProductConfigProvider({ children }) {
  const [productTypes, setProductTypes] = useState([]);
  const [combinationsByProduct, setCombinationsByProduct] = useState({});
  const [featureListUrls, setFeatureListUrls] = useState({});
  const [configs, setConfigs] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchConfig = useCallback(async () => {
    try {
      const res = await fetch('/api/product-config');
      const data = await res.json();
      setProductTypes(data.productTypes || []);
      setCombinationsByProduct(data.combinationsByProduct || {});
      setFeatureListUrls(data.featureListUrls || {});
      setConfigs(data.configs || []);
    } catch (_) {}
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchConfig();
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
