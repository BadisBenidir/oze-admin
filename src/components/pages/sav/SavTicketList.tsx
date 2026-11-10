import React, { useMemo, useState } from 'react';
import { AlertTriangle, Clock, Inbox, LifeBuoy, RefreshCw, Scale, Search, MessageCircle, Bot, Mail } from 'lucide-react';
import { Badge } from '../../ui/Badge';
import { SavAdminTicket, useSavAssignees, useSavCounters, useSavTickets } from '../../../hooks/useSavAdmin';
import {
  SAV_CATEGORY,
  SAV_DECISION,
  SAV_PRIORITY,
  SAV_STATUS,
  SavCategory,
  SavPriority,
  SavStatus,
  formatSavDate,
} from '../../../lib/sav';

type SortKey = 'activity' | 'created' | 'priority';
const PRIORITY_RANK: Record<SavPriority, number> = { urgent: 0, high: 1, normal: 2, low: 3 };
const DISPUTE_CATEGORIES: SavCategory[] = ['authenticity', 'return_refund', 'parcel_damaged_lost'];

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const EUR = (n: number | null) => (n == null ? '—' : `${Number(n).toLocaleString('fr-FR', { maximumFractionDigits: 2 })} €`);
const lastActivity = (t: SavAdminTicket) =>
  [t.created_at, t.last_client_message_at, t.last_team_message_at, t.updated_at].filter(Boolean).sort().pop()!;

const selectCls =
  'h-9 rounded-lg border border-gray-200 bg-white px-2.5 text-sm text-gray-700 focus:border-gray-400 focus:outline-none';

/**
 * Liste des tickets SAV (sous-onglet « Tickets ») ou vue « Litiges »
 * (is_dispute) avec montant / décision.
 */
