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

  // Every tab switch starts clean (its own params only): + Add Feature opens an
  // empty form and ← Back to Features opens plain Features.
  const handleTabChange = (tab) => {
    if (tab === activeTab) return;
    setSearchParams(new URLSearchParams({ tab }));
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
          <div className={`admin-features-bar${activeTab === 'add' ? ' is-back' : ''}`}>
            {activeTab === 'edit' ? (
              <button className="btn-create-new" onClick={() => handleTabChange('add')}>+ Add Feature</button>
            ) : (
              <button className="btn-back" onClick={() => handleTabChange('edit')}>&larr; Back</button>
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
