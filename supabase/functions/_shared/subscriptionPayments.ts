// Enregistre une facture d'abonnement Club B2B payée dans
// b2b_subscription_payments (0185) — CA des abonnements en Comptabilité et au
// Dashboard. Idempotent (clé : stripe_invoice_id). Utilisé par le webhook
// (invoice.paid) et par le rattrapage sync-subscription-payments.

import Stripe from 'https://esm.sh/stripe@17.7.0?target=deno';
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

const planFromPrice = (priceId: string | undefined): string | null => {
  if (!priceId) return null;
  if (priceId === Deno.env.get('STRIPE_PRICE_REVENDEUR')) return 'revendeur';
  if (priceId === Deno.env.get('STRIPE_PRICE_DROPS')) return 'drops';
  return null;
};

/** Code promo (et remise) d'une facture (0191). La facture est relue avec ses
 * remises développées : la forme du payload webhook dépend de la version d'API
 * du endpoint, celle de cette relecture est fixée par le client Stripe. */
async function invoicePromo(stripe: Stripe | undefined, invoice: Stripe.Invoice): Promise<{ promoCode: string | null; promotionCodeId: string | null; discountAmount: number }> {
  const discountAmount = (invoice.total_discount_amounts || []).reduce((sum, d) => sum + (d.amount || 0), 0) / 100;
  const hasDiscount = discountAmount > 0 || Boolean(invoice.discount) || (invoice.discounts?.length ?? 0) > 0;
  if (!stripe || !hasDiscount) return { promoCode: null, promotionCodeId: null, discountAmount };
  try {
    const full = await stripe.invoices.retrieve(invoice.id, { expand: ['discounts.promotion_code', 'discounts.coupon'] });
    for (const d of full.discounts || []) {
      if (typeof d === 'string') continue;
      const pc = d.promotion_code;
      if (pc && typeof pc === 'object') return { promoCode: pc.code, promotionCodeId: pc.id, discountAmount };
      if (typeof pc === 'string') {
        const promo = await stripe.promotionCodes.retrieve(pc);
        return { promoCode: promo.code, promotionCodeId: promo.id, discountAmount };
      }
      // Coupon appliqué sans code promo (ex. depuis le Dashboard Stripe).
      return { promoCode: `coupon:${d.coupon?.name || d.coupon?.id || 'sans nom'}`, promotionCodeId: null, discountAmount };
    }
  } catch (err) {
    console.error('[subscriptionPayments] lecture de la remise', invoice.id, err instanceof Error ? err.message : err);
  }
  return { promoCode: null, promotionCodeId: null, discountAmount };
}

/** Renvoie true si la facture a été enregistrée (ou l'était déjà), false si ignorée. */
export async function recordSubscriptionInvoice(admin: SupabaseClient, invoice: Stripe.Invoice, stripe?: Stripe): Promise<boolean> {
  const subscriptionId = typeof invoice.subscription === 'string' ? invoice.subscription : invoice.subscription?.id;
  if (!subscriptionId || invoice.status !== 'paid') return false;
  const discounted = (invoice.total_discount_amounts || []).some((d) => d.amount > 0);
  // Facture à 0 € : ignorée, sauf si c'est un code promo à 100 % (le membre doit
  // compter dans le suivi du code).
  if (!invoice.amount_paid && !discounted) return false;

  const customerId = typeof invoice.customer === 'string' ? invoice.customer : invoice.customer?.id ?? null;
  const line = invoice.lines?.data?.find((l) => l.price?.id) || invoice.lines?.data?.[0];
  const plan = planFromPrice(line?.price?.id);
  // Uniquement les pass du Club B2B (pas un autre abonnement Stripe du compte).
  if (!plan) return false;

  // Revendeur : par l'abonnement, sinon par le client Stripe (une première
  // facture peut arriver avant que l'abonnement soit rattaché au compte).
  let resellerId: string | null = null;
  const { data: bySub } = await admin.from('resellers').select('id').eq('stripe_subscription_id', subscriptionId).maybeSingle();
  resellerId = bySub?.id ?? null;
  if (!resellerId && customerId) {
    const { data: byCustomer } = await admin.from('resellers').select('id').eq('stripe_customer_id', customerId).maybeSingle();
    resellerId = byCustomer?.id ?? null;
  }

  const promo = await invoicePromo(stripe, invoice);
  const paidAt = invoice.status_transitions?.paid_at ?? invoice.created;
  const { error } = await admin.from('b2b_subscription_payments').upsert(
    {
      stripe_invoice_id: invoice.id,
      stripe_customer_id: customerId,
      stripe_subscription_id: subscriptionId,
      reseller_id: resellerId,
      amount: invoice.amount_paid / 100,
      currency: invoice.currency || 'eur',
      plan,
      billing_reason: invoice.billing_reason ?? null,
      invoice_number: invoice.number ?? null,
      paid_at: new Date(paidAt * 1000).toISOString(),
      promo_code: promo.promoCode,
      promotion_code_id: promo.promotionCodeId,
      discount_amount: promo.discountAmount,
    },
    { onConflict: 'stripe_invoice_id' },
  );
  if (error) throw new Error(`paiement d'abonnement ${invoice.id} : ${error.message}`);
  return true;
}
