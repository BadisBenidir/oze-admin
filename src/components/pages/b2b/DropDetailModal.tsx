import React, { useState } from 'react';
import { X, Package, ImageOff, Trash2, Star, Lock, Unlock } from 'lucide-react';
import { Drop } from '../../../hooks/useDrops';
import { useDropProducts } from '../../../hooks/useDropProducts';

const formatDateTime = (iso: string): string =>
  new Date(iso).toLocaleString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });

const isSold = (status: string) => status.startsWith('sold-');

interface DropDetailModalProps {
  drop: Drop | null;
  onClose: () => void;
  /** Autres drops disponibles pour y déplacer un article (tout statut, hors ce drop). */
  otherDrops?: Drop[];
  onReassignProduct?: (productId: string, fromDropId: string, toDropId: string) => Promise<{ success: boolean; error?: string }>;
  /** Refusé par admin_delete_drop si un article du drop a déjà été vendu —
   * l'erreur est alors affichée ici plutôt que de fermer la modale. */
  onDelete?: (dropId: string) => Promise<{ success: boolean; error?: string }>;
  /** Pièces vitrine de l'annonce revendeur (max 4) — seulement pour un drop planifié. */
  onSetFeatured?: (dropId: string, productIds: string[]) => Promise<{ success: boolean; error?: string }>;
  /** Interdit / autorise l'annulation en libre-service des articles du drop (0176). */
  onSetLockCancellation?: (dropId: string, locked: boolean) => Promise<{ success: boolean; error?: string }>;
}

const MAX_FEATURED = 4;

