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
import { X } from 'lucide-react';

// Seule route "réelle" (URL adressable) de l'app revendeur : la fiche
// produit du catalogue B2B. Tout le reste continue de fonctionner par état
// d'onglet (voir useNavigation), sans dépendance à react-router.
const parseProductId = (pathname: string): string | null => {
  const match = pathname.match(/^\/catalogue\/([^/]+)\/?$/);
  return match ? decodeURIComponent(match[1]) : null;
};

function ResellerApp() {
  const { activeTab, activeSubTab, navigateTo } = useNavigation();
  const { profile } = useResellerAuth();
  const cart = useB2BCart(profile?.reseller_id);
  const currentTab = activeTab || 'catalog';

  const [checkoutStatus, setCheckoutStatus] = useState<'success' | 'cancel' | null>(null);
  const [checkoutSessionId, setCheckoutSessionId] = useState<string | null>(null);
  const [cartExpired, setCartExpired] = useState(false);
  const [pathname, setPathname] = useState(window.location.pathname);

  useEffect(() => {
    const onPopState = () => setPathname(window.location.pathname);
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const openProduct = (productId: string) => {
    window.history.pushState({}, '', `/catalogue/${productId}`);
    setPathname(`/catalogue/${productId}`);
  };

  const closeProduct = () => {
    window.history.pushState({}, '', '/');
    setPathname('/');
  };

  const productId = parseProductId(pathname);

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

  const handleCartExpired = () => {
    setCartExpired(true);
    navigateTo('catalog', '');
  };

  const renderContent = () => {
    if (checkoutStatus === 'success') {
      return <CheckoutSuccess sessionId={checkoutSessionId} onGoToOrders={handleGoToOrders} />;
    }

    if (productId) {
      return <ProductPage productId={productId} cart={cart} onBack={closeProduct} />;
    }

    switch (currentTab) {
      case 'cart':
        return <CartPage cart={cart} onBack={() => navigateTo('catalog', '')} onExpired={handleCartExpired} />;
      case 'my-orders':
        return <MyOrders />;
      case 'profile':
        return <ResellerProfile />;
      case 'team':
        return <Team />;
      case 'catalog':
      default:
        return <Catalog onOpenCart={() => navigateTo('cart', '')} onOpenProduct={openProduct} />;
    }
  };

  return (
    <ResellerProtectedRoute>
      <MainLayout
        activeTab={currentTab}
        activeSubTab={activeSubTab}
        onTabChange={(tab) => {
          setCheckoutStatus(null);
          setCartExpired(false);
          if (productId) closeProduct();
          navigateTo(tab, '');
        }}
        onSubTabChange={() => {}}
        navigationItems={navItems}
        renderHeader={(props) => <ResellerHeader {...props} />}
      >
        {checkoutStatus === 'cancel' && (
          <div className="m-4 md:m-6 bg-amber-50 border border-amber-200 rounded-lg p-3 flex items-center justify-between">
            <p className="text-sm text-amber-800">Paiement annulé — votre panier a été conservé.</p>
            <button onClick={() => setCheckoutStatus(null)} className="p-1 text-amber-600 hover:text-amber-800">
              <X className="h-4 w-4" />
            </button>
          </div>
        )}
        {cartExpired && (
          <div className="m-4 md:m-6 bg-amber-50 border border-amber-200 rounded-lg p-3 flex items-center justify-between">
            <p className="text-sm text-amber-800">Votre session de réservation a expiré, vos articles ont été remis en vente.</p>
            <button onClick={() => setCartExpired(false)} className="p-1 text-amber-600 hover:text-amber-800">
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
