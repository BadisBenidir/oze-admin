import React, { useState } from 'react';
import { Card, CardContent } from '../../ui/Card';
import { Badge } from '../../ui/Badge';
import { useResellerAuth } from '../../../hooks/useResellerAuth';
import { useMyB2BOrders, MyB2BOrder } from '../../../hooks/useMyB2BOrders';
import { ShoppingBag, ImageOff, AlertCircle, Eye, X, Package, MapPin, Truck, FileDown } from 'lucide-react';

const statusBadge = (order: MyB2BOrder) => {
  if (order.status === 'cancelled') return <Badge variant="danger">Annulée</Badge>;
  if (order.status === 'delivered') return <Badge variant="success">Livrée</Badge>;
  if (order.status === 'shipped') return <Badge variant="info">Expédiée</Badge>;
  if (order.payment_status !== 'paid') return <Badge variant="warning">En attente de paiement</Badge>;
  return <Badge variant="info">En préparation</Badge>;
};

const formatAddress = (address: Record<string, unknown>) => {
  const line1 = (address?.line1 as string) || '';
  const line2 = (address?.line2 as string) || '';
  const city = (address?.city as string) || '';
  const postalCode = (address?.postal_code as string) || '';
  const country = (address?.country as string) || '';
  return { line1, line2, city, postalCode, country };
};

