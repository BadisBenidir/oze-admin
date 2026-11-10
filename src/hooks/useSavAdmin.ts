import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { SavAttachment, SavCategory, SavDisputeDecision, SavPriority, SavStatus } from '../lib/sav';

/** Onglet SAV de l'admin (0263 / 0264) : tickets, fiche, compteurs. */

const personName = (p: { first_name: string | null; last_name: string | null; email: string | null } | null) =>
  p ? [p.first_name, p.last_name].filter(Boolean).join(' ').trim() || p.email || '—' : null;

export interface SavAdminTicket {
  id: string;
  number: string;
  reseller_id: string;
  created_by_profile_id: string | null;
  order_id: string | null;
  category: SavCategory;
  subject: string;
  status: SavStatus;
  priority: SavPriority;
  assigned_to: string | null;
  source: 'chatbot' | 'form' | 'admin';
  is_dispute: boolean;
  dispute_amount: number | null;
  dispute_decision: SavDisputeDecision | null;
  dispute_reason: string | null;
  conversation_id: string | null;
  ai_summary: string | null;
  created_at: string;
  updated_at: string;
  last_client_message_at: string | null;
  last_team_message_at: string | null;
  resolved_at: string | null;
  last_team_read_at: string | null;
  company_name: string | null;
  client_name: string | null;
  client_email: string | null;
  order_number: string | null;
  assignee_name: string | null;
  /** Le client a écrit après la dernière réponse de l'équipe. */
  awaiting_team: boolean;
  /** Nouveau ticket jamais ouvert, ou message client depuis la dernière ouverture (0266). */
  unread: boolean;
}

const TICKET_SELECT =
  '*, reseller:resellers(company_name), order:orders(order_number), ' +
  'creator:profiles!sav_tickets_created_by_profile_id_fkey(first_name, last_name, email), ' +
  'assignee:profiles!sav_tickets_assigned_to_fkey(first_name, last_name, email)';

type Person = { first_name: string | null; last_name: string | null; email: string | null } | null;
type TicketRow = Omit<SavAdminTicket, 'company_name' | 'client_name' | 'client_email' | 'order_number' | 'assignee_name' | 'awaiting_team' | 'unread'> & {
  reseller: { company_name: string | null } | null;
  order: { order_number: string | null } | null;
  creator: Person;
  assignee: Person;
};

const mapTicket = (r: TicketRow): SavAdminTicket => {
  const { reseller, order, creator, assignee, ...rest } = r;
  return {
    ...rest,
    is_dispute: Boolean(rest.is_dispute),
    company_name: reseller?.company_name ?? null,
    client_name: personName(creator),
    client_email: creator?.email ?? null,
    order_number: order?.order_number ?? null,
    assignee_name: personName(assignee),
    awaiting_team:
      Boolean(rest.last_client_message_at) &&
      (!rest.last_team_message_at || rest.last_client_message_at! > rest.last_team_message_at),
    unread:
      rest.status !== 'closed' &&
      (!rest.last_team_read_at || Boolean(rest.last_client_message_at && rest.last_client_message_at > rest.last_team_read_at)),
  };
};

export const useSavTickets = (enabled = true) => {
  const [tickets, setTickets] = useState<SavAdminTicket[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error: e } = await supabase
      .from('sav_tickets')
      .select(TICKET_SELECT)
      .order('created_at', { ascending: false })
      .limit(2000);
    if (e) setError(e.message);
    else setTickets(((data || []) as unknown as TicketRow[]).map(mapTicket));
    setLoading(false);
  }, []);

  useEffect(() => {
    if (enabled) refresh();
  }, [enabled, refresh]);

  return { tickets, loading, error, refresh };
};

export interface SavCounters {
  new_count: number;
  open_count: number;
  waiting_client_count: number;
  urgent_count: number;
  disputes_open_count: number;
  unread_count: number;
}

/** Émis quand une fiche est ouverte (lue) : pastilles et compteurs à jour tout de suite. */
export const SAV_ADMIN_READ_EVENT = 'oze-sav-admin-read';

export const useSavCounters = (enabled = true, pollMs = 60000) => {
  const [counters, setCounters] = useState<SavCounters | null>(null);
  const refresh = useCallback(async () => {
    const { data } = await supabase.rpc('sav_admin_counters');
    const row = Array.isArray(data) ? data[0] : data;
    if (row) setCounters(row as SavCounters);
  }, []);
  useEffect(() => {
    if (!enabled) return;
    refresh();
    const t = window.setInterval(refresh, pollMs);
    window.addEventListener(SAV_ADMIN_READ_EVENT, refresh);
    window.addEventListener('focus', refresh);
    return () => {
      window.clearInterval(t);
      window.removeEventListener(SAV_ADMIN_READ_EVENT, refresh);
      window.removeEventListener('focus', refresh);
    };
  }, [enabled, refresh, pollMs]);
  return { counters, refresh };
};

