import React, { useEffect, useState } from 'react';
import { Eye } from 'lucide-react';

const useRemainingMs = (target: string): number => {
  const [remaining, setRemaining] = useState(() => new Date(target).getTime() - Date.now());

  useEffect(() => {
    setRemaining(new Date(target).getTime() - Date.now());
    const id = setInterval(() => setRemaining(new Date(target).getTime() - Date.now()), 1000);
    return () => clearInterval(id);
  }, [target]);

  return Math.max(0, remaining);
};

const formatCountdown = (ms: number): string => {
  const totalSeconds = Math.floor(ms / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (days > 0) return `${days} j ${hours} h`;
  if (hours > 0) return `${hours} h ${minutes} min`;
  if (minutes > 0) return `${minutes} min ${seconds} s`;
  return `${seconds} s`;
};

interface DropPreviewBadgeProps {
  scheduledAt: string;
  /** Rendu compact empilé pour la carte catalogue (grille étroite) — sinon
   * phrase complète pour la fiche détail. */
  compact?: boolean;
}

/** Remplace le bouton d'achat pour un article visible en avant-première
 * (drop planifié, voir migration 0129) : lecture seule tant que le cron
 * execute_due_drops (0031) n'a pas basculé le produit en for-sale-b2b — le
 * vrai verrou anti-achat vit côté DB (trigger cart_items_guard_purchasable),
 * ceci n'est qu'un affichage, jamais un contrôle d'accès. */
export const DropPreviewBadge: React.FC<DropPreviewBadgeProps> = ({ scheduledAt, compact = false }) => {
  const ms = useRemainingMs(scheduledAt);
  const dateLabel = new Date(scheduledAt).toLocaleString('fr-FR', {
    day: '2-digit',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  });

  if (compact) {
    return (
      <div className="w-full flex flex-col items-center justify-center gap-0.5 rounded-lg bg-gray-100 text-gray-500 px-2 py-2">
        <span className="flex items-center gap-1 text-[11px] font-medium">
          <Eye className="h-3 w-3" />
          Avant-première
        </span>
        <span className="text-[10px] text-gray-400">{ms > 0 ? `Dans ${formatCountdown(ms)}` : 'Ouverture imminente'}</span>
      </div>
    );
  }

  return (
    <div className="w-full flex items-center justify-center gap-2 rounded-lg bg-gray-100 text-gray-600 px-4 py-3 text-sm">
      <Eye className="h-4 w-4 flex-shrink-0" />
      <span>
        Avant-première — Drop le {dateLabel}
        {ms > 0 ? ` · dans ${formatCountdown(ms)}` : ' · ouverture imminente'}
      </span>
    </div>
  );
};

export default DropPreviewBadge;
