import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, CalendarClock, Package, Search, Trash2 } from 'lucide-react';
import { Card, CardContent } from '../../ui/Card';
import { Badge } from '../../ui/Badge';
import { Toast } from '../../ui/Toast';
import { supabase } from '../../../lib/supabase';

/**
 * Changements de prix programmés du catalogue B2B (0200) : filtrer les
 * articles en vente B2B, saisir le nouveau prix de chacun, choisir la date
 * et l'heure — le planificateur (apply_due_b2b_price_changes, chaque
 * minute) applique les prix à l'heure dite.
 */

interface CatalogProduct {
  id: string;
  name: string;
  sale_price: number;
  purchase_price: number | null;
  images: string[] | null;
  main_image_index: number | null;
  created_at: string;
  brand: { name: string } | null;
  category: { name: string } | null;
}

interface PriceChange {
  id: string;
  product_id: string;
  new_price: number;
  old_price: number | null;
  scheduled_at: string;
  status: 'scheduled' | 'applied' | 'skipped' | 'cancelled';
  applied_at: string | null;
  product: { name: string; sale_price: number; status: string } | null;
}

const EUR = (n: number | null | undefined) =>
  n == null ? '—' : `${Number(n).toLocaleString('fr-FR', { minimumFractionDigits: 0, maximumFractionDigits: 2 })} €`;
const dateTime = (iso: string) =>
  new Date(iso).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const daysSince = (iso: string) => Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);

