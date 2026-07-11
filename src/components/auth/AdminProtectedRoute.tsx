import React from 'react'
import { AdminLogin } from './AdminLogin'
import { useAdminAuth } from '../../hooks/useAdminAuth'

interface AdminProtectedRouteProps {
  children: React.ReactNode
}

export const AdminProtectedRoute: React.FC<AdminProtectedRouteProps> = ({ children }) => {
  const { isAdmin, loading, signIn } = useAdminAuth()

  // Affichage du loader pendant la vérification de la session
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

  // Si pas admin, afficher la page de login
  if (!isAdmin) {
    return <AdminLogin onSignIn={signIn} loading={loading} />
  }

  // Si admin connecté, afficher l'interface
  return <>{children}</>
}