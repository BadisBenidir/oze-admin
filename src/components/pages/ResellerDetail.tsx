import React, { useEffect, useMemo, useState } from 'react';
import { Card, CardContent } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { Modal } from '../ui/Modal';
import { useResellers, Reseller, ResellerContact, ResellerFormData } from '../../hooks/useResellers';
import { useB2BOrders, getRequesterDisplayName } from '../../hooks/useB2BOrders';
import { useAdminAuth } from '../../hooks/useAdminAuth';
import { useAdminWallet } from '../../hooks/useAdminWallet';
import { ResellerFormModal } from './ResellerFormModal';
import { B2BOrderDetailModal } from './b2b/B2BOrderDetailModal';
import { WalletAdjustModal } from './b2b/WalletAdjustModal';
import { ResellerContactEditModal } from './b2b/ResellerContactEditModal';
import { SourcingMissionsTab } from './b2b/SourcingMissionsTab';
import { generateSecurePassword } from '../../utils/generatePassword';
import {
  ArrowLeft, Users, ShoppingBag, Banknote, Crown, AlertCircle, Mail, Key, Copy, Check, KeyRound,
  Eye, Edit, Wallet, ArrowUpCircle, ArrowDownCircle, RotateCcw, Settings2, X, Search,
} from 'lucide-react';
import type { B2BOrder } from '../../hooks/useB2BOrders';

interface ResellerDetailProps {
  reseller: Reseller;
  onBack: () => void;
  /** Remonte la version à jour au parent (liste principale) après une édition. */
  onResellerUpdated?: (updated: Reseller) => void;
}

// Insensible aux accents (ex. "Béatrice" trouvé en tapant "beatrice") et à la
// casse, pour la recherche sur les sous-comptes.
const DIACRITICS_REGEX = new RegExp('[\\u0300-\\u036f]', 'g');
const normalizeSearch = (value: string): string =>
  value.normalize('NFD').replace(DIACRITICS_REGEX, '').toLowerCase().trim();

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

const orderStatusLabel = (status: string): string => {
  switch (status) {
    case 'shipped':
      return 'Expédiée';
    case 'delivered':
      return 'Livrée';
    case 'cancelled':
      return 'Annulée';
    default:
      return 'Confirmée';
  }
};

const orderStatusBadge = (status: string) => {
  const variant = status === 'shipped' ? 'info' : status === 'delivered' ? 'success' : status === 'cancelled' ? 'danger' : 'success';
  return <Badge variant={variant}>{orderStatusLabel(status)}</Badge>;
};