/** Valeur par défaut du sélecteur : demain 20:00, heure locale. */
const defaultWhen = () => {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(20, 0, 0, 0);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

export const B2BPriceChanges: React.FC = () => {
  const [products, setProducts] = useState<CatalogProduct[]>([]);
  const [changes, setChanges] = useState<PriceChange[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState('');

  const [search, setSearch] = useState('');
  const [brand, setBrand] = useState('');
  const [category, setCategory] = useState('');
  const [minDays, setMinDays] = useState('');
  const [when, setWhen] = useState(defaultWhen);
  const [newPrices, setNewPrices] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const [productsRes, changesRes] = await Promise.all([
      supabase
        .from('products')
        .select('id, name, sale_price, purchase_price, images, main_image_index, created_at, brand:brands(name), category:categories(name)')
        .eq('status', 'for-sale-b2b')
        .order('created_at', { ascending: true })
        .limit(2000),
      supabase
        .from('b2b_price_changes')
        .select('id, product_id, new_price, old_price, scheduled_at, status, applied_at, product:products(name, sale_price, status)')
        .order('scheduled_at', { ascending: false })
        .limit(300),
    ]);
    if (productsRes.error) setError(productsRes.error.message);
    else setProducts((productsRes.data || []) as unknown as CatalogProduct[]);
    if (changesRes.error) setError(changesRes.error.message);
    else setChanges((changesRes.data || []) as unknown as PriceChange[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const scheduledByProduct = useMemo(() => {
    const map = new Map<string, PriceChange>();
    for (const c of changes) if (c.status === 'scheduled') map.set(c.product_id, c);
    return map;
  }, [changes]);

  const brands = useMemo(() => Array.from(new Set(products.map((p) => p.brand?.name).filter(Boolean) as string[])).sort(), [products]);
  const categories = useMemo(() => Array.from(new Set(products.map((p) => p.category?.name).filter(Boolean) as string[])).sort(), [products]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    const days = Number(minDays) || 0;
    return products.filter(
      (p) =>
        (!term || p.name.toLowerCase().includes(term)) &&
        (!brand || p.brand?.name === brand) &&
        (!category || p.category?.name === category) &&
        (!days || daysSince(p.created_at) >= days)
    );
  }, [products, search, brand, category, minDays]);

  const toSchedule = useMemo(
    () =>
      Object.entries(newPrices)
        .map(([productId, raw]) => ({ productId, price: Number(raw.replace(',', '.')) }))
        .filter((e) => Number.isFinite(e.price) && e.price > 0),
    [newPrices]
  );

  const handleSchedule = async () => {
    const at = new Date(when);
    if (Number.isNaN(at.getTime())) {
      setError('Date et heure invalides');
      return;
    }
    if (at.getTime() < Date.now() - 60_000) {
      setError("L'heure choisie est déjà passée");
      return;
    }
    if (toSchedule.length === 0) return;
    if (!confirm(`Programmer ${toSchedule.length} changement(s) de prix pour le ${dateTime(at.toISOString())} ?`)) return;

    setSaving(true);
    setError(null);
    const { data: { user } } = await supabase.auth.getUser();
    // Un seul changement programmé par article : le nouveau remplace l'ancien.
    const ids = toSchedule.map((e) => e.productId);
    const { error: cancelError } = await supabase
      .from('b2b_price_changes')
      .update({ status: 'cancelled' })
      .in('product_id', ids)
      .eq('status', 'scheduled');
    if (cancelError) {
      setSaving(false);
      setError(cancelError.message);
      return;
    }
    const { error: insertError } = await supabase.from('b2b_price_changes').insert(
      toSchedule.map((e) => ({
        product_id: e.productId,
        new_price: Math.round(e.price * 100) / 100,
        scheduled_at: at.toISOString(),
        created_by: user?.id ?? null,
      }))
    );
    setSaving(false);
    if (insertError) {
      setError(insertError.message);
      return;
    }
    setNewPrices({});
    setToast(`${toSchedule.length} changement(s) de prix programmé(s) pour le ${dateTime(at.toISOString())}.`);
    load();
  };

  const cancelChanges = async (ids: string[]) => {
    if (!confirm(`Annuler ${ids.length} changement(s) de prix programmé(s) ?`)) return;
    const { error: updateError } = await supabase.from('b2b_price_changes').update({ status: 'cancelled' }).in('id', ids);
    if (updateError) setError(updateError.message);
    load();
  };

  const upcomingGroups = useMemo(() => {
    const groups = new Map<string, PriceChange[]>();
    for (const c of changes.filter((x) => x.status === 'scheduled').sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at))) {
      if (!groups.has(c.scheduled_at)) groups.set(c.scheduled_at, []);
      groups.get(c.scheduled_at)!.push(c);
    }
    return Array.from(groups.entries());
  }, [changes]);

  const history = useMemo(() => changes.filter((c) => c.status === 'applied' || c.status === 'skipped').slice(0, 50), [changes]);

  const input = 'px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-gray-400 bg-white';

  return (
    <div className="p-4 md:p-6 space-y-6">
      <div>
        <h3 className="text-lg font-semibold text-gray-900">Baisses de prix programmées</h3>
        <p className="text-sm text-gray-500">
          Saisis le nouveau prix des articles du catalogue B2B et l'heure à laquelle il s'applique — le changement se fait tout seul, à la minute près.
        </p>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 flex items-center gap-2">
          <AlertCircle className="h-4 w-4 text-red-600 flex-shrink-0" />
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      {upcomingGroups.length > 0 && (
        <Card>
          <CardContent className="p-4 space-y-4">
            <p className="text-sm font-semibold text-gray-900 flex items-center gap-2">
              <CalendarClock className="h-4 w-4 text-gray-400" /> À venir
            </p>
            {upcomingGroups.map(([at, group]) => (
              <div key={at} className="border border-gray-100 rounded-lg">
                <div className="flex items-center justify-between px-3 py-2 bg-gray-50 rounded-t-lg">
                  <span className="text-sm font-medium text-gray-900">
                    {dateTime(at)} — {group.length} article{group.length > 1 ? 's' : ''}
                  </span>
                  <button
                    type="button"
                    onClick={() => cancelChanges(group.map((c) => c.id))}
                    className="text-xs font-medium text-red-600 hover:text-red-800"
                  >
                    Tout annuler
                  </button>
                </div>
                <ul className="divide-y divide-gray-50">
                  {group.map((c) => (
                    <li key={c.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                      <span className="min-w-0 truncate text-gray-900">{c.product?.name || 'Article'}</span>
                      <span className="flex items-center gap-3 flex-shrink-0">
                        <span className="tabular-nums text-gray-400 line-through">{EUR(c.product?.sale_price)}</span>
                        <span className="tabular-nums font-semibold text-gray-900">{EUR(c.new_price)}</span>
                        <button
                          type="button"
                          onClick={() => cancelChanges([c.id])}
                          title="Annuler ce changement"
                          className="p-1 text-gray-400 hover:text-red-600"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="p-4 space-y-4">
          <div className="flex flex-col lg:flex-row lg:items-end gap-3">
            <div className="relative flex-1 min-w-0">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Rechercher un article..."
                className={`${input} w-full pl-9`}
              />
            </div>
            <select value={brand} onChange={(e) => setBrand(e.target.value)} className={input}>
              <option value="">Toutes marques</option>
              {brands.map((b) => <option key={b} value={b}>{b}</option>)}
            </select>
            <select value={category} onChange={(e) => setCategory(e.target.value)} className={input}>
              <option value="">Toutes catégories</option>
              {categories.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <select value={minDays} onChange={(e) => setMinDays(e.target.value)} className={input}>
              <option value="">Toute ancienneté</option>
              <option value="7">En ligne depuis 7 j et +</option>
              <option value="14">En ligne depuis 14 j et +</option>
              <option value="30">En ligne depuis 30 j et +</option>
              <option value="60">En ligne depuis 60 j et +</option>
            </select>
          </div>

          <div className="border border-gray-100 rounded-lg overflow-x-auto">
            <table className="w-full min-w-[640px]">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100 text-xs text-gray-500">
                  <th className="text-left py-2.5 px-3 font-medium">Article</th>
                  <th className="text-right py-2.5 px-3 font-medium">En ligne</th>
                  <th className="text-right py-2.5 px-3 font-medium">Achat</th>
                  <th className="text-right py-2.5 px-3 font-medium">Prix actuel</th>
                  <th className="text-right py-2.5 px-3 font-medium w-36">Nouveau prix</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={5} className="py-6 text-center text-sm text-gray-400">Chargement...</td></tr>
                ) : filtered.length === 0 ? (
                  <tr><td colSpan={5} className="py-6 text-center text-sm text-gray-400">Aucun article en vente B2B pour ces filtres.</td></tr>
                ) : (
                  filtered.map((p) => {
                    const image = p.images?.[p.main_image_index ?? 0] || p.images?.[0];
                    const scheduled = scheduledByProduct.get(p.id);
                    return (
                      <tr key={p.id} className="border-b border-gray-50 last:border-b-0">
                        <td className="py-2 px-3">
                          <div className="flex items-center gap-2.5 min-w-0">
                            <div className="h-9 w-9 bg-gray-100 rounded-lg overflow-hidden flex-shrink-0 flex items-center justify-center">
                              {image ? <img src={image} alt="" className="h-full w-full object-cover" /> : <Package className="h-4 w-4 text-gray-300" />}
                            </div>
                            <div className="min-w-0">
                              <p className="text-sm font-medium text-gray-900 truncate">{p.name}</p>
                              <p className="text-xs text-gray-500 truncate">
                                {[p.brand?.name, p.category?.name].filter(Boolean).join(' · ')}
                                {scheduled && (
                                  <span className="ml-2">
                                    <Badge variant="info">Déjà programmé : {EUR(scheduled.new_price)} le {dateTime(scheduled.scheduled_at)}</Badge>
                                  </span>
                                )}
                              </p>
                            </div>
                          </div>
                        </td>
                        <td className="py-2 px-3 text-right text-xs text-gray-500 tabular-nums whitespace-nowrap">{daysSince(p.created_at)} j</td>
                        <td className="py-2 px-3 text-right text-sm text-gray-500 tabular-nums whitespace-nowrap">{EUR(p.purchase_price)}</td>
                        <td className="py-2 px-3 text-right text-sm font-semibold text-gray-900 tabular-nums whitespace-nowrap">{EUR(p.sale_price)}</td>
                        <td className="py-2 px-3 text-right">
                          <div className="relative inline-block">
                            <input
                              type="number"
                              min="1"
                              step="1"
                              inputMode="decimal"
                              value={newPrices[p.id] ?? ''}
                              onChange={(e) => setNewPrices((prev) => ({ ...prev, [p.id]: e.target.value }))}
                              placeholder="—"
                              className={`${input} w-28 pr-7 text-right tabular-nums`}
                            />
                            <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-gray-400">€</span>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-end gap-3 border-t border-gray-100 pt-4">
            <label className="flex items-center gap-2 text-sm text-gray-700">
              Appliquer le
              <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} className={input} />
            </label>
            <button
              type="button"
              onClick={handleSchedule}
              disabled={saving || toSchedule.length === 0}
              className="flex items-center justify-center gap-1.5 px-4 py-2 bg-gray-900 text-white rounded-lg hover:bg-gray-800 transition-colors disabled:opacity-50 text-sm font-medium"
            >
              <CalendarClock className="h-4 w-4" />
              {saving ? 'Programmation...' : `Programmer ${toSchedule.length || ''} changement${toSchedule.length > 1 ? 's' : ''}`}
            </button>
          </div>
        </CardContent>
      </Card>

      {history.length > 0 && (
        <Card>
          <CardContent className="p-4">
            <p className="text-sm font-semibold text-gray-900 mb-3">Derniers changements appliqués</p>
            <ul className="divide-y divide-gray-50">
              {history.map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <span className="min-w-0 truncate text-gray-900">{c.product?.name || 'Article'}</span>
                  <span className="flex items-center gap-3 flex-shrink-0 text-xs text-gray-500">
                    {c.status === 'applied' ? (
                      <span className="tabular-nums">
                        <span className="line-through">{EUR(c.old_price)}</span> → <span className="font-semibold text-gray-900">{EUR(c.new_price)}</span>
                      </span>
                    ) : (
                      <Badge variant="default">Ignoré : plus en vente B2B</Badge>
                    )}
                    <span>{c.applied_at ? dateTime(c.applied_at) : ''}</span>
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {toast && <Toast message={toast} onDismiss={() => setToast('')} />}
    </div>
  );
};

export default B2BPriceChanges;
