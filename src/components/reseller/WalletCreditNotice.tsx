import React, { useEffect, useState } from 'react';
import { Gift } from 'lucide-react';
import { supabase } from '../../lib/supabase';

interface CreditRow {
  id: string;
  amount: number;
  note: string | null;
  created_at: string;
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

  useEffect(() => {
    if (!profileId) return;
    let cancelled = false;
    supabase
      .from('wallet_transactions')
      .select('id, amount, note, created_at')
      .eq('profile_id', profileId)
      .eq('type', 'ajustement_admin')
      .gt('amount', 0)
      .is('acknowledged_at', null)
      .order('created_at', { ascending: true })
      .then(({ data, error }) => {
        if (cancelled || error) return;
        setCredits(((data || []) as CreditRow[]).map((c) => ({ ...c, amount: Number(c.amount) })));
      });
    return () => {
      cancelled = true;
    };
  }, [profileId]);

  if (credits.length === 0) return null;

  const total = credits.reduce((sum, c) => sum + c.amount, 0);

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
            <Gift className="h-6 w-6 text-green-600" />
          </div>
          <h3 className="text-lg font-semibold text-gray-900">Vous avez reçu un crédit</h3>
          <p className="mt-2 text-3xl font-bold text-green-600 tabular-nums">+{EUR(total)}</p>
          <p className="mt-1 text-sm text-gray-500">a été ajouté à votre solde B2B.</p>

          <div className="mt-5 space-y-2 text-left">
            {credits.map((c) => (
              <div key={c.id} className="rounded-lg border border-gray-100 bg-gray-50 p-3">
                {credits.length > 1 && <p className="text-xs font-semibold text-gray-900">+{EUR(c.amount)}</p>}
                {c.note && <p className="text-sm text-gray-700 whitespace-pre-line">« {c.note} »</p>}
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
