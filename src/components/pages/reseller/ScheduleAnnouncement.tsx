import React, { useEffect, useState } from 'react';
import { CalendarClock, Gavel, Lock, Rocket } from 'lucide-react';

/**
 * Affiche d'annonce d'un événement programmé côté revendeur : prochain drop
 * (Catalogue) ou prochaine session d'enchères (Enchères). Date, compte à
 * rebours en direct, nombre de pièces, marques, puis une bande photo sur
 * toute la largeur : en tête les `revealedCount` premières photos, nettes
 * et en grand (pièces vitrine d'un drop, ou lots d'enchères déjà
 * consultables plus bas), suivies des autres, floutées (teaser du jour J).
 */

interface ScheduleAnnouncementProps {
  kind: 'drop' | 'auction';
  title?: string | null;
  startsAt: string;
  pieceCount: number;
  brands?: string[];
  /** Photos nettes d'abord, puis floutées (voir revealedCount). */
  images?: string[];
  /** Nombre de photos nettes en tête de `images`. Défaut : aucune pour un drop, toutes pour des enchères. */
  revealedCount?: number;
  /** Appelé une fois le compte à rebours terminé (ex. recharger le catalogue). */
  onStart?: () => void;
}

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
    days: Math.floor(diff / 86_400_000),
    hours: Math.floor((diff % 86_400_000) / 3_600_000),
    minutes: Math.floor((diff % 3_600_000) / 60_000),
    seconds: Math.floor((diff % 60_000) / 1000),
  };
};

export const ScheduleAnnouncement: React.FC<ScheduleAnnouncementProps> = ({
  kind, title, startsAt, pieceCount, brands = [], images = [], revealedCount, onStart,
}) => {
  const target = new Date(startsAt).getTime();
  const { done, days, hours, minutes, seconds } = useCountdown(target);

  useEffect(() => {
    if (done) onStart?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- une seule fois, au passage à 0
  }, [done]);

  const isDrop = kind === 'drop';
  const Icon = isDrop ? Rocket : Gavel;
  const eyebrow = isDrop ? 'Prochain drop' : 'Prochaine session d\'enchères';
  const date = new Date(startsAt);
  const dateLabel = date.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
  const timeLabel = date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }).replace(':', 'h');

  const netCount = Math.min(images.length, revealedCount ?? (isDrop ? 0 : images.length));
  const netImages = images.slice(0, netCount);
  const blurredImages = images.slice(netCount);

  const units = [
    { v: days, l: 'jours' },
    { v: hours, l: 'heures' },
    { v: minutes, l: 'min' },
    { v: seconds, l: 'sec' },
  ];

  return (
    <div className="relative mb-6 overflow-hidden rounded-2xl bg-[#f5f1ea] text-stone-900 ring-1 ring-stone-200">
      {/* Halo décoratif */}
      <div className="pointer-events-none absolute -left-24 -top-24 h-72 w-72 rounded-full bg-white/70 blur-3xl" />

      <div className="relative flex flex-col gap-5 p-5 sm:p-7 md:flex-row md:items-center">
        {/* Colonne gauche : annonce + chrono */}
        <div className="flex flex-shrink-0 flex-col justify-center">
          <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.25em] text-stone-500">
            <Icon className="h-3.5 w-3.5" /> {eyebrow}
          </div>
          <h3 className="mt-2 text-xl font-light tracking-tight sm:text-3xl">
            {title ? <span className="font-semibold">{title}</span> : null}
            {title ? ' · ' : ''}
            <span className="capitalize">{dateLabel}</span> à <span className="font-semibold">{timeLabel}</span>
          </h3>
          <p className="mt-1.5 flex flex-wrap items-center gap-x-2 text-xs text-stone-500 sm:text-sm">
            <CalendarClock className="h-4 w-4" />
            {pieceCount > 0 ? `${pieceCount} pièce${pieceCount > 1 ? 's' : ''}` : 'Pièces en préparation'}
            {brands.length > 0 && <span>· {brands.join(', ')}</span>}
          </p>

          {done ? (
            <p className="mt-4 inline-flex items-center self-start rounded-lg bg-stone-900 px-3 py-2 text-sm font-semibold text-white">
              {isDrop ? 'Le drop est en ligne !' : 'La session commence !'}
            </p>
          ) : (
            <div className="mt-4 flex gap-2 sm:gap-3">
              {units.map((u) => (
                <div key={u.l} className="min-w-[56px] rounded-xl bg-white px-2.5 py-2 text-center shadow-sm ring-1 ring-stone-200 sm:min-w-[68px]">
                  <p className="text-xl font-semibold tabular-nums sm:text-3xl">{pad(u.v)}</p>
                  <p className="text-[10px] uppercase tracking-wider text-stone-400">{u.l}</p>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Droite : grandes cases sur toute la hauteur — vitrine nette, puis
            le reste flouté et grisé, qui s'estompe vers le bord droit. */}
        {images.length > 0 && (
          <div className="relative min-w-0 flex-1">
            <div className="flex gap-2 overflow-hidden [mask-image:linear-gradient(to_right,black_75%,transparent)] sm:gap-3">
              {netImages.map((src, i) => (
                <div key={`net-${i}`} className="h-36 w-36 flex-shrink-0 overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-stone-200 sm:h-44 sm:w-44">
                  <img src={src} alt="" loading="lazy" className="h-full w-full object-cover" />
                </div>
              ))}
              {blurredImages.map((src, i) => (
                <div key={`blur-${i}`} className="relative h-36 w-36 flex-shrink-0 overflow-hidden rounded-xl bg-stone-200 ring-1 ring-stone-200 sm:h-44 sm:w-44">
                  <img src={src} alt="" loading="lazy" className="h-full w-full scale-110 object-cover opacity-60 blur-[8px] grayscale" />
                  {i === 0 && (
                    <div className="absolute inset-0 flex items-center justify-center">
                      <span className="flex items-center gap-1.5 rounded-full bg-white/80 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-stone-700 shadow-sm">
                        <Lock className="h-3.5 w-3.5" /> Révélé le jour J
                      </span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default ScheduleAnnouncement;
