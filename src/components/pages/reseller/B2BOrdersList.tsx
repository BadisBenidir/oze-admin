import React, { useState } from 'react';
import { Card, CardContent } from '../../ui/Card';
import { Badge } from '../../ui/Badge';
import { MyB2BOrder, MyB2BOrderItem } from '../../../hooks/useMyB2BOrders';
import { useEntrupyCertificate } from '../../../hooks/useEntrupyCertificate';
import { FULFILLMENT_RANK } from '../../../hooks/useB2BOrders';
import { ShoppingBag, ImageOff, AlertCircle, Eye, X, Package, MapPin, Truck, FileDown, Ban, BadgeCheck } from 'lucide-react';
import { CancelMyOrderModal } from './CancelMyOrderModal';

interface ShipmentSummary {
  status: 'cancelled' | 'unpaid' | 'delivered' | 'shipped' | 'preparing' | 'in_stock' | 'confirmed';
  trackingNumber: string | null;
  trackingUrl: string | null;
}

/** Statut de livraison réel d'une commande B2B, déduit de
 * order_items.fulfillment_status (même règle que computeB2BOrderStatus,
 * useB2BOrders.ts — jamais orders.status, qui reste figé à 'confirmed' dès
 * le paiement et ne bouge plus jamais ensuite). Fusionne ici ce qu'affichait
 * l'ex-onglet "Suivi livraisons" (statut + tracking) directement dans "Mes
 * commandes", au lieu d'un onglet séparé. */
const computeShipmentSummary = (order: MyB2BOrder): ShipmentSummary => {
  if (order.status === 'cancelled') return { status: 'cancelled', trackingNumber: null, trackingUrl: null };
  if (order.payment_status !== 'paid') return { status: 'unpaid', trackingNumber: null, trackingUrl: null };

  const activeItems = order.order_items.filter((i) => i.status === 'active');
  if (activeItems.length === 0) return { status: 'cancelled', trackingNumber: null, trackingUrl: null };

  const ranks = activeItems.map((i) => FULFILLMENT_RANK[i.fulfillment_status] ?? 0);
  const minRank = Math.min(...ranks);
  const maxRank = Math.max(...ranks);

  // Numéro de suivi du colis le plus avancé parmi les articles actifs —
  // repli sur orders.tracking_number/tracking_url (ancien flux mono-colis)
  // si aucun order_items.shipment_parcel n'en porte.
  const mostAdvanced = [...activeItems].sort(
    (a, b) => (FULFILLMENT_RANK[b.fulfillment_status] ?? 0) - (FULFILLMENT_RANK[a.fulfillment_status] ?? 0)
  );
  const withTracking = mostAdvanced.find((i) => i.shipment_parcel?.tracking_number);
  const trackingNumber = withTracking?.shipment_parcel?.tracking_number || order.tracking_number || null;
  const trackingUrl = withTracking?.shipment_parcel?.tracking_url || order.tracking_url || null;

  let status: ShipmentSummary['status'] = 'confirmed';
  if (minRank === FULFILLMENT_RANK.delivered) status = 'delivered';
  else if (maxRank >= FULFILLMENT_RANK.shipped) status = 'shipped';
  else if (maxRank >= FULFILLMENT_RANK.delivery_requested) status = 'preparing';
  else if (maxRank >= FULFILLMENT_RANK.received) status = 'in_stock';

  return { status, trackingNumber, trackingUrl };
};

const shipmentStatusBadge = (status: ShipmentSummary['status']) => {
  switch (status) {
    case 'cancelled':
      return <Badge variant="danger">Annulée</Badge>;
    case 'unpaid':
      return <Badge variant="warning">En attente de paiement</Badge>;
    case 'delivered':
      return <Badge variant="success">Livrée</Badge>;
    case 'shipped':
      return <Badge variant="info">Expédiée</Badge>;
    case 'preparing':
      return <Badge variant="warning">En préparation</Badge>;
    case 'in_stock':
      return <Badge variant="default">Reçue en entrepôt</Badge>;
    default:
      return <Badge variant="info">Confirmée</Badge>;
  }
};

/** Un certificat ne peut plus être ajouté dès que la livraison de l'article a
 * été demandée — au-delà, le colis est déjà en préparation/parti et l'ajout
 * n'a plus de sens opérationnel. */
