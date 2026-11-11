import React, { useState } from 'react';
import { ArrowLeft, Bot, ChevronDown, ChevronUp, Loader2, Lock, User } from 'lucide-react';
import { supabase } from '../../../lib/supabase';
import { Badge } from '../../ui/Badge';
import { useResellerAuth } from '../../../hooks/useResellerAuth';
import { useMySavTicket } from '../../../hooks/useMySavTickets';
import { SavReplyBox, SavThread, SavTypingIndicator } from '../../sav/SavThread';
import { savBroadcast, useSavTicketLive } from '../../../hooks/useSavLive';
import { invokeEdgeFunction } from '../../../utils/invokeEdgeFunction';
import { SAV_CATEGORY, SAV_STATUS_CLIENT, formatSavDate, uploadSavAttachments } from '../../../lib/sav';

/** Détail d'une demande (/mes-demandes/SAV-AAAA-NNNN) : fil client / équipe,
 * réponse avec photos, conversation d'origine avec l'assistant. */
export const MyRequestDetail: React.FC<{ number: string; onBack: () => void }> = ({ number, onBack }) => {
  const { profile } = useResellerAuth();
  const { ticket, messages, chat, loading, error, refresh } = useMySavTicket(number);
  // Temps réel : réponse de l'équipe sans recharger, « L'équipe OZË écrit… ».
  const live = useSavTicketLive(ticket?.id ?? null, 'client', refresh);
  const [showChat, setShowChat] = useState(true);

  if (loading && !ticket) {
    return <div className="flex justify-center p-16 text-gray-400"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  }

  const back = (
    <button onClick={onBack} className="mb-3 inline-flex items-center gap-1 text-sm text-gray-600 hover:text-gray-900">
      <ArrowLeft className="h-4 w-4" /> Mes demandes
    </button>
  );

  if (error || !ticket) {
    return (
      <div className="mx-auto max-w-3xl p-4 md:p-6">
        {back}
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error || 'Demande introuvable'}</div>
      </div>
    );
  }

  const reply = async (text: string, files: File[]) => {
    if (!profile?.reseller_id) throw new Error('Compte introuvable.');
    const attachments = files.length ? await uploadSavAttachments(files, profile.reseller_id) : [];
    const { error: e } = await supabase.rpc('sav_client_reply', { p_ticket_id: ticket.id, p_content: text, p_attachments: attachments });
    if (e) throw new Error(e.message);
    await refresh();
    live.notifyMessage();
    savBroadcast('sav-admin');
    // Réponse écrite à une proposition de remboursement : l'IA la lit et
    // prévient l'équipe si le client accepte ou refuse (sav-detect-action).
    if (messages.some((m) => m.yes_no && !m.yes_no_answer)) {
      invokeEdgeFunction<{ decision: string | null }>('sav-detect-action', { ticket_id: ticket.id, mode: 'client' }).then(({ data }) => {
        if (!data?.decision) return;
        refresh();
        live.notifyMessage();
        savBroadcast('sav-admin');
      });
    }
  };

  const closed = ticket.status === 'closed';

  // Question « Avez-vous encore besoin d'aide ? » : Non ferme la demande.
  const answerYesNo = async (messageId: string, answer: 'yes' | 'no') => {
    const { error: e } = await supabase.rpc('sav_client_answer_yes_no', { p_message_id: messageId, p_answer: answer });
    if (e) {
      alert(e.message);
      return;
    }
    await refresh();
    live.notifyMessage();
    savBroadcast('sav-admin');
  };

  return (
    <div className="mx-auto max-w-3xl space-y-5 p-4 md:p-6">
      {/* En-tête collant : retour à « Mes demandes » sans remonter toute la discussion. */}
      <div className="sticky top-0 z-20 -mx-4 border-b border-gray-200 bg-gray-50/95 px-4 py-3 backdrop-blur md:-mx-6 md:px-6">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
          >
            <ArrowLeft className="h-4 w-4" /> <span className="hidden sm:inline">Mes demandes</span>
          </button>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="font-mono text-xs text-gray-500">{ticket.number}</span>
              <Badge variant={SAV_STATUS_CLIENT[ticket.status].variant}>{SAV_STATUS_CLIENT[ticket.status].label}</Badge>
            </div>
            <h1 className="truncate text-base font-semibold text-gray-900 sm:text-lg">{ticket.subject}</h1>
          </div>
        </div>
      </div>
      <div>
        <p className="text-sm text-gray-500">
          {SAV_CATEGORY[ticket.category]}
          {ticket.order_number ? ` · Commande ${ticket.order_number}` : ''} · ouverte le {formatSavDate(ticket.created_at)}
        </p>
      </div>

      <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4">
        <SavThread viewer="client" messages={messages} onAnswerYesNo={closed ? undefined : answerYesNo} />
        {live.otherTyping && <SavTypingIndicator label="L'équipe OZË écrit…" />}
      </div>

      {closed ? (
        <div className="flex items-start gap-3 rounded-2xl border border-gray-200 bg-white p-4">
          <Lock className="mt-0.5 h-5 w-5 shrink-0 text-gray-400" />
          <div className="text-sm">
            <p className="font-medium text-gray-900">Demande fermée par l'équipe OZË</p>
            <p className="mt-0.5 text-gray-500">
              Vous ne pouvez plus y répondre. Pour toute nouvelle question, notre assistant reste disponible depuis la bulle de discussion en bas à droite.
            </p>
          </div>
        </div>
      ) : (
        <SavReplyBox placeholder="Votre message à l'équipe OZË…" submitLabel="Envoyer" onSubmit={reply} onTyping={live.notifyTyping} scrollKey={messages.length} />
      )}

      {chat.length > 0 && (
        <div className="rounded-2xl border border-gray-200 bg-white p-4">
          <button onClick={() => setShowChat((v) => !v)} className="flex w-full items-center justify-between text-sm font-medium text-gray-900">
            <span className="flex items-center gap-2"><Bot className="h-4 w-4 text-gray-500" /> Votre échange avec l'assistant</span>
            {showChat ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
          {showChat && (
            <div className="mt-3 space-y-3">
              {chat.map((c) => (
                <div key={c.id} className="text-sm">
                  <div className="mb-0.5 flex items-center gap-1.5 text-xs text-gray-500">
                    {c.role === 'user' ? <User className="h-3 w-3" /> : <Bot className="h-3 w-3" />}
                    <span className="font-medium">{c.role === 'user' ? 'Vous' : 'Assistant OZË'}</span>
                    <span>· {formatSavDate(c.created_at)}</span>
                  </div>
                  <p className="whitespace-pre-wrap text-gray-800">{c.display_text}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
