import React from 'react';
import { useSessionRole } from './hooks/useSessionRole';
import { LoginScreen } from './components/auth/LoginScreen';
import { supabase } from './lib/supabase';
import AdminApp from './apps/AdminApp';
import ResellerApp from './apps/ResellerApp';

function App() {
  const { status, role } = useSessionRole();

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
    return <LoginScreen />;
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
