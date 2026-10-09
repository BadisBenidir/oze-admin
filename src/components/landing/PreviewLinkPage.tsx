import React, { useEffect, useState } from 'react';
import { Gavel, Rocket, ImageOff, LogIn, Lock } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { ImageLightbox } from '../ui/ImageLightbox';
import { isGrade } from '../../utils/productGrade';
import logo from './assets/logo_oze_paris_b2b.png';

/**
 * Page publique d'avant-première (/avant-premiere/<token>) : lien posté sur
 * Discord par un admin (voir PreviewLinksModal). Montre, sans compte, les
 * pièces choisies d'un drop planifié ou d'une session d'enchères, un compte
 * à rebours et les boutons de connexion / d'inscription. Données servies
 * par get_preview_link (0169) — rien d'autre n'est accessible via le lien.
 */

interface PreviewItem {
  id: string;
  name: string;
  brand: string | null;
  condition: string | null;
  images: string[];
  main_image_index: number;
  price: number | null;
  sold: boolean;
}

interface PreviewData {
  status: 'ok';
  kind: 'drop' | 'auction';
  label: string | null;
  title: string | null;
  starts_at: string;
  ends_at: string | null;
  event_status: string;
  show_prices: boolean;
  total_count: number;
  items: PreviewItem[];
}

// Connexion et inscription toujours sur les domaines revendeurs, même si la
// page est ouverte ailleurs (preview Vercel, localhost).
const PRO_ORIGIN = window.location.hostname.startsWith('pro.') ? '' : 'https://pro.ozeparis.com';
const SIGNUP_URL = 'https://b2b.ozeparis.com';

const EUR = (n: number) => n.toLocaleString('fr-FR', { minimumFractionDigits: 0, maximumFractionDigits: 2 }) + ' €';
const pad = (n: number) => String(n).padStart(2, '0');

const useCountdown = (target: number) => {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const diff = Math.max(0, target - now);
  return {
    done: diff === 0,
    units: [
      { v: Math.floor(diff / 86_400_000), l: 'jours' },
      { v: Math.floor((diff % 86_400_000) / 3_600_000), l: 'heures' },
      { v: Math.floor((diff % 3_600_000) / 60_000), l: 'min' },
      { v: Math.floor((diff % 60_000) / 1000), l: 'sec' },
    ],
  };
};

const mainImage = (item: PreviewItem): string | null =>
  item.images[item.main_image_index] || item.images[0] || null;

export const getPreviewToken = (): string | null => {
  const match = window.location.pathname.match(/^\/avant-premiere\/([A-Za-z0-9]+)\/?$/);
  return match ? match[1] : null;
};

const Shell: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="min-h-screen bg-neutral-50">
    <header className="border-b border-neutral-200 bg-white">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
        <a href={SIGNUP_URL}>
          <img src={logo} alt="OZË Paris — B2B Solutions" className="h-8 w-auto sm:h-9" />
        </a>
        <a
          href={`${PRO_ORIGIN}/connexion`}
          className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-300 px-3 py-1.5 text-sm font-medium text-neutral-800 hover:bg-neutral-100"
        >
          <LogIn className="h-4 w-4" /> Connexion
        </a>
      </div>
    </header>
    {children}
  </div>
);

