import React, { useState } from 'react';
import { Card, CardContent, CardHeader } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { useCustomers } from '../../hooks/useCustomers';
import { useAdminAuth } from '../../hooks/useAdminAuth';
import { CustomerProfile } from './CustomerProfile';
import { Coupons } from './Coupons';
import { Eye, Mail, Phone, AlertCircle, Users, RefreshCw } from 'lucide-react';

interface CustomersProps {
  activeSubTab?: string;
}

export const Customers: React.FC<CustomersProps> = ({ activeSubTab = 'all-customers' }) => {
  const { isAdmin } = useAdminAuth()
  const { customers, loading, error, refreshCustomers } = useCustomers(isAdmin)
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null)

  // Si un client est sélectionné, afficher son profil
  if (selectedCustomerId) {
    return (
      <CustomerProfile
        customerId={selectedCustomerId}
        onBack={() => setSelectedCustomerId(null)}
      />
    )
  }

  // Afficher la page Coupons si c'est l'onglet actif
  if (activeSubTab === 'coupons') {
    return <Coupons />;
  }

  // Default customers list
  return (
    <div className="p-4 md:p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h3 className="text-lg font-semibold text-gray-900">Liste des Clients</h3>
          <p className="text-sm text-gray-500">
            {loading ? 'Chargement...' : `${customers.length} client${customers.length > 1 ? 's' : ''} trouvé${customers.length > 1 ? 's' : ''}`}
          </p>
        </div>
        <button 
          onClick={refreshCustomers}
          className="hidden md:flex items-center space-x-2 px-4 py-2 bg-gray-900 text-white rounded-lg hover:bg-gray-800 transition-colors"
        >
          <RefreshCw className="h-4 w-4" />
          <span>Actualiser</span>
        </button>
      </div>

      {/* Message d'erreur */}
      {error && (
        <div className="mb-6 bg-red-50 border border-red-200 rounded-lg p-4 flex items-center space-x-3">
          <AlertCircle className="h-5 w-5 text-red-600 flex-shrink-0" />
          <p className="text-sm text-red-700">Erreur lors du chargement des clients : {error}</p>
        </div>
      )}

      {/* Message si pas de clients */}
      {!loading && !error && customers.length === 0 && (
        <div className="text-center py-12">
          <Users className="h-12 w-12 text-gray-400 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">Aucun client trouvé</h3>
          <p className="text-gray-500 mb-6">Les clients qui s'inscrivent apparaîtront ici</p>
        </div>
      )}

      {/* Liste des clients */}
      {(customers.length > 0 || loading) && (
        <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto -mx-4 md:mx-0">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="text-left py-3 md:py-4 px-4 md:px-6 font-medium text-gray-900 text-xs md:text-sm">Client</th>
                  <th className="text-left py-3 md:py-4 px-4 md:px-6 font-medium text-gray-900 text-xs md:text-sm hidden sm:table-cell">Code Client</th>
                  <th className="text-left py-3 md:py-4 px-4 md:px-6 font-medium text-gray-900 text-xs md:text-sm hidden sm:table-cell">Téléphone</th>
                  <th className="text-left py-3 md:py-4 px-4 md:px-6 font-medium text-gray-900 text-xs md:text-sm hidden md:table-cell">Statut</th>
                  <th className="text-left py-3 md:py-4 px-4 md:px-6 font-medium text-gray-900 text-xs md:text-sm hidden lg:table-cell">Date d'Inscription</th>
                  <th className="text-left py-3 md:py-4 px-4 md:px-6 font-medium text-gray-900 text-xs md:text-sm">Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  // Skeleton loading
                  [...Array(3)].map((_, index) => (
                    <tr key={`skeleton-${index}`} className="border-b border-gray-50">
                      <td className="py-3 md:py-4 px-4 md:px-6">
                        <div className="flex items-center space-x-3">
                          <div className="h-8 w-8 md:h-10 md:w-10 bg-gray-200 rounded-full animate-pulse"></div>
                          <div>
                            <div className="h-4 w-24 bg-gray-200 rounded animate-pulse mb-1"></div>
                            <div className="h-3 w-32 bg-gray-200 rounded animate-pulse"></div>
                          </div>
                        </div>
                      </td>
                      <td className="py-3 md:py-4 px-4 md:px-6 hidden sm:table-cell">
                        <div className="h-4 w-20 bg-gray-200 rounded animate-pulse"></div>
                      </td>
                      <td className="py-3 md:py-4 px-4 md:px-6 hidden sm:table-cell">
                        <div className="h-4 w-24 bg-gray-200 rounded animate-pulse"></div>
                      </td>
                      <td className="py-3 md:py-4 px-4 md:px-6 hidden md:table-cell">
                        <div className="h-6 w-16 bg-gray-200 rounded animate-pulse"></div>
                      </td>
                      <td className="py-3 md:py-4 px-4 md:px-6 hidden lg:table-cell">
                        <div className="h-4 w-20 bg-gray-200 rounded animate-pulse"></div>
                      </td>
                      <td className="py-3 md:py-4 px-4 md:px-6">
                        <div className="flex items-center space-x-1 md:space-x-2">
                          <div className="h-6 w-6 bg-gray-200 rounded animate-pulse"></div>
                          <div className="h-6 w-6 bg-gray-200 rounded animate-pulse hidden md:inline-block"></div>
                        </div>
                      </td>
                    </tr>
                  ))
                ) : (
                  customers.map((customer) => (
                    <tr key={customer.id} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                      <td className="py-3 md:py-4 px-4 md:px-6">
                        <div className="flex items-center space-x-3">
                          <div className="h-8 w-8 md:h-10 md:w-10 bg-gray-900 rounded-full flex items-center justify-center flex-shrink-0">
                            <span className="text-white font-medium text-xs md:text-sm">
                              {customer.name.split(' ').map(n => n[0]).join('')}
                            </span>
                          </div>
                          <div>
                            <p className="font-medium text-gray-900 text-sm md:text-base">{customer.name}</p>
                            <p className="text-xs md:text-sm text-gray-500">{customer.email}</p>
                          </div>
                        </div>
                      </td>
                      <td className="py-3 md:py-4 px-4 md:px-6 hidden sm:table-cell">
                        <span className="font-mono text-sm text-gray-900">{customer.customer_code}</span>
                      </td>
                      <td className="py-3 md:py-4 px-4 md:px-6 hidden sm:table-cell">
                        <span className="text-sm text-gray-600">
                          {customer.phone || '-'}
                        </span>
                      </td>
                      <td className="py-3 md:py-4 px-4 md:px-6 hidden md:table-cell">
                        <Badge variant={customer.status === 'active' ? 'success' : 'default'}>
                          {customer.status === 'active' ? 'Actif' : 'Incomplet'}
                        </Badge>
                      </td>
                      <td className="py-3 md:py-4 px-4 md:px-6 hidden lg:table-cell">
                        <span className="text-xs md:text-sm text-gray-600">
                          {new Date(customer.joinDate).toLocaleDateString('fr-FR')}
                        </span>
                      </td>
                      <td className="py-3 md:py-4 px-4 md:px-6">
                        <div className="flex items-center space-x-1 md:space-x-2">
                          <button 
                            className="p-1 text-gray-400 hover:text-blue-600 transition-colors"
                            title="Voir les détails"
                            onClick={() => setSelectedCustomerId(customer.id)}
                          >
                            <Eye className="h-3 w-3 md:h-4 md:w-4" />
                          </button>
                          {customer.email && (
                            <button 
                              className="p-1 text-gray-400 hover:text-green-600 transition-colors hidden md:inline-block"
                              title="Envoyer un email"
                              onClick={() => window.open(`mailto:${customer.email}`)}
                            >
                              <Mail className="h-3 w-3 md:h-4 md:w-4" />
                            </button>
                          )}
                          {customer.phone && (
                            <button 
                              className="p-1 text-gray-400 hover:text-purple-600 transition-colors hidden md:inline-block"
                              title="Appeler"
                              onClick={() => window.open(`tel:${customer.phone}`)}
                            >
                              <Phone className="h-3 w-3 md:h-4 md:w-4" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
        </Card>
      )}
    </div>
  );
};