import React from 'react';
import { Card, CardContent } from '../ui/Card';
import { useAdminAuth } from '../../hooks/useAdminAuth';
import { useB2BRevenue } from '../../hooks/useB2BRevenue';
import { AlertCircle, RefreshCw, Banknote } from 'lucide-react';

export const B2BRevenue: React.FC = () => {
  const { isAdmin } = useAdminAuth();
  const { revenue, loading, error, refresh } = useB2BRevenue(isAdmin);

  const totalRevenue = revenue.reduce((sum, r) => sum + r.total_revenue, 0);
  const totalOrders = revenue.reduce((sum, r) => sum + r.orders_count, 0);

  return (
    <div className="p-4 md:p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h3 className="text-lg font-semibold text-gray-900">Chiffre d'affaires B2B</h3>
          <p className="text-sm text-gray-500">Ventes aux revendeurs, par entreprise</p>
        </div>
        <button
          onClick={refresh}
          className="flex items-center space-x-2 px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors"
        >
          <RefreshCw className="h-4 w-4" />
          <span className="hidden sm:inline">Actualiser</span>
        </button>
      </div>

      {!loading && !error && (
        <div className="grid grid-cols-2 gap-4 mb-6">
          <Card>
            <CardContent className="p-4">
              <p className="text-xs text-gray-500 mb-1">Chiffre d'affaires total</p>
              <p className="text-xl font-semibold text-gray-900">{totalRevenue.toFixed(0)} €</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <p className="text-xs text-gray-500 mb-1">Commandes B2B</p>
              <p className="text-xl font-semibold text-gray-900">{totalOrders}</p>
            </CardContent>
          </Card>
        </div>
      )}

      {error && (
        <div className="mb-6 bg-red-50 border border-red-200 rounded-lg p-4 flex items-center space-x-3">
          <AlertCircle className="h-5 w-5 text-red-600 flex-shrink-0" />
          <p className="text-sm text-red-700">Erreur : {error}</p>
        </div>
      )}

      {!loading && !error && revenue.length === 0 && (
        <div className="text-center py-12">
          <Banknote className="h-12 w-12 text-gray-400 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">Aucune donnée</h3>
          <p className="text-gray-500">Le chiffre d'affaires apparaîtra ici dès qu'une commande B2B sera passée.</p>
        </div>
      )}

      {(revenue.length > 0 || loading) && (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-100">
                    <th className="text-left py-3 px-4 md:px-6 font-medium text-gray-900 text-sm">Revendeur</th>
                    <th className="text-left py-3 px-4 md:px-6 font-medium text-gray-900 text-sm">Commandes</th>
                    <th className="text-left py-3 px-4 md:px-6 font-medium text-gray-900 text-sm">Chiffre d'affaires</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    [...Array(3)].map((_, i) => (
                      <tr key={`skeleton-${i}`} className="border-b border-gray-50">
                        <td className="py-4 px-4 md:px-6" colSpan={3}>
                          <div className="h-4 w-full bg-gray-100 rounded animate-pulse" />
                        </td>
                      </tr>
                    ))
                  ) : (
                    revenue.map((r) => (
                      <tr key={r.reseller_id} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                        <td className="py-4 px-4 md:px-6 text-sm font-medium text-gray-900">{r.company_name}</td>
                        <td className="py-4 px-4 md:px-6 text-sm text-gray-600">{r.orders_count}</td>
                        <td className="py-4 px-4 md:px-6 text-sm font-semibold text-gray-900">{r.total_revenue.toFixed(0)} €</td>
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
