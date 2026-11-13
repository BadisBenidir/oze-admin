import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, FileText, Loader2, Percent, RefreshCw, Save, Send } from 'lucide-react';
import { supabase } from '../../../lib/supabase';
import { Card, CardContent, CardHeader } from '../../ui/Card';
import { AccountingKpiCard } from './AccountingKpiCard';
import { Expense } from '../../../hooks/useExpenses';
import { VatSale, expenseDeductibleVat } from '../../../utils/accountingCalc';
import { VatSettings, vatRateAt } from '../../../utils/vat';
import { monthKey } from '../../../utils/accountingPeriods';
import { buildInvoiceItems, generateInvoicePdf, InvoiceBillingDetails, InvoiceSourceItem } from '../../../utils/generateInvoicePdf';
import { CREDIT_NOTE_SELECT, CreditNoteRow, advanceInvoiceItems, creditNotePdfData } from '../../../hooks/useInvoices';

const EUR = (n: number) => (Number(n) || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const monthLabel = (ym: string) => `${MONTHS[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;
const inputCls = 'h-9 w-full rounded-lg border border-gray-200 bg-white px-2.5 text-sm text-gray-900 focus:border-gray-400 focus:outline-none';

/** ISO → valeur d'un <input type="datetime-local"> en heure de Paris (secondes comprises). */
const toParisLocal = (iso: string | null) => {
  if (!iso) return '';
  const parts = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).format(new Date(iso));
  return parts.replace(' ', 'T');
};
/** Valeur locale (heure de Paris) → ISO UTC. */
const fromParisLocal = (local: string) => {
  if (!local) return null;
  const asUtc = new Date(`${local.length === 16 ? `${local}:00` : local}Z`);
  const paris = new Date(asUtc.toLocaleString('en-US', { timeZone: 'Europe/Paris' }));
  const utc = new Date(asUtc.toLocaleString('en-US', { timeZone: 'UTC' }));
  return new Date(asUtc.getTime() - (paris.getTime() - utc.getTime())).toISOString();
};
const parisDate = (iso: string) => new Date(iso).toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris', day: '2-digit', month: '2-digit', year: 'numeric' });

type DeclStatus = 'a_declarer' | 'declaree' | 'payee';
const STATUS_LABELS: Record<DeclStatus, string> = { a_declarer: 'À déclarer', declaree: 'Déclarée', payee: 'Payée' };

interface Declaration {
  period: string;
  status: DeclStatus;
  import_autoliquidation: number;
  declared_at: string | null;
  paid_at: string | null;
  paid_amount: number | null;
  notes: string | null;
}

interface Rectification {
  id: string;
  invoice_id: string | null;
  credit_note_id: string | null;
  original_number: string;
  original_issued_at: string;
  operation_at: string;
  amount_ttc: number;
  vat_rate: number;
  amount_ht: number;
  vat_amount: number;
  status: 'draft' | 'issued';
  rectification_number: string | null;
  issued_at: string | null;
}

interface VatTabProps {
  settings: VatSettings | null;
  onSettingsChanged: () => Promise<void>;
  /** TVA collectée par vente (toHtData). */
  vatSales: VatSale[];
  /** Charges (montants TTC, avec la TVA Qonto du débit relié). */
  expenses: Expense[];
}

/** Comptabilité → TVA (0280 / 0281) : réglage de la bascule (franchise →
 * assujetti), TVA collectée / déductible / nette par mois, statut des
 * déclarations et factures émises sans TVA à rectifier. */
export const VatTab: React.FC<VatTabProps> = ({ settings, onSettingsChanged, vatSales, expenses }) => {
  const [declarations, setDeclarations] = useState<Record<string, Declaration>>({});
  const [rectifications, setRectifications] = useState<Rectification[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [d, r] = await Promise.all([
      supabase.from('vat_declarations').select('*'),
      supabase.from('vat_invoice_rectifications').select('*').order('original_issued_at'),
    ]);
    if (d.error || r.error) setError((d.error || r.error)!.message);
    const map: Record<string, Declaration> = {};
    for (const row of (d.data || []) as Declaration[]) map[row.period.slice(0, 7)] = { ...row, import_autoliquidation: Number(row.import_autoliquidation) || 0 };
    setDeclarations(map);
    setRectifications(((r.data || []) as Rectification[]).map((x) => ({ ...x, amount_ttc: Number(x.amount_ttc), amount_ht: Number(x.amount_ht), vat_amount: Number(x.vat_amount) })));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const start = settings?.regime === 'assujetti' ? settings.vat_start_at : null;

  // Mois depuis la bascule jusqu'au mois courant.
  const rows = useMemo(() => {
    if (!start) return [];
    const keys: string[] = [];
    const d = new Date(start);
    let cur = new Date(d.getFullYear(), d.getMonth(), 1);
    const now = new Date();
    while (cur <= now) {
      keys.push(`${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, '0')}`);
      cur = new Date(cur.getFullYear(), cur.getMonth() + 1, 1);
    }
    const collected: Record<string, { ht: number; vat: number }> = {};
    for (const s of vatSales) {
      const k = monthKey(s.date);
      collected[k] = collected[k] || { ht: 0, vat: 0 };
      collected[k].ht += s.ht;
      collected[k].vat += s.vat;
    }
    const deductible: Record<string, number> = {};
    for (const e of expenses) {
      if ((e.review_status ?? 'validated') !== 'validated') continue;
      const v = expenseDeductibleVat(e, settings);
      if (v) deductible[e.spent_at.slice(0, 7)] = (deductible[e.spent_at.slice(0, 7)] || 0) + v;
    }
    return keys.map((ym) => {
      const decl = declarations[ym];
      const autoliq = decl?.import_autoliquidation || 0;
      const coll = collected[ym]?.vat || 0;
      const ded = deductible[ym] || 0;
      return {
        ym,
        ht: collected[ym]?.ht || 0,
        collected: coll,
        deductible: ded,
        autoliq,
        // Autoliquidation : collectée = déduite, impact net nul.
        net: coll + autoliq - (ded + autoliq),
        decl,
      };
    });
  }, [start, vatSales, expenses, declarations, settings]);

  const toProvision = rows.filter((r) => (r.decl?.status ?? 'a_declarer') === 'a_declarer').reduce((s, r) => s + r.net, 0);
  const declaredUnpaid = rows.filter((r) => r.decl?.status === 'declaree').reduce((s, r) => s + r.net, 0);
  const drafts = rectifications.filter((r) => r.status === 'draft');

  const saveDeclaration = async (ym: string, patch: Partial<Declaration>) => {
    setBusy(`decl-${ym}`);
    setError(null);
    const current = declarations[ym];
    const { error: e } = await supabase.from('vat_declarations').upsert({
      period: `${ym}-01`,
      status: current?.status ?? 'a_declarer',
      import_autoliquidation: current?.import_autoliquidation ?? 0,
      declared_at: current?.declared_at ?? null,
      paid_at: current?.paid_at ?? null,
      paid_amount: current?.paid_amount ?? null,
      notes: current?.notes ?? null,
      ...patch,
    });
    setBusy(null);
    if (e) return setError(e.message);
    await load();
  };

  const refreshRectifications = async () => {
    setBusy('refresh');
    setError(null);
    const { error: e } = await supabase.rpc('vat_refresh_rectifications');
    setBusy(null);
    if (e) return setError(e.message);
    await load();
  };

  const issue = async (r: Rectification) => {
    if (!window.confirm(`Émettre la facture rectificative de ${r.original_number} (${EUR(r.amount_ttc)} TTC, dont TVA ${EUR(r.vat_amount)}) ?\n\nUn numéro définitif lui est attribué. Rien n'est envoyé au client.`)) return;
    setBusy(r.id);
    setError(null);
    const { error: e } = await supabase.rpc('vat_issue_rectification', { p_id: r.id });
    setBusy(null);
    if (e) return setError(e.message);
    await load();
  };

  const pdf = async (r: Rectification) => {
    setBusy(`pdf-${r.id}`);
    setError(null);
    try {
      await downloadRectificationPdf(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'PDF impossible');
    }
    setBusy(null);
  };

  return (
    <div className="space-y-6">
      {error && <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">Erreur : {error}</p>}

      {start && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <AccountingKpiCard
            label={`TVA à provisionner depuis le ${parisDate(start).slice(0, 5)}`}
            value={EUR(toProvision)}
            icon={Percent}
            tone={toProvision > 0 ? 'red' : 'default'}
            hint="TVA nette des mois pas encore déclarés"
          />
          <AccountingKpiCard label="Déclarée, à payer" value={EUR(declaredUnpaid)} icon={Percent} />
          <AccountingKpiCard
            label="Factures à rectifier"
            value={String(drafts.length)}
            icon={FileText}
            tone={drafts.length ? 'red' : 'default'}
            hint={drafts.length ? `TVA ${EUR(drafts.reduce((s, r) => s + r.vat_amount, 0))} sur ${EUR(drafts.reduce((s, r) => s + r.amount_ttc, 0))} TTC` : 'Aucune'}
          />
        </div>
      )}

      <VatSettingsCard settings={settings} onSaved={async () => { await onSettingsChanged(); await refreshRectifications(); }} />

      {start && (
        <Card>
          <CardHeader>
            <h3 className="text-base font-semibold text-gray-900">TVA par mois</h3>
            <p className="text-sm text-gray-500">
              Depuis la bascule. CA HT et TVA collectée : ventes encaissées (prix inchangés, désormais TTC). TVA déductible : charges validées, TVA saisie sur la charge ou lue par Qonto sur le débit relié.
            </p>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-100 text-xs text-gray-500">
                    <th className="px-3 py-2.5 text-left font-medium">Mois</th>
                    <th className="px-3 py-2.5 text-right font-medium">CA HT</th>
                    <th className="px-3 py-2.5 text-right font-medium">TVA collectée</th>
                    <th className="px-3 py-2.5 text-right font-medium">TVA déductible</th>
                    <th className="px-3 py-2.5 text-right font-medium" title="Collectée = déduite : impact net nul">TVA import autoliquidée</th>
                    <th className="px-3 py-2.5 text-right font-medium">TVA nette</th>
                    <th className="px-3 py-2.5 text-left font-medium">Statut</th>
                    <th className="px-3 py-2.5 text-left font-medium">Déclarée le</th>
                    <th className="px-3 py-2.5 text-left font-medium">Payée le</th>
                    <th className="px-3 py-2.5 text-right font-medium">Montant payé</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <DeclarationRow key={r.ym} row={r} busy={busy === `decl-${r.ym}`} onSave={(patch) => saveDeclaration(r.ym, patch)} />
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t border-gray-200 text-sm font-semibold text-gray-900">
                    <td className="px-3 py-2.5">Total</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{EUR(rows.reduce((s, r) => s + r.ht, 0))}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{EUR(rows.reduce((s, r) => s + r.collected, 0))}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{EUR(rows.reduce((s, r) => s + r.deductible, 0))}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{EUR(rows.reduce((s, r) => s + r.autoliq, 0))}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{EUR(rows.reduce((s, r) => s + r.net, 0))}</td>
                    <td colSpan={4} />
                  </tr>
                </tfoot>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-base font-semibold text-gray-900">Factures à rectifier</h3>
              <p className="text-sm text-gray-500">
                Factures et avoirs émis sans TVA alors que l'opération est postérieure à la bascule. Chaque rectificative reste en brouillon jusqu'à ce que vous l'émettiez : rien n'est envoyé au client.
              </p>
            </div>
            <button onClick={refreshRectifications} disabled={busy === 'refresh'} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50">
              {busy === 'refresh' ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Recalculer la liste
            </button>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {rectifications.length === 0 ? (
            <p className="py-10 text-center text-sm text-gray-500">Aucune facture à rectifier.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-100 text-xs text-gray-500">
                    <th className="px-3 py-2.5 text-left font-medium">Document d'origine</th>
                    <th className="px-3 py-2.5 text-left font-medium">Émis le</th>
                    <th className="px-3 py-2.5 text-left font-medium">Opération</th>
                    <th className="px-3 py-2.5 text-right font-medium">TTC</th>
                    <th className="px-3 py-2.5 text-right font-medium">HT</th>
                    <th className="px-3 py-2.5 text-right font-medium">TVA</th>
                    <th className="px-3 py-2.5 text-left font-medium">Rectificative</th>
                    <th className="px-3 py-2.5" />
                  </tr>
                </thead>
                <tbody>
                  {rectifications.map((r) => (
                    <tr key={r.id} className="border-b border-gray-50 text-sm hover:bg-gray-50">
                      <td className="px-3 py-2.5 font-medium text-gray-900">{r.original_number}{r.credit_note_id && <span className="ml-1 text-xs text-gray-500">(avoir)</span>}</td>
                      <td className="px-3 py-2.5 text-gray-600">{parisDate(r.original_issued_at)}</td>
                      <td className="px-3 py-2.5 text-gray-600">{parisDate(r.operation_at)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-gray-900">{EUR(r.amount_ttc)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-gray-600">{EUR(r.amount_ht)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-gray-600">{EUR(r.vat_amount)}</td>
                      <td className="px-3 py-2.5">
                        {r.status === 'issued' ? (
                          <span className="text-green-700">{r.rectification_number} · {r.issued_at && parisDate(r.issued_at)}</span>
                        ) : (
                          <span className="rounded bg-amber-50 px-1.5 py-0.5 text-xs text-amber-700">Brouillon</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-right">
                        <div className="flex justify-end gap-1.5">
                          <button onClick={() => pdf(r)} disabled={busy === `pdf-${r.id}`} className="inline-flex h-8 items-center gap-1 rounded-lg border border-gray-200 px-2.5 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-50">
                            {busy === `pdf-${r.id}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileText className="h-3.5 w-3.5" />}
                            {r.status === 'issued' ? 'PDF' : 'Aperçu'}
                          </button>
                          {r.status === 'draft' && (
                            <button onClick={() => issue(r)} disabled={busy === r.id} className="inline-flex h-8 items-center gap-1 rounded-lg bg-gray-900 px-2.5 text-xs font-medium text-white hover:bg-gray-800 disabled:opacity-50">
                              {busy === r.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />} Émettre
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

type MonthRow = { ym: string; ht: number; collected: number; deductible: number; autoliq: number; net: number; decl?: Declaration };

const DeclarationRow: React.FC<{ row: MonthRow; busy: boolean; onSave: (patch: Partial<Declaration>) => void }> = ({ row, busy, onSave }) => {
  const [autoliq, setAutoliq] = useState(String(row.autoliq || '').replace('.', ','));
  const [paidAmount, setPaidAmount] = useState(row.decl?.paid_amount != null ? String(row.decl.paid_amount).replace('.', ',') : '');
  useEffect(() => {
    setAutoliq(row.autoliq ? String(row.autoliq).replace('.', ',') : '');
    setPaidAmount(row.decl?.paid_amount != null ? String(row.decl.paid_amount).replace('.', ',') : '');
  }, [row.autoliq, row.decl?.paid_amount]);
  const num = (v: string) => (v.trim() ? Number(v.replace(/\s/g, '').replace(',', '.')) : null);
  const status = row.decl?.status ?? 'a_declarer';
  const cell = 'h-8 rounded-md border border-gray-200 bg-white px-2 text-xs focus:border-gray-400 focus:outline-none';
  return (
    <tr className="border-b border-gray-50 text-sm hover:bg-gray-50">
      <td className="px-3 py-2 capitalize text-gray-900">{monthLabel(row.ym)} {busy && <Loader2 className="ml-1 inline h-3.5 w-3.5 animate-spin text-gray-400" />}</td>
      <td className="px-3 py-2 text-right tabular-nums text-gray-600">{EUR(row.ht)}</td>
      <td className="px-3 py-2 text-right tabular-nums text-gray-900">{EUR(row.collected)}</td>
      <td className="px-3 py-2 text-right tabular-nums text-gray-600">{EUR(row.deductible)}</td>
      <td className="px-3 py-2 text-right">
        <input
          inputMode="decimal"
          value={autoliq}
          onChange={(e) => setAutoliq(e.target.value)}
          onBlur={() => {
            const v = num(autoliq) ?? 0;
            if (!Number.isNaN(v) && v !== row.autoliq) onSave({ import_autoliquidation: v });
          }}
          placeholder="0,00"
          className={`${cell} w-24 text-right`}
        />
      </td>
      <td className={`px-3 py-2 text-right font-medium tabular-nums ${row.net >= 0 ? 'text-gray-900' : 'text-green-700'}`} title={row.net < 0 ? 'Crédit de TVA' : undefined}>{EUR(row.net)}</td>
      <td className="px-3 py-2">
        <select value={status} onChange={(e) => onSave({ status: e.target.value as DeclStatus })} className={cell}>
          {(Object.keys(STATUS_LABELS) as DeclStatus[]).map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
        </select>
      </td>
      <td className="px-3 py-2"><input type="date" value={row.decl?.declared_at || ''} onChange={(e) => onSave({ declared_at: e.target.value || null })} className={cell} /></td>
      <td className="px-3 py-2"><input type="date" value={row.decl?.paid_at || ''} onChange={(e) => onSave({ paid_at: e.target.value || null })} className={cell} /></td>
      <td className="px-3 py-2 text-right">
        <input
          inputMode="decimal"
          value={paidAmount}
          onChange={(e) => setPaidAmount(e.target.value)}
          onBlur={() => {
            const v = num(paidAmount);
            if (v === null || !Number.isNaN(v)) onSave({ paid_amount: v });
          }}
          placeholder="—"
          className={`${cell} w-24 text-right`}
        />
      </td>
    </tr>
  );
};

const VatSettingsCard: React.FC<{ settings: VatSettings | null; onSaved: () => Promise<void> }> = ({ settings, onSaved }) => {
  const [form, setForm] = useState({ regime: 'franchise', start: '', rate: '20', number: '', note: '' });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => {
    if (!settings) return;
    setForm({
      regime: settings.regime,
      start: toParisLocal(settings.vat_start_at),
      rate: String(settings.vat_rate).replace('.', ','),
      number: settings.vat_number || '',
      note: settings.note || '',
    });
  }, [settings]);
  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const save = async (ev: React.FormEvent) => {
    ev.preventDefault();
    const rate = Number(form.rate.replace(',', '.'));
    if (Number.isNaN(rate) || rate < 0 || rate >= 100) return setMessage('Taux invalide.');
    if (form.regime === 'assujetti' && !form.start) return setMessage('Date de bascule obligatoire.');
    if (!window.confirm('Modifier le réglage TVA ? Le CA HT, la TVA et la liste des factures à rectifier seront recalculés. Les factures déjà émises ne changent pas.')) return;
    setBusy(true);
    setMessage(null);
    const { error } = await supabase
      .from('vat_settings')
      .update({ regime: form.regime, vat_start_at: fromParisLocal(form.start), vat_rate: rate, vat_number: form.number.trim() || null, note: form.note.trim() || null })
      .eq('id', true);
    if (error) {
      setBusy(false);
      return setMessage(error.message);
    }
    await onSaved();
    setBusy(false);
    setMessage('Réglage enregistré.');
  };

  if (!settings) {
    return (
      <p className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
        <AlertTriangle className="h-4 w-4" /> Réglage TVA introuvable (migration 0280 non appliquée).
      </p>
    );
  }

  return (
    <Card>
      <CardHeader>
        <h3 className="text-base font-semibold text-gray-900">Réglage TVA</h3>
        <p className="text-sm text-gray-500">
          Franchise en base (art. 293 B) jusqu'à la date de bascule, TVA ensuite. Prix inchangés : ils deviennent TTC (HT = TTC / (1 + taux)). Taux actuel appliqué aux ventes du jour : {vatRateAt(settings, new Date())} %.
        </p>
      </CardHeader>
      <CardContent>
        <form onSubmit={save} className="grid grid-cols-1 gap-3 md:grid-cols-4">
          <label className="block text-xs font-medium text-gray-600">
            Régime
            <select value={form.regime} onChange={(e) => set('regime', e.target.value)} className={`${inputCls} mt-1`}>
              <option value="franchise">Franchise en base</option>
              <option value="assujetti">Assujetti à la TVA</option>
            </select>
          </label>
          <label className="block text-xs font-medium text-gray-600">
            Bascule (heure de Paris)
            <input type="datetime-local" step={1} value={form.start} onChange={(e) => set('start', e.target.value)} className={`${inputCls} mt-1`} />
          </label>
          <label className="block text-xs font-medium text-gray-600">
            Taux (%)
            <input inputMode="decimal" value={form.rate} onChange={(e) => set('rate', e.target.value)} className={`${inputCls} mt-1`} />
          </label>
          <label className="block text-xs font-medium text-gray-600">
            N° de TVA intracommunautaire
            <input value={form.number} onChange={(e) => set('number', e.target.value)} placeholder="FR…" className={`${inputCls} mt-1`} />
          </label>
          <label className="block text-xs font-medium text-gray-600 md:col-span-3">
            Note
            <input value={form.note} onChange={(e) => set('note', e.target.value)} className={`${inputCls} mt-1`} />
          </label>
          <div className="flex items-end">
            <button type="submit" disabled={busy} className="inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-lg bg-gray-900 px-3 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Enregistrer
            </button>
          </div>
          {message && <p className="text-sm text-gray-600 md:col-span-4">{message}</p>}
        </form>
      </CardContent>
    </Card>
  );
};

const paymentText = (stripe: string | null | undefined) => (stripe ? 'Carte bancaire (Stripe)' : 'Solde revendeur (wallet)');

/** PDF d'une rectificative (brouillon : « BROUILLON » à la place du numéro). */
const downloadRectificationPdf = async (r: Rectification) => {
  const number = r.rectification_number || 'BROUILLON';
  const issuedAt = r.issued_at || new Date().toISOString();
  const rectification = { originalNumber: r.original_number, originalIssuedAt: r.original_issued_at };

  if (r.credit_note_id) {
    const { data, error } = await supabase.from('credit_notes').select(CREDIT_NOTE_SELECT).eq('id', r.credit_note_id).maybeSingle();
    if (error || !data) throw new Error(error?.message || 'Avoir introuvable');
    const base = creditNotePdfData(data as unknown as CreditNoteRow);
    await generateInvoicePdf({ ...base, invoiceNumber: number, issuedAt, vatRate: r.vat_rate, rectification });
    return;
  }

  const { data, error } = await supabase
    .from('invoices')
    .select(
      'invoice_number, issued_at, total_amount, legal_status, billing_details, kind, ' +
        'order:orders!invoices_order_id_fkey(order_number, created_at, stripe_payment_intent_id, late_fee_amount, late_fee_days, order_items(product_snapshot, unit_price, quantity, line_total, status, cancelled_at, insured, insurance_cost, entrupy_requested, entrupy_cost)), ' +
        'sourcing_mission:b2b_sourcing_missions(reference, title)'
    )
    .eq('id', r.invoice_id!)
    .maybeSingle();
  if (error || !data) throw new Error(error?.message || 'Facture introuvable');
  type Row = {
    invoice_number: string; issued_at: string; total_amount: number; kind: string;
    legal_status: 'individual' | 'sole_proprietorship' | 'company'; billing_details: InvoiceBillingDetails | null;
    order: { order_number: string; created_at: string; stripe_payment_intent_id: string | null; late_fee_amount: number | null; late_fee_days: number | null; order_items: InvoiceSourceItem[] } | null;
    sourcing_mission: { reference: string | null; title: string | null } | null;
  };
  const inv = data as unknown as Row;
  const isAdvance = inv.kind === 'advance';
  const ref = inv.sourcing_mission?.reference || inv.sourcing_mission?.title || '';
  await generateInvoicePdf({
    invoiceNumber: number,
    issuedAt,
    orderNumber: isAdvance ? ref || 'Sourcing' : inv.order?.order_number || '',
    orderDate: isAdvance ? r.operation_at : inv.order?.created_at || r.operation_at,
    totalAmount: Number(inv.total_amount),
    legalStatus: inv.legal_status,
    billingDetails: inv.billing_details || {},
    paymentMethod: isAdvance ? 'virement' : paymentText(inv.order?.stripe_payment_intent_id),
    items: isAdvance
      ? advanceInvoiceItems(inv)
      : buildInvoiceItems(inv.order?.order_items || [], { amount: inv.order?.late_fee_amount, days: inv.order?.late_fee_days }, inv.issued_at),
    vatRate: r.vat_rate,
    rectification,
  });
};

export default VatTab;
