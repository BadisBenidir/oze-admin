import React, { useCallback, useEffect, useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronUp, Download, EyeOff, FileText, Loader2, Paperclip, Percent, RefreshCw, Save, Send, Undo2 } from 'lucide-react';
import { supabase } from '../../../lib/supabase';
import { Card, CardContent, CardHeader } from '../../ui/Card';
import { AccountingKpiCard } from './AccountingKpiCard';
import { VatSale } from '../../../utils/accountingCalc';
import { VatSettings, vatAccountingStart, vatAccountingRateAt, vatRateAt } from '../../../utils/vat';
import { VatDeclaration, VatDeclStatus, VatExpenseLine, VatMonthRow, buildVatMonths, vatRemainingToPay, SendcloudInvoiceRow } from '../../../utils/vatLedger';
import { paymentMethodLabel } from '../../../utils/paymentMethod';
import { buildInvoiceItems, generateInvoicePdf, InvoiceBillingDetails, InvoiceSourceItem } from '../../../utils/generateInvoicePdf';
import { CREDIT_NOTE_SELECT, CreditNoteRow, advanceInvoiceItems, creditNotePdfData } from '../../../hooks/useInvoices';

const EUR = (n: number) => (Number(n) || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const monthLabel = (ym: string) => `${MONTHS[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;
const inputCls = 'h-9 w-full rounded-lg border border-gray-200 bg-white px-2.5 text-sm text-gray-900 focus:border-gray-400 focus:outline-none';
const r2 = (n: number) => Math.round(n * 100) / 100;

/** ISO → valeur d'un <input type="datetime-local"> en heure de Paris (secondes comprises). */
const toParisLocal = (iso: string | null | undefined) => {
  if (!iso) return '';
  const parts = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).format(new Date(iso));
  return parts.replace(' ', 'T');
};
/** Valeur locale (heure de Paris) → ISO UTC. */
const fromParisLocal = (local: string) => {
  if (!local) return null;
  const asUtc = new Date(`${local.length === 16 ? `${local}:00` : local.length === 10 ? `${local}T00:00:00` : local}Z`);
  const paris = new Date(asUtc.toLocaleString('en-US', { timeZone: 'Europe/Paris' }));
  const utc = new Date(asUtc.toLocaleString('en-US', { timeZone: 'UTC' }));
  return new Date(asUtc.getTime() - (paris.getTime() - utc.getTime())).toISOString();
};
const parisDate = (iso: string) => new Date(iso).toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris', day: '2-digit', month: '2-digit', year: 'numeric' });

const STATUS_LABELS: Record<VatDeclStatus, string> = { a_declarer: 'À déclarer', declaree: 'Déclarée', payee: 'Payée' };
const REGIME_LABELS: Record<VatSettings['regime'], string> = {
  reel: 'Miniréel (réel normal TVA, CA3 mensuelle)',
  assujetti: 'Franchise puis bascule',
  franchise: 'Franchise en base (art. 293 B)',
};

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
  /** external (0282) : régularisée hors de l'admin (ex. avoir + facture sur Qonto). */
  status: 'draft' | 'issued' | 'external';
  rectification_number: string | null;
  issued_at: string | null;
  external_note: string | null;
  /** Suggestion masquée (0313) : brouillon laissé de côté, jamais émis. */
  hidden_at?: string | null;
  /** Facture d'origine annulée (ex. avoir total sur Qonto) : plus rien à rectifier. */
  cancelled?: boolean;
}

interface VatTabProps {
  settings: VatSettings | null;
  onSettingsChanged: () => Promise<void>;
  /** TVA collectée par vente (toHtData), lives comprises. */
  vatSales: VatSale[];
  /** TVA par charge de la période assujettie (vatExpenseLines). */
  vatLines: VatExpenseLine[];
}

/** Comptabilité → TVA (0280 / 0281 / 0313) : régime (miniréel depuis le
 * 20/05/2026), TVA par mois comme sur la CA3 (collectée, déductible,
 * autoliquidée, crédit reporté), statut des déclarations, export pour
 * l'expert-comptable et factures émises sans TVA à rectifier. */
export const VatTab: React.FC<VatTabProps> = ({ settings, onSettingsChanged, vatSales, vatLines }) => {
  const [declarations, setDeclarations] = useState<Record<string, VatDeclaration>>({});
  const [rectifications, setRectifications] = useState<Rectification[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  // Factures Sendcloud (0239) : TVA = TTC − HT, déductible (hors charges).
  const [sendcloud, setSendcloud] = useState<SendcloudInvoiceRow[]>([]);

  const load = useCallback(async () => {
    const [d, r, sc] = await Promise.all([
      supabase.from('vat_declarations').select('*'),
      supabase.from('vat_invoice_rectifications').select('*, invoice:invoices(transmission_status)').order('original_issued_at'),
      supabase.from('sendcloud_invoices').select('invoice_date, price_excl, price_incl'),
    ]);
    setSendcloud((sc.data || []) as SendcloudInvoiceRow[]);
    if (d.error || r.error) setError((d.error || r.error)!.message);
    const map: Record<string, VatDeclaration> = {};
    for (const row of (d.data || []) as VatDeclaration[]) {
      map[row.period.slice(0, 7)] = {
        ...row,
        import_autoliquidation: Number(row.import_autoliquidation) || 0,
        foreign_services_autoliquidation: Number(row.foreign_services_autoliquidation) || 0,
      };
    }
    setDeclarations(map);
    type Row = Rectification & { invoice: { transmission_status: string | null } | null };
    setRectifications(
      ((r.data || []) as Row[]).map(({ invoice, ...x }) => ({
        ...x,
        amount_ttc: Number(x.amount_ttc),
        amount_ht: Number(x.amount_ht),
        vat_amount: Number(x.vat_amount),
        cancelled: invoice?.transmission_status === 'cancelled',
      }))
    );
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const start = vatAccountingStart(settings);

  const rows = useMemo(
    () => buildVatMonths({ settings, vatSales, lines: vatLines, sendcloud, declarations }),
    [settings, vatSales, vatLines, sendcloud, declarations]
  );

  const remaining = vatRemainingToPay(rows);
  const unpaidMonths = rows.filter((r) => r.status !== 'payee');
  const declaredUnpaid = r2(rows.filter((r) => r.status === 'declaree').reduce((s, r) => s + r.toPay, 0));
  const creditNow = rows.length ? rows[rows.length - 1].creditOut : 0;
  const totalCollected = r2(rows.reduce((s, r) => s + r.collected, 0));
  const totalDeductible = r2(rows.reduce((s, r) => s + r.deductible, 0));
  // TVA déduite sans justificatif déposé sur Qonto : à régulariser avant la déclaration.
  const missingReceipts = useMemo(() => vatLines.filter((l) => l.deductible > 0 && !l.hasReceipt), [vatLines]);
  const [showMissing, setShowMissing] = useState(false);

  const isOpen = (r: Rectification) => r.status === 'draft' && !r.cancelled && !r.hidden_at;
  const drafts = rectifications.filter(isOpen);
  // Traitées (émises, régularisées ailleurs, annulées, masquées) : historique replié.
  const done = rectifications.filter((r) => !isOpen(r));
  const [showDone, setShowDone] = useState(false);
  const visible = showDone ? [...drafts, ...done] : drafts;

  const saveDeclaration = async (ym: string, patch: Partial<VatDeclaration>) => {
    setBusy(`decl-${ym}`);
    setError(null);
    const current = declarations[ym];
    const { error: e } = await supabase.from('vat_declarations').upsert({
      period: `${ym}-01`,
      status: current?.status ?? 'a_declarer',
      import_autoliquidation: current?.import_autoliquidation ?? 0,
      foreign_services_autoliquidation: current?.foreign_services_autoliquidation ?? 0,
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

  const markExternal = async (r: Rectification, undo = false) => {
    let note: string | null = null;
    if (!undo) {
      note = window.prompt(`${r.original_number} déjà régularisée hors de l'admin (ex. avoir + nouvelle facture sur Qonto) ?\n\nRéférence de la régularisation :`, 'Régularisée sur Qonto');
      if (note === null || !note.trim()) return;
    } else if (!window.confirm(`Remettre ${r.original_number} dans les factures à rectifier ?`)) return;
    setBusy(r.id);
    setError(null);
    const { error: e } = await supabase.rpc('vat_mark_rectification_external', { p_id: r.id, p_note: note });
    setBusy(null);
    if (e) return setError(e.message);
    await load();
  };

  // Suggestion masquée : le brouillon reste en base (jamais émis, jamais
  // envoyé), il sort seulement de la liste à traiter.
  const setHidden = async (r: Rectification, hidden: boolean) => {
    setBusy(r.id);
    setError(null);
    const { error: e } = await supabase.from('vat_invoice_rectifications').update({ hidden_at: hidden ? new Date().toISOString() : null }).eq('id', r.id).eq('status', 'draft');
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
            label="Reste à payer"
            value={EUR(remaining)}
            icon={Percent}
            tone={remaining > 0 ? 'red' : 'green'}
            hint={`${unpaidMonths.length} mois non payé${unpaidMonths.length > 1 ? 's' : ''} depuis le ${parisDate(start)}${declaredUnpaid ? ` · dont ${EUR(declaredUnpaid)} déjà déclarée` : ''}${creditNow ? ` · crédit à reporter ${EUR(creditNow)}` : ''}`}
          />
          <AccountingKpiCard label="TVA collectée" value={EUR(totalCollected)} icon={Percent} hint={`Depuis le ${parisDate(start)}, toutes ventes encaissées (TTC × 20/120)`} />
          <AccountingKpiCard label="TVA déductible" value={EUR(totalDeductible)} icon={FileText} tone="green" hint={`Charges × taux de récupération, Sendcloud, TVA import B00${missingReceipts.length ? ` · ${missingReceipts.length} sans justificatif` : ''}`} />
        </div>
      )}

      <VatSettingsCard settings={settings} onSaved={async () => { await onSettingsChanged(); await refreshRectifications(); }} />

      {start && (
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="text-base font-semibold text-gray-900">TVA par mois</h3>
                <p className="text-sm text-gray-500">
                  Depuis le {parisDate(start)}. Collectée : ventes encaissées, tous canaux (prix TTC, TVA = TTC × 20/120, même facturées sans TVA). Déductible : charges validées (TVA saisie, sinon Qonto, × taux de récupération), Sendcloud et TVA import B00. Autoliquidée : due = déductible, net 0. Un crédit est reporté sur le mois suivant.
                </p>
              </div>
              <button
                onClick={() => exportVatWorkbook(rows, vatLines)}
                className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 text-sm text-gray-700 hover:bg-gray-50"
              >
                <Download className="h-4 w-4" /> Export Excel
              </button>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-100 text-xs text-gray-500">
                    <th className="px-3 py-2.5 text-left font-medium">Mois</th>
                    <th className="px-3 py-2.5 text-right font-medium">CA TTC</th>
                    <th className="px-3 py-2.5 text-right font-medium">CA HT</th>
                    <th className="px-3 py-2.5 text-right font-medium">TVA collectée</th>
                    <th className="px-3 py-2.5 text-right font-medium" title="Charges + Sendcloud + TVA import B00">TVA déductible</th>
                    <th className="px-3 py-2.5 text-right font-medium" title="TVA import autoliquidée (saisie) : due = déductible">Autoliq. import</th>
                    <th className="px-3 py-2.5 text-right font-medium" title="Services de fournisseurs étrangers (charges marquées + saisie) : due = déductible">Autoliq. services étrangers</th>
                    <th className="px-3 py-2.5 text-right font-medium">TVA nette</th>
                    <th className="px-3 py-2.5 text-right font-medium" title="Crédit du mois précédent imputé">Crédit reporté</th>
                    <th className="px-3 py-2.5 text-right font-medium">À payer</th>
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
                    <td className="px-3 py-2.5 text-right tabular-nums">{EUR(rows.reduce((s, r) => s + r.ttc, 0))}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{EUR(rows.reduce((s, r) => s + r.ht, 0))}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{EUR(totalCollected)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{EUR(totalDeductible)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{EUR(rows.reduce((s, r) => s + r.autoliqImport, 0))}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{EUR(rows.reduce((s, r) => s + r.autoliqForeign, 0))}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{EUR(rows.reduce((s, r) => s + r.net, 0))}</td>
                    <td />
                    <td className="px-3 py-2.5 text-right tabular-nums">{EUR(rows.reduce((s, r) => s + r.toPay, 0))}</td>
                    <td colSpan={4} />
                  </tr>
                </tfoot>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {start && missingReceipts.length > 0 && (
        <Card>
          <CardHeader>
            <button onClick={() => setShowMissing((v) => !v)} className="flex w-full items-center justify-between gap-3 text-left">
              <div>
                <h3 className="flex items-center gap-2 text-base font-semibold text-gray-900">
                  <Paperclip className="h-4 w-4 text-amber-600" /> TVA déduite sans justificatif ({missingReceipts.length})
                </h3>
                <p className="text-sm text-gray-500">
                  {EUR(missingReceipts.reduce((s, l) => s + l.deductible, 0))} de TVA déduite sur des charges sans facture déposée sur Qonto : à joindre (onglet Charges) avant la déclaration, sinon non déductible en cas de contrôle.
                </p>
              </div>
              {showMissing ? <ChevronUp className="h-4 w-4 text-gray-400" /> : <ChevronDown className="h-4 w-4 text-gray-400" />}
            </button>
          </CardHeader>
          {showMissing && (
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-gray-100 text-xs text-gray-500">
                      <th className="px-3 py-2.5 text-left font-medium">Date</th>
                      <th className="px-3 py-2.5 text-left font-medium">Libellé</th>
                      <th className="px-3 py-2.5 text-left font-medium">Catégorie</th>
                      <th className="px-3 py-2.5 text-right font-medium">TTC</th>
                      <th className="px-3 py-2.5 text-right font-medium">TVA déduite</th>
                    </tr>
                  </thead>
                  <tbody>
                    {missingReceipts.map((l) => (
                      <tr key={l.id} className="border-b border-gray-50 text-sm">
                        <td className="px-3 py-2 text-gray-600">{new Date(`${l.date}T12:00:00`).toLocaleDateString('fr-FR')}</td>
                        <td className="px-3 py-2 text-gray-900">{l.label}</td>
                        <td className="px-3 py-2 text-gray-600">{l.category || '—'}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-gray-600">{EUR(l.ttc)}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-gray-900">{EUR(l.deductible)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          )}
        </Card>
      )}

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-base font-semibold text-gray-900">Factures à rectifier</h3>
              <p className="text-sm text-gray-500">
                Suggestions seulement : factures et avoirs émis sans TVA alors que la TVA était facturée (à partir du {settings?.vat_start_at ? parisDate(settings.vat_start_at) : '—'}). Rien n'est généré pour les ventes antérieures. Chaque rectificative reste en brouillon tant que vous ne l'émettez pas, et rien n'est jamais envoyé au client.
              </p>
            </div>
            <button onClick={refreshRectifications} disabled={busy === 'refresh'} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50">
              {busy === 'refresh' ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Recalculer la liste
            </button>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {visible.length === 0 ? (
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
                  {visible.map((r) => (
                    <tr key={r.id} className="border-b border-gray-50 text-sm hover:bg-gray-50">
                      <td className="px-3 py-2.5 font-medium text-gray-900">{r.original_number}{r.credit_note_id && <span className="ml-1 text-xs text-gray-500">(avoir)</span>}</td>
                      <td className="px-3 py-2.5 text-gray-600">{parisDate(r.original_issued_at)}</td>
                      <td className="px-3 py-2.5 text-gray-600">{parisDate(r.operation_at)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-gray-900">{EUR(r.amount_ttc)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-gray-600">{EUR(r.amount_ht)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-gray-600">{EUR(r.vat_amount)}</td>
                      <td className="px-3 py-2.5">
                        {r.cancelled && r.status !== 'issued' ? (
                          <span className="text-gray-500" title={r.external_note || undefined}>
                            <span className="mr-1 rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-700">Annulée</span>
                            {r.external_note || 'Facture annulée : rien à rectifier'}
                          </span>
                        ) : r.status === 'issued' ? (
                          <span className="text-green-700">{r.rectification_number} · {r.issued_at && parisDate(r.issued_at)}</span>
                        ) : r.status === 'external' ? (
                          <span className="text-green-700" title={r.external_note || undefined}>
                            Régularisée ailleurs{r.external_note ? ` · ${r.external_note}` : ''}
                          </span>
                        ) : r.hidden_at ? (
                          <span className="rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-600">Masquée le {parisDate(r.hidden_at)}</span>
                        ) : (
                          <span className="rounded bg-amber-50 px-1.5 py-0.5 text-xs text-amber-700">Brouillon</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-right">
                        <div className="flex justify-end gap-1.5">
                          {r.cancelled && r.status !== 'issued' ? null : r.status === 'external' ? (
                            <button onClick={() => markExternal(r, true)} disabled={busy === r.id} className="inline-flex h-8 items-center gap-1 rounded-lg px-2.5 text-xs text-gray-500 hover:bg-gray-100 disabled:opacity-50">
                              <Undo2 className="h-3.5 w-3.5" /> Annuler
                            </button>
                          ) : r.status === 'draft' && r.hidden_at ? (
                            <button onClick={() => setHidden(r, false)} disabled={busy === r.id} className="inline-flex h-8 items-center gap-1 rounded-lg px-2.5 text-xs text-gray-500 hover:bg-gray-100 disabled:opacity-50">
                              <Undo2 className="h-3.5 w-3.5" /> Réafficher
                            </button>
                          ) : (
                          <>
                          <button onClick={() => pdf(r)} disabled={busy === `pdf-${r.id}`} className="inline-flex h-8 items-center gap-1 rounded-lg border border-gray-200 px-2.5 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-50">
                            {busy === `pdf-${r.id}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileText className="h-3.5 w-3.5" />}
                            {r.status === 'issued' ? 'PDF' : 'Aperçu'}
                          </button>
                          {r.status === 'draft' && (
                            <button onClick={() => issue(r)} disabled={busy === r.id} className="inline-flex h-8 items-center gap-1 rounded-lg bg-gray-900 px-2.5 text-xs font-medium text-white hover:bg-gray-800 disabled:opacity-50">
                              {busy === r.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />} Émettre
                            </button>
                          )}
                          {r.status === 'draft' && (
                            <button onClick={() => markExternal(r)} disabled={busy === r.id} title="Déjà régularisée hors de l'admin (ex. sur Qonto)" className="inline-flex h-8 items-center gap-1 rounded-lg border border-gray-200 px-2.5 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-50">
                              <CheckCircle2 className="h-3.5 w-3.5" /> Régularisée ailleurs
                            </button>
                          )}
                          {r.status === 'draft' && (
                            <button onClick={() => setHidden(r, true)} disabled={busy === r.id} title="Masquer cette suggestion (le brouillon n'est ni émis ni envoyé)" className="inline-flex h-8 items-center gap-1 rounded-lg px-2.5 text-xs text-gray-500 hover:bg-gray-100 disabled:opacity-50">
                              <EyeOff className="h-3.5 w-3.5" /> Masquer
                            </button>
                          )}
                          </>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {done.length > 0 && (
            <button onClick={() => setShowDone((v) => !v)} className="flex w-full items-center justify-center gap-1 border-t border-gray-100 py-2.5 text-xs text-gray-500 hover:bg-gray-50 hover:text-gray-800">
              {showDone ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
              {showDone ? 'Masquer les factures traitées' : `Factures traitées (${done.length}) : émises, régularisées, annulées ou masquées`}
            </button>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

const DeclarationRow: React.FC<{ row: VatMonthRow; busy: boolean; onSave: (patch: Partial<VatDeclaration>) => void }> = ({ row, busy, onSave }) => {
  const fmt = (n: number | null | undefined) => (n ? String(n).replace('.', ',') : '');
  const [autoliq, setAutoliq] = useState(fmt(row.autoliqImport));
  const [foreign, setForeign] = useState(fmt(row.autoliqForeignManual));
  const [paidAmount, setPaidAmount] = useState(row.decl?.paid_amount != null ? String(row.decl.paid_amount).replace('.', ',') : '');
  useEffect(() => {
    setAutoliq(fmt(row.autoliqImport));
    setForeign(fmt(row.autoliqForeignManual));
    setPaidAmount(row.decl?.paid_amount != null ? String(row.decl.paid_amount).replace('.', ',') : '');
  }, [row.autoliqImport, row.autoliqForeignManual, row.decl?.paid_amount]);
  const num = (v: string) => (v.trim() ? Number(v.replace(/\s/g, '').replace(',', '.')) : null);
  const cell = 'h-8 rounded-md border border-gray-200 bg-white px-2 text-xs focus:border-gray-400 focus:outline-none';
  const computedForeign = r2(row.autoliqForeign - row.autoliqForeignManual);
  return (
    <tr className="border-b border-gray-50 text-sm hover:bg-gray-50">
      <td className="whitespace-nowrap px-3 py-2 capitalize text-gray-900">{monthLabel(row.ym)} {busy && <Loader2 className="ml-1 inline h-3.5 w-3.5 animate-spin text-gray-400" />}</td>
      <td className="px-3 py-2 text-right tabular-nums text-gray-600">{EUR(row.ttc)}</td>
      <td className="px-3 py-2 text-right tabular-nums text-gray-600">{EUR(row.ht)}</td>
      <td className="px-3 py-2 text-right tabular-nums text-gray-900">{EUR(row.collected)}</td>
      <td
        className="px-3 py-2 text-right tabular-nums text-gray-600"
        title={`Charges ${EUR(row.dedCharges)} · Sendcloud ${EUR(row.dedSendcloud)} · Import B00 ${EUR(row.dedImport)}`}
      >
        {EUR(row.deductible)}
      </td>
      <td className="px-3 py-2 text-right">
        <input
          inputMode="decimal"
          value={autoliq}
          onChange={(e) => setAutoliq(e.target.value)}
          onBlur={() => {
            const v = num(autoliq) ?? 0;
            if (!Number.isNaN(v) && v !== row.autoliqImport) onSave({ import_autoliquidation: v });
          }}
          placeholder="0,00"
          className={`${cell} w-24 text-right`}
        />
      </td>
      <td className="px-3 py-2 text-right">
        <div className="flex items-center justify-end gap-1.5">
          {computedForeign > 0 && <span className="text-xs tabular-nums text-gray-600" title="Charges de fournisseurs étrangers du mois (20 % du montant)">{EUR(computedForeign)} +</span>}
          <input
            inputMode="decimal"
            value={foreign}
            onChange={(e) => setForeign(e.target.value)}
            onBlur={() => {
              const v = num(foreign) ?? 0;
              if (!Number.isNaN(v) && v !== row.autoliqForeignManual) onSave({ foreign_services_autoliquidation: v });
            }}
            placeholder="0,00"
            title="Autres services étrangers autoliquidés (saisie)"
            className={`${cell} w-20 text-right`}
          />
        </div>
      </td>
      <td className={`px-3 py-2 text-right font-medium tabular-nums ${row.net >= 0 ? 'text-gray-900' : 'text-green-700'}`} title={row.net < 0 ? 'Crédit de TVA' : undefined}>{EUR(row.net)}</td>
      <td className="px-3 py-2 text-right tabular-nums text-green-700">{row.creditIn ? `− ${EUR(row.creditIn)}` : '—'}</td>
      <td className="px-3 py-2 text-right font-semibold tabular-nums text-gray-900" title={row.creditOut ? `Crédit à reporter : ${EUR(row.creditOut)}` : undefined}>
        {EUR(row.toPay)}
        {row.creditOut > 0 && <span className="block text-xs font-normal text-green-700">crédit {EUR(row.creditOut)}</span>}
      </td>
      <td className="px-3 py-2">
        <select value={row.status} onChange={(e) => onSave({ status: e.target.value as VatDeclStatus })} className={cell}>
          {(Object.keys(STATUS_LABELS) as VatDeclStatus[]).map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
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

/** Export pour l'expert-comptable : tableau mensuel + détail des charges. */
const exportVatWorkbook = (rows: VatMonthRow[], lines: VatExpenseLine[]) => {
  const wb = XLSX.utils.book_new();
  const months = XLSX.utils.aoa_to_sheet([
    ['Mois', 'CA TTC', 'CA HT', 'TVA collectée', 'TVA déductible charges', 'TVA déductible Sendcloud', 'TVA import B00', 'TVA déductible totale',
      'Autoliq. import', 'Autoliq. services étrangers', 'TVA nette', 'Crédit reporté', 'À payer', 'Crédit à reporter', 'Statut', 'Déclarée le', 'Payée le', 'Montant payé'],
    ...rows.map((r) => [
      monthLabel(r.ym), r.ttc, r.ht, r.collected, r.dedCharges, r.dedSendcloud, r.dedImport, r.deductible,
      r.autoliqImport, r.autoliqForeign, r.net, r.creditIn, r.toPay, r.creditOut,
      STATUS_LABELS[r.status], r.decl?.declared_at || '', r.decl?.paid_at || '', r.decl?.paid_amount ?? '',
    ]),
  ]);
  months['!cols'] = [{ wch: 16 }, ...Array(13).fill({ wch: 14 }), { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 14 }];
  XLSX.utils.book_append_sheet(wb, months, 'TVA par mois');
  const charges = XLSX.utils.aoa_to_sheet([
    ['Date', 'Libellé', 'Catégorie', 'Montant TTC', 'TVA facture', 'Taux de récupération', 'Origine du taux', 'TVA déduite', 'TVA import B00', 'Fournisseur étranger', 'TVA autoliquidée', 'Justificatif'],
    ...lines.map((l) => [
      new Date(`${l.date}T12:00:00`).toLocaleDateString('fr-FR'), l.label, l.category || '', l.ttc, l.invoiceVat, l.rate / 100,
      l.why ? `${l.rateSource} (${l.why})` : l.rateSource, l.recovered, l.importVat, l.foreign ? 'oui' : 'non', l.autoliquidated, l.hasReceipt ? 'oui' : 'non',
    ]),
  ]);
  charges['!cols'] = [{ wch: 11 }, { wch: 40 }, { wch: 24 }, { wch: 12 }, { wch: 11 }, { wch: 12 }, { wch: 30 }, { wch: 11 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 11 }];
  // Taux de récupération en pourcentage.
  for (let i = 2; i <= lines.length + 1; i++) {
    const c = charges[`F${i}`];
    if (c) c.z = '0%';
  }
  XLSX.utils.book_append_sheet(wb, charges, 'Charges déductibles');
  XLSX.writeFile(wb, `TVA_OZE_${new Date().toISOString().slice(0, 10)}.xlsx`);
};

const VatSettingsCard: React.FC<{ settings: VatSettings | null; onSaved: () => Promise<void> }> = ({ settings, onSaved }) => {
  const [form, setForm] = useState({ regime: 'reel' as VatSettings['regime'], liability: '', start: '', rate: '20', number: '', note: '', advances: false });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => {
    if (!settings) return;
    setForm({
      regime: settings.regime,
      liability: toParisLocal(settings.liability_start_at).slice(0, 10),
      start: toParisLocal(settings.vat_start_at),
      rate: String(settings.vat_rate).replace('.', ','),
      number: settings.vat_number || '',
      note: settings.note || '',
      advances: Boolean(settings.advances_vat_on_receipt),
    });
  }, [settings]);
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));

  const save = async (ev: React.FormEvent) => {
    ev.preventDefault();
    const rate = Number(form.rate.replace(',', '.'));
    if (Number.isNaN(rate) || rate < 0 || rate >= 100) return setMessage('Taux invalide.');
    if (form.regime !== 'franchise' && !form.start) return setMessage('Date de TVA facturée obligatoire.');
    if (form.regime === 'reel' && !form.liability) return setMessage("Date de début d'assujettissement obligatoire.");
    if (!window.confirm('Modifier le réglage TVA ? Le CA HT, la TVA et la liste des factures à rectifier seront recalculés. Les factures déjà émises ne changent pas.')) return;
    setBusy(true);
    setMessage(null);
    const { error } = await supabase
      .from('vat_settings')
      .update({
        regime: form.regime,
        liability_start_at: form.liability ? fromParisLocal(form.liability) : null,
        vat_start_at: fromParisLocal(form.start),
        vat_rate: rate,
        vat_number: form.number.trim() || null,
        note: form.note.trim() || null,
        advances_vat_on_receipt: form.advances,
      })
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
          {REGIME_LABELS[settings.regime]}. Calculs (CA HT, TVA due et déductible) : taux du jour {vatAccountingRateAt(settings, new Date())} %{vatAccountingStart(settings) ? `, depuis le ${parisDate(vatAccountingStart(settings)!)}` : ''}. TVA facturée sur les factures : taux du jour {vatRateAt(settings, new Date())} %{settings.vat_start_at && settings.regime !== 'franchise' ? `, depuis le ${parisDate(settings.vat_start_at)}` : ''}.
        </p>
      </CardHeader>
      <CardContent>
        <form onSubmit={save} className="grid grid-cols-1 gap-3 md:grid-cols-4">
          <label className="block text-xs font-medium text-gray-600">
            Régime
            <select value={form.regime} onChange={(e) => set('regime', e.target.value as VatSettings['regime'])} className={`${inputCls} mt-1`}>
              <option value="reel">{REGIME_LABELS.reel}</option>
              <option value="assujetti">{REGIME_LABELS.assujetti}</option>
              <option value="franchise">{REGIME_LABELS.franchise}</option>
            </select>
          </label>
          <label className="block text-xs font-medium text-gray-600" title="Miniréel : la TVA est due sur toutes les ventes encaissées depuis cette date, même facturées sans TVA">
            Début d'assujettissement
            <input type="date" value={form.liability} onChange={(e) => set('liability', e.target.value)} disabled={form.regime !== 'reel'} className={`${inputCls} mt-1 disabled:bg-gray-50 disabled:text-gray-400`} />
          </label>
          <label className="block text-xs font-medium text-gray-600" title="Factures, rectificatives et ventes Instagram : TVA imprimée à partir de cette date">
            {form.regime === 'assujetti' ? 'Bascule (heure de Paris)' : 'TVA facturée à partir du (Paris)'}
            <input type="datetime-local" step={1} value={form.start} onChange={(e) => set('start', e.target.value)} disabled={form.regime === 'franchise'} className={`${inputCls} mt-1 disabled:bg-gray-50 disabled:text-gray-400`} />
          </label>
          <label className="block text-xs font-medium text-gray-600">
            Taux (%)
            <input inputMode="decimal" value={form.rate} onChange={(e) => set('rate', e.target.value)} className={`${inputCls} mt-1`} />
          </label>
          <label className="block text-xs font-medium text-gray-600">
            N° de TVA intracommunautaire
            <input value={form.number} onChange={(e) => set('number', e.target.value)} placeholder="FR…" className={`${inputCls} mt-1`} />
          </label>
          <label className="block text-xs font-medium text-gray-600 md:col-span-2">
            Note
            <input value={form.note} onChange={(e) => set('note', e.target.value)} className={`${inputCls} mt-1`} />
          </label>
          <label className="flex items-start gap-2 text-xs text-gray-600 md:pt-5" title="Avances de sourcing sur mesure non clôturées : taxées au mois d'encaissement, retirées au mois de clôture">
            <input type="checkbox" checked={form.advances} onChange={(e) => set('advances', e.target.checked)} className="mt-0.5 h-4 w-4 accent-gray-900" />
            <span><span className="font-medium">TVA sur avances à l'encaissement</span><span className="block text-gray-500">Sourcing : taxée à l'encaissement, retirée à la clôture</span></span>
          </label>
          <div className="flex items-end md:col-start-4">
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
        'order:orders!invoices_order_id_fkey(order_number, created_at, stripe_payment_intent_id, payment_method_effective, late_fee_amount, late_fee_days, order_items(product_snapshot, unit_price, quantity, line_total, status, cancelled_at, insured, insurance_cost, entrupy_requested, entrupy_cost)), ' +
        'sourcing_mission:b2b_sourcing_missions(reference, title)'
    )
    .eq('id', r.invoice_id!)
    .maybeSingle();
  if (error || !data) throw new Error(error?.message || 'Facture introuvable');
  type Row = {
    invoice_number: string; issued_at: string; total_amount: number; kind: string;
    legal_status: 'individual' | 'sole_proprietorship' | 'company'; billing_details: InvoiceBillingDetails | null;
    order: { order_number: string; created_at: string; stripe_payment_intent_id: string | null; payment_method_effective: string | null; late_fee_amount: number | null; late_fee_days: number | null; order_items: InvoiceSourceItem[] } | null;
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
    paymentMethod: isAdvance ? 'virement bancaire' : paymentMethodLabel(inv.order?.payment_method_effective),
    items: isAdvance
      ? advanceInvoiceItems(inv)
      : buildInvoiceItems(inv.order?.order_items || [], { amount: inv.order?.late_fee_amount, days: inv.order?.late_fee_days }, inv.issued_at),
    vatRate: r.vat_rate,
    rectification,
  });
};

export default VatTab;
