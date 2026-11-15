import React, { useCallback, useEffect, useState } from 'react';
import { Gift, Landmark } from 'lucide-react';
import { supabase } from '../../lib/supabase';

interface CreditRow {
  id: string;
  amount: number;
  note: string | null;
  created_at: string;
  /** Rechargement par virement (0292) : bonus inclus dans amount. */
  bank_transaction_id?: string | null;
  paid_amount?: number | null;
  bonus_amount?: number | null;
}

const EUR = (n: number) => n.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' });

/**
 * « Vous avez reçu un crédit » : affiché à l'arrivée du membre sur son
 * espace pour chaque crédit manuel de l'admin pas encore vu
 * (wallet_transactions 'ajustement_admin' > 0, acknowledged_at null, 0206)
 * — montant et note de l'admin. « Merci ! » les marque comme vus.
 * Lecture tolérante : rien ne s'affiche avant la migration 0206.
 */
export const WalletCreditNotice: React.FC<{ profileId: string | undefined; onAcknowledged?: () => void }> = ({ profileId, onAcknowledged }) => {
  const [credits, setCredits] = useState<CreditRow[]>([]);
  const [closing, setClosing] = useState(false);

  const load = useCallback(async () => {
    if (!profileId) return;
    const { data, error } = await supabase
      .from('wallet_transactions')
      .select('id, amount, note, created_at, bank_transaction_id, paid_amount, bonus_amount')
      .eq('profile_id', profileId)
      // Crédit admin, ou rechargement par virement crédité par la synchro Qonto (0292).
      .or('type.eq.ajustement_admin,bank_transaction_id.not.is.null')
      .gt('amount', 0)
      .is('acknowledged_at', null)
      .order('created_at', { ascending: true });
    if (error) return;
    setCredits(((data || []) as CreditRow[]).map((c) => ({ ...c, amount: Number(c.amount) })));
  }, [profileId]);

  // Au montage, à chaque changement de solde (événement de useWallet) et
  // toutes les 20 s : le popup s'ouvre dès qu'un virement est crédité.
  useEffect(() => {
    load();
    const onChanged = () => load();
    window.addEventListener('oze:wallet-changed', onChanged);
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') load();
    }, 20000);
    return () => {
      window.removeEventListener('oze:wallet-changed', onChanged);
      clearInterval(timer);
    };
  }, [load]);

  if (credits.length === 0) return null;

  const total = credits.reduce((sum, c) => sum + c.amount, 0);
  const allTransfers = credits.every((c) => c.bank_transaction_id);
  const bonusTotal = credits.reduce((sum, c) => sum + (Number(c.bonus_amount) || 0), 0);

  const handleClose = async () => {
    setClosing(true);
    await supabase.rpc('acknowledge_wallet_credits', { p_transaction_ids: credits.map((c) => c.id) });
    setClosing(false);
    setCredits([]);
    onAcknowledged?.();
  };

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/40" />
      <div className="relative w-full max-w-md rounded-xl bg-white shadow-xl">
        <div className="p-6 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-green-50">
            {allTransfers ? <Landmark className="h-6 w-6 text-green-600" /> : <Gift className="h-6 w-6 text-green-600" />}
          </div>
          <h3 className="text-lg font-semibold text-gray-900">{allTransfers ? 'Votre virement est arrivé !' : 'Vous avez reçu un crédit'}</h3>
          <p className="mt-2 text-3xl font-bold text-green-600 tabular-nums">+{EUR(total)}</p>
          <p className="mt-1 text-sm text-gray-500">{allTransfers ? 'crédités sur votre solde, disponibles tout de suite pour vos achats.' : 'a été ajouté à votre solde B2B.'}</p>
          {bonusTotal > 0 && (
            <p className="mt-2 inline-block rounded-full bg-amber-50 px-3 py-1 text-sm font-medium text-amber-800">dont {EUR(bonusTotal)} de bonus virement offerts 🎁</p>
          )}

          <div className="mt-5 space-y-2 text-left">
            {credits.map((c) => (
              <div key={c.id} className="rounded-lg border border-gray-100 bg-gray-50 p-3">
                {credits.length > 1 && <p className="text-xs font-semibold text-gray-900">+{EUR(c.amount)}</p>}
                {c.bank_transaction_id ? (
                  <p className="text-sm text-gray-700">
                    Virement de {EUR(Number(c.paid_amount) || c.amount)}{Number(c.bonus_amount) > 0 ? ` + ${EUR(Number(c.bonus_amount))} de bonus` : ''}
                  </p>
                ) : (
                  c.note && <p className="text-sm text-gray-700 whitespace-pre-line">« {c.note} »</p>
                )}
                <p className="mt-1 text-xs text-gray-400">
                  {new Date(c.created_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })} — L'équipe OZË PARIS
                </p>
              </div>
            ))}
          </div>
        </div>
        <div className="px-6 pb-6">
          <button
            type="button"
            onClick={handleClose}
            disabled={closing}
            className="w-full rounded-lg bg-gray-900 py-2.5 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
          >
            {closing ? '...' : 'Merci !'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default WalletCreditNotice;
