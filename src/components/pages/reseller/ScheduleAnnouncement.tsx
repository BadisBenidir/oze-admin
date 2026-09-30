import React, { useEffect, useState } from 'react';
import { CalendarClock, Gavel, Lock, Rocket } from 'lucide-react';

/**
 * Affiche d'annonce d'un événement programmé côté revendeur : prochain drop
 * (Catalogue) ou prochaine session d'enchères (Enchères). Date, compte à
 * rebours en direct, nombre de pièces, marques et aperçu photo — flouté pour
 * un drop (teaser, rien n'est encore achetable), net pour des enchères dont
 * les lots sont déjà consultables plus bas.
 */

interface ScheduleAnnouncementProps {
  kind: 'drop' | 'auction';
  title?: string | null;
  startsAt: string;
  pieceCount: number;
  brands?: string[];
  images?: string[];
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
  kind, title, startsAt, pieceCount, brands = [], images = [], onStart,
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
  const pics = images.slice(0, 4);

  const units = [
    { v: days, l: 'jours' },
    { v: hours, l: 'heures' },
    { v: minutes, l: 'min' },
    { v: seconds, l: 'sec' },
  ];

  return (
    <div className="relative mb-6 overflow-hidden rounded-2xl bg-neutral-950 text-white shadow-lg">
      {/* Halo décoratif */}
      <div className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-white/5 blur-3xl" />

      <div className="relative grid grid-cols-1 gap-5 p-5 sm:p-7 md:grid-cols-[1fr_auto] md:items-center">
        <div>
          <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.25em] text-white/60">
            <Icon className="h-3.5 w-3.5" /> {eyebrow}
          </div>
          <h3 className="mt-2 text-xl font-light tracking-tight sm:text-3xl">
            {title ? <span className="font-semibold">{title}</span> : null}
            {title ? ' · ' : ''}
            <span className="capitalize">{dateLabel}</span> à <span className="font-semibold">{timeLabel}</span>
          </h3>
          <p className="mt-1.5 flex flex-wrap items-center gap-x-2 text-xs text-white/60 sm:text-sm">
            <CalendarClock className="h-4 w-4" />
            {pieceCount > 0 ? `${pieceCount} pièce${pieceCount > 1 ? 's' : ''}` : 'Pièces en préparation'}
            {brands.length > 0 && <span>· {brands.join(', ')}</span>}
          </p>

          {done ? (
            <p className="mt-4 inline-flex items-center rounded-lg bg-white px-3 py-2 text-sm font-semibold text-black">
              {isDrop ? 'Le drop est en ligne !' : 'La session commence !'}
            </p>
          ) : (
            <div className="mt-4 flex gap-2 sm:gap-3">
              {units.map((u) => (
                <div key={u.l} className="min-w-[56px] rounded-xl bg-white/10 px-2.5 py-2 text-center ring-1 ring-white/10 sm:min-w-[68px]">
                  <p className="text-xl font-semibold tabular-nums sm:text-3xl">{pad(u.v)}</p>
                  <p className="text-[10px] uppercase tracking-wider text-white/50">{u.l}</p>
                </div>
              ))}
            </div>
          )}
        </div>

        {pics.length > 0 && (
          <div className="relative grid w-full grid-cols-4 gap-1.5 md:w-72 md:grid-cols-2">
            {pics.map((src, i) => (
              <div key={i} className="aspect-square overflow-hidden rounded-lg bg-white/10">
                <img
                  src={src}
                  alt=""
                  loading="lazy"
                  className={`h-full w-full object-cover ${isDrop ? 'scale-110 blur-[6px] brightness-90' : ''}`}
                />
              </div>
            ))}
            {isDrop && (
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="flex items-center gap-1.5 rounded-full bg-black/60 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider backdrop-blur-sm">
                  <Lock className="h-3.5 w-3.5" /> Révélé le jour J
                </span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default ScheduleAnnouncement;
