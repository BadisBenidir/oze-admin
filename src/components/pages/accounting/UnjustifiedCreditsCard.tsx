import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Loader2, Paperclip, Wallet } from 'lucide-react';
import { supabase } from '../../../lib/supabase';
import { Card, CardContent, CardHeader } from '../../ui/Card';
import {
  ATTACHABLE_INVOICE_SELECT,
  AttachableInvoice,
  UnjustifiedCredit,
  attachInvoiceToTransaction,
  candidatesFor,
  invoiceClientName,
  invoiceLabel,
  proposeInvoices,
} from '../../../utils/invoiceAttachment';

const EUR = (n: number) => (Number(n) || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('fr-FR') : '—');

/**
 * Encaissements clients sans justificatif sur Qonto : l'admin propose la
 * facture correspondante (rapprochement Qonto, nom du client, montant) et la
 * dépose sur la transaction Qonto — une par une ou toutes d'un coup. Une
 * facture couvrant plusieurs paiements (acompte en plusieurs virements) est
 * déposée sur chacun d'eux.
 */
export const UnjustifiedCreditsCard: React.FC = () => {
  const [credits, setCredits] = useState<UnjustifiedCredit[]>([]);
  const [invoices, setInvoices] = useState<AttachableInvoice[]>([]);
  const [choice, setChoice] = useState<Record<string, string>>({});
  const [state, setState] = useState<Record<string, 'busy' | 'done' | string>>({});
  const [loading, setLoading] = useState(true);
  const [bulk, setBulk] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: tx }, { data: inv }] = await Promise.all([
      supabase
        .from('bank_transactions')
        .select('id, label, counterparty_name, amount, settled_at, emitted_at, attachment_ids, matched_type, matched_sourcing_mission_id, matched_order_id, qonto_status, reconciliation_status')
        .eq('side', 'credit')
        .eq('qonto_status', 'completed')
        .gt('amount', 0)
        .order('settled_at', { ascending: false }),
      supabase.from('invoices').select(ATTACHABLE_INVOICE_SELECT).neq('transmission_status', 'cancelled').is('merged_into_invoice_id', null),
    ]);
    // Hors reversements Stripe (ventes groupées), virements internes et
    // apports en compte courant : pas de facture client à joindre.
    // « Pas de facture » (micro-dépôt de vérification, remboursement
    // fournisseur…) : transaction ignorée, sortie de la liste.
    const rows = ((tx || []) as unknown as (UnjustifiedCredit & { attachment_ids: string[] | null; matched_type: string | null; reconciliation_status: string })[]).filter(
      (t) =>
        !(t.attachment_ids || []).length &&
        t.reconciliation_status !== 'ignored' &&
        t.matched_type !== 'stripe_payout' &&
        t.matched_type !== 'wallet_topup' &&
        !/STRIPE|^OZ[EË] PARIS|RESERVE|BADIS BENIDIR|BENIDIR BADIS/i.test(`${t.counterparty_name || ''} ${t.label || ''}`)
    );
    const invs = (inv || []) as unknown as AttachableInvoice[];
    setCredits(rows);
    setInvoices(invs);
    const proposals = proposeInvoices(rows, invs);
    setChoice(Object.fromEntries(Object.entries(proposals).filter(([, v]) => v)) as Record<string, string>);
    setState({});
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const byId = useMemo(() => new Map(invoices.map((i) => [i.id, i])), [invoices]);

  const attach = async (tx: UnjustifiedCredit) => {
    const inv = byId.get(choice[tx.id]);
    if (!inv) return;
    setState((s) => ({ ...s, [tx.id]: 'busy' }));
    try {
      await attachInvoiceToTransaction(tx.id, inv);
      setState((s) => ({ ...s, [tx.id]: 'done' }));
    } catch (e) {
      setState((s) => ({ ...s, [tx.id]: e instanceof Error ? e.message : 'Erreur' }));
    }
  };

  const noInvoice = async (tx: UnjustifiedCredit) => {
    const reason = prompt(`Pourquoi cet encaissement de ${EUR(tx.amount)} n'a pas de facture ?`, 'Pas une vente (ex. vérification de compte, remboursement)');
    if (reason === null) return;
    const { error } = await supabase
      .from('bank_transactions')
      .update({ reconciliation_status: 'ignored', note: reason.trim() || 'Pas de facture', updated_at: new Date().toISOString() })
      .eq('id', tx.id);
    if (error) return setState((s) => ({ ...s, [tx.id]: error.message }));
    setCredits((c) => c.filter((t) => t.id !== tx.id));
  };

  // Virement sans référence (ou référence inconnue) = recharge du
  // portefeuille d'un membre (0292) : attribution manuelle, crédit + bonus.
  const [members, setMembers] = useState<{ id: string; label: string }[] | null>(null);
  const [assigning, setAssigning] = useState<string | null>(null);
  const [member, setMember] = useState('');
  const openAssign = async (tx: UnjustifiedCredit) => {
    setAssigning(tx.id);
    setMember('');
    if (members) return;
    const { data } = await supabase
      .from('reseller_contacts')
      .select('profile:profiles(id, first_name, last_name, email, wallet_transfer_reference), reseller:resellers(company_name)');
    type Row = { profile: { id: string; first_name: string | null; last_name: string | null; email: string | null; wallet_transfer_reference: string | null } | null; reseller: { company_name: string | null } | null };
    const list = ((data || []) as unknown as Row[])
      .filter((r) => r.profile)
      .map((r) => ({
        id: r.profile!.id,
        label: [
          [r.profile!.first_name, r.profile!.last_name].filter(Boolean).join(' ') || r.profile!.email || '—',
          r.reseller?.company_name ? `(${r.reseller.company_name})` : '',
          r.profile!.wallet_transfer_reference || '',
        ].filter(Boolean).join(' '),
      }))
      .sort((a, b) => a.label.localeCompare(b.label, 'fr'));
    setMembers(list);
  };
  const assign = async (tx: UnjustifiedCredit) => {
    if (!member) return;
    const who = members?.find((m) => m.id === member)?.label || '';
    if (!confirm(`Créditer ${EUR(tx.amount)} (+ bonus virement) sur le portefeuille de ${who} ?`)) return;
    setState((s) => ({ ...s, [tx.id]: 'busy' }));
    const { data, error } = await supabase.rpc('credit_wallet_transfer', { p_bank_transaction_id: tx.id, p_profile_id: member });
    if (error) return setState((s) => ({ ...s, [tx.id]: error.message }));
    const bonus = Number((data as { bonus?: number } | null)?.bonus) || 0;
    setAssigning(null);
    setState((s) => ({ ...s, [tx.id]: 'done' }));
    setChoice((c) => ({ ...c, [tx.id]: `wallet:${bonus}` }));
  };

  const pending = credits.filter((t) => choice[t.id] && !choice[t.id].startsWith('wallet:') && state[t.id] !== 'done');
  const attachAll = async () => {
    if (!confirm(`Déposer ${pending.length} facture(s) sur les encaissements Qonto correspondants ?`)) return;
    setBulk(true);
    for (const tx of pending) await attach(tx);
    setBulk(false);
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-gray-900">Encaissements sans justificatif ({credits.length})</h3>
            <p className="mt-0.5 text-xs text-gray-500">
              Facture proposée automatiquement (rapprochement, client, montant) et déposée directement sur la transaction Qonto. PDF officiel Qonto si la facture y est émise, sinon PDF de l'admin.
            </p>
          </div>
          {pending.length > 0 && (
            <button onClick={attachAll} disabled={bulk} className="inline-flex items-center gap-1.5 rounded-lg bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50">
              {bulk ? <Loader2 className="h-4 w-4 animate-spin" /> : <Paperclip className="h-4 w-4" />}
              Joindre les {pending.length} facture(s) proposée(s)
            </button>
          )}
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {loading ? (
          <p className="px-4 py-6 text-sm text-gray-500">Chargement…</p>
        ) : credits.length === 0 ? (
          <p className="px-4 py-6 text-sm text-gray-500">Tous les encaissements clients ont un justificatif.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-gray-100 text-xs text-gray-500">
                <tr>
                  <th className="px-4 py-2 text-left font-medium">Date</th>
                  <th className="px-4 py-2 text-left font-medium">Payeur</th>
                  <th className="px-4 py-2 text-right font-medium">Montant</th>
                  <th className="px-4 py-2 text-left font-medium">Facture</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {credits.map((tx) => {
                  const cands = candidatesFor(tx, invoices).slice(0, 8);
                  const st = state[tx.id];
                  const inv = byId.get(choice[tx.id]);
                  return (
                    <tr key={tx.id}>
                      <td className="whitespace-nowrap px-4 py-2 text-gray-600">{day(tx.settled_at || tx.emitted_at)}</td>
                      <td className="px-4 py-2 text-gray-900">{tx.counterparty_name || tx.label}</td>
                      <td className="whitespace-nowrap px-4 py-2 text-right tabular-nums font-medium">{EUR(tx.amount)}</td>
                      <td className="px-4 py-2">
                        {cands.length ? (
                          <select
                            value={choice[tx.id] || ''}
                            onChange={(e) => setChoice((c) => ({ ...c, [tx.id]: e.target.value }))}
                            disabled={st === 'busy' || st === 'done'}
                            className="h-8 max-w-[22rem] rounded-lg border border-gray-200 bg-white px-2 text-xs text-gray-700"
                          >
                            <option value="">— aucune —</option>
                            {cands.map((c) => (
                              <option key={c.invoice.id} value={c.invoice.id}>
                                {invoiceLabel(c.invoice)} · {EUR(c.invoice.total_amount)} · {invoiceClientName(c.invoice)} ({c.reason})
                              </option>
                            ))}
                          </select>
                        ) : (
                          <span className="text-xs text-amber-700">Aucune facture trouvée</span>
                        )}
                        {inv && Math.abs(Number(inv.total_amount) - Number(tx.amount)) >= 0.005 && st !== 'done' && (
                          <p className="mt-0.5 text-[11px] text-gray-500">Facture de {EUR(inv.total_amount)} réglée en plusieurs paiements</p>
                        )}
                        {assigning === tx.id && st !== 'done' && (
                          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                            {members ? (
                              <select value={member} onChange={(e) => setMember(e.target.value)} className="h-8 max-w-[22rem] rounded-lg border border-gray-200 bg-white px-2 text-xs text-gray-700">
                                <option value="">Membre à créditer…</option>
                                {members.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                              </select>
                            ) : (
                              <Loader2 className="h-4 w-4 animate-spin text-gray-400" />
                            )}
                            <button onClick={() => assign(tx)} disabled={!member || st === 'busy'} className="rounded-lg bg-gray-900 px-2.5 py-1 text-xs font-medium text-white hover:bg-gray-800 disabled:opacity-40">Créditer</button>
                            <button onClick={() => setAssigning(null)} className="rounded-lg px-2 py-1 text-xs text-gray-500 hover:bg-gray-100">Annuler</button>
                          </div>
                        )}
                        {st && st !== 'busy' && st !== 'done' && <p className="mt-0.5 text-[11px] text-red-600">{st}</p>}
                      </td>
                      <td className="whitespace-nowrap px-4 py-2 text-right">
                        {st === 'done' ? (
                          <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700">
                            <CheckCircle2 className="h-4 w-4" />
                            {choice[tx.id]?.startsWith('wallet:') ? `Portefeuille crédité${Number(choice[tx.id].slice(7)) > 0 ? ` (+${EUR(Number(choice[tx.id].slice(7)))} de bonus)` : ''}` : 'Déposée'}
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5">
                          <button
                            onClick={() => openAssign(tx)}
                            disabled={st === 'busy' || bulk}
                            title="Virement d'un membre pour recharger son portefeuille (sans référence ou référence inconnue) : crédit + bonus virement"
                            className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-gray-500 hover:bg-gray-100 hover:text-gray-800 disabled:opacity-40"
                          >
                            <Wallet className="h-3.5 w-3.5" /> Recharge portefeuille
                          </button>
                          <button
                            onClick={() => noInvoice(tx)}
                            disabled={st === 'busy' || bulk}
                            title="Encaissement qui n'est pas une vente (vérification de compte, remboursement…) : retiré de la liste"
                            className="rounded-lg px-2 py-1 text-xs text-gray-500 hover:bg-gray-100 hover:text-gray-800 disabled:opacity-40"
                          >
                            Pas de facture
                          </button>
                          <button
                            onClick={() => attach(tx)}
                            disabled={!inv || st === 'busy' || bulk}
                            className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40"
                          >
                            {st === 'busy' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Paperclip className="h-3.5 w-3.5" />} Joindre
                          </button>
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
};
