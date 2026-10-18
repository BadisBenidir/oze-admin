/**
 * Groupes d'accès des membres d'une communauté partenaire (0211) : ce que
 * chacun a payé pour entrer dans l'écosystème luxe. Fixera le prix de son
 * abonnement quand les abonnements seront mis en place pour les communautés.
 */
export type MemberGroup = 1 | 2 | 3 | 4;

export const MEMBER_GROUPS: { id: MemberGroup; label: string; short: string; hint: string; className: string }[] = [
  { id: 1, label: 'Groupe 1 — 0 €', short: 'Groupe 1', hint: "N'a rien payé pour accéder", className: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  { id: 2, label: 'Groupe 2 — 300 €', short: 'Groupe 2', hint: 'A payé 300 € pour accéder', className: 'bg-blue-50 text-blue-700 border-blue-200' },
  { id: 3, label: 'Groupe 3 — 700 €', short: 'Groupe 3', hint: 'A payé 700 € pour accéder', className: 'bg-purple-50 text-purple-700 border-purple-200' },
  { id: 4, label: 'Groupe 4 — Nouveau', short: 'Groupe 4', hint: 'Nouveau membre', className: 'bg-amber-50 text-amber-800 border-amber-200' },
];

export const memberGroupOf = (id: number | null | undefined) => MEMBER_GROUPS.find((g) => g.id === id) || null;
