/**
 * Vérification de la TVA par mois (0313), avec le code de l'admin.
 * Lecture seule. Lancement (clé de service locale, jamais affichée) :
 *   VITE_SUPABASE_ANON_KEY=<service role> npx vite-node scripts/verify-vat.ts [reel]
 * « reel » : simule le régime miniréel avant son activation (0314).
 */
const mem = new Map<string, string>();
(globalThis as unknown as { window: unknown }).window = {
  localStorage: { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => mem.set(k, v), removeItem: (k: string) => mem.delete(k) },
  location: { href: 'http://localhost/', hash: '', search: '' },
  addEventListener: () => undefined,
  removeEventListener: () => undefined,
};
console.log = ((orig) => (...a: unknown[]) => (String(a[0]).startsWith('Initialisation') ? undefined : orig(...a)))(console.log);

const main = async () => {
  const { supabase } = await import('../src/lib/supabase');
  const { fetchAccountingRawData } = await import('../src/hooks/useAccountingRawData');
  const { toHtData } = await import('../src/utils/accountingCalc');
  const { fetchVatSettings } = await import('../src/utils/vat');
  const { fetchCategoryVat } = await import('../src/utils/vatRecovery');
  const { vatExpenseLines, buildVatMonths, vatRemainingToPay } = await import('../src/utils/vatLedger');

  let settings = await fetchVatSettings();
  if (process.argv.includes('reel') && settings) settings = { ...settings, regime: 'reel' };
  const [raw, categories, exp, sc, decl] = await Promise.all([
    fetchAccountingRawData(),
    fetchCategoryVat(),
    supabase.from('expenses').select('*, bank:bank_transactions!expenses_bank_transaction_id_fkey(vat_amount, attachment_ids)'),
    supabase.from('sendcloud_invoices').select('invoice_date, price_excl, price_incl'),
    supabase.from('vat_declarations').select('*'),
  ]);
  if (exp.error) throw exp.error;
  const ht = toHtData(raw, settings);
  const lines = vatExpenseLines(exp.data || [], settings, categories);
  const declarations = Object.fromEntries(((decl.data || []) as { period: string }[]).map((d) => [d.period.slice(0, 7), d]));
  const rows = buildVatMonths({ settings, vatSales: ht.vatSales, lines, sendcloud: sc.data || [], declarations: declarations as never });

  const f = (n: number) => n.toFixed(2).padStart(10);
  console.info(`Régime ${settings?.regime}, assujetti depuis ${settings?.liability_start_at}`);
  console.info('Mois       CA TTC      CA HT   collectée  déd.charg  déd.SC   déd.B00  autoliqEtr     nette  créditIn     àPayer  créditOut');
  for (const r of rows) console.info(`${r.ym} ${f(r.ttc)} ${f(r.ht)} ${f(r.collected)} ${f(r.dedCharges)} ${f(r.dedSendcloud)} ${f(r.dedImport)} ${f(r.autoliqForeign)} ${f(r.net)} ${f(r.creditIn)} ${f(r.toPay)} ${f(r.creditOut)}`);
  console.info(`Reste à payer : ${vatRemainingToPay(rows).toFixed(2)}`);
  // Collectée par source et par mois (pour expliquer un écart).
  const bySource: Record<string, Record<string, number>> = {};
  for (const s of ht.vatSales) {
    const k = s.date.slice(0, 7);
    bySource[k] = bySource[k] || {};
    bySource[k][s.source] = (bySource[k][s.source] || 0) + s.vat;
  }
  console.info('Collectée par source :');
  for (const k of Object.keys(bySource).sort()) console.info(k, Object.entries(bySource[k]).map(([s, v]) => `${s} ${v.toFixed(2)}`).join(' · '));
  process.exit(0);
};
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
