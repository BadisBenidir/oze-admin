import React, { useEffect, useMemo, useState } from 'react';
import { X, Link2, Copy, Check, Plus, Ban, Trash2, ImageOff, Eye, ExternalLink } from 'lucide-react';
import { supabase } from '../../../lib/supabase';
import { Badge } from '../../ui/Badge';
import { useAdminPreviewLinks, buildPreviewLinkUrl, PreviewLink, PreviewTarget, AuctionPriceMode } from '../../../hooks/useAdminPreviewLinks';

interface PreviewItem {
  id: string;
  name: string;
  brand: string | null;
  image: string | null;
}

interface PreviewLinksModalProps {
  target: PreviewTarget | null;
  /** Nom du drop / de la session, affiché dans l'en-tête. */
  title: string;
  /** Drop : ses product_ids, dans l'ordre. Ignoré pour une session d'enchères. */
  productIds?: string[];
  onClose: () => void;
}

const formatDateTime = (iso: string): string =>
  new Date(iso).toLocaleString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

const linkState = (link: PreviewLink): 'active' | 'revoked' | 'expired' => {
  if (link.revoked_at) return 'revoked';
  if (link.expires_at && new Date(link.expires_at).getTime() <= Date.now()) return 'expired';
  return 'active';
};

/** Pièces sélectionnables : produits du drop, ou lots (hors annulés) de la session. */
const usePreviewItems = (target: PreviewTarget | null, productIds: string[]) => {
  const [items, setItems] = useState<PreviewItem[]>([]);
  const [loading, setLoading] = useState(false);
  const idsKey = productIds.join(',');

  useEffect(() => {
    if (!target) return;
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      if (target.kind === 'drop') {
        if (productIds.length === 0) {
          setItems([]);
          setLoading(false);
          return;
        }
        const { data } = await supabase
          .from('products')
          .select('id, name, images, main_image_index, brand:brands(name)')
          .in('id', productIds);
        const byId = new Map((data || []).map((p) => [p.id, p]));
        const rows = productIds
          .map((id) => byId.get(id))
          .filter((p): p is NonNullable<typeof p> => Boolean(p))
          .map((p) => {
            const brand = p.brand as unknown as { name: string } | null;
            return {
              id: p.id,
              name: p.name,
              brand: brand?.name ?? null,
              image: p.images?.[p.main_image_index ?? 0] || p.images?.[0] || null,
            };
          });
        if (!cancelled) setItems(rows);
      } else {
        const { data } = await supabase
          .from('auction_items')
          .select('id, title, brand, images, status')
          .eq('session_id', target.id)
          .neq('status', 'cancelled')
          .order('ends_at', { ascending: true });
        if (!cancelled) {
          setItems((data || []).map((i) => ({ id: i.id, name: i.title, brand: i.brand, image: i.images?.[0] || null })));
        }
      }
      if (!cancelled) setLoading(false);
    };
    load();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target?.kind, target?.id, idsKey]);

  return { items, loading };
};

/**
 * Liens d'avant-première à poster sur Discord : chaque lien ouvre une page
 * publique (sans compte) avec toutes les pièces ou une sélection, et un
 * bouton de connexion / d'inscription. Révocable à tout moment.
 */
