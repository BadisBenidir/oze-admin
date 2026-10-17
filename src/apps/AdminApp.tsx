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
import { B2BTraffic } from '../components/pages/B2BTraffic';
import { navigationItems as staticNavigationItems } from '../config/navigation';
import { useAdminAuth } from '../hooks/useAdminAuth';
import { usePendingGiftRewardsCount } from '../hooks/useGiftRewards';
import { usePendingEntrupyCount } from '../hooks/useEntrupyCertificates';
import { setForcedHideFigures } from '../hooks/useHideFigures';
import { StaffManagement } from '../components/pages/team/StaffManagement';

function AdminApp() {
  const { isAdmin, isOwner, profile } = useAdminAuth();
  const pendingGiftRewardsCount = usePendingGiftRewardsCount(isAdmin);
  const pendingEntrupyCount = usePendingEntrupyCount(isAdmin);

  // Compte employé (0208) : seulement les pages cochées par le propriétaire ;
  // « Équipe » réservée au propriétaire ; chiffres masqués d'office sans le
  // droit « voir les chiffres ».
  const staffPages = profile?.staff?.pages;
  const profileLoaded = Boolean(profile);
  const visibleItems = useMemo(() => {
    // Profil pas encore chargé : menu complet, pour que la page de l'URL soit
    // reconnue au rechargement (sinon menu vide → retour au Dashboard). Les
    // droits d'un employé s'appliquent dès que son profil est connu.
    if (isOwner || !profileLoaded) return staticNavigationItems;
    if (!staffPages) return [];
    return staticNavigationItems
      .filter((item) => item.id !== 'team')
      .map((item) => ({ ...item, subItems: item.subItems?.filter((sub) => staffPages.includes(`${item.id}:${sub.id}`)) }))
      .filter((item) => (item.subItems?.length ?? 0) > 0);
  }, [isOwner, staffPages, profileLoaded]);
  useEffect(() => {
    setForcedHideFigures({
      costs: Boolean(profile?.staff && !profile.staff.show_figures),
      revenue: Boolean(profile?.staff && !profile.staff.show_revenue),
    });
  }, [profile]);

  // Injecte dynamiquement le nombre de portefeuilles offerts en attente
  // d'expédition et de certificats Entrupy à éditer sur leurs liens
  // respectifs — la config statique (config/navigation.ts) ne connaît que la
  // structure du menu, pas les compteurs vivants.
  const navigationItems = useMemo(() => {
    if (!pendingGiftRewardsCount && !pendingEntrupyCount) return visibleItems;
    return visibleItems.map((item) =>
      item.id !== 'b2b'
        ? item
        : {
            ...item,
            subItems: item.subItems?.map((sub) => {
              if (sub.id === 'gift-rewards' && pendingGiftRewardsCount) return { ...sub, badgeCount: pendingGiftRewardsCount };
              if (sub.id === 'entrupy' && pendingEntrupyCount) return { ...sub, badgeCount: pendingEntrupyCount };
              return sub;
            }),
          }
    );
  }, [visibleItems, pendingGiftRewardsCount, pendingEntrupyCount]);

  const { activeTab, activeSubTab, navigateTo } = useNavigation(navigationItems, navigationItems[0]?.id || 'dashboard');

  // Set default sub-tab when tab changes
  useEffect(() => {
    const currentTab = navigationItems.find(item => item.id === activeTab);
    // Page non autorisée (employé, lien direct) : première page autorisée.
    if (!currentTab) {
      if (navigationItems[0]) navigateTo(navigationItems[0].id, navigationItems[0].subItems?.[0]?.id || '');
      return;
    }
    if (currentTab.subItems && currentTab.subItems.length > 0) {
      if (!activeSubTab || !currentTab.subItems.some((sub) => sub.id === activeSubTab)) {
        navigateTo(activeTab, currentTab.subItems[0].id);
      }
    }
  }, [activeTab, activeSubTab, navigateTo, navigationItems]);

  const handleTabChange = (tab: string) => {
    const currentTab = navigationItems.find(item => item.id === tab);
    const defaultSubTab = currentTab?.subItems?.[0]?.id || '';
    navigateTo(tab, defaultSubTab);
  };

  const handleSubTabChange = (subTab: string) => {
    navigateTo(activeTab, subTab);
  };

  const renderContent = () => {
    if (navigationItems.length === 0) {
      return (
        <div className="p-10 text-center text-sm text-gray-500">
          Aucune page n'est encore attribuée à ton compte. Demande à l'administrateur de t'en ouvrir.
        </div>
      );
    }
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
        return <Accounting />;
      case 'b2b':
        return <B2B activeSubTab={activeSubTab} />;
      case 'b2b-traffic':
        return <B2BTraffic />;
      case 'team':
        return isOwner ? <StaffManagement /> : null;
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
