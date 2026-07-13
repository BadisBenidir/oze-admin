import React, { useEffect, useState } from 'react';
import { Card, CardContent } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { Modal } from '../ui/Modal';
import { useResellers, Reseller, ResellerContact } from '../../hooks/useResellers';
import { useB2BOrders } from '../../hooks/useB2BOrders';
import { useAdminAuth } from '../../hooks/useAdminAuth';
import { ArrowLeft, Users, ShoppingBag, Banknote, Crown, AlertCircle, Mail, Key, Copy, Check, KeyRound } from 'lucide-react';

interface ResellerDetailProps {
  reseller: Reseller;
  onBack: () => void;
}

const generateTempPassword = (): string => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 4; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return `Oze-${code}-${new Date().getFullYear()}`;
};

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
  const { fetchContacts, resetContactPassword } = useResellers(false);
  const { orders, loading: ordersLoading, error: ordersError } = useB2BOrders(isAdmin, reseller.id);

  const [contacts, setContacts] = useState<ResellerContact[]>([]);
  const [contactsLoading, setContactsLoading] = useState(true);
  const [contactsError, setContactsError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'team' | 'orders'>('team');

  const [resettingContact, setResettingContact] = useState<ResellerContact | null>(null);
  const [newPassword, setNewPassword] = useState<string | null>(null);
  const [resetting, setResetting] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

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

  const openResetModal = (contact: ResellerContact) => {
    setResettingContact(contact);
    setNewPassword(null);
    setResetError(null);
    setCopied(false);
  };

  const closeResetModal = () => {
    if (resetting) return;
    setResettingContact(null);
    setNewPassword(null);
    setResetError(null);
    setCopied(false);
  };

  const handleConfirmReset = async () => {
    if (!resettingContact) return;
    setResetting(true);
    setResetError(null);

    const password = generateTempPassword();
    const result = await resetContactPassword(resettingContact.profile_id, password);

    setResetting(false);
    if (result.success) {
      setNewPassword(password);
    } else {
      setResetError(result.error || 'Erreur lors de la réinitialisation');
    }
  };

  const handleCopyPassword = () => {
    if (!newPassword) return;
    navigator.clipboard.writeText(newPassword);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

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
                    <th className="text-left py-3 px-4 md:px-6 font-medium text-gray-900 text-sm">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {contactsLoading ? (
                    [...Array(2)].map((_, i) => (
                      <tr key={`skeleton-${i}`} className="border-b border-gray-50">
                        <td className="py-4 px-4 md:px-6" colSpan={5}>
                          <div className="h-4 w-full bg-gray-100 rounded animate-pulse" />
                        </td>
                      </tr>
                    ))
                  ) : contacts.length === 0 ? (
                    <tr>
                      <td className="py-8 px-4 md:px-6 text-center text-sm text-gray-500" colSpan={5}>
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
                        <td className="py-3 px-4 md:px-6">
                          <button
                            onClick={() => openResetModal(c)}
                            className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                            title="Régénérer le mot de passe"
                          >
                            <Key className="h-4 w-4" />
                          </button>
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

      {/* Modal réinitialisation mot de passe */}
      <Modal
        isOpen={!!resettingContact}
        onClose={closeResetModal}
        title="Régénérer le mot de passe"
      >
        <div className="space-y-4">
          {!newPassword ? (
            <>
              <p className="text-sm text-gray-700">
                Réinitialiser le mot de passe de{' '}
                <strong>{resettingContact?.first_name} {resettingContact?.last_name}</strong> ({resettingContact?.email}) ?
                Un nouveau mot de passe temporaire sera généré et son ancien mot de passe ne fonctionnera plus.
              </p>

              {resetError && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-3 flex items-center space-x-2">
                  <AlertCircle className="h-4 w-4 text-red-600 flex-shrink-0" />
                  <p className="text-sm text-red-700">{resetError}</p>
                </div>
              )}

              <div className="flex justify-end space-x-3 pt-2">
                <button
                  type="button"
                  onClick={closeResetModal}
                  disabled={resetting}
                  className="px-4 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors disabled:opacity-50"
                >
                  Annuler
                </button>
                <button
                  type="button"
                  onClick={handleConfirmReset}
                  disabled={resetting}
                  className="flex items-center space-x-2 px-4 py-2 bg-gray-900 text-white rounded-lg hover:bg-gray-800 transition-colors disabled:opacity-50"
                >
                  <KeyRound className="h-4 w-4" />
                  <span>{resetting ? 'Génération...' : 'Confirmer la régénération'}</span>
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="bg-green-50 border border-green-200 rounded-lg p-4 space-y-3">
                <p className="text-sm font-medium text-green-800">
                  Nouveau mot de passe généré pour {resettingContact?.first_name} {resettingContact?.last_name} :
                </p>
                <div className="flex items-center justify-between bg-white rounded-lg border border-green-200 px-4 py-3">
                  <span className="text-lg font-mono font-semibold text-gray-900 tracking-wide">{newPassword}</span>
                  <button
                    type="button"
                    onClick={handleCopyPassword}
                    className="flex items-center space-x-1 px-3 py-1.5 bg-gray-900 text-white rounded-lg hover:bg-gray-800 transition-colors text-xs flex-shrink-0 ml-3"
                  >
                    {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                    <span>{copied ? 'Copié' : 'Copier'}</span>
                  </button>
                </div>
                <p className="text-xs text-gray-500">
                  Ce mot de passe ne sera plus affiché ensuite — copie-le et transmets-le directement à {resettingContact?.first_name}.
                </p>
              </div>
              <div className="flex justify-end pt-2">
                <button
                  type="button"
                  onClick={closeResetModal}
                  className="px-4 py-2 bg-gray-900 text-white rounded-lg hover:bg-gray-800 transition-colors"
                >
                  Fermer
                </button>
              </div>
            </>
          )}
        </div>
      </Modal>
    </div>
  );
};