const canRequestEntrupy = (item: MyB2BOrderItem) =>
  item.status === 'active' && !item.entrupy_requested &&
  !['delivery_requested', 'label_created', 'shipped', 'delivered'].includes(item.fulfillment_status);

// `orders.shipping_address` est stocké dans la forme assemblée par
// b2b-checkout (address/postcode/city/country/pickup_point_*/delivery_type,
// voir deliveryAddress dans l'edge function) — PAS dans la forme brute
// {line1, postal_code} envoyée par CartPage, qui elle finit dans
// `billing_address`. Utiliser les mauvaises clés ici affichait une adresse
// de rue/CP vides sur toutes les commandes.
const formatAddress = (address: Record<string, unknown>) => {
  const isPointRelais = address?.delivery_type === 'point_relais';
  return {
    isPointRelais,
    street: (address?.address as string) || '',
    city: (address?.city as string) || '',
    postalCode: (address?.postcode as string) || '',
    country: (address?.country as string) || '',
    instructions: (address?.instructions as string) || '',
    pickupPointName: (address?.pickup_point_name as string) || '',
    pickupPointNetwork: (address?.pickup_point_network as string) || '',
    pickupPointAddress: (address?.pickup_point_address as string) || '',
  };
};

interface B2BOrdersListProps {
  orders: MyB2BOrder[];
  loading: boolean;
  error: string | null;
  emptyTitle?: string;
  emptyMessage?: string;
  /** Ouvre la fiche complète de l'article (même si vendu/archivé depuis). */
  onOpenProduct: (productId: string) => void;
  /**
   * N'active le bouton "Annuler" que pour SES PROPRES commandes (MyOrders.tsx) —
   * pas quand le contact principal consulte celles d'un coéquipier
   * (TeamMemberDetail.tsx), où le serveur refuserait de toute façon
   * (cancel-my-b2b-order-item vérifie placed_by_profile_id === auth.uid()).
   */
  canCancel?: boolean;
  /** Rafraîchit la liste du parent après une annulation réussie. */
  onOrderCancelled?: () => void;
}

