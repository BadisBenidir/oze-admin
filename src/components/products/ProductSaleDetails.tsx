import React, { useState } from 'react';
import { Card, CardContent, CardHeader } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { useProductSaleDetails, ProductSaleDetails as SaleDetails } from '../../hooks/useProductSaleDetails';
import { Copy, Check, Truck, ExternalLink, FileDown } from 'lucide-react';

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
    case 'ordered':
    case 'received':
    case 'ready_to_ship':
    default:
      return <Badge variant="warning">Vendu — en attente de demande de livraison</Badge>;
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
  const { details, loading, error } = useProductSaleDetails(productId, reservedByOrderId);
  const [copied, setCopied] = useState(false);

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

        <div>
          <label className="text-sm font-medium text-gray-500">Statut de l'article</label>
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
        </div>
      </CardContent>
    </Card>
  );
};

export default ProductSaleDetails;
