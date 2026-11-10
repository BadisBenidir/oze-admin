import React, { useEffect, useState } from 'react';
import { Bot, ChevronRight, LifeBuoy, Loader2, MessageSquarePlus, X } from 'lucide-react';
import { supabase } from '../../../lib/supabase';
import { Badge } from '../../ui/Badge';
import { useResellerAuth } from '../../../hooks/useResellerAuth';
import { useMySavTickets } from '../../../hooks/useMySavTickets';
import { SavFilePicker } from '../../sav/SavThread';
import { SAV_CATEGORY, SAV_STATUS_CLIENT, SavCategory, formatSavDate, uploadSavAttachments } from '../../../lib/sav';

const inputCls = 'w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 focus:border-gray-400 focus:outline-none';

/** Formulaire « Nouvelle demande » (sav_create_ticket, 0264). */
const NewRequestModal: React.FC<{ onClose: () => void; onCreated: (number: string) => void }> = ({ onClose, onCreated }) => {
  const { profile } = useResellerAuth();
  const [category, setCategory] = useState<SavCategory>('order_delivery');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [orderId, setOrderId] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [orders, setOrders] = useState<{ id: string; order_number: string; created_at: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    supabase
      .from('orders')
      .select('id, order_number, created_at')
      .eq('order_channel', 'b2b')
      .order('created_at', { ascending: false })
      .limit(100)
      .then(({ data }) => setOrders((data || []) as typeof orders));
  }, []);

  const submit = async () => {
    if (!subject.trim() || !message.trim()) return setError('Indiquez un sujet et décrivez votre demande.');
    if (!profile?.reseller_id) return setError('Compte introuvable.');
    setBusy(true);
    setError(null);
    try {
      const attachments = files.length ? await uploadSavAttachments(files, profile.reseller_id) : [];
      const { data, error: e } = await supabase.rpc('sav_create_ticket', {
        p_category: category,
        p_subject: subject.trim(),
        p_message: message.trim(),
        p_order_id: orderId || null,
        p_attachments: attachments,
      });
      if (e) throw new Error(e.message);
      const row = Array.isArray(data) ? data[0] : data;
      onCreated(row.number);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Envoi impossible');
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <div className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-white p-5 shadow-xl sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900">Nouvelle demande</h2>
          <button onClick={onClose} className="rounded-lg p-1 text-gray-400 hover:text-gray-700"><X className="h-5 w-5" /></button>
        </div>
        <div className="space-y-3">
          <label className="block text-sm text-gray-700">
            Catégorie
            <select value={category} onChange={(e) => setCategory(e.target.value as SavCategory)} className={`${inputCls} mt-1`}>
              {(Object.keys(SAV_CATEGORY) as SavCategory[]).map((c) => <option key={c} value={c}>{SAV_CATEGORY[c]}</option>)}
            </select>
          </label>
          <label className="block text-sm text-gray-700">
            Commande concernée <span className="text-gray-400">(facultatif)</span>
            <select value={orderId} onChange={(e) => setOrderId(e.target.value)} className={`${inputCls} mt-1`}>
              <option value="">Aucune</option>
              {orders.map((o) => (
                <option key={o.id} value={o.id}>{o.order_number} · {formatSavDate(o.created_at, false)}</option>
              ))}
            </select>
          </label>
          <label className="block text-sm text-gray-700">
            Sujet
            <input value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={200} className={`${inputCls} mt-1`} />
          </label>
          <label className="block text-sm text-gray-700">
            Votre message
            <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={5} maxLength={5000} className={`${inputCls} mt-1`} />
          </label>
          <SavFilePicker files={files} onChange={setFiles} disabled={busy} />
          {error && <p className="text-sm text-red-600">{error}</p>}
          <button
            onClick={submit}
            disabled={busy}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-gray-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" />} Envoyer ma demande
          </button>
        </div>
      </div>
    </div>
  );
};

/** Page « Mes demandes » (/mes-demandes). */
export const MyRequests: React.FC<{ onOpen: (number: string) => void; onOpenAssistant: () => void }> = ({ onOpen, onOpenAssistant }) => {
  const { isReseller } = useResellerAuth();
  const { tickets, loading, error } = useMySavTickets(isReseller);
  const [showNew, setShowNew] = useState(false);

  return (
    <div className="mx-auto max-w-4xl space-y-5 p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Mes demandes</h1>
          <p className="text-sm text-gray-500">Suivez vos demandes d'assistance et échangez avec l'équipe OZË.</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={onOpenAssistant}
            className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            <Bot className="h-4 w-4" /> Assistant
          </button>
          <button
            onClick={() => setShowNew(true)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-gray-900 px-3 py-2 text-sm font-medium text-white hover:bg-gray-800"
          >
            <MessageSquarePlus className="h-4 w-4" /> Nouvelle demande
          </button>
        </div>
      </div>

      {error && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}

      {loading ? (
        <div className="flex justify-center p-12 text-gray-400"><Loader2 className="h-6 w-6 animate-spin" /></div>
      ) : tickets.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-200 bg-white p-10 text-center">
          <LifeBuoy className="mx-auto h-8 w-8 text-gray-300" />
          <p className="mt-3 text-sm text-gray-600">Vous n'avez aucune demande en cours.</p>
          <p className="text-sm text-gray-500">Une question ? Posez-la à l'assistant ou ouvrez une demande.</p>
        </div>
      ) : (
        <div className="divide-y divide-gray-100 overflow-hidden rounded-2xl border border-gray-200 bg-white">
          {tickets.map((t) => (
            <button key={t.id} onClick={() => onOpen(t.number)} className="flex w-full items-center gap-3 px-4 py-4 text-left hover:bg-gray-50">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-xs text-gray-500">{t.number}</span>
                  <Badge variant={SAV_STATUS_CLIENT[t.status].variant}>{SAV_STATUS_CLIENT[t.status].label}</Badge>
                  {t.has_new_reply && <span className="rounded-full bg-blue-600 px-2 py-0.5 text-[11px] font-medium text-white">Nouvelle réponse</span>}
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

      {showNew && (
        <NewRequestModal
          onClose={() => setShowNew(false)}
          onCreated={(number) => {
            setShowNew(false);
            onOpen(number);
          }}
        />
      )}
    </div>
  );
};
