import React from 'react';
import { useSessionRole } from './hooks/useSessionRole';
import { LoginScreen } from './components/auth/LoginScreen';
import { AcceptInvite } from './components/auth/AcceptInvite';
import { AcceptTeamInviteLink } from './components/auth/AcceptTeamInviteLink';
import { supabase } from './lib/supabase';
import AdminApp from './apps/AdminApp';
import ResellerApp from './apps/ResellerApp';
import { B2BLanding } from './components/landing/B2BLanding';
import { B2BSignup } from './components/landing/B2BSignup';
import { Terms } from './components/pages/reseller/Terms';

// Aperçu privé de la landing avant son ouverture publique : ouvrir
// https://pro.ozeparis.com/?apercu=club-yTMTeei l'active pour ce navigateur
// (mémorisé, pour que /inscription et le retour de Stripe fonctionnent
// aussi) ; ?apercu=off le retire. Ce n'est pas une protection forte (la clé
// est dans le code livré au navigateur), juste de quoi garder la page
// invisible du public. Inutile une fois VITE_B2B_LANDING_ENABLED = 'true'.
const LANDING_PREVIEW_KEY = 'club-yTMTeei';
const LANDING_PREVIEW_STORAGE = 'oze-landing-preview';

const isLandingEnabled = (): boolean => {
  if (import.meta.env.VITE_B2B_LANDING_ENABLED === 'true') return true;
  try {
    const param = new URLSearchParams(window.location.search).get('apercu');
    if (param === LANDING_PREVIEW_KEY) localStorage.setItem(LANDING_PREVIEW_STORAGE, '1');
    if (param === 'off') localStorage.removeItem(LANDING_PREVIEW_STORAGE);
    return localStorage.getItem(LANDING_PREVIEW_STORAGE) === '1';
  } catch {
    // Stockage indisponible (navigation privée stricte) : aperçu seulement via l'URL.
    return new URLSearchParams(window.location.search).get('apercu') === LANDING_PREVIEW_KEY;
  }
};

function App() {
  const { status, role } = useSessionRole();

  // Priorité absolue, indépendante de l'état de session : c'est la page de
  // destination du lien d'invitation par email (voir `redirectTo` dans
  // invite-reseller-contact). Elle gère elle-même son propre chargement de
  // session, avant même que useSessionRole ait fini de se résoudre.
  if (window.location.pathname === '/accept-invite') {
    return <AcceptInvite />;
  }

  // Page de destination du lien d'invitation d'équipe réutilisable (voir
  // InviteLinkPanel / accept-reseller-invite-link) — publique, doit
  // s'afficher avant toute vérification de session.
  if (window.location.pathname === '/invite/team') {
    return <AcceptTeamInviteLink />;
  }

  if (status === 'loading') {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-gray-900 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-gray-600">Vérification de la session...</p>
        </div>
      </div>
    );
  }

  // Même build pour admin.ozeparis.com et pro.ozeparis.com : la vitrine
  // publique (landing, CGV sans connexion) n'existe que côté revendeurs.
  const isAdminHost = window.location.hostname.startsWith('admin.');

  if (status === 'signed-out' && !isAdminHost) {
    // Landing masquée tant que VITE_B2B_LANDING_ENABLED !== 'true' (réglage
    // Vercel) : "/" retombe alors sur l'écran de connexion, comme avant —
    // sauf en aperçu privé (voir isLandingEnabled).
    const landingEnabled = isLandingEnabled();
    if (window.location.pathname === '/' && landingEnabled) {
      return <B2BLanding />;
    }
    // Inscription à un pass depuis la landing (infos du compte, puis Stripe),
    // et /inscription/merci, page de retour après paiement.
    if (/^\/inscription(\/merci)?\/?$/.test(window.location.pathname) && landingEnabled) {
      return <B2BSignup />;
    }
    // Lien "CGV / Mentions légales" du pied de la landing : lisible sans compte.
    if (window.location.pathname === '/cgv' || window.location.pathname === '/cgv/') {
      return (
        <div className="min-h-screen bg-gray-50">
          <div className="max-w-4xl mx-auto px-4 pt-6">
            <a href="/" className="text-sm text-gray-500 hover:text-gray-900">← Retour</a>
          </div>
          <Terms />
        </div>
      );
    }
  }

  if (status === 'signed-out') {
    // Vraie URL dédiée pour l'écran de connexion (voir useNavigation pour le
    // même principe appliqué aux onglets) — mémorise la page initialement
    // demandée (?next=...) pour y revenir après connexion, plutôt que de
    // toujours retomber sur l'accueil. replaceState (pas pushState) : ce
    // n'est pas une navigation volontaire de l'utilisateur, pas d'entrée
    // supplémentaire dans l'historique.
    if (window.location.pathname !== '/connexion') {
      const current = window.location.pathname + window.location.search;
      const next = current !== '/' ? `?next=${encodeURIComponent(current)}` : '';
      window.history.replaceState({}, '', `/connexion${next}`);
    }
    return <LoginScreen />;
  }

  // Connecté mais encore sur /connexion (juste après une connexion réussie,
  // ou accès direct à /connexion déjà authentifié) : restaure la
  // destination d'origine AVANT qu'AdminApp/ResellerApp ne montent, sinon
  // leur résolution d'URL initiale (useNavigation) verrait encore
  // /connexion et retomberait sur l'onglet par défaut.
  if (window.location.pathname === '/connexion') {
    const params = new URLSearchParams(window.location.search);
    const next = params.get('next');
    window.history.replaceState({}, '', next ? decodeURIComponent(next) : '/');
  }

  if (role === 'reseller') {
    // Revendeur connecté sur "/" (ex. lien vers la landing) : URL canonique
    // du catalogue, avant que ResellerApp ne résolve l'onglet initial.
    if (window.location.pathname === '/') {
      window.history.replaceState({}, '', '/catalogue' + window.location.search);
    }
    return <ResellerApp />;
  }

  if (role === 'admin') {
    return <AdminApp />;
  }

  // Rôle 'client' ou inconnu : aucun accès à oze-admin.
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="max-w-md w-full bg-white rounded-lg border border-gray-100 shadow-sm p-8 text-center">
        <h2 className="text-lg font-semibold text-gray-900 mb-2">Accès non autorisé</h2>
        <p className="text-sm text-gray-500 mb-6">Ce compte n'a pas accès à cette application.</p>
        <button
          onClick={() => supabase.auth.signOut()}
          className="px-4 py-2 bg-gray-900 text-white rounded-lg hover:bg-gray-800 transition-colors text-sm"
        >
          Retour à la connexion
        </button>
      </div>
    </div>
  );
}

export default App;
