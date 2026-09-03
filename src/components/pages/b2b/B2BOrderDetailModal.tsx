import React, { useState } from 'react';
import { X, Package, Trash2, AlertCircle, AlertTriangle, MapPin, Ban, BadgeCheck, RefreshCw } from 'lucide-react';
import { Badge } from '../../ui/Badge';
import { B2BOrder, B2BOrderItem, getRequesterDisplayName } from '../../../hooks/useB2BOrders';
import { cancelOrderItem, cancelOrder } from '../../../hooks/useCancelOrderItem';
import { useSendcloudSync } from '../../../hooks/useSendcloudSync';

// `orders.shipping_address` est stocké dans la forme assemblée par
// b2b-checkout (address/postcode/city/country/pickup_point_*/delivery_type/
// instructions — voir deliveryAddress dans l'edge function), pas dans la
// forme brute envoyée par le client (line1/postal_code, qui finit elle dans
// `billing_address`).
const formatShippingAddress = (address: Record<string, unknown> | null | undefined) => {
  const isPointRelais = address?.delivery_type === 'point_relais';
  return {
    isPointRelais,
    street: (address?.address as string) || '',
    city: (address?.city as string) || '',
    postalCode: (address?.postcode as string) || '',
    country: (address?.country as string) || '',
    phone: (address?.phone as string) || '',
    instructions: (address?.instructions as string) || '',
    pickupPointName: (address?.pickup_point_name as string) || '',
    pickupPointNetwork: (address?.pickup_point_network as string) || '',
    pickupPointAddress: (address?.pickup_point_address as string) || '',
  };
};

const CANCEL_REASONS = [
  'Rupture de stock / Article introuvable',
  'Défaut majeur découvert avant envoi',
  'Demande du client',
] as const;

const RESTOCK_OPTIONS: { value: 'draft' | 'for-sale-b2b' | 'archived'; label: string }[] = [
  { value: 'draft', label: 'Remettre en brouillon' },
  { value: 'for-sale-b2b', label: 'Remettre au catalogue B2B' },
  { value: 'archived', label: "Archiver l'article" },
];

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

const refundMethodLabel = (method?: string | null) =>
  method === 'wallet' ? 'crédit portefeuille' : method === 'stripe' ? 'Stripe' : '';

