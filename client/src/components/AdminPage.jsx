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

const VALID_TABS = ['add', 'edit', 'compatibility', 'cloudinfo', 'documents', 'users', 'audit', 'trash'];

function AdminPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const tabFromUrl = searchParams.get('tab');
  const [activeTab, setActiveTab] = useState(VALID_TABS.includes(tabFromUrl) ? tabFromUrl : 'add');
  const [refreshKey, setRefreshKey] = useState(0);

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
          <button className={`admin-tab ${activeTab === 'add' ? 'active' : ''}`} onClick={() => handleTabChange('add')}>
            Add Feature
          </button>
          <button className={`admin-tab ${activeTab === 'edit' ? 'active' : ''}`} onClick={() => handleTabChange('edit')}>
            Edit Feature
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

        {activeTab === 'add' && <FeatureScopeForm onSaved={handleSaved} />}
        {activeTab === 'edit' && <EditFeatureTab refreshKey={refreshKey} onChanged={handleSaved} />}
        {activeTab === 'compatibility' && <CompatibilityAdmin onChanged={handleSaved} />}
        {activeTab === 'cloudinfo' && <CloudInfoAdmin onChanged={handleSaved} />}
        {activeTab === 'documents' && <DocumentsAdmin onChanged={handleSaved} />}
        {activeTab === 'users' && <UserAdmin />}
        {activeTab === 'audit' && <AuditLog />}
        {activeTab === 'trash' && <TrashAdmin onChanged={handleSaved} />}
      </div>
    </div>
  );
}

export default AdminPage;
