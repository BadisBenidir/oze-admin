import React, { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, Clock, Loader2 } from 'lucide-react';
import { Card, CardContent } from '../../ui/Card';
import { supabase } from '../../../lib/supabase';

interface OfferFee {
  id: string;
  amount: number;
  paid_at: string;
  awaiting_payment: boolean;
  profiles: { first_name: string | null; last_name: string | null; email: string | null } | null;
}

const formatEur = (n: number) => n.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' });
const formatDate = (d: string) => new Date(d).toLocaleDateString('fr-FR');

/**
 * Offre 2 000 € (groupe 5, 0222 / 0231) : 300 € dus par le partenaire pour
 * chaque membre. « À percevoir » tant que la réception n'est pas confirmée —
 * hors CA abonnements jusque-là.
 */
export const CommunityOfferFeesCard: React.FC<{ resellerId: string }> = ({ resellerId }) => {
  const [fees, setFees] = useState<OfferFee[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data, error: loadError } = await supabase
      .from('community_subscription_payments')
      .select('id, amount, paid_at, awaiting_payment, profiles(first_name, last_name, email)')
      .eq('reseller_id', resellerId)
      .eq('billing_reason', 'partner_offer')
      .order('created_at', { ascending: false });
    if (!loadError) setFees((data || []) as unknown as OfferFee[]);
  }, [resellerId]);

  useEffect(() => { load(); }, [load]);

  const mark = async (fee: OfferFee, received: boolean) => {
    setBusyId(fee.id);
    setError(null);
    const { error: rpcError } = await supabase.rpc('admin_mark_offer_fee_received', { p_payment_id: fee.id, p_received: received });
    if (rpcError) setError(rpcError.message);
    await load();
    setBusyId(null);
  };

  if (fees.length === 0) return null;
  const pending = fees.filter((f) => f.awaiting_payment).reduce((s, f) => s + Number(f.amount), 0);

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-sm font-semibold text-gray-900">Offre 2 000 € — 300 € par membre</p>
          {pending > 0 && <p className="text-xs font-medium text-amber-700">À percevoir : {formatEur(pending)}</p>}
        </div>
        <p className="text-xs text-gray-500">Comptés dans le CA abonnements uniquement une fois reçus.</p>
        <ul className="divide-y divide-gray-100">
          {fees.map((f) => {
            const c = f.profiles;
            const name = [c?.first_name, c?.last_name].filter(Boolean).join(' ') || c?.email || 'Membre';
            return (
              <li key={f.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                <span className="text-gray-900">{name}</span>
                <span className="flex items-center gap-3">
                  {f.awaiting_payment ? (
                    <>
                      <span className="flex items-center gap-1 text-xs text-amber-700"><Clock className="h-3.5 w-3.5" /> À percevoir · {formatEur(Number(f.amount))}</span>
                      <button
                        type="button"
                        onClick={() => mark(f, true)}
                        disabled={busyId !== null}
                        className="flex items-center gap-1 rounded-lg bg-gray-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-gray-800 disabled:opacity-50"
                      >
                        {busyId === f.id && <Loader2 className="h-3.5 w-3.5 animate-spin" />} 300 € reçus
                      </button>
                    </>
                  ) : (
                    <>
                      <span className="flex items-center gap-1 text-xs text-green-700"><CheckCircle2 className="h-3.5 w-3.5" /> Reçu le {formatDate(f.paid_at)} · {formatEur(Number(f.amount))}</span>
                      <button type="button" onClick={() => mark(f, false)} disabled={busyId !== null} className="text-xs text-gray-400 hover:text-gray-600 disabled:opacity-50">
                        Annuler
                      </button>
                    </>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
        {error && <p className="text-xs text-red-600">{error}</p>}
      </CardContent>
    </Card>
  );
};

export default CommunityOfferFeesCard;
