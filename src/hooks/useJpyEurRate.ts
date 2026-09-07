import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { extractFunctionErrorMessage } from '../utils/edgeFunctionError';

export interface JpyEurRatePoint {
  rate_date: string;
  rate: number;
  fetched_at: string;
}

/**
 * Historique du taux JPY -> EUR (jpy_eur_rates, 0113) — alimenté côté
 * serveur par pg_cron une fois par jour (edge function fetch-jpy-eur-rate),
 * jamais appelé en direct depuis le navigateur (l'ancien fetch browser vers
 * api.frankfurter.app depuis CreateProduct.tsx était peu fiable). `latest`
 * est le taux du jour le plus récent connu : tous les articles créés le
 * même jour s'en servent, garantissant un taux stable sur la journée même
 * pour plusieurs créations successives.
 */
export const useJpyEurRate = (enabled: boolean = true) => {
  const [history, setHistory] = useState<JpyEurRatePoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const fetchHistory = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error: fetchError } = await supabase
      .from('jpy_eur_rates')
      .select('rate_date, rate, fetched_at')
      .order('rate_date', { ascending: true })
      .limit(400);
    if (fetchError) {
      setError(fetchError.message);
    } else {
      setHistory((data || []) as JpyEurRatePoint[]);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }
    fetchHistory();
  }, [enabled, fetchHistory]);

  const latest = history.length > 0 ? history[history.length - 1] : null;

  /** Déclenche l'edge function immédiatement (bouton "Rafraîchir") — utile
   * si le job quotidien n'est pas encore passé ou n'est pas configuré. */
  const refreshNow = async (): Promise<{ success: boolean; error?: string }> => {
    setRefreshing(true);
    const { error: invokeError } = await supabase.functions.invoke('fetch-jpy-eur-rate', { body: {} });
    setRefreshing(false);
    if (invokeError) return { success: false, error: await extractFunctionErrorMessage(invokeError) };
    await fetchHistory();
    return { success: true };
  };

  /** Importe rétroactivement les `days` derniers jours en un seul appel
   * (endpoint "time series" de frankfurter.app) — pour peupler le graphique
   * sans attendre que le job quotidien accumule l'historique jour après jour. */
  const backfillHistory = async (days: number): Promise<{ success: boolean; error?: string; imported?: number }> => {
    setRefreshing(true);
    const { data, error: invokeError } = await supabase.functions.invoke('fetch-jpy-eur-rate', {
      body: { backfill_days: days },
    });
    setRefreshing(false);
    if (invokeError) return { success: false, error: await extractFunctionErrorMessage(invokeError) };
    await fetchHistory();
    return { success: true, imported: (data as { imported?: number } | null)?.imported };
  };

  return { history, latest, loading, error, refreshing, refreshNow, backfillHistory, refresh: fetchHistory };
};
