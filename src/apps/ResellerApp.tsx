import React, { useEffect, useState } from 'react';
import { useNavigation } from '../hooks/useNavigation';
import { useResellerAuth } from '../hooks/useResellerAuth';
import { useB2BCart } from '../hooks/useB2BCart';
import { ResellerProtectedRoute } from '../components/auth/ResellerProtectedRoute';
import { MainLayout } from '../components/layout/layMainLayout';
import { ResellerHeader } from '../components/layout/resHeader';
import { resellerNavigationItems, resellerTeamNavItem } from '../config/resellerNavigation';
import { Catalog } from '../components/pages/reseller/Catalog';
import { ProductPage } from '../components/pages/reseller/ProductPage';
import { CartPage } from '../components/pages/reseller/CartPage';
import { MyOrders } from '../components/pages/reseller/MyOrders';
import { ResellerProfile } from '../components/pages/reseller/ResellerProfile';
import { Team } from '../components/pages/reseller/Team';
import { CheckoutSuccess } from '../components/pages/reseller/CheckoutSuccess';
import { ShoppingCart, X } from 'lucide-react';

// Deux routes "réelles" (URL adressables) de l'app revendeur : la fiche
// produit du catalogue B2B et le panier. Tout le reste continue de
// fonctionner par état d'onglet (voir useNavigation), sans dépendance à
// react-router.
const parseProductId = (pathname: string): string | null => {
  const match = pathname.match(/^\/catalogue\/([^/]+)\/?$/);
  return match ? decodeURIComponent(match[1]) : null;
};

function ResellerApp() {
  const { activeTab, activeSubTab, navigateTo } = useNavigation();
  const { profile } = useResellerAuth();
  const cart = useB2BCart(profile?.id);
  const currentTab = activeTab || 'catalog';

  const [checkoutStatus, setCheckoutStatus] = useState<'success' | 'cancel' | null>(null);
  const [checkoutSessionId, setCheckoutSessionId] = useState<string | null>(null);
  const [pathname, setPathname] = useState(window.location.pathname);

  useEffect(() => {
    const onPopState = () => setPathname(window.location.pathname);
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const navigatePath = (path: string) => {
    window.history.pushState({}, '', path);
    setPathname(path);
  };

  const openProduct = (productId: string) => navigatePath(`/catalogue/${productId}`);
  const openCart = () => navigatePath('/panier');
  const closeToRoot = () => navigatePath('/');

  const productId = parseProductId(pathname);
  const isCartRoute = pathname === '/panier' || pathname === '/panier/';

  // Retour depuis Stripe : lu une seule fois au montage, puis l'URL est
  // nettoyée pour ne pas re-déclencher au rafraîchissement de la page.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const status = params.get('b2b_checkout');
    if (status === 'success' || status === 'cancel') {
      setCheckoutStatus(status);
      setCheckoutSessionId(params.get('session_id'));
      window.history.replaceState({}, '', window.location.pathname);

      if (status === 'success') {
        cart.clear();
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const navItems = profile?.is_primary ? [...resellerNavigationItems, resellerTeamNavItem] : resellerNavigationItems;

  const handleGoToOrders = () => {
    setCheckoutStatus(null);
    navigateTo('my-orders', '');
  };

  const renderContent = () => {
    if (checkoutStatus === 'success') {
      return <CheckoutSuccess sessionId={checkoutSessionId} onGoToOrders={handleGoToOrders} />;
    }

    if (productId) {
      return <ProductPage productId={productId} cart={cart} onBack={closeToRoot} />;
    }

    if (isCartRoute) {
      return <CartPage cart={cart} onBack={closeToRoot} />;
    }

    switch (currentTab) {
      case 'my-orders':
        return <MyOrders />;
      case 'profile':
        return <ResellerProfile />;
      case 'team':
        return <Team />;
      case 'catalog':
      default:
        return <Catalog cart={cart} onOpenProduct={openProduct} />;
    }
  };

  const cartBadgeCount = cart.items.length;

  const desktopCartButton = (
    <button
      onClick={openCart}
      className="relative flex items-center space-x-2 px-3 md:px-4 py-2 text-sm font-medium text-gray-300 hover:text-white transition-colors"
    >
      <ShoppingCart className="h-4 w-4" />
      <span className="hidden sm:inline">Panier</span>
      {cartBadgeCount > 0 && (
        <span className="absolute -top-1 -right-1 h-5 w-5 flex items-center justify-center bg-red-600 text-white text-xs rounded-full">
          {cartBadgeCount}
        </span>
      )}
    </button>
  );

  const mobileCartButton = (
    <button
      onClick={openCart}
      className="w-full flex items-center justify-between px-3 py-3 text-sm font-medium rounded-lg text-gray-700 hover:bg-gray-100 transition-colors"
    >
      <span className="flex items-center space-x-3">
        <ShoppingCart className="h-5 w-5" />
        <span>Panier</span>
      </span>
      {cartBadgeCount > 0 && (
        <span className="h-5 w-5 flex items-center justify-center bg-red-600 text-white text-xs rounded-full">
          {cartBadgeCount}
        </span>
      )}
    </button>
  );

  return (
    <ResellerProtectedRoute>
      <MainLayout
        activeTab={currentTab}
        activeSubTab={activeSubTab}
        onTabChange={(tab) => {
          setCheckoutStatus(null);
          if (productId || isCartRoute) closeToRoot();
          navigateTo(tab, '');
        }}
        onSubTabChange={() => {}}
        navigationItems={navItems}
        renderHeader={(props) => <ResellerHeader {...props} />}
        navRightContent={desktopCartButton}
        mobileExtra={mobileCartButton}
      >
        {checkoutStatus === 'cancel' && (
          <div className="m-4 md:m-6 bg-amber-50 border border-amber-200 rounded-lg p-3 flex items-center justify-between">
            <p className="text-sm text-amber-800">Paiement annulé — votre panier a été conservé.</p>
            <button onClick={() => setCheckoutStatus(null)} className="p-1 text-amber-600 hover:text-amber-800">
              <X className="h-4 w-4" />
            </button>
          </div>
        )}
        {renderContent()}
      </MainLayout>
    </ResellerProtectedRoute>
  );
}

export default ResellerApp;
