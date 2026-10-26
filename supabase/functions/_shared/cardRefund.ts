// Remboursement « carte » d'une commande B2B payée en partie avec le
// portefeuille : Stripe ne rembourse au plus que ce qui reste remboursable
// sur le paiement carte de la commande ; le reste est recrédité sur le
// portefeuille du membre (credit_order_item_refund_to_wallet).

import Stripe from 'https://esm.sh/stripe@17.7.0?target=deno';
// deno-lint-ignore no-explicit-any
type AdminClient = any;

export interface CardRefundResult {
  status: 'succeeded' | 'failed';
  method: 'stripe' | 'wallet';
  cardAmount: number;
  walletAmount: number;
  refundId?: string;
  /** Erreur, ou détail du partage carte / portefeuille. */
  message?: string;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export async function refundCardThenWallet(
  admin: AdminClient,
  params: {
    paymentIntentId: string;
    amount: number;
    profileId: string;
    resellerId: string | null;
    orderId: string;
    orderLabel: string;
    metadata?: Record<string, string>;
  },
): Promise<CardRefundResult> {
  const stripeSecretKey = Deno.env.get('STRIPE_SECRET_KEY');
  if (!stripeSecretKey) return { status: 'failed', method: 'stripe', cardAmount: 0, walletAmount: 0, message: 'STRIPE_SECRET_KEY manquant côté serveur' };

  const targetCents = Math.round(params.amount * 100);
  let cardCents = 0;
  let refundId: string | undefined;
  try {
    const stripe = new Stripe(stripeSecretKey, { apiVersion: '2024-06-20' });
    const intent = await stripe.paymentIntents.retrieve(params.paymentIntentId, { expand: ['latest_charge'] });
    const charge = intent.latest_charge && typeof intent.latest_charge === 'object' ? intent.latest_charge : null;
    const refundable = charge && intent.status === 'succeeded' ? (charge.amount_captured ?? charge.amount) - (charge.amount_refunded ?? 0) : 0;
    cardCents = Math.max(0, Math.min(refundable, targetCents));
    if (cardCents > 0) {
      const refund = await stripe.refunds.create({ payment_intent: params.paymentIntentId, amount: cardCents, metadata: params.metadata });
      refundId = refund.id;
    }
  } catch (err) {
    return { status: 'failed', method: 'stripe', cardAmount: 0, walletAmount: 0, message: err instanceof Error ? err.message : 'Erreur Stripe inconnue' };
  }

  const walletCents = targetCents - cardCents;
  if (walletCents > 0) {
    const { error } = await admin.rpc('credit_order_item_refund_to_wallet', {
      p_profile_id: params.profileId,
      p_reseller_id: params.resellerId,
      p_amount: walletCents / 100,
      p_order_id: params.orderId,
      p_note: `Remboursement — part payée avec le portefeuille, ${params.orderLabel}`,
    });
    if (error) {
      return {
        status: 'failed', method: 'stripe', cardAmount: cardCents / 100, walletAmount: 0, refundId,
        message: `${(cardCents / 100).toFixed(2)} € remboursés par carte, mais le crédit portefeuille de ${(walletCents / 100).toFixed(2)} € a échoué : ${error.message}`,
      };
    }
  }

  const cardAmount = round2(cardCents / 100);
  const walletAmount = round2(walletCents / 100);
  return {
    status: 'succeeded',
    method: cardCents > 0 ? 'stripe' : 'wallet',
    cardAmount,
    walletAmount,
    refundId,
    message: walletCents > 0 ? `${cardAmount.toFixed(2)} € remboursés par carte, ${walletAmount.toFixed(2)} € (part payée avec le portefeuille) recrédités sur le portefeuille` : undefined,
  };
}
