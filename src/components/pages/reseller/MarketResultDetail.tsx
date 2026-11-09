import React, { useEffect, useState } from 'react';
import { X, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Package } from 'lucide-react';
import { supabase } from '../../../lib/supabase';

export interface MarketResultRow {
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

interface Detail {
  images: string[];
  reference: string | null;
  description: string | null;
  defects: string | null;
  material: string | null;
  colors: unknown;
  genre: string | null;
  session: string | null;
}

const EUR = (n: number) => (Number(n) || 0).toLocaleString('fr-FR', { minimumFractionDigits: 0, maximumFractionDigits: 2 }) + ' €';
const DAY = (iso: string) => new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' });

const colorsText = (colors: unknown): string | null => {
  if (!Array.isArray(colors) || colors.length === 0) return null;
  return colors.map((c) => (typeof c === 'string' ? c : (c as { name?: string })?.name)).filter(Boolean).join(', ') || null;
};

interface Props {
  rows: MarketResultRow[];
  index: number;
  onIndexChange: (index: number) => void;
  onClose: () => void;
}

/**
 * Fiche d'une vente (façon « market price detail ») : galerie, état, prix de
 * départ / prix final, puis caractéristiques et remarques
 * (get_market_result_detail, 0250). Flèches pour passer à la vente
 * précédente / suivante de la liste filtrée.
 */
export const MarketResultDetail: React.FC<Props> = ({ rows, index, onIndexChange, onClose }) => {
  const row = rows[index];
  const [detail, setDetail] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(true);
  const [photo, setPhoto] = useState(0);

  useEffect(() => {
    if (!row) return;
    let cancelled = false;
    setLoading(true);
    setDetail(null);
    setPhoto(0);
    supabase.rpc('get_market_result_detail', { p_source: row.source, p_id: row.id }).then(({ data }) => {
      if (cancelled) return;
      setDetail((data as Detail) || null);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [row?.id, row?.source]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight' && index < rows.length - 1) onIndexChange(index + 1);
      if (e.key === 'ArrowLeft' && index > 0) onIndexChange(index - 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [index, rows.length, onClose, onIndexChange]);

  if (!row) return null;

  const images = (detail?.images?.length ? detail.images : row.image ? [row.image] : []).filter(Boolean);
  const current = images[Math.min(photo, Math.max(images.length - 1, 0))];
  const isAuction = row.source === 'auction';
  const condition = row.condition?.replace(/^grade\s*/i, '') || '—';
  const remarks = [detail?.description, detail?.defects].filter((t) => t && t.trim()).join('\n');

  const navButton = 'flex h-9 w-9 items-center justify-center rounded-md bg-gray-800 text-white hover:bg-gray-700 disabled:opacity-30';
  const infoRows: [string, React.ReactNode][] = [
    ['Date de vente', DAY(row.sold_at)],
    ...(isAuction && detail?.session ? [['Vente aux enchères', detail.session] as [string, React.ReactNode]] : []),
    ['Modèle', row.title || '—'],
    ['Marque', <span className="uppercase tracking-[0.2em]">{row.brand || '—'}</span>],
    ['Catégorie', row.category || '—'],
    ['Référence', detail?.reference || '—'],
    ...(detail?.material ? [['Matière', detail.material] as [string, React.ReactNode]] : []),
    ...(colorsText(detail?.colors) ? [['Couleurs', colorsText(detail?.colors)] as [string, React.ReactNode]] : []),
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-2 sm:p-6" onClick={onClose}>
      <div className="relative w-full max-w-6xl rounded-xl bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-t-xl bg-gray-100 px-4 py-2.5">
          <h3 className="text-base font-semibold text-gray-900">Détail de la vente</h3>
          <div className="flex items-center gap-1">
            <button type="button" onClick={() => onIndexChange(0)} disabled={index === 0} className={navButton} title="Première vente">
              <ChevronsLeft className="h-4 w-4" />
            </button>
            <button type="button" onClick={() => onIndexChange(index - 1)} disabled={index === 0} className={navButton} title="Vente précédente">
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="px-3 text-sm text-gray-700">
              {index + 1} / {rows.length}
            </span>
            <button type="button" onClick={() => onIndexChange(index + 1)} disabled={index >= rows.length - 1} className={navButton} title="Vente suivante">
              <ChevronRight className="h-4 w-4" />
            </button>
            <button type="button" onClick={() => onIndexChange(rows.length - 1)} disabled={index >= rows.length - 1} className={navButton} title="Dernière vente">
              <ChevronsRight className="h-4 w-4" />
            </button>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-gray-500 hover:bg-gray-200" title="Fermer">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="grid gap-5 p-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
          <div>
            <div className="relative aspect-square overflow-hidden rounded-lg bg-gray-50">
              {current ? (
                <img src={current} alt={row.title || ''} className="h-full w-full object-contain" />
              ) : (
                <div className="flex h-full items-center justify-center">
                  <Package className="h-10 w-10 text-gray-300" />
                </div>
              )}
              {images.length > 1 && (
                <>
                  <button
                    type="button"
                    onClick={() => setPhoto((p) => (p - 1 + images.length) % images.length)}
                    className="absolute left-0 top-1/2 flex h-14 w-11 -translate-y-1/2 items-center justify-center bg-gray-800/60 text-white hover:bg-gray-800/80"
                  >
                    <ChevronLeft className="h-6 w-6" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setPhoto((p) => (p + 1) % images.length)}
                    className="absolute right-0 top-1/2 flex h-14 w-11 -translate-y-1/2 items-center justify-center bg-gray-800/60 text-white hover:bg-gray-800/80"
                  >
                    <ChevronRight className="h-6 w-6" />
                  </button>
                </>
              )}
            </div>
            {images.length > 1 && (
              <div className="mt-2 grid max-h-48 grid-cols-6 gap-1 overflow-y-auto">
                {images.map((src, i) => (
                  <button
                    key={`${src}-${i}`}
                    type="button"
                    onClick={() => setPhoto(i)}
                    className={`aspect-square overflow-hidden rounded border-2 ${i === photo ? 'border-gray-900' : 'border-transparent'}`}
                  >
                    <img src={src} alt="" loading="lazy" className="h-full w-full object-cover" />
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="space-y-4">
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium text-white ${isAuction ? 'bg-indigo-600' : 'bg-gray-900'}`}
                >
                  {isAuction ? 'Enchère' : 'Drop'}
                </span>
                {row.category && <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-700">{row.category}</span>}
                <span className="rounded-full bg-green-50 px-3 py-1 text-xs font-medium text-green-700">Vendu le {DAY(row.sold_at)}</span>
              </div>
              <div className="grid grid-cols-3 divide-x divide-gray-200 rounded-xl border border-gray-200">
                <div className="px-4 py-3">
                  <p className="text-xs uppercase tracking-wide text-gray-500">État</p>
                  <p className="mt-1 text-2xl font-semibold text-gray-900">{condition}</p>
                </div>
                <div className="px-4 py-3">
                  <p className="text-xs uppercase tracking-wide text-gray-500">Prix de départ</p>
                  <p className="mt-1 text-2xl font-semibold text-gray-500">{isAuction && row.start_price != null ? EUR(row.start_price) : '—'}</p>
                </div>
                <div className="rounded-r-xl bg-gray-900 px-4 py-3 text-white">
                  <p className="text-xs uppercase tracking-wide text-gray-300">Prix final</p>
                  <p className="mt-1 text-2xl font-bold">{EUR(row.final_price)}</p>
                </div>
              </div>
            </div>

            <table className="w-full border-collapse text-sm">
              <tbody>
                {infoRows.map(([label, value]) => (
                  <tr key={label} className="border border-gray-200">
                    <th className="w-40 bg-gray-50 px-3 py-2 text-left font-medium text-gray-600">{label}</th>
                    <td className="px-3 py-2 text-gray-900">{value}</td>
                  </tr>
                ))}
                <tr className="border border-gray-200">
                  <th className="w-40 bg-gray-50 px-3 py-2 text-left align-top font-medium text-gray-600">Remarques</th>
                  <td className="whitespace-pre-line px-3 py-2 text-gray-900">{loading ? 'Chargement…' : remarks || '—'}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
};

export default MarketResultDetail;
