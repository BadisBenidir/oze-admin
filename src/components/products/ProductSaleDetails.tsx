import React, { useState } from 'react';
import { Card, CardContent, CardHeader } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { useProductSaleDetails, ProductSaleDetails as SaleDetails } from '../../hooks/useProductSaleDetails';
import { useSendcloudSync } from '../../hooks/useSendcloudSync';
import { Copy, Check, Truck, ExternalLink, FileDown, RefreshCw, PackageCheck } from 'lucide-react';
import { supabase } from '../../lib/supabase';

interface ProductSaleDetailsProps {
  productId: string;
  reservedByOrderId: string | null;
}

const fulfillmentBadge = (details: SaleDetails) => {
  if (details.orderItemStatus === 'cancelled') return <Badge variant="danger">Article annulé</Badge>;
  switch (details.fulfillmentStatus) {
    case 'delivery_requested':
      return <Badge variant="info">Livraison demandée</Badge>;
    case 'label_created':
      return <Badge variant="warning">En préparation</Badge>;
    case 'shipped':
      return <Badge variant="info">Expédié / En transit</Badge>;
    case 'delivered':
      return <Badge variant="success">Livré</Badge>;
    case 'ready_to_ship':
      return <Badge variant="success">Prêt à la livraison — le client peut demander l'envoi</Badge>;
    case 'received':
      return <Badge variant="warning">Reçu — pas encore prêt à la livraison</Badge>;
    case 'ordered':
    default:
      return <Badge variant="warning">Vendu — pas encore réceptionné</Badge>;
  }
};

/**
 * Encart "Détails de la vente" affiché sur la fiche produit admin une fois
 * l'article vendu (products.reserved_by_order_id posé) : acheteur réel +
 * entreprise, référence de commande, et statut d'expédition — voir
 * useProductSaleDetails.ts pour la requête (order_items -> orders ->
 * profiles/resellers/shipment_parcels).
 */
