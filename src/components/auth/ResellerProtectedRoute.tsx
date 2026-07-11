import React from 'react'
import { useResellerAuth } from '../../hooks/useResellerAuth'

interface ResellerProtectedRouteProps {
  children: React.ReactNode
}

export const ResellerProtectedRoute: React.FC<ResellerProtectedRouteProps> = ({ children }) => {
  const { isReseller, loading, pendingReason, signOut } = useResellerAuth()

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-gray-900 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-gray-600">Vérification de la session...</p>
        </div>
      </div>
    )
  }

  if (!isReseller) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-white rounded-lg border border-gray-100 shadow-sm p-8 text-center">
          <h2 className="text-lg font-semibold text-gray-900 mb-2">
            {pendingReason === 'suspended' ? 'Compte suspendu' : pendingReason === 'pending' ? 'Compte en attente d\'activation' : 'Accès non autorisé'}
          </h2>
          <p className="text-sm text-gray-500 mb-6">
            {pendingReason === 'suspended'
              ? 'Votre accès au portail revendeur a été suspendu. Contactez OZË Paris pour plus d\'informations.'
              : pendingReason === 'pending'
              ? 'Votre compte revendeur n\'a pas encore été activé par notre équipe.'
              : 'Ce compte n\'a pas accès au portail revendeur.'}
          </p>
          <button
            onClick={signOut}
            className="px-4 py-2 bg-gray-900 text-white rounded-lg hover:bg-gray-800 transition-colors text-sm"
          >
            Retour à la connexion
          </button>
        </div>
      </div>
    )
  }

  return <>{children}</>
}
