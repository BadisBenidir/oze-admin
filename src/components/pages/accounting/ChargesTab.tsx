import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CreditCard, Landmark, Loader2, Paperclip, Pencil, Plus, ReceiptText, Settings2, Trash2, Upload, X } from 'lucide-react';
import { supabase } from '../../../lib/supabase';
import { Card, CardContent, CardHeader } from '../../ui/Card';
import { AccountingKpiCard } from './AccountingKpiCard';
import { Expense } from '../../../hooks/useExpenses';
import { AccountingPeriod, monthKeyLabel } from '../../../utils/accountingPeriods';
import { expenseDate, expensesInRange, isCountedCharge } from '../../../utils/accountingCalc';
import { invokeEdgeFunction } from '../../../utils/invokeEdgeFunction';

const EUR = (n: number) => (Number(n) || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
const UNCATEGORIZED = 'Sans catégorie';
const todayIso = () => new Date().toISOString().slice(0, 10);

export interface ExpenseCategoryRow {
  id: string;
  name: string;
  position: number;
}

/** Catégories de charges (0274 / 0276), gérées depuis l'onglet. */
const useExpenseCategories = () => {
  const [categories, setCategories] = useState<ExpenseCategoryRow[]>([]);
  const refresh = useCallback(async () => {
    const { data } = await supabase.from('expense_categories').select('id, name, position').order('position').order('name');
    setCategories((data || []) as ExpenseCategoryRow[]);
  }, []);
  useEffect(() => {
    refresh();
  }, [refresh]);
  return { categories, refresh };
};

type StatusFilter = 'validated' | 'to_review' | 'excluded' | 'all';

const STATUS_BADGE: Record<Expense['review_status'], { label: string; cls: string }> = {
  validated: { label: 'Comptée', cls: 'bg-green-50 text-green-700' },
  to_review: { label: 'À vérifier', cls: 'bg-amber-50 text-amber-700' },
  excluded: { label: 'Exclue', cls: 'bg-gray-100 text-gray-500' },
};

/** Mois (YYYY-MM) couverts par la période, 12 au plus (les plus récents). */
const monthsOf = (period: AccountingPeriod): string[] => {
  const out: string[] = [];
  const d = new Date(period.range.start.getFullYear(), period.range.start.getMonth(), 1);
  while (d <= period.range.end) {
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    d.setMonth(d.getMonth() + 1);
  }
  return out.slice(-12);
};

const previousMonth = () => {
  const d = new Date();
  d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

interface ChargesTabProps {
  expenses: Expense[];
  period: AccountingPeriod;
  createExpense: (data: Partial<Expense>) => Promise<void>;
  updateExpense: (id: string, data: Partial<Expense>) => Promise<void>;
  deleteExpense: (id: string) => Promise<void>;
  refreshExpenses: () => Promise<void>;
}

/**
 * Comptabilité → Charges (0276) : charges importées des débits Qonto
 * (règles de libellé), frais Stripe mensuels, frais d'approche OGATE et
 * saisies manuelles. Les lignes « À vérifier » ne comptent qu'une fois
 * classées (charge pro → catégorie, ou perso → exclue). Les charges
 * validées (hors achat de marchandise) sont déduites de la marge brute
 * dans le Dashboard Global (Résultat net).
 */
/** Charge reliée à un débit Qonto sans justificatif déposé sur Qonto. */
const missingReceipt = (e: Expense) => Boolean(e.bank_transaction_id) && !(e.bank?.attachment_ids?.length);

export const ChargesTab: React.FC<ChargesTabProps> = ({ expenses, period, createExpense, updateExpense, deleteExpense, refreshExpenses }) => {
  const { categories, refresh: refreshCategories } = useExpenseCategories();
  const [editing, setEditing] = useState<Expense | 'new' | null>(null);
  const [managing, setManaging] = useState(false);
  const [status, setStatus] = useState<StatusFilter>('validated');
  const [category, setCategory] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  // Catégorie choisie pour classer une ligne « À vérifier ».
  const [pick, setPick] = useState<Record<string, string>>({});
  // Justificatifs Qonto : filtre « sans justificatif » et dépôt depuis l'admin.
  const [missingOnly, setMissingOnly] = useState(false);
  const [uploading, setUploading] = useState<string | null>(null);
  // Déposés pendant la session : verts tout de suite, sans attendre le rechargement.
  const [uploaded, setUploaded] = useState<Set<string>>(new Set());
  const isMissing = useCallback((e: Expense) => missingReceipt(e) && !uploaded.has(e.id), [uploaded]);

  const inPeriod = useMemo(() => expensesInRange(expenses, period.range), [expenses, period.range]);
  const counted = useMemo(() => inPeriod.filter(isCountedCharge), [inPeriod]);
  const total = counted.reduce((s, e) => s + Number(e.amount || 0), 0);
  const toReview = useMemo(() => expensesInRange(expenses, { start: new Date(0), end: new Date(8.64e15) }).filter((e) => e.review_status === 'to_review'), [expenses]);
  const toReviewTotal = toReview.reduce((s, e) => s + Number(e.amount || 0), 0);

  // « À vérifier » : toutes périodes confondues, pour tout classer d'un coup.
  const shown = useMemo(() => {
    const base = status === 'to_review' ? toReview : inPeriod.filter((e) => status === 'all' || e.review_status === status);
    const byCategory = category ? base.filter((e) => (e.category || UNCATEGORIZED) === category) : base;
    return missingOnly ? byCategory.filter(isMissing) : byCategory;
  }, [status, toReview, inPeriod, category, missingOnly, isMissing]);
  const missingCount = useMemo(() => counted.filter(isMissing).length, [counted, isMissing]);

  // Dépose le justificatif sur la transaction Qonto (qonto-upload-attachment).
  const uploadReceipt = async (e: Expense, file: File) => {
    const type = file.type || (file.name.toLowerCase().endsWith('.pdf') ? 'application/pdf' : '');
    if (!['application/pdf', 'image/jpeg', 'image/png'].includes(type)) {
      setNotice({ tone: 'error', text: 'Qonto accepte les PDF, JPEG et PNG.' });
      return;
    }
    setUploading(e.id);
    setNotice(null);
    const data_base64 = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
    const { error } = await invokeEdgeFunction('qonto-upload-attachment', { expense_id: e.id, filename: file.name, content_type: type, data_base64 });
    setUploading(null);
    if (error) return setNotice({ tone: 'error', text: `Justificatif « ${e.label} » : ${error}` });
    setUploaded((prev) => new Set(prev).add(e.id));
    setNotice({ tone: 'ok', text: `Justificatif déposé sur Qonto pour « ${e.label} ». Si Qonto lit la TVA, elle sera reprise à la prochaine synchro.` });
    await refreshExpenses();
  };

  // Tableau catégorie × mois (charges comptées).
  const months = useMemo(() => monthsOf(period), [period]);
  const matrix = useMemo(() => {
    const rows = new Map<string, Record<string, number>>();
    for (const e of counted) {
      const k = e.category || UNCATEGORIZED;
      const row = rows.get(k) || {};
      const m = e.spent_at.slice(0, 7);
      row[m] = (row[m] || 0) + Number(e.amount || 0);
      rows.set(k, row);
    }
    return [...rows.entries()]
      .map(([name, byMonth]) => ({ name, byMonth, total: Object.values(byMonth).reduce((s, v) => s + v, 0) }))
      .sort((a, b) => b.total - a.total);
  }, [counted]);
  const top = matrix.slice(0, 2);

  const run = async (key: string, fn: () => Promise<string>) => {
    setBusy(key);
    setNotice(null);
    try {
      setNotice({ tone: 'ok', text: await fn() });
    } catch (err) {
      setNotice({ tone: 'error', text: err instanceof Error ? err.message : 'Erreur' });
    } finally {
      setBusy(null);
    }
  };

  const importQonto = () =>
    run('import', async () => {
      const { data, error } = await supabase.rpc('accounting_import_bank_expenses');
      if (error) throw new Error(error.message);
      await refreshExpenses();
      const r = data as { charges: number; to_review: number; ignored: number };
      return r.charges + r.to_review + r.ignored === 0
        ? 'Aucune nouvelle transaction Qonto à importer.'
        : `Import Qonto : ${r.charges} charge(s) classée(s), ${r.to_review} à vérifier, ${r.ignored} ignorée(s) (virements internes, OGATE, Sendcloud, retraits).`;
    });

  const fetchStripeFees = () => {
    const month = window.prompt('Mois des frais Stripe à récupérer (AAAA-MM) :', previousMonth());
    if (!month) return;
    if (!/^\d{4}-\d{2}$/.test(month)) return setNotice({ tone: 'error', text: 'Format attendu : AAAA-MM (ex. 2026-11).' });
    const exists = expenses.some((e) => e.external_ref === `stripe-fees-${month}`);
    if (exists && !window.confirm(`Les frais Stripe de ${month} sont déjà saisis : les remplacer par le montant de Stripe ?`)) return;
    run('stripe', async () => {
      const { data, error } = await invokeEdgeFunction<{ amount: number; count: number }>('stripe-monthly-fees', { month });
      if (error || !data) throw new Error(error || 'Récupération impossible');
      await refreshExpenses();
      return `Frais Stripe ${month} : ${EUR(data.amount)} (${data.count} mouvements Stripe).`;
    });
  };

  const classify = (e: Expense, decision: 'pro' | 'perso') => {
    const cat = pick[e.id] || e.category || '';
    if (decision === 'pro' && !cat) return setNotice({ tone: 'error', text: `Choisissez une catégorie pour « ${e.label} ».` });
    run(e.id, async () => {
      const { error } = await supabase.rpc('accounting_classify_expense', { p_expense_id: e.id, p_decision: decision, p_category: decision === 'pro' ? cat : null });
      if (error) throw new Error(error.message);
      await refreshExpenses();
      return decision === 'pro' ? `« ${e.label} » comptée en ${cat}.` : `« ${e.label} » exclue des charges.`;
    });
  };

  const remove = async (e: Expense) => {
    const imported = e.bank_transaction_id ? '\nC\'est un débit Qonto importé : préférez « Perso » pour l\'exclure, sinon il sera réimporté.' : '';
    if (!window.confirm(`Supprimer « ${e.label} » (${EUR(e.amount)}) ?${imported}`)) return;
    try {
      await deleteExpense(e.id);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Suppression impossible');
    }
  };

  const btn = 'inline-flex h-9 items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50';

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <AccountingKpiCard
          label="Charges externes (période)"
          value={EUR(total)}
          icon={ReceiptText}
          tone="red"
          hint={`${counted.length} charge${counted.length > 1 ? 's' : ''} · déduites de la marge (Résultat net)`}
        />
        <button onClick={() => setStatus('to_review')} className="text-left">
          <AccountingKpiCard
            label="À vérifier (non comptées)"
            value={`${toReview.length} ligne${toReview.length > 1 ? 's' : ''}`}
            icon={AlertTriangle}
            hint={`${EUR(toReviewTotal)} à classer : charge pro ou perso`}
          />
        </button>
        {top.map((c) => (
          <AccountingKpiCard key={c.name} label={c.name} value={EUR(c.total)} icon={ReceiptText} hint={`${total ? ((c.total / total) * 100).toFixed(0) : 0} % des charges`} />
        ))}
      </div>

      {notice && (
        <div className={`rounded-lg border p-3 text-sm ${notice.tone === 'ok' ? 'border-green-200 bg-green-50 text-green-800' : 'border-red-200 bg-red-50 text-red-700'}`}>{notice.text}</div>
      )}

      {matrix.length > 0 && (
        <Card>
          <CardHeader><h3 className="text-base font-semibold text-gray-900">Charges par catégorie et par mois</h3></CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-100 text-xs text-gray-500">
                    <th className="px-4 py-2.5 text-left font-medium">Catégorie</th>
                    {months.map((m) => <th key={m} className="whitespace-nowrap px-4 py-2.5 text-right font-medium capitalize">{monthKeyLabel(m)}</th>)}
                    <th className="px-4 py-2.5 text-right font-medium">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {matrix.map((r) => (
                    <tr key={r.name} className="border-b border-gray-50 hover:bg-gray-50">
                      <td className="px-4 py-2.5 text-sm">
                        <button onClick={() => { setCategory(r.name); setStatus('validated'); }} className="text-gray-900 hover:underline">{r.name}</button>
                      </td>
                      {months.map((m) => <td key={m} className="px-4 py-2.5 text-right text-sm tabular-nums text-gray-600">{r.byMonth[m] ? EUR(r.byMonth[m]) : '—'}</td>)}
                      <td className="px-4 py-2.5 text-right text-sm font-medium tabular-nums text-gray-900">{EUR(r.total)}</td>
                    </tr>
                  ))}
                  <tr className="border-t border-gray-200">
                    <td className="px-4 py-2.5 text-sm font-semibold text-gray-900">Total</td>
                    {months.map((m) => (
                      <td key={m} className="px-4 py-2.5 text-right text-sm font-semibold tabular-nums text-gray-900">
                        {EUR(matrix.reduce((s, r) => s + (r.byMonth[m] || 0), 0))}
                      </td>
                    ))}
                    <td className="px-4 py-2.5 text-right text-sm font-semibold tabular-nums text-gray-900">{EUR(total)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <select value={status} onChange={(e) => setStatus(e.target.value as StatusFilter)} className="h-9 rounded-lg border border-gray-200 bg-white px-2.5 text-sm text-gray-700">
                <option value="validated">Charges comptées</option>
                <option value="to_review">À vérifier ({toReview.length}, toutes périodes)</option>
                <option value="excluded">Exclues (perso)</option>
                <option value="all">Toutes</option>
              </select>
              <select value={category} onChange={(e) => setCategory(e.target.value)} className="h-9 rounded-lg border border-gray-200 bg-white px-2.5 text-sm text-gray-700">
                <option value="">Toutes les catégories</option>
                {[UNCATEGORIZED, ...categories.map((c) => c.name)].map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
              <button
                onClick={() => setMissingOnly((v) => !v)}
                className={`inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-sm ${missingOnly ? 'border-amber-300 bg-amber-50 text-amber-800' : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'}`}
                title="Charges comptées de la période sans justificatif sur Qonto"
              >
                <Paperclip className="h-4 w-4" /> Sans justificatif ({missingCount})
              </button>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button onClick={importQonto} disabled={busy !== null} className={btn} title="Classe les nouveaux débits Qonto selon les règles (IWG, Entrupy, DHL…)">
                {busy === 'import' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Landmark className="h-4 w-4" />} Importer Qonto
              </button>
              <button onClick={fetchStripeFees} disabled={busy !== null} className={btn} title="Frais de paiement et de virement d'un mois, lus dans Stripe">
                {busy === 'stripe' ? <Loader2 className="h-4 w-4 animate-spin" /> : <CreditCard className="h-4 w-4" />} Frais Stripe
              </button>
              <button onClick={() => setManaging(true)} className={btn}>
                <Settings2 className="h-4 w-4" /> Catégories
              </button>
              <button onClick={() => setEditing('new')} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-gray-900 px-3 text-sm font-medium text-white hover:bg-gray-800">
                <Plus className="h-4 w-4" /> Ajouter une charge
              </button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {shown.length === 0 ? (
            <p className="py-12 text-center text-sm text-gray-500">{status === 'to_review' ? 'Rien à vérifier.' : 'Aucune charge sur la période.'}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-100 text-xs text-gray-500">
                    <th className="px-4 py-2.5 text-left font-medium">Date</th>
                    <th className="px-4 py-2.5 text-left font-medium">Libellé</th>
                    <th className="px-4 py-2.5 text-left font-medium">Catégorie</th>
                    <th className="px-4 py-2.5 text-left font-medium">Statut</th>
                    <th className="px-4 py-2.5 text-right font-medium">Montant</th>
                    <th className="px-4 py-2.5" />
                  </tr>
                </thead>
                <tbody>
                  {shown.map((e) => (
                    <tr key={e.id} className="border-b border-gray-50 hover:bg-gray-50">
                      <td className="whitespace-nowrap px-4 py-2.5 text-sm text-gray-600">{expenseDate(e).toLocaleDateString('fr-FR')}</td>
                      <td className="px-4 py-2.5 text-sm text-gray-900">
                        {e.label}
                        {e.bank_transaction_id && <span className="ml-1.5 rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-500">Qonto</span>}
                        {e.bank_transaction_id && (
                          isMissing(e) ? (
                            <label
                              className={`ml-1.5 inline-flex cursor-pointer items-center gap-1 rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 hover:bg-amber-100 ${uploading === e.id ? 'pointer-events-none opacity-60' : ''}`}
                              title="Ajouter le justificatif : il est déposé directement sur la transaction Qonto"
                            >
                              {uploading === e.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Upload className="h-3 w-3" />}
                              {uploading === e.id ? 'Envoi…' : 'Justificatif manquant'}
                              <input
                                type="file"
                                accept="application/pdf,image/jpeg,image/png"
                                className="hidden"
                                onChange={(ev) => {
                                  const f = ev.target.files?.[0];
                                  ev.target.value = '';
                                  if (f) uploadReceipt(e, f);
                                }}
                              />
                            </label>
                          ) : (
                            <span className="ml-1.5 inline-flex items-center gap-0.5 rounded bg-green-50 px-1.5 py-0.5 text-[10px] font-medium text-green-700" title="Justificatif présent sur Qonto">
                              <Paperclip className="h-3 w-3" /> Justificatif
                            </span>
                          )
                        )}
                        {e.notes && e.notes !== 'Import Qonto' && <p className="text-xs text-gray-500">{e.notes}</p>}
                      </td>
                      <td className="px-4 py-2.5 text-sm text-gray-600">
                        {e.review_status === 'validated' ? (
                          e.category || UNCATEGORIZED
                        ) : (
                          <select
                            value={pick[e.id] ?? e.category ?? ''}
                            onChange={(ev) => setPick({ ...pick, [e.id]: ev.target.value })}
                            className="h-8 rounded-lg border border-gray-200 bg-white px-2 text-sm text-gray-700"
                          >
                            <option value="">Catégorie…</option>
                            {categories.map((c) => <option key={c.id} value={c.name}>{c.name}</option>)}
                          </select>
                        )}
                      </td>
                      <td className="px-4 py-2.5">
                        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_BADGE[e.review_status].cls}`}>{STATUS_BADGE[e.review_status].label}</span>
                      </td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-right text-sm font-medium tabular-nums text-gray-900">
                        {EUR(e.amount)}
                        {(e.vat_amount ?? e.bank?.vat_amount) ? <p className="text-[11px] font-normal text-gray-500">dont TVA {EUR(Number(e.vat_amount ?? e.bank?.vat_amount))}</p> : null}
                      </td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-right">
                        {busy === e.id ? (
                          <Loader2 className="ml-auto h-4 w-4 animate-spin text-gray-400" />
                        ) : e.review_status === 'validated' ? (
                          <>
                            <button onClick={() => setEditing(e)} className="rounded p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700" title="Modifier">
                              <Pencil className="h-4 w-4" />
                            </button>
                            <button onClick={() => remove(e)} className="rounded p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600" title="Supprimer">
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </>
                        ) : (
                          <div className="flex justify-end gap-1.5">
                            <button onClick={() => classify(e, 'pro')} className="rounded-lg bg-gray-900 px-2.5 py-1 text-xs font-medium text-white hover:bg-gray-800">
                              Charge pro
                            </button>
                            {e.review_status === 'to_review' && (
                              <button onClick={() => classify(e, 'perso')} className="rounded-lg border border-gray-200 px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-100">
                                Perso, exclure
                              </button>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {editing && (
        <ExpenseFormModal
          expense={editing === 'new' ? null : editing}
          categories={categories}
          onClose={() => setEditing(null)}
          onSave={async (data) => {
            if (editing === 'new') await createExpense(data);
            else await updateExpense(editing.id, data);
            setEditing(null);
          }}
        />
      )}
      {managing && (
        <CategoriesModal
          categories={categories}
          onClose={() => setManaging(false)}
          onChanged={async () => {
            await refreshCategories();
            await refreshExpenses();
          }}
        />
      )}
    </div>
  );
};

const ModalShell: React.FC<{ title: string; onClose: () => void; children: React.ReactNode }> = ({ title, onClose, children }) => (
  <div className="fixed inset-0 z-50 overflow-y-auto">
    <div className="fixed inset-0 bg-black/40" onClick={onClose} />
    <div className="flex min-h-full items-center justify-center p-4">
      <div className="relative w-full max-w-md rounded-2xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-gray-100 p-4">
          <h3 className="text-lg font-semibold text-gray-900">{title}</h3>
          <button onClick={onClose} className="rounded-lg p-1 text-gray-400 hover:text-gray-600"><X className="h-5 w-5" /></button>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>
  </div>
);

const inputCls = 'mt-1 h-9 w-full rounded-lg border border-gray-200 px-2.5 text-sm font-normal text-gray-900 focus:border-gray-400 focus:outline-none';

const ExpenseFormModal: React.FC<{
  expense: Expense | null;
  categories: ExpenseCategoryRow[];
  onClose: () => void;
  onSave: (data: Partial<Expense>) => Promise<void>;
}> = ({ expense, categories, onClose, onSave }) => {
  const [form, setForm] = useState({
    label: expense?.label ?? '',
    category: expense?.category ?? categories[0]?.name ?? '',
    amount: expense ? String(expense.amount).replace('.', ',') : '',
    spent_at: expense?.spent_at ?? todayIso(),
    notes: expense?.notes ?? '',
    // TVA déductible (0280) : saisie ici si Qonto ne la connaît pas.
    vat: expense?.vat_amount != null ? String(expense.vat_amount).replace('.', ',') : '',
  });
  const qontoVat = expense?.bank?.vat_amount ?? null;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Catégorie d'une dépense qui n'existe plus dans la liste : on la garde sélectionnable.
  const options = form.category && !categories.some((c) => c.name === form.category) ? [form.category, ...categories.map((c) => c.name)] : categories.map((c) => c.name);

  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    const amount = Number(form.amount.replace(/\s/g, '').replace(',', '.'));
    if (!form.label.trim()) return setError('Le libellé est obligatoire.');
    if (!form.amount.trim() || Number.isNaN(amount) || amount < 0) return setError('Montant invalide.');
    const vat = form.vat.trim() ? Number(form.vat.replace(/\s/g, '').replace(',', '.')) : null;
    if (vat !== null && (Number.isNaN(vat) || vat < 0 || vat > amount)) return setError('TVA invalide.');
    setBusy(true);
    setError(null);
    try {
      await onSave({ label: form.label.trim(), category: form.category || null, amount, spent_at: form.spent_at, notes: form.notes.trim() || null, vat_amount: vat });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Enregistrement impossible');
      setBusy(false);
    }
  };

  return (
    <ModalShell title={expense ? 'Modifier la charge' : 'Ajouter une charge'} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <label className="block text-sm font-medium text-gray-700">
          Libellé
          <input autoFocus value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} placeholder="Ex. : envoi colis Japon, commission Brand Off…" className={inputCls} />
        </label>
        <label className="block text-sm font-medium text-gray-700">
          Catégorie
          <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className={inputCls}>
            <option value="">{UNCATEGORIZED}</option>
            {options.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-sm font-medium text-gray-700">
            Montant payé (€)
            <input inputMode="decimal" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} placeholder="0,00" className={inputCls} />
          </label>
          <label className="block text-sm font-medium text-gray-700">
            Date
            <input type="date" value={form.spent_at} onChange={(e) => setForm({ ...form, spent_at: e.target.value })} className={inputCls} />
          </label>
        </div>
        <label className="block text-sm font-medium text-gray-700">
          <span className="flex items-center justify-between">
            TVA déductible (€)
            <button
              type="button"
              onClick={() => {
                const ttc = Number(form.amount.replace(/\s/g, '').replace(',', '.')) || 0;
                setForm({ ...form, vat: (Math.round((ttc - ttc / 1.2) * 100) / 100).toFixed(2).replace('.', ',') });
              }}
              className="text-xs font-normal text-blue-600 hover:underline"
            >
              20 % du montant
            </button>
          </span>
          <input
            inputMode="decimal"
            value={form.vat}
            onChange={(e) => setForm({ ...form, vat: e.target.value })}
            placeholder={qontoVat != null ? `Qonto : ${String(qontoVat).replace('.', ',')}` : 'Montant de TVA sur la facture'}
            className={inputCls}
          />
          <span className="mt-1 block text-xs font-normal text-gray-500">
            Montant indiqué sur la facture. Vide : TVA lue par Qonto sur le débit relié. Déduite seulement à partir de la bascule TVA.
          </span>
        </label>
        <label className="block text-sm font-medium text-gray-700">
          Note (facultatif)
          <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} className="mt-1 w-full rounded-lg border border-gray-200 p-2.5 text-sm font-normal focus:border-gray-400 focus:outline-none" />
        </label>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="rounded-lg px-4 py-2 text-sm text-gray-600 hover:bg-gray-100">Annuler</button>
          <button type="submit" disabled={busy} className="inline-flex items-center gap-1.5 rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50">
            {busy && <Loader2 className="h-4 w-4 animate-spin" />} Enregistrer
          </button>
        </div>
      </form>
    </ModalShell>
  );
};

/** Ajout / renommage / suppression des catégories. Renommer met à jour les
 * frais déjà saisis ; supprimer les laisse « Sans catégorie ». */
const CategoriesModal: React.FC<{ categories: ExpenseCategoryRow[]; onClose: () => void; onChanged: () => Promise<void> }> = ({ categories, onClose, onChanged }) => {
  const [names, setNames] = useState<Record<string, string>>(() => Object.fromEntries(categories.map((c) => [c.id, c.name])));
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setNames(Object.fromEntries(categories.map((c) => [c.id, c.name])));
  }, [categories]);

  const run = async (key: string, fn: () => Promise<{ error: { message: string } | null }>) => {
    setBusy(key);
    setError(null);
    const { error: e } = await fn();
    if (e) setError(e.message.includes('duplicate') ? 'Cette catégorie existe déjà.' : e.message);
    else await onChanged();
    setBusy(null);
  };

  const add = () => {
    const name = newName.trim();
    if (!name) return;
    run('new', async () => {
      const position = (categories[categories.length - 1]?.position ?? 0) + 10;
      const res = await supabase.from('expense_categories').insert({ name, position });
      if (!res.error) setNewName('');
      return res;
    });
  };

  const rename = (c: ExpenseCategoryRow) => {
    const name = (names[c.id] || '').trim();
    if (!name || name === c.name) return;
    run(c.id, async () => {
      const res = await supabase.from('expense_categories').update({ name }).eq('id', c.id);
      if (res.error) return res;
      return supabase.from('expenses').update({ category: name }).eq('category', c.name);
    });
  };

  const remove = (c: ExpenseCategoryRow) => {
    if (!window.confirm(`Supprimer la catégorie « ${c.name} » ? Ses charges passeront « ${UNCATEGORIZED} ».`)) return;
    run(c.id, async () => {
      const res = await supabase.from('expenses').update({ category: null }).eq('category', c.name);
      if (res.error) return res;
      return supabase.from('expense_categories').delete().eq('id', c.id);
    });
  };

  return (
    <ModalShell title="Catégories de charges" onClose={onClose}>
      <div className="space-y-2">
        {categories.map((c) => (
          <div key={c.id} className="flex items-center gap-2">
            <input
              value={names[c.id] ?? ''}
              onChange={(e) => setNames({ ...names, [c.id]: e.target.value })}
              onBlur={() => rename(c)}
              onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
              className="h-9 flex-1 rounded-lg border border-gray-200 px-2.5 text-sm focus:border-gray-400 focus:outline-none"
            />
            {busy === c.id ? (
              <Loader2 className="h-4 w-4 animate-spin text-gray-400" />
            ) : (
              <button onClick={() => remove(c)} className="rounded p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600" title="Supprimer">
                <Trash2 className="h-4 w-4" />
              </button>
            )}
          </div>
        ))}
        <div className="flex items-center gap-2 border-t border-gray-100 pt-3">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && add()}
            placeholder="Nouvelle catégorie…"
            className="h-9 flex-1 rounded-lg border border-gray-200 px-2.5 text-sm focus:border-gray-400 focus:outline-none"
          />
          <button onClick={add} disabled={busy === 'new' || !newName.trim()} className="inline-flex h-9 items-center gap-1 rounded-lg bg-gray-900 px-3 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50">
            {busy === 'new' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Ajouter
          </button>
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <p className="text-xs text-gray-500">Renommer une catégorie met à jour les charges déjà saisies.</p>
      </div>
    </ModalShell>
  );
};

export default ChargesTab;
