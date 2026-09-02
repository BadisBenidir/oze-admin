import React, { useEffect, useState } from 'react';
import { useNavigation } from '../hooks/useNavigation';
import { useResellerAuth } from '../hooks/useResellerAuth';
import { useB2BCart } from '../hooks/useB2BCart';
import { useWallet } from '../hooks/useWallet';
import { ResellerProtectedRoute } from '../components/auth/ResellerProtectedRoute';
import { MainLayout } from '../components/layout/layMainLayout';
import { ResellerHeader } from '../components/layout/resHeader';
import { resellerNavigationItems, resellerTeamNavItem } from '../config/resellerNavigation';
import { Catalog } from '../components/pages/reseller/Catalog';
import { ProductPage } from '../components/pages/reseller/ProductPage';
import { CartPage } from '../components/pages/reseller/CartPage';
import { MyOrders } from '../components/pages/reseller/MyOrders';
import { MyShipments } from '../components/pages/reseller/MyShipments';
import { ResellerProfile } from '../components/pages/reseller/ResellerProfile';
import { Team } from '../components/pages/reseller/Team';
import { WalletPage } from '../components/pages/reseller/WalletPage';
import { CheckoutSuccess } from '../components/pages/reseller/CheckoutSuccess';
import { CartBlockingModal } from '../components/pages/reseller/CartBlockingModal';
import { ShoppingCart, Wallet, X } from 'lucide-react';

// Deux routes "réelles" (URL adressables) de l'app revendeur : la fiche
// produit du catalogue B2B et le panier. Tout le reste continue de
// fonctionner par état d'onglet (voir useNavigation), sans dépendance à
// react-router.
const parseProductId = (pathname: string): string | null => {
  const match = pathname.match(/^\/catalogue\/([^/]+)\/?$/);
  return match ? decodeURIComponent(match[1]) : null;
};

// Onglet du navigateur : index.html est partagé avec AdminApp (même build,
// séparation par rôle), donc son <title> statique ne peut pas porter la
// marque B2B sans aussi changer celui de l'admin — on le pilote ici en JS,
// uniquement pour cette app.
const TAB_TITLES: Record<string, string> = {
  catalog: 'Catalogue B2B | OZË Paris',
  'my-orders': 'Mes Commandes | OZË Paris',
  shipments: 'Suivi livraisons | OZË Paris',
  wallet: 'Mon Portefeuille | OZË Paris',
  profile: 'Mon Profil | OZË Paris',
};
const DEFAULT_TITLE = 'Portail B2B | OZË Paris';
const DEFAULT_DESCRIPTION = 'Espace professionnel exclusif OZË Paris - Maroquinerie de luxe de seconde main.';