export const ResellerDetail: React.FC<ResellerDetailProps> = ({ reseller, onBack, onResellerUpdated }) => {
  const { isAdmin } = useAdminAuth();
  const { fetchContacts, resetContactPassword, updateContactEmail, updateContactProfile } = useResellers(false);

  // Copie locale pour refléter immédiatement une édition sans devoir
  // recharger toute la liste des revendeurs depuis le parent.
  const [currentReseller, setCurrentReseller] = useState<Reseller>(reseller);
  useEffect(() => {
    setCurrentReseller(reseller);
  }, [reseller]);

  // Vue "Historique des commandes" : consolidée par défaut (toute
  // l'entreprise), ou isolée sur UN sous-compte précis quand l'admin clique
  // "Voir les commandes" depuis l'onglet Structure & Sous-comptes.
  const [ordersFilterContact, setOrdersFilterContact] = useState<ResellerContact | null>(null);
  const { orders, loading: ordersLoading, error: ordersError, refresh: refreshOrders } = useB2BOrders(isAdmin, currentReseller.id, ordersFilterContact?.profile_id);
  const [orderSearch, setOrderSearch] = useState('');
  const filteredOrders = useMemo(() => {
    const query = normalizeSearch(orderSearch);
    if (!query) return orders;
    return orders.filter((order) => {
      const requesterName = getRequesterDisplayName(order) || '';
      const itemNames = order.order_items.map((i) => i.product_snapshot?.name || '').join(' ');
      const haystack = [order.order_number, requesterName, order.email, orderStatusLabel(order.status), itemNames].join(' ');
      return normalizeSearch(haystack).includes(query);
    });
  }, [orders, orderSearch]);

  const [contacts, setContacts] = useState<ResellerContact[]>([]);
  const [contactsLoading, setContactsLoading] = useState(true);
  const [contactsError, setContactsError] = useState<string | null>(null);
  const [contactSearch, setContactSearch] = useState('');
  const [activeTab, setActiveTab] = useState<'team' | 'orders' | 'wallet' | 'sourcing'>('team');
  const [showEditModal, setShowEditModal] = useState(false);
  const [showAdjustModal, setShowAdjustModal] = useState(false);

  // Le solde est porté par PROFIL (voir 0029_b2b_wallet.sql), pas par
  // l'entreprise : CHAQUE sous-compte a le sien, jamais partagé. L'admin
  // choisit ici quel membre de l'équipe consulter/ajuster (par défaut le
  // contact principal), au lieu d'être limité à ce dernier.
  const primaryContact = contacts.find((c) => c.is_primary);
  const filteredContacts = useMemo(() => {
    const query = normalizeSearch(contactSearch);
    if (!query) return contacts;
    return contacts.filter((c) =>
      normalizeSearch(`${c.first_name} ${c.last_name}`).includes(query) ||
      normalizeSearch(c.email).includes(query)
    );
  }, [contacts, contactSearch]);
  const [selectedContactId, setSelectedContactId] = useState<string | null>(null);
  useEffect(() => {
    if (!selectedContactId && primaryContact) {
      setSelectedContactId(primaryContact.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [primaryContact]);
  const selectedContact = contacts.find((c) => c.id === selectedContactId) || primaryContact;
  const wallet = useAdminWallet(selectedContact?.profile_id);

  const [editingContact, setEditingContact] = useState<ResellerContact | null>(null);

  const handleSaveContact = async (
    profileId: string,
    profileData: { first_name: string; last_name: string; phone: string; address: string; city: string; postal_code: string; country: string },
    newEmail: string | null
  ) => {
    const result = await updateContactProfile(profileId, profileData);
    if (!result.success) return result;

    if (newEmail) {
      const emailResult = await updateContactEmail(profileId, newEmail);
      if (!emailResult.success) return emailResult;
    }

    const refreshed = await fetchContacts(currentReseller.id);
    setContacts(refreshed);
    return { success: true };
  };

  const [resettingContact, setResettingContact] = useState<ResellerContact | null>(null);
  const [newPassword, setNewPassword] = useState<string | null>(null);
  const [resetting, setResetting] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const [viewingOrder, setViewingOrder] = useState<B2BOrder | null>(null);

  // Après annulation d'un article, `orders` se rafraîchit mais `viewingOrder`
  // pointe encore sur l'ancien objet : on le resynchronise pour que la modal
  // ouverte reflète immédiatement le nouveau total et le statut de l'article.
  useEffect(() => {
    if (!viewingOrder) return;
    const updated = orders.find((o) => o.id === viewingOrder.id);
    if (updated) setViewingOrder(updated);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orders]);

  useEffect(() => {
    let mounted = true;
    setContactsLoading(true);
    fetchContacts(currentReseller.id)
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
  }, [currentReseller.id]);

  const handleResellerSaved = (_id: string, data: ResellerFormData) => {
    const updated: Reseller = { ...currentReseller, ...data };
    setCurrentReseller(updated);
    onResellerUpdated?.(updated);
  };

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

    const password = generateSecurePassword();
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
          <h2 className="text-xl font-semibold text-gray-900">{currentReseller.company_name}</h2>
          {currentReseller.contact_email && (
            <p className="text-sm text-gray-500 flex items-center gap-1 mt-1">
              <Mail className="h-3.5 w-3.5" /> {currentReseller.contact_email}
            </p>
          )}
        </div>
        <div className="flex items-center gap-3">
          {resellerStatusBadge(currentReseller.status)}
          <button
            onClick={() => setShowEditModal(true)}
            className="flex items-center space-x-2 px-3 py-1.5 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors text-sm"
          >
            <Edit className="h-3.5 w-3.5" />
            <span>Modifier le profil</span>
          </button>
        </div>
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
        <button
          onClick={() => setActiveTab('wallet')}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'wallet' ? 'border-gray-900 text-gray-900' : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          Portefeuille B2B
        </button>
        <button
          onClick={() => setActiveTab('sourcing')}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'sourcing' ? 'border-gray-900 text-gray-900' : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          Sourcing sur mesure
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
            {contacts.length > 0 && (
              <div className="p-4 border-b border-gray-100">
                <div className="relative max-w-sm">
                  <Search className="h-4 w-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type="text"
                    value={contactSearch}
                    onChange={(e) => setContactSearch(e.target.value)}
                    placeholder="Rechercher par nom ou email..."
                    className="w-full pl-9 pr-9 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-gray-400"
                  />
                  {contactSearch && (
                    <button
                      type="button"
                      onClick={() => setContactSearch('')}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 p-0.5 text-gray-400 hover:text-gray-700 rounded"
                      title="Effacer la recherche"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
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
                    <th className="text-right py-3 px-4 md:px-6 font-medium text-gray-900 text-sm">Solde B2B</th>
                    <th className="text-left py-3 px-4 md:px-6 font-medium text-gray-900 text-sm">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {contactsLoading ? (
                    [...Array(2)].map((_, i) => (
                      <tr key={`skeleton-${i}`} className="border-b border-gray-50">
                        <td className="py-4 px-4 md:px-6" colSpan={6}>
                          <div className="h-4 w-full bg-gray-100 rounded animate-pulse" />
                        </td>
                      </tr>
                    ))
                  ) : contacts.length === 0 ? (
                    <tr>
                      <td className="py-8 px-4 md:px-6 text-center text-sm text-gray-500" colSpan={6}>
                        Aucun sous-compte pour ce revendeur.
                      </td>
                    </tr>
                  ) : filteredContacts.length === 0 ? (
                    <tr>
                      <td className="py-8 px-4 md:px-6 text-center text-sm text-gray-500" colSpan={6}>
                        Aucun sous-compte trouvé pour cette recherche.
                      </td>
                    </tr>
                  ) : (
                    filteredContacts.map((c) => (
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
                        <td className="py-3 px-4 md:px-6 text-right text-sm font-semibold text-gray-900 tabular-nums">
                          {c.wallet_balance.toFixed(2)} €
                        </td>
                        <td className="py-3 px-4 md:px-6">
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => { setOrdersFilterContact(c); setActiveTab('orders'); }}
                              className="p-2 text-gray-400 hover:text-purple-600 hover:bg-purple-50 rounded-lg transition-colors"
                              title="Voir les commandes de ce sous-compte"
                            >
                              <ShoppingBag className="h-4 w-4" />
                            </button>
                            <button
                              onClick={() => setEditingContact(c)}
                              className="p-2 text-gray-400 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors"
                              title="Modifier ce sous-compte"
                            >
                              <Edit className="h-4 w-4" />
                            </button>
                            <button
                              onClick={() => { setSelectedContactId(c.id); setActiveTab('wallet'); }}
                              className="p-2 text-gray-400 hover:text-green-600 hover:bg-green-50 rounded-lg transition-colors"
                              title="Voir le portefeuille de ce membre"
                            >
                              <Wallet className="h-4 w-4" />
                            </button>
                            <button
                              onClick={() => openResetModal(c)}
                              className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                              title="Régénérer le mot de passe"
                            >
                              <Key className="h-4 w-4" />
                            </button>
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

      {activeTab === 'orders' && (
        <Card>
          <CardContent className="p-0">
            {ordersFilterContact && (
              <div className="m-4 bg-purple-50 border border-purple-200 rounded-lg p-3 flex items-center justify-between gap-3">
                <p className="text-sm text-purple-800">
                  Commandes de <strong>{ordersFilterContact.first_name} {ordersFilterContact.last_name}</strong> uniquement
                </p>
                <button
                  onClick={() => setOrdersFilterContact(null)}
                  className="flex items-center gap-1 text-xs text-purple-700 hover:text-purple-900 flex-shrink-0"
                >
                  <X className="h-3.5 w-3.5" /> Voir toutes les commandes
                </button>
              </div>
            )}
            {ordersError && (
              <div className="m-4 bg-red-50 border border-red-200 rounded-lg p-3 flex items-center space-x-2">
                <AlertCircle className="h-4 w-4 text-red-600 flex-shrink-0" />
                <p className="text-sm text-red-700">{ordersError}</p>
              </div>
            )}
            {orders.length > 0 && (
              <div className="p-4 border-b border-gray-100">
                <div className="relative max-w-md">
                  <Search className="h-4 w-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type="text"
                    value={orderSearch}
                    onChange={(e) => setOrderSearch(e.target.value)}
                    placeholder="Rechercher par n° de commande, client, article, statut..."
                    className="w-full pl-9 pr-9 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-gray-400"
                  />
                  {orderSearch && (
                    <button
                      type="button"
                      onClick={() => setOrderSearch('')}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 p-0.5 text-gray-400 hover:text-gray-700 rounded"
                      title="Effacer la recherche"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
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
                    <th className="text-left py-3 px-4 md:px-6 font-medium text-gray-900 text-sm">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {ordersLoading ? (
                    [...Array(3)].map((_, i) => (
                      <tr key={`skeleton-${i}`} className="border-b border-gray-50">
                        <td className="py-4 px-4 md:px-6" colSpan={7}>
                          <div className="h-4 w-full bg-gray-100 rounded animate-pulse" />
                        </td>
                      </tr>
                    ))
                  ) : orders.length === 0 ? (
                    <tr>
                      <td className="py-8 px-4 md:px-6 text-center text-sm text-gray-500" colSpan={7}>
                        Aucune commande pour ce revendeur.
                      </td>
                    </tr>
                  ) : filteredOrders.length === 0 ? (
                    <tr>
                      <td className="py-8 px-4 md:px-6 text-center text-sm text-gray-500" colSpan={7}>
                        Aucune commande trouvée pour cette recherche.
                      </td>
                    </tr>
                  ) : (
                    filteredOrders.map((order) => (
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
                        <td className="py-3 px-4 md:px-6">
                          <button
                            onClick={() => setViewingOrder(order)}
                            className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                            title="Voir les détails de la commande"
                          >
                            <Eye className="h-4 w-4" />
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

      {activeTab === 'wallet' && (
        <div className="space-y-4">
          {!primaryContact ? (
            <Card>
              <CardContent className="p-6 text-center text-sm text-gray-500">
                Aucun contact principal pour cette société — le portefeuille B2B lui sera rattaché dès qu'un contact principal existera.
              </CardContent>
            </Card>
          ) : (
            <>
              {contacts.length > 1 && (
                <div className="flex items-center gap-2">
                  <label className="text-sm text-gray-600 flex-shrink-0">Sous-compte :</label>
                  <select
                    value={selectedContact?.id || ''}
                    onChange={(e) => setSelectedContactId(e.target.value)}
                    className="px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-gray-400 bg-white"
                  >
                    {contacts.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.first_name} {c.last_name}{c.is_primary ? ' (Principal)' : ''}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <Card>
                <CardContent className="p-4 flex items-center justify-between gap-4 flex-wrap">
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-lg bg-gray-900 flex items-center justify-center flex-shrink-0">
                      <Wallet className="h-5 w-5 text-white" />
                    </div>
                    <div>
                      <p className="text-xs text-gray-500">Solde B2B ({selectedContact?.first_name} {selectedContact?.last_name})</p>
                      <p className="text-xl font-semibold text-gray-900">
                        {wallet.loading ? '—' : wallet.balance.toFixed(2)} €
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => setShowAdjustModal(true)}
                    className="flex items-center space-x-2 px-4 py-2 bg-gray-900 text-white rounded-lg hover:bg-gray-800 transition-colors text-sm"
                  >
                    <Settings2 className="h-4 w-4" />
                    <span>Ajuster le solde</span>
                  </button>
                </CardContent>
              </Card>

              {wallet.error && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-center space-x-3">
                  <AlertCircle className="h-5 w-5 text-red-600 flex-shrink-0" />
                  <p className="text-sm text-red-700">Erreur : {wallet.error}</p>
                </div>
              )}

              <Card>
                <CardContent className="p-0">
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead>
                        <tr className="border-b border-gray-100">
                          <th className="text-left py-3 px-4 md:px-6 font-medium text-gray-900 text-sm">Date</th>
                          <th className="text-left py-3 px-4 md:px-6 font-medium text-gray-900 text-sm">Type</th>
                          <th className="text-left py-3 px-4 md:px-6 font-medium text-gray-900 text-sm hidden md:table-cell">Note</th>
                          <th className="text-right py-3 px-4 md:px-6 font-medium text-gray-900 text-sm">Montant</th>
                          <th className="text-left py-3 px-4 md:px-6 font-medium text-gray-900 text-sm">Statut</th>
                        </tr>
                      </thead>
                      <tbody>
                        {wallet.loading ? (
                          [...Array(2)].map((_, i) => (
                            <tr key={`skeleton-${i}`} className="border-b border-gray-50">
                              <td className="py-4 px-4 md:px-6" colSpan={5}>
                                <div className="h-4 w-full bg-gray-100 rounded animate-pulse" />
                              </td>
                            </tr>
                          ))
                        ) : wallet.transactions.length === 0 ? (
                          <tr>
                            <td className="py-8 px-4 md:px-6 text-center text-sm text-gray-500" colSpan={5}>
                              Aucune transaction pour l'instant.
                            </td>
                          </tr>
                        ) : (
                          wallet.transactions.map((tx) => {
                            const isNegative = tx.type === 'achat' || (tx.type === 'ajustement_admin' && tx.amount < 0);
                            const icon = tx.type === 'rechargement' ? (
                              <ArrowUpCircle className="h-4 w-4 text-green-600" />
                            ) : tx.type === 'remboursement' ? (
                              <RotateCcw className="h-4 w-4 text-blue-600" />
                            ) : tx.type === 'ajustement_admin' ? (
                              <Settings2 className="h-4 w-4 text-purple-600" />
                            ) : (
                              <ArrowDownCircle className="h-4 w-4 text-gray-500" />
                            );
                            const typeLabel = tx.type === 'rechargement' ? 'Recharge' : tx.type === 'achat' ? `Achat${tx.order_id ? ' commande' : ''}` : tx.type === 'remboursement' ? 'Remboursement' : 'Ajustement admin';
                            return (
                              <tr key={tx.id} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                                <td className="py-3 px-4 md:px-6 text-sm text-gray-600">{new Date(tx.created_at).toLocaleString('fr-FR')}</td>
                                <td className="py-3 px-4 md:px-6">
                                  <div className="flex items-center gap-2 text-sm text-gray-900">
                                    {icon}
                                    {typeLabel}
                                  </div>
                                </td>
                                <td className="py-3 px-4 md:px-6 hidden md:table-cell text-sm text-gray-500">{tx.note || '—'}</td>
                                <td className={`py-3 px-4 md:px-6 text-right text-sm font-semibold ${isNegative ? 'text-red-600' : 'text-green-600'}`}>
                                  {isNegative ? '-' : '+'}{Math.abs(tx.amount).toFixed(2)} €
                                </td>
                                <td className="py-3 px-4 md:px-6">
                                  {tx.status === 'pending' && <Badge variant="warning">En attente</Badge>}
                                  {tx.status === 'failed' && <Badge variant="danger">Échec</Badge>}
                                  {tx.status === 'success' && <Badge variant="success">Réussi</Badge>}
                                </td>
                              </tr>
                            );
                          })
                        )}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            </>
          )}
        </div>
      )}

      {activeTab === 'sourcing' && (
        <SourcingMissionsTab resellerId={currentReseller.id} resellerName={currentReseller.company_name} isAdmin={isAdmin} />
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

      <B2BOrderDetailModal
        order={viewingOrder}
        onClose={() => setViewingOrder(null)}
        onOrderUpdated={refreshOrders}
      />

      <ResellerFormModal
        isOpen={showEditModal}
        reseller={currentReseller}
        onClose={() => setShowEditModal(false)}
        onSaved={handleResellerSaved}
      />

      <ResellerContactEditModal
        contact={editingContact}
        onClose={() => setEditingContact(null)}
        onSave={handleSaveContact}
      />

      <WalletAdjustModal
        isOpen={showAdjustModal}
        currentBalance={wallet.balance}
        onClose={() => setShowAdjustModal(false)}
        onSubmit={wallet.adjustBalance}
      />
    </div>
  );
};
