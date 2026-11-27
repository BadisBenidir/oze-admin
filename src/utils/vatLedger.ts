import { VatSale } from './accountingCalc';
import { monthKey, DateRange, isWithinRange } from './accountingPeriods';
import { VatSettings, vatAccountingRateAt, vatAccountingStart } from './vat';
import { CategoryVatMap, ExpenseVatDetail, ExpenseVatInput, expenseVatDetail } from './vatRecovery';

/**
 * TVA comme sur la CA3 (0313) : une seule source pour l'onglet TVA, le bloc
 * « TVA à payer » du Dashboard global et l'export pour l'expert-comptable.
 *
 *   TVA collectée  : ventes encaissées de la période assujettie (toHtData).
 *   TVA déductible : charges (TVA × taux de récupération), Sendcloud,
 *                    TVA import payée (B00).
 *   Autoliquidée   : import (saisie par mois) + services étrangers (charges
 *                    marquées + saisie par mois) — due ET déductible, net 0.
 *   TVA nette      : collectée − déductible ; un crédit (négatif) est
 *                    reporté sur le mois suivant.
 */

export type VatDeclStatus = 'a_declarer' | 'declaree' | 'payee';

export interface VatDeclaration {
  period: string;
  status: VatDeclStatus;
  import_autoliquidation: number;
  foreign_services_autoliquidation?: number;
  declared_at: string | null;
  paid_at: string | null;
  paid_amount: number | null;
  notes: string | null;
}

export interface SendcloudInvoiceRow {
  invoice_date: string;
  price_excl: number;
  price_incl: number;
}

/** Une charge de la période assujettie avec sa TVA (export, contrôle des justificatifs). */
export interface VatExpenseLine extends ExpenseVatDetail {
  id: string;
  date: string;
  label: string;
  category: string | null;
  ttc: number;
}

