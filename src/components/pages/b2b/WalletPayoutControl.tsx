import React, { useState } from 'react';
import { Landmark } from 'lucide-react';
import { Modal } from '../../ui/Modal';
import { invokeEdgeFunction } from '../../../utils/invokeEdgeFunction';

interface Preview {
  wallet_balance: number;
  card_refundable: number;
  max_amount: number;
}

const eur = (n: number) => n.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' });

/**
 * Rembourse tout ou partie du solde portefeuille d'un membre sur sa carte
 * (convert-item-refund-to-card, actions wallet_preview / wallet_payout) :
 * le solde est débité puis remboursé sur les paiements carte de ses recharges.
 */
export const WalletPayoutControl: React.FC<{ profileId: string; resellerId: string; name: string; onDone?: () => void }> = ({
  profileId,
  resellerId,
  name,
  onDone,
}) => {
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [amount, setAmount] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const start = async () => {
    setOpen(true);
    setPreview(null);
    setError(null);
    setAmount('');
    setLoading(true);
    const { data, error: e } = await invokeEdgeFunction<Preview>('convert-item-refund-to-card', {
      action: 'wallet_preview',
      profile_id: profileId,
      reseller_id: resellerId,
    });
    setLoading(false);
    if (e || !data) return setError(e || 'Lecture du solde impossible');
    setPreview(data);
    setAmount(data.max_amount.toFixed(2).replace('.', ','));
  };

  const parsed = Number(amount.replace(',', '.'));
  const valid = Boolean(preview) && amount.trim() !== '' && Number.isFinite(parsed) && parsed > 0 && parsed <= (preview?.max_amount ?? 0);

  const submit = async () => {
    if (!valid) return;
    if (!window.confirm(`Rembourser ${eur(parsed)} du solde de ${name} sur sa carte bancaire ?`)) return;
    setLoading(true);
    setError(null);
    const { data, error: e } = await invokeEdgeFunction<{ success: boolean; refunded_amount: number; wallet_recredited: number }>(
      'convert-item-refund-to-card',
      { action: 'wallet_payout', profile_id: profileId, reseller_id: resellerId, amount: parsed }
    );
    setLoading(false);
    if (e || !data?.success) {
      onDone?.();
      return setError(e || 'Remboursement impossible');
    }
    setOpen(false);
    alert(
      `${eur(data.refunded_amount)} remboursés sur la carte de ${name} (sous 5 à 10 jours ouvrés).` +
        (data.wallet_recredited > 0 ? `\n${eur(data.wallet_recredited)} n'ont pas pu partir sur la carte et ont été remis sur son solde.` : '')
    );
    onDone?.();
  };

  return (
    <>
      <button
        type="button"
        onClick={start}
        className="flex items-center gap-2 rounded-lg border border-gray-200 px-4 py-2 text-sm text-gray-700 transition-colors hover:bg-gray-50"
      >
        <Landmark className="h-4 w-4" />
        <span>Rembourser sur sa carte</span>
      </button>

      <Modal isOpen={open} onClose={() => !loading && setOpen(false)} title={`Rembourser le solde de ${name}`}>
        <div className="space-y-4 text-sm">
          {loading && !preview && <p className="text-gray-500">Lecture des paiements chez Stripe…</p>}
          {preview && (
            <>
              <div className="space-y-1 rounded-lg bg-gray-50 p-3">
                <p>Solde actuel : <strong>{eur(preview.wallet_balance)}</strong></p>
                <p>Encore remboursable sur ses recharges par carte : <strong>{eur(preview.card_refundable)}</strong></p>
                <p>Maximum remboursable : <strong>{eur(preview.max_amount)}</strong></p>
              </div>
              {preview.max_amount <= 0 ? (
                <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-800">
                  Rien à rembourser : solde vide, ou aucune recharge par carte encore remboursable.
                </p>
              ) : (
                <div>
                  <div className="mb-1 flex items-center justify-between">
                    <label className="font-medium text-gray-900">Montant à rembourser (€)</label>
                    <button
                      type="button"
                      onClick={() => setAmount(preview.max_amount.toFixed(2).replace('.', ','))}
                      className="text-xs font-medium text-gray-700 underline hover:text-gray-900"
                    >
                      Tout ({eur(preview.max_amount)})
                    </button>
                  </div>
                  <input
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    inputMode="decimal"
                    autoFocus
                    className="w-40 rounded-lg border border-gray-300 px-3 py-2 focus:border-gray-500 focus:outline-none"
                  />
                  <p className="mt-1.5 text-xs text-gray-500">
                    Le montant est retiré du solde puis remboursé par Stripe sur la carte utilisée pour ses recharges (les plus
                    récentes d'abord). Arrivée sur son compte sous 5 à 10 jours ouvrés.
                  </p>
                </div>
              )}
            </>
          )}
          {error && <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-red-700">{error}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setOpen(false)} disabled={loading} className="rounded-lg px-3 py-2 text-gray-600 hover:bg-gray-100">
              Annuler
            </button>
            <button
              type="button"
              onClick={submit}
              disabled={loading || !valid}
              className="rounded-lg bg-gray-900 px-4 py-2 font-medium text-white hover:bg-gray-800 disabled:opacity-50"
            >
              {loading && preview ? 'Remboursement…' : valid ? `Rembourser ${eur(parsed)}` : 'Rembourser'}
            </button>
          </div>
        </div>
      </Modal>
    </>
  );
};
