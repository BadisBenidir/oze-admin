import React, { useState } from 'react';
import { Check, Copy, Link2, Plus, UserPlus } from 'lucide-react';
import { Card, CardContent } from '../ui/Card';
import { useResellerInviteLinks, buildResellerInviteUrl, ResellerInviteLink } from '../../hooks/useResellerInviteLinks';
import { memberGroupOf, NEW_MEMBER_GROUP, OFFER_GROUP } from '../../config/memberGroups';

/**
 * Liens d'inscription UNIQUES (une seule inscription par lien, max_uses = 1)
 * pour les nouveaux membres d'une communauté, générés par le contact principal
 * (Mon équipe) ou l'admin (fiche partenaire) :
 *   - « Nouveau membre » : groupe 4, abonnement à activer dès l'inscription ;
 *   - « Offre 2 000 € » : groupe 5, accès offert 6 mois, 300 € dus à OZË.
 * L'inscription passe par /invite/team (accept-reseller-invite-link), qui
 * classe le membre dans le groupe du lien (0222).
 */
const KINDS = [
  {
    group: NEW_MEMBER_GROUP,
    title: 'Lien nouveau membre',
    detail: "Groupe 4 : il crée son compte puis active son abonnement pour accéder à l'espace.",
    className: 'border-amber-200 bg-amber-50 text-amber-900 hover:bg-amber-100',
  },
  {
    group: OFFER_GROUP,
    title: 'Lien Offre 2 000 €',
    detail: "Groupe 5 : accès offert 6 mois à partir de l'inscription (300 € dus à OZË PARIS).",
    className: 'border-teal-200 bg-teal-50 text-teal-900 hover:bg-teal-100',
  },
];

export const MemberInviteLinks: React.FC<{ resellerId: string }> = ({ resellerId }) => {
  const { links, createLink, setLinkActive } = useResellerInviteLinks(resellerId);
  const [creating, setCreating] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fresh, setFresh] = useState<ResellerInviteLink | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  const uniqueLinks = links.filter((l) => l.member_group && l.max_uses === 1);
  const visible = showAll ? uniqueLinks : uniqueLinks.slice(0, 5);

  const generate = async (group: number) => {
    setCreating(group);
    setError(null);
    const result = await createLink(group, 1);
    setCreating(null);
    if (!result.success || !result.link) return setError(result.error || 'Génération impossible');
    setFresh(result.link);
    copy(result.link);
  };

  const copy = async (link: ResellerInviteLink) => {
    try {
      await navigator.clipboard.writeText(buildResellerInviteUrl(link.token));
      setCopiedId(link.id);
      setTimeout(() => setCopiedId((c) => (c === link.id ? null : c)), 2000);
    } catch {
      /* copie manuelle depuis le champ */
    }
  };

  return (
    <Card>
      <CardContent className="space-y-4 p-4">
        <div>
          <p className="flex items-center gap-2 text-sm font-semibold text-gray-900">
            <UserPlus className="h-4 w-4 text-gray-400" /> Inscrire un nouveau membre
          </p>
          <p className="text-xs text-gray-500">Génère un lien unique à envoyer à la personne : il ne sert qu'à une seule inscription.</p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          {KINDS.map((k) => (
            <button
              key={k.group}
              type="button"
              onClick={() => generate(k.group)}
              disabled={creating !== null}
              className={`flex items-start gap-3 rounded-xl border p-4 text-left transition-colors disabled:opacity-60 ${k.className}`}
            >
              <Plus className="mt-0.5 h-4 w-4 flex-shrink-0" />
              <span>
                <span className="block text-sm font-semibold">{creating === k.group ? 'Génération…' : k.title}</span>
                <span className="mt-0.5 block text-xs opacity-80">{k.detail}</span>
              </span>
            </button>
          ))}
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        {fresh && (
          <div className="rounded-xl border border-gray-900 bg-gray-50 p-3">
            <p className="mb-2 text-xs font-medium text-gray-700">
              Nouveau lien {memberGroupOf(fresh.member_group)?.short} — {copiedId === fresh.id ? 'copié dans le presse-papiers' : 'à copier'} :
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <input
                readOnly
                value={buildResellerInviteUrl(fresh.token)}
                onFocus={(e) => e.target.select()}
                className="min-w-[220px] flex-1 rounded-lg border border-gray-200 bg-white px-2.5 py-2 font-mono text-xs text-gray-700 focus:outline-none"
              />
              <button
                type="button"
                onClick={() => copy(fresh)}
                className="flex items-center gap-1.5 rounded-lg bg-gray-900 px-3 py-2 text-xs font-medium text-white hover:bg-gray-800"
              >
                {copiedId === fresh.id ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                {copiedId === fresh.id ? 'Copié' : 'Copier'}
              </button>
            </div>
          </div>
        )}

        {uniqueLinks.length > 0 && (
          <div>
            <p className="mb-2 flex items-center gap-1.5 text-xs font-medium text-gray-500">
              <Link2 className="h-3.5 w-3.5" /> Liens générés
            </p>
            <ul className="divide-y divide-gray-100 rounded-lg border border-gray-100">
              {visible.map((l) => {
                const group = memberGroupOf(l.member_group);
                const used = l.use_count >= 1;
                return (
                  <li key={l.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-xs">
                    {group && <span className={`rounded-full border px-2 py-0.5 font-semibold ${group.className}`}>{group.short}</span>}
                    <span className="text-gray-500">{new Date(l.created_at).toLocaleDateString('fr-FR')}</span>
                    <span className="min-w-0 flex-1 truncate font-mono text-gray-400">{buildResellerInviteUrl(l.token)}</span>
                    {used ? (
                      <span className="rounded-full bg-green-50 px-2 py-0.5 font-medium text-green-700">Utilisé</span>
                    ) : !l.is_active ? (
                      <span className="rounded-full bg-gray-100 px-2 py-0.5 text-gray-500">Désactivé</span>
                    ) : (
                      <>
                        <span className="rounded-full bg-amber-50 px-2 py-0.5 font-medium text-amber-700">En attente</span>
                        <button type="button" onClick={() => copy(l)} className="text-gray-500 underline hover:text-gray-900">
                          {copiedId === l.id ? 'Copié' : 'Copier'}
                        </button>
                        <button type="button" onClick={() => setLinkActive(l.id, false)} className="text-gray-400 underline hover:text-red-600">
                          Désactiver
                        </button>
                      </>
                    )}
                  </li>
                );
              })}
            </ul>
            {uniqueLinks.length > 5 && (
              <button type="button" onClick={() => setShowAll((v) => !v)} className="mt-1 text-xs text-gray-500 underline">
                {showAll ? 'Voir moins' : `Voir les ${uniqueLinks.length} liens`}
              </button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default MemberInviteLinks;