export interface VatMonthRow {
  ym: string;
  ttc: number;
  ht: number;
  collected: number;
  dedCharges: number;
  dedSendcloud: number;
  dedImport: number;
  /** Total déductible (charges + Sendcloud + import B00), hors autoliquidation. */
  deductible: number;
  /** TVA import autoliquidée saisie pour le mois. */
  autoliqImport: number;
  /** Services étrangers : charges marquées + saisie du mois. */
  autoliqForeign: number;
  /** Saisie manuelle « services étrangers » du mois (en plus des charges). */
  autoliqForeignManual: number;
  autoliq: number;
  /** Collectée − déductible (l'autoliquidation s'annule). */
  net: number;
  /** Crédit reporté du mois précédent. */
  creditIn: number;
  /** TVA à payer pour le mois (après imputation du crédit). */
  toPay: number;
  /** Crédit à reporter sur le mois suivant. */
  creditOut: number;
  status: VatDeclStatus;
  decl?: VatDeclaration;
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const sendcloudVat = (f: SendcloudInvoiceRow) => r2((Number(f.price_incl) || 0) - (Number(f.price_excl) || 0));
const sendcloudDate = (f: SendcloudInvoiceRow) => `${f.invoice_date}T12:00:00`;

/** Charges validées de la période assujettie ayant de la TVA (déduite, import ou autoliquidée). */
export const vatExpenseLines = (
  expenses: (ExpenseVatInput & { id: string; label: string })[],
  settings: VatSettings | null,
  categories: CategoryVatMap | null | undefined
): VatExpenseLine[] =>
  (expenses || [])
    .filter((e) => (e.review_status ?? 'validated') === 'validated')
    .map((e) => ({ id: e.id, date: e.spent_at, label: e.label, category: e.category, ttc: Number(e.amount) || 0, ...expenseVatDetail(e, settings, categories) }))
    .filter((l) => vatAccountingRateAt(settings, new Date(`${l.date}T12:00:00`)) > 0 && (l.invoiceVat || l.importVat || l.autoliquidated))
    .sort((a, b) => a.date.localeCompare(b.date));

/** Mois (YYYY-MM) du début d'assujettissement au mois courant. */
export const vatMonthKeys = (settings: VatSettings | null, now: Date = new Date()): string[] => {
  const start = vatAccountingStart(settings);
  if (!start) return [];
  const keys: string[] = [];
  const startKey = monthKey(start);
  let cur = new Date(Number(startKey.slice(0, 4)), Number(startKey.slice(5, 7)) - 1, 1);
  while (cur <= now) {
    keys.push(`${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, '0')}`);
    cur = new Date(cur.getFullYear(), cur.getMonth() + 1, 1);
  }
  return keys;
};

export const buildVatMonths = (input: {
  settings: VatSettings | null;
  vatSales: VatSale[];
  lines: VatExpenseLine[];
  sendcloud: SendcloudInvoiceRow[];
  declarations: Record<string, VatDeclaration>;
  now?: Date;
}): VatMonthRow[] => {
  const { settings, vatSales, lines, sendcloud, declarations } = input;
  const keys = vatMonthKeys(settings, input.now);
  const acc: Record<string, { ht: number; collected: number; dedCharges: number; dedSendcloud: number; dedImport: number; foreign: number }> = {};
  const get = (k: string) => (acc[k] = acc[k] || { ht: 0, collected: 0, dedCharges: 0, dedSendcloud: 0, dedImport: 0, foreign: 0 });
  for (const s of vatSales) {
    const a = get(monthKey(s.date));
    a.ht += s.ht;
    a.collected += s.vat;
  }
  for (const l of lines) {
    const a = get(l.date.slice(0, 7));
    a.dedCharges += l.recovered;
    a.dedImport += l.importVat;
    a.foreign += l.autoliquidated;
  }
  for (const f of sendcloud) {
    if (!vatAccountingRateAt(settings, new Date(sendcloudDate(f)))) continue;
    const v = sendcloudVat(f);
    if (v > 0) get(f.invoice_date.slice(0, 7)).dedSendcloud += v;
  }
  let credit = 0;
  return keys.map((ym) => {
    const a = acc[ym] || { ht: 0, collected: 0, dedCharges: 0, dedSendcloud: 0, dedImport: 0, foreign: 0 };
    const decl = declarations[ym];
    const autoliqImport = Number(decl?.import_autoliquidation) || 0;
    const autoliqForeignManual = Number(decl?.foreign_services_autoliquidation) || 0;
    const autoliqForeign = r2(a.foreign + autoliqForeignManual);
    const collected = r2(a.collected);
    const deductible = r2(a.dedCharges + a.dedSendcloud + a.dedImport);
    const net = r2(collected - deductible);
    const creditIn = credit;
    const balance = r2(net - creditIn);
    const toPay = balance > 0 ? balance : 0;
    credit = balance < 0 ? -balance : 0;
    return {
      ym,
      ttc: r2(a.ht + a.collected),
      ht: r2(a.ht),
      collected,
      dedCharges: r2(a.dedCharges),
      dedSendcloud: r2(a.dedSendcloud),
      dedImport: r2(a.dedImport),
      deductible,
      autoliqImport,
      autoliqForeign,
      autoliqForeignManual,
      autoliq: r2(autoliqImport + autoliqForeign),
      net,
      creditIn,
      toPay,
      creditOut: credit,
      status: decl?.status ?? 'a_declarer',
      decl,
    };
  });
};

/** Reste à payer : TVA à payer des mois pas encore payés. */
export const vatRemainingToPay = (rows: VatMonthRow[]): number => r2(rows.filter((r) => r.status !== 'payee').reduce((s, r) => s + r.toPay, 0));

/** TVA d'une période quelconque (Dashboard global) : même calcul, sans report de crédit. */
export const vatTotalsInRange = (input: {
  settings: VatSettings | null;
  vatSales: VatSale[];
  lines: VatExpenseLine[];
  sendcloud: SendcloudInvoiceRow[];
  range: DateRange;
}) => {
  const { settings, vatSales, lines, sendcloud, range } = input;
  const collected = r2(vatSales.filter((s) => isWithinRange(s.date, range)).reduce((t, s) => t + s.vat, 0));
  const inRange = lines.filter((l) => isWithinRange(`${l.date}T12:00:00`, range));
  const charges = inRange.reduce((t, l) => t + l.deductible, 0);
  const sc = sendcloud
    .filter((f) => isWithinRange(sendcloudDate(f), range) && vatAccountingRateAt(settings, new Date(sendcloudDate(f))) > 0)
    .reduce((t, f) => t + Math.max(0, sendcloudVat(f)), 0);
  const deductible = r2(charges + sc);
  return { collected, deductible, net: r2(collected - deductible) };
};