export const useSavAssignees = () => {
  const [assignees, setAssignees] = useState<{ id: string; name: string; email: string }[]>([]);
  useEffect(() => {
    supabase.rpc('sav_admin_assignees').then(({ data }) => setAssignees((data || []) as { id: string; name: string; email: string }[]));
  }, []);
  return assignees;
};

export interface SavAdminMessage {
  id: string;
  author_type: 'client' | 'team' | 'system';
  author_id: string | null;
  author_name: string;
  content: string;
  internal: boolean;
  attachments: SavAttachment[];
  created_at: string;
}

export interface SavEvent {
  id: string;
  action: string;
  old_value: string | null;
  new_value: string | null;
  actor_name: string | null;
  created_at: string;
}

export interface SavChatLine {
  id: string;
  role: 'user' | 'assistant';
  display_text: string;
  tools: string[];
  attachments: SavAttachment[];
  created_at: string;
}

export interface SavClientInfo {
  company_name: string | null;
  account_type: string | null;
  status: string | null;
  subscription_status: string | null;
  subscription_plan: string | null;
  contact_phone: string | null;
  contact_email: string | null;
}

export const useSavTicketDetail = (ticketId: string | null) => {
  const [ticket, setTicket] = useState<SavAdminTicket | null>(null);
  const [messages, setMessages] = useState<SavAdminMessage[]>([]);
  const [events, setEvents] = useState<SavEvent[]>([]);
  const [chat, setChat] = useState<SavChatLine[]>([]);
  const [otherTickets, setOtherTickets] = useState<SavAdminTicket[]>([]);
  const [client, setClient] = useState<SavClientInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!ticketId) return;
    setError(null);
    const { data: t, error: te } = await supabase.from('sav_tickets').select(TICKET_SELECT).eq('id', ticketId).single();
    if (te || !t) {
      setError(te?.message || 'Ticket introuvable');
      setLoading(false);
      return;
    }
    const mapped = mapTicket(t as unknown as TicketRow);
    setTicket(mapped);
    if (mapped.unread) {
      supabase.rpc('sav_admin_mark_read', { p_ticket_id: ticketId }).then(() => window.dispatchEvent(new Event(SAV_ADMIN_READ_EVENT)));
    }

    const [msgRes, evRes, otherRes, resellerRes, chatRes] = await Promise.all([
      supabase
        .from('sav_ticket_messages')
        .select('id, author_type, author_id, content, internal, attachments, created_at, author:profiles(first_name, last_name, email)')
        .eq('ticket_id', ticketId)
        .order('created_at'),
      supabase
        .from('sav_ticket_events')
        .select('id, action, old_value, new_value, created_at, actor:profiles(first_name, last_name, email)')
        .eq('ticket_id', ticketId)
        .order('created_at', { ascending: false }),
      supabase
        .from('sav_tickets')
        .select(TICKET_SELECT)
        .eq('reseller_id', mapped.reseller_id)
        .neq('id', ticketId)
        .order('created_at', { ascending: false })
        .limit(20),
      supabase
        .from('resellers')
        .select('company_name, account_type, status, subscription_status, subscription_plan, contact_phone, contact_email')
        .eq('id', mapped.reseller_id)
        .maybeSingle(),
      mapped.conversation_id
        ? supabase
            .from('sav_chat_messages')
            .select('id, role, display_text, content, attachments, created_at')
            .eq('conversation_id', mapped.conversation_id)
            .order('created_at')
        : Promise.resolve({ data: [], error: null }),
    ]);

    setMessages(
      ((msgRes.data || []) as unknown as (Omit<SavAdminMessage, 'author_name'> & { author: Person })[]).map((m) => ({
        ...m,
        author_name:
          m.author_type === 'system' ? 'Système' : personName(m.author) || (m.author_type === 'team' ? 'Équipe OZË' : 'Client'),
      }))
    );
    setEvents(
      ((evRes.data || []) as unknown as (Omit<SavEvent, 'actor_name'> & { actor: Person })[]).map((e) => ({
        ...e,
        actor_name: personName(e.actor),
      }))
    );
    setOtherTickets(((otherRes.data || []) as unknown as TicketRow[]).map(mapTicket));
    setClient((resellerRes.data as SavClientInfo | null) ?? null);
    setChat(
      ((chatRes.data || []) as { id: string; role: 'user' | 'assistant'; display_text: string; content: unknown; attachments: SavAttachment[]; created_at: string }[]).map(
        (c) => ({
          id: c.id,
          role: c.role,
          display_text: c.display_text,
          attachments: c.attachments || [],
          created_at: c.created_at,
          tools: Array.isArray(c.content)
            ? (c.content as { type?: string; name?: string }[]).filter((b) => b.type === 'tool_use').map((b) => b.name || 'outil')
            : [],
        })
      )
    );
    setLoading(false);
  }, [ticketId]);

  useEffect(() => {
    setLoading(true);
    refresh();
  }, [refresh]);

  return { ticket, messages, events, chat, otherTickets, client, loading, error, refresh };
};
