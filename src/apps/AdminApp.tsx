import React, { useEffect } from 'react';
import { useNavigation } from '../hooks/useNavigation';
import { AdminProtectedRoute } from '../components/auth/AdminProtectedRoute';
import { MainLayout } from '../components/layout/layMainLayout';
import { Dashboard } from '../components/pages/Dashboard';
import { Products } from '../components/pages/Products';
import { Orders } from '../components/pages/Orders';
import { Customers } from '../components/pages/Customers';
import { Accounting } from '../components/pages/Accounting';
import { Settings } from '../components/pages/Settings';
import { B2B } from '../components/pages/B2B';
import { navigationItems } from '../config/navigation';

function AdminApp() {
  const { activeTab, activeSubTab, navigateTo } = useNavigation();

  // Set default sub-tab when tab changes
  useEffect(() => {
    const currentTab = navigationItems.find(item => item.id === activeTab);
    if (currentTab && currentTab.subItems && currentTab.subItems.length > 0) {
      if (!activeSubTab) {
        navigateTo(activeTab, currentTab.subItems[0].id);
      }
    }
  }, [activeTab, activeSubTab, navigateTo]);

  const handleTabChange = (tab: string) => {
    const currentTab = navigationItems.find(item => item.id === tab);
    const defaultSubTab = currentTab?.subItems?.[0]?.id || '';
    navigateTo(tab, defaultSubTab);
  };

  const handleSubTabChange = (subTab: string) => {
    navigateTo(activeTab, subTab);
  };

  const renderContent = () => {
    switch (activeTab) {
      case 'dashboard':
        return <Dashboard activeSubTab={activeSubTab} />;
      case 'products':
        return <Products activeSubTab={activeSubTab} />;
      case 'orders':
        return <Orders activeSubTab={activeSubTab} />;
      case 'customers':
        return <Customers activeSubTab={activeSubTab} />;
      case 'accounting':
        return <Accounting activeSubTab={activeSubTab} />;
      case 'b2b':
        return <B2B activeSubTab={activeSubTab} />;
      case 'analytics':
        return (
          <div className="p-6">
            <div className="bg-white rounded-lg border border-gray-100 shadow-sm p-8 text-center">
              <h3 className="text-lg font-semibold text-gray-900 mb-2">Analytics</h3>
              <p className="text-gray-500">Module en cours de développement</p>
            </div>
          </div>
        );
      case 'settings':
        return <Settings activeSubTab={activeSubTab} />;
      default:
        return <Dashboard activeSubTab={activeSubTab} />;
    }
  };

  return (
    <AdminProtectedRoute>
      <MainLayout
        activeTab={activeTab}
        activeSubTab={activeSubTab}
        onTabChange={handleTabChange}
        onSubTabChange={handleSubTabChange}
      >
        {renderContent()}
      </MainLayout>
    </AdminProtectedRoute>
  );
}

export default AdminApp;