function ResellerApp() {
  const { activeTab, activeSubTab, navigateTo } = useNavigation();
  const { profile } = useResellerAuth();
  const cart = useB2BCart(profile?.id);
  const wallet = useWallet(profile?.id);
  const currentTab = activeTab || 'catalog';

  const [checkoutStatus, setCheckoutStatus] = useState<'success' | 'cancel' | null>(null);
  const [checkoutSessionId, setCheckoutSessionId] = useState<string | null>(null);
  const [checkoutOrderId, setCheckoutOrderId] = useState<string | null>(null);
  const [topUpStatus, setTopUpStatus] = useState<'success' | 'cancel' | null>(null);
  const [deliveryRequestStatus, setDeliveryRequestStatus] = useState<'success' | 'cancel' | null>(null);
  const [entrupyRequestStatus, setEntrupyRequestStatus] = useState<'success' | 'cancel' | null>(null);
  const [pathname, setPathname] = useState(window.location.pathname);
  // Retour Stripe = rechargement COMPLET de la page : à ce tout premier
  // montage, `profile` (donc `cart`'s cartKey, dérivé de profile.id) n'est
  // pas encore chargé. Appeler cart.clear() tout de suite ne fait rien sur
  // localStorage (cartKey encore null, voir useB2BCart.write) — le panier
  // "fantôme" était ensuite rechargé depuis localStorage dès que profile
  // arrivait. On mémorise donc juste l'intention, et on vide réellement le
  // panier seulement une fois profile.id connu (voir l'effet plus bas).
  const [pendingCartClear, setPendingCartClear] = useState(false);

  useEffect(() => {
    const onPopState = () => setPathname(window.location.pathname);
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  // Description : posée une seule fois (pas de variante par page demandée).
  useEffect(() => {
    let meta = document.querySelector('meta[name="description"]');
    if (!meta) {
      meta = document.createElement('meta');
      meta.setAttribute('name', 'description');
      document.head.appendChild(meta);
    }
    meta.setAttribute('content', DEFAULT_DESCRIPTION);
  }, []);

  // Titre de l'onglet : reflète la page active du portail revendeur.
  useEffect(() => {
    document.title = TAB_TITLES[currentTab] || DEFAULT_TITLE;
  }, [currentTab]);

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
        setPendingCartClear(true);
      }
    }

    const topUp = params.get('wallet_topup');
    if (topUp === 'success' || topUp === 'cancel') {
      setTopUpStatus(topUp);
      window.history.replaceState({}, '', window.location.pathname);
      if (topUp === 'success') {
        wallet.refresh();
      }
    }

    const delivery = params.get('b2b_delivery');
    if (delivery === 'success' || delivery === 'cancel') {
      setDeliveryRequestStatus(delivery);
      window.history.replaceState({}, '', window.location.pathname);
    }

    const entrupy = params.get('b2b_entrupy');
    if (entrupy === 'success' || entrupy === 'cancel') {
      setEntrupyRequestStatus(entrupy);
      window.history.replaceState({}, '', window.location.pathname);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Vide réellement le panier une fois profile.id (donc le cartKey correct)
  // disponible — voir le commentaire sur pendingCartClear plus haut.
  useEffect(() => {
    if (!pendingCartClear || !profile?.id) return;
    cart.clear();
    setPendingCartClear(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingCartClear, profile?.id]);

  // Paiement par solde : pas de redirection Stripe, la commande est créée
  // et confirmée immédiatement côté serveur — on affiche donc le même écran
  // de succès que pour Stripe, mais via un orderId direct plutôt qu'un
  // stripe_session_id (aucun webhook à attendre).
  const handleWalletCheckoutSuccess = (orderId: string) => {
    cart.clear();
    wallet.refresh();
    setCheckoutSessionId(null);
    setCheckoutOrderId(orderId);
    setCheckoutStatus('success');
  };

  const navItems = profile?.is_primary ? [...resellerNavigationItems, resellerTeamNavItem] : resellerNavigationItems;

  const handleGoToOrders = () => {
    setCheckoutStatus(null);
    navigateTo('my-orders', '');
  };

  const renderContent = () => {
    if (checkoutStatus === 'success') {
      return <CheckoutSuccess sessionId={checkoutSessionId} orderId={checkoutOrderId} onGoToOrders={handleGoToOrders} />;
    }

    if (productId) {
      return <ProductPage productId={productId} cart={cart} onBack={closeToRoot} />;
    }

    if (isCartRoute) {
      return <CartPage cart={cart} onBack={closeToRoot} wallet={wallet} onWalletPaymentSuccess={handleWalletCheckoutSuccess} />;
    }

    switch (currentTab) {
      case 'my-orders':
        return <MyOrders onOpenProduct={openProduct} onWalletChanged={wallet.refresh} />;
      case 'shipments':
        return <MyShipments />;
      case 'profile':
        return <ResellerProfile />;
      case 'team':
        return <Team onOpenProduct={openProduct} />;
      case 'wallet':
        return <WalletPage />;
      case 'catalog':
      default:
        return <Catalog cart={cart} onOpenProduct={openProduct} />;
    }
  };

  const cartBadgeCount = cart.items.length;

  const walletBadge = (
    <button
      onClick={() => { setCheckoutStatus(null); navigateTo('wallet', ''); }}
      className="flex items-center space-x-1.5 px-2.5 py-1 rounded-full bg-white/10 text-gray-200 hover:bg-white/20 hover:text-white transition-colors text-xs font-medium"
      title="Mon Portefeuille"
    >
      <Wallet className="h-3.5 w-3.5" />
      <span className="tabular-nums">
        Solde : {wallet.balance.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €
      </span>
    </button>
  );

  const desktopCartButton = (
    <div className="flex items-center space-x-2 md:space-x-3">
      {walletBadge}
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
    </div>
  );

  const mobileCartButton = (
    <div className="space-y-1">
      <button
        onClick={() => { setCheckoutStatus(null); navigateTo('wallet', ''); }}
        className="w-full flex items-center justify-between px-3 py-3 text-sm font-medium rounded-lg text-gray-700 hover:bg-gray-100 transition-colors"
      >
        <span className="flex items-center space-x-3">
          <Wallet className="h-5 w-5" />
          <span>Mon Portefeuille</span>
        </span>
        <span className="tabular-nums text-gray-500">
          {wallet.balance.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €
        </span>
      </button>
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
    </div>
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
        {topUpStatus === 'success' && (
          <div className="m-4 md:m-6 bg-green-50 border border-green-200 rounded-lg p-3 flex items-center justify-between">
            <p className="text-sm text-green-800">Recharge effectuée avec succès — votre solde a été mis à jour.</p>
            <button onClick={() => setTopUpStatus(null)} className="p-1 text-green-600 hover:text-green-800">
              <X className="h-4 w-4" />
            </button>
          </div>
        )}
        {topUpStatus === 'cancel' && (
          <div className="m-4 md:m-6 bg-amber-50 border border-amber-200 rounded-lg p-3 flex items-center justify-between">
            <p className="text-sm text-amber-800">Recharge annulée.</p>
            <button onClick={() => setTopUpStatus(null)} className="p-1 text-amber-600 hover:text-amber-800">
              <X className="h-4 w-4" />
            </button>
          </div>
        )}
        {deliveryRequestStatus === 'success' && (
          <div className="m-4 md:m-6 bg-green-50 border border-green-200 rounded-lg p-3 flex items-center justify-between">
            <p className="text-sm text-green-800">Paiement confirmé — votre demande de livraison a bien été prise en compte.</p>
            <button onClick={() => setDeliveryRequestStatus(null)} className="p-1 text-green-600 hover:text-green-800">
              <X className="h-4 w-4" />
            </button>
          </div>
        )}
        {deliveryRequestStatus === 'cancel' && (
          <div className="m-4 md:m-6 bg-amber-50 border border-amber-200 rounded-lg p-3 flex items-center justify-between">
            <p className="text-sm text-amber-800">Paiement des frais de port annulé — aucune livraison n'a été demandée.</p>
            <button onClick={() => setDeliveryRequestStatus(null)} className="p-1 text-amber-600 hover:text-amber-800">
              <X className="h-4 w-4" />
            </button>
          </div>
        )}
        {entrupyRequestStatus === 'success' && (
          <div className="m-4 md:m-6 bg-green-50 border border-green-200 rounded-lg p-3 flex items-center justify-between">
            <p className="text-sm text-green-800">Paiement confirmé — le certificat d'authenticité Entrupy a bien été ajouté.</p>
            <button onClick={() => setEntrupyRequestStatus(null)} className="p-1 text-green-600 hover:text-green-800">
              <X className="h-4 w-4" />
            </button>
          </div>
        )}
        {entrupyRequestStatus === 'cancel' && (
          <div className="m-4 md:m-6 bg-amber-50 border border-amber-200 rounded-lg p-3 flex items-center justify-between">
            <p className="text-sm text-amber-800">Paiement annulé — aucun certificat Entrupy n'a été ajouté.</p>
            <button onClick={() => setEntrupyRequestStatus(null)} className="p-1 text-amber-600 hover:text-amber-800">
              <X className="h-4 w-4" />
            </button>
          </div>
        )}
        {renderContent()}
      </MainLayout>
      <CartBlockingModal blockingError={cart.blockingError} onClose={cart.dismissBlockingError} />
    </ResellerProtectedRoute>
  );
}

export default ResellerApp;
