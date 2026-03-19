import { useState, useEffect } from 'react';

function CloudInfoPage({ slug }) {
  const [item, setItem] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!slug) return;
    setLoading(true);
    setError('');
    fetch(`/api/cloud-info/${slug}`)
      .then(res => res.json())
      .then(data => {
        if (data.error) throw new Error(data.error);
        setItem(data.item);
      })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, [slug]);

  if (loading) {
    return <div className="cloud-info-page"><p>Loading...</p></div>;
  }

  if (error) {
    return <div className="cloud-info-page"><p className="error-msg">{error}</p></div>;
  }

  if (!item) {
    return <div className="cloud-info-page"><p>Select a Cloud Info item from the sidebar.</p></div>;
  }

  return (
    <div className="cloud-info-page">
      <h2 className="cloud-info-page-title">{item.name}</h2>
      <div
        className="cloud-info-page-content"
        dangerouslySetInnerHTML={{ __html: item.content || '<em>No content available.</em>' }}
      />
    </div>
  );
}

export default CloudInfoPage;