export const SavTicketList: React.FC<{ disputes?: boolean; onOpen: (id: string) => void }> = ({ disputes = false, onOpen }) => {
  const { tickets, loading, error, refresh } = useSavTickets();
  const { counters, refresh: refreshCounters } = useSavCounters();
  const assignees = useSavAssignees();
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<'' | 'open' | SavStatus>(disputes ? '' : 'open');
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [category, setCategory] = useState<'' | SavCategory>('');
  const [priority, setPriority] = useState<'' | SavPriority>('');
  const [assignee, setAssignee] = useState<'' | 'none' | string>('');
  const [decision, setDecision] = useState<'' | 'pending' | 'accepted' | 'refused' | 'partial'>('');
  const [sort, setSort] = useState<SortKey>('activity');

  const filtered = useMemo(() => {
    const q = norm(query.trim());
    const rows = tickets.filter((t) => {
      if (disputes && !t.is_dispute) return false;
      if (unreadOnly && !t.unread) return false;
      if (status === 'open' ? ['resolved', 'closed'].includes(t.status) : status && t.status !== status) return false;
      if (category && t.category !== category) return false;
      if (priority && t.priority !== priority) return false;
      if (assignee === 'none' ? t.assigned_to : assignee && t.assigned_to !== assignee) return false;
      if (disputes && decision) {
        if (decision === 'pending' ? t.dispute_decision : t.dispute_decision !== decision) return false;
      }
      if (q) {
        const hay = norm([t.number, t.subject, t.company_name, t.client_name, t.client_email, t.order_number].filter(Boolean).join(' '));
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    return rows.sort((a, b) => {
      if (sort === 'created') return b.created_at.localeCompare(a.created_at);
      if (sort === 'priority') return PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || lastActivity(b).localeCompare(lastActivity(a));
      return lastActivity(b).localeCompare(lastActivity(a));
    });
  }, [tickets, disputes, unreadOnly, status, category, priority, assignee, decision, query, sort]);

  const disputeTotals = useMemo(() => {
    if (!disputes) return null;
    const sum = (list: SavAdminTicket[]) => list.reduce((s, t) => s + Number(t.dispute_amount || 0), 0);
    return {
      all: sum(filtered),
      accepted: sum(filtered.filter((t) => t.dispute_decision === 'accepted' || t.dispute_decision === 'partial')),
    };
  }, [disputes, filtered]);

  const counterCards = [
    {
      label: 'Messages non lus',
      value: counters?.unread_count,
      icon: Mail,
      onClick: () => {
        setUnreadOnly((v) => !v);
        setStatus('');
      },
      tone: 'text-red-600',
    },
    { label: 'Ouverts', value: counters?.open_count, icon: Inbox, onClick: () => setStatus('open'), tone: 'text-gray-900' },
    { label: 'En attente client', value: counters?.waiting_client_count, icon: Clock, onClick: () => setStatus('waiting_client'), tone: 'text-amber-600' },
    { label: 'Urgents', value: counters?.urgent_count, icon: AlertTriangle, onClick: () => { setStatus('open'); setPriority('urgent'); }, tone: 'text-red-600' },
    { label: 'Litiges en cours', value: counters?.disputes_open_count, icon: Scale, onClick: undefined, tone: 'text-purple-600' },
  ];

  return (
    <div className="mx-auto max-w-[1400px] space-y-5 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gray-900 text-white">
            {disputes ? <Scale className="h-5 w-5" /> : <LifeBuoy className="h-5 w-5" />}
          </div>
          <div>
            <h1 className="text-xl font-semibold text-gray-900">{disputes ? 'Litiges' : 'Tickets SAV'}</h1>
            <p className="text-sm text-gray-500">
              {disputes
                ? 'Authenticité, retours, remboursements et colis : montant concerné et décision.'
                : 'Demandes des revendeurs, ouvertes par le chatbot ou depuis « Mes demandes ».'}
            </p>
          </div>
        </div>
        <button
          onClick={() => {
            refresh();
            refreshCounters();
          }}
          className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> Actualiser
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        {counterCards.map((c) => (
          <button
            key={c.label}
            onClick={c.onClick}
            disabled={!c.onClick || disputes}
            className={`flex items-center gap-3 rounded-xl border bg-white p-4 text-left transition-colors enabled:hover:border-gray-300 ${
              c.label === 'Messages non lus' && unreadOnly ? 'border-red-300 ring-2 ring-red-100' : 'border-gray-200'
            }`}
          >
            <c.icon className={`h-5 w-5 ${c.tone}`} />
            <div>
              <div className={`text-2xl font-semibold ${c.tone}`}>{c.value ?? '—'}</div>
              <div className="text-xs text-gray-500">{c.label}</div>
            </div>
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-gray-200 bg-white p-3">
        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="N° ticket, client, n° commande, sujet…"
            className="h-9 w-full rounded-lg border border-gray-200 pl-9 pr-3 text-sm focus:border-gray-400 focus:outline-none"
          />
        </div>
        <select value={status} onChange={(e) => setStatus(e.target.value as typeof status)} className={selectCls}>
          <option value="">Tous les statuts</option>
          <option value="open">Non résolus</option>
          {(Object.keys(SAV_STATUS) as SavStatus[]).map((s) => (
            <option key={s} value={s}>{SAV_STATUS[s].label}</option>
          ))}
        </select>
        <select value={category} onChange={(e) => setCategory(e.target.value as typeof category)} className={selectCls}>
          <option value="">Toutes les catégories</option>
          {(Object.keys(SAV_CATEGORY) as SavCategory[])
            .filter((c) => !disputes || DISPUTE_CATEGORIES.includes(c) || c === 'other')
            .map((c) => (
              <option key={c} value={c}>{SAV_CATEGORY[c]}</option>
            ))}
        </select>
        <select value={priority} onChange={(e) => setPriority(e.target.value as typeof priority)} className={selectCls}>
          <option value="">Toutes priorités</option>
          {(Object.keys(SAV_PRIORITY) as SavPriority[]).map((p) => (
            <option key={p} value={p}>{SAV_PRIORITY[p].label}</option>
          ))}
        </select>
        <select value={assignee} onChange={(e) => setAssignee(e.target.value)} className={selectCls}>
          <option value="">Tous les assignés</option>
          <option value="none">Non assigné</option>
          {assignees.map((a) => (
            <option key={a.id} value={a.id}>{a.name}</option>
          ))}
        </select>
        {disputes && (
          <select value={decision} onChange={(e) => setDecision(e.target.value as typeof decision)} className={selectCls}>
            <option value="">Toutes décisions</option>
            <option value="pending">Sans décision</option>
            <option value="accepted">Accepté</option>
            <option value="partial">Partiel</option>
            <option value="refused">Refusé</option>
          </select>
        )}
        <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} className={selectCls}>
          <option value="activity">Dernière activité</option>
          <option value="created">Date de création</option>
          <option value="priority">Priorité</option>
        </select>
      </div>

      {disputeTotals && (
        <div className="flex flex-wrap gap-4 text-sm text-gray-600">
          <span>Montant concerné : <strong className="text-gray-900">{EUR(disputeTotals.all)}</strong></span>
          <span>Dont accepté / partiel : <strong className="text-gray-900">{EUR(disputeTotals.accepted)}</strong></span>
        </div>
      )}

      {error && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}

      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-100 text-sm">
            <thead className="bg-gray-50 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-4 py-3">Ticket</th>
                <th className="px-4 py-3">Client</th>
                <th className="px-4 py-3">Catégorie</th>
                <th className="px-4 py-3">Statut</th>
                <th className="px-4 py-3">Priorité</th>
                {disputes ? (
                  <>
                    <th className="px-4 py-3">Montant</th>
                    <th className="px-4 py-3">Décision</th>
                  </>
                ) : (
                  <th className="px-4 py-3">Assigné</th>
                )}
                <th className="px-4 py-3">Activité</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading && tickets.length === 0 ? (
                <tr><td colSpan={8} className="px-4 py-10 text-center text-gray-400">Chargement…</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={8} className="px-4 py-10 text-center text-gray-400">Aucun ticket.</td></tr>
              ) : (
                filtered.map((t) => (
                  <tr key={t.id} onClick={() => onOpen(t.id)} className={`cursor-pointer ${t.unread ? 'bg-red-50/40 hover:bg-red-50' : 'hover:bg-gray-50'}`}>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs text-gray-500">{t.number}</span>
                        {t.source === 'chatbot' ? (
                          <Bot className="h-3.5 w-3.5 text-gray-400" aria-label="Ouvert par le chatbot" />
                        ) : (
                          <MessageCircle className="h-3.5 w-3.5 text-gray-300" aria-label="Formulaire" />
                        )}
                      </div>
                      <div className="mt-0.5 flex items-center gap-2">
                        {t.unread && (
                          <span className="shrink-0 rounded-full bg-red-600 px-2 py-0.5 text-[10px] font-semibold text-white">
                            {t.last_client_message_at && t.last_team_read_at ? 'Nouveau message' : 'Nouveau'}
                          </span>
                        )}
                        <span className={`max-w-[320px] truncate text-gray-900 ${t.unread ? 'font-semibold' : 'font-medium'}`}>{t.subject}</span>
                      </div>
                      {t.order_number && <div className="text-xs text-gray-500">Commande {t.order_number}</div>}
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-gray-900">{t.company_name || '—'}</div>
                      <div className="text-xs text-gray-500">{t.client_name}</div>
                    </td>
                    <td className="px-4 py-3 text-gray-700">{SAV_CATEGORY[t.category]}</td>
                    <td className="px-4 py-3"><Badge variant={SAV_STATUS[t.status].variant}>{SAV_STATUS[t.status].label}</Badge></td>
                    <td className="px-4 py-3"><Badge variant={SAV_PRIORITY[t.priority].variant}>{SAV_PRIORITY[t.priority].label}</Badge></td>
                    {disputes ? (
                      <>
                        <td className="px-4 py-3 text-gray-900">{EUR(t.dispute_amount)}</td>
                        <td className="px-4 py-3">
                          {t.dispute_decision ? (
                            <Badge variant={SAV_DECISION[t.dispute_decision].variant}>{SAV_DECISION[t.dispute_decision].label}</Badge>
                          ) : (
                            <span className="text-xs text-gray-400">À statuer</span>
                          )}
                        </td>
                      </>
                    ) : (
                      <td className="px-4 py-3 text-gray-700">{t.assignee_name || <span className="text-gray-400">—</span>}</td>
                    )}
                    <td className="whitespace-nowrap px-4 py-3 text-xs text-gray-500">{formatSavDate(lastActivity(t))}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
