import React, { useEffect, useState } from 'react';
import { Card, CardContent } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { useResellers, Reseller, ResellerContact } from '../../hooks/useResellers';
import { useB2BOrders } from '../../hooks/useB2BOrders';
import { useAdminAuth } from '../../hooks/useAdminAuth';
import { ArrowLeft, Users, ShoppingBag, Banknote, Crown, AlertCircle, Mail } from 'lucide-react';

interface ResellerDetailProps {
  reseller: Reseller;
  onBack: () => void;
}

const resellerStatusBadge = (status: Reseller['status']) => {
  switch (status) {
    case 'active':
      return <Badge variant="success">Actif</Badge>;
    case 'suspended':
      return <Badge variant="danger">Suspendu</Badge>;
    default:
      return <Badge variant="warning">En attente</Badge>;
  }
};

const orderStatusBadge = (status: string) => {
  switch (status) {
    case 'shipped':
      return <Badge variant="info">Expédiée</Badge>;
    case 'delivered':
      return <Badge variant="success">Livrée</Badge>;
    case 'cancelled':
      return <Badge variant="danger">Annulée</Badge>;
    default:
      return <Badge variant="success">Confirmée</Badge>;
  }
};

export const ResellerDetail: React.FC<ResellerDetailProps> = ({ reseller, onBack }) => {
  const { isAdmin } = useAdminAuth();
  const { fetchContacts } = useResellers(false);
  const { orders, loading: ordersLoading, error: ordersError } = useB2BOrders(isAdmin, reseller.id);

  const [contacts, setContacts] = useState<ResellerContact[]>([]);
  const [contactsLoading, setContactsLoading] = useState(true);
  const [contactsError, setContactsError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'team' | 'orders'>('team');

  useEffect(() => {
    let mounted = true;
    setContactsLoading(true);
    fetchContacts(reseller.id)
      .then((data) => {
        if (mounted) setContacts(data);
      })
      .catch((err) => {
        if (mounted) setContactsError(err instanceof Error ? err.message : 'Erreur lors du chargement des sous-comptes');
      })
      .finally(() => {
        if (mounted) setContactsLoading(false);
      });
    return () => {
      mounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reseller.id]);

  const totalRevenue = orders.reduce((sum, o) => sum + o.total_amount, 0);

  return (
    <div className="p-4 md:p-6">
      <button
        onClick={onBack}
        className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900 mb-6 transition-colors"
      >
        <ArrowLeft className="h-4 w-4" />
        Retour aux revendeurs
      </button>

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
        <div>
          <h2 className="text-xl font-semibold text-gray-900">{reseller.company_name}</h2>
          {reseller.contact_email && (
            <p className="text-sm text-gray-500 flex items-center gap-1 mt-1">
              <Mail className="h-3.5 w-3.5" /> {reseller.contact_email}
            </p>
          )}
        </div>
        {resellerStatusBadge(reseller.status)}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-blue-50 flex items-center justify-center flex-shrink-0">
              <Users className="h-5 w-5 text-blue-600" />
            </div>
            <div>
              <p className="text-xs text-gray-500">Sous-comptes</p>
              <p className="text-xl font-semibold text-gray-900">{contactsLoading ? '—' : contacts.length}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-purple-50 flex items-center justify-center flex-shrink-0">
              <ShoppingBag className="h-5 w-5 text-purple-600" />
            </div>
            <div>
              <p className="text-xs text-gray-500">Total commandes</p>
              <p className="text-xl font-semibold text-gray-900">{ordersLoading ? '—' : orders.length}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-green-50 flex items-center justify-center flex-shrink-0">
              <Banknote className="h-5 w-5 text-green-600" />
            </div>
            <div>
              <p className="text-xs text-gray-500">Chiffre d'affaires B2B</p>
              <p className="text-xl font-semibold text-gray-900">{ordersLoading ? '—' : `${totalRevenue.toFixed(0)} €`}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-gray-200 mb-4">
        <button
          onClick={() => setActiveTab('team')}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'team' ? 'border-gray-900 text-gray-900' : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          Structure & Sous-comptes
        </button>
        <button
          onClick={() => setActiveTab('orders')}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'orders' ? 'border-gray-900 text-gray-900' : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          Historique des commandes
        </button>
      </div>

      {activeTab === 'team' && (
        <Card>
          <CardContent className="p-0">
            {contactsError && (
              <div className="m-4 bg-red-50 border border-red-200 rounded-lg p-3 flex items-center space-x-2">
                <AlertCircle className="h-4 w-4 text-red-600 flex-shrink-0" />
                <p className="text-sm text-red-700">{contactsError}</p>
              </div>
            )}
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-100">
                    <th className="text-left py-3 px-4 md:px-6 font-medium text-gray-900 text-sm">Nom</th>
                    <th className="text-left py-3 px-4 md:px-6 font-medium text-gray-900 text-sm">Email</th>
                    <th className="text-left py-3 px-4 md:px-6 font-medium text-gray-900 text-sm">Rôle</th>
                    <th className="text-left py-3 px-4 md:px-6 font-medium text-gray-900 text-sm">Statut</th>
                  </tr>
                </thead>
                <tbody>
                  {contactsLoading ? (
                    [...Array(2)].map((_, i) => (
                      <tr key={`skeleton-${i}`} className="border-b border-gray-50">
                        <td className="py-4 px-4 md:px-6" colSpan={4}>
                          <div className="h-4 w-full bg-gray-100 rounded animate-pulse" />
                        </td>
                      </tr>
                    ))
                  ) : contacts.length === 0 ? (
                    <tr>
                      <td className="py-8 px-4 md:px-6 text-center text-sm text-gray-500" colSpan={4}>
                        Aucun sous-compte pour ce revendeur.
                      </td>
                    </tr>
                  ) : (
                    contacts.map((c) => (
                      <tr key={c.id} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                        <td className="py-3 px-4 md:px-6">
                          <div className="flex items-center gap-2">
                            {c.is_primary && <Crown className="h-3.5 w-3.5 text-amber-500" />}
                            <span className="text-sm font-medium text-gray-900">{c.first_name} {c.last_name}</span>
                          </div>
                        </td>
                        <td className="py-3 px-4 md:px-6 text-sm text-gray-600">{c.email}</td>
                        <td className="py-3 px-4 md:px-6">
                          <Badge variant={c.is_primary ? 'info' : 'default'}>{c.is_primary ? 'Principal' : 'Membre'}</Badge>
                        </td>
                        <td className="py-3 px-4 md:px-6">
                          <Badge variant="success">Actif</Badge>
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

      {activeTab === 'orders' && (
        <Card>
          <CardContent className="p-0">
            {ordersError && (
              <div className="m-4 bg-red-50 border border-red-200 rounded-lg p-3 flex items-center space-x-2">
                <AlertCircle className="h-4 w-4 text-red-600 flex-shrink-0" />
                <p className="text-sm text-red-700">{ordersError}</p>
              </div>
            )}
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-100">
                    <th className="text-left py-3 px-4 md:px-6 font-medium text-gray-900 text-sm">N° commande</th>
                    <th className="text-left py-3 px-4 md:px-6 font-medium text-gray-900 text-sm">Passée par</th>
                    <th className="text-left py-3 px-4 md:px-6 font-medium text-gray-900 text-sm hidden md:table-cell">Date</th>
                    <th className="text-left py-3 px-4 md:px-6 font-medium text-gray-900 text-sm hidden md:table-cell">Articles</th>
                    <th className="text-left py-3 px-4 md:px-6 font-medium text-gray-900 text-sm">Total</th>
                    <th className="text-left py-3 px-4 md:px-6 font-medium text-gray-900 text-sm">Statut</th>
                  </tr>
                </thead>
                <tbody>
                  {ordersLoading ? (
                    [...Array(3)].map((_, i) => (
                      <tr key={`skeleton-${i}`} className="border-b border-gray-50">
                        <td className="py-4 px-4 md:px-6" colSpan={6}>
                          <div className="h-4 w-full bg-gray-100 rounded animate-pulse" />
                        </td>
                      </tr>
                    ))
                  ) : orders.length === 0 ? (
                    <tr>
                      <td className="py-8 px-4 md:px-6 text-center text-sm text-gray-500" colSpan={6}>
                        Aucune commande pour ce revendeur.
                      </td>
                    </tr>
                  ) : (
                    orders.map((order) => (
                      <tr key={order.id} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                        <td className="py-3 px-4 md:px-6 text-sm font-medium text-gray-900">{order.order_number}</td>
                        <td className="py-3 px-4 md:px-6 text-sm text-gray-600">{order.email}</td>
                        <td className="py-3 px-4 md:px-6 hidden md:table-cell text-sm text-gray-600">
                          {new Date(order.created_at).toLocaleDateString('fr-FR')}
                        </td>
                        <td className="py-3 px-4 md:px-6 hidden md:table-cell text-sm text-gray-600">
                          {order.order_items.length} pièce{order.order_items.length > 1 ? 's' : ''}
                        </td>
                        <td className="py-3 px-4 md:px-6 text-sm font-semibold text-gray-900">{order.total_amount.toFixed(0)} €</td>
                        <td className="py-3 px-4 md:px-6">{orderStatusBadge(order.status)}</td>
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
