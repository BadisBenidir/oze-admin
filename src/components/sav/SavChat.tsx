import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Bot, ImagePlus, Loader2, MessageCircle, Maximize2, RotateCcw, Send, Ticket, X } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useResellerAuth } from '../../hooks/useResellerAuth';
import { SavAttachment, uploadSavAttachments } from '../../lib/sav';
import { useMySavUnreadCount } from '../../hooks/useMySavTickets';

/**
 * Assistant SAV de l'espace pro (Edge Function sav-chat, 0263) : réponses en
 * streaming, photos, ouverture de ticket par le bot. Utilisé par la bulle
 * flottante (SavChatWidget) et la page /assistance.
 */

interface ChatLine {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  photos?: string[];
  ticket?: { id: string; number: string };
  error?: boolean;
}

const MAX_CHARS = 2000;
/** Sans message depuis 30 min : « Avez-vous encore besoin d'aide ? ». */
const IDLE_MS = 30 * 60 * 1000;
const MAX_PHOTOS = 3;
const SUGGESTIONS = ['Où en est ma commande ?', 'Mon colis est arrivé endommagé', 'Une question sur mon abonnement', 'Parler à un membre de l\'équipe'];

const storageKey = (profileId: string) => `oze-sav-conversation:${profileId}`;
const readStored = (k: string) => {
  try {
    return window.localStorage.getItem(k);
  } catch {
    return null;
  }
};
const writeStored = (k: string, v: string | null) => {
  try {
    if (v) window.localStorage.setItem(k, v);
    else window.localStorage.removeItem(k);
  } catch {
    // stockage indisponible (navigation privée) : conversation non conservée
  }
};

