// Prix Stripe des pass du Club B2B (Pass Drops / Pass Revendeur).
//
// Prix actuel (nouveaux abonnés) : STRIPE_PRICE_DROPS, STRIPE_PRICE_REVENDEUR.
// Anciens tarifs, gardés par les abonnés déjà inscrits lors d'une hausse :
// STRIPE_PRICE_DROPS_LEGACY, STRIPE_PRICE_REVENDEUR_LEGACY (ids séparés par
// des virgules, le plus récent en premier). Un pass est aussi reconnu par la
// metadata club_plan posée sur ses prix (club-pass-prices).

export type ClubPlan = 'drops' | 'revendeur';

const ids = (key: string) =>
  (Deno.env.get(key) || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

export const currentPriceId = (plan: ClubPlan): string | undefined =>
  Deno.env.get(plan === 'revendeur' ? 'STRIPE_PRICE_REVENDEUR' : 'STRIPE_PRICE_DROPS') || undefined;

export const legacyPriceIds = (plan: ClubPlan): string[] =>
  ids(plan === 'revendeur' ? 'STRIPE_PRICE_REVENDEUR_LEGACY' : 'STRIPE_PRICE_DROPS_LEGACY');

/** Pass d'un prix Stripe (actuel ou ancien tarif), ou null si ce n'est pas un pass du Club. */
export const planFromPriceId = (priceId: string | undefined | null, metadata?: Record<string, string> | null): ClubPlan | null => {
  if (!priceId) return null;
  for (const plan of ['revendeur', 'drops'] as ClubPlan[]) {
    if (priceId === currentPriceId(plan) || legacyPriceIds(plan).includes(priceId)) return plan;
  }
  const tagged = metadata?.club_plan;
  return tagged === 'drops' || tagged === 'revendeur' ? tagged : null;
};

/** Le prix est-il un ancien tarif (abonné inscrit avant une hausse) ? */
export const isLegacyPriceId = (priceId: string | undefined | null): boolean =>
  Boolean(priceId) && [...legacyPriceIds('drops'), ...legacyPriceIds('revendeur')].includes(priceId!);

/**
 * Prix à appliquer lors d'un changement de pass : un abonné à l'ancien tarif
 * garde l'ancien tarif du pass visé ; sinon, prix actuel.
 */
export const targetPriceId = (plan: ClubPlan, fromPriceId: string | undefined | null): string | undefined =>
  (isLegacyPriceId(fromPriceId) && legacyPriceIds(plan)[0]) || currentPriceId(plan);
