import React, { useState } from 'react';
import { Link2, Copy, Check, Plus } from 'lucide-react';
import { useResellerInviteLinks, buildResellerInviteUrl, ResellerInviteLink } from '../../hooks/useResellerInviteLinks';

interface InviteLinkPanelProps {
  resellerId: string;
}

/**
 * Lien d'invitation d'équipe réutilisable : complète le flux email/mot de
 * passe existant (un par un) avec un lien à copier-coller, que le contact
 * principal transmet directement à ses collègues pour qu'ils s'inscrivent
 * eux-mêmes (voir accept-reseller-invite-link + /invite/team).
 */
export const InviteLinkPanel: React.FC<InviteLinkPanelProps> = ({ resellerId }) => {
  const { links, loading, error, createLink, setLinkActive } = useResellerInviteLinks(resellerId);
  const [creating, setCreating] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const handleCreate = async () => {
    setCreating(true);
    setActionError(null);
    const result = await createLink();
    setCreating(false);
    if (!result.success) {
      setActionError(result.error || 'Génération impossible');
    }
  };

  const handleToggle = async (link: ResellerInviteLink) => {
    setActionError(null);
    const result = await setLinkActive(link.id, !link.is_active);
    if (!result.success) {
      setActionError(result.error || 'Action impossible');
    }
  };

  const handleCopy = async (link: ResellerInviteLink) => {
    const url = buildResellerInviteUrl(link.token);
    try {
      await navigator.clipboard.writeText(url);
      setCopiedId(link.id);
      setTimeout(() => setCopiedId((current) => (current === link.id ? null : current)), 2000);
    } catch {
      setActionError('Copie impossible — copie le lien manuellement');
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <Link2 className="h-4 w-4 text-gray-400" />
          <p className="text-sm font-medium text-gray-700">Lien d'invitation équipe</p>
        </div>
        <button
          type="button"
          onClick={handleCreate}
          disabled={creating}
          className="flex items-center space-x-1.5 px-3 py-1.5 bg-gray-900 text-white rounded-lg hover:bg-gray-800 transition-colors disabled:opacity-50 text-xs"
        >
          <Plus className="h-3.5 w-3.5" />
          <span>{creating ? 'Génération...' : 'Générer un lien'}</span>
        </button>
      </div>

      {(error || actionError) && (
        <p className="text-xs text-red-600 mb-2">{actionError || error}</p>
      )}
      {loading && <p className="text-xs text-gray-400">Chargement...</p>}
      {!loading && links.length === 0 && (
        <p className="text-xs text-gray-400">Aucun lien généré pour l'instant — un lien est réutilisable par plusieurs collègues tant qu'il reste actif.</p>
      )}

      <div className="space-y-2">
        {links.map((link) => {
          const url = buildResellerInviteUrl(link.token);
          return (
            <div key={link.id} className="flex items-center gap-2 flex-wrap">
              <input
                readOnly
                value={url}
                onFocus={(e) => e.target.select()}
                className="flex-1 min-w-[220px] px-2.5 py-1.5 border border-gray-200 rounded-lg text-xs font-mono text-gray-600 focus:outline-none focus:border-gray-400"
              />
              <button
                type="button"
                onClick={() => handleCopy(link)}
                className="flex items-center space-x-1 px-2.5 py-1.5 text-gray-500 hover:text-gray-900 border border-gray-200 rounded-lg transition-colors text-xs"
              >
                {copiedId === link.id ? <Check className="h-3.5 w-3.5 text-green-600" /> : <Copy className="h-3.5 w-3.5" />}
                <span>{copiedId === link.id ? 'Copié' : 'Copier'}</span>
              </button>
              <button
                type="button"
                onClick={() => handleToggle(link)}
                className={`px-2.5 py-1.5 rounded-lg text-xs border ${
                  link.is_active ? 'border-green-200 bg-green-50 text-green-700' : 'border-gray-200 text-gray-400'
                }`}
              >
                {link.is_active ? 'Actif' : 'Désactivé'}
              </button>
              <span className="text-xs text-gray-400">
                {link.use_count} utilisation{link.use_count > 1 ? 's' : ''}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
};
