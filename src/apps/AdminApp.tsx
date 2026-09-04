import React, { useEffect, useMemo } from 'react';
import { useNavigation } from '../hooks/useNavigation';
import { AdminProtectedRoute } from '../components/auth/AdminProtectedRoute';
import { MainLayout } from '../components/layout/layMainLayout';
import { Dashboard } from '../components/pages/Dashboard';
import { Products } from '../components/pages/Products';
import { Orders } from '../components/pages/Orders';
import { Customers } from '../components/pages/Customers';
import { Accounting } from '../components/pages/Accounting';
import { B2B } from '../components/pages/B2B';
import { navigationItems as staticNavigationItems } from '../config/navigation';
import { useAdminAuth } from '../hooks/useAdminAuth';
import { usePendingGiftRewardsCount } from '../hooks/useGiftRewards';

function AdminApp() {
  const { activeTab, activeSubTab, navigateTo } = useNavigation();
  const { isAdmin } = useAdminAuth();
  const pendingGiftRewardsCount = usePendingGiftRewardsCount(isAdmin);

  // Injecte dynamiquement le nombre de portefeuilles offerts en attente
  // d'expédition sur le lien "Portefeuilles offerts" — la config statique
  // (config/navigation.ts) ne connaît que la structure du menu, pas les
  // compteurs vivants.
  const navigationItems = useMemo(() => {
    if (!pendingGiftRewardsCount) return staticNavigationItems;
    return staticNavigationItems.map((item) =>
      item.id !== 'b2b'
        ? item
        : {
            ...item,
            subItems: item.subItems?.map((sub) =>
              sub.id === 'gift-rewards' ? { ...sub, badgeCount: pendingGiftRewardsCount } : sub
            ),
          }
    );
  }, [pendingGiftRewardsCount]);

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
        navigationItems={navigationItems}
      >
        {renderContent()}
      </MainLayout>
    </AdminProtectedRoute>
  );
}

export default AdminApp;
