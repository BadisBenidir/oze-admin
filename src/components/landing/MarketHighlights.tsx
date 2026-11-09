import React, { useEffect, useState } from 'react';
import { ArrowRight, Gavel, Rocket } from 'lucide-react';
import { supabase } from '../../lib/supabase';

interface Sale {
  id: string;
  source: 'auction' | 'drop';
  title: string | null;
  brand: string | null;
  condition: string | null;
  image: string | null;
  start_price: number | null;
  final_price: number;
  sold_at: string;
}

const EUR = (n: number) => (Number(n) || 0).toLocaleString('fr-FR', { maximumFractionDigits: 0 }) + ' €';
const DAY = (iso: string) => new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
// Page publique de toutes les ventes, sur le domaine de la landing (voir App.tsx).
const RESULTS_URL = '/ventes';

/**
 * Landing : « Ventes récentes » — les dernières pièces vendues en drop et aux
 * enchères (get_public_market_highlights, 0251, public), pour inviter à
 * rejoindre le Club et consulter l'historique complet (Résultats de ventes).
 */
export const MarketHighlights: React.FC<{ onJoin: () => void }> = ({ onJoin }) => {
  const [sales, setSales] = useState<Sale[]>([]);
  const [total, setTotal] = useState<number | null>(null);

  useEffect(() => {
    supabase.rpc('get_public_market_highlights', { p_limit: 8 }).then(({ data }) => {
      const payload = data as { total?: number; items?: Sale[] } | null;
      setSales(payload?.items || []);
      setTotal(payload?.total ?? null);
    });
  }, []);

  if (sales.length === 0) return null;

  return (
    <section id="ventes" className="scroll-mt-20 bg-neutral-50 py-12 sm:py-24">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="text-center">
          <p className="text-[11px] font-medium uppercase tracking-[0.25em] text-gray-500 sm:text-xs">Dernières ventes</p>
          <h2 className="mt-2 text-xl font-light tracking-tight sm:mt-3 sm:text-4xl">
            Les dernières pièces vendues <span className="font-semibold">sur la plateforme</span>
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-sm leading-relaxed text-gray-600 sm:text-base">
            Les {sales.length} ventes les plus récentes, mises à jour en continu. {total ? `${total} pièces déjà vendues` : 'Des centaines de pièces vendues'} en
            drop et aux enchères : retrouvez-les toutes avec prix de départ, prix final, état et photos.
          </p>
        </div>

        <div className="mt-8 grid grid-cols-2 gap-3 sm:mt-12 sm:gap-4 md:grid-cols-4">
          {sales.map((s) => (
            <div key={s.id} className="flex flex-col overflow-hidden rounded-xl border border-gray-200 bg-white">
              <div className="relative aspect-square bg-gray-50">
                {s.image && <img src={s.image} alt={s.title || ''} loading="lazy" className="h-full w-full object-cover" />}
                <span
                  className={`absolute left-2 top-2 inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium text-white ${
                    s.source === 'auction' ? 'bg-indigo-600' : 'bg-gray-900'
                  }`}
                >
                  {s.source === 'auction' ? <Gavel className="h-3 w-3" /> : <Rocket className="h-3 w-3" />}
                  {s.source === 'auction' ? 'Enchère' : 'Drop'}
                </span>
              </div>
              <div className="flex flex-1 flex-col gap-1 p-3 text-xs sm:p-4">
                <div className="flex justify-between text-gray-500">
                  <span>Vendu le {DAY(s.sold_at)}</span>
                  {s.condition && <span>État {s.condition.replace(/^grade\s*/i, '')}</span>}
                </div>
                <p className="mt-1 text-center text-sm font-semibold uppercase tracking-[0.2em] text-gray-900">{s.brand || '—'}</p>
                <p className="line-clamp-2 min-h-[2rem] text-center text-gray-600">{s.title}</p>
                <div className="mt-auto grid grid-cols-2 border-t border-gray-100 pt-2">
                  <div>
                    <p className="text-[10px] uppercase text-gray-400">Prix de départ</p>
                    <p className="font-medium text-gray-700">{s.source === 'auction' && s.start_price != null ? EUR(s.start_price) : '—'}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-[10px] uppercase text-gray-400">Prix final</p>
                    <p className="text-base font-semibold text-gray-900">{EUR(s.final_price)}</p>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-8 flex flex-col items-center gap-3 sm:mt-10">
          <a
            href={RESULTS_URL}
            className="inline-flex items-center gap-2 rounded-xl bg-black px-7 py-3.5 text-sm font-semibold text-white transition-colors hover:bg-gray-800"
          >
            Voir toutes les ventes <ArrowRight className="h-4 w-4" />
          </a>
          <button onClick={onJoin} className="text-sm text-gray-600 underline underline-offset-4 hover:text-gray-900">
            Rejoindre le Club
          </button>
        </div>
      </div>
    </section>
  );
};

export default MarketHighlights;