export const B2BOrdersList: React.FC<B2BOrdersListProps> = ({
  orders,
  loading,
  error,
  emptyTitle = 'Aucune commande',
  emptyMessage = 'Les commandes passées depuis le catalogue apparaîtront ici.',
  onOpenProduct,
  canCancel = false,
  onOrderCancelled,
}) => {
  const [viewingOrder, setViewingOrder] = useState<MyB2BOrder | null>(null);
  const [cancellingOrder, setCancellingOrder] = useState<MyB2BOrder | null>(null);
  const { requestCertificate } = useEntrupyCertificate();
  const [requestingItemId, setRequestingItemId] = useState<string | null>(null);
  const [certificateError, setCertificateError] = useState<string | null>(null);

  const handleDownloadInvoice = () => {
    alert("La facture PDF n'est pas encore disponible au téléchargement. Contacte OZË Paris si tu en as besoin dès maintenant.");
  };

  const handleRequestCertificate = async (itemId: string) => {
    setCertificateError(null);
    setRequestingItemId(itemId);
    const result = await requestCertificate([itemId]);
    if (!result.success || !result.url) {
      setRequestingItemId(null);
      setCertificateError(result.error || "Impossible de lancer le paiement du certificat");
      return;
    }
    window.location.href = result.url;
  };

  return (
    <>
      {error && (
        <div className="mb-6 bg-red-50 border border-red-200 rounded-lg p-4 flex items-center space-x-3">
          <AlertCircle className="h-5 w-5 text-red-600 flex-shrink-0" />
          <p className="text-sm text-red-700">Erreur : {error}</p>
        </div>
      )}

      {!loading && !error && orders.length === 0 && (
        <div className="text-center py-12">
          <ShoppingBag className="h-12 w-12 text-gray-400 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">{emptyTitle}</h3>
          <p className="text-gray-500">{emptyMessage}</p>
        </div>
      )}

      <div className="space-y-4">
        {loading
          ? [...Array(2)].map((_, i) => (
              <Card key={`skeleton-${i}`}>
                <CardContent className="p-4">
                  <div className="h-4 w-40 bg-gray-100 rounded animate-pulse mb-2" />
                  <div className="h-4 w-24 bg-gray-100 rounded animate-pulse" />
                </CardContent>
              </Card>
            ))
          : orders.map((order) => {
              const shipment = computeShipmentSummary(order);
              return (
              <Card key={order.id}>
                <CardContent className="p-4">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-3">
                    <div>
                      <p className="font-medium text-gray-900">{order.order_number}</p>
                      <p className="text-xs text-gray-500">{new Date(order.created_at).toLocaleDateString('fr-FR')}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      {shipmentStatusBadge(shipment.status)}
                      <span className="text-base font-semibold text-gray-900">{order.total_amount.toFixed(0)} €</span>
                      <button
                        onClick={() => setViewingOrder(order)}
                        className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                        title="Voir les détails de la commande"
                      >
                        <Eye className="h-4 w-4" />
                      </button>
                    </div>
                  </div>

                  {shipment.trackingNumber && (
                    <div className="flex items-center gap-1.5 text-xs text-gray-500 mb-3">
                      <Truck className="h-3.5 w-3.5 flex-shrink-0" />
                      <span>Suivi : {shipment.trackingNumber}</span>
                      {shipment.trackingUrl && (
                        <a href={shipment.trackingUrl} target="_blank" rel="noopener noreferrer" className="text-blue-600 underline">
                          suivre le colis
                        </a>
                      )}
                    </div>
                  )}

                  <div className="flex flex-wrap gap-2">
                    {order.order_items.map((item) => {
                      const isCancelled = item.status === 'cancelled';
                      const image = item.product_snapshot?.images?.[item.product_snapshot?.main_image_index ?? 0] || item.product_snapshot?.images?.[0];
                      return (
                        <div key={item.id} className={`flex items-center gap-2 rounded-lg px-2 py-1 ${isCancelled ? 'bg-red-50' : 'bg-gray-50'}`}>
                          <div className={`h-8 w-8 bg-gray-100 rounded flex items-center justify-center overflow-hidden flex-shrink-0 ${isCancelled ? 'opacity-40' : ''}`}>
                            {image ? (
                              <img src={image} alt={item.product_snapshot?.name} className="w-full h-full object-cover" />
                            ) : (
                              <ImageOff className="h-3 w-3 text-gray-300" />
                            )}
                          </div>
                          <span className={`text-xs max-w-[120px] truncate ${isCancelled ? 'text-gray-400 line-through' : 'text-gray-700'}`}>
                            {item.product_snapshot?.name}
                          </span>
                          {item.is_loyalty_gift && <Badge variant="warning">🎁 Cadeau</Badge>}
                          {isCancelled && <Badge variant="danger">Annulé</Badge>}
                        </div>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
              );
            })}
      </div>

      {/* Modal détail de commande */}
      {viewingOrder && (() => {
        const viewingShipment = computeShipmentSummary(viewingOrder);
        const hasPerItemTracking = viewingOrder.order_items.some((i) => i.shipment_parcel?.tracking_number);
        const showOrderLevelTracking = !hasPerItemTracking && ['shipped', 'delivered'].includes(viewingShipment.status) && viewingShipment.trackingNumber;
        return (
        <div className="fixed inset-0 z-50 overflow-y-auto">
          <div className="flex min-h-full items-center justify-center p-4">
            <div className="fixed inset-0 bg-black bg-opacity-25" onClick={() => setViewingOrder(null)}></div>

            <div className="relative bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
              <div className="flex items-start justify-between p-6 border-b border-gray-100">
                <div>
                  <h3 className="text-lg font-semibold text-gray-900">#{viewingOrder.order_number}</h3>
                  <p className="text-sm text-gray-500 mt-1">
                    {new Date(viewingOrder.created_at).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' })}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  {shipmentStatusBadge(viewingShipment.status)}
                  <button
                    onClick={() => setViewingOrder(null)}
                    className="p-2 text-gray-400 hover:text-gray-600 rounded-lg transition-colors"
                  >
                    <X className="h-5 w-5" />
                  </button>
                </div>
              </div>

              <div className="p-6 space-y-6">
                {showOrderLevelTracking && (
                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 flex items-center gap-3">
                    <Truck className="h-5 w-5 text-blue-600 flex-shrink-0" />
                    <div>
                      <p className="text-sm font-medium text-blue-900">Numéro de suivi : {viewingShipment.trackingNumber}</p>
                      {viewingShipment.trackingUrl && (
                        <a
                          href={viewingShipment.trackingUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-blue-700 underline"
                        >
                          Suivre le colis
                        </a>
                      )}
                    </div>
                  </div>
                )}

                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Adresse de livraison</p>
                  <div className="bg-gray-50 rounded-lg p-4 flex items-start gap-2">
                    <MapPin className="h-4 w-4 text-gray-400 flex-shrink-0 mt-0.5" />
                    <div className="text-sm text-gray-900">
                      {(() => {
                        const a = formatAddress(viewingOrder.shipping_address);
                        return a.isPointRelais ? (
                          <>
                            <p className="font-medium">{a.pickupPointName || 'Point Relais'}</p>
                            {a.pickupPointAddress && <p>{a.pickupPointAddress}</p>}
                            <p>{a.postalCode} {a.city}</p>
                            {a.pickupPointNetwork && <p className="text-xs text-gray-500 mt-1">{a.pickupPointNetwork}</p>}
                          </>
                        ) : (
                          <>
                            <p>{a.street}</p>
                            <p>{a.postalCode} {a.city}</p>
                            <p>{a.country}</p>
                            {a.instructions && <p className="text-xs text-gray-500 mt-1 italic">{a.instructions}</p>}
                          </>
                        );
                      })()}
                    </div>
                  </div>
                </div>

                {certificateError && (
                  <div className="bg-red-50 border border-red-200 rounded-lg p-3 flex items-center space-x-2">
                    <AlertCircle className="h-4 w-4 text-red-600 flex-shrink-0" />
                    <p className="text-sm text-red-700">{certificateError}</p>
                  </div>
                )}

                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Panier B2B</p>
                  <div className="border border-gray-100 rounded-lg overflow-hidden">
                    <table className="w-full">
                      <thead>
                        <tr className="bg-gray-50 border-b border-gray-100">
                          <th className="text-left py-2.5 px-4 font-medium text-gray-500 text-xs">Produit</th>
                          <th className="text-left py-2.5 px-4 font-medium text-gray-500 text-xs hidden sm:table-cell">Référence</th>
                          <th className="text-right py-2.5 px-4 font-medium text-gray-500 text-xs">Prix B2B</th>
                          <th className="text-right py-2.5 px-4 font-medium text-gray-500 text-xs">Qté</th>
                          <th className="text-right py-2.5 px-4 font-medium text-gray-500 text-xs">Total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {viewingOrder.order_items.map((item) => {
                          const isCancelled = item.status === 'cancelled';
                          const image = item.product_snapshot?.images?.[item.product_snapshot?.main_image_index ?? 0] || item.product_snapshot?.images?.[0];
                          return (
                            <tr
                              key={item.id}
                              onClick={() => onOpenProduct(item.product_id)}
                              className="border-b border-gray-50 last:border-b-0 cursor-pointer hover:bg-gray-50 transition-colors"
                              title="Voir la fiche produit"
                            >
                              <td className="py-3 px-4">
                                <div className="flex items-center gap-3">
                                  <div className={`h-10 w-10 bg-gray-100 rounded-lg flex items-center justify-center overflow-hidden flex-shrink-0 ${isCancelled ? 'opacity-40' : ''}`}>
                                    {image ? (
                                      <img src={image} alt={item.product_snapshot?.name} className="h-full w-full object-cover" />
                                    ) : (
                                      <Package className="h-4 w-4 text-gray-300" />
                                    )}
                                  </div>
                                  <div>
                                    <span className={`text-sm font-medium underline decoration-dotted underline-offset-2 ${isCancelled ? 'text-gray-400 line-through' : 'text-gray-900'}`}>
                                      {item.product_snapshot?.name || 'Produit'}
                                    </span>
                                    {item.is_loyalty_gift && (
                                      <div className="mt-1">
                                        <Badge variant="warning">🎁 Cadeau Fidélité offert</Badge>
                                      </div>
                                    )}
                                    {!isCancelled && item.entrupy_requested && (
                                      <div className="mt-1">
                                        <Badge variant="purple">
                                          <BadgeCheck className="h-3 w-3 mr-1" /> Certificat Entrupy
                                        </Badge>
                                      </div>
                                    )}
                                    {canRequestEntrupy(item) && (
                                      <div className="mt-1.5">
                                        <button
                                          type="button"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            handleRequestCertificate(item.id);
                                          }}
                                          disabled={requestingItemId === item.id}
                                          className="inline-flex items-center gap-1 text-xs font-medium text-purple-700 hover:text-purple-900 disabled:opacity-50"
                                        >
                                          <BadgeCheck className="h-3.5 w-3.5" />
                                          {requestingItemId === item.id ? 'Redirection...' : 'Ajouter certificat Entrupy (19,99 €)'}
                                        </button>
                                      </div>
                                    )}
                                    {!isCancelled && ['label_created', 'shipped', 'delivered'].includes(item.fulfillment_status) && (
                                      <div className="mt-1 flex items-center gap-1.5 flex-wrap">
                                        {item.fulfillment_status === 'label_created' && <Badge variant="warning">En préparation</Badge>}
                                        {item.fulfillment_status === 'shipped' && <Badge variant="info">Expédié / En transit</Badge>}
                                        {item.fulfillment_status === 'delivered' && <Badge variant="success">Livré</Badge>}
                                        {item.shipment_parcel?.tracking_number && (
                                          <span className="text-xs text-gray-500" onClick={(e) => e.stopPropagation()}>
                                            {item.shipment_parcel.tracking_number}
                                            {item.shipment_parcel.tracking_url && (
                                              <a
                                                href={item.shipment_parcel.tracking_url}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="ml-1 text-blue-600 underline"
                                              >
                                                suivre
                                              </a>
                                            )}
                                          </span>
                                        )}
                                      </div>
                                    )}
                                    {isCancelled && (
                                      <div className="mt-1">
                                        <Badge variant="danger">Article annulé</Badge>
                                      </div>
                                    )}
                                  </div>
                                </div>
                              </td>
                              <td className="py-3 px-4 hidden sm:table-cell">
                                <span className="font-mono text-xs text-gray-500">
                                  {item.product_snapshot?.reference || item.product_snapshot?.product_code || '—'}
                                </span>
                              </td>
                              <td className={`py-3 px-4 text-right text-sm ${isCancelled ? 'text-gray-400 line-through' : item.is_loyalty_gift ? 'text-amber-600 font-medium' : 'text-gray-600'}`}>{item.is_loyalty_gift ? 'Offert' : `${item.unit_price.toFixed(0)} €`}</td>
                              <td className={`py-3 px-4 text-right text-sm ${isCancelled ? 'text-gray-400 line-through' : 'text-gray-600'}`}>{item.quantity}</td>
                              <td className={`py-3 px-4 text-right text-sm font-semibold ${isCancelled ? 'text-gray-400 line-through' : item.is_loyalty_gift ? 'text-amber-600' : 'text-gray-900'}`}>{item.is_loyalty_gift ? 'Offert' : `${item.line_total.toFixed(0)} €`}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
                  <div className="flex flex-wrap gap-2">
                    <button
                      onClick={handleDownloadInvoice}
                      className="flex items-center justify-center space-x-2 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors text-sm"
                    >
                      <FileDown className="h-4 w-4" />
                      <span>Télécharger la facture</span>
                    </button>
                    {canCancel && !['shipped', 'delivered', 'cancelled'].includes(viewingOrder.status) && viewingOrder.order_items.some((i) => i.status === 'active') && (
                      <button
                        onClick={() => setCancellingOrder(viewingOrder)}
                        className="flex items-center justify-center space-x-2 px-4 py-2 border border-red-200 text-red-600 rounded-lg hover:bg-red-50 transition-colors text-sm"
                      >
                        <Ban className="h-4 w-4" />
                        <span>Annuler la commande</span>
                      </button>
                    )}
                  </div>
                  <div className="w-full sm:w-56 space-y-1.5">
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-500">Sous-total</span>
                      <span className="text-gray-900">{viewingOrder.subtotal.toFixed(0)} €</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-500">Livraison</span>
                      <span className="text-gray-900">{viewingOrder.shipping_cost.toFixed(0)} €</span>
                    </div>
                    <div className="flex justify-between text-base font-semibold border-t border-gray-100 pt-1.5">
                      <span className="text-gray-900">Total</span>
                      <span className="text-gray-900">{viewingOrder.total_amount.toFixed(0)} €</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
        );
      })()}

      {cancellingOrder && (
        <CancelMyOrderModal
          order={cancellingOrder}
          onClose={() => setCancellingOrder(null)}
          onCancelled={() => {
            setViewingOrder(null);
            onOrderCancelled?.();
          }}
        />
      )}
    </>
  );
};
