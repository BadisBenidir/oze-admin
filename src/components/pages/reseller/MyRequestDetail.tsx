import React, { useState } from 'react';
import { ArrowLeft, Bot, ChevronDown, ChevronUp, Loader2, User } from 'lucide-react';
import { supabase } from '../../../lib/supabase';
import { Badge } from '../../ui/Badge';
import { useResellerAuth } from '../../../hooks/useResellerAuth';
import { useMySavTicket } from '../../../hooks/useMySavTickets';
import { SavReplyBox, SavThread } from '../../sav/SavThread';
import { SAV_CATEGORY, SAV_STATUS_CLIENT, formatSavDate, uploadSavAttachments } from '../../../lib/sav';

/** Détail d'une demande (/mes-demandes/SAV-AAAA-NNNN) : fil client / équipe,
 * réponse avec photos, conversation d'origine avec l'assistant. */
export const MyRequestDetail: React.FC<{ number: string; onBack: () => void }> = ({ number, onBack }) => {
  const { profile } = useResellerAuth();
  const { ticket, messages, chat, loading, error, refresh } = useMySavTicket(number);
  const [showChat, setShowChat] = useState(false);

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
  };

  const closed = ticket.status === 'closed';

  return (
    <div className="mx-auto max-w-3xl space-y-5 p-4 md:p-6">
      <div>
        {back}
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-sm text-gray-500">{ticket.number}</span>
          <Badge variant={SAV_STATUS_CLIENT[ticket.status].variant}>{SAV_STATUS_CLIENT[ticket.status].label}</Badge>
        </div>
        <h1 className="mt-1 text-xl font-semibold text-gray-900">{ticket.subject}</h1>
        <p className="text-sm text-gray-500">
          {SAV_CATEGORY[ticket.category]}
          {ticket.order_number ? ` · Commande ${ticket.order_number}` : ''} · ouverte le {formatSavDate(ticket.created_at)}
        </p>
      </div>

      <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4">
        <SavThread viewer="client" messages={messages} />
      </div>

      {closed ? (
        <p className="rounded-lg bg-gray-50 p-3 text-center text-sm text-gray-500">
          Cette demande est fermée. Pour toute nouvelle question, ouvrez une nouvelle demande.
        </p>
      ) : (
        <SavReplyBox placeholder="Votre message à l'équipe OZË…" submitLabel="Envoyer" onSubmit={reply} />
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
