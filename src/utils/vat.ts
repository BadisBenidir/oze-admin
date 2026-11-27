import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

/** Réglage TVA (0280, 0313).
 *  - 'franchise' : franchise en base (art. 293 B), aucune TVA ;
 *  - 'assujetti' : franchise puis bascule à vat_start_at (ancien mode) ;
 *  - 'reel'      : miniréel (réel normal, CA3 mensuelle), assujetti depuis
 *                  liability_start_at (début d'activité).
 * Deux dates : liability_start_at sert aux CALCULS (CA HT, TVA due /
 * déductible), vat_start_at à la TVA FACTURÉE (factures, rectificatives). */
export interface VatSettings {
  regime: 'franchise' | 'assujetti' | 'reel';
  /** TVA facturée à partir de cette date. */
  vat_start_at: string | null;
  /** Début d'assujettissement (régime 'reel'). */
  liability_start_at?: string | null;
  /** TVA des avances de sourcing au mois d'encaissement (retirée à la clôture). */
  advances_vat_on_receipt?: boolean;
  vat_rate: number;
  vat_number: string | null;
  note: string | null;
  updated_at?: string;
}

export const FRANCHISE_MENTION = 'TVA non applicable, art. 293 B du CGI';

const time = (at: string | Date) => (typeof at === 'string' ? new Date(at).getTime() : at.getTime());

/** Taux FACTURÉ (en %) d'une opération datée de `at` : factures et
 * rectificatives, 0 avant vat_start_at (miniréel comme ancien mode). */
export const vatRateAt = (settings: VatSettings | null | undefined, at: string | Date | null | undefined): number => {
  if (!settings || (settings.regime !== 'assujetti' && settings.regime !== 'reel') || !settings.vat_start_at || !at) return 0;
  return time(at) >= new Date(settings.vat_start_at).getTime() ? Number(settings.vat_rate) || 0 : 0;
};

/** Début de la période assujettie pour les CALCULS (null : franchise). */
export const vatAccountingStart = (settings: VatSettings | null | undefined): string | null => {
  if (!settings) return null;
  if (settings.regime === 'reel') return settings.liability_start_at || settings.vat_start_at || null;
  if (settings.regime === 'assujetti') return settings.vat_start_at;
  return null;
};

/** Taux COMPTABLE (en %) d'une opération : TVA due sur les ventes et
 * déductible sur les achats, comme le fisc (miniréel : depuis le début
 * d'assujettissement, même si la facture a été émise sans TVA). */
export const vatAccountingRateAt = (settings: VatSettings | null | undefined, at: string | Date | null | undefined): number => {
  const start = vatAccountingStart(settings);
  if (!settings || !start || !at) return 0;
  return time(at) >= new Date(start).getTime() ? Number(settings.vat_rate) || 0 : 0;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Découpe un montant TTC : HT = TTC / (1 + taux), TVA = TTC − HT. */
export const splitTtc = (ttc: number, ratePct: number): { ht: number; vat: number; ttc: number } => {
  const t = Number(ttc) || 0;
  if (!ratePct) return { ht: t, vat: 0, ttc: t };
  const ht = round2(t / (1 + ratePct / 100));
  return { ht, vat: round2(t - ht), ttc: t };
};

/** HT comptable d'un montant TTC daté (inchangé hors période assujettie). */
export const htAt = (settings: VatSettings | null | undefined, ttc: number, at: string | Date | null | undefined): number =>
  splitTtc(ttc, vatAccountingRateAt(settings, at)).ht;

export const fetchVatSettings = async (): Promise<VatSettings | null> => {
  let { data, error } = await supabase.from('vat_settings').select('regime, vat_start_at, liability_start_at, advances_vat_on_receipt, vat_rate, vat_number, note, updated_at').maybeSingle();
  // Avant 0313 : colonnes absentes.
  if (error) ({ data, error } = await supabase.from('vat_settings').select('regime, vat_start_at, vat_rate, vat_number, note, updated_at').maybeSingle());
  if (error || !data) return null;
  return { ...(data as VatSettings), vat_rate: Number((data as VatSettings).vat_rate) || 0 };
};

export const useVatSettings = () => {
  const [settings, setSettings] = useState<VatSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const refresh = useCallback(async () => {
    setSettings(await fetchVatSettings());
    setLoading(false);
  }, []);
  useEffect(() => {
    refresh();
  }, [refresh]);
  return { settings, loading, refresh };
};
