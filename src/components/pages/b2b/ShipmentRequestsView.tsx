import React, { useEffect, useMemo, useState } from 'react';
import { Card, CardContent } from '../../ui/Card';
import { Badge } from '../../ui/Badge';
import { useAdminAuth } from '../../../hooks/useAdminAuth';
import { useAdminShipments, AdminShipment } from '../../../hooks/useAdminShipments';
import { useSendcloudSync } from '../../../hooks/useSendcloudSync';
import { ShipmentDetailModal } from './ShipmentDetailModal';
import { AlertCircle, Truck, Eye, CheckCircle, RefreshCw, Package, Search, X } from 'lucide-react';

// Insensible aux accents et à la casse — même pattern que B2BOrders.tsx.
const DIACRITICS_REGEX = new RegExp('[\u0300-\u036f]', 'g');
const normalizeSearch = (value: string): string =>
  value.normalize('NFD').replace(DIACRITICS_REGEX, '').toLowerCase().trim();

// Tout ce qu'on peut vouloir retrouver dans une demande : demandeur,
// entreprise, adresse / point relais, articles (nom, marque, références),
// n° de commande et n° de suivi.
const shipmentHaystack = (s: AdminShipment): string => {
  const pp = (s.parcel_point || {}) as Record<string, unknown>;
  const items = [...s.pendingItems, ...s.shippedItems];
  return normalizeSearch([
    s.requester.fullName, s.requester.email, s.requester.phone, s.companyName,
    s.requester.city, s.requester.postalCode,
    pp.name, pp.city, pp.zipCode,
    ...items.flatMap((i) => [i.product?.name, i.product?.brand?.name, i.product?.b2b_reference, i.product?.reference, i.product?.product_code, i.order?.order_number]),
    ...s.parcels.map((p) => p.tracking_number),
  ].filter(Boolean).join(' '));
};

const statusBadge = (status: AdminShipment['status']) => {
  if (status === 'preparing') return <Badge variant="warning">En préparation</Badge>;
  if (status === 'in_transit') return <Badge variant="info">Expédié / En transit</Badge>;
  if (status === 'delivered') return <Badge variant="successStrong">Livré</Badge>;
  return <Badge variant="info">Livraison demandée</Badge>;
};

type Tab = 'requested' | 'preparing' | 'in_transit' | 'delivered';

const TAB_CONFIG: Record<Tab, { label: string; emptyTitle: string; emptyIcon: React.ReactNode }> = {
  requested: {
    label: 'En attente',
    emptyTitle: 'Aucune demande de livraison en attente.',
    emptyIcon: <Truck className="h-10 w-10 text-gray-300 mx-auto mb-3" />,
  },
  preparing: {
    label: 'En préparation',
    emptyTitle: 'Aucun bordereau en attente de dépôt chez le transporteur.',
    emptyIcon: <Package className="h-10 w-10 text-gray-300 mx-auto mb-3" />,
  },
  in_transit: {
    label: 'Expédiées / En transit',
    emptyTitle: 'Aucun colis en transit pour le moment.',
    emptyIcon: <Truck className="h-10 w-10 text-gray-300 mx-auto mb-3" />,
  },
  delivered: {
    label: 'Livrées',
    emptyTitle: 'Aucune livraison confirmée pour le moment.',
    emptyIcon: <CheckCircle className="h-10 w-10 text-gray-300 mx-auto mb-3" />,
  },
};

