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
  // "Features" is one tab: Edit Feature by default, Add Feature from its button.
  // The URL keeps tab=edit / tab=add, so existing links still open the right view.
  const [activeTab, setActiveTab] = useState(VALID_TABS.includes(tabFromUrl) ? tabFromUrl : 'edit');
  const [refreshKey, setRefreshKey] = useState(0);
  const isFeatures = activeTab === 'edit' || activeTab === 'add';

  const handleTabChange = (tab) => {
    setActiveTab(tab);
    setSearchParams({ tab });
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
