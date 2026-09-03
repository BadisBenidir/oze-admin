import React, { useState } from 'react';
import { X, MapPin, Package, User, Phone, Truck, FileDown, ExternalLink, Undo2, BadgeCheck, Split, ArrowRight, RefreshCw } from 'lucide-react';
import { Badge } from '../../ui/Badge';
import { AdminShipment, AdminShipmentItem } from '../../../hooks/useAdminShipments';
import { ParcelSplitEditor } from './ParcelSplitEditor';
import { useDownloadShipmentLabel } from '../../../hooks/useDownloadShipmentLabel';
import { useSendcloudSync } from '../../../hooks/useSendcloudSync';
import { supabase } from '../../../lib/supabase';

interface ShipmentDetailModalProps {
  shipment: AdminShipment | null;
  onClose: () => void;
  onGenerated: () => void;
}

const itemRef = (item: AdminShipmentItem) =>
  item.product?.b2b_reference || item.product?.reference || item.product?.product_code || '—';

// Même heuristique que generate-b2b-shipment-labels/index.ts::toCountryCode :
// un code postal à 4 chiffres n'existe JAMAIS en France (toujours 5
// chiffres) — ce signal prime sur un pays enregistré, y compris "FR", qui
// peut être un défaut silencieux erroné posé au moment de la demande (voir
// sendcloudService.ts::mapServicePoint). Sert uniquement à présélectionner
// le bon transporteur dans ParcelSplitEditor ; le calcul faisant foi pour
// la génération reste côté edge function.
const guessRelayCountry = (pp: Record<string, unknown> | null): string | null => {
  if (!pp) return null;
  const zip = String(pp.zipCode || '').trim();
  if (/^\d{4}$/.test(zip)) return 'BE';
  const raw = String(pp.country || '').trim();
  return raw ? raw.toUpperCase() : (/^\d{5}$/.test(zip) ? 'FR' : null);
};

const itemFulfillmentBadge = (status: AdminShipmentItem['fulfillment_status']) => {
  switch (status) {
    case 'label_created':
      return <Badge variant="warning">En préparation</Badge>;
    case 'shipped':
      return <Badge variant="info">Expédié / En transit</Badge>;
    case 'delivered':
      return <Badge variant="success">Livré</Badge>;
    default:
      return null;
  }
};

interface ShippedItemRowProps {
  item: AdminShipmentItem;
  onRevert: (itemId: string) => void;
  reverting: boolean;
  /** Mode scission actif : remplace le bouton "Annuler" par une case à
   * cocher pour choisir les articles à déplacer vers un nouveau colis. */
  splitMode: boolean;
  selected: boolean;
  onToggleSelect: (itemId: string) => void;
}

