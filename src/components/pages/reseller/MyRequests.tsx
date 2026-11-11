import React from 'react';
import { Bot, ChevronRight, LifeBuoy, Loader2 } from 'lucide-react';
import { Badge } from '../../ui/Badge';
import { useResellerAuth } from '../../../hooks/useResellerAuth';
import { useMySavTickets } from '../../../hooks/useMySavTickets';
import { SAV_CATEGORY, SAV_STATUS_CLIENT, formatSavDate } from '../../../lib/sav';

/**
 * Page « Mes demandes » (/mes-demandes) : suivi des demandes SAV. Pas de
 * formulaire de création : une demande s'ouvre uniquement par l'assistant
 * (chatbot), qui l'ouvre lui-même quand il le faut ou quand le client
 * demande à parler à un conseiller.
 */
export const MyRequests: React.FC<{ onOpen: (number: string) => void; onOpenAssistant: () => void }> = ({ onOpen, onOpenAssistant }) => {
  const { isReseller } = useResellerAuth();
  const { tickets, loading, error } = useMySavTickets(isReseller);

  return (
    <div className="mx-auto max-w-4xl space-y-5 p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Mes demandes</h1>
          <p className="text-sm text-gray-500">Suivez vos demandes d'assistance et échangez avec l'équipe OZË.</p>
        </div>
        <button
          onClick={onOpenAssistant}
          className="inline-flex items-center gap-1.5 rounded-lg bg-gray-900 px-3 py-2 text-sm font-medium text-white hover:bg-gray-800"
        >
          <Bot className="h-4 w-4" /> Contacter l'assistant
        </button>
      </div>

      {error && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}

      {loading ? (
        <div className="flex justify-center p-12 text-gray-400"><Loader2 className="h-6 w-6 animate-spin" /></div>
      ) : tickets.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-200 bg-white p-10 text-center">
          <LifeBuoy className="mx-auto h-8 w-8 text-gray-300" />
          <p className="mt-3 text-sm text-gray-600">Vous n'avez aucune demande en cours.</p>
          <p className="text-sm text-gray-500">
            Une question ? Posez-la à l'assistant : il vous répond tout de suite et transmet à un conseiller si nécessaire.
          </p>
        </div>
      ) : (
        <div className="divide-y divide-gray-100 overflow-hidden rounded-2xl border border-gray-200 bg-white">
          {tickets.map((t) => (
            <button key={t.id} onClick={() => onOpen(t.number)} className="flex w-full items-center gap-3 px-4 py-4 text-left hover:bg-gray-50">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-xs text-gray-500">{t.number}</span>
                  <Badge variant={SAV_STATUS_CLIENT[t.status].variant}>{SAV_STATUS_CLIENT[t.status].label}</Badge>
                  {t.has_new_reply && <span className="rounded-full bg-red-600 px-2 py-0.5 text-[11px] font-medium text-white">Nouvelle réponse</span>}
                </div>
                <div className="mt-1 truncate font-medium text-gray-900">{t.subject}</div>
                <div className="mt-0.5 text-xs text-gray-500">
                  {SAV_CATEGORY[t.category]}
                  {t.order_number ? ` · Commande ${t.order_number}` : ''} · créée le {formatSavDate(t.created_at, false)} · dernière activité {formatSavDate(t.last_activity_at)}
                </div>
              </div>
              <ChevronRight className="h-4 w-4 shrink-0 text-gray-300" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
