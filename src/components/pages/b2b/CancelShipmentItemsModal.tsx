import React, { useMemo, useState } from 'react';
import { X, AlertCircle, ImageOff } from 'lucide-react';
import { AdminShipment } from '../../../hooks/useAdminShipments';
import { invokeEdgeFunction } from '../../../utils/invokeEdgeFunction';

const CANCEL_REASONS = [
  'Article non reçu du fournisseur',
  'Article perdu / endommagé avant envoi',
  'Rupture de stock / Article introuvable',
  'Demande du client',
];

const RESTOCK_OPTIONS: { value: 'draft' | 'for-sale-b2b' | 'archived'; label: string }[] = [
  { value: 'archived', label: "Archiver l'article" },
  { value: 'draft', label: 'Remettre en brouillon' },
  { value: 'for-sale-b2b', label: 'Remettre au catalogue B2B' },
];

export interface CancelShipmentItemsResult {
  success: boolean;
  error?: string;
  cancelled_count?: number;
  items_refunded?: number;
  entrupy_refunded?: number;
  shipping_refunded?: number;
  shipment_status?: string;
  failures?: string[];
}

interface CancelShipmentItemsModalProps {
  shipment: AdminShipment;
  onClose: () => void;
  onDone: (result: CancelShipmentItemsResult) => void;
}

const EUR = (n: number) => n.toFixed(2).replace('.', ',') + ' €';

/** Annulation d'un ou plusieurs articles d'une demande de livraison pas
 * encore étiquetés (article jamais reçu) : remboursement du prix de
 * l'article ET, au choix, des frais de port — Edge Function
 * cancel-shipment-items (voir 0161). */
