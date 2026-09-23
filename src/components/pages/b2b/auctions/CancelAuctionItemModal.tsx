import React, { useState } from 'react';
import { X, AlertCircle, ImageOff } from 'lucide-react';
import { AdminAuctionItem, AuctionRestockAction, CancelAuctionItemResult } from '../../../../hooks/useAdminAuctionItems';

const CANCEL_REASONS = [
  'Non-paiement du revendeur',
  'Article défectueux / non conforme',
  'Article indisponible',
  'Demande du revendeur',
  'Erreur d’adjudication',
  'Autre',
];

const RESTOCK_OPTIONS: { value: AuctionRestockAction; label: string }[] = [
  { value: 'draft-b2b', label: 'Remettre en brouillon B2B (réutilisable pour une prochaine session)' },
  { value: 'for-sale-b2b', label: 'Remettre au catalogue B2B' },
  { value: 'archived', label: 'Archiver l’article' },
];

interface CancelAuctionItemModalProps {
  item: AdminAuctionItem;
  onClose: () => void;
  onConfirm: (reason: string, restockAction: AuctionRestockAction, refundMethod?: 'wallet' | 'stripe') => Promise<CancelAuctionItemResult>;
}

/** Annulation admin d'un lot adjugé (payé ou non) — voir 0156 /
 * cancel-auction-item. Le choix du remboursement n'apparaît que si le lot a
 * été payé ; Stripe n'est proposé que s'il y a eu une part carte. */
export const CancelAuctionItemModal: React.FC<CancelAuctionItemModalProps> = ({ item, onClose, onConfirm }) => {
  const isPaid = item.order_payment_status === 'paid';
  const hasStripePayment = item.order_has_stripe_payment;
  const [reason, setReason] = useState(isPaid ? CANCEL_REASONS[1] : CANCEL_REASONS[0]);
  const [restockAction, setRestockAction] = useState<AuctionRestockAction>('draft-b2b');
  const [refundMethod, setRefundMethod] = useState<'wallet' | 'stripe'>(hasStripePayment ? 'stripe' : 'wallet');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const handleConfirm = async () => {
    setSubmitting(true);
    setError('');
    const result = await onConfirm(reason, restockAction, isPaid ? refundMethod : undefined);
    setSubmitting(false);
    if (!result.success) setError(result.error || 'Impossible d’annuler ce lot');
  };

  const radio = 'h-4 w-4 text-gray-900 focus:ring-gray-900';

  return (
    <div className="fixed inset-0 z-[60] overflow-y-auto">
      <div className="fixed inset-0 bg-black bg-opacity-50" onClick={onClose} />
      <div className="flex min-h-full items-center justify-center p-4">
        <div className="relative bg-white rounded-xl shadow-xl w-full max-w-md" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center justify-between p-5 border-b border-gray-100">
            <h3 className="text-base font-semibold text-gray-900">Annuler ce lot</h3>
            <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600 rounded-lg transition-colors">
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="p-5 space-y-4">
            <div className="bg-gray-50 rounded-lg p-3 flex items-center gap-3">
              <div className="h-10 w-10 bg-white rounded-lg flex items-center justify-center flex-shrink-0 overflow-hidden border border-gray-100">
                {item.images?.[0] ? <img src={item.images[0]} alt="" className="h-full w-full object-cover" /> : <ImageOff className="h-4 w-4 text-gray-300" />}
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium text-gray-900 truncate">{item.title}</p>
                <p className="text-xs text-gray-500">
                  Adjugé {item.current_price.toFixed(2)} € à {item.winner_name || item.winner_email || '—'}
                </p>
                <p className="text-xs font-medium text-gray-700 mt-0.5">
                  {isPaid ? `Payé — à rembourser : ${item.current_price.toFixed(2)} €` : 'Pas encore payé — aucun remboursement'}
                </p>
              </div>
            </div>

            <div>
              <label htmlFor="auction-cancel-reason" className="block text-sm font-medium text-gray-700 mb-2">Raison</label>
              <select
                id="auction-cancel-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:border-gray-400 text-sm bg-white"
              >
                {CANCEL_REASONS.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>

            {item.product_id && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Que faire de l'article ?</label>
                <div className="space-y-2">
                  {RESTOCK_OPTIONS.map((opt) => (
                    <label key={opt.value} className="flex items-center gap-2 text-sm text-gray-700">
                      <input type="radio" name="auction-restock" checked={restockAction === opt.value} onChange={() => setRestockAction(opt.value)} className={radio} />
                      {opt.label}
                    </label>
                  ))}
                </div>
              </div>
            )}

            {isPaid && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Mode de remboursement</label>
                <div className="space-y-2">
                  <label className={`flex items-start gap-2 text-sm ${hasStripePayment ? 'text-gray-700' : 'text-gray-400'}`}>
                    <input
                      type="radio"
                      name="auction-refund"
                      checked={refundMethod === 'stripe'}
                      onChange={() => setRefundMethod('stripe')}
                      disabled={!hasStripePayment}
                      className={`${radio} mt-0.5`}
                    />
                    <span>
                      Stripe (carte bancaire)
                      <span className="block text-xs text-gray-400">
                        {hasStripePayment
                          ? 'La part payée par carte est remboursée sur la carte ; une éventuelle part payée avec le solde revient au solde.'
                          : 'Indisponible : ce lot a été payé entièrement avec le solde.'}
                      </span>
                    </span>
                  </label>
                  <label className="flex items-start gap-2 text-sm text-gray-700">
                    <input type="radio" name="auction-refund" checked={refundMethod === 'wallet'} onChange={() => setRefundMethod('wallet')} className={`${radio} mt-0.5`} />
                    <span>
                      Crédit sur le solde du revendeur
                      <span className="block text-xs text-gray-400">Le montant total est crédité sur son portefeuille OZË.</span>
                    </span>
                  </label>
                </div>
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
              disabled={submitting}
              className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors text-sm font-medium disabled:opacity-50"
            >
              {submitting ? 'Annulation...' : 'Confirmer l’annulation'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default CancelAuctionItemModal;
