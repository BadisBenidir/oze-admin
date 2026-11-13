/** Compte courant d'associé (0279) : dette de la SAS envers son président. */
export type AssociateEntryType = 'apport' | 'depense_payee_perso' | 'retrait' | 'remboursement_associe';

export const ASSOCIATE_TYPES: Record<AssociateEntryType, { label: string; increases: boolean }> = {
  apport: { label: 'Apport', increases: true },
  depense_payee_perso: { label: 'Dépense payée en perso', increases: true },
  retrait: { label: 'Retrait', increases: false },
  remboursement_associe: { label: "Remboursement à l'associé", increases: false },
};

/** Montant signé : positif = la société doit davantage à l'associé. */
export const associateSigned = (e: { type: AssociateEntryType; amount: number }) => (ASSOCIATE_TYPES[e.type].increases ? 1 : -1) * Number(e.amount || 0);
