import React, { useCallback, useEffect, useState } from 'react';
import { supabase } from '../../../lib/supabase';
import { useResellerAuth } from '../../../hooks/useResellerAuth';
import { useWallet, WalletTransaction, notifyWalletChanged } from '../../../hooks/useWallet';
import { invokeEdgeFunction } from '../../../utils/invokeEdgeFunction';
import { Wallet, PlusCircle, ArrowUpCircle, ArrowDownCircle, RotateCcw, Settings2, AlertCircle, Loader2, Gift, Sparkles, Landmark, CreditCard, Copy, Check, CheckCircle2 } from 'lucide-react';

const PRESET_AMOUNTS = [100, 500];

// Rechargement par virement (0292) : bonus = floor(montant / 100) × taux × 100
// à partir du minimum (réglages wallet_settings, modifiables dans l'admin).
// Aperçu uniquement : le bonus réellement crédité est calculé côté serveur
// (credit_wallet_transfer). La carte ne donne plus de bonus.
interface WalletSettings { transfer_bonus_rate: number; transfer_min_amount: number; beneficiary: string; iban: string | null; bic: string | null }
const transferBonus = (amount: number, s: WalletSettings | null): number =>
  s && amount >= Number(s.transfer_min_amount) ? Math.round(Math.floor(amount / 100) * Number(s.transfer_bonus_rate) * 100 * 100) / 100 : 0;
