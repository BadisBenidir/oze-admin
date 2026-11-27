import { useCallback, useEffect, useState } from 'react';
import { VatSettings, vatAccountingRateAt } from './vat';
import { supabase } from '../lib/supabase';

/** Réglage TVA d'une catégorie de charges (0313). */
export interface CategoryVat {
  vat_recovery_rate: number;
  foreign_supplier: boolean;
}
export type CategoryVatMap = Record<string, CategoryVat>;

/** Cas reconnus au libellé de la charge (marchand Qonto), appliqués tant que
 * la charge n'a pas son propre réglage. Ordre : la première règle gagne. */
const LABEL_RULES: { re: RegExp; rate: number; foreign?: boolean; why: string }[] = [
  { re: /ANTHROPIC|SUPABASE|GOOGLE|FACEBK|\bMETA\b|ENTRUPY/i, rate: 0, foreign: true, why: 'Fournisseur étranger' },
  { re: /UBER\s*\*?\s*EATS|DELIVEROO|RESTAURANT|BRASSERIE|BISTR|PIZZ|SUSHI|BURGER|MC ?DONALD|MCDO|KFC|TRAITEUR/i, rate: 0, why: 'Restaurant' },
  { re: /\bUBER\b|\bSNCF\b|OUIGO|TRAINLINE|\bBOLT\b|\bG7\b|\bRATP\b|\bTAXI\b|HEETCH|BLABLACAR/i, rate: 0, why: 'Transport de personnes' },
  { re: /^TOTAL\b|TOTALENERGIES|\bESSO\b|\bSHELL\b|\bAVIA\b|CARBURANT|STATION[- ]SERVICE/, rate: 80, why: 'Carburant' },
  { re: /FRAIS DE CHANGE|\bCHANGE\b|CONVERSION|\bFX\b/i, rate: 0, why: 'Frais de change' },
];

export type RecoverySource = 'charge' | 'libellé' | 'catégorie' | 'défaut';

export interface ExpenseVatProfile {
  /** Taux de récupération de la TVA (en %). */
  rate: number;
  rateSource: RecoverySource;
  /** Fournisseur étranger : TVA autoliquidée (due = déductible). */
  foreign: boolean;
  /** Raison de la règle de libellé appliquée, s'il y en a une. */
  why: string | null;
}

export const expenseVatProfile = (
  e: { label?: string | null; category: string | null; vat_recovery_rate?: number | null; foreign_supplier?: boolean | null },
  categories: CategoryVatMap | null | undefined
): ExpenseVatProfile => {
  const rule = LABEL_RULES.find((r) => r.re.test(e.label || ''));
  const cat = e.category ? categories?.[e.category] : undefined;
  let rate: number;
  let rateSource: RecoverySource;
  if (e.vat_recovery_rate != null) {
    rate = Number(e.vat_recovery_rate);
    rateSource = 'charge';
  } else if (rule) {
    rate = rule.rate;
    rateSource = 'libellé';
  } else if (cat) {
    rate = Number(cat.vat_recovery_rate);
    rateSource = 'catégorie';
  } else {
    rate = 100;
    rateSource = 'défaut';
  }
  const foreign = e.foreign_supplier ?? rule?.foreign ?? cat?.foreign_supplier ?? false;
  return { rate, rateSource, foreign, why: e.vat_recovery_rate == null && rule ? rule.why : null };
};

export const fetchCategoryVat = async (): Promise<CategoryVatMap> => {
  const { data, error } = await supabase.from('expense_categories').select('name, vat_recovery_rate, foreign_supplier');
  if (error || !data) return {};
  const out: CategoryVatMap = {};
  for (const c of data as { name: string; vat_recovery_rate: number | null; foreign_supplier: boolean | null }[]) {
    out[c.name] = { vat_recovery_rate: c.vat_recovery_rate == null ? 100 : Number(c.vat_recovery_rate), foreign_supplier: Boolean(c.foreign_supplier) };
  }
  return out;
};

export const useCategoryVat = () => {
  const [categories, setCategories] = useState<CategoryVatMap>({});
  const refresh = useCallback(async () => setCategories(await fetchCategoryVat()), []);
  useEffect(() => {
    refresh();
  }, [refresh]);
  return { categories, refresh };
};

// ---------------------------------------------------------------------------
// TVA d'une charge
// ---------------------------------------------------------------------------

export interface ExpenseVatInput {
  id?: string;
  label?: string | null;
  category: string | null;
  amount: number;
  spent_at: string;
  review_status?: string;
  vat_amount?: number | null;
  vat_recovery_rate?: number | null;
  foreign_supplier?: boolean | null;
  import_vat_amount?: number | null;
  bank_transaction_id?: string | null;
  bank?: { vat_amount: number | null; attachment_ids?: string[] | null } | null;
}

export interface ExpenseVatDetail extends ExpenseVatProfile {
  /** TVA de la facture : saisie sur la charge, sinon lue par Qonto. */
  invoiceVat: number;
  /** TVA de la facture réellement déduite (× taux de récupération). */
  recovered: number;
  /** TVA import payée (ligne B00 du DAU). */
  importVat: number;
  /** Services étrangers : TVA autoliquidée (due = déductible), 20 % du HT. */
  autoliquidated: number;
  /** Total déductible hors autoliquidation (recovered + importVat). */
  deductible: number;
  /** Justificatif déposé sur la transaction Qonto. */
  hasReceipt: boolean;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/** TVA d'une charge datée : rien hors période assujettie. Montants arrondis
 * au centime, ligne par ligne (comme sur la CA3). */
export const expenseVatDetail = (
  e: ExpenseVatInput,
  settings: VatSettings | null | undefined,
  categories: CategoryVatMap | null | undefined
): ExpenseVatDetail => {
  const profile = expenseVatProfile(e, categories);
  const ratePct = vatAccountingRateAt(settings, new Date(`${e.spent_at}T12:00:00`));
  const hasReceipt = Boolean(e.bank?.attachment_ids?.length);
  if (!ratePct) return { ...profile, invoiceVat: 0, recovered: 0, importVat: 0, autoliquidated: 0, deductible: 0, hasReceipt };
  const invoiceVat = Number(e.vat_amount ?? e.bank?.vat_amount ?? 0) || 0;
  const recovered = profile.foreign ? 0 : r2((invoiceVat * profile.rate) / 100);
  const importVat = Number(e.import_vat_amount ?? 0) || 0;
  // Fournisseur étranger : facture sans TVA française, montant payé = HT.
  const autoliquidated = profile.foreign ? r2(((Number(e.amount) || 0) * ratePct) / 100) : 0;
  return { ...profile, invoiceVat, recovered, importVat, autoliquidated, deductible: r2(recovered + importVat), hasReceipt };
};
