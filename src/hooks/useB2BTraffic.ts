import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { B2B_PRESENCE_CHANNEL } from './useResellerPresenceTracking';

export interface OnlineReseller {
  user_id: string;
  email: string;
  first_name: string;
  last_name: string;
  company_name: string;
  online_at: string;
}

export interface DailyVisitCount {
  date: string;
  count: number;
  /** true = valeur reconstituée (commandes/recharges/dernière connexion),
   * jamais un vrai comptage de visiteurs uniques — voir
   * backfill_reseller_daily_activity (0126). false = donnée réelle issue du
   * tracking en direct (reseller_daily_sessions). */
  estimated: boolean;
}

const toDateKey = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Trafic du portail B2B pour l'onglet admin "Statistiques B2B" :
 *   - `onlineResellers` : lecture seule du canal Presence 'online-b2b-users'
 *     (voir useResellerPresenceTracking.ts côté portail) — l'admin ne
 *     track() JAMAIS sa propre présence sur ce canal, il ne fait qu'écouter.
 *   - `uniqueToday` / `dailyHistory` : agrégats depuis reseller_daily_sessions
 *     (0125), rechargés une fois au montage (pas de temps réel nécessaire
 *     pour un historique journalier).
 */
export const useB2BTraffic = (isAdmin: boolean, historyDays: 14 | 30 = 30) => {
  const [onlineResellers, setOnlineResellers] = useState<OnlineReseller[]>([]);
  const [uniqueToday, setUniqueToday] = useState(0);
  const [dailyHistory, setDailyHistory] = useState<DailyVisitCount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isAdmin) {
      setOnlineResellers([]);
      return;
    }

    const channel = supabase.channel(B2B_PRESENCE_CHANNEL);

    const syncState = () => {
      const state = channel.presenceState() as Record<string, OnlineReseller[]>;
      const all = Object.values(state).flat();
      // Un même sous-compte peut apparaître plusieurs fois (plusieurs
      // onglets/appareils ouverts) — dédupliqué sur user_id, on garde
      // l'entrée la plus récente (online_at) pour l'affichage "depuis...".
      const byUser = new Map<string, OnlineReseller>();
      all.forEach((p) => {
        const existing = byUser.get(p.user_id);
        if (!existing || p.online_at > existing.online_at) byUser.set(p.user_id, p);
      });
      setOnlineResellers(Array.from(byUser.values()).sort((a, b) => a.online_at.localeCompare(b.online_at)));
    };

    channel
      .on('presence', { event: 'sync' }, syncState)
      .on('presence', { event: 'join' }, syncState)
      .on('presence', { event: 'leave' }, syncState)
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [isAdmin]);

  const fetchHistory = useCallback(async () => {
    if (!isAdmin) {
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      setError(null);

      const today = toDateKey(new Date());
      const windowStart = new Date();
      windowStart.setDate(windowStart.getDate() - (historyDays - 1));

      const [realRes, backfillRes] = await Promise.all([
        supabase
          .from('reseller_daily_sessions')
          .select('date')
          .gte('date', toDateKey(windowStart))
          .order('date', { ascending: true }),
        supabase.rpc('backfill_reseller_daily_activity', { p_days: historyDays }),
      ]);
      if (realRes.error) throw new Error(realRes.error.message);
      // Le rattrapage est un confort d'affichage, pas une donnée critique :
      // une erreur dessus (ex: fonction pas encore déployée) ne doit jamais
      // faire échouer tout le dashboard, juste laisser les jours sans
      // tracking réel à 0.
      if (backfillRes.error) console.error('Erreur lors du rattrapage d\'historique B2B:', backfillRes.error.message);

      const realCounts = new Map<string, number>();
      (realRes.data || []).forEach((row: { date: string }) => {
        realCounts.set(row.date, (realCounts.get(row.date) || 0) + 1);
      });
      const backfillCounts = new Map<string, number>();
      ((backfillRes.data || []) as { activity_date: string; profile_count: number }[]).forEach((row) => {
        backfillCounts.set(row.activity_date, row.profile_count);
      });

      // Un jour avec du vrai suivi (reseller_daily_sessions) fait toujours
      // foi ; sinon on retombe sur l'estimation reconstituée, sinon 0 — un
      // graphique continu plutôt que des trous silencieux.
      const series: DailyVisitCount[] = [];
      for (let i = 0; i < historyDays; i++) {
        const d = new Date(windowStart);
        d.setDate(d.getDate() + i);
        const key = toDateKey(d);
        const real = realCounts.get(key);
        series.push(
          real !== undefined
            ? { date: key, count: real, estimated: false }
            : { date: key, count: backfillCounts.get(key) || 0, estimated: true }
        );
      }
      setDailyHistory(series);
      setUniqueToday(realCounts.get(today) ?? backfillCounts.get(today) ?? 0);
    } catch (err) {
      console.error('Erreur lors du chargement du trafic B2B:', err);
      setError(err instanceof Error ? err.message : 'Erreur inconnue');
    } finally {
      setLoading(false);
    }
  }, [isAdmin, historyDays]);

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  return { onlineResellers, uniqueToday, dailyHistory, loading, error, refresh: fetchHistory };
};