export const ShipmentRequestsView: React.FC = () => {
  const { isAdmin } = useAdminAuth();
  const [tab, setTab] = useState<Tab>('requested');

  // Un hook par statut plutôt qu'un seul filtré dynamiquement : chaque onglet
  // a besoin de son propre compteur affiché EN PERMANENCE (pas seulement
  // celui actif), donc les 4 listes doivent être chargées en parallèle.
  const requestedData = useAdminShipments(isAdmin, ['requested']);
  const preparingData = useAdminShipments(isAdmin, ['preparing']);
  const inTransitData = useAdminShipments(isAdmin, ['in_transit']);
  const deliveredData = useAdminShipments(isAdmin, ['delivered']);

  const dataByTab: Record<Tab, ReturnType<typeof useAdminShipments>> = {
    requested: requestedData,
    preparing: preparingData,
    in_transit: inTransitData,
    delivered: deliveredData,
  };
  const { shipments: tabShipments, loading, error } = dataByTab[tab];
  const [search, setSearch] = useState('');
  const shipments = useMemo(() => {
    const query = normalizeSearch(search);
    if (!query) return tabShipments;
    return tabShipments.filter((s) => shipmentHaystack(s).includes(query));
  }, [tabShipments, search]);
  // Pendant une recherche, chaque onglet affiche son nombre de résultats —
  // permet de voir tout de suite dans quel onglet se trouve la demande.
  const countFor = (t: Tab) => {
    const query = normalizeSearch(search);
    const list = dataByTab[t].shipments;
    return query ? list.filter((s) => shipmentHaystack(s).includes(query)).length : list.length;
  };

  const refreshAll = () => {
    requestedData.refresh();
    preparingData.refresh();
    inTransitData.refresh();
    deliveredData.refresh();
  };

  const { sync: syncSendcloud } = useSendcloudSync();
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [syncProgress, setSyncProgress] = useState<{ checked: number; updated: number } | null>(null);

  const handleSyncAll = async () => {
    setSyncError(null);
    setSyncProgress(null);
    setSyncing(true);
    // Sans shipmentId : balaie tout l'arriéré, en plusieurs appels internes
    // tant que le serveur signale qu'il en reste (voir useSendcloudSync) —
    // reste un seul clic côté admin même sur un gros arriéré.
    const result = await syncSendcloud(undefined, setSyncProgress);
    setSyncing(false);
    refreshAll();
    if (!result.success) {
      setSyncError(result.error || 'Impossible de contacter Sendcloud');
      return;
    }
    if (result.incomplete) {
      setSyncError(`Arriéré important : ${result.checked} colis vérifiés (${result.updated} mis à jour), relance encore pour continuer.`);
    }
  };

  const [viewingId, setViewingId] = useState<string | null>(null);
  // Snapshot indépendant de la liste filtrée par onglet : dès qu'un shipment
  // change de statut (nouvelle étiquette, prise en charge, livraison...), il
  // quitte l'onglet où il était affiché — sans ce snapshot, la modale se
  // refermerait brutalement en pleine confirmation de succès (bug signalé :
  // la demande "disparaît" et devient introuvable). On garde la dernière
  // version connue affichée, et on la met à jour dès qu'une donnée plus
  // fraîche est dispo (dans n'importe lequel des 4 onglets).
  const [viewingSnapshot, setViewingSnapshot] = useState<AdminShipment | null>(null);

  useEffect(() => {
    if (!viewingId) return;
    const fresh = requestedData.shipments.find((s) => s.id === viewingId)
      || preparingData.shipments.find((s) => s.id === viewingId)
      || inTransitData.shipments.find((s) => s.id === viewingId)
      || deliveredData.shipments.find((s) => s.id === viewingId);
    if (fresh) setViewingSnapshot(fresh);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestedData.shipments, preparingData.shipments, inTransitData.shipments, deliveredData.shipments, viewingId]);

  const openShipment = (shipment: AdminShipment) => {
    setViewingId(shipment.id);
    setViewingSnapshot(shipment);
  };
  const closeShipment = () => {
    setViewingId(null);
    setViewingSnapshot(null);
  };

  const handleGenerated = () => {
    // Une action (génération d'étiquette, scission de colis...) peut faire
    // changer le statut du shipment : il change d'onglet — on rafraîchit les
    // 4 listes, jamais seulement celle de l'onglet actif.
    refreshAll();
  };

  return (
    <div className="p-4 md:p-6">
      <div className="mb-6 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h3 className="text-lg font-semibold text-gray-900">Demandes de livraison</h3>
          <p className="text-sm text-gray-500">{loading ? 'Chargement...' : `${tabShipments.length} demande${tabShipments.length > 1 ? 's' : ''}`}</p>
        </div>
        <button
          onClick={handleSyncAll}
          disabled={syncing}
          title="Interroge Sendcloud pour rafraîchir le statut réel de tous les colis en cours"
          className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`h-4 w-4 ${syncing ? 'animate-spin' : ''}`} />
          {syncing
            ? syncProgress
              ? `Actualisation... (${syncProgress.checked} vérifiés)`
              : 'Actualisation...'
            : 'Actualiser les statuts Sendcloud'}
        </button>
      </div>

      {syncError && (
        <div className="mb-4 bg-amber-50 border border-amber-200 rounded-lg p-3">
          <p className="text-sm text-amber-800">{syncError}</p>
        </div>
      )}

      <div className="mb-4 flex items-center gap-1 border-b border-gray-100 overflow-x-auto">
        {(Object.keys(TAB_CONFIG) as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors whitespace-nowrap ${
              tab === t ? 'border-gray-900 text-gray-900' : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {TAB_CONFIG[t].label} ({dataByTab[t].loading ? '…' : countFor(t)})
          </button>
        ))}
      </div>

      <div className="mb-4 relative max-w-md">
        <Search className="h-4 w-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Rechercher un nom, une commande, un article, un n° de suivi..."
          className="w-full pl-9 pr-9 py-2 border border-gray-200 rounded-lg focus:outline-none focus:border-gray-400 text-sm"
        />
        {search && (
          <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-gray-600" title="Effacer">
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {error && (
        <div className="mb-6 bg-red-50 border border-red-200 rounded-lg p-4 flex items-center space-x-3">
          <AlertCircle className="h-5 w-5 text-red-600 flex-shrink-0" />
          <p className="text-sm text-red-700">Erreur : {error}</p>
        </div>
      )}

      {!loading && !error && shipments.length === 0 && (
        <div className="text-center py-16 border border-dashed border-gray-200 rounded-lg">
          {search.trim() ? <Search className="h-10 w-10 text-gray-300 mx-auto mb-3" /> : TAB_CONFIG[tab].emptyIcon}
          <p className="text-sm text-gray-500">
            {search.trim() ? `Aucune demande ne correspond à « ${search.trim()} » dans cet onglet.` : TAB_CONFIG[tab].emptyTitle}
          </p>
        </div>
      )}

      {(shipments.length > 0 || loading) && (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-100">
                    <th className="text-left py-3 px-4 md:px-6 font-medium text-gray-900 text-sm">Demandeur</th>
                    <th className="text-left py-3 px-4 md:px-6 font-medium text-gray-900 text-sm">Demandée le</th>
                    <th className="text-left py-3 px-4 md:px-6 font-medium text-gray-900 text-sm hidden md:table-cell">Articles</th>
                    <th className="text-left py-3 px-4 md:px-6 font-medium text-gray-900 text-sm">Statut</th>
                    <th className="text-left py-3 px-4 md:px-6 font-medium text-gray-900 text-sm">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    [...Array(3)].map((_, i) => (
                      <tr key={`skeleton-${i}`} className="border-b border-gray-50">
                        <td className="py-4 px-4 md:px-6" colSpan={5}>
                          <div className="h-4 w-full bg-gray-100 rounded animate-pulse" />
                        </td>
                      </tr>
                    ))
                  ) : (
                    shipments.map((shipment) => {
                      const articleCount = tab === 'requested' ? shipment.pendingItems.length : shipment.shippedItems.length;
                      return (
                        <tr key={shipment.id} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                          <td className="py-4 px-4 md:px-6 text-sm">
                            <p className="text-gray-900 font-medium">{shipment.requester.fullName}</p>
                            <p className="text-xs text-gray-500">{shipment.companyName}</p>
                          </td>
                          <td className="py-4 px-4 md:px-6 text-sm text-gray-600">{new Date(shipment.requested_at).toLocaleDateString('fr-FR')}</td>
                          <td className="py-4 px-4 md:px-6 hidden md:table-cell text-sm text-gray-600">
                            {articleCount} pièce{articleCount > 1 ? 's' : ''}
                          </td>
                          <td className="py-4 px-4 md:px-6">{statusBadge(shipment.status)}</td>
                          <td className="py-4 px-4 md:px-6">
                            <button
                              onClick={() => openShipment(shipment)}
                              className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                              title={tab === 'requested' ? 'Traiter la demande' : 'Voir le détail'}
                            >
                              <Eye className="h-4 w-4" />
                            </button>
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
      )}

      <ShipmentDetailModal
        shipment={viewingSnapshot}
        onClose={closeShipment}
        onGenerated={handleGenerated}
        activeShipments={[...requestedData.shipments, ...preparingData.shipments]}
      />
    </div>
  );
};

export default ShipmentRequestsView;
