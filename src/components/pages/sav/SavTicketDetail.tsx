import React, { useEffect, useState } from 'react';
import { ArrowLeft, Bot, ChevronDown, ChevronUp, ExternalLink, History, Loader2, Lock, Unlock, MessageCircleQuestion, Scale, Sparkles, User, XCircle, Zap } from 'lucide-react';
import { supabase } from '../../../lib/supabase';
import { Badge } from '../../ui/Badge';
import { useAdminAuth } from '../../../hooks/useAdminAuth';
import { B2BOrder, fetchB2BOrderById } from '../../../hooks/useB2BOrders';
import { B2BOrderDetailModal } from '../b2b/B2BOrderDetailModal';
import { useSavAssignees, useSavQuickReplies, useSavTicketDetail, SavEvent } from '../../../hooks/useSavAdmin';
import { SavReplyBox, SavThread, SavAttachmentList, SavTypingIndicator, useSignedAttachmentUrls } from '../../sav/SavThread';
import { savBroadcast, useSavTicketLive } from '../../../hooks/useSavLive';
import { invokeEdgeFunction } from '../../../utils/invokeEdgeFunction';
import {
  SAV_CATEGORY,
  SAV_DECISION,
  SAV_PRIORITY,
  SAV_STATUS,
  SavCategory,
  SavDisputeDecision,
  SavPriority,
  SavStatus,
  formatSavDate,
  uploadSavAttachments,
} from '../../../lib/sav';

const selectCls =
  'h-9 w-full rounded-lg border border-gray-200 bg-white px-2.5 text-sm text-gray-700 focus:border-gray-400 focus:outline-none';
const EUR = (n: number | null) => (n == null ? '—' : `${Number(n).toLocaleString('fr-FR', { maximumFractionDigits: 2 })} €`);

const Section: React.FC<{ title: string; icon?: React.ReactNode; children: React.ReactNode; right?: React.ReactNode }> = ({ title, icon, children, right }) => (
  <div className="rounded-xl border border-gray-200 bg-white p-4">
    <div className="mb-3 flex items-center justify-between gap-2">
      <h3 className="flex items-center gap-2 text-sm font-semibold text-gray-900">{icon}{title}</h3>
      {right}
    </div>
    {children}
  </div>
);

const eventLabel = (e: SavEvent, assigneeName: (id: string | null) => string) => {
  switch (e.action) {
    case 'created':
      return `Ticket créé (${e.new_value === 'chatbot' ? 'chatbot' : e.new_value === 'admin' ? 'admin' : 'formulaire'})`;
    case 'status':
      return `Statut : ${SAV_STATUS[e.old_value as SavStatus]?.label ?? e.old_value} → ${SAV_STATUS[e.new_value as SavStatus]?.label ?? e.new_value}`;
    case 'priority':
      return `Priorité : ${SAV_PRIORITY[e.old_value as SavPriority]?.label ?? e.old_value} → ${SAV_PRIORITY[e.new_value as SavPriority]?.label ?? e.new_value}`;
    case 'category':
      return `Catégorie : ${SAV_CATEGORY[e.old_value as SavCategory] ?? e.old_value} → ${SAV_CATEGORY[e.new_value as SavCategory] ?? e.new_value}`;
    case 'assigned_to':
      return e.new_value ? `Assigné à ${assigneeName(e.new_value)}` : 'Assignation retirée';
    case 'order':
      return e.new_value ? 'Commande liée modifiée' : 'Commande retirée';
    case 'dispute':
      return `Litige : ${e.new_value || 'retiré'}`;
    case 'reply':
      return 'Réponse envoyée au client';
    case 'note':
      return 'Note interne ajoutée';
    case 'client_reply':
      return 'Message du client';
    default:
      return e.action;
  }
};

/** Fiche d'un ticket SAV : fil, réponse / note interne, réglages, litige,
 * client, commande, conversation chatbot d'origine, journal. */