export const CancelShipmentItemsModal: React.FC<CancelShipmentItemsModalProps> = ({ shipment, onClose, onDone }) => {
  const items = shipment.pendingItems;
  const [selected, setSelected] = useState<Set<string>>(() => new Set(items.length === 1 ? [items[0].id] : []));
  const [reason, setReason] = useState(CANCEL_REASONS[0]);
  const [restockAction, setRestockAction] = useState<'draft' | 'for-sale-b2b' | 'archived'>('archived');
  const selectedItems = items.filter((i) => selected.has(i.id));
  const allSelected = selectedItems.length === items.length && items.length > 0;

  // Stripe n'est possible que si TOUTES les commandes payées concernées ont
  // une part carte (sinon remboursement au solde uniquement).
  const itemStripeOk = selectedItems.length > 0 && selectedItems.every((i) => i.order?.payment_status !== 'paid' || Boolean(i.order?.stripe_payment_intent_id));
  const [itemRefundMethod, setItemRefundMethod] = useState<'wallet' | 'stripe'>('stripe');
  const effectiveItemMethod = itemStripeOk ? itemRefundMethod : 'wallet';

  const hasFee = shipment.shipping_cost > 0;
  const [shippingMethod, setShippingMethod] = useState<'wallet' | 'stripe' | 'none'>(hasFee ? (shipment.has_stripe_payment ? 'stripe' : 'wallet') : 'none');
  const [shippingAmountInput, setShippingAmountInput] = useState<string | null>(null);
  // Par défaut : frais de port intégralement remboursés si TOUTE la demande
  // est annulée, rien sinon (le reste sera quand même expédié) — modifiable.
  const defaultShippingAmount = allSelected ? shipment.shipping_cost : 0;
  const shippingAmount = shippingAmountInput === null ? defaultShippingAmount : Number(shippingAmountInput.replace(',', '.'));
  const effectiveShippingMethod = !hasFee || !(shippingAmount > 0) ? 'none' : shippingMethod;

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const itemsTotal = useMemo(
    () => selectedItems
      .filter((i) => i.order?.payment_status === 'paid')
      .reduce((s, i) => s + Number(i.line_total) + (i.insured ? Number(i.insurance_cost) : 0), 0),
    [selectedItems]
  );

  // Certificats Entrupy des articles annulés : remboursés automatiquement en
  // crédit sur le solde par cancel_b2b_order_item (0162), en plus du prix.
  const entrupyItems = selectedItems.filter((i) => i.order?.payment_status === 'paid' && i.entrupy_requested && Number(i.entrupy_cost) > 0);
  const entrupyTotal = entrupyItems.reduce((s, i) => s + Number(i.entrupy_cost), 0);
  const plural = entrupyItems.length > 1 ? 's' : '';

  const toggle = (id: string) => setSelected((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const handleConfirm = async () => {
    if (selectedItems.length === 0) {
      setError('Sélectionnez au moins un article');
      return;
    }
    if (effectiveShippingMethod !== 'none' && (!(shippingAmount > 0) || shippingAmount > shipment.shipping_cost)) {
      setError(`Montant des frais de port invalide (max ${EUR(shipment.shipping_cost)})`);
      return;
    }
    setSubmitting(true);
    setError('');
    const { data, error: fnError } = await invokeEdgeFunction<CancelShipmentItemsResult>('cancel-shipment-items', {
      shipment_id: shipment.id,
      item_ids: selectedItems.map((i) => i.id),
      reason,
      restock_action: restockAction,
      item_refund_method: effectiveItemMethod,
      shipping_refund_method: effectiveShippingMethod,
      shipping_refund_amount: effectiveShippingMethod === 'none' ? 0 : shippingAmount,
    });
    setSubmitting(false);
    if (fnError) {
      setError(fnError);
      return;
    }
    onDone({ success: true, ...(data || {}) });
  };

  const radio = 'h-4 w-4 text-gray-900 focus:ring-gray-900 mt-0.5';

  return (
    <div className="fixed inset-0 z-[60] overflow-y-auto">
      <div className="fixed inset-0 bg-black bg-opacity-50" onClick={onClose} />
      <div className="flex min-h-full items-center justify-center p-4">
        <div className="relative bg-white rounded-xl shadow-xl w-full max-w-lg" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center justify-between p-5 border-b border-gray-100">
            <h3 className="text-base font-semibold text-gray-900">Annuler {items.length > 1 ? 'des articles' : "l'article"}</h3>
            <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600 rounded-lg transition-colors">
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="p-5 space-y-5">
            <div>
              <p className="text-sm font-medium text-gray-700 mb-2">
                {items.length > 1 ? 'Articles à annuler' : 'Article à annuler'}
              </p>
              <div className="border border-gray-200 rounded-lg divide-y divide-gray-100">
                {items.map((item) => {
                  const image = item.product?.images?.[item.product.main_image_index] || item.product?.images?.[0];
                  const paid = item.order?.payment_status === 'paid';
                  return (
                    <label key={item.id} className="flex items-center gap-3 p-2.5 cursor-pointer hover:bg-gray-50">
                      <input type="checkbox" checked={selected.has(item.id)} onChange={() => toggle(item.id)} className="h-4 w-4 rounded border-gray-300 text-gray-900 focus:ring-gray-400 flex-shrink-0" />
                      <div className="h-9 w-9 bg-gray-100 rounded flex items-center justify-center overflow-hidden flex-shrink-0">
                        {image ? <img src={image} alt="" className="h-full w-full object-cover" /> : <ImageOff className="h-4 w-4 text-gray-300" />}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm text-gray-900 truncate">{item.product?.name || 'Article'}</p>
                        <p className="text-xs text-gray-400">
                          {item.product?.b2b_reference || item.product?.reference || '—'} · {item.order?.order_number || '—'}
                          {!paid && ' · non payé'}
                        </p>
                      </div>
                      <span className="text-sm font-medium text-gray-900 flex-shrink-0">
                        {EUR(Number(item.line_total) + (item.insured ? Number(item.insurance_cost) : 0))}
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>

            <div>
              <label htmlFor="cancel-items-reason" className="block text-sm font-medium text-gray-700 mb-2">Raison</label>
              <select
                id="cancel-items-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:border-gray-400 text-sm bg-white"
              >
                {CANCEL_REASONS.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>

            <div>
              <p className="text-sm font-medium text-gray-700 mb-2">Que faire de la fiche produit ?</p>
              <div className="space-y-1.5">
                {RESTOCK_OPTIONS.map((opt) => (
                  <label key={opt.value} className="flex items-start gap-2 text-sm text-gray-700">
                    <input type="radio" name="cancel-items-restock" checked={restockAction === opt.value} onChange={() => setRestockAction(opt.value)} className={radio} />
                    {opt.label}
                  </label>
                ))}
              </div>
            </div>

            {itemsTotal > 0 && (
              <div>
                <p className="text-sm font-medium text-gray-700 mb-2">Remboursement des articles : {EUR(itemsTotal)}</p>
                <div className="space-y-1.5">
                  <label className={`flex items-start gap-2 text-sm ${itemStripeOk ? 'text-gray-700' : 'text-gray-400'}`}>
                    <input type="radio" name="cancel-items-refund" checked={effectiveItemMethod === 'stripe'} onChange={() => setItemRefundMethod('stripe')} disabled={!itemStripeOk} className={radio} />
                    <span>
                      Sur la carte (Stripe)
                      {!itemStripeOk && <span className="block text-xs">Indisponible : une des commandes a été payée avec le solde.</span>}
                    </span>
                  </label>
                  <label className="flex items-start gap-2 text-sm text-gray-700">
                    <input type="radio" name="cancel-items-refund" checked={effectiveItemMethod === 'wallet'} onChange={() => setItemRefundMethod('wallet')} className={radio} />
                    En crédit sur le solde du revendeur
                  </label>
                </div>
              </div>
            )}

            {entrupyTotal > 0 && (
              <p className="text-sm text-purple-800 bg-purple-50 border border-purple-100 rounded-lg p-2.5">
                Certificat{plural} Entrupy : {EUR(entrupyTotal)} annulé{plural} et remboursé{plural} automatiquement en crédit sur le solde.
              </p>
            )}

            {hasFee && (
              <div>
                <p className="text-sm font-medium text-gray-700 mb-2">Frais de port payés : {EUR(shipment.shipping_cost)}</p>
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-sm text-gray-600">Montant à rembourser</span>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={shippingAmountInput ?? String(defaultShippingAmount)}
                    onChange={(e) => setShippingAmountInput(e.target.value)}
                    className="w-24 px-2 py-1 border border-gray-200 rounded-lg text-sm text-right focus:outline-none focus:border-gray-400"
                  />
                  <span className="text-sm text-gray-600">€</span>
                </div>
                {shippingAmount > 0 && (
                  <div className="space-y-1.5">
                    <label className={`flex items-start gap-2 text-sm ${shipment.has_stripe_payment ? 'text-gray-700' : 'text-gray-400'}`}>
                      <input type="radio" name="cancel-items-shipping" checked={shippingMethod === 'stripe'} onChange={() => setShippingMethod('stripe')} disabled={!shipment.has_stripe_payment} className={radio} />
                      Sur la carte (Stripe)
                    </label>
                    <label className="flex items-start gap-2 text-sm text-gray-700">
                      <input type="radio" name="cancel-items-shipping" checked={shippingMethod === 'wallet'} onChange={() => setShippingMethod('wallet')} className={radio} />
                      En crédit sur le solde du revendeur
                    </label>
                    <label className="flex items-start gap-2 text-sm text-gray-700">
                      <input type="radio" name="cancel-items-shipping" checked={shippingMethod === 'none'} onChange={() => setShippingMethod('none')} className={radio} />
                      Ne pas rembourser les frais de port
                    </label>
                  </div>
                )}
                {!allSelected && (
                  <p className="text-xs text-gray-400 mt-1.5">Le reste de la demande sera toujours expédié : par défaut, aucun frais de port n'est remboursé.</p>
                )}
              </div>
            )}

            {error && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-3 flex items-center space-x-2">
                <AlertCircle className="h-4 w-4 text-red-600 flex-shrink-0" />
                <p className="text-sm text-red-700">{error}</p>
              </div>
            )}
          </div>

          <div className="flex justify-end gap-3 p-5 pt-0">
            <button onClick={onClose} disabled={submitting} className="px-4 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors text-sm disabled:opacity-50">
              Retour
            </button>
            <button
              onClick={handleConfirm}
              disabled={submitting || selectedItems.length === 0}
              className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors text-sm font-medium disabled:opacity-50"
            >
              {submitting ? 'Annulation...' : `Annuler ${selectedItems.length > 1 ? `${selectedItems.length} articles` : "l'article"}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default CancelShipmentItemsModal;