export const DropDetailModal: React.FC<DropDetailModalProps> = ({ drop, onClose, otherDrops = [], onReassignProduct, onDelete, onSetFeatured, onSetLockCancellation }) => {
  // `drop` est dérivé en direct de la liste `drops` du parent (voir
  // B2BDrops.tsx) : product_ids se met à jour automatiquement après un
  // déplacement, ce qui redéclenche useDropProducts via sa dépendance sur
  // productIds.join(',') — pas besoin d'un refresh manuel ici.
  const { products, loading, error } = useDropProducts(drop?.product_ids ?? null);
  const [movingProductId, setMovingProductId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [featuredSaving, setFeaturedSaving] = useState(false);
  const [featuredError, setFeaturedError] = useState<string | null>(null);
  const [lockSaving, setLockSaving] = useState(false);

  if (!drop) return null;

  const handleMove = async (productId: string, toDropId: string) => {
    if (!onReassignProduct || !toDropId) return;
    setMovingProductId(productId);
    await onReassignProduct(productId, drop.id, toDropId);
    setMovingProductId(null);
  };

  const handleDelete = async () => {
    if (!onDelete) return;
    if (!window.confirm('Êtes-vous sûr de vouloir supprimer ce drop ? Cette action est irréversible.')) {
      return;
    }
    setDeleteError(null);
    setDeleting(true);
    const result = await onDelete(drop.id);
    setDeleting(false);
    if (!result.success) {
      setDeleteError(result.error || 'Impossible de supprimer ce drop');
      return;
    }
    onClose();
  };

  const canFeature = Boolean(onSetFeatured) && drop.status === 'planifie';
  const featured = (drop.featured_product_ids || []).filter((id) => drop.product_ids.includes(id));

  const toggleFeatured = async (productId: string) => {
    if (!onSetFeatured) return;
    const next = featured.includes(productId)
      ? featured.filter((id) => id !== productId)
      : [...featured, productId];
    if (next.length > MAX_FEATURED) {
      setFeaturedError(`${MAX_FEATURED} pièces vitrine maximum — retire d'abord une étoile.`);
      return;
    }
    setFeaturedError(null);
    setFeaturedSaving(true);
    const result = await onSetFeatured(drop.id, next);
    setFeaturedSaving(false);
    if (!result.success) setFeaturedError(result.error || 'Enregistrement impossible');
  };

  const totalPurchase = products.reduce((sum, p) => sum + (p.purchase_price || 0), 0);
  const totalSale = products.reduce((sum, p) => sum + p.sale_price, 0);
  const totalSold = products.filter((p) => isSold(p.status)).reduce((sum, p) => sum + p.sale_price, 0);

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="flex min-h-full items-center justify-center p-4">
        <div className="fixed inset-0 bg-black bg-opacity-25" onClick={onClose} />

        <div className="relative bg-white rounded-xl shadow-xl w-full max-w-3xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-start justify-between p-6 border-b border-gray-100">
            <div>
              <h3 className="text-lg font-semibold text-gray-900">{drop.title || 'Drop sans nom'}</h3>
              <p className="text-sm text-gray-500 mt-1">
                {formatDateTime(drop.scheduled_at)} · {drop.product_ids.length} article{drop.product_ids.length > 1 ? 's' : ''}
              </p>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              {onDelete && (
                <button
                  onClick={handleDelete}
                  disabled={deleting}
                  className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-50"
                  title="Supprimer le drop"
                >
                  <Trash2 className="h-5 w-5" />
                </button>
              )}
              <button onClick={onClose} className="p-2 text-gray-400 hover:text-gray-600 rounded-lg transition-colors">
                <X className="h-5 w-5" />
              </button>
            </div>
          </div>

          <div className="p-6 space-y-4">
            {deleteError && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">{deleteError}</div>
            )}
            {error && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">Erreur : {error}</div>
            )}
            {onSetLockCancellation && (
              <div className={`rounded-lg border p-3 flex flex-wrap items-center justify-between gap-3 ${drop.lock_reseller_cancellation ? 'border-red-200 bg-red-50' : 'border-gray-200 bg-gray-50'}`}>
                <p className={`text-sm flex items-start gap-2 ${drop.lock_reseller_cancellation ? 'text-red-800' : 'text-gray-700'}`}>
                  {drop.lock_reseller_cancellation ? <Lock className="h-4 w-4 mt-0.5 flex-shrink-0" /> : <Unlock className="h-4 w-4 mt-0.5 flex-shrink-0 text-gray-400" />}
                  <span>
                    <span className="font-medium">Annulation par les revendeurs : {drop.lock_reseller_cancellation ? 'interdite' : 'autorisée'}</span>
                    {drop.lock_reseller_cancellation
                      ? ' — les articles de ce drop ne peuvent plus être annulés depuis l\'espace revendeur (vous pouvez toujours les annuler depuis l\'admin).'
                      : ' — à interdire avant de solder les pièces restantes, pour éviter annulation puis rachat moins cher.'}
                  </span>
                </p>
                <button
                  type="button"
                  disabled={lockSaving}
                  onClick={async () => {
                    setLockSaving(true);
                    await onSetLockCancellation(drop.id, !drop.lock_reseller_cancellation);
                    setLockSaving(false);
                  }}
                  className="rounded-lg bg-white px-3 py-1.5 text-sm font-medium text-gray-800 ring-1 ring-gray-200 hover:bg-gray-100 disabled:opacity-50"
                >
                  {lockSaving ? 'Un instant…' : drop.lock_reseller_cancellation ? 'Autoriser l\'annulation' : 'Interdire l\'annulation'}
                </button>
              </div>
            )}
            {canFeature && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-900 flex items-start gap-2">
                <Star className="h-4 w-4 mt-0.5 flex-shrink-0 fill-amber-400 text-amber-500" />
                <p>
                  <span className="font-medium">Vitrine de l'annonce ({featured.length}/{MAX_FEATURED})</span> — clique sur l'étoile
                  des pièces à montrer nettes et en grand dans l'annonce du prochain drop (les autres suivent, floutées).
                  {featured.length === 0 && ' Sans choix, ce sont les 4 premières pièces du drop.'}
                </p>
              </div>
            )}
            {featuredError && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">{featuredError}</div>
            )}

            <div className="border border-gray-100 rounded-lg overflow-hidden">
              <table className="w-full">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-100">
                    <th className="text-left py-2.5 px-4 font-medium text-gray-500 text-xs">Produit</th>
                    <th className="text-right py-2.5 px-4 font-medium text-gray-500 text-xs">Prix d'achat</th>
                    <th className="text-right py-2.5 px-4 font-medium text-gray-500 text-xs">Prix de vente / Statut</th>
                    {otherDrops.length > 0 && <th className="text-right py-2.5 px-4 font-medium text-gray-500 text-xs">Déplacer</th>}
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    [...Array(3)].map((_, i) => (
                      <tr key={`skeleton-${i}`} className="border-b border-gray-50">
                        <td className="py-3 px-4" colSpan={4}>
                          <div className="h-4 w-full bg-gray-100 rounded animate-pulse" />
                        </td>
                      </tr>
                    ))
                  ) : products.length === 0 ? (
                    <tr>
                      <td className="py-8 px-4 text-center text-sm text-gray-500" colSpan={4}>
                        Aucun article trouvé pour ce drop.
                      </td>
                    </tr>
                  ) : (
                    products.map((p) => {
                      const sold = isSold(p.status);
                      const image = p.images?.[p.main_image_index] || p.images?.[0];
                      return (
                        <tr key={p.id} className="border-b border-gray-50 last:border-b-0">
                          <td className="py-3 px-4">
                            <div className="flex items-center gap-3">
                              {canFeature && (
                                <button
                                  type="button"
                                  onClick={() => toggleFeatured(p.id)}
                                  disabled={featuredSaving}
                                  title={featured.includes(p.id) ? 'Retirer de la vitrine' : 'Mettre en vitrine (annonce nette)'}
                                  className="p-1 -ml-1 rounded hover:bg-amber-50 disabled:opacity-50 flex-shrink-0"
                                >
                                  <Star className={`h-4 w-4 ${featured.includes(p.id) ? 'fill-amber-400 text-amber-500' : 'text-gray-300'}`} />
                                </button>
                              )}
                              <div className="h-10 w-10 bg-gray-100 rounded-lg flex items-center justify-center overflow-hidden flex-shrink-0">
                                {image ? (
                                  <img src={image} alt={p.name} className="h-full w-full object-cover" />
                                ) : (
                                  <ImageOff className="h-4 w-4 text-gray-300" />
                                )}
                              </div>
                              <div className="min-w-0">
                                <p className="text-sm font-medium text-gray-900 truncate">{p.name}</p>
                                <p className="text-xs text-gray-400 font-mono">{p.product_code}</p>
                              </div>
                            </div>
                          </td>
                          <td className="py-3 px-4 text-right text-sm text-gray-700">
                            {p.purchase_price != null ? `${p.purchase_price.toFixed(2)} €` : '—'}
                          </td>
                          <td className="py-3 px-4 text-right">
                            {sold ? (
                              <span className="text-sm font-semibold text-green-600">Vendu — {p.sale_price.toFixed(2)} €</span>
                            ) : (
                              <span className="text-sm font-semibold text-gray-900">{p.sale_price.toFixed(2)} €</span>
                            )}
                          </td>
                          {otherDrops.length > 0 && (
                            <td className="py-3 px-4 text-right">
                              <select
                                value=""
                                disabled={movingProductId === p.id}
                                onChange={(e) => handleMove(p.id, e.target.value)}
                                className="text-xs border border-gray-200 rounded px-1.5 py-1 bg-white focus:outline-none focus:border-gray-400 disabled:opacity-50"
                              >
                                <option value="">Déplacer vers...</option>
                                {otherDrops.map((d) => (
                                  <option key={d.id} value={d.id}>{d.title || 'Drop sans nom'}</option>
                                ))}
                              </select>
                            </td>
                          )}
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            {!loading && products.length > 0 && (
              <div className="flex justify-end">
                <div className="w-full sm:w-72 space-y-1.5 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-500">Total achat</span>
                    <span className="text-gray-900">{totalPurchase.toFixed(2)} €</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">Total vente (catalogue)</span>
                    <span className="text-gray-900">{totalSale.toFixed(2)} €</span>
                  </div>
                  <div className="flex justify-between font-semibold border-t border-gray-100 pt-1.5">
                    <span className="text-green-700 flex items-center gap-1">
                      <Package className="h-3.5 w-3.5" /> Déjà vendu
                    </span>
                    <span className="text-green-700">{totalSold.toFixed(2)} €</span>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
