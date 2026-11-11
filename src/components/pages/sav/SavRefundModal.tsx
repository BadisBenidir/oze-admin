import React, { useEffect, useState } from 'react';
import { AlertCircle, Loader2, Package, Wallet, X } from 'lucide-react';
import { supabase } from '../../../lib/supabase';
import { B2BOrder, fetchB2BOrderById } from '../../../hooks/useB2BOrders';
import { cancelOrder, cancelOrderItem } from '../../../hooks/useCancelOrderItem';
import type { SavAdminTicket, SavRefundAction } from '../../../hooks/useSavAdmin';

type Restock = 'draft' | 'for-sale-b2b' | 'archived';
type Method = 'wallet' | 'stripe';

const RESTOCK_OPTIONS: { value: Restock; label: string }[] = [
  { value: 'draft', label: 'Remettre en brouillon' },
  { value: 'for-sale-b2b', label: 'Remettre au catalogue B2B' },
  { value: 'archived', label: "Archiver l'article" },
];

const eur = (n: number) => `${n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;

const clientMessage = (orderNumber: string, count: number, whole: boolean, amount: number, paid: boolean, method: Method) => {
  const what = whole ? `votre commande ${orderNumber}` : `${count > 1 ? `${count} articles` : "l'article concerné"} de votre commande ${orderNumber}`;
  const refund = !paid
    ? ''
    : method === 'stripe'
      ? ` Nous vous remboursons ${eur(amount)} sur votre moyen de paiement d'origine : le remboursement apparaîtra sous 5 à 10 jours ouvrés selon votre banque.`
      : ` ${eur(amount)} ont été crédités sur votre portefeuille OZË : ils sont disponibles immédiatement pour vos prochains achats.`;
  return `Bonjour,\n\nComme convenu, nous avons annulé ${what}.${refund}\n\nBelle journée,\nL'équipe OZË Paris`;
};

/**
 * « Annuler et rembourser » depuis un ticket SAV (0271) : annule la commande
 * entière ou les articles choisis via les fonctions habituelles
 * (cancel-b2b-order / cancel-b2b-order-item), prévient le client dans la
 * demande et passe le ticket en « Résolu ».
 */