const eur = (n: number) => n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
const formatIban = (iban: string) => iban.replace(/\s+/g, '').replace(/(.{4})/g, '$1 ').trim();

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
  const { balance, error: walletError, refresh: refreshWallet, transactions, loading, topUp, pendingGiftCount, loyaltyProgress } = useWallet(profile?.id);

  // Solde réservé par un paiement mixte non terminé (débit « en attente »).
  const reservedAmount = transactions
    .filter((tx) => tx.type === 'achat' && tx.status === 'pending')
    .reduce((sum, tx) => sum + Math.abs(Number(tx.amount) || 0), 0);
  const [releasing, setReleasing] = useState(false);
  const [releaseMessage, setReleaseMessage] = useState<string | null>(null);
  const handleRelease = async () => {
    setReleasing(true);
    setReleaseMessage(null);
    const { data, error: err } = await invokeEdgeFunction<{ released: number; still_processing: number }>('release-pending-wallet-debits', {});
    setReleasing(false);
    if (err) {
      setReleaseMessage(`Impossible pour le moment : ${err}`);
      return;
    }
    if (data?.still_processing) {
      setReleaseMessage('Ce paiement vient d\'être validé : il est en cours de traitement.');
    }
    refreshWallet();
  };
  // Virement : réglages (IBAN, taux, minimum), référence du membre, bonus en cours.
  const [mode, setMode] = useState<'transfer' | 'card'>('transfer');
  const [settings, setSettings] = useState<WalletSettings | null>(null);
  const [reference, setReference] = useState<string | null>(null);
  const [bonusBalance, setBonusBalance] = useState(0);
  const [transferAmount, setTransferAmount] = useState('');
  const [copied, setCopied] = useState<string | null>(null);
  useEffect(() => {
    if (!profile?.id) return;
    supabase.from('wallet_settings').select('transfer_bonus_rate, transfer_min_amount, beneficiary, iban, bic').maybeSingle()
      .then(({ data }) => setSettings((data as WalletSettings) || null));
    supabase.rpc('ensure_wallet_transfer_reference').then(({ data }) => setReference((data as string) || null));
    supabase.from('profiles').select('wallet_bonus_balance').eq('id', profile.id).maybeSingle()
      .then(({ data }) => setBonusBalance(Number((data as { wallet_bonus_balance?: number } | null)?.wallet_bonus_balance) || 0));
  }, [profile?.id, transactions.length]);
  const copy = async (key: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(key);
      setTimeout(() => setCopied((c) => (c === key ? null : c)), 1500);
    } catch { /* presse-papiers indisponible */ }
  };
  // « J'ai fait mon virement » : vérifie tout de suite sur Qonto (sinon la
  // vérification automatique passe chaque minute).
  const [checking, setChecking] = useState(false);
  const [checkMessage, setCheckMessage] = useState<string | null>(null);
  // Virement annoncé : la page surveille le solde (toutes les 10 s, 15 min
  // max) et affiche un grand bandeau dès qu'il est crédité ; le solde de la
  // barre du haut est rafraîchi en même temps (notifyWalletChanged).
  const [waitingSince, setWaitingSince] = useState<{ at: number; balance: number; bonus: number } | null>(null);
  const [received, setReceived] = useState<{ amount: number; bonus: number } | null>(null);
  const readBalances = useCallback(async () => {
    const { data } = await supabase.from('profiles').select('wallet_balance, wallet_bonus_balance').eq('id', profile?.id || '').maybeSingle();
    const d = data as { wallet_balance?: number; wallet_bonus_balance?: number } | null;
    return { balance: Number(d?.wallet_balance) || 0, bonus: Number(d?.wallet_bonus_balance) || 0 };
  }, [profile?.id]);
  const settleIfReceived = useCallback(async (start: { balance: number; bonus: number }) => {
    const now = await readBalances();
    if (now.balance > start.balance + 0.004) {
      setReceived({ amount: Math.round((now.balance - start.balance) * 100) / 100, bonus: Math.max(0, Math.round((now.bonus - start.bonus) * 100) / 100) });
      setWaitingSince(null);
      setCheckMessage(null);
      setBonusBalance(now.bonus);
      await refreshWallet();
      notifyWalletChanged();
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return true;
    }
    return false;
  }, [readBalances, refreshWallet]);
  useEffect(() => {
    if (!waitingSince) return;
    const timer = setInterval(async () => {
      if (Date.now() - waitingSince.at > 15 * 60 * 1000) return setWaitingSince(null);
      await settleIfReceived(waitingSince);
    }, 10000);
    return () => clearInterval(timer);
  }, [waitingSince, settleIfReceived]);
  const checkTransfer = async () => {
    if (!transferValid) {
      setCheckMessage('Indiquez le montant viré ci-dessus.');
      return;
    }
    setChecking(true);
    setCheckMessage(null);
    setReceived(null);
    const start = await readBalances();
    // Annonce du virement (0295) : permet de le reconnaître au nom du payeur
    // si la banque n'a pas transmis le motif.
    await supabase.rpc('declare_wallet_transfer', { p_amount: transferValue });
    await supabase.functions.invoke('qonto-wallet-transfers', { body: {} });
    const ok = await settleIfReceived(start);
    setChecking(false);
    if (!ok) {
      setWaitingSince({ at: Date.now(), ...start });
      setCheckMessage("Virement annoncé, en attente de réception. Un virement instantané arrive en général en moins de 2 minutes : cette page se met à jour toute seule dès qu'il est crédité.");
    }
  };
  const transferValue = Number(transferAmount.replace(',', '.'));
  const transferValid = transferAmount.trim() !== '' && Number.isFinite(transferValue) && transferValue > 0;
  const transferPreviewBonus = transferValid ? transferBonus(transferValue, settings) : 0;
  const ratePct = settings ? Math.round(Number(settings.transfer_bonus_rate) * 100 * 100) / 100 : 5;
  const minAmount = settings ? Number(settings.transfer_min_amount) : 100;

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
  const customValid = customAmount.trim() !== '' && Number.isFinite(customValue) && customValue >= 10 && customValue <= 5000;

  return (
    <div className="p-4 md:p-6 max-w-3xl mx-auto space-y-6">
      <div>
        <h3 className="text-lg font-semibold text-gray-900">Mon Portefeuille</h3>
        <p className="text-sm text-gray-500">Rechargez votre solde pour payer vos commandes instantanément, sans Stripe.</p>
      </div>

      {received && (
        <div className="flex items-start gap-3 rounded-xl border-2 border-emerald-400 bg-emerald-50 p-5 shadow-sm">
          <CheckCircle2 className="h-8 w-8 flex-shrink-0 text-emerald-600" />
          <div className="flex-1">
            <p className="text-lg font-semibold text-emerald-900">Virement reçu : +{eur(received.amount)} crédités sur votre solde</p>
            {received.bonus > 0 && (
              <p className="mt-0.5 text-sm text-emerald-800">dont {eur(received.bonus)} de bonus virement offerts 🎁</p>
            )}
            <p className="mt-1 text-sm text-emerald-800">Votre solde est disponible tout de suite pour vos achats.</p>
          </div>
          <button onClick={() => setReceived(null)} className="rounded p-1 text-emerald-700 hover:bg-emerald-100" aria-label="Fermer">✕</button>
        </div>
      )}

      <div className="rounded-xl border-2 border-amber-300 bg-gradient-to-r from-amber-50 to-yellow-50 px-4 py-3 flex items-center gap-3">
        <span className="text-2xl flex-shrink-0">🎁</span>
        <p className="text-sm text-amber-900 font-medium">
          Rechargez par virement : <span className="font-semibold">{ratePct.toLocaleString('fr-FR')} € offerts</span> pour chaque tranche de 100 € reçue !
        </p>
      </div>

      <div className="bg-gradient-to-br from-gray-900 to-gray-700 rounded-xl p-6 text-white shadow-sm">
        <div className="flex items-center gap-2 text-gray-300 text-sm mb-2">
          <Wallet className="h-4 w-4" />
          <span>Solde disponible</span>
        </div>
        <p className="text-3xl font-semibold tabular-nums">
          {loading || walletError ? '—' : balance.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €
        </p>
        {!loading && !walletError && bonusBalance > 0 && (
          <p className="mt-1 text-xs text-gray-300">
            dont {eur(bonusBalance)} de bonus virement — utilisable pour vos achats, non remboursable
          </p>
        )}
        {walletError && !loading && (
          <div className="mt-3 flex flex-wrap items-center gap-3 text-sm text-gray-200">
            <span>Impossible de charger votre solde pour le moment.</span>
            <button onClick={() => refreshWallet()} className="rounded-lg bg-white/15 px-3 py-1 font-medium text-white hover:bg-white/25">
              Réessayer
            </button>
          </div>
        )}
      </div>

      {/* Paiement mixte (solde + carte) commencé mais pas terminé : la part du
          solde est réservée jusqu'à la fin du paiement carte. */}
      {reservedAmount > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
          <p className="text-sm font-semibold text-amber-900">
            {reservedAmount.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} € réservés pour un paiement non terminé
          </p>
          <p className="mt-1 text-sm text-amber-800">
            Vous avez commencé un paiement « solde + carte » sans le finaliser. Ce montant vous est rendu automatiquement
            sous 30 minutes, ou tout de suite ci-dessous (le paiement en cours sera annulé).
          </p>
          {releaseMessage && <p className="mt-2 text-sm font-medium text-amber-900">{releaseMessage}</p>}
          <button
            onClick={handleRelease}
            disabled={releasing}
            className="mt-3 rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50"
          >
            {releasing ? 'Un instant…' : 'Annuler ce paiement et récupérer mon solde'}
          </button>
        </div>
      )}

      {pendingGiftCount > 0 && (
        <div className="w-full rounded-xl border-2 border-amber-400 bg-gradient-to-r from-amber-50 to-yellow-50 px-4 py-4 flex items-center gap-3">
          <span className="text-3xl flex-shrink-0">🎉</span>
          <div>
            <p className="text-sm font-semibold text-amber-900">
              Félicitations, vous avez débloqué {pendingGiftCount} portefeuille{pendingGiftCount > 1 ? 's' : ''} de luxe offert{pendingGiftCount > 1 ? 's' : ''} !
            </p>
            <p className="text-xs text-amber-700">
              Il{pendingGiftCount > 1 ? 's' : ''} sera{pendingGiftCount > 1 ? 'nt' : ''} inclus dans votre prochaine commande B2B.
            </p>
          </div>
        </div>
      )}

      {!loading && (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
          <div className="flex items-center gap-2 mb-3">
            <Sparkles className="h-4 w-4 text-amber-600" />
            <h4 className="text-sm font-medium text-gray-900">Programme fidélité</h4>
          </div>
          <p className="text-xs text-gray-500 mb-2">
            Débloquez 1 portefeuille de luxe offert (Louis Vuitton, Gucci, Céline...) tous les 1 000 € rechargés.
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
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 flex items-start space-x-2">
          <AlertCircle className="h-4 w-4 text-red-600 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
        <h4 className="text-sm font-medium text-gray-900 mb-3">Recharger mon compte</h4>
        <div className="mb-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
          <button
            onClick={() => setMode('transfer')}
            className={`flex items-center gap-2 rounded-lg border px-3 py-2.5 text-left text-sm font-medium transition-colors ${mode === 'transfer' ? 'border-gray-900 bg-gray-50 text-gray-900' : 'border-gray-200 text-gray-600 hover:border-gray-400'}`}
          >
            <Landmark className="h-4 w-4 flex-shrink-0" />
            <span>Recharger par virement <span className="ml-1 rounded bg-amber-100 px-1.5 py-0.5 text-xs font-semibold text-amber-800">+{ratePct.toLocaleString('fr-FR')} % offerts</span></span>
          </button>
          <button
            onClick={() => setMode('card')}
            className={`flex items-center gap-2 rounded-lg border px-3 py-2.5 text-left text-sm font-medium transition-colors ${mode === 'card' ? 'border-gray-900 bg-gray-50 text-gray-900' : 'border-gray-200 text-gray-600 hover:border-gray-400'}`}
          >
            <CreditCard className="h-4 w-4 flex-shrink-0" />
            Recharger par carte
          </button>
        </div>

        {mode === 'transfer' ? (
          <div className="space-y-3">
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-sm text-emerald-900">
              <p className="font-semibold">Faites un virement instantané : votre solde est crédité en 1 à 2 minutes.</p>
              <p className="mt-0.5 text-emerald-800">
                Dans votre application bancaire, choisissez « virement instantané » (SEPA Instant). Un virement classique peut prendre jusqu'à 1 jour ouvré.
              </p>
            </div>
            <p className="text-sm text-gray-600">
              Indiquez votre référence dans le champ <strong>« Motif »</strong> du virement (parfois appelé « Libellé » ou « Message pour le bénéficiaire »),
              et non dans le champ « Référence » de votre banque, qui n'est pas toujours transmis. Vous recevez {ratePct.toLocaleString('fr-FR')} € offerts
              par tranche complète de 100 € (à partir de {eur(minAmount)}).
            </p>
            <div className="divide-y divide-gray-100 rounded-lg border border-gray-200">
              {[
                { key: 'beneficiary', label: 'Bénéficiaire', value: settings?.beneficiary || 'OZË PARIS SAS', display: settings?.beneficiary || 'OZË PARIS SAS' },
                { key: 'iban', label: 'IBAN', value: (settings?.iban || '').replace(/\s+/g, ''), display: settings?.iban ? formatIban(settings.iban) : '—' },
                { key: 'bic', label: 'BIC', value: settings?.bic || '', display: settings?.bic || '—' },
                { key: 'reference', label: 'À indiquer dans le motif du virement', value: reference || '', display: reference || '…', strong: true },
              ].map((row) => (
                <div key={row.key} className={`flex items-center justify-between gap-3 px-3 py-2 ${row.strong ? 'bg-amber-50' : ''}`}>
                  <div className="min-w-0">
                    <p className="text-xs text-gray-500">{row.label}</p>
                    <p className={`truncate font-mono text-sm ${row.strong ? 'font-semibold text-amber-900' : 'text-gray-900'}`}>{row.display}</p>
                  </div>
                  {row.value && (
                    <button onClick={() => copy(row.key, row.value)} className="flex flex-shrink-0 items-center gap-1 rounded-lg border border-gray-200 bg-white px-2 py-1 text-xs text-gray-700 hover:bg-gray-50">
                      {copied === row.key ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
                      {copied === row.key ? 'Copié' : 'Copier'}
                    </button>
                  )}
                </div>
              ))}
            </div>
            <label className="block text-sm text-gray-700">
              Montant que vous allez virer
              <input
                value={transferAmount}
                onChange={(e) => setTransferAmount(e.target.value)}
                inputMode="decimal"
                placeholder={`Ex. ${Math.max(minAmount, 500)} €`}
                className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400"
              />
            </label>
            {transferValid && (
              <div className="space-y-1 rounded-lg border border-amber-200 bg-amber-50 p-3">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-600">Montant viré</span>
                  <span className="font-medium text-gray-900">{eur(transferValue)}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="flex items-center gap-1 text-gray-600"><Gift className="h-3.5 w-3.5 text-amber-600" /> Bonus virement</span>
                  <span className={`font-medium ${transferPreviewBonus > 0 ? 'text-amber-700' : 'text-gray-400'}`}>+{eur(transferPreviewBonus)}</span>
                </div>
                <div className="flex items-center justify-between border-t border-amber-200 pt-1.5 text-sm font-semibold">
                  <span className="text-gray-900">Total crédité sur votre solde</span>
                  <span className="text-gray-900">{eur(transferValue + transferPreviewBonus)}</span>
                </div>
                {transferValue < minAmount && (
                  <p className="text-xs text-amber-800">Bonus à partir de {eur(minAmount)} : ce virement sera crédité sans bonus.</p>
                )}
              </div>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={checkTransfer}
                disabled={checking || Boolean(waitingSince)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-gray-900 px-3 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
              >
                {checking ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                {checking ? 'Vérification…' : waitingSince ? 'En attente du virement…' : "J'ai fait mon virement"}
              </button>
              {waitingSince && (
                <button
                  onClick={async () => {
                    await supabase.rpc('cancel_wallet_transfer_intents');
                    setWaitingSince(null);
                    setCheckMessage('Annonce annulée.');
                  }}
                  className="text-sm text-gray-500 underline hover:text-gray-800"
                >
                  Annuler
                </button>
              )}
              {checkMessage && <p className="text-sm text-gray-700">{checkMessage}</p>}
            </div>
            <p className="text-xs text-gray-400">
              Le bonus est utilisable uniquement pour vos achats sur la plateforme : il n'est ni remboursable ni retirable.
              Sans référence dans le libellé, le virement est attribué manuellement par notre équipe.
            </p>
          </div>
        ) : (
          <>
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
        <p className="text-xs text-gray-400 mt-2">
          Paiement sécurisé par Stripe. Le solde est crédité dès confirmation du paiement. Le bonus de {ratePct.toLocaleString('fr-FR')} % est réservé aux rechargements par virement.
        </p>
          </>
        )}
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
