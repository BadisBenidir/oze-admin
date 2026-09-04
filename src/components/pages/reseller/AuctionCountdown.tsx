import React, { useEffect, useState } from 'react';

const useRemainingMs = (endsAt: string): number => {
  const [remaining, setRemaining] = useState(() => new Date(endsAt).getTime() - Date.now());

  useEffect(() => {
    setRemaining(new Date(endsAt).getTime() - Date.now());
    const id = setInterval(() => setRemaining(new Date(endsAt).getTime() - Date.now()), 1000);
    return () => clearInterval(id);
  }, [endsAt]);

  return Math.max(0, remaining);
};

/** Compte à rebours live (h:mm:ss) — recalculé chaque seconde depuis
 * `endsAt`, jamais depuis un compteur local qui dériverait. Passe en rouge
 * sous la minute (tension du "soft close" — voir handle_new_bid côté DB,
 * qui repousse ends_at de 5 min si une enchère arrive juste avant la fin). */
export const AuctionCountdown: React.FC<{ endsAt: string; className?: string }> = ({ endsAt, className = '' }) => {
  const ms = useRemainingMs(endsAt);
  const ended = ms <= 0;
  const totalSeconds = Math.floor(ms / 1000);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const urgent = !ended && totalSeconds < 60;

  return (
    <span className={`font-mono text-sm font-semibold tabular-nums ${ended ? 'text-gray-400' : urgent ? 'text-red-600' : 'text-gray-900'} ${className}`}>
      {ended ? 'Terminé' : `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`}
    </span>
  );
};

export default AuctionCountdown;