export const ProductSaleDetails: React.FC<ProductSaleDetailsProps> = ({ productId, reservedByOrderId }) => {
  const { details, loading, error, refresh } = useProductSaleDetails(productId, reservedByOrderId);
  const { sync: syncSendcloud } = useSendcloudSync();
  const [copied, setCopied] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [updatingFulfillment, setUpdatingFulfillment] = useState(false);
  const [fulfillmentError, setFulfillmentError] = useState<string | null>(null);

  if (!reservedByOrderId) return null;
  if (loading) {
    return (
      <Card>
        <CardHeader>
          <h2 className="text-xl font-semibold">Détails de la vente</h2>
        </CardHeader>
        <CardContent>
          <div className="h-16 bg-gray-100 rounded animate-pulse" />
        </CardContent>
      </Card>
    );
  }
  if (error || !details) return null;

  const handleCopyOrderNumber = async () => {
    try {
      await navigator.clipboard.writeText(details.order.orderNumber);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Best-effort : rien à faire si le presse-papier est indisponible.
    }
  };

  const showRequesterSubtitle = Boolean(details.requesterName) && !details.requesterIsPrimary;

  // Réception d'un colis : même chaîne que la Vue Réception (0063/0070) —
  // un article encore « commandé » passe d'abord « reçu », puis « prêt »
  // (admin_mark_items_ready_to_ship n'accepte que des articles reçus).
  const isActiveItem = details.orderItemStatus !== 'cancelled';
  const canMarkReady = isActiveItem && ['ordered', 'received'].includes(details.fulfillmentStatus);
  const canRevert = isActiveItem && details.fulfillmentStatus === 'ready_to_ship';

  const runFulfillment = async (steps: { rpc: string; label: string }[]) => {
    setFulfillmentError(null);
    setUpdatingFulfillment(true);
    for (const step of steps) {
      const { data, error: rpcError } = await supabase.rpc(step.rpc, { p_item_ids: [details.orderItemId] });
      if (rpcError || !(data as { updated_count?: number } | null)?.updated_count) {
        setFulfillmentError(rpcError?.message || `Impossible de ${step.label} (commande hors B2B ou article déjà expédié ?)`);
        setUpdatingFulfillment(false);
        refresh();
        return;
      }
    }
    setUpdatingFulfillment(false);
    refresh();
  };

  const handleMarkReady = () =>
    runFulfillment([
      ...(details.fulfillmentStatus === 'ordered' ? [{ rpc: 'admin_mark_items_received', label: 'marquer l\'article reçu' }] : []),
      { rpc: 'admin_mark_items_ready_to_ship', label: 'marquer l\'article prêt à la livraison' },
    ]);

  const handleRevert = () => runFulfillment([{ rpc: 'admin_revert_item_to_received', label: 'remettre l\'article en attente' }]);

  const handleSyncSendcloud = async () => {
    setSyncError(null);
    setSyncing(true);
    const result = await syncSendcloud(details.shipmentId || undefined);
    setSyncing(false);
    if (!result.success) {
      setSyncError(result.error || 'Impossible de contacter Sendcloud');
      return;
    }
    refresh();
  };

  return (
    <Card>
      <CardHeader>
        <h2 className="text-xl font-semibold">Détails de la vente</h2>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <label className="text-sm font-medium text-gray-500">Acheteur / Revendeur</label>
          <div className="mt-1">
            {showRequesterSubtitle ? (
              <>
                <p className="font-medium text-gray-900">{details.requesterName}</p>
                <p className="text-xs text-gray-400">{details.order.companyName || '—'}</p>
              </>
            ) : (
              <p className="text-gray-900">{details.order.companyName || details.requesterName || '—'}</p>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="text-sm font-medium text-gray-500">Numéro de commande</label>
            <div className="mt-1 flex items-center gap-2">
              <p className="font-mono text-sm text-gray-900">{details.order.orderNumber}</p>
              <button
                type="button"
                onClick={handleCopyOrderNumber}
                title="Copier le numéro de commande"
                className="p-1 text-gray-400 hover:text-gray-700 transition-colors"
              >
                {copied ? <Check className="h-3.5 w-3.5 text-green-600" /> : <Copy className="h-3.5 w-3.5" />}
              </button>
            </div>
          </div>
          <div>
            <label className="text-sm font-medium text-gray-500">Date de la commande</label>
            <p className="text-sm text-gray-900 mt-1">
              {new Date(details.order.createdAt).toLocaleDateString('fr-FR', {
                day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit',
              })}
            </p>
          </div>
        </div>

        {syncError && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-3">
            <p className="text-sm text-red-700">{syncError}</p>
          </div>
        )}

        <div>
          <div className="flex items-center justify-between">
            <label className="text-sm font-medium text-gray-500">Statut de l'article</label>
            {details.parcel && (
              <button
                type="button"
                onClick={handleSyncSendcloud}
                disabled={syncing}
                title="Interroge Sendcloud pour rafraîchir le statut réel de ce colis"
                className="flex items-center gap-1 text-xs font-medium text-gray-500 hover:text-gray-800 disabled:opacity-50"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${syncing ? 'animate-spin' : ''}`} />
                {syncing ? 'Actualisation...' : 'Actualiser Sendcloud'}
              </button>
            )}
          </div>
          <div className="mt-1.5 flex items-center gap-2 flex-wrap">
            {fulfillmentBadge(details)}
            {details.parcel?.trackingNumber && (
              <span className="text-xs text-gray-500 flex items-center gap-1">
                <Truck className="h-3.5 w-3.5 text-gray-400" />
                Colis {details.parcel.parcelIndex} — {details.parcel.trackingNumber}
                {details.parcel.trackingUrl && (
                  <a
                    href={details.parcel.trackingUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-600 underline inline-flex items-center gap-0.5"
                  >
                    suivre <ExternalLink className="h-3 w-3" />
                  </a>
                )}
              </span>
            )}
            {details.parcel?.labelUrl && (
              <a
                href={details.parcel.labelUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-gray-600 underline inline-flex items-center gap-1"
              >
                <FileDown className="h-3 w-3" /> Étiquette
              </a>
            )}
          </div>
          {(canMarkReady || canRevert) && (
            <div className="mt-3 flex items-center gap-3 flex-wrap">
              {canMarkReady && (
                <button
                  type="button"
                  onClick={handleMarkReady}
                  disabled={updatingFulfillment}
                  className="flex items-center gap-1.5 px-4 py-2 bg-gray-900 text-white rounded-lg hover:bg-gray-800 transition-colors disabled:opacity-50 text-sm font-medium"
                >
                  <PackageCheck className="h-4 w-4" />
                  {updatingFulfillment ? 'Mise à jour...' : 'Marquer prêt à la livraison'}
                </button>
              )}
              {canRevert && (
                <button
                  type="button"
                  onClick={handleRevert}
                  disabled={updatingFulfillment}
                  title="Repasse l'article en « reçu » : le client ne peut plus demander sa livraison"
                  className="text-xs font-medium text-gray-500 hover:text-gray-800 underline disabled:opacity-50"
                >
                  {updatingFulfillment ? 'Mise à jour...' : 'Remettre en attente'}
                </button>
              )}
            </div>
          )}
          {fulfillmentError && <p className="mt-2 text-sm text-red-600">{fulfillmentError}</p>}
        </div>
      </CardContent>
    </Card>
  );
};

export default ProductSaleDetails;
