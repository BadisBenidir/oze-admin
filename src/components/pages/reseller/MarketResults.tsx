import React, { useEffect, useMemo, useState } from 'react';
import { Search, Gavel, Rocket, Package } from 'lucide-react';
import { supabase } from '../../../lib/supabase';

interface MarketResult {
  id: string;
  source: 'auction' | 'drop';
  title: string | null;
  brand: string | null;
  category: string | null;
  condition: string | null;
  image: string | null;
  start_price: number | null;
  final_price: number;
  sold_at: string;
}

type SortKey = 'recent' | 'oldest' | 'price_desc' | 'price_asc';

const PAGE = 60;
const EUR = (n: number) => (Number(n) || 0).toLocaleString('fr-FR', { minimumFractionDigits: 0, maximumFractionDigits: 2 }) + ' €';
const DAY = (iso: string) => new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/**
 * Résultats de ventes : tous les articles vendus sur la plateforme (drops et
 * enchères), avec date, prix payé et prix de départ des enchères
 * (get_market_results, 0248 — aucune donnée acheteur). Filtres catégorie /
 * marque / type, recherche par mot-clé et tri, côté navigateur.
 */
export const MarketResults: React.FC = () => {
  const [rows, setRows] = useState<MarketResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('');
  const [brand, setBrand] = useState('');
  const [source, setSource] = useState<'' | 'auction' | 'drop'>('');
  const [sort, setSort] = useState<SortKey>('recent');
  const [shown, setShown] = useState(PAGE);

  useEffect(() => {
    supabase.rpc('get_market_results').then(({ data, error: rpcError }) => {
      if (rpcError) setError(rpcError.message);
      setRows(((data || []) as MarketResult[]).map((r) => ({ ...r, final_price: Number(r.final_price), start_price: r.start_price != null ? Number(r.start_price) : null })));
      setLoading(false);
    });
  }, []);

  const categories = useMemo(() => Array.from(new Set(rows.map((r) => r.category).filter(Boolean) as string[])).sort((a, b) => a.localeCompare(b)), [rows]);
  const brands = useMemo(() => Array.from(new Set(rows.map((r) => r.brand?.trim()).filter(Boolean) as string[])).sort((a, b) => a.localeCompare(b)), [rows]);

  const filtered = useMemo(() => {
    const q = norm(query.trim());
    const list = rows.filter(
      (r) =>
        (!category || r.category === category) &&
        (!brand || r.brand?.trim() === brand) &&
        (!source || r.source === source) &&
        (!q || norm(`${r.title || ''} ${r.brand || ''} ${r.category || ''}`).includes(q))
    );
    const byDate = (a: MarketResult, b: MarketResult) => new Date(b.sold_at).getTime() - new Date(a.sold_at).getTime();
    list.sort((a, b) =>
      sort === 'recent' ? byDate(a, b) : sort === 'oldest' ? -byDate(a, b) : sort === 'price_desc' ? b.final_price - a.final_price : a.final_price - b.final_price
    );
    return list;
  }, [rows, query, category, brand, source, sort]);

  useEffect(() => setShown(PAGE), [query, category, brand, source, sort]);

  const selectClass = 'rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-700 focus:border-gray-400 focus:outline-none';

  return (
    <div className="mx-auto max-w-7xl space-y-5 p-4 md:p-6">
      <div>
        <h2 className="text-xl font-semibold text-gray-900">Résultats de ventes</h2>
        <p className="text-sm text-gray-500">Tous les articles vendus sur la plateforme, en drop ou aux enchères, avec leur prix final.</p>
      </div>

      <div className="flex flex-wrap gap-2">
        <div className="relative min-w-[220px] flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Rechercher (modèle, marque…)"
            className="w-full rounded-lg border border-gray-200 bg-white py-2.5 pl-9 pr-3 text-sm focus:border-gray-400 focus:outline-none"
          />
        </div>
        <select value={category} onChange={(e) => setCategory(e.target.value)} className={selectClass}>
          <option value="">Toutes les catégories</option>
          {categories.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
        <select value={brand} onChange={(e) => setBrand(e.target.value)} className={selectClass}>
          <option value="">Toutes les marques</option>
          {brands.map((b) => (
            <option key={b} value={b}>{b}</option>
          ))}
        </select>
        <select value={source} onChange={(e) => setSource(e.target.value as '' | 'auction' | 'drop')} className={selectClass}>
          <option value="">Drops et enchères</option>
          <option value="drop">Drops</option>
          <option value="auction">Enchères</option>
        </select>
        <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} className={selectClass}>
          <option value="recent">Plus récentes</option>
          <option value="oldest">Plus anciennes</option>
          <option value="price_desc">Prix décroissant</option>
          <option value="price_asc">Prix croissant</option>
        </select>
      </div>

      {error && <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}

      {loading ? (
        <p className="text-sm text-gray-500">Chargement…</p>
      ) : (
        <>
          <p className="text-xs text-gray-500">
            {filtered.length} vente{filtered.length > 1 ? 's' : ''}
          </p>
          {filtered.length === 0 ? (
            <p className="rounded-xl border border-gray-200 bg-white p-6 text-sm text-gray-500">Aucune vente ne correspond à votre recherche.</p>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
              {filtered.slice(0, shown).map((r) => (
                <div key={r.id} className="flex flex-col overflow-hidden rounded-xl border border-gray-200 bg-white">
                  <div className="relative aspect-square bg-gray-50">
                    {r.image ? (
                      <img src={r.image} alt={r.title || ''} loading="lazy" className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full items-center justify-center">
                        <Package className="h-8 w-8 text-gray-300" />
                      </div>
                    )}
                    <span
                      className={`absolute left-2 top-2 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium text-white ${
                        r.source === 'auction' ? 'bg-indigo-600' : 'bg-gray-900'
                      }`}
                    >
                      {r.source === 'auction' ? <Gavel className="h-3 w-3" /> : <Rocket className="h-3 w-3" />}
                      {r.source === 'auction' ? 'Enchère' : 'Drop'}
                    </span>
                  </div>
                  <div className="flex flex-1 flex-col gap-1 p-3 text-xs">
                    <div className="flex justify-between text-gray-500">
                      <span>Vendu le {DAY(r.sold_at)}</span>
                      {r.condition && <span>État {r.condition.replace(/^grade\s*/i, '')}</span>}
                    </div>
                    <p className="mt-1 text-center text-sm font-semibold uppercase tracking-[0.2em] text-gray-900">{r.brand || '—'}</p>
                    <p className="line-clamp-2 min-h-[2rem] text-center text-gray-600">{r.title}</p>
                    <div className="mt-auto grid grid-cols-2 border-t border-gray-100 pt-2">
                      <div>
                        <p className="text-[10px] uppercase text-gray-400">Prix de départ</p>
                        <p className="font-medium text-gray-700">{r.source === 'auction' && r.start_price != null ? EUR(r.start_price) : '—'}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-[10px] uppercase text-gray-400">Prix final</p>
                        <p className="text-sm font-semibold text-gray-900">{EUR(r.final_price)}</p>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
          {shown < filtered.length && (
            <div className="flex justify-center">
              <button
                type="button"
                onClick={() => setShown((n) => n + PAGE)}
                className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                Voir plus ({filtered.length - shown} restantes)
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default MarketResults;
