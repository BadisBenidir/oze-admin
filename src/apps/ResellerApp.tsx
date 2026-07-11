import React from 'react';
import { useNavigation } from '../hooks/useNavigation';
import { ResellerProtectedRoute } from '../components/auth/ResellerProtectedRoute';
import { MainLayout } from '../components/layout/layMainLayout';
import { ResellerHeader } from '../components/layout/resHeader';
import { resellerNavigationItems } from '../config/resellerNavigation';
import { Catalog } from '../components/pages/reseller/Catalog';
import { MyOrders } from '../components/pages/reseller/MyOrders';
import { ResellerProfile } from '../components/pages/reseller/ResellerProfile';

function ResellerApp() {
  const { activeTab, activeSubTab, navigateTo } = useNavigation();
  const currentTab = activeTab || 'catalog';

  const renderContent = () => {
    switch (currentTab) {
      case 'my-orders':
        return <MyOrders />;
      case 'profile':
        return <ResellerProfile />;
      case 'catalog':
      default:
        return <Catalog />;
    }
  };

  return (
    <ResellerProtectedRoute>
      <MainLayout
        activeTab={currentTab}
        activeSubTab={activeSubTab}
        onTabChange={(tab) => navigateTo(tab, '')}
        onSubTabChange={() => {}}
        navigationItems={resellerNavigationItems}
        renderHeader={(props) => <ResellerHeader {...props} />}
      >
        {renderContent()}
      </MainLayout>
    </ResellerProtectedRoute>
  );
}

export default ResellerApp;
