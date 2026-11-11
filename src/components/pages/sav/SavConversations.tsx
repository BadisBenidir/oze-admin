import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Bot, Loader2, MessagesSquare, RefreshCw, Search, Ticket, User } from 'lucide-react';
import { supabase } from '../../../lib/supabase';
import { SavAttachment, formatSavDate } from '../../../lib/sav';
import { SavAttachmentList, useSignedAttachmentUrls } from '../../sav/SavThread';
import { SAV_TEAM_UPDATE_EVENT } from '../../../hooks/useSavLive';

/**
 * SAV → Conversations : toutes les discussions avec le chatbot (tables
 * sav_chat_conversations / sav_chat_messages, 0263), avec ou sans ticket.
 */

interface ConversationRow {
  id: string;
  created_at: string;
  last_message_at: string;
  client: string;
  email: string | null;
  company: string | null;
  ticket: { id: string; number: string } | null;
  count: number;
  preview: string;
}

interface Line {
  id: string;
  role: 'user' | 'assistant';
  display_text: string;
  tools: string[];
  attachments: SavAttachment[];
  created_at: string;
}

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export const SavConversations: React.FC<{ onOpenTicket: (id: string) => void }> = ({ onOpenTicket }) => {
  const [rows, setRows] = useState<ConversationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [withTicket, setWithTicket] = useState<'' | 'yes' | 'no'>('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [loadingLines, setLoadingLines] = useState(false);
  const urls = useSignedAttachmentUrls(lines);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError(null);
    const { data, error: e } = await supabase
      .from('sav_chat_conversations')
      .select(
        'id, created_at, last_message_at, profile:profiles(first_name, last_name, email), reseller:resellers(company_name), ' +
          'ticket:sav_tickets!sav_chat_conversations_ticket_id_fkey(id, number)'
      )
      .order('last_message_at', { ascending: false })
      .limit(300);
    if (e) {
      setError(e.message);
      setLoading(false);
      return;
    }
    type Raw = {
      id: string;
      created_at: string;
      last_message_at: string;
      profile: { first_name: string | null; last_name: string | null; email: string | null } | null;
      reseller: { company_name: string | null } | null;
      ticket: { id: string; number: string } | null;
    };
    const raw = (data || []) as unknown as Raw[];
    // Messages visibles (client + assistant) : nombre et premier message du client.
    const ids = raw.map((r) => r.id);
    const previews: Record<string, string> = {};
    const counts: Record<string, number> = {};
    if (ids.length) {
      const { data: first } = await supabase
        .from('sav_chat_messages')
        .select('conversation_id, role, display_text, created_at')
        .in('conversation_id', ids)
        .neq('display_text', '')
        .order('created_at', { ascending: true });
      (first || []).forEach((m: { conversation_id: string; role: string; display_text: string }) => {
        counts[m.conversation_id] = (counts[m.conversation_id] || 0) + 1;
        if (m.role === 'user' && !previews[m.conversation_id]) previews[m.conversation_id] = m.display_text;
      });
    }
    setRows(
      raw
        .map((r) => ({
          id: r.id,
          created_at: r.created_at,
          last_message_at: r.last_message_at,
          client: [r.profile?.first_name, r.profile?.last_name].filter(Boolean).join(' ') || r.profile?.email || '—',
          email: r.profile?.email ?? null,
          company: r.reseller?.company_name ?? null,
          ticket: r.ticket,
          count: counts[r.id] ?? 0,
          preview: previews[r.id] || '',
        }))
        // Conversation ouverte sans aucun message du client : rien à lire.
        .filter((r) => r.preview)
    );
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    const onUpdate = () => load(true);
    window.addEventListener(SAV_TEAM_UPDATE_EVENT, onUpdate);
    return () => window.removeEventListener(SAV_TEAM_UPDATE_EVENT, onUpdate);
  }, [load]);

  useEffect(() => {
    if (!selectedId) return;
    setLoadingLines(true);
    supabase
      .from('sav_chat_messages')
      .select('id, role, display_text, content, attachments, created_at')
      .eq('conversation_id', selectedId)
      .order('created_at')
      .then(({ data }) => {
        setLines(
          ((data || []) as { id: string; role: 'user' | 'assistant'; display_text: string; content: unknown; attachments: SavAttachment[]; created_at: string }[])
            .map((c) => ({
              id: c.id,
              role: c.role,
              display_text: c.display_text,
              attachments: c.attachments || [],
              created_at: c.created_at,
              tools: Array.isArray(c.content)
                ? (c.content as { type?: string; name?: string }[]).filter((b) => b.type === 'tool_use').map((b) => b.name || 'outil')
                : [],
            }))
            // Résultats d'outils (lignes sans texte) : jamais vus par le client.
            .filter((c) => c.display_text || c.tools.length > 0 || c.attachments.length > 0)
        );
        setLoadingLines(false);
      });
  }, [selectedId]);

  const filtered = useMemo(() => {
    const q = norm(query.trim());
    return rows.filter((r) => {
      if (withTicket === 'yes' && !r.ticket) return false;
      if (withTicket === 'no' && r.ticket) return false;
      if (q && !norm([r.client, r.email, r.company, r.preview, r.ticket?.number].filter(Boolean).join(' ')).includes(q)) return false;
      return true;
    });
  }, [rows, query, withTicket]);

  const selected = rows.find((r) => r.id === selectedId) || null;

  return (
    <div className="mx-auto max-w-[1400px] space-y-5 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gray-900 text-white"><MessagesSquare className="h-5 w-5" /></div>
          <div>
            <h1 className="text-xl font-semibold text-gray-900">Conversations avec l'assistant</h1>
            <p className="text-sm text-gray-500">Toutes les discussions des revendeurs avec le chatbot, avec ou sans demande ouverte.</p>
          </div>
        </div>
        <button
          onClick={() => load()}
          className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> Actualiser
        </button>
      </div>

      {error && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}

      <div className="grid gap-5 lg:grid-cols-[400px_minmax(0,1fr)]">
        {/* Liste */}
        <div className="space-y-3">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Client, message, n° de demande…"
                className="h-9 w-full rounded-lg border border-gray-200 pl-9 pr-3 text-sm focus:border-gray-400 focus:outline-none"
              />
            </div>
            <select
              value={withTicket}
              onChange={(e) => setWithTicket(e.target.value as typeof withTicket)}
              className="h-9 rounded-lg border border-gray-200 bg-white px-2 text-sm text-gray-700"
            >
              <option value="">Toutes</option>
              <option value="yes">Avec demande</option>
              <option value="no">Sans demande</option>
            </select>
          </div>
          <div className="text-xs text-gray-500">{filtered.length} conversation{filtered.length > 1 ? 's' : ''}</div>
          <div className="max-h-[calc(100vh-320px)] divide-y divide-gray-100 overflow-y-auto rounded-xl border border-gray-200 bg-white">
            {loading && rows.length === 0 ? (
              <div className="flex justify-center p-8 text-gray-400"><Loader2 className="h-5 w-5 animate-spin" /></div>
            ) : filtered.length === 0 ? (
              <p className="p-6 text-center text-sm text-gray-400">Aucune conversation.</p>
            ) : (
              filtered.map((r) => (
                <button
                  key={r.id}
                  onClick={() => setSelectedId(r.id)}
                  className={`block w-full px-4 py-3 text-left ${selectedId === r.id ? 'bg-gray-100' : 'hover:bg-gray-50'}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-medium text-gray-900">{r.client}</span>
                    <span className="shrink-0 text-[11px] text-gray-400">{formatSavDate(r.last_message_at)}</span>
                  </div>
                  {r.company && <div className="truncate text-xs text-gray-500">{r.company}</div>}
                  <div className="mt-1 line-clamp-2 text-xs text-gray-600">« {r.preview} »</div>
                  <div className="mt-1.5 flex items-center gap-2 text-[11px] text-gray-400">
                    <span>{r.count} message{r.count > 1 ? 's' : ''}</span>
                    {r.ticket && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 font-medium text-blue-700">
                        <Ticket className="h-3 w-3" /> {r.ticket.number}
                      </span>
                    )}
                  </div>
                </button>
              ))
            )}
          </div>
        </div>

        {/* Conversation */}
        <div className="rounded-xl border border-gray-200 bg-white">
          {!selected ? (
            <div className="flex h-full min-h-[300px] items-center justify-center p-8 text-sm text-gray-400">
              Choisissez une conversation pour la lire.
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 px-4 py-3">
                <div>
                  <div className="text-sm font-semibold text-gray-900">{selected.client}</div>
                  <div className="text-xs text-gray-500">
                    {[selected.company, selected.email].filter(Boolean).join(' · ')} · commencée le {formatSavDate(selected.created_at)}
                  </div>
                </div>
                {selected.ticket && (
                  <button
                    onClick={() => onOpenTicket(selected.ticket!.id)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
                  >
                    <Ticket className="h-4 w-4" /> Ouvrir la demande {selected.ticket.number}
                  </button>
                )}
              </div>
              <div className="max-h-[calc(100vh-300px)] space-y-3 overflow-y-auto p-4">
                {loadingLines ? (
                  <div className="flex justify-center p-8 text-gray-400"><Loader2 className="h-5 w-5 animate-spin" /></div>
                ) : (
                  lines.map((c) => {
                    const mine = c.role === 'user';
                    return (
                      <div key={c.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                        <div className={`flex max-w-[85%] flex-col gap-1 ${mine ? 'items-end' : 'items-start'}`}>
                          {c.attachments.length > 0 && <SavAttachmentList attachments={c.attachments} urls={urls} />}
                          {c.display_text && (
                            <div
                              className={`whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2.5 text-sm ${
                                mine ? 'rounded-tr-sm bg-gray-900 text-white' : 'rounded-tl-sm bg-gray-100 text-gray-900'
                              }`}
                            >
                              {c.display_text.trim()}
                            </div>
                          )}
                          <div className="flex items-center gap-1.5 text-[11px] text-gray-400">
                            {mine ? <User className="h-3 w-3" /> : <Bot className="h-3 w-3" />}
                            <span>{mine ? 'Client' : 'Assistant'} · {formatSavDate(c.created_at)}</span>
                            {c.tools.map((t, i) => (
                              <span key={`${t}-${i}`} className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-[10px] text-gray-500">{t}</span>
                            ))}
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
