import React, { useEffect, useMemo, useState } from 'react';
import { Search, Gavel, Rocket, Package, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';
import { supabase } from '../../../lib/supabase';
import { MarketResultDetail } from './MarketResultDetail';
import { parseQuery, prepareText, smartMatch, PreparedText } from '../../../utils/smartSearch';

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

const PER_PAGE_OPTIONS = [20, 50, 100];
const EUR = (n: number) => (Number(n) || 0).toLocaleString('fr-FR', { minimumFractionDigits: 0, maximumFractionDigits: 2 }) + ' €';
const DAY = (iso: string) => new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });

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
  const [perPage, setPerPage] = useState(20);
  const [page, setPage] = useState(1);
  // Vente ouverte en fiche détaillée : index dans la liste filtrée.
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  useEffect(() => {
    supabase.rpc('get_market_results').then(({ data, error: rpcError }) => {
      if (rpcError) setError(rpcError.message);
      setRows(((data || []) as MarketResult[]).map((r) => ({ ...r, final_price: Number(r.final_price), start_price: r.start_price != null ? Number(r.start_price) : null })));
      setLoading(false);
    });
  }, []);

  const categories = useMemo(() => Array.from(new Set(rows.map((r) => r.category).filter(Boolean) as string[])).sort((a, b) => a.localeCompare(b)), [rows]);
  const brands = useMemo(() => Array.from(new Set(rows.map((r) => r.brand?.trim()).filter(Boolean) as string[])).sort((a, b) => a.localeCompare(b)), [rows]);

  // Texte de recherche préparé une fois par vente (recherche intelligente, smartSearch).
  const searchIndex = useMemo(
    () => new Map(rows.map((r) => [r.id, prepareText(`${r.title || ''} ${r.brand || ''} ${r.category || ''} ${r.condition || ''}`)])),
    [rows]
  );

  const filtered = useMemo(() => {
    const units = parseQuery(query);
    const list = rows.filter(
      (r) =>
        (!category || r.category === category) &&
        (!brand || r.brand?.trim() === brand) &&
        (!source || r.source === source) &&
        (units.length === 0 || smartMatch(units, searchIndex.get(r.id) as PreparedText))
    );
    const byDate = (a: MarketResult, b: MarketResult) => new Date(b.sold_at).getTime() - new Date(a.sold_at).getTime();
    list.sort((a, b) =>
      sort === 'recent' ? byDate(a, b) : sort === 'oldest' ? -byDate(a, b) : sort === 'price_desc' ? b.final_price - a.final_price : a.final_price - b.final_price
    );
    return list;
  }, [rows, searchIndex, query, category, brand, source, sort]);

  useEffect(() => setPage(1), [query, category, brand, source, sort, perPage]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / perPage));
  const current = Math.min(page, pageCount);
  const pageRows = filtered.slice((current - 1) * perPage, current * perPage);
  const goTo = (n: number) => {
    setPage(Math.min(Math.max(n, 1), pageCount));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const navButton = 'flex h-10 w-10 items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40';
  const pager = (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-sm text-gray-500">
        {filtered.length} vente{filtered.length > 1 ? 's' : ''}
        {filtered.length > 0 && ` · ${(current - 1) * perPage + 1}–${Math.min(current * perPage, filtered.length)}`}
      </p>
      <div className="flex items-center gap-1.5">
        <button type="button" onClick={() => goTo(1)} disabled={current === 1} title="Première page" className={navButton}>
          <ChevronsLeft className="h-4 w-4" />
        </button>
        <button type="button" onClick={() => goTo(current - 1)} disabled={current === 1} title="Page précédente" className={navButton}>
          <ChevronLeft className="h-4 w-4" />
        </button>
        <span className="px-3 text-sm text-gray-700">
          Page <strong>{current}</strong> / {pageCount}
        </span>
        <button type="button" onClick={() => goTo(current + 1)} disabled={current === pageCount} title="Page suivante" className={navButton}>
          <ChevronRight className="h-4 w-4" />
        </button>
        <button type="button" onClick={() => goTo(pageCount)} disabled={current === pageCount} title="Dernière page" className={navButton}>
          <ChevronsRight className="h-4 w-4" />
        </button>
      </div>
      <label className="flex items-center gap-2 text-sm text-gray-600">
        Afficher
        <select value={perPage} onChange={(e) => setPerPage(Number(e.target.value))} className="rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-sm focus:border-gray-400 focus:outline-none">
          {PER_PAGE_OPTIONS.map((n) => (
            <option key={n} value={n}>{n}</option>
          ))}
        </select>
        par page
      </label>
    </div>
  );

  const selectClass = 'rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-700 focus:border-gray-400 focus:outline-none';

  return (
    <div className="mx-auto max-w-[1600px] space-y-5 p-4 md:p-6">
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
          {pager}
          {filtered.length === 0 ? (
            <p className="rounded-xl border border-gray-200 bg-white p-6 text-sm text-gray-500">Aucune vente ne correspond à votre recherche.</p>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
              {pageRows.map((r, i) => (
                <div
                  key={r.id}
                  onClick={() => setOpenIndex((current - 1) * perPage + i)}
                  className="flex cursor-pointer flex-col overflow-hidden rounded-xl border border-gray-200 bg-white transition-shadow hover:shadow-md"
                >
                  <div className="relative aspect-square bg-gray-50">
                    {r.image ? (
                      <img src={r.image} alt={r.title || ''} loading="lazy" className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full items-center justify-center">
                        <Package className="h-8 w-8 text-gray-300" />
                      </div>
                    )}
                    <span
                      className={`absolute left-2 top-2 inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium text-white ${
                        r.source === 'auction' ? 'bg-indigo-600' : 'bg-gray-900'
                      }`}
                    >
                      {r.source === 'auction' ? <Gavel className="h-3 w-3" /> : <Rocket className="h-3 w-3" />}
                      {r.source === 'auction' ? 'Enchère' : 'Drop'}
                    </span>
                  </div>
                  <div className="flex flex-1 flex-col gap-1.5 p-4 text-sm">
                    <div className="flex justify-between text-gray-500">
                      <span>Vendu le {DAY(r.sold_at)}</span>
                      {r.condition && <span>État {r.condition.replace(/^grade\s*/i, '')}</span>}
                    </div>
                    <p className="mt-1 text-center text-base font-semibold uppercase tracking-[0.2em] text-gray-900">{r.brand || '—'}</p>
                    <p className="line-clamp-2 min-h-[2.5rem] text-center text-gray-600">{r.title}</p>
                    <div className="mt-auto grid grid-cols-2 border-t border-gray-100 pt-2">
                      <div>
                        <p className="text-xs uppercase text-gray-400">Prix de départ</p>
                        <p className="text-base font-medium text-gray-700">{r.source === 'auction' && r.start_price != null ? EUR(r.start_price) : '—'}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-xs uppercase text-gray-400">Prix final</p>
                        <p className="text-lg font-semibold text-gray-900">{EUR(r.final_price)}</p>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
          {filtered.length > 0 && pager}
          {openIndex !== null && (
            <MarketResultDetail rows={filtered} index={openIndex} onIndexChange={setOpenIndex} onClose={() => setOpenIndex(null)} />
          )}
        </>
      )}
    </div>
  );
};

export default MarketResults;
