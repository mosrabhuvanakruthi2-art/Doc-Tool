import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import FeatureScopeForm from './FeatureScopeForm';
import EditFeatureTab from './EditFeatureTab';
import CompatibilityAdmin from './CompatibilityAdmin';
import CloudInfoAdmin from './CloudInfoAdmin';
import DocumentsAdmin from './DocumentsAdmin';
import UserAdmin from './UserAdmin';
import TrashAdmin from './TrashAdmin';
import AuditLog from './AuditLog';
import SalesAdmin from './SalesAdmin';

const VALID_TABS = ['add', 'edit', 'compatibility', 'cloudinfo', 'documents', 'sales', 'users', 'audit', 'trash'];

function AdminPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const tabFromUrl = searchParams.get('tab');
  // The URL is the source of truth, so Back/Forward switch tabs and a refresh
  // stays on the same tab. "Features" is one tab: Edit Feature by default, Add
  // Feature from its button (tab=edit / tab=add).
  const activeTab = VALID_TABS.includes(tabFromUrl) ? tabFromUrl : 'edit';
  const [refreshKey, setRefreshKey] = useState(0);
  const isFeatures = activeTab === 'edit' || activeTab === 'add';

  // A new tab starts clean (its own params only). Edit <-> Add keeps the chosen
  // product type / scope / combination so the other view opens on the same one.
  const handleTabChange = (tab) => {
    if (tab === activeTab) return;
    const next = new URLSearchParams({ tab });
    if ((tab === 'edit' || tab === 'add') && isFeatures) {
      ['product', 'scope', 'combination'].forEach((k) => {
        const v = searchParams.get(k);
        if (v) next.set(k, v);
      });
    }
    setSearchParams(next);
  };

  const handleSaved = () => {
    setRefreshKey(prev => prev + 1);
  };

  return (
    <div className="admin-page">
      <div className="admin-container">
        <div className="admin-tabs">
          <button className={`admin-tab ${isFeatures ? 'active' : ''}`} onClick={() => handleTabChange('edit')}>
            Features
          </button>
          <button className={`admin-tab ${activeTab === 'compatibility' ? 'active' : ''}`} onClick={() => handleTabChange('compatibility')}>
            Compatibility
          </button>
          <button className={`admin-tab ${activeTab === 'cloudinfo' ? 'active' : ''}`} onClick={() => handleTabChange('cloudinfo')}>
            Cloud Info
          </button>
          <button className={`admin-tab ${activeTab === 'documents' ? 'active' : ''}`} onClick={() => handleTabChange('documents')}>
            Documents
          </button>
          <button className={`admin-tab ${activeTab === 'sales' ? 'active' : ''}`} onClick={() => handleTabChange('sales')}>
            Sales
          </button>
          <button className={`admin-tab ${activeTab === 'users' ? 'active' : ''}`} onClick={() => handleTabChange('users')}>
            Users
          </button>
          <button className={`admin-tab ${activeTab === 'audit' ? 'active' : ''}`} onClick={() => handleTabChange('audit')}>
            Audit Logs
          </button>
          <button className={`admin-tab admin-tab-trash ${activeTab === 'trash' ? 'active' : ''}`} onClick={() => handleTabChange('trash')}>
            Trash
          </button>
        </div>

        {isFeatures && (
          <div className="admin-features-bar">
            {activeTab === 'edit' ? (
              <button className="btn-create-new" onClick={() => handleTabChange('add')}>+ Add Feature</button>
            ) : (
              <button className="btn-create-new" onClick={() => handleTabChange('edit')}>← Back to Features</button>
            )}
          </div>
        )}
        {activeTab === 'add' && <FeatureScopeForm onSaved={handleSaved} />}
        {activeTab === 'edit' && <EditFeatureTab refreshKey={refreshKey} onChanged={handleSaved} />}
        {activeTab === 'compatibility' && <CompatibilityAdmin onChanged={handleSaved} />}
        {activeTab === 'cloudinfo' && <CloudInfoAdmin onChanged={handleSaved} />}
        {activeTab === 'documents' && <DocumentsAdmin onChanged={handleSaved} />}
        {activeTab === 'sales' && <SalesAdmin />}
        {activeTab === 'users' && <UserAdmin />}
        {activeTab === 'audit' && <AuditLog />}
        {activeTab === 'trash' && <TrashAdmin onChanged={handleSaved} />}
      </div>
    </div>
  );
}

export default AdminPage;
