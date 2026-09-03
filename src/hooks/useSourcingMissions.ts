import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';

export interface SourcingMission {
  id: string;
  reseller_id: string;
  title: string;
  budget_amount: number;
  status: 'active' | 'completed' | 'cancelled';
  payment_method: string | null;
  paid_at: string | null;
  notes: string | null;
  created_at: string;
  consumed_amount: number;
  remaining_amount: number;
  items_count: number;
}

export interface SourcingMissionInput {
  title: string;
  budget_amount: number;
  payment_method?: string;
  paid_at?: string;
  notes?: string;
}

interface UseSourcingMissionsResult {
  missions: SourcingMission[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  createMission: (input: SourcingMissionInput) => Promise<{ success: boolean; error?: string }>;
  setMissionStatus: (id: string, status: 'active' | 'completed' | 'cancelled') => Promise<{ success: boolean; error?: string }>;
}

/** Missions de sourcing sur mesure d'UN revendeur (voir 0089_b2b_sourcing_missions.sql). */
export const useSourcingMissions = (resellerId: string | null, isAdmin: boolean = false): UseSourcingMissionsResult => {
  const [missions, setMissions] = useState<SourcingMission[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchMissions = useCallback(async () => {
    if (!resellerId) {
      setMissions([]);
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      setError(null);
      const { data, error: fetchError } = await supabase
        .from('b2b_sourcing_missions')
        .select('*')
        .eq('reseller_id', resellerId)
        .order('created_at', { ascending: false });

      if (fetchError) throw new Error(fetchError.message);

      const rows = (data || []) as Array<Omit<SourcingMission, 'consumed_amount' | 'remaining_amount' | 'items_count'>>;

      // Requête séparée (pas d'embed imbriqué) : b2b_sourcing_mission_totals
      // est une vue, sans contrainte de clé étrangère détectable par
      // PostgREST pour un embed automatique — on fusionne par mission_id
      // côté client, même approche que useB2BRevenue.ts pour le CA.
      const missionIds = rows.map((r) => r.id);
      type Totals = { mission_id: string; consumed_amount: number; remaining_amount: number; items_count: number };
      let totalsByMission = new Map<string, Totals>();
      if (missionIds.length > 0) {
        const { data: totalsData, error: totalsError } = await supabase
          .from('b2b_sourcing_mission_totals')
          .select('*')
          .in('mission_id', missionIds);
        if (totalsError) throw new Error(totalsError.message);
        totalsByMission = new Map((totalsData || []).map((t: Totals) => [t.mission_id, t]));
      }

      setMissions(
        rows.map((row) => {
          const totals = totalsByMission.get(row.id);
          return {
            ...row,
            consumed_amount: Number(totals?.consumed_amount) || 0,
            remaining_amount: totals ? Number(totals.remaining_amount) : Number(row.budget_amount),
            items_count: totals?.items_count || 0,
          };
        })
      );
    } catch (err) {
      console.error('Erreur lors du chargement des missions de sourcing:', err);
      setError(err instanceof Error ? err.message : 'Erreur inconnue');
    } finally {
      setLoading(false);
    }
  }, [resellerId]);

  const createMission = async (input: SourcingMissionInput): Promise<{ success: boolean; error?: string }> => {
    if (!resellerId) return { success: false, error: 'Revendeur inconnu' };
    const { error: insertError } = await supabase.from('b2b_sourcing_missions').insert({
      reseller_id: resellerId,
      title: input.title.trim(),
      budget_amount: input.budget_amount,
      payment_method: input.payment_method?.trim() || null,
      paid_at: input.paid_at || null,
      notes: input.notes?.trim() || null,
    });

    if (insertError) return { success: false, error: insertError.message };
    await fetchMissions();
    return { success: true };
  };

  const setMissionStatus = async (id: string, status: 'active' | 'completed' | 'cancelled'): Promise<{ success: boolean; error?: string }> => {
    const { error: updateError } = await supabase.from('b2b_sourcing_missions').update({ status }).eq('id', id);
    if (updateError) return { success: false, error: updateError.message };
    await fetchMissions();
    return { success: true };
  };

  useEffect(() => {
    if (!isAdmin) {
      setLoading(false);
      return;
    }
    fetchMissions();
  }, [isAdmin, fetchMissions]);

  return { missions, loading, error, refresh: fetchMissions, createMission, setMissionStatus };
};