const useSavChat = () => {
  const { profile } = useResellerAuth();
  const [lines, setLines] = useState<ChatLine[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [streaming, setStreaming] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);
  // Conversation clôturée : ticket ouvert par le bot, ou « Non » à la relance.
  const [closed, setClosed] = useState<null | { reason: 'ticket' | 'ended'; number?: string }>(null);
  const [lastActivity, setLastActivity] = useState<number | null>(null);
  const [askStillNeeded, setAskStillNeeded] = useState(false);

  // Reprend la dernière conversation (historique lu dans sav_my_chat_messages).
  useEffect(() => {
    if (!profile?.id) return;
    const stored = readStored(storageKey(profile.id));
    if (!stored) return;
    setConversationId(stored);
    setLoadingHistory(true);
    supabase
      .from('sav_my_chat_messages')
      .select('id, role, display_text, created_at')
      .eq('conversation_id', stored)
      .order('created_at')
      .then(({ data }) => {
        const rows = (data || []) as { id: string; role: 'user' | 'assistant'; display_text: string; created_at: string }[];
        setLines(rows.map((m) => ({ id: m.id, role: m.role, text: m.display_text })));
        if (rows.length) setLastActivity(new Date(rows[rows.length - 1].created_at).getTime());
        setLoadingHistory(false);
      });
  }, [profile?.id]);

  const reset = () => {
    setLines([]);
    setConversationId(null);
    setClosed(null);
    setAskStillNeeded(false);
    setLastActivity(null);
    if (profile?.id) writeStored(storageKey(profile.id), null);
  };

  // Termine la conversation : affichée jusqu'à la fermeture du chat, puis
  // une nouvelle conversation démarre à la prochaine ouverture.
  const close = (reason: 'ticket' | 'ended', number?: string) => {
    setClosed({ reason, number });
    setAskStillNeeded(false);
    if (profile?.id) writeStored(storageKey(profile.id), null);
  };

  // Relance après 30 min sans message (vérifiée aussi à la réouverture).
  useEffect(() => {
    if (closed || streaming || lines.length === 0 || !lastActivity) return;
    const check = () => {
      if (Date.now() - lastActivity >= IDLE_MS) setAskStillNeeded(true);
    };
    check();
    const t = window.setInterval(check, 30000);
    return () => window.clearInterval(t);
  }, [closed, streaming, lines.length, lastActivity]);

  const answerStillNeeded = (yes: boolean) => {
    if (yes) {
      setAskStillNeeded(false);
      setLastActivity(Date.now());
    } else {
      close('ended');
    }
  };

  const send = useCallback(
    async (text: string, files: File[]) => {
      if (!profile?.reseller_id || streaming || closed) return;
      setAskStillNeeded(false);
      setLastActivity(Date.now());
      const userLine: ChatLine = { id: crypto.randomUUID(), role: 'user', text: text || '📷', photos: files.map((f) => URL.createObjectURL(f)) };
      const botId = crypto.randomUUID();
      setLines((l) => [...l, userLine, { id: botId, role: 'assistant', text: '' }]);
      setStreaming(true);
      const patchBot = (fn: (l: ChatLine) => ChatLine) => setLines((all) => all.map((l) => (l.id === botId ? fn(l) : l)));

      try {
        let attachments: SavAttachment[] = [];
        if (files.length) attachments = await uploadSavAttachments(files, profile.reseller_id);
        const { data: session } = await supabase.auth.getSession();
        const token = session.session?.access_token;
        const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/sav-chat`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
            apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
          },
          body: JSON.stringify({ conversation_id: conversationId, message: text, attachments }),
        });
        if (!res.ok || !res.body) {
          let msg = "L'assistant est momentanément indisponible.";
          try {
            const j = await res.json();
            msg = j.error || msg;
            if (j.code === 'conversation_full') reset();
          } catch {
            // corps non-JSON
          }
          patchBot((l) => ({ ...l, text: msg, error: true }));
          return;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const events = buffer.split('\n\n');
          buffer = events.pop() || '';
          for (const ev of events) {
            const line = ev.split('\n').find((x) => x.startsWith('data: '));
            if (!line) continue;
            const data = JSON.parse(line.slice(6));
            if (data.type === 'meta') {
              setConversationId(data.conversation_id);
              writeStored(storageKey(profile.id), data.conversation_id);
            } else if (data.type === 'text') {
              patchBot((l) => ({ ...l, text: l.text + data.text }));
            } else if (data.type === 'ticket') {
              patchBot((l) => ({ ...l, ticket: { id: data.id, number: data.number } }));
              // Ticket ouvert : la conversation est terminée, la suite se passe dans « Mes demandes ».
              close('ticket', data.number);
            } else if (data.type === 'error') {
              patchBot((l) => ({ ...l, text: (l.text ? `${l.text}\n\n` : '') + data.error, error: true }));
            }
          }
        }
      } catch (e) {
        patchBot((l) => ({ ...l, text: e instanceof Error ? e.message : 'Envoi impossible', error: true }));
      } finally {
        setStreaming(false);
        setLastActivity(Date.now());
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [profile?.id, profile?.reseller_id, conversationId, streaming, closed]
  );

  return { lines, send, reset, streaming, loadingHistory, closed, askStillNeeded, answerStillNeeded, firstName: profile?.first_name };
};

export const SavChatPanel: React.FC<{
  onOpenTicket: (number: string) => void;
  onClose?: () => void;
  onExpand?: () => void;
  fullPage?: boolean;
  /** Réponses de l'équipe non lues : bandeau vers « Mes demandes ». */
  unreadCount?: number;
  onOpenRequests?: () => void;
}> = ({ onOpenTicket, onClose, onExpand, fullPage, unreadCount = 0, onOpenRequests }) => {
  const { lines, send, reset, streaming, loadingHistory, closed, askStillNeeded, answerStillNeeded, firstName } = useSavChat();
  const [text, setText] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [lines, closed, askStillNeeded]);

  const submit = (value = text) => {
    const v = value.trim();
    if ((!v && files.length === 0) || streaming) return;
    send(v.slice(0, MAX_CHARS), files);
    setText('');
    setFiles([]);
  };

  return (
    <div className={`flex h-full flex-col bg-white ${fullPage ? 'rounded-2xl border border-gray-200' : ''}`}>
      <div className="flex items-center gap-3 border-b border-gray-100 px-4 py-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gray-900 text-white"><Bot className="h-4 w-4" /></div>
        <div className="flex-1">
          <div className="text-sm font-semibold text-gray-900">Assistant OZË</div>
          <div className="text-xs text-gray-500">Réponses automatiques · l'équipe prend le relais si besoin</div>
        </div>
        <button onClick={reset} title="Nouvelle conversation" className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-50 hover:text-gray-700"><RotateCcw className="h-4 w-4" /></button>
        {onExpand && <button onClick={onExpand} title="Plein écran" className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-50 hover:text-gray-700"><Maximize2 className="h-4 w-4" /></button>}
        {onClose && <button onClick={onClose} title="Fermer" className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-50 hover:text-gray-700"><X className="h-4 w-4" /></button>}
      </div>

      {unreadCount > 0 && onOpenRequests && (
        <button
          onClick={onOpenRequests}
          className="flex items-center gap-2 border-b border-red-100 bg-red-50 px-4 py-2.5 text-left text-sm text-red-800 hover:bg-red-100"
        >
          <span className="flex h-5 min-w-[20px] items-center justify-center rounded-full bg-red-600 px-1 text-[11px] font-semibold text-white">{unreadCount}</span>
          <span className="flex-1">{unreadCount > 1 ? 'Nouvelles réponses' : 'Nouvelle réponse'} de l'équipe OZË</span>
          <span className="text-xs font-medium underline">Voir mes demandes</span>
        </button>
      )}

      <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
        <div className="max-w-[85%] rounded-2xl rounded-tl-sm bg-gray-100 px-3.5 py-2.5 text-sm text-gray-900">
          Bonjour{firstName ? ` ${firstName}` : ''}, je suis l'assistant OZË Paris. Comment puis-je vous aider ?
        </div>
        {lines.length === 0 && !loadingHistory && (
          <div className="flex flex-wrap gap-2">
            {SUGGESTIONS.map((s) => (
              <button key={s} onClick={() => submit(s)} className="rounded-full border border-gray-200 px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50">
                {s}
              </button>
            ))}
          </div>
        )}
        {loadingHistory && <div className="flex justify-center text-gray-300"><Loader2 className="h-4 w-4 animate-spin" /></div>}
        {lines.map((l) => (
          <div key={l.id} className={`flex ${l.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className="max-w-[85%] space-y-2">
              {l.photos && l.photos.length > 0 && (
                <div className="flex justify-end gap-1.5">
                  {l.photos.map((p) => <img key={p} src={p} alt="" className="h-16 w-16 rounded-lg object-cover" />)}
                </div>
              )}
              {(l.text || l.role === 'user') && (
                <div
                  className={`whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2.5 text-sm ${
                    l.role === 'user'
                      ? 'rounded-tr-sm bg-gray-900 text-white'
                      : l.error
                        ? 'rounded-tl-sm border border-red-100 bg-red-50 text-red-800'
                        : 'rounded-tl-sm bg-gray-100 text-gray-900'
                  }`}
                >
                  {l.text.trim()}
                </div>
              )}
              {l.role === 'assistant' && !l.text && streaming && (
                <div className="inline-flex gap-1 rounded-2xl bg-gray-100 px-3.5 py-3">
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-gray-400" />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-gray-400 [animation-delay:120ms]" />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-gray-400 [animation-delay:240ms]" />
                </div>
              )}
              {l.ticket && (
                <button
                  onClick={() => onOpenTicket(l.ticket!.number)}
                  className="flex w-full items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-left text-sm hover:bg-gray-50"
                >
                  <Ticket className="h-4 w-4 text-gray-500" />
                  <span className="flex-1">Demande <strong>{l.ticket.number}</strong> ouverte</span>
                  <span className="text-xs font-medium text-gray-900 underline">Voir</span>
                </button>
              )}
            </div>
          </div>
        ))}
        {askStillNeeded && !closed && (
          <div className="space-y-2">
            <div className="max-w-[85%] rounded-2xl rounded-tl-sm bg-gray-100 px-3.5 py-2.5 text-sm text-gray-900">
              Avez-vous encore besoin d'aide ?
            </div>
            <div className="flex gap-2">
              <button onClick={() => answerStillNeeded(true)} className="rounded-full border border-gray-200 px-4 py-1.5 text-sm text-gray-800 hover:bg-gray-50">
                Oui
              </button>
              <button onClick={() => answerStillNeeded(false)} className="rounded-full border border-gray-200 px-4 py-1.5 text-sm text-gray-800 hover:bg-gray-50">
                Non
              </button>
            </div>
          </div>
        )}
        {closed && (
          <div className="max-w-[85%] rounded-2xl rounded-tl-sm bg-gray-100 px-3.5 py-2.5 text-sm text-gray-900">
            {closed.reason === 'ticket' ? (
              <>
                Cette conversation est clôturée. Votre demande <strong>{closed.number}</strong> est transmise à l'équipe OZË : suivez-la et
                répondez-y dans « Mes demandes ».
              </>
            ) : (
              <>Merci pour votre échange, belle journée ! Cette conversation est terminée.</>
            )}
          </div>
        )}
        <div ref={endRef} />
      </div>

      {closed ? (
        <div className="border-t border-gray-100 p-3">
          <div className="flex items-center justify-between gap-2 rounded-xl bg-gray-50 px-3 py-2.5">
            <span className="text-xs text-gray-500">Conversation terminée</span>
            <button onClick={reset} className="rounded-lg bg-gray-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-gray-800">
              Nouvelle conversation
            </button>
          </div>
        </div>
      ) : (
      <div className="border-t border-gray-100 p-3">
        {files.length > 0 && (
          <div className="mb-2 flex gap-1.5">
            {files.map((f, i) => (
              <div key={`${f.name}-${i}`} className="relative">
                <img src={URL.createObjectURL(f)} alt="" className="h-12 w-12 rounded-lg object-cover" />
                <button onClick={() => setFiles(files.filter((_, j) => j !== i))} className="absolute -right-1 -top-1 rounded-full bg-gray-900 p-0.5 text-white">
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="flex items-end gap-2">
          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple
            className="hidden"
            onChange={(e) => {
              setFiles((f) => [...f, ...Array.from(e.target.files || [])].slice(0, MAX_PHOTOS));
              e.target.value = '';
            }}
          />
          <button
            onClick={() => fileRef.current?.click()}
            disabled={streaming || files.length >= MAX_PHOTOS}
            title="Joindre des photos"
            className="rounded-lg p-2 text-gray-400 hover:bg-gray-50 hover:text-gray-700 disabled:opacity-40"
          >
            <ImagePlus className="h-5 w-5" />
          </button>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value.slice(0, MAX_CHARS))}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            rows={1}
            placeholder="Écrivez votre message…"
            className="max-h-32 min-h-[40px] flex-1 resize-none rounded-xl border border-gray-200 px-3 py-2.5 text-sm focus:border-gray-400 focus:outline-none"
          />
          <button
            onClick={() => submit()}
            disabled={streaming || (!text.trim() && files.length === 0)}
            className="rounded-xl bg-gray-900 p-2.5 text-white hover:bg-gray-800 disabled:opacity-40"
          >
            {streaming ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </button>
        </div>
        {text.length > MAX_CHARS - 200 && <p className="mt-1 text-right text-[11px] text-gray-400">{text.length} / {MAX_CHARS}</p>}
      </div>
      )}
    </div>
  );
};

/** Bulle flottante en bas à droite, sur toutes les pages de l'espace pro. */
export const SavChatWidget: React.FC<{ onOpenTicket: (number: string) => void; onExpand: () => void; onOpenRequests: () => void }> = ({
  onOpenTicket,
  onExpand,
  onOpenRequests,
}) => {
  const [open, setOpen] = useState(false);
  const unread = useMySavUnreadCount(true);
  return (
    <>
      {open && (
        <div className="fixed inset-0 z-50 sm:inset-auto sm:bottom-24 sm:right-6 sm:h-[600px] sm:max-h-[calc(100vh-8rem)] sm:w-[400px] sm:overflow-hidden sm:rounded-2xl sm:border sm:border-gray-200 sm:shadow-2xl">
          <SavChatPanel
            onClose={() => setOpen(false)}
            onExpand={() => {
              setOpen(false);
              onExpand();
            }}
            onOpenTicket={(n) => {
              setOpen(false);
              onOpenTicket(n);
            }}
            unreadCount={unread}
            onOpenRequests={() => {
              setOpen(false);
              onOpenRequests();
            }}
          />
        </div>
      )}
      <button
        onClick={() => setOpen((v) => !v)}
        className={`fixed bottom-5 right-5 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-gray-900 text-white shadow-lg transition-transform hover:scale-105 sm:bottom-6 sm:right-6 ${open ? 'hidden sm:flex' : ''}`}
        aria-label={unread > 0 ? `Assistance — ${unread} nouvelle(s) réponse(s)` : 'Assistance'}
      >
        {open ? <X className="h-6 w-6" /> : <MessageCircle className="h-6 w-6" />}
        {!open && unread > 0 && (
          <span className="absolute -right-1 -top-1 flex h-6 min-w-[24px] items-center justify-center rounded-full border-2 border-white bg-red-600 px-1 text-xs font-bold text-white">
            {unread}
          </span>
        )}
      </button>
    </>
  );
};

/** Page /assistance : même assistant, en plein écran. */
export const AssistancePage: React.FC<{ onOpenTicket: (number: string) => void; onOpenRequests: () => void }> = ({ onOpenTicket, onOpenRequests }) => (
  <div className="mx-auto flex h-[calc(100vh-12rem)] min-h-[520px] max-w-3xl flex-col gap-3 p-4 md:p-6">
    <div className="flex flex-wrap items-end justify-between gap-2">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Assistance</h1>
        <p className="text-sm text-gray-500">Posez votre question : l'assistant répond tout de suite et transmet à l'équipe si nécessaire.</p>
      </div>
      <button onClick={onOpenRequests} className="text-sm font-medium text-gray-700 underline-offset-2 hover:underline">Mes demandes</button>
    </div>
    <div className="min-h-0 flex-1">
      <SavChatPanel fullPage onOpenTicket={onOpenTicket} />
    </div>
  </div>
);
