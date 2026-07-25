import React, { useState } from 'react';
import { useResellerAuth } from '../../../hooks/useResellerAuth';
import { useWallet, WalletTransaction, LoyaltyGift } from '../../../hooks/useWallet';
import { Wallet, PlusCircle, ArrowUpCircle, ArrowDownCircle, RotateCcw, Settings2, AlertCircle, Loader2, Gift, X, Package, Sparkles } from 'lucide-react';

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

const GiftDiscoveryModal: React.FC<{ gift: LoyaltyGift; onClose: () => void }> = ({ gift, onClose }) => {
  const image = gift.product_images?.[gift.product_main_image_index] || gift.product_images?.[0];
  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="flex min-h-full items-center justify-center p-4">
        <div className="fixed inset-0 bg-black bg-opacity-40" onClick={onClose}></div>
        <div className="relative bg-white rounded-xl shadow-xl w-full max-w-md overflow-hidden">
          <button
            onClick={onClose}
            className="absolute top-3 right-3 z-10 p-2 bg-white/90 text-gray-500 hover:text-gray-700 rounded-full transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
          <div className="h-64 bg-gray-100 flex items-center justify-center overflow-hidden">
            {image ? (
              <img src={image} alt={gift.product_name} className="h-full w-full object-cover" />
            ) : (
              <Package className="h-12 w-12 text-gray-300" />
            )}
          </div>
          <div className="p-6 space-y-3">
            <div className="flex items-center gap-2 text-amber-600">
              <Sparkles className="h-5 w-5" />
              <span className="text-xs font-semibold uppercase tracking-wide">Cadeau fidélité débloqué</span>
            </div>
            <h3 className="text-lg font-semibold text-gray-900">{gift.product_name}</h3>
            <p className="text-sm text-gray-500">Grade {gift.product_condition}</p>
            {gift.product_description && (
              <p className="text-sm text-gray-600">{gift.product_description}</p>
            )}
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 mt-2">
              <p className="text-sm text-amber-900">
                Félicitations ! Ce cadeau sera automatiquement ajouté dans le colis de votre prochaine commande B2B.
              </p>
            </div>
            <button
              onClick={onClose}
              className="w-full mt-2 px-4 py-2 bg-gray-900 text-white rounded-lg hover:bg-gray-800 transition-colors text-sm font-medium"
            >
              Fermer
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export const WalletPage: React.FC = () => {
  const { profile } = useResellerAuth();
  const { balance, transactions, loading, topUp, pendingGifts, markGiftDiscovered, loyaltyProgress } = useWallet(profile?.id);
  const [customAmount, setCustomAmount] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [viewingGift, setViewingGift] = useState<LoyaltyGift | null>(null);

  const undiscoveredGift = pendingGifts.find((g) => g.status === 'pending_discovery');
  const awaitingShipmentGifts = pendingGifts.filter((g) => g.status === 'discovered');

  const handleOpenGift = (gift: LoyaltyGift) => {
    setViewingGift(gift);
    if (gift.status === 'pending_discovery') {
      markGiftDiscovered(gift.id);
    }
  };

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
  const customValid = customAmount.trim() !== '' && Number.isFinite(customValue) && customValue >= 10 && customValue <= 5000;
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

      {undiscoveredGift && (
        <button
          onClick={() => handleOpenGift(undiscoveredGift)}
          className="w-full rounded-xl border-2 border-amber-400 bg-gradient-to-r from-amber-50 to-yellow-50 px-4 py-4 flex items-center gap-3 hover:from-amber-100 hover:to-yellow-100 transition-colors text-left"
        >
          <span className="text-3xl flex-shrink-0">🎉</span>
          <div>
            <p className="text-sm font-semibold text-amber-900">Découvrir mon cadeau !</p>
            <p className="text-xs text-amber-700">Vous avez débloqué un portefeuille de luxe offert.</p>
          </div>
        </button>
      )}

      {!loading && (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
          <div className="flex items-center gap-2 mb-3">
            <Sparkles className="h-4 w-4 text-amber-600" />
            <h4 className="text-sm font-medium text-gray-900">Programme fidélité</h4>
          </div>
          <p className="text-xs text-gray-500 mb-2">
            Débloquez 1 portefeuille de luxe offert (Louis Vuitton, Gucci, Céline...) tous les 500 € rechargés.
          </p>
          <div className="w-full h-3 bg-gray-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-amber-400 to-yellow-500 rounded-full transition-all"
              style={{ width: `${(loyaltyProgress.progressInTier / loyaltyProgress.tierAmount) * 100}%` }}
            />
          </div>
          <p className="text-xs text-gray-600 mt-2">
            {loyaltyProgress.progressInTier.toFixed(0)} € / {loyaltyProgress.tierAmount} € rechargés
            {loyaltyProgress.remainingToNextTier > 0
              ? ` — plus que ${loyaltyProgress.remainingToNextTier.toFixed(0)} € pour débloquer votre prochain cadeau !`
              : ' — cadeau en cours d\'attribution !'}
          </p>
          {awaitingShipmentGifts.length > 0 && (
            <div className="mt-3 pt-3 border-t border-gray-100 space-y-2">
              <p className="text-xs text-gray-500">Cadeaux en attente d'envoi (inclus dans votre prochaine commande) :</p>
              {awaitingShipmentGifts.map((gift) => (
                <button
                  key={gift.id}
                  onClick={() => handleOpenGift(gift)}
                  className="w-full flex items-center gap-2 px-3 py-2 bg-amber-50 hover:bg-amber-100 rounded-lg transition-colors text-left"
                >
                  <Gift className="h-3.5 w-3.5 text-amber-600 flex-shrink-0" />
                  <span className="text-xs text-amber-900 truncate">{gift.product_name}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {viewingGift && <GiftDiscoveryModal gift={viewingGift} onClose={() => setViewingGift(null)} />}

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
            min={10}
            max={5000}
            step={1}
            value={customAmount}
            onChange={(e) => setCustomAmount(e.target.value)}
            placeholder="Montant personnalisé (10 - 5000 €)"
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
