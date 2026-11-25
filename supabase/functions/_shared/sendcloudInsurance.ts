// Assurance des colis Sendcloud (API v3) : une seule règle pour toutes les
// étiquettes OZË (admin B2B, site, Stripe, PayPal).
//
// COPIE IDENTIQUE dans les deux repos — oze-admin et oze-storefront,
// supabase/functions/_shared/sendcloudInsurance.ts. Modifier les deux ensemble.
//
// - Champ v3 : parcels[].additional_insured_price { value, currency }
//   (assurance XCover de 2 € à 5000 € par envoi, doc sendcloud.dev).
//   L'ancien parcels[].insured_value n'existe pas en v3 et était ignoré.
// - Valeur assurée = valeur des articles, arrondie à l'euro, plafonnée à
//   5000 € ; sous 2 €, aucune assurance n'est demandée.
// - L'assurance ne dépend jamais d'une règle d'expédition du dashboard
//   Sendcloud : les appels se font avec apply_shipping_rules: false.

export const SENDCLOUD_MAX_INSURANCE = 5000;
export const SENDCLOUD_MIN_INSURANCE = 2;

export interface SendcloudInsurance {
  /** Valeur assurée envoyée à Sendcloud (€ entiers), 0 = pas d'assurance. */
  insuredValue: number;
  /** Avertissement à afficher dans le back-office (plafond atteint). */
  warning: string | null;
}

export function computeSendcloudInsurance(goodsValue: number): SendcloudInsurance {
  const value = Number(goodsValue) || 0;
  const rounded = Math.round(value);
  const capped = Math.min(rounded, SENDCLOUD_MAX_INSURANCE);
  return {
    insuredValue: capped >= SENDCLOUD_MIN_INSURANCE ? capped : 0,
    warning: rounded > SENDCLOUD_MAX_INSURANCE
      ? `Assurance plafonnée à 5000 € (valeur des articles : ${value.toFixed(2).replace('.', ',')} €).`
      : null,
  };
}

/** Champs à ajouter dans parcels[i] du payload Sendcloud v3. */
export function insuredParcelFields(insurance: SendcloudInsurance): Record<string, unknown> {
  return insurance.insuredValue > 0
    ? { additional_insured_price: { currency: 'EUR', value: insurance.insuredValue.toFixed(2) } }
    : {};
}

const goodsOf = (o: { subtotal?: unknown; total_amount?: unknown }) => Number(o.subtotal ?? o.total_amount ?? 0) || 0;

/** Valeur des articles d'une commande + celle des commandes groupées avec
 * elle (grouped_with_order_id) : elles partent dans le même colis. */
// deno-lint-ignore no-explicit-any
export async function orderGoodsValueWithGrouped(supabase: any, order: { id: string; subtotal?: unknown; total_amount?: unknown }): Promise<number> {
  const { data } = await supabase
    .from('orders')
    .select('subtotal, total_amount')
    .eq('grouped_with_order_id', order.id)
    .not('status', 'in', '(cancelled,refunded)');
  return goodsOf(order) + (data || []).reduce((sum: number, o: { subtotal?: unknown; total_amount?: unknown }) => sum + goodsOf(o), 0);
}
