import React, { useState } from 'react';
import { useResellerAuth } from '../../../hooks/useResellerAuth';
import { useWallet, WalletTransaction } from '../../../hooks/useWallet';
import { Wallet, PlusCircle, ArrowUpCircle, ArrowDownCircle, RotateCcw, Settings2, AlertCircle, Loader2, Gift } from 'lucide-react';

const PRESET_AMOUNTS = [100, 500];

// +10€ offerts par tranche COMPLÈTE de 100€ rechargés — aperçu client
// uniquement (le montant réellement crédité est recalculé côté serveur dans
// credit_wallet_topup, jamais accepté tel quel d'ici).
const computeBonus = (amount: number): number => Math.floor(amount / 100) * 10;

const TYPE_LABEL: Record<string, string> = {
  rechargement: 'Recharge',
  achat: 'Achat',
  remboursement: 'Remboursement',
  ajustement_admin: 'Ajustement OZË Paris',
};

// Seul 'ajustement_admin' peut être négatif (retrait manuel) : les autres
// types sont toujours stockés positifs, le sens vient de `type` lui-même.
const isDebit = (tx: WalletTransaction) => tx.type === 'achat' || (tx.type === 'ajustement_admin' && tx.amount < 0);

export const WalletPage: React.FC = () => {
  const { profile } = useResellerAuth();
  const { balance, transactions, loading, topUp } = useWallet(profile?.id);
  const [customAmount, setCustomAmount] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleTopUp = async (amount: number) => {
    setError(null);
    setSubmitting(true);
    const result = await topUp(amount);
    if (!result.success) {
      setSubmitting(false);
      setError(result.error || 'Une erreur est survenue');
    }
    // En cas de succès, topUp redirige immédiatement vers Stripe.
  };

  const customValue = Number(customAmount);
  const customValid = customAmount.trim() !== '' && Number.isFinite(customValue) && customValue >= 1 && customValue <= 5000;
  const previewBonus = customValid ? computeBonus(customValue) : 0;
  const previewTotal = customValid ? customValue + previewBonus : 0;

  return (
    <div className="p-4 md:p-6 max-w-3xl mx-auto space-y-6">
      <div>
        <h3 className="text-lg font-semibold text-gray-900">Mon Portefeuille</h3>
        <p className="text-sm text-gray-500">Rechargez votre solde pour payer vos commandes instantanément, sans Stripe.</p>
      </div>

      <div className="rounded-xl border-2 border-amber-300 bg-gradient-to-r from-amber-50 to-yellow-50 px-4 py-3 flex items-center gap-3">
        <span className="text-2xl flex-shrink-0">🎁</span>
        <p className="text-sm text-amber-900 font-medium">
          Offre Bonus B2B : recevez <span className="font-semibold">10 € offerts</span> pour chaque tranche de 100 € rechargés !
        </p>
      </div>

      <div className="bg-gradient-to-br from-gray-900 to-gray-700 rounded-xl p-6 text-white shadow-sm">
        <div className="flex items-center gap-2 text-gray-300 text-sm mb-2">
          <Wallet className="h-4 w-4" />
          <span>Solde disponible</span>
        </div>
        <p className="text-3xl font-semibold tabular-nums">
          {loading ? '—' : balance.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €
        </p>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 flex items-start space-x-2">
          <AlertCircle className="h-4 w-4 text-red-600 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
        <h4 className="text-sm font-medium text-gray-900 mb-3">Recharger mon compte</h4>
        <div className="flex flex-wrap gap-2 mb-3">
          {PRESET_AMOUNTS.map((amount) => (
            <button
              key={amount}
              onClick={() => setCustomAmount(String(amount))}
              disabled={submitting}
              className={`px-4 py-2 rounded-lg border text-sm font-medium transition-colors disabled:opacity-50 ${
                customValue === amount ? 'border-gray-900 text-gray-900 bg-gray-50' : 'border-gray-200 text-gray-700 hover:border-gray-900 hover:text-gray-900'
              }`}
            >
              {amount} €
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <input
            type="number"
            min={1}
            max={5000}
            step={1}
            value={customAmount}
            onChange={(e) => setCustomAmount(e.target.value)}
            placeholder="Montant personnalisé (1 - 5000 €)"
            className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-400"
          />
          <button
            onClick={() => handleTopUp(customValue)}
            disabled={submitting || !customValid}
            className="flex items-center gap-1.5 px-4 py-2 bg-gray-900 text-white rounded-lg hover:bg-gray-800 transition-colors disabled:opacity-40 disabled:cursor-not-allowed text-sm whitespace-nowrap"
          >
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlusCircle className="h-4 w-4" />}
            <span>Recharger</span>
          </button>
        </div>

        {customValid && (
          <div className="mt-3 bg-amber-50 border border-amber-200 rounded-lg p-3 space-y-1">
            <div className="flex items-center justify-between text-sm">
              <span className="text-gray-600">Montant payé</span>
              <span className="font-medium text-gray-900">{customValue.toFixed(2)} €</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-gray-600 flex items-center gap-1">
                <Gift className="h-3.5 w-3.5 text-amber-600" />
                Bonus offert
              </span>
              <span className={`font-medium ${previewBonus > 0 ? 'text-amber-700' : 'text-gray-400'}`}>
                +{previewBonus.toFixed(2)} €
              </span>
            </div>
            <div className="flex items-center justify-between text-sm font-semibold border-t border-amber-200 pt-1.5">
              <span className="text-gray-900">Total crédité sur votre solde</span>
              <span className="text-gray-900">{previewTotal.toFixed(2)} €</span>
            </div>
          </div>
        )}

        <p className="text-xs text-gray-400 mt-2">Paiement sécurisé par Stripe. Le solde est crédité dès confirmation du paiement.</p>
      </div>

      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
        <h4 className="text-sm font-medium text-gray-900 mb-3">Historique</h4>
        {loading ? (
          <div className="h-24 bg-gray-50 rounded-lg animate-pulse" />
        ) : transactions.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-6">Aucune transaction pour le moment.</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {transactions.map((tx) => {
              const debit = isDebit(tx);
              return (
              <li key={tx.id} className="py-3 flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  {tx.type === 'rechargement' ? (
                    <ArrowUpCircle className="h-5 w-5 text-green-600 flex-shrink-0" />
                  ) : tx.type === 'remboursement' ? (
                    <RotateCcw className="h-5 w-5 text-blue-600 flex-shrink-0" />
                  ) : tx.type === 'ajustement_admin' ? (
                    <Settings2 className="h-5 w-5 text-purple-600 flex-shrink-0" />
                  ) : (
                    <ArrowDownCircle className="h-5 w-5 text-gray-500 flex-shrink-0" />
                  )}
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-900">{TYPE_LABEL[tx.type] || tx.type}</p>
                    <p className="text-xs text-gray-400">{new Date(tx.created_at).toLocaleString('fr-FR')}</p>
                    {tx.note && <p className="text-xs text-gray-400 italic">{tx.note}</p>}
                  </div>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className={`text-sm font-semibold tabular-nums ${debit ? 'text-gray-900' : 'text-green-600'}`}>
                    {debit ? '-' : '+'}{Math.abs(tx.amount).toFixed(2)} €
                  </p>
                  {tx.status === 'pending' && <p className="text-xs text-amber-600">En attente</p>}
                  {tx.status === 'failed' && <p className="text-xs text-red-600">Échec</p>}
                </div>
              </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
};
