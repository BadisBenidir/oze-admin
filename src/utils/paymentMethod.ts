/** Moyen de paiement réel d'une commande (orders.payment_method_effective,
 * 0287) → libellé de la mention « Facture acquittée — paiement par … ».
 * Inconnu → chaîne vide : la facture dit « Facture acquittée » sans préciser
 * (jamais de moyen deviné). */
export type OrderPaymentMethod = 'card' | 'paypal' | 'transfer' | 'wallet' | 'mixed' | 'cash';

const LABELS: Record<OrderPaymentMethod, string> = {
  card: 'carte bancaire (Stripe)',
  paypal: 'PayPal',
  transfer: 'virement bancaire',
  wallet: 'solde du portefeuille revendeur',
  mixed: 'solde du portefeuille revendeur et carte bancaire (Stripe)',
  cash: 'espèces',
};

export const paymentMethodLabel = (method: string | null | undefined): string =>
  (method && LABELS[method as OrderPaymentMethod]) || '';
