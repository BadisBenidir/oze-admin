import React, { useEffect, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { supabase } from '../../../lib/supabase';
import { invokeEdgeFunction } from '../../../utils/invokeEdgeFunction';

/**
 * Soldes de portefeuille réservés par des paiements mixtes (solde + carte)
 * jamais terminés : affiché seulement s'il en reste, avec un bouton qui les
 * libère pour tous les revendeurs (release-pending-wallet-debits, mode
 * admin). Un paiement réellement payé n'est jamais recrédité.
 */
export const PendingWalletDebitsButton: React.FC = () => {
  const [pending, setPending] = useState<{ count: number; total: number } | null>(null);
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const load = async () => {
    const { data, error } = await supabase
      .from('wallet_transactions')
      .select('amount')
      .eq('type', 'achat')
      .eq('status', 'pending')
      .not('stripe_session_id', 'is', null);
    if (error) return;
    const rows = data || [];
    setPending({ count: rows.length, total: rows.reduce((s, r) => s + Math.abs(Number(r.amount) || 0), 0) });
  };

  useEffect(() => {
    load();
  }, []);

  if (!pending || (pending.count === 0 && !message)) return null;

  const release = async () => {
    if (!confirm(`Libérer ${pending.count} solde(s) réservé(s) par des paiements non terminés ? Les sessions Stripe encore ouvertes seront annulées ; un paiement déjà réglé n'est jamais recrédité.`)) return;
    setWorking(true);
    const { data, error } = await invokeEdgeFunction<{ released: number; still_processing: number; checked: number }>(
      'release-pending-wallet-debits',
      { all: true },
    );
    setWorking(false);
    if (error) {
      setMessage(`Échec : ${error}`);
      return;
    }
    const amount = (data?.released ?? 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    setMessage(
      `${amount} € recrédités aux revendeurs concernés.` +
        (data?.still_processing ? ` ${data.still_processing} paiement(s) réellement réglé(s) laissé(s) tel(s) quel(s).` : ''),
    );
    load();
  };

  return (
    <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3">
      <p className="flex items-start gap-2 text-sm text-amber-900">
        <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
        {message ?? (
          <span>
            <strong>{pending.count}</strong> solde{pending.count > 1 ? 's' : ''} de portefeuille réservé{pending.count > 1 ? 's' : ''} par des paiements
            « solde + carte » jamais terminés ({pending.total.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €).
          </span>
        )}
      </p>
      {pending.count > 0 && (
        <button
          onClick={release}
          disabled={working}
          className="rounded-lg bg-amber-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50"
        >
          {working ? 'Libération…' : 'Libérer ces soldes'}
        </button>
      )}
    </div>
  );
};

export default PendingWalletDebitsButton;