export const SavTicketDetail: React.FC<{ ticketId: string; onBack: () => void; onOpenTicket: (id: string) => void }> = ({ ticketId, onBack, onOpenTicket }) => {
  const { ticket, messages, events, chat, otherTickets, client, loading, error, refresh } = useSavTicketDetail(ticketId);
  // Temps réel : message du client sans recharger, « Prénom écrit… ».
  const live = useSavTicketLive(ticketId, 'team', refresh);
  const { can } = useAdminAuth();
  const assignees = useSavAssignees();
  const [mode, setMode] = useState<'reply' | 'note'>('reply');
  const [draft, setDraft] = useState('');
  const [noteDraft, setNoteDraft] = useState('');
  const [statusAfterReply, setStatusAfterReply] = useState<'' | SavStatus>('waiting_client');
  // Réponses rapides (0269) et question Oui / Non.
  const { replies: quickReplies } = useSavQuickReplies();
  const [showQuick, setShowQuick] = useState(false);
  const [askYesNo, setAskYesNo] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [savingField, setSavingField] = useState<string | null>(null);
  const [order, setOrder] = useState<B2BOrder | null>(null);
  const [loadingOrder, setLoadingOrder] = useState(false);
  const [showChat, setShowChat] = useState(false);
  const [dispute, setDispute] = useState({ amount: '', decision: '' as '' | SavDisputeDecision, reason: '' });
  const [savingDispute, setSavingDispute] = useState(false);
  const chatUrls = useSignedAttachmentUrls(chat);
  // Fermeture du ticket par l'équipe : dernier message au client (facultatif).
  const [closing, setClosing] = useState(false);
  const [closeMessage, setCloseMessage] = useState("Nous clôturons votre demande. Merci pour votre confiance ! Pour toute nouvelle question, notre assistant reste disponible depuis la bulle de discussion de votre espace pro.");
  const [closeBusy, setCloseBusy] = useState(false);

  useEffect(() => {
    if (!ticket) return;
    setDispute({
      amount: ticket.dispute_amount != null ? String(ticket.dispute_amount) : '',
      decision: ticket.dispute_decision ?? '',
      reason: ticket.dispute_reason ?? '',
    });
  }, [ticket]);

  if (loading && !ticket) {
    return <div className="flex items-center justify-center p-16 text-gray-400"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  }
  if (error || !ticket) {
    return (
      <div className="p-6">
        <button onClick={onBack} className="mb-4 inline-flex items-center gap-1 text-sm text-gray-600 hover:text-gray-900"><ArrowLeft className="h-4 w-4" /> Retour</button>
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error || 'Ticket introuvable'}</div>
      </div>
    );
  }

  const assigneeName = (id: string | null) => assignees.find((a) => a.id === id)?.name ?? '—';

  const update = async (field: string, value: unknown) => {
    setSavingField(field);
    setActionError(null);
    const { error: e } = await supabase.rpc('sav_admin_update_ticket', { p_ticket_id: ticket.id, p_patch: { [field]: value } });
    setSavingField(null);
    if (e) setActionError(e.message);
    await refresh();
    if (!e) {
      live.notifyMessage();
      savBroadcast(`sav-reseller:${ticket.reseller_id}`);
    }
  };

  const send = async (text: string, files: File[], internal: boolean) => {
    // Question Oui / Non : boutons côté client, « Non » ferme la demande.
    if (!internal && askYesNo) {
      if (files.length) throw new Error('Une question Oui / Non ne peut pas porter de pièce jointe.');
      const { error: e } = await supabase.rpc('sav_admin_ask_yes_no', { p_ticket_id: ticket.id, p_content: text });
      if (e) throw new Error(e.message);
      setAskYesNo(false);
      await refresh();
      live.notifyMessage();
      savBroadcast(`sav-reseller:${ticket.reseller_id}`);
      return;
    }
    const attachments = files.length ? await uploadSavAttachments(files, `${ticket.reseller_id}/equipe`) : [];
    const { error: e } = await supabase.rpc('sav_admin_reply', {
      p_ticket_id: ticket.id,
      p_content: text,
      p_internal: internal,
      p_attachments: attachments,
      p_new_status: internal ? null : statusAfterReply || null,
    });
    if (e) throw new Error(e.message);
    await refresh();
    live.notifyMessage();
    if (!internal) savBroadcast(`sav-reseller:${ticket.reseller_id}`);
  };

  /** Ferme le ticket : message final au client (aussi envoyé par email), puis statut « Fermé ». */
  const closeTicket = async () => {
    setCloseBusy(true);
    setActionError(null);
    const message = closeMessage.trim();
    const { error: e } = message
      ? await supabase.rpc('sav_admin_reply', {
          p_ticket_id: ticket.id,
          p_content: message,
          p_internal: false,
          p_attachments: [],
          p_new_status: 'closed',
        })
      : await supabase.rpc('sav_admin_update_ticket', { p_ticket_id: ticket.id, p_patch: { status: 'closed' } });
    setCloseBusy(false);
    if (e) return setActionError(e.message);
    setClosing(false);
    await refresh();
    live.notifyMessage();
    savBroadcast(`sav-reseller:${ticket.reseller_id}`);
  };

  const suggest = async () => {
    setSuggesting(true);
    setActionError(null);
    const { data, error: e } = await invokeEdgeFunction<{ draft: string }>('sav-suggest-reply', { ticket_id: ticket.id });
    setSuggesting(false);
    if (e || !data) return setActionError(e || 'Suggestion impossible');
    setMode('reply');
    setDraft(data.draft);
  };

  const saveDispute = async () => {
    setSavingDispute(true);
    setActionError(null);
    const amount = dispute.amount.trim() === '' ? null : Number(dispute.amount.replace(',', '.'));
    if (amount != null && (Number.isNaN(amount) || amount < 0)) {
      setSavingDispute(false);
      return setActionError('Montant invalide');
    }
    const { error: e } = await supabase.rpc('sav_admin_set_dispute', {
      p_ticket_id: ticket.id,
      p_amount: amount,
      p_decision: dispute.decision,
      p_reason: dispute.reason,
    });
    setSavingDispute(false);
    if (e) setActionError(e.message);
    await refresh();
  };

  const openOrder = async () => {
    if (!ticket.order_id) return;
    setLoadingOrder(true);
    const o = await fetchB2BOrderById(ticket.order_id);
    setLoadingOrder(false);
    if (o) setOrder(o);
    else setActionError('Commande introuvable');
  };

  const canDecide = can('refunds');

  return (
    <div className="mx-auto max-w-[1400px] space-y-5 p-4 sm:p-6">
      {/* En-tête collant : retour à la liste sans remonter toute la discussion. */}
      <div className="sticky top-0 z-20 -mx-4 border-b border-gray-200 bg-gray-50/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
          >
            <ArrowLeft className="h-4 w-4" /> <span className="hidden sm:inline">Tous les tickets</span>
          </button>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-xs text-gray-500">{ticket.number}</span>
              <Badge variant={SAV_STATUS[ticket.status].variant}>{SAV_STATUS[ticket.status].label}</Badge>
              <Badge variant={SAV_PRIORITY[ticket.priority].variant}>{SAV_PRIORITY[ticket.priority].label}</Badge>
              {ticket.is_dispute && <Badge variant="purple">Litige</Badge>}
              {ticket.source === 'chatbot' && <Badge variant="default">Chatbot</Badge>}
            </div>
            <h1 className="truncate text-base font-semibold text-gray-900 sm:text-lg">{ticket.subject}</h1>
          </div>
          {ticket.status === 'closed' ? (
            <button
              onClick={() => update('status', 'in_progress')}
              disabled={savingField === 'status'}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              <Unlock className="h-4 w-4" /> <span className="hidden sm:inline">Rouvrir le ticket</span>
            </button>
          ) : (
            <button
              onClick={() => setClosing(true)}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-red-200 bg-white px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50"
            >
              <XCircle className="h-4 w-4" /> <span className="hidden sm:inline">Fermer le ticket</span>
            </button>
          )}
        </div>
      </div>

      {closing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => !closeBusy && setClosing(false)}>
          <div className="w-full max-w-lg rounded-2xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-semibold text-gray-900">Fermer le ticket {ticket.number} ?</h2>
            <p className="mt-1 text-sm text-gray-500">
              Le client voit sa demande « Fermée » et ne peut plus y répondre. Le message ci-dessous lui est envoyé dans la demande et par email
              (laissez vide pour fermer sans message).
            </p>
            <textarea
              value={closeMessage}
              onChange={(e) => setCloseMessage(e.target.value)}
              rows={5}
              maxLength={5000}
              className="mt-3 w-full rounded-lg border border-gray-200 p-3 text-sm text-gray-800 focus:border-gray-400 focus:outline-none"
            />
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setClosing(false)} disabled={closeBusy} className="rounded-lg px-4 py-2 text-sm text-gray-600 hover:bg-gray-100">
                Annuler
              </button>
              <button
                onClick={closeTicket}
                disabled={closeBusy}
                className="inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
              >
                {closeBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <XCircle className="h-4 w-4" />}
                Fermer le ticket
              </button>
            </div>
          </div>
        </div>
      )}
      <div>
        <p className="text-sm text-gray-500">
          {SAV_CATEGORY[ticket.category]} · ouvert le {formatSavDate(ticket.created_at)} par {ticket.client_name || '—'}
          {ticket.company_name ? ` (${ticket.company_name})` : ''}
        </p>
      </div>

      {actionError && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{actionError}</div>}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
        {/* Fil + réponse */}
        <div className="space-y-4">
          {ticket.ai_summary && (
            <div className="rounded-xl border border-blue-100 bg-blue-50/60 p-4">
              <div className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-blue-700">
                <Sparkles className="h-3.5 w-3.5" /> Résumé IA
              </div>
              {/* Rubriques « Libellé : valeur », une par ligne (sav-chat). */}
              <dl className="space-y-1.5 text-sm text-gray-800">
                {ticket.ai_summary.split('\n').filter((line) => line.trim()).map((line, i) => {
                  const m = line.match(/^([^:]{1,30}) : (.*)$/);
                  return m ? (
                    <div key={i} className="grid gap-x-3 sm:grid-cols-[140px_minmax(0,1fr)]">
                      <dt className="font-medium text-gray-500">{m[1]}</dt>
                      <dd>{m[2]}</dd>
                    </div>
                  ) : (
                    <p key={i} className="whitespace-pre-wrap">{line}</p>
                  );
                })}
              </dl>
            </div>
          )}

          <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
            <SavThread viewer="team" messages={messages} />
            {live.otherTyping && <SavTypingIndicator label={`${ticket.client_name || 'Le client'} écrit…`} />}
          </div>

          <div>
            <div className="mb-2 flex items-center gap-1">
              <button
                onClick={() => setMode('reply')}
                className={`rounded-lg px-3 py-1.5 text-sm font-medium ${mode === 'reply' ? 'bg-gray-900 text-white' : 'text-gray-600 hover:bg-gray-100'}`}
              >
                Réponse au client
              </button>
              <button
                onClick={() => setMode('note')}
                className={`inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-sm font-medium ${mode === 'note' ? 'bg-amber-500 text-white' : 'text-gray-600 hover:bg-gray-100'}`}
              >
                <Lock className="h-3.5 w-3.5" /> Note interne
              </button>
              <div className="flex-1" />
              {mode === 'reply' && (
                <div className="relative">
                  <button
                    onClick={() => setShowQuick((v) => !v)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
                  >
                    <Zap className="h-4 w-4" /> Réponses rapides
                  </button>
                  {showQuick && (
                    <>
                      <div className="fixed inset-0 z-30" onClick={() => setShowQuick(false)} />
                      <div className="absolute right-0 z-40 mt-2 max-h-[360px] w-80 overflow-y-auto rounded-xl border border-gray-200 bg-white p-1.5 shadow-xl">
                        {quickReplies.length === 0 ? (
                          <p className="p-3 text-sm text-gray-500">Aucune réponse rapide : ajoutez-en dans SAV → Réponses rapides.</p>
                        ) : (
                          quickReplies.map((q) => (
                            <button
                              key={q.id}
                              onClick={() => {
                                setDraft(q.content);
                                setAskYesNo(q.yes_no);
                                setShowQuick(false);
                              }}
                              className="block w-full rounded-lg px-3 py-2 text-left hover:bg-gray-50"
                            >
                              <span className="flex items-center gap-1.5 text-sm font-medium text-gray-900">
                                {q.yes_no && <MessageCircleQuestion className="h-3.5 w-3.5 text-blue-600" />}
                                {q.title}
                              </span>
                              <span className="line-clamp-2 text-xs text-gray-500">{q.content}</span>
                            </button>
                          ))
                        )}
                      </div>
                    </>
                  )}
                </div>
              )}
              {mode === 'reply' && (
                <button
                  onClick={suggest}
                  disabled={suggesting}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                >
                  {suggesting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                  Suggérer une réponse
                </button>
              )}
            </div>
            {mode === 'reply' ? (
              <SavReplyBox
                placeholder="Votre réponse au client (il la reçoit aussi par email)…"
                submitLabel="Envoyer au client"
                value={draft}
                onValueChange={setDraft}
                onSubmit={(t, f) => send(t, f, false)}
                onTyping={live.notifyTyping}
                scrollKey={messages.length}
                disabled={ticket.status === 'closed'}
                extra={
                  <>
                  <label
                    className={`inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium ${
                      askYesNo ? 'border-blue-300 bg-blue-50 text-blue-700' : 'border-gray-200 bg-white text-gray-600'
                    }`}
                    title="Le client répond par Oui ou Non ; « Non » ferme la demande"
                  >
                    <input type="checkbox" checked={askYesNo} onChange={(e) => setAskYesNo(e.target.checked)} className="h-3.5 w-3.5 accent-blue-600" />
                    Question Oui / Non
                  </label>
                  {!askYesNo && (
                  <select
                    value={statusAfterReply}
                    onChange={(e) => setStatusAfterReply(e.target.value as typeof statusAfterReply)}
                    className="h-9 rounded-lg border border-gray-200 bg-white px-2 text-xs text-gray-700"
                    title="Statut après l'envoi"
                  >
                    <option value="waiting_client">→ En attente client</option>
                    <option value="in_progress">→ En cours</option>
                    <option value="resolved">→ Résolu</option>
                    <option value="">Statut inchangé</option>
                  </select>
                  )}
                  </>
                }
              />
            ) : (
              <SavReplyBox
                tone="internal"
                placeholder="Note interne, jamais visible du client…"
                submitLabel="Ajouter la note"
                value={noteDraft}
                onValueChange={setNoteDraft}
                onSubmit={(t, f) => send(t, f, true)}
              />
            )}
            {ticket.status === 'closed' && mode === 'reply' && (
              <p className="mt-2 text-xs text-gray-500">Ticket fermé : rouvrez-le (statut) pour répondre au client.</p>
            )}
          </div>

          {ticket.conversation_id && (
            <Section
              title={`Conversation chatbot d'origine (${chat.length} messages)`}
              icon={<Bot className="h-4 w-4 text-gray-500" />}
              right={
                <button onClick={() => setShowChat((v) => !v)} className="inline-flex items-center gap-1 text-xs text-gray-600 hover:text-gray-900">
                  {showChat ? <>Masquer <ChevronUp className="h-3.5 w-3.5" /></> : <>Afficher <ChevronDown className="h-3.5 w-3.5" /></>}
                </button>
              }
            >
              {showChat ? (
                // Même présentation que le chat côté client : bulles client à
                // droite, assistant à gauche ; les résultats d'outils (lignes
                // sans texte) sont masqués, les appels d'outils en étiquette.
                <div className="max-h-[560px] space-y-3 overflow-y-auto rounded-xl bg-white pr-1">
                  {chat
                    .filter((c) => c.display_text || c.tools.length > 0 || c.attachments.length > 0)
                    .map((c) => {
                      const mine = c.role === 'user';
                      return (
                        <div key={c.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                          <div className={`flex max-w-[85%] flex-col gap-1 ${mine ? 'items-end' : 'items-start'}`}>
                            {c.attachments.length > 0 && <SavAttachmentList attachments={c.attachments} urls={chatUrls} />}
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
                    })}
                </div>
              ) : (
                <p className="text-xs text-gray-500">Transcription complète, appels d'outils compris.</p>
              )}
            </Section>
          )}
        </div>

        {/* Barre latérale */}
        <div className="space-y-4">
          <Section title="Traitement">
            <div className="space-y-3">
              <label className="block text-xs text-gray-500">
                Statut
                <select value={ticket.status} disabled={savingField === 'status'} onChange={(e) => update('status', e.target.value)} className={`${selectCls} mt-1`}>
                  {(Object.keys(SAV_STATUS) as SavStatus[]).map((s) => <option key={s} value={s}>{SAV_STATUS[s].label}</option>)}
                </select>
              </label>
              <label className="block text-xs text-gray-500">
                Priorité
                <select value={ticket.priority} disabled={savingField === 'priority'} onChange={(e) => update('priority', e.target.value)} className={`${selectCls} mt-1`}>
                  {(Object.keys(SAV_PRIORITY) as SavPriority[]).map((p) => <option key={p} value={p}>{SAV_PRIORITY[p].label}</option>)}
                </select>
              </label>
              <label className="block text-xs text-gray-500">
                Catégorie
                <select value={ticket.category} disabled={savingField === 'category'} onChange={(e) => update('category', e.target.value)} className={`${selectCls} mt-1`}>
                  {(Object.keys(SAV_CATEGORY) as SavCategory[]).map((c) => <option key={c} value={c}>{SAV_CATEGORY[c]}</option>)}
                </select>
              </label>
              <label className="block text-xs text-gray-500">
                Assigné à
                <select
                  value={ticket.assigned_to ?? ''}
                  disabled={savingField === 'assigned_to'}
                  onChange={(e) => update('assigned_to', e.target.value || null)}
                  className={`${selectCls} mt-1`}
                >
                  <option value="">Personne</option>
                  {assignees.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </label>
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={ticket.is_dispute}
                  disabled={savingField === 'is_dispute'}
                  onChange={(e) => update('is_dispute', e.target.checked)}
                  className="h-4 w-4 accent-gray-900"
                />
                Litige
              </label>
            </div>
          </Section>

          {ticket.is_dispute && (
            <Section title="Litige" icon={<Scale className="h-4 w-4 text-purple-600" />}>
              <div className="space-y-3">
                <label className="block text-xs text-gray-500">
                  Montant concerné (€)
                  <input
                    value={dispute.amount}
                    onChange={(e) => setDispute((d) => ({ ...d, amount: e.target.value }))}
                    disabled={!canDecide}
                    inputMode="decimal"
                    className="mt-1 h-9 w-full rounded-lg border border-gray-200 px-2.5 text-sm"
                  />
                </label>
                <label className="block text-xs text-gray-500">
                  Décision
                  <select
                    value={dispute.decision}
                    onChange={(e) => setDispute((d) => ({ ...d, decision: e.target.value as typeof d.decision }))}
                    disabled={!canDecide}
                    className={`${selectCls} mt-1`}
                  >
                    <option value="">À statuer</option>
                    {(Object.keys(SAV_DECISION) as SavDisputeDecision[]).map((d) => <option key={d} value={d}>{SAV_DECISION[d].label}</option>)}
                  </select>
                </label>
                <label className="block text-xs text-gray-500">
                  Motif
                  <textarea
                    value={dispute.reason}
                    onChange={(e) => setDispute((d) => ({ ...d, reason: e.target.value }))}
                    disabled={!canDecide}
                    rows={3}
                    className="mt-1 w-full rounded-lg border border-gray-200 p-2 text-sm"
                  />
                </label>
                {canDecide ? (
                  <button
                    onClick={saveDispute}
                    disabled={savingDispute}
                    className="w-full rounded-lg bg-gray-900 px-3 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
                  >
                    {savingDispute ? 'Enregistrement…' : 'Enregistrer le litige'}
                  </button>
                ) : (
                  <p className="text-xs text-gray-500">Droit « remboursements » requis pour statuer.</p>
                )}
                {ticket.dispute_decision && (
                  <p className="text-xs text-gray-500">
                    Décision actuelle : {SAV_DECISION[ticket.dispute_decision].label} · {EUR(ticket.dispute_amount)}
                  </p>
                )}
              </div>
            </Section>
          )}

          <Section title="Client" icon={<User className="h-4 w-4 text-gray-500" />}>
            <dl className="space-y-1.5 text-sm">
              <div className="font-medium text-gray-900">{client?.company_name || ticket.company_name || '—'}</div>
              <div className="text-gray-700">{ticket.client_name}</div>
              {ticket.client_email && <a href={`mailto:${ticket.client_email}`} className="block text-gray-600 underline-offset-2 hover:underline">{ticket.client_email}</a>}
              {client?.contact_phone && <div className="text-gray-600">{client.contact_phone}</div>}
              {client && (
                <div className="pt-1 text-xs text-gray-500">
                  {client.account_type === 'subscriber' ? 'Abonné Club B2B' : 'Entreprise'} · compte {client.status}
                  {client.subscription_status ? ` · abonnement ${client.subscription_status}` : ''}
                  {client.subscription_plan ? ` (${client.subscription_plan})` : ''}
                </div>
              )}
            </dl>
          </Section>

          <Section title="Commande liée">
            {ticket.order_id ? (
              <button
                onClick={openOrder}
                disabled={loadingOrder}
                className="inline-flex items-center gap-1.5 text-sm font-medium text-gray-900 underline-offset-2 hover:underline"
              >
                {loadingOrder ? <Loader2 className="h-4 w-4 animate-spin" /> : <ExternalLink className="h-4 w-4" />}
                Commande {ticket.order_number || ticket.order_id.slice(0, 8)}
              </button>
            ) : (
              <p className="text-sm text-gray-400">Aucune commande liée.</p>
            )}
          </Section>

          <Section title={`Autres tickets du client (${otherTickets.length})`}>
            {otherTickets.length === 0 ? (
              <p className="text-sm text-gray-400">Aucun autre ticket.</p>
            ) : (
              <ul className="space-y-2">
                {otherTickets.map((t) => (
                  <li key={t.id}>
                    <button onClick={() => onOpenTicket(t.id)} className="w-full rounded-lg p-2 text-left hover:bg-gray-50">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono text-xs text-gray-500">{t.number}</span>
                        <Badge variant={SAV_STATUS[t.status].variant}>{SAV_STATUS[t.status].label}</Badge>
                      </div>
                      <div className="truncate text-sm text-gray-900">{t.subject}</div>
                      <div className="text-xs text-gray-500">{formatSavDate(t.created_at, false)}</div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section title="Journal" icon={<History className="h-4 w-4 text-gray-500" />}>
            <ul className="max-h-[360px] space-y-2 overflow-y-auto text-xs">
              {events.map((e) => (
                <li key={e.id} className="border-l-2 border-gray-200 pl-2">
                  <div className="text-gray-800">{eventLabel(e, assigneeName)}</div>
                  <div className="text-gray-400">{e.actor_name || 'Système / bot'} · {formatSavDate(e.created_at)}</div>
                </li>
              ))}
            </ul>
          </Section>
        </div>
      </div>

      {order && <B2BOrderDetailModal order={order} onClose={() => setOrder(null)} onOrderUpdated={() => {}} />}
    </div>
  );
};
