import React, { useState } from 'react';
import { Tag } from 'lucide-react';
import { Modal } from '../../ui/Modal';
import { invokeEdgeFunction } from '../../../utils/invokeEdgeFunction';
import { supabase } from '../../../lib/supabase';

interface Preview {
  plan_price: number;
  next_amount: number | null;
  next_date: string | null;
  discounts: string[];
  cancel_at_period_end: boolean;
}

const eur = (n: number) => n.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' });
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long' }) : '—');

/**
 * Prix mensuel fixé par l'admin pour un abonné Club (admin-subscription-price) :
 * coupon Stripe « à vie » appliqué dès le prochain prélèvement.
 */
export const SubscriptionPriceControl: React.FC<{ resellerId: string; name: string; onChanged?: () => void }> = ({ resellerId, name, onChanged }) => {
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [price, setPrice] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Dernière échéance payée (b2b_subscription_payments, hors remboursements).
  const [lastPayment, setLastPayment] = useState<{ amount: number; paid_at: string; promo_code: string | null } | null>(null);

  const start = async () => {
    setOpen(true);
    setPreview(null);
    setError(null);
    setPrice('');
    setLastPayment(null);
    setLoading(true);
    supabase
      .from('b2b_subscription_payments')
      .select('amount, paid_at, promo_code')
      .eq('reseller_id', resellerId)
      .gt('amount', 0)
      .order('paid_at', { ascending: false })
      .limit(1)
      .maybeSingle()
      .then(({ data }) => setLastPayment(data ? { ...data, amount: Number(data.amount) } : null));
    const { data, error: e } = await invokeEdgeFunction<Preview>('admin-subscription-price', { action: 'preview', resellerId });
    setLoading(false);
    if (e || !data) return setError(e || "Lecture de l'abonnement impossible");
    setPreview(data);
    setPrice((data.next_amount ?? data.plan_price).toFixed(2).replace('.', ','));
  };

  const parsed = Number(price.replace(',', '.'));
  const valid = price.trim() !== '' && Number.isFinite(parsed) && parsed >= 0;

  const save = async () => {
    if (!preview || !valid) return;
    setLoading(true);
    setError(null);
    const { data, error: e } = await invokeEdgeFunction<{ success: boolean; price: number }>('admin-subscription-price', {
      action: 'set',
      resellerId,
      price: parsed,
    });
    setLoading(false);
    if (e || !data?.success) return setError(e || 'Modification impossible');
    setOpen(false);
    alert(`${name} paiera ${eur(data.price)} par mois à partir du prochain prélèvement${preview.next_date ? ` (${day(preview.next_date)})` : ''}.`);
    onChanged?.();
  };

  return (
    <>
      <button
        type="button"
        onClick={start}
        className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
      >
        <Tag className="h-3.5 w-3.5" /> Modifier son prix mensuel
      </button>

      <Modal isOpen={open} onClose={() => !loading && setOpen(false)} title={`Prix mensuel de ${name}`}>
        <div className="space-y-4 text-sm">
          {loading && !preview && <p className="text-gray-500">Lecture de l'abonnement chez Stripe…</p>}
          {preview && (
            <>
              <div className="space-y-1 rounded-lg bg-gray-50 p-3">
                <p>Prix du pass : <strong>{eur(preview.plan_price)}</strong> / mois</p>
                <p>
                  Dernier mois payé :{' '}
                  {lastPayment ? (
                    <>
                      <strong>{eur(lastPayment.amount)}</strong> le {day(lastPayment.paid_at)}
                      {lastPayment.promo_code ? ` (code ${lastPayment.promo_code.replace(/^coupon:/, '')})` : ''}
                      {lastPayment.amount < preview.plan_price && (
                        <button
                          type="button"
                          onClick={() => setPrice(lastPayment.amount.toFixed(2).replace('.', ','))}
                          className="ml-2 text-xs font-medium text-gray-700 underline hover:text-gray-900"
                        >
                          Garder ce prix
                        </button>
                      )}
                    </>
                  ) : (
                    '—'
                  )}
                </p>
                <p>Remise en cours : {preview.discounts.length ? preview.discounts.join(', ') : 'aucune'}</p>
                <p>
                  Prochain prélèvement : <strong>{preview.next_amount !== null ? eur(preview.next_amount) : '—'}</strong>
                  {preview.next_date ? ` le ${day(preview.next_date)}` : ''}
                  {preview.cancel_at_period_end ? ' (résiliation programmée)' : ''}
                </p>
              </div>
              <div>
                <label className="mb-1 block font-medium text-gray-900">Nouveau prix mensuel (€)</label>
                <input
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                  inputMode="decimal"
                  autoFocus
                  className="w-40 rounded-lg border border-gray-300 px-3 py-2 focus:border-gray-500 focus:outline-none"
                />
                <p className="mt-1.5 text-xs text-gray-500">
                  Appliqué à vie dès le prochain prélèvement, sans facturation immédiate. Remplace la remise en cours. Mettre {eur(preview.plan_price).replace(/\s/g, ' ')} (ou plus) retire toute remise.
                </p>
              </div>
            </>
          )}
          {error && <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-red-700">{error}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setOpen(false)} disabled={loading} className="rounded-lg px-3 py-2 text-gray-600 hover:bg-gray-100">
              Annuler
            </button>
            <button
              type="button"
              onClick={save}
              disabled={loading || !preview || !valid}
              className="rounded-lg bg-gray-900 px-4 py-2 font-medium text-white hover:bg-gray-800 disabled:opacity-50"
            >
              {loading && preview ? 'Enregistrement…' : valid ? `Passer à ${eur(parsed)} / mois` : 'Enregistrer'}
            </button>
          </div>
        </div>
      </Modal>
    </>
  );
};
