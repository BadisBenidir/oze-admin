import React, { useMemo, useState } from 'react';
import { Banknote, Loader2, Pencil, Plus, Trash2, TrendingUp, X } from 'lucide-react';
import { supabase } from '../../../lib/supabase';
import { Card, CardContent, CardHeader } from '../../ui/Card';
import { AccountingKpiCard } from './AccountingKpiCard';
import { AccountingManualRevenue } from '../../../hooks/useAccountingRawData';
import { AccountingPeriod, isWithinRange } from '../../../utils/accountingPeriods';
import { computeManualRevenueTotals, manualRevenueDate } from '../../../utils/accountingCalc';

const EUR = (n: number) => (Number(n) || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
const todayIso = () => new Date().toISOString().slice(0, 10);

export const MANUAL_REVENUE_CATEGORIES: Record<AccountingManualRevenue['category'], string> = {
  vente: 'Vente',
  prestation: 'Prestation',
  autre: 'Autre',
  remboursement: 'Remboursement client',
};

export const MANUAL_REVENUE_METHODS: Record<NonNullable<AccountingManualRevenue['payment_method']>, string> = {
  virement: 'Virement',
  paypal: 'PayPal',
  especes: 'Espèces',
  autre: 'Autre',
};

interface OtherRevenuesTabProps {
  revenues: AccountingManualRevenue[];
  period: AccountingPeriod;
  /** Recharge les données comptables après une saisie. */
  onChanged: () => Promise<void>;
}

/** Comptabilité → Autres revenus (0275) : encaissements hors plateforme
 * (virements, PayPal, prestations) saisis à la main, comptés dans le CA de
 * la vue d'ensemble et dans le Journal des ventes. */
export const OtherRevenuesTab: React.FC<OtherRevenuesTabProps> = ({ revenues, period, onChanged }) => {
  const [editing, setEditing] = useState<AccountingManualRevenue | 'new' | null>(null);

  const rows = useMemo(
    () => revenues.filter((r) => isWithinRange(manualRevenueDate(r), period.range)).sort((a, b) => b.revenue_date.localeCompare(a.revenue_date)),
    [revenues, period.range]
  );
  const totals = useMemo(() => computeManualRevenueTotals(revenues, period.range), [revenues, period.range]);
  const mom = useMemo(() => (period.momRange ? computeManualRevenueTotals(revenues, period.momRange) : null), [revenues, period.momRange]);
  const prestations = rows.filter((r) => r.category === 'prestation').reduce((s, r) => s + r.amount, 0);
  const refunds = rows.filter((r) => r.category === 'remboursement').reduce((s, r) => s + r.amount, 0);

  const remove = async (r: AccountingManualRevenue) => {
    if (!window.confirm(`Supprimer « ${r.label} » (${r.client_name}, ${EUR(r.amount)}) ?`)) return;
    const { error } = await supabase.from('manual_revenues').delete().eq('id', r.id);
    if (error) return alert(error.message);
    await onChanged();
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <AccountingKpiCard
          label="Autres revenus (période)"
          value={EUR(totals.revenue)}
          icon={Banknote}
          tone="green"
          hint={`${totals.count} encaissement${totals.count > 1 ? 's' : ''}${refunds ? `, remboursements déduits (${EUR(refunds)})` : ''} · compté${totals.count > 1 ? 's' : ''} dans le CA total`}
          deltaMoM={mom && mom.revenue ? ((totals.revenue - mom.revenue) / mom.revenue) * 100 : undefined}
        />
        <AccountingKpiCard label="Dont prestations" value={EUR(prestations)} icon={TrendingUp} />
        <AccountingKpiCard label="Coût d'achat" value={EUR(totals.cogs)} icon={Banknote} hint="Ventes d'articles uniquement" />
        <AccountingKpiCard
          label="Marge"
          value={EUR(totals.margin)}
          icon={TrendingUp}
          tone={totals.margin >= 0 ? 'green' : 'red'}
          hint={totals.marginRate !== null ? `Taux de marge : ${totals.marginRate.toFixed(1)}%` : undefined}
        />
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-base font-semibold text-gray-900">Revenus hors plateforme</h3>
              <p className="text-sm text-gray-500">Virements, PayPal, prestations encaissés sur Qonto. Franchise de TVA : montant = montant encaissé. Les remboursements clients hors plateforme sont déduits du CA (montant négatif).</p>
            </div>
            <button onClick={() => setEditing('new')} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-gray-900 px-3 text-sm font-medium text-white hover:bg-gray-800">
              <Plus className="h-4 w-4" /> Ajouter un revenu
            </button>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {rows.length === 0 ? (
            <p className="py-12 text-center text-sm text-gray-500">Aucun revenu sur la période.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-100 text-xs text-gray-500">
                    <th className="px-4 py-2.5 text-left font-medium">Date</th>
                    <th className="px-4 py-2.5 text-left font-medium">Client</th>
                    <th className="px-4 py-2.5 text-left font-medium">Libellé</th>
                    <th className="px-4 py-2.5 text-left font-medium">Catégorie</th>
                    <th className="px-4 py-2.5 text-left font-medium">Paiement</th>
                    <th className="px-4 py-2.5 text-right font-medium">Montant</th>
                    <th className="px-4 py-2.5 text-right font-medium">Coût d'achat</th>
                    <th className="px-4 py-2.5" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} className="border-b border-gray-50 hover:bg-gray-50">
                      <td className="whitespace-nowrap px-4 py-2.5 text-sm text-gray-600">{new Date(manualRevenueDate(r)).toLocaleDateString('fr-FR')}</td>
                      <td className="px-4 py-2.5 text-sm text-gray-900">{r.client_name}</td>
                      <td className="px-4 py-2.5 text-sm text-gray-700">
                        {r.label}
                        {r.notes && <p className="text-xs text-gray-500">{r.notes}</p>}
                      </td>
                      <td className="px-4 py-2.5 text-sm text-gray-600">{MANUAL_REVENUE_CATEGORIES[r.category]}</td>
                      <td className="px-4 py-2.5 text-sm text-gray-600">{r.payment_method ? MANUAL_REVENUE_METHODS[r.payment_method] : '—'}</td>
                      <td className={`whitespace-nowrap px-4 py-2.5 text-right text-sm font-medium tabular-nums ${r.amount < 0 ? 'text-red-600' : 'text-gray-900'}`}>{EUR(r.amount)}</td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-right text-sm tabular-nums text-gray-600">{r.purchase_price != null ? EUR(r.purchase_price) : '—'}</td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-right">
                        <button onClick={() => setEditing(r)} className="rounded p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700" title="Modifier">
                          <Pencil className="h-4 w-4" />
                        </button>
                        <button onClick={() => remove(r)} className="rounded p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600" title="Supprimer">
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t border-gray-200">
                    <td colSpan={5} className="px-4 py-2.5 text-sm font-semibold text-gray-900">Total</td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-right text-sm font-semibold tabular-nums text-gray-900">{EUR(totals.revenue)}</td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-right text-sm font-semibold tabular-nums text-gray-600">{EUR(totals.cogs)}</td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {editing && (
        <RevenueFormModal
          revenue={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await onChanged();
          }}
        />
      )}
    </div>
  );
};

const inputCls = 'mt-1 h-9 w-full rounded-lg border border-gray-200 bg-white px-2.5 text-sm font-normal text-gray-900 focus:border-gray-400 focus:outline-none';
const parseAmount = (v: string) => Number(v.replace(/\s/g, '').replace(',', '.'));

const RevenueFormModal: React.FC<{ revenue: AccountingManualRevenue | null; onClose: () => void; onSaved: () => Promise<void> }> = ({ revenue, onClose, onSaved }) => {
  const [form, setForm] = useState({
    revenue_date: revenue?.revenue_date ?? todayIso(),
    client_name: revenue?.client_name ?? '',
    label: revenue?.label ?? '',
    amount: revenue ? String(Math.abs(revenue.amount)).replace('.', ',') : '',
    category: revenue?.category ?? ('vente' as AccountingManualRevenue['category']),
    payment_method: revenue?.payment_method ?? ('virement' as NonNullable<AccountingManualRevenue['payment_method']>),
    purchase_price: revenue?.purchase_price != null ? String(revenue.purchase_price).replace('.', ',') : '',
    qonto_transaction_id: revenue?.qonto_transaction_id ?? '',
    notes: revenue?.notes ?? '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    const amount = parseAmount(form.amount);
    const purchase = form.purchase_price.trim() ? parseAmount(form.purchase_price) : null;
    if (!form.client_name.trim()) return setError('Le client est obligatoire.');
    if (!form.label.trim()) return setError('Le libellé est obligatoire.');
    if (!form.amount.trim() || Number.isNaN(amount) || amount <= 0) return setError('Montant invalide.');
    const isRefund = form.category === 'remboursement';
    if (isRefund && purchase !== null) return setError("Pas de coût d'achat sur un remboursement.");
    if (purchase !== null && (Number.isNaN(purchase) || purchase < 0)) return setError("Coût d'achat invalide.");
    setBusy(true);
    setError(null);
    const payload = {
      revenue_date: form.revenue_date,
      client_name: form.client_name.trim(),
      label: form.label.trim(),
      // Remboursement client : saisi en positif, enregistré en négatif (0278).
      amount: isRefund ? -amount : amount,
      category: form.category,
      payment_method: form.payment_method || null,
      purchase_price: purchase,
      qonto_transaction_id: form.qonto_transaction_id.trim() || null,
      notes: form.notes.trim() || null,
    };
    const { error: e } = revenue
      ? await supabase.from('manual_revenues').update(payload).eq('id', revenue.id)
      : await supabase.from('manual_revenues').insert(payload);
    if (e) {
      setBusy(false);
      return setError(e.message);
    }
    await onSaved();
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="fixed inset-0 bg-black/40" onClick={onClose} />
      <div className="flex min-h-full items-center justify-center p-4">
        <div className="relative w-full max-w-lg rounded-2xl bg-white shadow-xl">
          <div className="flex items-center justify-between border-b border-gray-100 p-4">
            <h3 className="text-lg font-semibold text-gray-900">{revenue ? 'Modifier le revenu' : 'Ajouter un revenu'}</h3>
            <button onClick={onClose} className="rounded-lg p-1 text-gray-400 hover:text-gray-600"><X className="h-5 w-5" /></button>
          </div>
          <form onSubmit={submit} className="space-y-3 p-4">
            <div className="grid grid-cols-2 gap-3">
              <label className="block text-sm font-medium text-gray-700">
                {form.category === 'remboursement' ? 'Date du remboursement' : "Date d'encaissement"}
                <input type="date" value={form.revenue_date} onChange={(e) => set('revenue_date', e.target.value)} className={inputCls} />
              </label>
              <label className="block text-sm font-medium text-gray-700">
                Client
                <input autoFocus value={form.client_name} onChange={(e) => set('client_name', e.target.value)} className={inputCls} />
              </label>
            </div>
            <label className="block text-sm font-medium text-gray-700">
              Libellé
              <input value={form.label} onChange={(e) => set('label', e.target.value)} placeholder="Ex. : vente sac Chanel (virement), accompagnement octobre…" className={inputCls} />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block text-sm font-medium text-gray-700">
                Catégorie
                <select value={form.category} onChange={(e) => set('category', e.target.value)} className={inputCls}>
                  {Object.entries(MANUAL_REVENUE_CATEGORIES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </label>
              <label className="block text-sm font-medium text-gray-700">
                Moyen de paiement
                <select value={form.payment_method} onChange={(e) => set('payment_method', e.target.value)} className={inputCls}>
                  {Object.entries(MANUAL_REVENUE_METHODS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </label>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <label className="block text-sm font-medium text-gray-700">
                {form.category === 'remboursement' ? 'Montant remboursé (€)' : 'Montant encaissé (€)'}
                <input inputMode="decimal" value={form.amount} onChange={(e) => set('amount', e.target.value)} placeholder="0,00" className={inputCls} />
              </label>
              <label className="block text-sm font-medium text-gray-700">
                Coût d'achat (€)
                <input
                  inputMode="decimal"
                  value={form.purchase_price}
                  onChange={(e) => set('purchase_price', e.target.value)}
                  placeholder={form.category === 'prestation' ? 'Aucun' : 'Facultatif'}
                  className={inputCls}
                />
              </label>
            </div>
            <label className="block text-sm font-medium text-gray-700">
              Réf. transaction Qonto (facultatif)
              <input value={form.qonto_transaction_id} onChange={(e) => set('qonto_transaction_id', e.target.value)} className={inputCls} />
            </label>
            <label className="block text-sm font-medium text-gray-700">
              Note (facultatif)
              <textarea value={form.notes} onChange={(e) => set('notes', e.target.value)} rows={2} className="mt-1 w-full rounded-lg border border-gray-200 p-2.5 text-sm font-normal focus:border-gray-400 focus:outline-none" />
            </label>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <div className="flex justify-end gap-2 pt-1">
              <button type="button" onClick={onClose} className="rounded-lg px-4 py-2 text-sm text-gray-600 hover:bg-gray-100">Annuler</button>
              <button type="submit" disabled={busy} className="inline-flex items-center gap-1.5 rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50">
                {busy && <Loader2 className="h-4 w-4 animate-spin" />} Enregistrer
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};

export default OtherRevenuesTab;
