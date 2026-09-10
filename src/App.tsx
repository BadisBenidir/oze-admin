import React from 'react';
import { useSessionRole } from './hooks/useSessionRole';
import { LoginScreen } from './components/auth/LoginScreen';
import { AcceptInvite } from './components/auth/AcceptInvite';
import { AcceptTeamInviteLink } from './components/auth/AcceptTeamInviteLink';
import { supabase } from './lib/supabase';
import AdminApp from './apps/AdminApp';
import ResellerApp from './apps/ResellerApp';

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
