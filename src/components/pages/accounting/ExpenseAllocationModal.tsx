import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, X } from 'lucide-react';
import { supabase } from '../../../lib/supabase';
import { Expense } from '../../../hooks/useExpenses';
import { useVatSettings, vatAccountingRateAt } from '../../../utils/vat';
import { expenseVatProfile, useCategoryVat } from '../../../utils/vatRecovery';
import { useHideFigures } from '../../../hooks/useHideFigures';

/**
 * Frais d'approche d'un paiement (DHL : droits de douane, taxes, frais) répartis
 * sur le coût d'achat des articles de l'envoi (0290).
 *
 * 1. TVA d'import déductible (après la bascule TVA) : séparée des droits — elle
 *    n'entre jamais dans le coût des articles.
 * 2. Références des articles de l'envoi (code produit, référence OZ-…, réf. B2B
 *    ou référence fournisseur), ou « articles du mois ».
 * 3. Aperçu puis application : montant hors TVA réparti au prorata du prix
 *    d'achat, la charge passe en « Achat marchandise » (plus en charge externe).
 */

const EUR = (n: number | null | undefined) =>
  (Number(n) || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';

interface PreviewRow { product_id: string; code: string; name: string; before: number | null; share: number; after: number }
interface Preview { base: number; count: number; total_cost_before: number; rows: PreviewRow[] }
interface Allocation { amount: number; purchase_price_before: number | null; product: { product_code: string | null; reference: string | null; name: string; purchase_price: number | null } | null }

// Références reconnues dans un texte collé tel quel (liste OGATE : dates,
// marques, prix…) : n° de lot Aucnet (889-42873), EcoRing / EcoAuc (269047868,
// 2260008008820), codes admin (LB-…, OZ-…, OZE-B2B-…). Les prix « 28,886 » et
// les dates « 2026/10/16 » ne sont pas pris. Sans aucun motif reconnu : liste
// libre séparée par espaces / virgules.
const REF_PATTERNS = [
  /\b\d{3}-\d{5}\b/g,
  /\b\d{9,13}\b/g,
  /\bLB-[A-Z]+-[A-Z]-\d{4}-\d{2}-\d{6}\b/gi,
  /\bOZE-B2B-\d{4}-\d+\b/gi,
  /\bOZ-[A-Z]+-\d+\b/gi,
];
const parseRefs = (text: string) => {
  const found = REF_PATTERNS.flatMap((re) => text.match(re) || []);
  const list = found.length ? found : text.split(/[\s,;]+/);
  return [...new Set(list.map((r) => r.trim()).filter(Boolean))];
};

export const ExpenseAllocationModal: React.FC<{
  expense: Expense;
  onClose: () => void;
  onDone: () => Promise<void> | void;
  updateExpense: (id: string, data: Partial<Expense>) => Promise<void>;
}> = ({ expense, onClose, onDone, updateExpense }) => {
  const { show } = useHideFigures();
  const { settings } = useVatSettings();
  const { categories } = useCategoryVat();
  const vatApplies = vatAccountingRateAt(settings, new Date(`${expense.spent_at}T12:00:00`)) > 0;
  // Part récupérable de la TVA saisie (0313) + TVA import B00 : hors coût.
  const recovery = expenseVatProfile(expense, categories);
  const [vat, setVat] = useState(expense.vat_amount != null ? String(expense.vat_amount).replace('.', ',') : '');
  const vatValue = vatApplies ? Number(vat.replace(',', '.')) || 0 : 0;
  const base = Math.round((Number(expense.amount) - (vatApplies ? (recovery.foreign ? 0 : (vatValue * recovery.rate) / 100) + (Number(expense.import_vat_amount) || 0) : 0)) * 100) / 100;

  const [refs, setRefs] = useState('');
  const [productIds, setProductIds] = useState<string[] | null>(null);
  const [unmatched, setUnmatched] = useState<string[]>([]);
  const [duplicates, setDuplicates] = useState<string[]>([]);
  const detected = useMemo(() => parseRefs(refs), [refs]);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [existing, setExisting] = useState<Allocation[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');

  const loadExisting = useCallback(async () => {
    const { data } = await supabase
      .from('expense_cost_allocations')
      .select('amount, purchase_price_before, product:products(product_code, reference, name, purchase_price)')
      .eq('expense_id', expense.id)
      .order('amount', { ascending: false });
    setExisting((data || []) as unknown as Allocation[]);
  }, [expense.id]);
  useEffect(() => { loadExisting(); }, [loadExisting]);

  const monthLabel = useMemo(
    () => new Date(`${expense.spent_at}T12:00:00`).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' }),
    [expense.spent_at]
  );

  const saveVatIfChanged = async () => {
    if (!vatApplies) return;
    const next = vat.trim() === '' ? null : Math.round(vatValue * 100) / 100;
    if (next !== (expense.vat_amount ?? null)) await updateExpense(expense.id, { vat_amount: next });
  };

  const runPreview = async (ids: string[]) => {
    await saveVatIfChanged();
    const { data, error: rpcError } = await supabase.rpc('allocate_expense_to_products', { p_expense_id: expense.id, p_product_ids: ids, p_dry_run: true });
    if (rpcError) throw new Error(rpcError.message);
    setProductIds(ids);
    setPreview(data as Preview);
  };

  const previewFromRefs = async () => {
    setError('');
    const list = parseRefs(refs);
    if (!list.length) return setError('Colle les références des articles de l’envoi');
    setBusy('preview');
    try {
      const inList = list.map((r) => `"${r.replace(/"/g, '')}"`).join(',');
      const { data, error: qError } = await supabase
        .from('products')
        .select('id, product_code, reference, b2b_reference, source_reference, created_at')
        .or(`product_code.in.(${inList}),reference.in.(${inList}),b2b_reference.in.(${inList}),source_reference.in.(${inList})`);
      if (qError) throw new Error(qError.message);
      type Row = { id: string; product_code: string | null; reference: string | null; b2b_reference: string | null; source_reference: string | null; created_at: string };
      const rows = (data || []) as Row[];
      // Une référence = un article. Si plusieurs fiches portent la même
      // référence fournisseur (article recréé), on garde la plus récente et
      // on le signale.
      const ids = new Set<string>();
      const missing: string[] = [];
      const dups: string[] = [];
      for (const ref of list) {
        const matches = rows
          .filter((p) => [p.product_code, p.reference, p.b2b_reference, p.source_reference].includes(ref))
          .sort((a, b) => b.created_at.localeCompare(a.created_at));
        if (!matches.length) missing.push(ref);
        else {
          ids.add(matches[0].id);
          if (matches.length > 1) dups.push(`${ref} → ${matches[0].product_code || matches[0].id} (${matches.length} fiches)`);
        }
      }
      setUnmatched(missing);
      setDuplicates(dups);
      if (!ids.size) throw new Error('Aucun article trouvé pour ces références');
      await runPreview([...ids]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur');
    } finally {
      setBusy(null);
    }
  };

  const previewMonth = async () => {
    setError('');
    setUnmatched([]);
    setDuplicates([]);
    setBusy('month');
    try {
      const d = new Date(`${expense.spent_at}T12:00:00`);
      const start = new Date(d.getFullYear(), d.getMonth(), 1).toISOString();
      const end = new Date(d.getFullYear(), d.getMonth() + 1, 1).toISOString();
      const { data, error: qError } = await supabase.from('products').select('id').gte('created_at', start).lt('created_at', end);
      if (qError) throw new Error(qError.message);
      if (!data?.length) throw new Error(`Aucun article créé en ${monthLabel}`);
      await runPreview(data.map((p) => p.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur');
    } finally {
      setBusy(null);
    }
  };

  const apply = async () => {
    if (!productIds || !preview) return;
    if (!confirm(`Ajouter ${EUR(preview.base)} au coût d'achat de ${preview.count} article(s) ? La charge passera en « Achat marchandise ».`)) return;
    setBusy('apply');
    setError('');
    const { error: rpcError } = await supabase.rpc('allocate_expense_to_products', { p_expense_id: expense.id, p_product_ids: productIds, p_dry_run: false });
    setBusy(null);
    if (rpcError) return setError(rpcError.message);
    await onDone();
    onClose();
  };

  const cancelAllocation = async () => {
    if (!confirm('Annuler la répartition ? Le coût d’achat des articles et la catégorie de la charge sont restaurés.')) return;
    setBusy('cancel');
    const { error: rpcError } = await supabase.rpc('cancel_expense_allocation', { p_expense_id: expense.id });
    setBusy(null);
    if (rpcError) return setError(rpcError.message);
    await onDone();
    onClose();
  };

  const allocatedTotal = (existing || []).reduce((s, a) => s + Number(a.amount), 0);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="flex max-h-[90vh] w-full max-w-3xl flex-col rounded-xl bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between border-b border-gray-100 px-5 py-4">
          <div>
            <h3 className="text-base font-semibold text-gray-900">Répartir les frais sur les articles</h3>
            <p className="text-xs text-gray-500">
              {expense.label} · {new Date(`${expense.spent_at}T12:00:00`).toLocaleDateString('fr-FR')} · {EUR(expense.amount)}
            </p>
          </div>
          <button onClick={onClose} className="rounded p-1 text-gray-400 hover:bg-gray-100"><X className="h-5 w-5" /></button>
        </div>

        <div className="space-y-4 overflow-y-auto px-5 py-4">
          {existing && existing.length > 0 ? (
            <>
              <p className="text-sm text-gray-700">
                Déjà répartie : <strong>{EUR(allocatedTotal)}</strong> sur <strong>{existing.length}</strong> article(s).
              </p>
              <AllocationTable rows={existing.map((a) => ({
                code: a.product?.product_code || a.product?.reference || '—',
                name: a.product?.name || '',
                before: a.purchase_price_before,
                share: Number(a.amount),
                after: (Number(a.purchase_price_before) || 0) + Number(a.amount),
              }))} show={show} />
              <button onClick={cancelAllocation} disabled={busy !== null} className="rounded-lg border border-red-200 px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50">
                {busy === 'cancel' ? 'Annulation…' : 'Annuler la répartition'}
              </button>
            </>
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-lg bg-gray-50 p-3">
                  <p className="text-xs text-gray-500">Payé</p>
                  <p className="text-sm font-semibold text-gray-900">{EUR(expense.amount)}</p>
                </div>
                <label className="rounded-lg bg-gray-50 p-3 text-xs text-gray-500">
                  TVA d'import déductible
                  {vatApplies ? (
                    <input
                      value={vat}
                      onChange={(e) => { setVat(e.target.value); setPreview(null); }}
                      inputMode="decimal"
                      placeholder="0,00"
                      className="mt-1 h-8 w-full rounded-lg border border-gray-200 bg-white px-2 text-sm text-gray-900 focus:border-gray-400 focus:outline-none"
                    />
                  ) : (
                    <p className="mt-1 text-[11px] leading-snug text-gray-500">Avant la bascule TVA : non déductible, elle reste dans le coût.</p>
                  )}
                </label>
                <div className="rounded-lg bg-gray-50 p-3">
                  <p className="text-xs text-gray-500">Droits, taxes et frais → coût des articles</p>
                  <p className={`text-sm font-semibold ${base < 0 ? 'text-red-600' : 'text-gray-900'}`}>{EUR(base)}</p>
                </div>
              </div>

              <label className="block text-sm font-medium text-gray-700">
                Références des articles de l'envoi
                <textarea
                  value={refs}
                  onChange={(e) => { setRefs(e.target.value); setPreview(null); }}
                  rows={6}
                  placeholder="Colle la liste de l'envoi telle quelle (page OGATE : dates, marques, prix…) — les n° Aucnet (889-42873), EcoRing (269047868, 2260008008820) et codes admin (LB-…, OZ-…) sont détectés automatiquement."
                  className="mt-1 w-full rounded-lg border border-gray-200 px-2.5 py-2 font-mono text-xs text-gray-900 focus:border-gray-400 focus:outline-none"
                />
              </label>
              {refs.trim() && (
                <p className="-mt-2 text-xs text-gray-500">
                  {detected.length} référence(s) détectée(s){detected.length ? ` : ${detected.slice(0, 6).join(', ')}${detected.length > 6 ? '…' : ''}` : ''}
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                <button onClick={previewFromRefs} disabled={busy !== null} className="rounded-lg bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50">
                  {busy === 'preview' ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Aperçu de la répartition'}
                </button>
                <button onClick={previewMonth} disabled={busy !== null} className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50">
                  {busy === 'month' ? <Loader2 className="h-4 w-4 animate-spin" /> : `Articles créés en ${monthLabel}`}
                </button>
              </div>

              {unmatched.length > 0 && (
                <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  Références introuvables ({unmatched.length}) : {unmatched.join(', ')}
                </p>
              )}

              {duplicates.length > 0 && (
                <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  Références présentes sur plusieurs fiches (la plus récente est retenue) : {duplicates.join(' ; ')}
                </p>
              )}

              {preview && (
                <>
                  <p className="text-sm text-gray-700">
                    <strong>{EUR(preview.base)}</strong> répartis sur <strong>{preview.count}</strong> article(s) au prorata du prix d'achat
                    (total {show(EUR(preview.total_cost_before))} → {show(EUR(Number(preview.total_cost_before) + Number(preview.base)))}).
                  </p>
                  <AllocationTable rows={preview.rows} show={show} />
                  <button onClick={apply} disabled={busy !== null} className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50">
                    {busy === 'apply' ? 'Application…' : 'Appliquer la répartition'}
                  </button>
                </>
              )}
            </>
          )}
          {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        </div>
      </div>
    </div>
  );
};

const AllocationTable: React.FC<{ rows: { code: string; name: string; before: number | null; share: number; after: number }[]; show: (v: string) => string }> = ({ rows, show }) => (
  <div className="max-h-72 overflow-y-auto rounded-lg border border-gray-100">
    <table className="w-full text-xs">
      <thead className="sticky top-0 bg-gray-50 text-gray-500">
        <tr>
          <th className="px-3 py-1.5 text-left font-medium">Article</th>
          <th className="px-3 py-1.5 text-right font-medium">Coût avant</th>
          <th className="px-3 py-1.5 text-right font-medium">Frais</th>
          <th className="px-3 py-1.5 text-right font-medium">Coût après</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-gray-50">
        {rows.map((r, i) => (
          <tr key={i}>
            <td className="px-3 py-1.5"><span className="font-mono text-gray-500">{r.code}</span> <span className="text-gray-800">{r.name}</span></td>
            <td className="px-3 py-1.5 text-right tabular-nums">{show(EUR(r.before))}</td>
            <td className="px-3 py-1.5 text-right tabular-nums text-emerald-700">+{EUR(r.share)}</td>
            <td className="px-3 py-1.5 text-right tabular-nums font-medium">{show(EUR(r.after))}</td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);
