// Barème de frais de port B2B par points (1 pt = petit accessoire/
// portefeuille, 3 pts = sac), max 6 pts par colis. Recalculé côté serveur
// (edge function b2b-request-delivery-checkout, copie identique de cette
// logique) — jamais accepté tel quel du client, cette version ne sert qu'à
// l'aperçu affiché au revendeur avant paiement.

export type DeliveryType = 'domicile' | 'point_relais';

export interface ShippableItem {
  points: number;
}

interface ParcelBin {
  points: number;
  hasBag: boolean;
}

const MAX_POINTS_PER_PARCEL = 6;

/** Répartition premier-ajustement-décroissant : trie par points desc, place chaque article dans le premier colis avec de la place, sinon en ouvre un nouveau. */
export const packIntoParcels = (items: ShippableItem[]): ParcelBin[] => {
  const sorted = [...items].sort((a, b) => b.points - a.points);
  const parcels: ParcelBin[] = [];

  for (const item of sorted) {
    const target = parcels.find((p) => p.points + item.points <= MAX_POINTS_PER_PARCEL);
    if (target) {
      target.points += item.points;
      if (item.points >= 3) target.hasBag = true;
    } else {
      parcels.push({ points: item.points, hasBag: item.points >= 3 });
    }
  }

  return parcels;
};

export interface ShippingPriceResult {
  parcelCount: number;
  cost: number;
  hasBag: boolean;
}

export const computeShippingCost = (items: ShippableItem[], deliveryType: DeliveryType): ShippingPriceResult => {
  if (items.length === 0) {
    return { parcelCount: 0, cost: 0, hasBag: false };
  }

  const parcels = packIntoParcels(items);
  const parcelCount = parcels.length;
  const hasBag = parcels.some((p) => p.hasBag);

  if (deliveryType === 'domicile') {
    return { parcelCount, cost: parcelCount * 14.9, hasBag };
  }

  let cost: number;
  if (parcelCount === 1) {
    cost = hasBag ? 9.9 : 5.9;
  } else if (parcelCount === 2) {
    cost = 14.99;
  } else if (parcelCount === 3) {
    cost = 19.99;
  } else {
    cost = 19.99 + (parcelCount - 3) * 5;
  }
  return { parcelCount, cost, hasBag };
};