export const PreviewLinkPage: React.FC = () => {
  const token = getPreviewToken();
  const [data, setData] = useState<PreviewData | null>(null);
  const [state, setState] = useState<'loading' | 'ok' | 'invalid' | 'error'>('loading');
  // Seule la photo principale de chaque pièce est montrée (zoom compris) : les autres restent réservées aux revendeurs connectés.
  const [lightbox, setLightbox] = useState<{ src: string; alt: string } | null>(null);

  useEffect(() => {
    if (!token) {
      setState('invalid');
      return;
    }
    supabase.rpc('get_preview_link', { p_token: token }).then(({ data: result, error }) => {
      if (error) {
        console.error('Aperçu indisponible:', error);
        setState('error');
        return;
      }
      if (!result || result.status !== 'ok') {
        setState('invalid');
        return;
      }
      setData(result as PreviewData);
      setState('ok');
    });
  }, [token]);

  useEffect(() => {
    if (data) {
      document.title = `Avant-première · ${data.title || (data.kind === 'drop' ? 'Prochain drop' : 'Enchères')} — OZË Paris`;
    }
  }, [data]);

  const startsAt = data ? new Date(data.starts_at).getTime() : 0;
  const { done, units } = useCountdown(startsAt);

  if (state === 'loading') {
    return (
      <Shell>
        <div className="flex justify-center py-24">
          <div className="h-10 w-10 animate-spin rounded-full border-4 border-neutral-900 border-t-transparent" />
        </div>
      </Shell>
    );
  }

  if (state !== 'ok' || !data) {
    return (
      <Shell>
        <div className="mx-auto max-w-md px-4 py-24 text-center">
          <Lock className="mx-auto mb-4 h-10 w-10 text-neutral-300" />
          <h1 className="text-lg font-semibold text-neutral-900">
            {state === 'error' ? 'Aperçu momentanément indisponible' : 'Ce lien n\'est plus actif'}
          </h1>
          <p className="mt-2 text-sm text-neutral-500">
            {state === 'error'
              ? 'Réessaie dans quelques instants.'
              : 'L\'avant-première est terminée ou le lien a été désactivé. Connecte-toi pour voir le catalogue.'}
          </p>
          <a
            href={`${PRO_ORIGIN}/connexion`}
            className="mt-6 inline-flex items-center gap-2 rounded-lg bg-neutral-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-neutral-800"
          >
            <LogIn className="h-4 w-4" /> Se connecter
          </a>
        </div>
      </Shell>
    );
  }

  const isDrop = data.kind === 'drop';
  const Icon = isDrop ? Rocket : Gavel;
  const started = done || data.event_status === 'publie' || data.event_status === 'live' || data.event_status === 'closed';
  const ended = data.event_status === 'closed';
  const date = new Date(data.starts_at);
  const dateLabel = date.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
  const timeLabel = date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }).replace(':', 'h');
  const nextPath = isDrop ? '/catalogue' : '/encheres';
  const loginUrl = `${PRO_ORIGIN}/connexion?next=${encodeURIComponent(nextPath)}`;
  const hiddenCount = Math.max(0, data.total_count - data.items.length);

  return (
    <Shell>
      <section className="bg-neutral-950 text-white">
        <div className="mx-auto max-w-6xl px-4 py-8 sm:py-12">
          <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.25em] text-white/60">
            <Icon className="h-3.5 w-3.5" />
            {started ? 'Aperçu' : 'Avant-première'} · {isDrop ? 'Drop' : 'Session d\'enchères'}
          </div>
          <h1 className="mt-2 text-2xl font-light tracking-tight sm:text-4xl">
            {data.title ? <span className="font-semibold">{data.title}</span> : null}
            {data.title ? ' · ' : ''}
            <span className="capitalize">{dateLabel}</span> à <span className="font-semibold">{timeLabel}</span>
          </h1>
          <p className="mt-2 text-sm text-white/60">
            {hiddenCount === 0 && 'Aperçu · '}
            {data.total_count} pièce{data.total_count > 1 ? 's' : ''}
            {hiddenCount > 0 && ` · ${data.items.length} dévoilée${data.items.length > 1 ? 's' : ''} ici, ${hiddenCount} surprise${hiddenCount > 1 ? 's' : ''} le jour J`}
            {data.label && ` · ${data.label}`}
          </p>

          {started ? (
            <p className="mt-5 inline-flex items-center rounded-lg bg-white px-3 py-2 text-sm font-semibold text-black">
              {ended ? 'Cette session est terminée' : isDrop ? 'Le drop est en ligne !' : 'Les enchères sont ouvertes !'}
            </p>
          ) : (
            <div className="mt-5 flex gap-2 sm:gap-3">
              {units.map((u) => (
                <div key={u.l} className="min-w-[60px] rounded-xl bg-white/10 px-2.5 py-2 text-center ring-1 ring-white/10 sm:min-w-[72px]">
                  <p className="text-2xl font-semibold tabular-nums sm:text-3xl">{pad(u.v)}</p>
                  <p className="text-[10px] uppercase tracking-wider text-white/50">{u.l}</p>
                </div>
              ))}
            </div>
          )}

          <div className="mt-6 flex flex-wrap gap-3">
            <a
              href={loginUrl}
              className="inline-flex items-center gap-2 rounded-lg bg-white px-4 py-2.5 text-sm font-semibold text-black hover:bg-neutral-200"
            >
              <LogIn className="h-4 w-4" />
              {isDrop ? 'Se connecter pour acheter' : 'Se connecter pour enchérir'}
            </a>
            <a
              href={SIGNUP_URL}
              className="inline-flex items-center rounded-lg px-4 py-2.5 text-sm font-semibold text-white ring-1 ring-white/30 hover:bg-white/10"
            >
              Pas encore revendeur ? Rejoindre OZË
            </a>
          </div>
        </div>
      </section>

      <main className="mx-auto max-w-6xl px-4 py-8">
        {data.items.length === 0 ? (
          <p className="py-12 text-center text-sm text-neutral-500">Les pièces seront dévoilées très bientôt.</p>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4">
            {data.items.map((item) => {
              const img = mainImage(item);
              return (
                <button
                  key={item.id}
                  type="button"
                  disabled={!img}
                  onClick={() => img && setLightbox({ src: img, alt: item.name })}
                  className="group overflow-hidden rounded-xl bg-white text-left shadow-sm ring-1 ring-neutral-200 transition hover:shadow-md"
                >
                  <div className="relative aspect-square bg-neutral-100">
                    {img ? (
                      <img src={img} alt={item.name} loading="lazy" className="h-full w-full object-cover transition group-hover:scale-[1.02]" />
                    ) : (
                      <div className="flex h-full items-center justify-center">
                        <ImageOff className="h-6 w-6 text-neutral-300" />
                      </div>
                    )}
                    {item.condition && (
                      <span className="absolute left-2 top-2 rounded-md bg-white/90 px-1.5 py-0.5 text-[11px] font-semibold text-neutral-900">
                        {isGrade(item.condition) ? `État ${item.condition}` : item.condition}
                      </span>
                    )}
                  </div>
                  <div className="p-3">
                    {item.brand && <p className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500">{item.brand}</p>}
                    <p className="mt-0.5 line-clamp-2 text-sm text-neutral-900">{item.name}</p>
                    {data.show_prices && item.price != null && (
                      <p className="mt-1 text-sm font-semibold text-neutral-900">
                        {isDrop ? EUR(Number(item.price)) : `Départ ${EUR(Number(item.price))}`}
                      </p>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        )}

        {hiddenCount > 0 && (
          <div className="mt-6 rounded-xl border border-dashed border-neutral-300 p-5 text-center">
            <Lock className="mx-auto mb-2 h-5 w-5 text-neutral-400" />
            <p className="text-sm text-neutral-600">
              + {hiddenCount} autre{hiddenCount > 1 ? 's' : ''} pièce{hiddenCount > 1 ? 's' : ''} révélée{hiddenCount > 1 ? 's' : ''} {isDrop ? 'au lancement du drop' : 'à l\'ouverture des enchères'}
            </p>
          </div>
        )}
      </main>

      {lightbox && (
        <ImageLightbox
          images={[lightbox.src]}
          index={0}
          onIndexChange={() => undefined}
          onClose={() => setLightbox(null)}
          alt={lightbox.alt}
        />
      )}
    </Shell>
  );
};

export default PreviewLinkPage;