const ShippedItemRow: React.FC<ShippedItemRowProps> = ({ item, onRevert, reverting, splitMode, selected, onToggleSelect }) => {
  const product = item.product;
  const image = product?.images?.[product.main_image_index] || product?.images?.[0];
  return (
    <div className="flex items-center gap-3 py-2 border-b border-gray-50 last:border-b-0">
      {splitMode && item.fulfillment_status !== 'delivered' && (
        <input
          type="checkbox"
          checked={selected}
          onChange={() => onToggleSelect(item.id)}
          className="h-4 w-4 rounded border-gray-300 text-gray-900 focus:ring-gray-400 flex-shrink-0"
        />
      )}
      {image ? (
        <img src={image} alt={product?.name || 'Article'} className="h-10 w-10 rounded-lg object-cover flex-shrink-0 border border-gray-100" />
      ) : (
        <div className="h-10 w-10 rounded-lg bg-gray-100 flex-shrink-0" />
      )}
      <div className="min-w-0 flex-1">
        <p className="text-sm text-gray-900 font-medium truncate">{product?.name || 'Article'}</p>
        <p className="text-xs text-gray-500">
          {product?.brand?.name && <span>{product.brand.name} · </span>}
          Réf. {itemRef(item)}
        </p>
        <div className="mt-1 flex items-center gap-1.5 flex-wrap">
          {itemFulfillmentBadge(item.fulfillment_status)}
          {item.entrupy_requested && (
            <Badge variant="purple">
              <BadgeCheck className="h-3 w-3 mr-1" /> Certificat Entrupy
            </Badge>
          )}
        </div>
      </div>
      {/* Le retour en arrière n'a plus de sens physique une fois le colis
          réellement pris en charge/livré (fulfillment_status 'shipped'/
          'delivered') — admin_revert_item_to_received le refuserait de
          toute façon, autant ne pas offrir un bouton qui échouerait. */}
      {!splitMode && item.fulfillment_status === 'label_created' && (
        <button
          type="button"
          onClick={() => onRevert(item.id)}
          disabled={reverting}
          title="Annuler cette préparation (remet en attente côté réception)"
          className="p-1.5 text-gray-400 hover:text-amber-600 hover:bg-amber-50 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex-shrink-0"
        >
          <Undo2 className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
};

export const ShipmentDetailModal: React.FC<ShipmentDetailModalProps> = ({ shipment, onClose, onGenerated }) => {
  const { download: downloadLabel, downloadingUrl } = useDownloadShipmentLabel();
  const { sync: syncSendcloud } = useSendcloudSync();
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [revertingId, setRevertingId] = useState<string | null>(null);
  const [revertError, setRevertError] = useState<string | null>(null);
  // Scinder l'expédition : sélectionner des articles déjà expédiés (colis 1)
  // pour les faire basculer dans un nouveau colis, sans toucher au premier —
  // voir admin_unassign_items_from_parcel (0085). Une fois libérés, ils
  // réapparaissent automatiquement dans "articles en attente" ci-dessus, où
  // ParcelSplitEditor (déjà fonctionnel pour un tout premier envoi) permet
  // de leur générer l'étiquette.
  const [splitMode, setSplitMode] = useState(false);
  const [selectedForSplit, setSelectedForSplit] = useState<Set<string>>(new Set());
  const [splitting, setSplitting] = useState(false);
  const [splitError, setSplitError] = useState<string | null>(null);

  if (!shipment) return null;

  const handleRevertShippedItem = async (itemId: string) => {
    if (!window.confirm("Annuler cette expédition ? L'article redeviendra 'reçu' côté réception, même si un bordereau a déjà été généré pour lui.")) {
      return;
    }
    setRevertError(null);
    setRevertingId(itemId);
    const { data, error } = await supabase.rpc('admin_revert_item_to_received', { p_item_ids: [itemId] });
    setRevertingId(null);
    if (error) {
      setRevertError(error.message);
      return;
    }
    if ((data?.updated_count || 0) === 0) {
      setRevertError("Cet article n'a pas pu être annulé.");
      return;
    }
    onGenerated();
  };

  const handleSyncSendcloud = async () => {
    setSyncError(null);
    setSyncing(true);
    const result = await syncSendcloud(shipment.id);
    setSyncing(false);
    if (!result.success) {
      setSyncError(result.error || 'Impossible de contacter Sendcloud');
      return;
    }
    onGenerated();
  };

  const toggleSplitMode = () => {
    setSplitMode((current) => !current);
    setSelectedForSplit(new Set());
    setSplitError(null);
  };

  const toggleSelectForSplit = (itemId: string) => {
    setSelectedForSplit((current) => {
      const next = new Set(current);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
  };

  const handleCreateNewParcel = async () => {
    if (selectedForSplit.size === 0) return;
    setSplitError(null);
    setSplitting(true);
    const { data, error } = await supabase.rpc('admin_unassign_items_from_parcel', { p_item_ids: [...selectedForSplit] });
    setSplitting(false);
    if (error) {
      setSplitError(error.message);
      return;
    }
    if ((data?.updated_count || 0) === 0) {
      setSplitError("Ces articles n'ont pas pu être déplacés vers un nouveau colis.");
      return;
    }
    setSplitMode(false);
    setSelectedForSplit(new Set());
    onGenerated();
  };

  const pp = (shipment.parcel_point || {}) as Record<string, string>;
  // Tout colis avec un VRAI objet Sendcloud (étiquette créée, peu importe son
  // avancement réel) — 'pending'/'failed' n'ont jamais existé côté
  // transporteur, rien à montrer/télécharger pour eux.
  const realParcels = shipment.parcels.filter((p) => p.status === 'label_created' || p.status === 'shipped' || p.status === 'delivered');
  const itemCountByParcel = new Map<string, number>();
  for (const item of shipment.shippedItems) {
    if (!item.parcel_id) continue;
    itemCountByParcel.set(item.parcel_id, (itemCountByParcel.get(item.parcel_id) || 0) + 1);
  }
  const pendingItemsKey = shipment.pendingItems.map((i) => i.id).sort().join(',');

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="flex min-h-full items-center justify-center p-4">
        <div className="fixed inset-0 bg-black bg-opacity-25" onClick={onClose} />

        <div className="relative bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-start justify-between p-6 border-b border-gray-100">
            <div>
              <h3 className="text-lg font-semibold text-gray-900">{shipment.requester.fullName}</h3>
              <p className="text-sm text-gray-500 mt-1">
                {shipment.companyName} — demandé le {new Date(shipment.requested_at).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' })}
              </p>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              {realParcels.length > 0 && (
                <button
                  onClick={handleSyncSendcloud}
                  disabled={syncing}
                  title="Interroge Sendcloud pour rafraîchir le statut réel des colis de cette demande"
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${syncing ? 'animate-spin' : ''}`} />
                  {syncing ? 'Actualisation...' : 'Actualiser les statuts Sendcloud'}
                </button>
              )}
              <button onClick={onClose} className="p-2 text-gray-400 hover:text-gray-600 rounded-lg transition-colors">
                <X className="h-5 w-5" />
              </button>
            </div>
          </div>

          <div className="p-6 space-y-6">
            {syncError && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-3">
                <p className="text-sm text-red-700">{syncError}</p>
              </div>
            )}
            <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 flex items-start gap-2">
              <MapPin className="h-4 w-4 text-gray-400 flex-shrink-0 mt-0.5" />
              <div className="text-sm text-gray-900">
                {shipment.delivery_type === 'point_relais' ? (
                  <>
                    <p className="font-medium">{pp.name || 'Point Relais'}</p>
                    {pp.address && <p>{pp.address}</p>}
                    <p>{pp.zipCode} {pp.city}</p>
                    {pp.network && <p className="text-xs text-gray-500 mt-1">{pp.network}</p>}
                  </>
                ) : (
                  <>
                    <p className="font-medium flex items-center gap-1.5">
                      <User className="h-3.5 w-3.5 text-gray-400" /> {shipment.requester.fullName}
                    </p>
                    {shipment.requester.address && <p>{shipment.requester.address}</p>}
                    <p>{shipment.requester.postalCode} {shipment.requester.city}</p>
                    {shipment.requester.country && <p>{shipment.requester.country}</p>}
                    {shipment.requester.phone && (
                      <p className="text-xs text-gray-500 mt-1 flex items-center gap-1">
                        <Phone className="h-3 w-3" /> {shipment.requester.phone}
                      </p>
                    )}
                  </>
                )}
                {shipment.delivery_instructions && (
                  <p className="text-xs text-gray-500 mt-1 italic">{shipment.delivery_instructions}</p>
                )}
              </div>
            </div>

            {shipment.pendingItems.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2 flex items-center gap-1.5">
                  <Package className="h-3.5 w-3.5" /> {shipment.pendingItems.length} article{shipment.pendingItems.length > 1 ? 's' : ''} en attente
                </p>
                <ParcelSplitEditor
                  key={pendingItemsKey}
                  shipmentId={shipment.id}
                  items={shipment.pendingItems}
                  requesterPhone={shipment.requester.phone}
                  deliveryType={shipment.delivery_type}
                  parcelPointNetwork={shipment.parcel_point ? String((shipment.parcel_point as Record<string, unknown>).network || '') || null : null}
                  parcelPointCountry={guessRelayCountry(shipment.parcel_point)}
                  onGenerated={onGenerated}
                />
              </div>
            )}

            {revertError && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-3">
                <p className="text-sm text-red-700">{revertError}</p>
              </div>
            )}

            {shipment.shippedItems.length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide flex items-center gap-1.5">
                    <Truck className="h-3.5 w-3.5" /> {shipment.shippedItems.length} article{shipment.shippedItems.length > 1 ? 's' : ''} déjà en colis
                  </p>
                  <button
                    type="button"
                    onClick={toggleSplitMode}
                    className="flex items-center gap-1.5 text-xs font-medium text-gray-600 hover:text-gray-900"
                  >
                    <Split className="h-3.5 w-3.5" />
                    {splitMode ? 'Annuler' : "Ajouter un nouveau colis"}
                  </button>
                </div>

                {splitMode && (
                  <p className="text-xs text-gray-500 mb-2">
                    Cochez les articles à déplacer vers un nouveau colis (ex. les articles qui ne rentraient pas dans le premier carton) — le colis déjà expédié n'est pas modifié.
                  </p>
                )}

                <div className="border border-gray-100 rounded-lg px-3 mb-3">
                  {shipment.shippedItems.map((item) => (
                    <ShippedItemRow
                      key={item.id}
                      item={item}
                      onRevert={handleRevertShippedItem}
                      reverting={revertingId === item.id}
                      splitMode={splitMode}
                      selected={selectedForSplit.has(item.id)}
                      onToggleSelect={toggleSelectForSplit}
                    />
                  ))}
                </div>

                {splitMode && (
                  <>
                    {splitError && (
                      <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-3">
                        <p className="text-sm text-red-700">{splitError}</p>
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={handleCreateNewParcel}
                      disabled={selectedForSplit.size === 0 || splitting}
                      className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-gray-900 text-white rounded-lg hover:bg-gray-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-sm mb-3"
                    >
                      <ArrowRight className="h-4 w-4" />
                      {splitting
                        ? 'Déplacement en cours...'
                        : `Passer ${selectedForSplit.size || ''} article${selectedForSplit.size > 1 ? 's' : ''} en nouveau colis`}
                    </button>
                  </>
                )}
              </div>
            )}

            {/* Conservé même si tous les articles ont depuis été annulés : le
                colis a réellement été créé chez Sendcloud, ce n'est pas parce
                que la réception est corrigée après coup que ce justificatif
                doit disparaître. */}
            {realParcels.length > 0 && (
              <div className="space-y-2">
                {realParcels.map((p) => (
                  <div key={p.id} className="rounded-lg p-3 border bg-gray-50 border-gray-200">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-medium text-gray-900 flex items-center gap-2 flex-wrap">
                        <span>
                          Colis {p.parcel_index}
                          {itemCountByParcel.has(p.id) && (
                            <span className="font-normal text-gray-500"> ({itemCountByParcel.get(p.id)} article{(itemCountByParcel.get(p.id) || 0) > 1 ? 's' : ''})</span>
                          )}
                        </span>
                        {p.status === 'label_created' && <Badge variant="warning">En préparation</Badge>}
                        {p.status === 'shipped' && <Badge variant="info">Expédié / En transit</Badge>}
                        {p.status === 'delivered' && <Badge variant="success">Livré</Badge>}
                      </p>
                      {p.label_url && (
                        <button
                          type="button"
                          onClick={() => downloadLabel(p.label_url!)}
                          disabled={downloadingUrl === p.label_url}
                          className="flex items-center gap-1 text-xs text-gray-600 underline hover:text-gray-900 disabled:opacity-50"
                        >
                          <FileDown className="h-3.5 w-3.5" /> {downloadingUrl === p.label_url ? 'Ouverture...' : "Réimprimer l'étiquette"}
                        </button>
                      )}
                    </div>
                    {p.tracking_number && (
                      <p className="text-xs text-gray-600 mt-1">
                        Suivi : {p.tracking_number}{' '}
                        {p.tracking_url && (
                          <a href={p.tracking_url} target="_blank" rel="noopener noreferrer" className="underline inline-flex items-center gap-0.5">
                            <ExternalLink className="h-3 w-3" />
                          </a>
                        )}
                      </p>
                    )}
                    {p.carrier_status_message && (
                      <p className="text-xs text-gray-400 mt-1 italic">Dernier statut transporteur : {p.carrier_status_message}</p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default ShipmentDetailModal;
