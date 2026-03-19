import { useState } from 'react';
import FeatureScopeForm from './FeatureScopeForm';
import EditFeatureTab from './EditFeatureTab';
import CompatibilityAdmin from './CompatibilityAdmin';
import CloudInfoAdmin from './CloudInfoAdmin';
import TrashAdmin from './TrashAdmin';

function AdminPage() {
  const [activeTab, setActiveTab] = useState('add');
  const [refreshKey, setRefreshKey] = useState(0);

  const handleSaved = () => {
    setRefreshKey(prev => prev + 1);
  };

  return (
    <div className="admin-page">
      <div className="admin-container">
        <div className="admin-tabs">
          <button
            className={`admin-tab ${activeTab === 'add' ? 'active' : ''}`}
            onClick={() => setActiveTab('add')}
          >
            Add Feature
          </button>
          <button
            className={`admin-tab ${activeTab === 'edit' ? 'active' : ''}`}
            onClick={() => setActiveTab('edit')}
          >
            Edit Feature
          </button>
          <button
            className={`admin-tab ${activeTab === 'compatibility' ? 'active' : ''}`}
            onClick={() => setActiveTab('compatibility')}
          >
            Compatibility
          </button>
          <button
            className={`admin-tab ${activeTab === 'cloudinfo' ? 'active' : ''}`}
            onClick={() => setActiveTab('cloudinfo')}
          >
            Cloud Info
          </button>
          <button
            className={`admin-tab admin-tab-trash ${activeTab === 'trash' ? 'active' : ''}`}
            onClick={() => setActiveTab('trash')}
          >
            Trash
          </button>
        </div>

        {activeTab === 'add' && (
          <FeatureScopeForm onSaved={handleSaved} />
        )}

        {activeTab === 'edit' && (
          <EditFeatureTab refreshKey={refreshKey} onChanged={handleSaved} />
        )}

        {activeTab === 'compatibility' && (
          <CompatibilityAdmin onChanged={handleSaved} />
        )}

        {activeTab === 'cloudinfo' && (
          <CloudInfoAdmin onChanged={handleSaved} />
        )}

        {activeTab === 'trash' && (
          <TrashAdmin onChanged={handleSaved} />
        )}
      </div>
    </div>
  );
}

export default AdminPage;
