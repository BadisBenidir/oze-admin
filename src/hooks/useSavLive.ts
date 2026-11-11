import { useCallback, useEffect, useRef, useState } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';

/**
 * SAV en temps réel (Supabase Realtime, broadcast) : « … écrit », nouveaux
 * messages et pastilles sans recharger la page.
 *
 * Les événements ne transportent AUCUNE donnée (ni texte ni nom de client) :
 * ils disent seulement « quelque chose a changé », et chaque côté relit ses
 * données par les accès sécurisés habituels (vues sav_my_* côté client,
 * policies équipe côté admin).
 *
 *   sav-ticket:<id>        typing / message, entre le client et l'équipe
 *   sav-reseller:<id>      update → badges et liste « Mes demandes » du compte
 *   sav-admin              update → compteurs et liste de l'onglet SAV
 */

export const SAV_CLIENT_UPDATE_EVENT = 'oze-sav-client-update';
export const SAV_TEAM_UPDATE_EVENT = 'oze-sav-team-update';

/** Envoi ponctuel sur un canal non écouté (API REST de Realtime, httpSend). */
export const savBroadcast = async (topic: string, event = 'update') => {
  const ch = supabase.channel(topic);
  try {
    await ch.httpSend(event, {});
  } catch {
    // temps réel indisponible : les écrans se mettent à jour au prochain passage
  } finally {
    supabase.removeChannel(ch);
  }
};

/** Écoute un canal « update » et le relaie en événement window. */
const useRelay = (topic: string | null, windowEvent: string) => {
  useEffect(() => {
    if (!topic) return;
    const ch = supabase
      .channel(topic)
      .on('broadcast', { event: 'update' }, () => window.dispatchEvent(new Event(windowEvent)))
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [topic, windowEvent]);
};

/** Espace pro : réponses de l'équipe sur les demandes du compte. */
export const useSavResellerChannel = (resellerId: string | null | undefined) =>
  useRelay(resellerId ? `sav-reseller:${resellerId}` : null, SAV_CLIENT_UPDATE_EVENT);

/** Admin : nouveaux tickets / messages des clients. */
export const useSavAdminChannel = (enabled: boolean) => useRelay(enabled ? 'sav-admin' : null, SAV_TEAM_UPDATE_EVENT);

/**
 * Fil d'un ticket : indicateur « … écrit » de l'autre côté et rechargement
 * instantané à chaque nouveau message (filet : toutes les 30 s et au retour
 * sur l'onglet).
 */
export const useSavTicketLive = (ticketId: string | null, me: 'client' | 'team', onRemoteMessage: () => void) => {
  const [otherTyping, setOtherTyping] = useState(false);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const callback = useRef(onRemoteMessage);
  callback.current = onRemoteMessage;
  const lastTypingSent = useRef(0);

  useEffect(() => {
    if (!ticketId) return;
    let hideTimer: number | undefined;
    const ch = supabase
      .channel(`sav-ticket:${ticketId}`, { config: { broadcast: { self: false } } })
      .on('broadcast', { event: 'typing' }, ({ payload }) => {
        if (payload?.from === me) return;
        setOtherTyping(true);
        window.clearTimeout(hideTimer);
        hideTimer = window.setTimeout(() => setOtherTyping(false), 4000);
      })
      .on('broadcast', { event: 'message' }, () => {
        window.clearTimeout(hideTimer);
        setOtherTyping(false);
        callback.current();
      })
      .subscribe();
    channelRef.current = ch;

    const poll = window.setInterval(() => callback.current(), 30000);
    const onFocus = () => callback.current();
    window.addEventListener('focus', onFocus);
    return () => {
      window.clearTimeout(hideTimer);
      window.clearInterval(poll);
      window.removeEventListener('focus', onFocus);
      supabase.removeChannel(ch);
      channelRef.current = null;
    };
  }, [ticketId, me]);

  /** À appeler à chaque frappe (limité à un envoi toutes les 2 s). */
  const notifyTyping = useCallback(() => {
    const now = Date.now();
    if (now - lastTypingSent.current < 2000) return;
    lastTypingSent.current = now;
    channelRef.current?.send({ type: 'broadcast', event: 'typing', payload: { from: me } });
  }, [me]);

  /** À appeler après l'envoi d'un message. */
  const notifyMessage = useCallback(() => {
    lastTypingSent.current = 0;
    channelRef.current?.send({ type: 'broadcast', event: 'message', payload: { from: me } });
  }, [me]);

  return { otherTyping, notifyTyping, notifyMessage };
};
