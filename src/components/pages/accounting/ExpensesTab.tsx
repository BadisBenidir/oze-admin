import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, Pencil, Plus, Receipt, Settings2, Trash2, X } from 'lucide-react';
import { supabase } from '../../../lib/supabase';
import { Card, CardContent, CardHeader } from '../../ui/Card';
import { AccountingKpiCard } from './AccountingKpiCard';
import { Expense } from '../../../hooks/useExpenses';
import { AccountingPeriod } from '../../../utils/accountingPeriods';
import { expenseDate, expensesInRange } from '../../../utils/accountingCalc';

const EUR = (n: number) => (Number(n) || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
const UNCATEGORIZED = 'Sans catégorie';
const todayIso = () => new Date().toISOString().slice(0, 10);

export interface ExpenseCategoryRow {
  id: string;
  name: string;
  position: number;
}

/** Catégories de frais (0274), gérées depuis l'onglet. */
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

interface ExpensesTabProps {
  expenses: Expense[];
  period: AccountingPeriod;
  createExpense: (data: Partial<Expense>) => Promise<void>;
  updateExpense: (id: string, data: Partial<Expense>) => Promise<void>;
  deleteExpense: (id: string) => Promise<void>;
  refreshExpenses: () => Promise<void>;
}

/** Comptabilité → Frais externes : frais saisis à la main (envois,
 * commissions fournisseurs, douane…), par catégorie, déduits de la marge
 * brute dans le Dashboard Global. */
export const ExpensesTab: React.FC<ExpensesTabProps> = ({ expenses, period, createExpense, updateExpense, deleteExpense, refreshExpenses }) => {
  const { categories, refresh: refreshCategories } = useExpenseCategories();
  const [editing, setEditing] = useState<Expense | 'new' | null>(null);
  const [managing, setManaging] = useState(false);
  const [filter, setFilter] = useState('');

  const inPeriod = useMemo(() => expensesInRange(expenses, period.range), [expenses, period.range]);
  const shown = filter ? inPeriod.filter((e) => (e.category || UNCATEGORIZED) === filter) : inPeriod;
  const total = inPeriod.reduce((s, e) => s + Number(e.amount || 0), 0);
  const momTotal = period.momRange ? expensesInRange(expenses, period.momRange).reduce((s, e) => s + Number(e.amount || 0), 0) : null;

  const byCategory = useMemo(() => {
    const map = new Map<string, { total: number; count: number }>();
    for (const e of inPeriod) {
      const k = e.category || UNCATEGORIZED;
      const cur = map.get(k) || { total: 0, count: 0 };
      map.set(k, { total: cur.total + Number(e.amount || 0), count: cur.count + 1 });
    }
    return [...map.entries()].map(([name, v]) => ({ name, ...v })).sort((a, b) => b.total - a.total);
  }, [inPeriod]);

  const remove = async (e: Expense) => {
    if (!window.confirm(`Supprimer « ${e.label} » (${EUR(e.amount)}) ?`)) return;
    try {
      await deleteExpense(e.id);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Suppression impossible');
    }
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <AccountingKpiCard
          label="Frais externes (période)"
          value={EUR(total)}
          icon={Receipt}
          tone="red"
          hint={`${inPeriod.length} frais saisi${inPeriod.length > 1 ? 's' : ''} · déduits de la marge du Dashboard Global`}
          deltaMoM={momTotal ? ((total - momTotal) / momTotal) * 100 : undefined}
        />
        {byCategory.slice(0, 3).map((c) => (
          <AccountingKpiCard key={c.name} label={c.name} value={EUR(c.total)} icon={Receipt} hint={`${c.count} frais · ${total ? ((c.total / total) * 100).toFixed(0) : 0} % du total`} />
        ))}
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="text-base font-semibold text-gray-900">Frais de la période</h3>
            <div className="flex flex-wrap items-center gap-2">
              <select value={filter} onChange={(e) => setFilter(e.target.value)} className="h-9 rounded-lg border border-gray-200 bg-white px-2.5 text-sm text-gray-700">
                <option value="">Toutes les catégories</option>
                {byCategory.map((c) => (
                  <option key={c.name} value={c.name}>{c.name} ({EUR(c.total)})</option>
                ))}
              </select>
              <button onClick={() => setManaging(true)} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 text-sm text-gray-700 hover:bg-gray-50">
                <Settings2 className="h-4 w-4" /> Catégories
              </button>
              <button onClick={() => setEditing('new')} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-gray-900 px-3 text-sm font-medium text-white hover:bg-gray-800">
                <Plus className="h-4 w-4" /> Ajouter un frais
              </button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {shown.length === 0 ? (
            <p className="py-12 text-center text-sm text-gray-500">Aucun frais sur la période.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-100 text-xs text-gray-500">
                    <th className="px-4 py-2.5 text-left font-medium">Date</th>
                    <th className="px-4 py-2.5 text-left font-medium">Libellé</th>
                    <th className="px-4 py-2.5 text-left font-medium">Catégorie</th>
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
                        {e.notes && <p className="text-xs text-gray-500">{e.notes}</p>}
                      </td>
                      <td className="px-4 py-2.5 text-sm text-gray-600">{e.category || UNCATEGORIZED}</td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-right text-sm font-medium tabular-nums text-gray-900">{EUR(e.amount)}</td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-right">
                        <button onClick={() => setEditing(e)} className="rounded p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700" title="Modifier">
                          <Pencil className="h-4 w-4" />
                        </button>
                        <button onClick={() => remove(e)} className="rounded p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600" title="Supprimer">
                          <Trash2 className="h-4 w-4" />
                        </button>
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
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Catégorie d'une dépense qui n'existe plus dans la liste : on la garde sélectionnable.
  const options = form.category && !categories.some((c) => c.name === form.category) ? [form.category, ...categories.map((c) => c.name)] : categories.map((c) => c.name);

  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    const amount = Number(form.amount.replace(/\s/g, '').replace(',', '.'));
    if (!form.label.trim()) return setError('Le libellé est obligatoire.');
    if (!form.amount.trim() || Number.isNaN(amount) || amount < 0) return setError('Montant invalide.');
    setBusy(true);
    setError(null);
    try {
      await onSave({ label: form.label.trim(), category: form.category || null, amount, spent_at: form.spent_at, notes: form.notes.trim() || null });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Enregistrement impossible');
      setBusy(false);
    }
  };

  return (
    <ModalShell title={expense ? 'Modifier le frais' : 'Ajouter un frais'} onClose={onClose}>
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
    if (!window.confirm(`Supprimer la catégorie « ${c.name} » ? Ses frais passeront « ${UNCATEGORIZED} ».`)) return;
    run(c.id, async () => {
      const res = await supabase.from('expenses').update({ category: null }).eq('category', c.name);
      if (res.error) return res;
      return supabase.from('expense_categories').delete().eq('id', c.id);
    });
  };

  return (
    <ModalShell title="Catégories de frais" onClose={onClose}>
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
        <p className="text-xs text-gray-500">Renommer une catégorie met à jour les frais déjà saisis.</p>
      </div>
    </ModalShell>
  );
};

export default ExpensesTab;
