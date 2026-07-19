// Remise dégressive B2B sur le nombre d'articles du panier, appliquée
// uniquement sur la valeur brute des articles (jamais sur les frais de
// port ni l'assurance colis) — paliers stricts pour préserver les marges.
// Recalculée côté serveur dans b2b-checkout, jamais acceptée du client.

export interface VolumeDiscountTier {
  /** Nombre d'articles à partir duquel ce palier s'applique. */
  minItems: number;
  rate: number;
}

// Paliers stricts, plafond absolu à 10%.
export const VOLUME_DISCOUNT_TIERS: VolumeDiscountTier[] = [
  { minItems: 10, rate: 0.1 },
  { minItems: 5, rate: 0.05 },
  { minItems: 0, rate: 0 },
];

export const getVolumeDiscountRate = (itemCount: number): number => {
  const tier = VOLUME_DISCOUNT_TIERS.find((t) => itemCount >= t.minItems);
  return tier?.rate ?? 0;
};

export interface VolumeDiscountInfo {
  rate: number;
  /** Nombre d'articles requis pour le prochain palier, ou null si le plafond est déjà atteint. */
  nextTierAt: number | null;
  nextTierRate: number | null;
}

export const getVolumeDiscountInfo = (itemCount: number): VolumeDiscountInfo => {
  if (itemCount >= 10) return { rate: 0.1, nextTierAt: null, nextTierRate: null };
  if (itemCount >= 5) return { rate: 0.05, nextTierAt: 10, nextTierRate: 0.1 };
  return { rate: 0, nextTierAt: 5, nextTierRate: 0.05 };
};
