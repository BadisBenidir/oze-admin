import React from 'react';
import { useNavigation } from '../hooks/useNavigation';
import { useResellerAuth } from '../hooks/useResellerAuth';
import { ResellerProtectedRoute } from '../components/auth/ResellerProtectedRoute';
import { MainLayout } from '../components/layout/layMainLayout';
import { ResellerHeader } from '../components/layout/resHeader';
import { resellerNavigationItems, resellerTeamNavItem } from '../config/resellerNavigation';
import { Catalog } from '../components/pages/reseller/Catalog';
import { MyOrders } from '../components/pages/reseller/MyOrders';
import { ResellerProfile } from '../components/pages/reseller/ResellerProfile';
import { Team } from '../components/pages/reseller/Team';

function ResellerApp() {
  const { activeTab, activeSubTab, navigateTo } = useNavigation();
  const { profile } = useResellerAuth();
  const currentTab = activeTab || 'catalog';

  const navItems = profile?.is_primary ? [...resellerNavigationItems, resellerTeamNavItem] : resellerNavigationItems;

  const renderContent = () => {
    switch (currentTab) {
      case 'my-orders':
        return <MyOrders />;
      case 'profile':
        return <ResellerProfile />;
      case 'team':
        return <Team />;
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
        navigationItems={navItems}
        renderHeader={(props) => <ResellerHeader {...props} />}
      >
        {renderContent()}
      </MainLayout>
    </ResellerProtectedRoute>
  );
}

export default ResellerApp;
