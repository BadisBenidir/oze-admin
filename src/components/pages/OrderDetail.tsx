import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { orderService, type OrderWithItems } from '../../services/orderService';
import { ShippingLabelButton } from '../orders/ShippingLabelButton';
import { OrderTrackingCell } from '../orders/OrderTrackingCell';
import { 
  ArrowLeft, 
  Eye, 
  Truck, 
  Package, 
  CreditCard, 
  MapPin, 
  User, 
  Mail, 
  Phone,
  Calendar,
  Loader2,
  CheckCircle,
  XCircle,
  AlertCircle,
  RefreshCw,
  Download
} from 'lucide-react';

interface OrderDetailProps {
  orderId: string;
  onBack: () => void;
}

export const OrderDetail: React.FC<OrderDetailProps> = ({ orderId, onBack }) => {
  const [order, setOrder] = useState<OrderWithItems | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updatingStatus, setUpdatingStatus] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [groupedOrderNumber, setGroupedOrderNumber] = useState<string | null>(null);

  useEffect(() => {
    if (!orderId) {
      setError('ID de commande manquant');
      setLoading(false);
      return;
    }

    fetchOrderDetails();
  }, [orderId]);

  useEffect(() => {
    if (!order?.grouped_with_order_id) {
      setGroupedOrderNumber(null);
      return;
    }
    orderService.getOrderById(order.grouped_with_order_id)
      .then((grouped) => setGroupedOrderNumber(grouped?.order_number || null))
      .catch(() => setGroupedOrderNumber(null));
  }, [order?.grouped_with_order_id]);

  const fetchOrderDetails = async () => {
    if (!orderId) return;
    
    try {
      setLoading(true);
      setError(null);
      const orderData = await orderService.getOrderById(orderId);
      
      if (!orderData) {
        setError('Commande non trouvée');
        return;
      }
      
      setOrder(orderData);
    } catch (err) {
      console.error('Error fetching order details:', err);
      setError(err instanceof Error ? err.message : 'Erreur lors du chargement');
    } finally {
      setLoading(false);
    }
  };

  const updateOrderStatus = async (newStatus: string) => {
    if (!order) return;
    
    try {
      setUpdatingStatus(true);
      await orderService.updateOrderStatus(order.id, newStatus);
      setOrder({ ...order, status: newStatus });
    } catch (err) {
      console.error('Error updating order status:', err);
      setError(err instanceof Error ? err.message : 'Erreur lors de la mise à jour');
    } finally {
      setUpdatingStatus(false);
    }
  };

  const handleCancelOrder = async () => {
    if (!order) return;
    if (!confirm(`Annuler la commande ${order.order_number} ?\nUn email d'information sera envoyé au client.`)) return;
    try {
      setCancelling(true);
      setError(null);
      const result = await orderService.cancelOrder(order.id);
      const wasPaid = order.payment_status === 'succeeded';
      const hadParcel = Boolean(order.sendcloud_parcel_id);
      setOrder({
        ...order,
        status: 'cancelled',
        ...(result.refunded ? { payment_status: 'refunded' } : {}),
      });

      const lines = ['Commande annulée, client informé par email.'];
      if (wasPaid) {
        lines.push(result.refunded
          ? '✓ Paiement remboursé sur Stripe.'
          : `⚠ Remboursement Stripe échoué (${result.refundError || 'inconnu'}) — à faire manuellement dans Stripe.`);
      }
      if (hadParcel) {
        lines.push(result.sendcloudCancelled
          ? '✓ Colis Sendcloud annulé.'
          : `⚠ Annulation du colis Sendcloud échouée (${result.sendcloudError || 'inconnu'}) — à annuler manuellement dans Sendcloud.`);
      }
      alert(lines.join('\n'));
    } catch (err) {
      console.error('Error cancelling order:', err);
      setError(err instanceof Error ? err.message : "Erreur lors de l'annulation");
    } finally {
      setCancelling(false);
    }
  };

  const getStatusVariant = (status: string) => {
    switch (status) {
      case 'pending':
        return 'default';
      case 'confirmed':
        return 'info';
      case 'shipped':
        return 'warning';
      case 'delivered':
        return 'success';
      case 'cancelled':
      case 'refunded':
        return 'danger';
      default:
        return 'default';
    }
  };

  const getStatusLabel = (status: string) => {
    const labels = {
      pending: 'En attente',
      confirmed: 'Confirmée',
      shipped: 'Expédiée',
      delivered: 'Livrée',
      cancelled: 'Annulée',
      refunded: 'Remboursée',
    };
    return labels[status as keyof typeof labels] || status;
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'pending':
        return <AlertCircle className="h-4 w-4" />;
      case 'confirmed':
        return <CheckCircle className="h-4 w-4" />;
      case 'shipped':
        return <Truck className="h-4 w-4" />;
      case 'delivered':
        return <CheckCircle className="h-4 w-4" />;
      case 'cancelled':
      case 'refunded':
        return <XCircle className="h-4 w-4" />;
      default:
        return <AlertCircle className="h-4 w-4" />;
    }
  };

  const getPaymentStatusBadge = (status: string) => {
    const variants = {
      pending: 'default',
      processing: 'warning',
      succeeded: 'success',
      failed: 'danger',
      canceled: 'danger',
      requires_action: 'warning',
    };
    
    const labels = {
      pending: 'En attente',
      processing: 'En cours',
      succeeded: 'Payée',
      failed: 'Échouée',
      canceled: 'Annulée',
      requires_action: 'Action requise',
    };

    return (
      <Badge variant={variants[status as keyof typeof variants] as any}>
        {labels[status as keyof typeof labels] || status}
      </Badge>
    );
  };

  if (loading) {
    return (
      <div className="p-6">
        <div className="flex items-center justify-center h-64">
          <Loader2 className="h-8 w-8 animate-spin text-gray-500" />
          <span className="ml-2 text-gray-500">Chargement des détails...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <p className="text-red-800">Erreur: {error}</p>
          <button 
            onClick={onBack}
            className="mt-2 text-red-600 hover:text-red-800 underline"
          >
            Retour aux commandes
          </button>
        </div>
      </div>
    );
  }

  if (!order) {
    return (
      <div className="p-6">
        <div className="text-center text-gray-500">
          <Package className="h-12 w-12 mx-auto mb-2 text-gray-300" />
          <p>Commande non trouvée</p>
          <button 
            onClick={onBack}
            className="mt-2 text-blue-600 hover:text-blue-800 underline"
          >
            Retour aux commandes
          </button>
        </div>
      </div>
    );
  }

  const shippingAddress = order.shipping_address || {};
  const billingAddress = order.billing_address || order.shipping_address || {};

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center space-x-4">
          <button 
            onClick={onBack}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">
              Commande {order.order_number}
            </h1>
            <p className="text-sm text-gray-500">
              Créée le {new Date(order.created_at).toLocaleDateString('fr-FR', {
                year: 'numeric',
                month: 'long',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
              })}
            </p>
          </div>
        </div>

        <div className="flex items-center space-x-3">
          <a
            href={`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/order-invoice?order_id=${order.id}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center space-x-2 px-4 py-2 border border-gray-200 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
          >
            <Download className="h-4 w-4" />
            <span>Facture</span>
          </a>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Colonne principale */}
        <div className="lg:col-span-2 space-y-6">
          {/* Statut et actions */}
          <Card>
            <CardHeader>
              <h2 className="text-lg font-semibold">Statut de la commande</h2>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-3">
                  <Badge variant={getStatusVariant(order.status)} className="flex items-center space-x-1">
                    {getStatusIcon(order.status)}
                    <span>{getStatusLabel(order.status)}</span>
                  </Badge>
                  <span className="text-sm text-gray-500">
                    Paiement: {getPaymentStatusBadge(order.payment_status)}
                  </span>
                </div>

                <div className="flex items-center space-x-2">
                  {/* BOUTON POUR PASSER DE "EN ATTENTE" À "CONFIRMÉE" */}
                  {order.status === 'pending' && (
                    <button 
                      onClick={() => updateOrderStatus('confirmed')}
                      disabled={updatingStatus}
                      className="flex items-center space-x-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors disabled:opacity-50"
                    >
                      {updatingStatus ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <CheckCircle className="h-4 w-4" />
                      )}
                      <span>Confirmer la commande</span>
                    </button>
                  )}

                  {order.status === 'confirmed' && (
                    <button 
                      onClick={() => updateOrderStatus('shipped')}
                      disabled={updatingStatus}
                      className="flex items-center space-x-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
                    >
                      {updatingStatus ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Truck className="h-4 w-4" />
                      )}
                      <span>Marquer expédiée</span>
                    </button>
                  )}
                  
                  {order.status === 'shipped' && (
                    <button 
                      onClick={() => updateOrderStatus('delivered')}
                      disabled={updatingStatus}
                      className="flex items-center space-x-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors disabled:opacity-50"
                    >
                      {updatingStatus ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <CheckCircle className="h-4 w-4" />
                      )}
                      <span>Marquer livrée</span>
                    </button>
                  )}

                  {/* Annulation : disponible tant que la commande n'est pas déjà annulée/remboursée/livrée */}
                  {!['cancelled', 'refunded', 'delivered'].includes(order.status) && (
                    <button
                      onClick={handleCancelOrder}
                      disabled={cancelling}
                      className="flex items-center space-x-2 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors disabled:opacity-50"
                    >
                      {cancelling ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <XCircle className="h-4 w-4" />
                      )}
                      <span>Annuler</span>
                    </button>
                  )}

                  <button
                    onClick={fetchOrderDetails}
                    disabled={loading}
                    className="p-2 text-gray-400 hover:text-gray-600 transition-colors"
                  >
                    <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
                  </button>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Articles commandés */}
          <Card>
            <CardHeader>
              <h2 className="text-lg font-semibold">Articles commandés</h2>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {order.order_items && order.order_items.length > 0 ? (
                  order.order_items.map((item) => {
                    const snapshot = item.product_snapshot || {};
                    const mainImage = snapshot.images && snapshot.images.length > 0 
                      ? snapshot.images[snapshot.main_image_index || 0] 
                      : null;

                    return (
                      <div key={item.id} className="flex items-center space-x-4 p-4 border border-gray-100 rounded-lg">
                        <div className="w-16 h-16 bg-gray-100 rounded-lg overflow-hidden">
                          {mainImage ? (
                            <img 
                              src={mainImage} 
                              alt={snapshot.name}
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center">
                              <Package className="h-6 w-6 text-gray-400" />
                            </div>
                          )}
                        </div>
                        
                        <div className="flex-1">
                          <h3 className="font-medium text-gray-900">{snapshot.name}</h3>
                          <p className="text-sm text-gray-500">
                            {snapshot.brand_name} • {snapshot.category_name}
                          </p>
                          <p className="text-xs text-gray-400">
                            Code: {snapshot.product_code} • État: {snapshot.condition}
                          </p>
                        </div>
                        
                        <div className="text-right">
                          <p className="font-medium text-gray-900">
                            {item.quantity} × €{item.unit_price.toFixed(2)}
                          </p>
                          <p className="text-sm font-semibold text-gray-900">
                            €{item.line_total.toFixed(2)}
                          </p>
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <div className="text-center text-gray-500 py-8">
                    <Package className="h-12 w-12 mx-auto mb-2 text-gray-300" />
                    <p>Aucun article trouvé</p>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Colonne latérale */}
        <div className="space-y-6">
          {/* Résumé financier */}
          <Card>
            <CardHeader>
              <h2 className="text-lg font-semibold flex items-center space-x-2">
                <CreditCard className="h-5 w-5" />
                <span>Résumé</span>
              </h2>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                <div className="flex justify-between">
                  <span className="text-gray-600">Sous-total</span>
                  <span className="font-medium">€{order.subtotal.toFixed(2)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Frais de port</span>
                  <span className="font-medium">€{order.shipping_cost.toFixed(2)}</span>
                </div>
                <div className="border-t border-gray-100 pt-3">
                  <div className="flex justify-between">
                    <span className="font-semibold text-gray-900">Total</span>
                    <span className="font-bold text-lg text-gray-900">€{order.total_amount.toFixed(2)}</span>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Informations client */}
          <Card>
            <CardHeader>
              <h2 className="text-lg font-semibold flex items-center space-x-2">
                <User className="h-5 w-5" />
                <span>Client</span>
              </h2>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                <div className="flex items-center space-x-2">
                  <User className="h-4 w-4 text-gray-400" />
                  <span className="font-medium">{order.customer_name}</span>
                </div>
                <div className="flex items-center space-x-2">
                  <Mail className="h-4 w-4 text-gray-400" />
                  <span className="text-sm">{order.email}</span>
                </div>
                {shippingAddress.phone && (
                  <div className="flex items-center space-x-2">
                    <Phone className="h-4 w-4 text-gray-400" />
                    <span className="text-sm">{shippingAddress.phone}</span>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Expédition Sendcloud */}
          <Card>
            <CardHeader>
              <h2 className="text-lg font-semibold flex items-center space-x-2">
                <Truck className="h-5 w-5" />
                <span>Expédition</span>
              </h2>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {order.grouped_with_order_id ? (
                  <div className="flex items-start space-x-2 p-3 bg-amber-50 border border-amber-200 rounded-lg">
                    <Package className="h-4 w-4 text-amber-600 flex-shrink-0 mt-0.5" />
                    <p className="text-sm text-amber-800">
                      Commande groupée avec {groupedOrderNumber ? <strong>{groupedOrderNumber}</strong> : 'une autre commande'} :
                      à emballer et expédier dans le même colis, pas d'étiquette Sendcloud séparée à générer.
                    </p>
                  </div>
                ) : (
                  <ShippingLabelButton
                    orderId={order.id}
                    labelUrl={order.label_url}
                    onLabelCreated={(data) =>
                      setOrder((prev) =>
                        prev
                          ? {
                              ...prev,
                              label_url: data.label_url,
                              tracking_number: data.tracking_number,
                              sendcloud_parcel_id: data.sendcloud_parcel_id,
                            }
                          : prev
                      )
                    }
                  />
                )}

                {Number(order.insured_value) > 0 && (
                  <p className="text-xs text-gray-500">
                    Assurance colis : valeur déclarée {Number(order.insured_value).toFixed(2)} €
                  </p>
                )}

                <div>
                  <p className="text-sm text-gray-600 mb-1">Numéro de suivi</p>
                  <OrderTrackingCell
                    trackingNumber={order.tracking_number}
                    trackingUrl={order.tracking_url}
                    shippingAddress={order.shipping_address}
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Adresse de livraison */}
          <Card>
            <CardHeader>
              <h2 className="text-lg font-semibold flex items-center space-x-2">
                <MapPin className="h-5 w-5" />
                <span>Livraison</span>
              </h2>
            </CardHeader>
            <CardContent>
              <div className="text-sm space-y-1">
                <p className="font-medium">
                  {shippingAddress.firstName} {shippingAddress.lastName}
                </p>
                {shippingAddress.address && (
                  <p>{shippingAddress.address}</p>
                )}
                {shippingAddress.address2 && (
                  <p>{shippingAddress.address2}</p>
                )}
                <p>
                  {shippingAddress.postalCode} {shippingAddress.city}
                </p>
                {shippingAddress.country && (
                  <p>{shippingAddress.country}</p>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Informations Stripe */}
          {order.stripe_session_id && (
            <Card>
              <CardHeader>
                <h2 className="text-lg font-semibold flex items-center space-x-2">
                  <CreditCard className="h-5 w-5" />
                  <span>Paiement</span>
                </h2>
              </CardHeader>
              <CardContent>
                <div className="space-y-2 text-sm">
                  <div>
                    <span className="text-gray-600">Session Stripe:</span>
                    <p className="font-mono text-xs break-all">{order.stripe_session_id}</p>
                  </div>
                  {order.stripe_payment_intent_id && (
                    <div>
                      <span className="text-gray-600">Payment Intent:</span>
                      <p className="font-mono text-xs break-all">{order.stripe_payment_intent_id}</p>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
};