export const MyOrders: React.FC = () => {
  const { isReseller } = useResellerAuth();
  const { orders, loading, error } = useMyB2BOrders(isReseller);
  const [viewingOrder, setViewingOrder] = useState<MyB2BOrder | null>(null);

  const handleDownloadInvoice = () => {
    alert("La facture PDF n'est pas encore disponible au téléchargement. Contacte OZË Paris si tu en as besoin dès maintenant.");
  };

  return (
    <div className="p-4 md:p-6">
      <div className="mb-6">
        <h3 className="text-lg font-semibold text-gray-900">Mes commandes</h3>
        <p className="text-sm text-gray-500">{loading ? 'Chargement...' : `${orders.length} commande${orders.length > 1 ? 's' : ''}`}</p>
      </div>

      {error && (
        <div className="mb-6 bg-red-50 border border-red-200 rounded-lg p-4 flex items-center space-x-3">
          <AlertCircle className="h-5 w-5 text-red-600 flex-shrink-0" />
          <p className="text-sm text-red-700">Erreur : {error}</p>
        </div>
      )}

      {!loading && !error && orders.length === 0 && (
        <div className="text-center py-12">
          <ShoppingBag className="h-12 w-12 text-gray-400 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">Aucune commande</h3>
          <p className="text-gray-500">Vos commandes passées depuis le catalogue apparaîtront ici.</p>
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
          : orders.map((order) => (
              <Card key={order.id}>
                <CardContent className="p-4">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-3">
                    <div>
                      <p className="font-medium text-gray-900">{order.order_number}</p>
                      <p className="text-xs text-gray-500">{new Date(order.created_at).toLocaleDateString('fr-FR')}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      {statusBadge(order)}
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

                  <div className="flex flex-wrap gap-2">
                    {order.order_items.map((item) => {
                      const image = item.product_snapshot?.images?.[item.product_snapshot?.main_image_index ?? 0] || item.product_snapshot?.images?.[0];
                      return (
                        <div key={item.id} className="flex items-center gap-2 bg-gray-50 rounded-lg px-2 py-1">
                          <div className="h-8 w-8 bg-gray-100 rounded flex items-center justify-center overflow-hidden flex-shrink-0">
                            {image ? (
                              <img src={image} alt={item.product_snapshot?.name} className="w-full h-full object-cover" />
                            ) : (
                              <ImageOff className="h-3 w-3 text-gray-300" />
                            )}
                          </div>
                          <span className="text-xs text-gray-700 max-w-[120px] truncate">{item.product_snapshot?.name}</span>
                        </div>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
            ))}
      </div>

      {/* Modal détail de commande */}
      {viewingOrder && (
        <div className="fixed inset-0 z-50 overflow-y-auto">
          <div className="flex min-h-full items-center justify-center p-4">
            <div className="fixed inset-0 bg-black bg-opacity-25" onClick={() => setViewingOrder(null)}></div>

            <div className="relative bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
              {/* En-tête */}
              <div className="flex items-start justify-between p-6 border-b border-gray-100">
                <div>
                  <h3 className="text-lg font-semibold text-gray-900">#{viewingOrder.order_number}</h3>
                  <p className="text-sm text-gray-500 mt-1">
                    {new Date(viewingOrder.created_at).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' })}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  {statusBadge(viewingOrder)}
                  <button
                    onClick={() => setViewingOrder(null)}
                    className="p-2 text-gray-400 hover:text-gray-600 rounded-lg transition-colors"
                  >
                    <X className="h-5 w-5" />
                  </button>
                </div>
              </div>

              <div className="p-6 space-y-6">
                {viewingOrder.status === 'shipped' && viewingOrder.tracking_number && (
                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 flex items-center gap-3">
                    <Truck className="h-5 w-5 text-blue-600 flex-shrink-0" />
                    <div>
                      <p className="text-sm font-medium text-blue-900">Numéro de suivi : {viewingOrder.tracking_number}</p>
                      {viewingOrder.tracking_url && (
                        <a
                          href={viewingOrder.tracking_url}
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

                {/* Livraison */}
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Adresse de livraison</p>
                  <div className="bg-gray-50 rounded-lg p-4 flex items-start gap-2">
                    <MapPin className="h-4 w-4 text-gray-400 flex-shrink-0 mt-0.5" />
                    <div className="text-sm text-gray-900">
                      {(() => {
                        const a = formatAddress(viewingOrder.shipping_address);
                        return (
                          <>
                            <p>{a.line1}</p>
                            {a.line2 && <p>{a.line2}</p>}
                            <p>{a.postalCode} {a.city}</p>
                            <p>{a.country}</p>
                          </>
                        );
                      })()}
                    </div>
                  </div>
                </div>

                {/* Articles */}
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
                          const image = item.product_snapshot?.images?.[item.product_snapshot?.main_image_index ?? 0] || item.product_snapshot?.images?.[0];
                          return (
                            <tr key={item.id} className="border-b border-gray-50 last:border-b-0">
                              <td className="py-3 px-4">
                                <div className="flex items-center gap-3">
                                  <div className="h-10 w-10 bg-gray-100 rounded-lg flex items-center justify-center overflow-hidden flex-shrink-0">
                                    {image ? (
                                      <img src={image} alt={item.product_snapshot?.name} className="h-full w-full object-cover" />
                                    ) : (
                                      <Package className="h-4 w-4 text-gray-300" />
                                    )}
                                  </div>
                                  <span className="text-sm font-medium text-gray-900">{item.product_snapshot?.name || 'Produit'}</span>
                                </div>
                              </td>
                              <td className="py-3 px-4 hidden sm:table-cell">
                                <span className="font-mono text-xs text-gray-500">
                                  {item.product_snapshot?.reference || item.product_snapshot?.product_code || '—'}
                                </span>
                              </td>
                              <td className="py-3 px-4 text-right text-sm text-gray-600">{item.unit_price.toFixed(0)} €</td>
                              <td className="py-3 px-4 text-right text-sm text-gray-600">{item.quantity}</td>
                              <td className="py-3 px-4 text-right text-sm font-semibold text-gray-900">{item.line_total.toFixed(0)} €</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Récapitulatif financier */}
                <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
                  <button
                    onClick={handleDownloadInvoice}
                    className="flex items-center justify-center space-x-2 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors text-sm"
                  >
                    <FileDown className="h-4 w-4" />
                    <span>Télécharger la facture</span>
                  </button>
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
      )}
    </div>
  );
};