export const PreviewLinksModal: React.FC<PreviewLinksModalProps> = ({ target, title, productIds = [], onClose }) => {
  const { links, loading, error, createLink, revokeLink, deleteLink } = useAdminPreviewLinks(target);
  const { items, loading: itemsLoading } = usePreviewItems(target, productIds);

  const [showForm, setShowForm] = useState(false);
  const [label, setLabel] = useState('');
  const [mode, setMode] = useState<'all' | 'some'>('all');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showPrices, setShowPrices] = useState(false);
  // Sessions d'enchères : choix des prix affichés (0195).
  const [priceMode, setPriceMode] = useState<AuctionPriceMode>('start');
  const [expiresAt, setExpiresAt] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const itemsById = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);

  if (!target) return null;

  const resetForm = () => {
    setLabel('');
    setMode('all');
    setSelected(new Set());
    setShowPrices(false);
    setExpiresAt('');
    setShowForm(false);
  };

  const toggleItem = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const copy = async (link: PreviewLink) => {
    try {
      await navigator.clipboard.writeText(buildPreviewLinkUrl(link.token));
      setCopiedId(link.id);
      setTimeout(() => setCopiedId((current) => (current === link.id ? null : current)), 2000);
    } catch {
      setActionError('Copie impossible — copie le lien manuellement');
    }
  };

  const handleCreate = async () => {
    if (mode === 'some' && selected.size === 0) {
      setActionError('Sélectionne au moins une pièce');
      return;
    }
    setActionError(null);
    setSubmitting(true);
    const result = await createLink({
      label,
      // Conserve l'ordre du drop / de la session plutôt que l'ordre de clic.
      item_ids: mode === 'all' ? null : items.filter((i) => selected.has(i.id)).map((i) => i.id),
      show_prices: target.kind === 'auction' ? priceMode !== 'none' : showPrices,
      ...(target.kind === 'auction' ? { price_mode: priceMode } : {}),
      expires_at: expiresAt ? new Date(expiresAt).toISOString() : null,
    });
    setSubmitting(false);
    if (!result.success) {
      setActionError(result.error || 'Création impossible');
      return;
    }
    resetForm();
    if (result.link) copy(result.link);
  };

  const handleRevoke = async (link: PreviewLink) => {
    if (!window.confirm('Désactiver ce lien ? Les personnes qui l\'ont ne pourront plus voir l\'aperçu.')) return;
    const result = await revokeLink(link.id);
    if (!result.success) setActionError(result.error || 'Action impossible');
  };

  const handleDelete = async (link: PreviewLink) => {
    if (!window.confirm('Supprimer définitivement ce lien ?')) return;
    const result = await deleteLink(link.id);
    if (!result.success) setActionError(result.error || 'Suppression impossible');
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="flex min-h-full items-center justify-center p-4">
        <div className="fixed inset-0 bg-black bg-opacity-25" onClick={onClose} />

        <div className="relative bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-start justify-between p-6 border-b border-gray-100">
            <div>
              <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                <Link2 className="h-5 w-5" /> Liens d'avant-première
              </h3>
              <p className="text-sm text-gray-500 mt-1">
                {title} — page publique, sans compte, à partager sur Discord
              </p>
            </div>
            <button onClick={onClose} className="p-2 text-gray-400 hover:text-gray-600 rounded-lg transition-colors">
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="p-6 space-y-5">
            {(error || actionError) && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">{actionError || `Erreur : ${error}`}</div>
            )}

            {!showForm ? (
              <button
                onClick={() => setShowForm(true)}
                className="flex items-center gap-2 px-4 py-2 bg-gray-900 text-white rounded-lg hover:bg-gray-800 transition-colors text-sm font-medium"
              >
                <Plus className="h-4 w-4" /> Nouveau lien
              </button>
            ) : (
              <div className="border border-gray-200 rounded-lg p-4 space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Nom interne (optionnel)</label>
                  <input
                    value={label}
                    onChange={(e) => setLabel(e.target.value)}
                    placeholder="ex. Discord #annonces"
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:border-gray-400 text-sm"
                  />
                  <p className="text-xs text-gray-400 mt-1">Affiché aussi en haut de la page d'aperçu.</p>
                </div>

                <div>
                  <p className="text-sm font-medium text-gray-700 mb-2">Pièces visibles</p>
                  <div className="flex gap-2">
                    {([['all', 'Toutes les pièces'], ['some', 'Une sélection']] as const).map(([value, text]) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() => setMode(value)}
                        className={`px-3 py-1.5 rounded-lg text-sm border transition-colors ${mode === value ? 'bg-gray-900 text-white border-gray-900' : 'border-gray-200 text-gray-700 hover:bg-gray-50'}`}
                      >
                        {text}
                      </button>
                    ))}
                  </div>
                  {mode === 'all' && (
                    <p className="text-xs text-gray-400 mt-1.5">Les pièces ajoutées plus tard apparaîtront aussi.</p>
                  )}
                  {mode === 'some' && (
                    <div className="mt-3">
                      <div className="flex items-center justify-between mb-2">
                        <p className="text-xs text-gray-500">{selected.size} / {items.length} sélectionnée{selected.size > 1 ? 's' : ''}</p>
                        <button
                          type="button"
                          onClick={() => setSelected(selected.size === items.length ? new Set() : new Set(items.map((i) => i.id)))}
                          className="text-xs text-gray-600 hover:text-gray-900 underline"
                        >
                          {selected.size === items.length ? 'Tout désélectionner' : 'Tout sélectionner'}
                        </button>
                      </div>
                      {itemsLoading ? (
                        <div className="h-24 bg-gray-100 rounded-lg animate-pulse" />
                      ) : items.length === 0 ? (
                        <p className="text-sm text-gray-500">Aucune pièce pour l'instant.</p>
                      ) : (
                        <div className="grid grid-cols-3 sm:grid-cols-5 gap-2 max-h-72 overflow-y-auto pr-1">
                          {items.map((item) => {
                            const active = selected.has(item.id);
                            return (
                              <button
                                key={item.id}
                                type="button"
                                onClick={() => toggleItem(item.id)}
                                title={item.name}
                                className={`relative text-left rounded-lg overflow-hidden border-2 transition-colors ${active ? 'border-gray-900' : 'border-transparent opacity-60 hover:opacity-100'}`}
                              >
                                <div className="aspect-square bg-gray-100 flex items-center justify-center">
                                  {item.image ? (
                                    <img src={item.image} alt={item.name} className="h-full w-full object-cover" loading="lazy" />
                                  ) : (
                                    <ImageOff className="h-4 w-4 text-gray-300" />
                                  )}
                                </div>
                                <p className="text-[10px] text-gray-700 truncate px-1 py-0.5">{item.brand || item.name}</p>
                                {active && (
                                  <span className="absolute top-1 right-1 h-5 w-5 rounded-full bg-gray-900 text-white flex items-center justify-center">
                                    <Check className="h-3 w-3" />
                                  </span>
                                )}
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {target.kind === 'auction' ? (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Prix affichés</label>
                    <select
                      value={priceMode}
                      onChange={(e) => setPriceMode(e.target.value as AuctionPriceMode)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white"
                    >
                      <option value="start">Prix de départ</option>
                      <option value="final">Prix final (lots adjugés)</option>
                      <option value="both">Prix de départ et prix final</option>
                      <option value="none">Aucun prix</option>
                    </select>
                  </div>
                ) : (
                  <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                    <input type="checkbox" checked={showPrices} onChange={(e) => setShowPrices(e.target.checked)} className="rounded" />
                    Afficher les prix (prix revendeur)
                  </label>
                )}

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Expiration (optionnel)</label>
                  <input
                    type="datetime-local"
                    value={expiresAt}
                    onChange={(e) => setExpiresAt(e.target.value)}
                    className="px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:border-gray-400 text-sm"
                  />
                </div>

                <div className="flex justify-end gap-2">
                  <button
                    onClick={resetForm}
                    disabled={submitting}
                    className="px-4 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors text-sm disabled:opacity-50"
                  >
                    Annuler
                  </button>
                  <button
                    onClick={handleCreate}
                    disabled={submitting}
                    className="px-4 py-2 bg-gray-900 text-white rounded-lg hover:bg-gray-800 transition-colors text-sm font-medium disabled:opacity-50"
                  >
                    {submitting ? 'Création...' : 'Créer et copier le lien'}
                  </button>
                </div>
              </div>
            )}

            <div>
              <p className="text-sm font-medium text-gray-700 mb-2">Liens existants</p>
              {loading && links.length === 0 ? (
                <div className="h-16 bg-gray-100 rounded-lg animate-pulse" />
              ) : links.length === 0 ? (
                <p className="text-sm text-gray-500">Aucun lien pour l'instant.</p>
              ) : (
                <div className="space-y-2">
                  {links.map((link) => {
                    const state = linkState(link);
                    const url = buildPreviewLinkUrl(link.token);
                    const thumbs = (link.item_ids || []).map((id) => itemsById.get(id)?.image).filter(Boolean).slice(0, 5) as string[];
                    return (
                      <div key={link.id} className={`border border-gray-100 rounded-lg p-3 ${state !== 'active' ? 'opacity-60' : ''}`}>
                        <div className="flex items-start justify-between gap-3 flex-wrap">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <p className="text-sm font-medium text-gray-900">{link.label || 'Lien sans nom'}</p>
                              {state === 'active' && <Badge variant="success">Actif</Badge>}
                              {state === 'revoked' && <Badge variant="danger">Désactivé</Badge>}
                              {state === 'expired' && <Badge variant="warning">Expiré</Badge>}
                            </div>
                            <p className="text-xs text-gray-500 mt-0.5">
                              {link.item_ids ? `${link.item_ids.length} pièce${link.item_ids.length > 1 ? 's' : ''}` : 'Toutes les pièces'}
                              {' · '}{link.session_id && link.price_mode
                                ? { start: 'prix de départ', final: 'prix final', both: 'prix de départ et final', none: 'sans prix' }[link.price_mode]
                                : link.show_prices ? 'prix affichés' : 'sans prix'}
                              {link.expires_at && ` · expire le ${formatDateTime(link.expires_at)}`}
                            </p>
                            <p className="text-xs text-gray-500 mt-0.5 flex items-center gap-1">
                              <Eye className="h-3 w-3" /> {link.view_count} vue{link.view_count > 1 ? 's' : ''}
                              {link.last_viewed_at && ` · dernière le ${formatDateTime(link.last_viewed_at)}`}
                            </p>
                          </div>
                          <div className="flex items-center gap-1">
                            {state === 'active' && (
                              <button
                                onClick={() => copy(link)}
                                className="flex items-center gap-1 px-2.5 py-1.5 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors text-xs font-medium"
                              >
                                {copiedId === link.id ? <Check className="h-3 w-3 text-green-600" /> : <Copy className="h-3 w-3" />}
                                {copiedId === link.id ? 'Copié' : 'Copier'}
                              </button>
                            )}
                            <a
                              href={url}
                              target="_blank"
                              rel="noreferrer"
                              className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                              title="Ouvrir l'aperçu"
                            >
                              <ExternalLink className="h-4 w-4" />
                            </a>
                            {state === 'active' && (
                              <button
                                onClick={() => handleRevoke(link)}
                                className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                                title="Désactiver le lien"
                              >
                                <Ban className="h-4 w-4" />
                              </button>
                            )}
                            <button
                              onClick={() => handleDelete(link)}
                              className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                              title="Supprimer le lien"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                        </div>
                        {state === 'active' && (
                          <p className="mt-2 text-[11px] font-mono text-gray-400 break-all">{url}</p>
                        )}
                        {thumbs.length > 0 && (
                          <div className="mt-2 flex gap-1">
                            {thumbs.map((src, i) => (
                              <img key={i} src={src} alt="" className="h-8 w-8 rounded object-cover" loading="lazy" />
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PreviewLinksModal;
