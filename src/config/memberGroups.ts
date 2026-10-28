/**
 * Groupes d'accès des membres d'une communauté partenaire (0211) : ce que
 * chacun a payé pour entrer dans l'écosystème luxe. Fixera le prix de son
 * abonnement quand les abonnements seront mis en place pour les communautés.
 */
export type MemberGroup = 1 | 2 | 3 | 4 | 5;

export const MEMBER_GROUPS: { id: MemberGroup; label: string; short: string; hint: string; className: string }[] = [
  { id: 1, label: 'Groupe 1 — 0 €', short: 'Groupe 1', hint: "N'a rien payé pour accéder", className: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  { id: 2, label: 'Groupe 2 — 300 €', short: 'Groupe 2', hint: 'A payé 300 € pour accéder', className: 'bg-blue-50 text-blue-700 border-blue-200' },
  { id: 3, label: 'Groupe 3 — 700 €', short: 'Groupe 3', hint: 'A payé 700 € pour accéder', className: 'bg-purple-50 text-purple-700 border-purple-200' },
  { id: 4, label: 'Groupe 4 — Nouveau', short: 'Groupe 4', hint: 'Nouveau membre', className: 'bg-amber-50 text-amber-800 border-amber-200' },
  // Offre à 2 000 € du partenaire (0222) : 300 € versés à OZË par membre, accès offert 6 mois.
  { id: 5, label: 'Groupe 5 — Offre 2 000 €', short: 'Groupe 5', hint: "A pris l'offre à 2 000 € : accès offert 6 mois à partir de son inscription", className: 'bg-teal-50 text-teal-700 border-teal-200' },
];

/** Groupe de l'offre à 2 000 € (lien d'invitation dédié, accès offert 6 mois). */
export const OFFER_GROUP = 5;

/** Groupe des nouveaux membres : abonnement à payer dès l'inscription (lien dédié). */
export const NEW_MEMBER_GROUP = 4;

export const memberGroupOf = (id: number | null | undefined) => MEMBER_GROUPS.find((g) => g.id === id) || null;

export interface MemberGroupDef {
  id: number;
  label: string;
  short: string;
  hint: string;
  className: string;
  /** Groupe personnalisé d'une communauté (0236) : id de sa définition. */
  customId?: string;
  color?: string;
}

/** Couleurs proposées pour un groupe personnalisé (0236). */
export const GROUP_COLORS: { id: string; label: string; className: string }[] = [
  { id: 'slate', label: 'Gris', className: 'bg-slate-50 text-slate-700 border-slate-200' },
  { id: 'rose', label: 'Rose', className: 'bg-rose-50 text-rose-700 border-rose-200' },
  { id: 'orange', label: 'Orange', className: 'bg-orange-50 text-orange-700 border-orange-200' },
  { id: 'lime', label: 'Vert clair', className: 'bg-lime-50 text-lime-800 border-lime-200' },
  { id: 'cyan', label: 'Cyan', className: 'bg-cyan-50 text-cyan-700 border-cyan-200' },
  { id: 'indigo', label: 'Indigo', className: 'bg-indigo-50 text-indigo-700 border-indigo-200' },
  { id: 'fuchsia', label: 'Fuchsia', className: 'bg-fuchsia-50 text-fuchsia-700 border-fuchsia-200' },
  { id: 'yellow', label: 'Jaune', className: 'bg-yellow-50 text-yellow-800 border-yellow-200' },
];

export interface CustomGroupRow {
  id: string;
  member_group: number;
  label: string;
  hint: string | null;
  color: string;
}

/** Groupes 1 à 5 suivis des groupes personnalisés de la communauté. */
export const buildMemberGroups = (custom: CustomGroupRow[]): MemberGroupDef[] => [
  ...MEMBER_GROUPS,
  ...[...custom]
    .sort((a, b) => a.member_group - b.member_group)
    .map((c) => ({
      id: c.member_group,
      label: `Groupe ${c.member_group} — ${c.label}`,
      short: `Groupe ${c.member_group}`,
      hint: c.hint || c.label,
      className: (GROUP_COLORS.find((k) => k.id === c.color) || GROUP_COLORS[0]).className,
      customId: c.id,
      color: c.color,
    })),
];
