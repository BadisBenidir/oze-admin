import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { SavAttachment, SavCategory, SavStatus } from '../lib/sav';
import { SAV_CLIENT_UPDATE_EVENT } from './useSavLive';

/** « Mes demandes » (espace pro) : vues sav_my_* (0263) — tickets du compte
 * revendeur connecté, sans notes internes ni champs litige. */

export interface MySavTicket {
  id: string;
  number: string;
  order_id: string | null;
  order_number: string | null;
  category: SavCategory;
  subject: string;
  status: SavStatus;
  source: 'chatbot' | 'form' | 'admin';
  conversation_id: string | null;
  created_at: string;
  last_activity_at: string;
  has_new_reply: boolean;
}

export interface MySavMessage {
  id: string;
  ticket_id: string;
  author_type: 'client' | 'team' | 'system';
  author_name: string;
  content: string;
  attachments: SavAttachment[];
  created_at: string;
  yes_no: boolean;
  yes_no_answer: 'yes' | 'no' | null;
}

export const useMySavTickets = (enabled: boolean) => {
  const [tickets, setTickets] = useState<MySavTicket[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    const { data, error: e } = await supabase.from('sav_my_tickets').select('*').order('last_activity_at', { ascending: false });
    if (e) setError(e.message);
    else setTickets((data || []) as MySavTicket[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!enabled) return;
    refresh();
    // Réponse de l'équipe (temps réel) : liste à jour sans recharger.
    const onUpdate = () => refresh(true);
    window.addEventListener(SAV_CLIENT_UPDATE_EVENT, onUpdate);
    return () => window.removeEventListener(SAV_CLIENT_UPDATE_EVENT, onUpdate);
  }, [enabled, refresh]);

  return { tickets, loading, error, refresh };
};

/** Émis après lecture d'une demande : les badges se mettent à jour tout de suite. */
export const SAV_READ_EVENT = 'oze-sav-read';

/** Nombre de demandes avec une réponse non lue (badges « Mon compte » et bulle de chat). */
export const useMySavUnreadCount = (enabled: boolean) => {
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    const load = () =>
      supabase
        .from('sav_my_tickets')
        .select('id', { count: 'exact', head: true })
        .eq('has_new_reply', true)
        .then(({ count: c }) => setCount(c ?? 0));
    load();
    const t = window.setInterval(load, 120000);
    window.addEventListener(SAV_READ_EVENT, load);
    window.addEventListener(SAV_CLIENT_UPDATE_EVENT, load);
    window.addEventListener('focus', load);
    return () => {
      window.clearInterval(t);
      window.removeEventListener(SAV_READ_EVENT, load);
      window.removeEventListener(SAV_CLIENT_UPDATE_EVENT, load);
      window.removeEventListener('focus', load);
    };
  }, [enabled]);
  return count;
};

export const useMySavTicket = (number: string | null) => {
  const [ticket, setTicket] = useState<MySavTicket | null>(null);
  const [messages, setMessages] = useState<MySavMessage[]>([]);
  const [chat, setChat] = useState<{ id: string; role: 'user' | 'assistant'; display_text: string; created_at: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!number) return;
    const { data: t, error: te } = await supabase.from('sav_my_tickets').select('*').eq('number', number).maybeSingle();
    if (te || !t) {
      setError(te?.message || 'Demande introuvable');
      setLoading(false);
      return;
    }
    const tk = t as MySavTicket;
    setTicket(tk);
    const [m, c] = await Promise.all([
      supabase.from('sav_my_ticket_messages').select('*').eq('ticket_id', tk.id).order('created_at'),
      tk.conversation_id
        ? supabase.from('sav_my_chat_messages').select('id, role, display_text, created_at').eq('conversation_id', tk.conversation_id).order('created_at')
        : Promise.resolve({ data: [] }),
    ]);
    setMessages((m.data || []) as MySavMessage[]);
    setChat((c.data || []) as typeof chat);
    setLoading(false);
    if (tk.has_new_reply) {
      supabase.rpc('sav_mark_ticket_read', { p_ticket_id: tk.id }).then(() => window.dispatchEvent(new Event(SAV_READ_EVENT)));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [number]);

  useEffect(() => {
    setLoading(true);
    refresh();
  }, [refresh]);

  return { ticket, messages, chat, loading, error, refresh };
};