const fulfillmentBadge = (status: B2BOrderItem['fulfillment_status']) => {
  switch (status) {
    case 'received':
      return <Badge variant="warning">Reçu</Badge>;
    case 'ready_to_ship':
      return <Badge variant="info">Prêt à expédier</Badge>;
    case 'delivery_requested':
      return <Badge variant="info">Livraison demandée</Badge>;
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

// Choix du mode de remboursement, partagé entre l'annulation d'un article et
// celle de la commande entière — l'option Stripe n'est proposée que si la
// commande a réellement été payée (au moins en partie) par carte.
const RefundMethodChoice: React.FC<{
  value: 'wallet' | 'stripe';
  onChange: (v: 'wallet' | 'stripe') => void;
  hasStripePayment: boolean;
}> = ({ value, onChange, hasStripePayment }) => (
  <div>
    <label className="block text-sm font-medium text-gray-700 mb-2">Mode de remboursement</label>
    <div className="space-y-2">
      <label className="flex items-center gap-2 text-sm text-gray-700">
        <input
          type="radio"
          name="refund-method"
          checked={value === 'wallet'}
          onChange={() => onChange('wallet')}
          className="h-4 w-4 text-gray-900 focus:ring-gray-900"
        />
        💳 Rembourser en crédit portefeuille (Solde B2B)
      </label>
      <label className={`flex items-center gap-2 text-sm ${hasStripePayment ? 'text-gray-700' : 'text-gray-400'}`}>
        <input
          type="radio"
          name="refund-method"
          checked={value === 'stripe'}
          disabled={!hasStripePayment}
          onChange={() => onChange('stripe')}
          className="h-4 w-4 text-gray-900 focus:ring-gray-900 disabled:opacity-50"
        />
        🏦 Rembourser via Stripe (paiement d'origine)
      </label>
      {!hasStripePayment && (
        <p className="text-xs text-gray-400 pl-6">Aucun paiement Stripe sur cette commande — seul le portefeuille est disponible.</p>
      )}
    </div>
  </div>
);

interface CancelItemPanelProps {
  item: B2BOrderItem;
  isPaid: boolean;
  hasStripePayment: boolean;
  onCancel: () => void;
  onConfirmed: (result: { new_total_amount?: number; order_status?: string; refund_status?: string; refund_method?: string | null; refund_error?: string }) => void;
}

const CancelItemPanel: React.FC<CancelItemPanelProps> = ({ item, isPaid, hasStripePayment, onCancel, onConfirmed }) => {
  const refundAmount = item.line_total + (item.insured ? item.insurance_cost : 0);
  const [reason, setReason] = useState<string>(CANCEL_REASONS[0]);
  const [restockAction, setRestockAction] = useState<'draft' | 'for-sale-b2b' | 'archived'>('draft');
  const [refundMethod, setRefundMethod] = useState<'wallet' | 'stripe'>('wallet');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const handleConfirm = async () => {
    setSubmitting(true);
    setError('');
    const result = await cancelOrderItem(item.id, reason, restockAction, isPaid ? refundMethod : undefined);
    setSubmitting(false);

    if (!result.success) {
      setError(result.error || "Impossible d'annuler cet article");
      return;
    }
    onConfirmed(result);
  };

  return (
    <div className="fixed inset-0 z-[60] overflow-y-auto">
      <div className="fixed inset-0 bg-black bg-opacity-50" onClick={onCancel} />
      <div className="flex min-h-full items-center justify-center p-4">
        <div className="relative bg-white rounded-xl shadow-xl w-full max-w-md" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center justify-between p-5 border-b border-gray-100">
            <h3 className="text-base font-semibold text-gray-900">Annuler cet article</h3>
            <button onClick={onCancel} className="p-1 text-gray-400 hover:text-gray-600 rounded-lg transition-colors">
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="p-5 space-y-4">
            <div className="bg-gray-50 rounded-lg p-3 flex items-center gap-3">
              <div className="h-10 w-10 bg-white rounded-lg flex items-center justify-center flex-shrink-0 overflow-hidden border border-gray-100">
                {item.product_snapshot?.images?.[0] ? (
                  <img src={item.product_snapshot.images[0]} alt="" className="h-full w-full object-cover" />
                ) : (
                  <Package className="h-4 w-4 text-gray-300" />
                )}
              </div>
              <div>
                <p className="text-sm font-medium text-gray-900">{item.product_snapshot?.name || 'Produit'}</p>
                <p className="text-xs text-gray-500">
                  {item.line_total.toFixed(0)} €{item.insured ? ` + ${item.insurance_cost.toFixed(2)} € d'assurance` : ''}
                </p>
                {isPaid && (
                  <p className="text-xs font-medium text-gray-700 mt-0.5">À rembourser : {refundAmount.toFixed(2)} €</p>
                )}
              </div>
            </div>

            <div>
              <label htmlFor="cancel-reason" className="block text-sm font-medium text-gray-700 mb-2">
                Raison de l'annulation
              </label>
              <select
                id="cancel-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:border-gray-400 text-sm bg-white"
              >
                {CANCEL_REASONS.map((r) => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Que faire de l'article ?</label>
              <div className="space-y-2">
                {RESTOCK_OPTIONS.map((opt) => (
                  <label key={opt.value} className="flex items-center gap-2 text-sm text-gray-700">
                    <input
                      type="radio"
                      name="restock-action"
                      value={opt.value}
                      checked={restockAction === opt.value}
                      onChange={() => setRestockAction(opt.value)}
                      className="h-4 w-4 text-gray-900 focus:ring-gray-900"
                    />
                    {opt.label}
                  </label>
                ))}
              </div>
            </div>

            {isPaid && (
              <RefundMethodChoice value={refundMethod} onChange={setRefundMethod} hasStripePayment={hasStripePayment} />
            )}

            {error && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-3 flex items-center space-x-2">
                <AlertCircle className="h-4 w-4 text-red-600 flex-shrink-0" />
                <p className="text-sm text-red-700">{error}</p>
              </div>
            )}
          </div>

          <div className="flex justify-end gap-3 p-5 pt-0">
            <button
              onClick={onCancel}
              disabled={submitting}
              className="px-4 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors text-sm disabled:opacity-50"
            >
              Retour
            </button>
            <button
              onClick={handleConfirm}
              disabled={submitting}
              className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors text-sm font-medium disabled:opacity-50"
            >
              {submitting ? 'Annulation...' : "Confirmer l'annulation"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

interface CancelOrderPanelProps {
  order: B2BOrder;
  isPaid: boolean;
  hasStripePayment: boolean;
  onCancel: () => void;
  onConfirmed: (result: { total_refund?: number; refund_status?: string; refund_method?: string | null; refund_error?: string }) => void;
}

const CancelOrderPanel: React.FC<CancelOrderPanelProps> = ({ order, isPaid, hasStripePayment, onCancel, onConfirmed }) => {
  const activeItems = order.order_items.filter((i) => i.status === 'active');
  const totalToRefund = activeItems.reduce((sum, i) => sum + i.line_total + (i.insured ? i.insurance_cost : 0), 0);

  const [reason, setReason] = useState<string>(CANCEL_REASONS[0]);
  const [restockAction, setRestockAction] = useState<'draft' | 'for-sale-b2b' | 'archived'>('draft');
  const [refundMethod, setRefundMethod] = useState<'wallet' | 'stripe'>('wallet');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const handleConfirm = async () => {
    setSubmitting(true);
    setError('');
    const result = await cancelOrder(order.id, reason, restockAction, isPaid ? refundMethod : undefined);
    setSubmitting(false);

    if (!result.success) {
      setError(result.error || "Impossible d'annuler cette commande");
      return;
    }
    onConfirmed(result);
  };

  return (
    <div className="fixed inset-0 z-[60] overflow-y-auto">
      <div className="fixed inset-0 bg-black bg-opacity-50" onClick={onCancel} />
      <div className="flex min-h-full items-center justify-center p-4">
        <div className="relative bg-white rounded-xl shadow-xl w-full max-w-md" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center justify-between p-5 border-b border-gray-100">
            <h3 className="text-base font-semibold text-gray-900">Annuler toute la commande</h3>
            <button onClick={onCancel} className="p-1 text-gray-400 hover:text-gray-600 rounded-lg transition-colors">
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="p-5 space-y-4">
            <div className="bg-gray-50 rounded-lg p-3">
              <p className="text-sm text-gray-700">
                {activeItems.length} article{activeItems.length > 1 ? 's' : ''} de la commande #{order.order_number}
              </p>
              <p className="text-sm font-semibold text-gray-900 mt-1">Total à rembourser : {totalToRefund.toFixed(0)} €</p>
            </div>

            <div>
              <label htmlFor="cancel-order-reason" className="block text-sm font-medium text-gray-700 mb-2">
                Raison de l'annulation
              </label>
              <select
                id="cancel-order-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:border-gray-400 text-sm bg-white"
              >
                {CANCEL_REASONS.map((r) => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Que faire des articles ?</label>
              <div className="space-y-2">
                {RESTOCK_OPTIONS.map((opt) => (
                  <label key={opt.value} className="flex items-center gap-2 text-sm text-gray-700">
                    <input
                      type="radio"
                      name="restock-action-order"
                      value={opt.value}
                      checked={restockAction === opt.value}
                      onChange={() => setRestockAction(opt.value)}
                      className="h-4 w-4 text-gray-900 focus:ring-gray-900"
                    />
                    {opt.label}
                  </label>
                ))}
              </div>
            </div>

            {isPaid && (
              <RefundMethodChoice value={refundMethod} onChange={setRefundMethod} hasStripePayment={hasStripePayment} />
            )}

            {error && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-3 flex items-center space-x-2">
                <AlertCircle className="h-4 w-4 text-red-600 flex-shrink-0" />
                <p className="text-sm text-red-700">{error}</p>
              </div>
            )}
          </div>

          <div className="flex justify-end gap-3 p-5 pt-0">
            <button
              onClick={onCancel}
              disabled={submitting}
              className="px-4 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors text-sm disabled:opacity-50"
            >
              Retour
            </button>
            <button
              onClick={handleConfirm}
              disabled={submitting}
              className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors text-sm font-medium disabled:opacity-50"
            >
              {submitting ? 'Annulation...' : 'Confirmer l\'annulation de la commande'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

interface B2BOrderDetailModalProps {
  order: B2BOrder | null;
  onClose: () => void;
  /** Rafraîchit la liste des commandes du parent après une annulation d'article. */
  onOrderUpdated: () => void;
}

export const B2BOrderDetailModal: React.FC<B2BOrderDetailModalProps> = ({ order, onClose, onOrderUpdated }) => {
  const [cancellingItem, setCancellingItem] = useState<B2BOrderItem | null>(null);
  const [cancellingOrder, setCancellingOrder] = useState(false);
  const [refundNotice, setRefundNotice] = useState<string | null>(null);
  const { sync: syncSendcloud } = useSendcloudSync();
  const [syncingShipmentId, setSyncingShipmentId] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);

  if (!order) return null;

  const isPaid = order.payment_status === 'paid';
  const hasStripePayment = Boolean(order.stripe_payment_intent_id);
  const hasActiveItems = order.order_items.some((i) => i.status === 'active');

  const handleSyncSendcloud = async (shipmentId: string) => {
    setSyncError(null);
    setSyncingShipmentId(shipmentId);
    const result = await syncSendcloud(shipmentId);
    setSyncingShipmentId(null);
    if (!result.success) {
      setSyncError(result.error || 'Impossible de contacter Sendcloud');
      return;
    }
    onOrderUpdated();
  };

  const handleItemConfirmed = (result: { refund_status?: string; refund_method?: string | null; refund_error?: string }) => {
    setCancellingItem(null);
    if (result.refund_status === 'succeeded') {
      setRefundNotice(`Article annulé et remboursement effectué avec succès (${refundMethodLabel(result.refund_method)}).`);
    } else if (result.refund_status === 'failed') {
      setRefundNotice(`Article annulé, mais le remboursement a échoué (${result.refund_error || 'erreur inconnue'}) — à traiter manuellement.`);
    } else {
      setRefundNotice(null);
    }
    onOrderUpdated();
  };

  const handleOrderConfirmed = (result: { total_refund?: number; refund_status?: string; refund_method?: string | null; refund_error?: string }) => {
    setCancellingOrder(false);
    if (result.refund_status === 'succeeded') {
      setRefundNotice(`Commande annulée et ${(result.total_refund || 0).toFixed(0)} € remboursés avec succès (${refundMethodLabel(result.refund_method)}).`);
    } else if (result.refund_status === 'failed') {
      setRefundNotice(`Commande annulée, mais le remboursement a échoué (${result.refund_error || 'erreur inconnue'}) — à traiter manuellement.`);
    } else {
      setRefundNotice('Commande annulée.');
    }
    onOrderUpdated();
  };

  return (
    <>
      <div className="fixed inset-0 z-50 overflow-y-auto">
        <div className="flex min-h-full items-center justify-center p-4">
          <div className="fixed inset-0 bg-black bg-opacity-25" onClick={onClose} />

          <div className="relative bg-white rounded-xl shadow-xl w-full max-w-3xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between p-6 border-b border-gray-100">
              <div>
                <h3 className="text-lg font-semibold text-gray-900">#{order.order_number}</h3>
                <p className="text-sm text-gray-500 mt-1">
                  {new Date(order.created_at).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' })}
                </p>
                {(() => {
                  const requesterName = getRequesterDisplayName(order);
                  const showSubtitle = Boolean(requesterName) && !order.placed_by_is_primary;
                  return showSubtitle ? (
                    <p className="text-sm mt-1">
                      <span className="font-medium text-gray-900">{requesterName}</span>
                      <span className="text-xs text-gray-400 ml-1.5">{order.reseller?.company_name || '—'}</span>
                    </p>
                  ) : order.reseller?.company_name ? (
                    <p className="text-sm text-gray-500 mt-1">{order.reseller.company_name}</p>
                  ) : null;
                })()}
              </div>
              <div className="flex items-center gap-3">
                {orderStatusBadge(order.status)}
                <button onClick={onClose} className="p-2 text-gray-400 hover:text-gray-600 rounded-lg transition-colors">
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>

            <div className="p-6 space-y-6">
              {refundNotice && (
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 flex items-start gap-2">
                  <AlertTriangle className="h-4 w-4 text-blue-600 flex-shrink-0 mt-0.5" />
                  <p className="text-sm text-blue-800">{refundNotice}</p>
                </div>
              )}

              {syncError && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-3">
                  <p className="text-sm text-red-700">{syncError}</p>
                </div>
              )}

              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Livraison</p>
                <div className="bg-gray-50 rounded-lg p-4 flex items-start gap-2">
                  <MapPin className="h-4 w-4 text-gray-400 flex-shrink-0 mt-0.5" />
                  <div className="text-sm text-gray-900">
                    {(() => {
                      const a = formatShippingAddress(order.shipping_address);
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
                          {a.instructions && (
                            <p className="text-xs text-amber-700 mt-1 italic">Consignes : {a.instructions}</p>
                          )}
                        </>
                      );
                    })()}
                  </div>
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Articles</p>
                  {hasActiveItems && !['shipped', 'delivered', 'cancelled'].includes(order.status) && (
                    <button
                      onClick={() => setCancellingOrder(true)}
                      className="flex items-center gap-1.5 text-xs font-medium text-red-600 hover:text-red-800 transition-colors"
                    >
                      <Ban className="h-3.5 w-3.5" />
                      Annuler toute la commande
                    </button>
                  )}
                </div>
                <div className="border border-gray-100 rounded-lg overflow-hidden">
                  <table className="w-full">
                    <thead>
                      <tr className="bg-gray-50 border-b border-gray-100">
                        <th className="text-left py-2.5 px-4 font-medium text-gray-500 text-xs">Produit</th>
                        <th className="text-right py-2.5 px-4 font-medium text-gray-500 text-xs">Total</th>
                        <th className="text-right py-2.5 px-4 font-medium text-gray-500 text-xs">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {order.order_items.map((item) => {
                        const isCancelled = item.status === 'cancelled';
                        const image = item.product_snapshot?.images?.[item.product_snapshot?.main_image_index ?? 0] || item.product_snapshot?.images?.[0];
                        return (
                          <tr key={item.id} className="border-b border-gray-50 last:border-b-0">
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
                                  <span className={`text-sm font-medium ${isCancelled ? 'text-gray-400 line-through' : 'text-gray-900'}`}>
                                    {item.product_snapshot?.name || 'Produit'}
                                  </span>
                                  {item.is_loyalty_gift && (
                                    <div className="mt-1">
                                      <Badge variant="warning">🎁 Cadeau Fidélité — 0 €</Badge>
                                    </div>
                                  )}
                                  {!isCancelled && item.entrupy_requested && (
                                    <div className="mt-1">
                                      <Badge variant="purple">
                                        <BadgeCheck className="h-3 w-3 mr-1" /> Certificat Entrupy inclus
                                      </Badge>
                                    </div>
                                  )}
                                  {!isCancelled && fulfillmentBadge(item.fulfillment_status) && (
                                    <div className="mt-1 flex items-center gap-2 flex-wrap">
                                      {fulfillmentBadge(item.fulfillment_status)}
                                      {item.shipment_id && ['label_created', 'shipped'].includes(item.fulfillment_status) && (
                                        <button
                                          type="button"
                                          onClick={() => handleSyncSendcloud(item.shipment_id!)}
                                          disabled={syncingShipmentId === item.shipment_id}
                                          title="Interroge Sendcloud pour rafraîchir le statut réel de ce colis"
                                          className="p-0.5 text-gray-400 hover:text-gray-700 disabled:opacity-50"
                                        >
                                          <RefreshCw className={`h-3 w-3 ${syncingShipmentId === item.shipment_id ? 'animate-spin' : ''}`} />
                                        </button>
                                      )}
                                      {item.shipment_parcel?.tracking_number && (
                                        <span className="text-xs text-gray-500">
                                          Suivi : {item.shipment_parcel.tracking_number}
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
                                    <div className="mt-1 flex items-center gap-2 flex-wrap">
                                      <Badge variant="danger">Article annulé</Badge>
                                      {item.cancellation_reason && (
                                        <span className="text-xs text-gray-400">{item.cancellation_reason}</span>
                                      )}
                                      {item.refund_status === 'succeeded' && (
                                        <span className="text-xs text-green-600">Remboursé ({refundMethodLabel(item.refund_method)})</span>
                                      )}
                                      {item.refund_status === 'failed' && (
                                        <span className="text-xs text-red-600">Échec du remboursement</span>
                                      )}
                                    </div>
                                  )}
                                </div>
                              </div>
                            </td>
                            <td className={`py-3 px-4 text-right text-sm font-semibold ${isCancelled ? 'text-gray-400 line-through' : item.is_loyalty_gift ? 'text-amber-600' : 'text-gray-900'}`}>
                              {item.is_loyalty_gift ? 'Offert' : `${item.line_total.toFixed(0)} €`}
                            </td>
                            <td className="py-3 px-4 text-right">
                              {!isCancelled && (
                                <button
                                  onClick={() => setCancellingItem(item)}
                                  className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                                  title="Annuler cet article"
                                >
                                  <Trash2 className="h-4 w-4" />
                                </button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="flex justify-end">
                <div className="w-full sm:w-64 space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-500">Sous-total</span>
                    <span className="text-gray-900">{order.subtotal.toFixed(0)} €</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-500">Livraison</span>
                    <span className="text-gray-900">{order.shipping_cost.toFixed(0)} €</span>
                  </div>
                  <div className="flex justify-between text-base font-semibold border-t border-gray-100 pt-2">
                    <span className="text-gray-900">Total net</span>
                    <span className="text-gray-900">{order.total_amount.toFixed(0)} €</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {cancellingItem && (
        <CancelItemPanel
          item={cancellingItem}
          isPaid={isPaid}
          hasStripePayment={hasStripePayment}
          onCancel={() => setCancellingItem(null)}
          onConfirmed={handleItemConfirmed}
        />
      )}

      {cancellingOrder && (
        <CancelOrderPanel
          order={order}
          isPaid={isPaid}
          hasStripePayment={hasStripePayment}
          onCancel={() => setCancellingOrder(false)}
          onConfirmed={handleOrderConfirmed}
        />
      )}
    </>
  );
};
