import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowDownLeft, ArrowUpRight, FileText, Landmark, Loader2, Plus, Receipt, Trash2, Wallet, X } from 'lucide-react';
import { supabase } from '../../../lib/supabase';
import { Card, CardContent, CardHeader } from '../../ui/Card';
import { AccountingKpiCard } from './AccountingKpiCard';
import { ASSOCIATE_TYPES, AssociateEntryType, associateSigned } from '../../../utils/associateAccount';

const EUR = (n: number) => (Number(n) || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
const todayIso = () => new Date().toISOString().slice(0, 10);
const RECEIPTS_BUCKET = 'accounting-receipts';

export interface AssociateEntry {
  id: string;
  entry_date: string;
  type: AssociateEntryType;
  label: string;
  amount: number;
  expense_id: string | null;
  bank_transaction_id: string | null;
  receipt_path: string | null;
  notes: string | null;
  expense: { label: string; amount: number; category: string | null } | null;
  bank: { label: string; amount: number; settled_at: string } | null;
}

interface AssociateAccountTabProps {
  /** Ouvre l'onglet Charges / Trésorerie Qonto depuis un mouvement relié. */
  onOpenTab: (tab: 'expenses' | 'qonto') => void;
  /** Recharge les charges (la dépense payée en perso en crée une). */
  onExpensesChanged: () => Promise<void>;
}

/** Comptabilité → Compte courant associé (0279) : dette de la SAS envers son
 * président (apports, dépenses payées en perso, retraits). Ni CA ni charge :
 * seule la dépense payée en perso est une charge, créée dans l'onglet Charges. */
export const AssociateAccountTab: React.FC<AssociateAccountTabProps> = ({ onOpenTab, onExpensesChanged }) => {
  const [entries, setEntries] = useState<AssociateEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    const { data, error: e } = await supabase
      .from('associate_account_entries')
      .select('id, entry_date, type, label, amount, expense_id, bank_transaction_id, receipt_path, notes, expense:expenses(label, amount, category), bank:bank_transactions(label, amount, settled_at)')
      .order('entry_date', { ascending: false })
      .order('created_at', { ascending: false });
    if (e) setError(e.message);
    else setEntries(((data || []) as unknown as AssociateEntry[]).map((r) => ({ ...r, amount: Number(r.amount) })));
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const totals = useMemo(() => {
    const sum = (t: AssociateEntryType) => entries.filter((e) => e.type === t).reduce((s, e) => s + e.amount, 0);
    return {
      balance: entries.reduce((s, e) => s + associateSigned(e), 0),
      apports: sum('apport'),
      perso: sum('depense_payee_perso'),
      out: sum('retrait') + sum('remboursement_associe'),
    };
  }, [entries]);

  // Solde après chaque mouvement (liste du plus récent au plus ancien).
  const running = useMemo(() => {
    const map = new Map<string, number>();
    let acc = 0;
    [...entries].reverse().forEach((e) => {
      acc += associateSigned(e);
      map.set(e.id, acc);
    });
    return map;
  }, [entries]);

  const openReceipt = async (path: string) => {
    const { data, error: e } = await supabase.storage.from(RECEIPTS_BUCKET).createSignedUrl(path, 600);
    if (e || !data) return alert(e?.message || 'Justificatif introuvable');
    window.open(data.signedUrl, '_blank', 'noopener');
  };

  const remove = async (e: AssociateEntry) => {
    const withExpense = e.expense_id ? ' La charge reliée reste dans l\'onglet Charges.' : '';
    if (!window.confirm(`Supprimer le mouvement « ${e.label} » (${EUR(e.amount)}) ?${withExpense}`)) return;
    const { error: err } = await supabase.from('associate_account_entries').delete().eq('id', e.id);
    if (err) return alert(err.message);
    await load();
  };

  if (loading) return <div className="h-64 animate-pulse rounded-lg bg-gray-100" />;

  const owed = totals.balance >= 0;

  return (
    <div className="space-y-6">
      {error && <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">Erreur : {error}</p>}

      <Card>
        <CardContent className="p-6">
          <p className="text-sm text-gray-500">Solde du compte courant d'associé (à ce jour)</p>
          <p className={`mt-1 text-3xl font-semibold tabular-nums ${owed ? 'text-gray-900' : 'text-red-600'}`}>
            {owed ? `La société vous doit ${EUR(totals.balance)}` : `Vous devez ${EUR(-totals.balance)} à la société`}
          </p>
          <p className="mt-2 text-xs text-gray-500">
            Apports et dépenses payées en perso augmentent la dette de la société ; retraits et remboursements la diminuent. Ni chiffre d'affaires ni charge : seule la dépense payée en perso est comptée en charge.
          </p>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <AccountingKpiCard label="Apports" value={EUR(totals.apports)} icon={ArrowDownLeft} tone="green" />
        <AccountingKpiCard label="Dépenses payées en perso" value={EUR(totals.perso)} icon={Receipt} />
        <AccountingKpiCard label="Retraits et remboursements" value={EUR(totals.out)} icon={ArrowUpRight} tone="red" />
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-base font-semibold text-gray-900">Mouvements</h3>
              <p className="text-sm text-gray-500">Du plus récent au plus ancien, avec le solde après chaque mouvement.</p>
            </div>
            <button onClick={() => setAdding(true)} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-gray-900 px-3 text-sm font-medium text-white hover:bg-gray-800">
              <Plus className="h-4 w-4" /> Dépense payée en perso
            </button>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {entries.length === 0 ? (
            <p className="py-12 text-center text-sm text-gray-500">Aucun mouvement.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-100 text-xs text-gray-500">
                    <th className="px-4 py-2.5 text-left font-medium">Date</th>
                    <th className="px-4 py-2.5 text-left font-medium">Type</th>
                    <th className="px-4 py-2.5 text-left font-medium">Libellé</th>
                    <th className="px-4 py-2.5 text-left font-medium">Relié à</th>
                    <th className="px-4 py-2.5 text-right font-medium">Montant</th>
                    <th className="px-4 py-2.5 text-right font-medium">Solde</th>
                    <th className="px-4 py-2.5" />
                  </tr>
                </thead>
                <tbody>
                  {entries.map((e) => {
                    const signed = associateSigned(e);
                    return (
                      <tr key={e.id} className="border-b border-gray-50 hover:bg-gray-50">
                        <td className="whitespace-nowrap px-4 py-2.5 text-sm text-gray-600">{new Date(`${e.entry_date}T12:00:00`).toLocaleDateString('fr-FR')}</td>
                        <td className="whitespace-nowrap px-4 py-2.5 text-sm text-gray-700">{ASSOCIATE_TYPES[e.type].label}</td>
                        <td className="px-4 py-2.5 text-sm text-gray-900">
                          {e.label}
                          {e.notes && <p className="text-xs text-gray-500">{e.notes}</p>}
                        </td>
                        <td className="px-4 py-2.5 text-xs">
                          <div className="flex flex-col items-start gap-1">
                            {e.expense && (
                              <button onClick={() => onOpenTab('expenses')} className="inline-flex items-center gap-1 text-gray-700 hover:underline" title="Ouvrir l'onglet Charges">
                                <Receipt className="h-3.5 w-3.5" /> Charge : {e.expense.label} ({EUR(Number(e.expense.amount))})
                              </button>
                            )}
                            {e.bank && (
                              <button onClick={() => onOpenTab('qonto')} className="inline-flex items-center gap-1 text-gray-700 hover:underline" title="Ouvrir la trésorerie Qonto">
                                <Landmark className="h-3.5 w-3.5" /> Qonto : {e.bank.label} du {new Date(e.bank.settled_at).toLocaleDateString('fr-FR')}
                              </button>
                            )}
                            {e.receipt_path && (
                              <button onClick={() => openReceipt(e.receipt_path!)} className="inline-flex items-center gap-1 text-gray-700 hover:underline">
                                <FileText className="h-3.5 w-3.5" /> Justificatif
                              </button>
                            )}
                            {!e.expense && !e.bank && !e.receipt_path && <span className="text-gray-400">—</span>}
                          </div>
                        </td>
                        <td className={`whitespace-nowrap px-4 py-2.5 text-right text-sm font-medium tabular-nums ${signed >= 0 ? 'text-green-700' : 'text-red-600'}`}>
                          {signed >= 0 ? '+' : '−'}{EUR(Math.abs(signed))}
                        </td>
                        <td className="whitespace-nowrap px-4 py-2.5 text-right text-sm tabular-nums text-gray-600">{EUR(running.get(e.id) || 0)}</td>
                        <td className="whitespace-nowrap px-4 py-2.5 text-right">
                          <button onClick={() => remove(e)} className="rounded p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600" title="Supprimer">
                            <Trash2 className="h-4 w-4" />
                          </button>
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

      {adding && (
        <PersonalExpenseModal
          onClose={() => setAdding(false)}
          onSaved={async () => {
            setAdding(false);
            await Promise.all([load(), onExpensesChanged()]);
          }}
        />
      )}
    </div>
  );
};

const inputCls = 'mt-1 h-9 w-full rounded-lg border border-gray-200 bg-white px-2.5 text-sm font-normal text-gray-900 focus:border-gray-400 focus:outline-none';
const parseAmount = (v: string) => Number(v.replace(/\s/g, '').replace(',', '.'));

/** Dépense payée avec l'argent perso : crée la charge et la ligne de dette
 * (RPC associate_add_personal_expense, 0279), justificatif facultatif. */
const PersonalExpenseModal: React.FC<{ onClose: () => void; onSaved: () => Promise<void> }> = ({ onClose, onSaved }) => {
  const [form, setForm] = useState({ date: todayIso(), label: '', amount: '', category: '', notes: '' });
  const [file, setFile] = useState<File | null>(null);
  const [categories, setCategories] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));

  useEffect(() => {
    supabase
      .from('expense_categories')
      .select('name')
      .order('position')
      .order('name')
      .then(({ data }) => {
        const names = ((data || []) as { name: string }[]).map((c) => c.name);
        setCategories(names);
        setForm((f) => (f.category ? f : { ...f, category: names.includes('Autres') ? 'Autres' : names[0] || '' }));
      });
  }, []);

  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    const amount = parseAmount(form.amount);
    if (!form.label.trim()) return setError('Le libellé est obligatoire.');
    if (!form.amount.trim() || Number.isNaN(amount) || amount <= 0) return setError('Montant invalide.');
    setBusy(true);
    setError(null);
    let receiptPath: string | null = null;
    if (file) {
      const safe = file.name.normalize('NFD').replace(/[^\w.-]+/g, '_');
      receiptPath = `associate/${form.date}/${crypto.randomUUID()}-${safe}`;
      const { error: up } = await supabase.storage.from(RECEIPTS_BUCKET).upload(receiptPath, file, { contentType: file.type || undefined });
      if (up) {
        setBusy(false);
        return setError(`Justificatif : ${up.message}`);
      }
    }
    const { error: e } = await supabase.rpc('associate_add_personal_expense', {
      p_date: form.date,
      p_label: form.label.trim(),
      p_amount: amount,
      p_category: form.category || null,
      p_notes: form.notes.trim() || null,
      p_receipt_path: receiptPath,
    });
    if (e) {
      if (receiptPath) await supabase.storage.from(RECEIPTS_BUCKET).remove([receiptPath]);
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
            <h3 className="text-lg font-semibold text-gray-900">Dépense payée en perso</h3>
            <button onClick={onClose} className="rounded-lg p-1 text-gray-400 hover:text-gray-600"><X className="h-5 w-5" /></button>
          </div>
          <form onSubmit={submit} className="space-y-3 p-4">
            <p className="flex items-start gap-2 rounded-lg bg-gray-50 p-3 text-xs text-gray-600">
              <Wallet className="mt-0.5 h-4 w-4 flex-shrink-0" />
              Crée la charge (onglet Charges) et ajoute le montant à ce que la société vous doit.
            </p>
            <div className="grid grid-cols-2 gap-3">
              <label className="block text-sm font-medium text-gray-700">
                Date
                <input type="date" value={form.date} onChange={(e) => set('date', e.target.value)} className={inputCls} />
              </label>
              <label className="block text-sm font-medium text-gray-700">
                Montant TTC (€)
                <input inputMode="decimal" value={form.amount} onChange={(e) => set('amount', e.target.value)} placeholder="0,00" className={inputCls} />
              </label>
            </div>
            <label className="block text-sm font-medium text-gray-700">
              Libellé
              <input autoFocus value={form.label} onChange={(e) => set('label', e.target.value)} placeholder="Ex. : Fnac – écran (facture 123…)" className={inputCls} />
            </label>
            <label className="block text-sm font-medium text-gray-700">
              Catégorie de charge
              <select value={form.category} onChange={(e) => set('category', e.target.value)} className={inputCls}>
                {categories.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>
            <label className="block text-sm font-medium text-gray-700">
              Justificatif (facultatif)
              <input type="file" accept="image/*,application/pdf" onChange={(e) => setFile(e.target.files?.[0] || null)} className="mt-1 block w-full text-sm text-gray-600 file:mr-3 file:rounded-lg file:border-0 file:bg-gray-100 file:px-3 file:py-1.5 file:text-sm" />
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

export default AssociateAccountTab;
