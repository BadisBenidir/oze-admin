import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

/** Réglage de bascule TVA (0280) : franchise en base (art. 293 B) jusqu'à
 * vat_start_at, assujetti ensuite. Les prix de vente sont inchangés et
 * deviennent TTC à partir de la bascule. */
export interface VatSettings {
  regime: 'franchise' | 'assujetti';
  vat_start_at: string | null;
  vat_rate: number;
  vat_number: string | null;
  note: string | null;
  updated_at?: string;
}

export const FRANCHISE_MENTION = 'TVA non applicable, art. 293 B du CGI';

/** Taux (en %) applicable à une opération datée de `at` : 0 avant la bascule. */
export const vatRateAt = (settings: VatSettings | null | undefined, at: string | Date | null | undefined): number => {
  if (!settings || settings.regime !== 'assujetti' || !settings.vat_start_at || !at) return 0;
  const t = typeof at === 'string' ? new Date(at).getTime() : at.getTime();
  return t >= new Date(settings.vat_start_at).getTime() ? Number(settings.vat_rate) || 0 : 0;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Découpe un montant TTC : HT = TTC / (1 + taux), TVA = TTC − HT. */
export const splitTtc = (ttc: number, ratePct: number): { ht: number; vat: number; ttc: number } => {
  const t = Number(ttc) || 0;
  if (!ratePct) return { ht: t, vat: 0, ttc: t };
  const ht = round2(t / (1 + ratePct / 100));
  return { ht, vat: round2(t - ht), ttc: t };
};

/** HT d'un montant TTC daté (inchangé avant la bascule). */
export const htAt = (settings: VatSettings | null | undefined, ttc: number, at: string | Date | null | undefined): number =>
  splitTtc(ttc, vatRateAt(settings, at)).ht;

export const fetchVatSettings = async (): Promise<VatSettings | null> => {
  const { data, error } = await supabase.from('vat_settings').select('regime, vat_start_at, vat_rate, vat_number, note, updated_at').maybeSingle();
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
