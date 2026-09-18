import React, { useEffect, useState } from 'react';
import { AlertCircle, CreditCard, Wallet, Coins, Gavel } from 'lucide-react';
import { PendingAuctionPayment, PayAuctionResult } from '../../../hooks/useMyAuctionPayments';

const EUR = (n: number) => (Number(n) || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';

const useRemainingMs = (deadline: string | null): number => {
  const [remaining, setRemaining] = useState(() => (deadline ? new Date(deadline).getTime() - Date.now() : 0));
  useEffect(() => {
    if (!deadline) return;
    setRemaining(new Date(deadline).getTime() - Date.now());
    const id = setInterval(() => setRemaining(new Date(deadline).getTime() - Date.now()), 1000);
    return () => clearInterval(id);
  }, [deadline]);
  return deadline ? Math.max(0, remaining) : 0;
};

const formatCountdown = (ms: number): string => {
  const totalSeconds = Math.floor(ms / 1000);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
};

interface PaymentRowProps {
  payment: PendingAuctionPayment;
  walletBalance: number;
  onPay: (orderId: string, method: 'wallet' | 'card' | 'mixed') => Promise<PayAuctionResult>;
}

/** Une ligne = un lot gagné à payer. Compte à rebours vers payment_deadline
 * (posée par admin_close_auction_session, 24h après adjudication) — au-delà,
 * affiche juste un message : le dépassement n'est jamais automatisé côté
 * base (voir 0137), l'admin gère au cas par cas depuis AuctionsAdmin.tsx.
 *
 * Le solde n'est jamais un choix exclusif face à la carte : s'il couvre tout
 * le montant, "Payer (solde)" et "Payer (carte)" restent deux options
 * complètes équivalentes ; s'il ne couvre qu'une partie, "Payer (solde)"
 * est remplacé par "Solde + carte" (utilise tout le solde, complète par
 * carte, voir 0145_auction_mixed_payment.sql) tout en gardant "Payer
 * (carte)" disponible pour ignorer complètement le solde si le revendeur le
 * préfère. */
const PaymentRow: React.FC<PaymentRowProps> = ({ payment, walletBalance, onPay }) => {
  const ms = useRemainingMs(payment.payment_deadline);
  const overdue = payment.payment_deadline !== null && ms <= 0;
  const urgent = !overdue && ms < 2 * 60 * 60 * 1000;
  const [submitting, setSubmitting] = useState<'wallet' | 'card' | 'mixed' | null>(null);
  const [error, setError] = useState('');
  const image = payment.images?.[0];
  const canCoverFully = walletBalance >= payment.amount;
  const canCoverPartially = walletBalance > 0 && !canCoverFully;

  const handlePay = async (method: 'wallet' | 'card' | 'mixed') => {
    setSubmitting(method);
    setError('');
    const result = await onPay(payment.order_id, method);
    if (!result.success) {
      setError(result.error || 'Erreur lors du paiement');
      setSubmitting(null);
      return;
    }
    if (result.redirectUrl) {
      window.location.href = result.redirectUrl;
      return;
    }
    setSubmitting(null);
  };

  return (
    <div className="flex flex-col sm:flex-row sm:items-center gap-3 bg-white border border-amber-200 rounded-lg p-3">
      <div className="flex items-center gap-3 flex-1 min-w-0">
        <div className="h-14 w-14 bg-gray-100 rounded flex items-center justify-center overflow-hidden flex-shrink-0">
          {image ? (
            <img src={image} alt={payment.title} className="w-full h-full object-cover" />
          ) : (
            <Gavel className="h-5 w-5 text-gray-300" />
          )}
        </div>
        <div className="min-w-0">
          <p className="text-sm font-medium text-gray-900 truncate">{payment.title}</p>
          <p className="text-xs text-gray-500">{payment.brand} · {EUR(payment.amount)}</p>
          <p className={`text-xs mt-0.5 font-medium ${overdue || urgent ? 'text-red-600' : 'text-amber-700'}`}>
            {overdue ? 'Délai de paiement dépassé — contactez OZË Paris' : `Payer avant ${formatCountdown(ms)}`}
          </p>
          {error && <p className="text-xs text-red-600 mt-1">{error}</p>}
        </div>
      </div>
      <div className="flex gap-1.5 flex-shrink-0">
        {canCoverFully && (
          <button
            onClick={() => handlePay('wallet')}
            disabled={submitting !== null}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-900 text-white rounded-lg hover:bg-gray-800 transition-colors disabled:opacity-50 text-xs font-medium whitespace-nowrap"
          >
            <Wallet className="h-3.5 w-3.5" />
            {submitting === 'wallet' ? '...' : 'Payer (solde)'}
          </button>
        )}
        {canCoverPartially && (
          <button
            onClick={() => handlePay('mixed')}
            disabled={submitting !== null}
            title={`Utilise votre solde (${EUR(walletBalance)}) et complète par carte (${EUR(payment.amount - walletBalance)})`}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-900 text-white rounded-lg hover:bg-gray-800 transition-colors disabled:opacity-50 text-xs font-medium whitespace-nowrap"
          >
            <Coins className="h-3.5 w-3.5" />
            {submitting === 'mixed' ? '...' : `Solde + carte (reste ${EUR(payment.amount - walletBalance)})`}
          </button>
        )}
        <button
          onClick={() => handlePay('card')}
          disabled={submitting !== null}
          className="flex items-center gap-1.5 px-3 py-1.5 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50 text-xs font-medium whitespace-nowrap"
        >
          <CreditCard className="h-3.5 w-3.5" />
          {submitting === 'card' ? '...' : 'Payer (carte)'}
        </button>
      </div>
    </div>
  );
};

interface AuctionPaymentsDueProps {
  payments: PendingAuctionPayment[];
  walletBalance: number;
  onPay: (orderId: string, method: 'wallet' | 'card' | 'mixed') => Promise<PayAuctionResult>;
}

/** Espace dédié en haut de la page Enchères : les lots que ce revendeur a
 * remportés et doit encore payer, avec compte à rebours et paiement direct
 * (solde, carte, ou mixte si le solde ne couvre qu'une partie) — voir
 * 0137_auction_payment_deadline.sql et 0145_auction_mixed_payment.sql. */
export const AuctionPaymentsDue: React.FC<AuctionPaymentsDueProps> = ({ payments, walletBalance, onPay }) => {
  if (payments.length === 0) return null;

  return (
    <div className="mb-6 bg-amber-50 border-2 border-amber-300 rounded-xl p-4">
      <div className="flex items-center gap-2 mb-3">
        <AlertCircle className="h-4 w-4 text-amber-700 flex-shrink-0" />
        <h4 className="text-sm font-semibold text-amber-900">
          Lot{payments.length > 1 ? 's' : ''} remporté{payments.length > 1 ? 's' : ''} — paiement sous 24h
        </h4>
      </div>
      <div className="space-y-2">
        {payments.map((p) => (
          <PaymentRow key={p.item_id} payment={p} walletBalance={walletBalance} onPay={onPay} />
        ))}
      </div>
    </div>
  );
};

export default AuctionPaymentsDue;