export const SavRefundModal: React.FC<{
  ticket: SavAdminTicket;
  /** Proposition acceptée par le client, ou null : commande liée, tous les articles. */
  action: SavRefundAction | null;
  walletBalance: number | null;
  onClose: () => void;
  onDone: () => void;
}> = ({ ticket, action, walletBalance, onClose, onDone }) => {
  const orderId = action?.order_id ?? ticket.order_id;
  const [order, setOrder] = useState<B2BOrder | null>(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string[]>([]);
  const [method, setMethod] = useState<Method>('wallet');
  const [restock, setRestock] = useState<Restock>('draft');
  const [reason, setReason] = useState(`SAV ${ticket.number} : annulation et remboursement acceptés par le client`);
  const [notify, setNotify] = useState(true);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!orderId) return;
    fetchB2BOrderById(orderId).then((o) => {
      setLoading(false);
      if (!o) return setError('Commande introuvable');
      setOrder(o);
      const active = o.order_items.filter((i) => i.status === 'active').map((i) => i.id);
      const wanted = (action?.order_item_ids ?? []).filter((id) => active.includes(id));
      setSelected(wanted.length ? wanted : active);
      // Par défaut : remboursement sur la carte si la commande a été payée par carte.
      setMethod(o.stripe_payment_intent_id ? 'stripe' : 'wallet');
    });
  }, [orderId, action]);

  const active = order?.order_items.filter((i) => i.status === 'active') ?? [];
  const items = active.filter((i) => selected.includes(i.id));
  const whole = items.length > 0 && items.length === active.length;
  const amount = items.reduce((s, i) => s + i.line_total + (i.insured ? i.insurance_cost : 0), 0);
  const isPaid = order?.payment_status === 'paid';

  // Message au client recalculé à chaque changement d'articles / de mode.
  useEffect(() => {
    if (order) setMessage(clientMessage(order.order_number, items.length, whole, amount, isPaid, method));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order, selected.join('|'), method]);

  const confirm = async () => {
    if (!order || items.length === 0) return setError('Choisissez au moins un article.');
    if (!reason.trim()) return setError("Indiquez la raison de l'annulation.");
    setBusy(true);
    setError(null);
    const refundMethod = isPaid ? method : undefined;
    const results = whole
      ? [await cancelOrder(order.id, reason.trim(), restock, refundMethod)]
      : [];
    if (!whole) {
      for (const item of items) {
        const r = await cancelOrderItem(item.id, reason.trim(), restock, refundMethod);
        results.push(r);
        if (!r.success) break;
      }
    }
    const failed = results.find((r) => !r.success);
    const refundFailed = results.find((r) => r.refund_status === 'failed');
    const result = {
      order_number: order.order_number,
      items: items.length,
      amount,
      method: refundMethod ?? null,
      refund_status: refundFailed ? 'failed' : isPaid ? 'succeeded' : 'not_applicable',
    };

    if (failed) {
      setBusy(false);
      return setError(failed.error || "Impossible d'annuler la commande.");
    }

    if (refundFailed) {
      // Annulation faite mais remboursement refusé : rien n'est annoncé au client.
      await supabase.rpc('sav_admin_reply', {
        p_ticket_id: ticket.id,
        p_content: `Annulation faite (${order.order_number}) mais le remboursement a échoué : ${refundFailed.refund_error || 'erreur inconnue'}. À reprendre depuis la fiche commande.`,
        p_internal: true,
        p_attachments: [],
        p_new_status: null,
      });
    } else if (notify && message.trim()) {
      await supabase.rpc('sav_admin_reply', {
        p_ticket_id: ticket.id,
        p_content: message.trim(),
        p_internal: false,
        p_attachments: [],
        p_new_status: 'resolved',
      });
    } else {
      await supabase.rpc('sav_admin_update_ticket', { p_ticket_id: ticket.id, p_patch: { status: 'resolved' } });
    }
    if (ticket.pending_action) {
      await supabase.rpc('sav_admin_set_pending_action', { p_ticket_id: ticket.id, p_state: 'done', p_result: result });
    }
    setBusy(false);
    if (refundFailed) {
      setError(`Commande annulée, mais le remboursement a échoué : ${refundFailed.refund_error || 'erreur inconnue'}. Une note interne a été ajoutée.`);
      onDone();
      return;
    }
    onDone();
    onClose();
  };

  const toggle = (id: string) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="fixed inset-0 bg-black/40" onClick={() => !busy && onClose()} />
      <div className="flex min-h-full items-center justify-center p-4">
        <div className="relative w-full max-w-lg rounded-2xl bg-white shadow-xl">
          <div className="flex items-center justify-between border-b border-gray-100 p-5">
            <h2 className="text-lg font-semibold text-gray-900">Annuler et rembourser{order ? ` · ${order.order_number}` : ''}</h2>
            <button onClick={onClose} disabled={busy} className="rounded-lg p-1 text-gray-400 hover:text-gray-600">
              <X className="h-5 w-5" />
            </button>
          </div>

          {loading ? (
            <div className="flex justify-center p-10 text-gray-400"><Loader2 className="h-6 w-6 animate-spin" /></div>
          ) : !order ? (
            <div className="p-5 text-sm text-red-700">{error || 'Commande introuvable'}</div>
          ) : active.length === 0 ? (
            <div className="p-5 text-sm text-gray-600">Tous les articles de cette commande sont déjà annulés.</div>
          ) : (
            <div className="space-y-4 p-5">
              <div>
                <p className="mb-2 text-sm font-medium text-gray-700">Articles à annuler</p>
                <div className="space-y-1.5">
                  {active.map((i) => (
                    <label key={i.id} className="flex cursor-pointer items-center gap-3 rounded-lg border border-gray-200 p-2 hover:bg-gray-50">
                      <input type="checkbox" checked={selected.includes(i.id)} onChange={() => toggle(i.id)} className="h-4 w-4 accent-gray-900" />
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-md border border-gray-100 bg-white">
                        {i.product_snapshot?.images?.[0] ? <img src={i.product_snapshot.images[0]} alt="" className="h-full w-full object-cover" /> : <Package className="h-4 w-4 text-gray-300" />}
                      </div>
                      <span className="min-w-0 flex-1 truncate text-sm text-gray-900">{i.product_snapshot?.name || 'Article'}</span>
                      <span className="text-sm text-gray-700">{eur(i.line_total + (i.insured ? i.insurance_cost : 0))}</span>
                    </label>
                  ))}
                </div>
                <p className="mt-2 text-sm font-semibold text-gray-900">
                  {isPaid ? `À rembourser : ${eur(amount)}` : 'Commande non payée : annulation sans remboursement.'}
                </p>
              </div>

              {isPaid && (
                <div>
                  <p className="mb-2 text-sm font-medium text-gray-700">Mode de remboursement</p>
                  <div className="space-y-2 text-sm">
                    <label className={`flex items-center gap-2 ${order.stripe_payment_intent_id ? 'text-gray-700' : 'text-gray-400'}`}>
                      <input type="radio" checked={method === 'stripe'} disabled={!order.stripe_payment_intent_id} onChange={() => setMethod('stripe')} className="h-4 w-4 accent-gray-900" />
                      Sur la carte (paiement d'origine, 5 à 10 jours)
                    </label>
                    <label className="flex items-center gap-2 text-gray-700">
                      <input type="radio" checked={method === 'wallet'} onChange={() => setMethod('wallet')} className="h-4 w-4 accent-gray-900" />
                      En crédit portefeuille (immédiat)
                    </label>
                  </div>
                </div>
              )}

              {walletBalance != null && (
                <div className="flex items-start gap-2 rounded-lg bg-gray-50 p-3 text-sm text-gray-700">
                  <Wallet className="mt-0.5 h-4 w-4 shrink-0 text-gray-400" />
                  <div>
                    Portefeuille de {ticket.client_name || 'la personne'} : <strong>{eur(walletBalance)}</strong>
                    {isPaid && method === 'wallet' && <> → <strong>{eur(walletBalance + amount)}</strong> après remboursement</>}
                  </div>
                </div>
              )}

              <div>
                <p className="mb-2 text-sm font-medium text-gray-700">Que faire des articles ?</p>
                <div className="space-y-2 text-sm text-gray-700">
                  {RESTOCK_OPTIONS.map((o) => (
                    <label key={o.value} className="flex items-center gap-2">
                      <input type="radio" checked={restock === o.value} onChange={() => setRestock(o.value)} className="h-4 w-4 accent-gray-900" />
                      {o.label}
                    </label>
                  ))}
                </div>
              </div>

              <label className="block text-sm font-medium text-gray-700">
                Raison (interne)
                <input value={reason} onChange={(e) => setReason(e.target.value)} className="mt-1 h-9 w-full rounded-lg border border-gray-200 px-2.5 text-sm font-normal" />
              </label>

              <div>
                <label className="flex items-center gap-2 text-sm font-medium text-gray-700">
                  <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} className="h-4 w-4 accent-gray-900" />
                  Prévenir le client dans la demande (et par email)
                </label>
                {notify && (
                  <textarea
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    rows={6}
                    maxLength={5000}
                    className="mt-2 w-full rounded-lg border border-gray-200 p-3 text-sm text-gray-800 focus:border-gray-400 focus:outline-none"
                  />
                )}
              </div>

              {error && (
                <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /> {error}
                </div>
              )}

              <div className="flex justify-end gap-2">
                <button onClick={onClose} disabled={busy} className="rounded-lg px-4 py-2 text-sm text-gray-600 hover:bg-gray-100">
                  Retour
                </button>
                <button
                  onClick={confirm}
                  disabled={busy || items.length === 0}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
                >
                  {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                  {isPaid ? `Annuler et rembourser ${eur(amount)}` : "Confirmer l'annulation"}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
