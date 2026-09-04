import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';

export interface SourcingMissionRequester {
  first_name: string | null;
  last_name: string | null;
  email: string | null;
}

export interface SourcingMission {
  id: string;
  reseller_id: string;
  user_id: string | null;
  title: string;
  /** Généré automatiquement à la création (trigger, voir 0096) — sert de numéro de facture dans l'export comptable. Jamais saisi manuellement. */
  reference: string;
  /** Avance versée par le client — alimente le CA B2B encaissé (voir useB2BRevenue.ts). */
  advance_amount: number;
  /** Enveloppe allouée aux achats sur le terrain — jamais confondue avec advance_amount. */
  allocated_cost_budget: number;
  status: 'active' | 'completed' | 'cancelled';
  payment_method: string | null;
  paid_at: string | null;
  notes: string | null;
  created_at: string;
  /** Visible dans le portail revendeur (pro.ozeparis.com) dès true — voir 0094. */
  is_published_to_reseller: boolean;
  published_at: string | null;
  /** Somme des cost_price des pièces validées/expédiées — voir b2b_sourcing_mission_totals (0091). */
  consumed_cost_amount: number;
  remaining_cost_budget: number;
  items_count: number;
  /** Marge brute théorique = advance_amount - allocated_cost_budget (calculée côté client, simple soustraction). */
  gross_margin: number;
  /** Nom de l'entreprise — toujours présent (vue globale et onglet fiche revendeur). */
  company_name: string;
  /** Sous-compte précis ayant demandé la mission, si renseigné (voir 0090). */
  requester: SourcingMissionRequester | null;
}

export interface SourcingMissionInput {
  reseller_id: string;
  user_id?: string;
  title: string;
  advance_amount: number;
  allocated_cost_budget: number;
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
  updateMission: (id: string, input: SourcingMissionInput) => Promise<{ success: boolean; error?: string }>;
  setMissionStatus: (id: string, status: 'active' | 'completed' | 'cancelled') => Promise<{ success: boolean; error?: string }>;
  /** Bascule la visibilité côté portail revendeur (reseller_sourcing_missions/items, voir 0094). */
  setMissionPublished: (id: string, published: boolean) => Promise<{ success: boolean; error?: string }>;
}

/** Missions de sourcing sur mesure (voir 0089/0090/0091_b2b_sourcing_missions*.sql) —
 * scope sur UN revendeur (fiche revendeur, `resellerId` renseigné) ou
 * globales toutes entreprises confondues (`resellerId` omis, vue B2BSourcing.tsx). */
export const useSourcingMissions = (resellerId?: string | null, isAdmin: boolean = false): UseSourcingMissionsResult => {
  const [missions, setMissions] = useState<SourcingMission[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchMissions = useCallback(async () => {
    if (resellerId === null) {
      setMissions([]);
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      setError(null);
      let query = supabase
        .from('b2b_sourcing_missions')
        .select('*, resellers(company_name), requester:profiles!user_id(first_name, last_name, email)')
        .order('created_at', { ascending: false });
      if (resellerId) query = query.eq('reseller_id', resellerId);
      const { data, error: fetchError } = await query;

      if (fetchError) throw new Error(fetchError.message);

      type Row = Omit<SourcingMission, 'consumed_cost_amount' | 'remaining_cost_budget' | 'items_count' | 'company_name' | 'requester' | 'gross_margin'> & {
        resellers: { company_name: string } | null;
        requester: SourcingMissionRequester | null;
      };
      const rows = (data || []) as unknown as Row[];

      // Requête séparée (pas d'embed imbriqué) : b2b_sourcing_mission_totals
      // est une vue, sans contrainte de clé étrangère détectable par
      // PostgREST pour un embed automatique — on fusionne par mission_id
      // côté client, même approche que useB2BRevenue.ts pour le CA.
      const missionIds = rows.map((r) => r.id);
      type Totals = { mission_id: string; consumed_cost_amount: number; remaining_cost_budget: number; items_count: number };
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
            company_name: row.resellers?.company_name || '—',
            requester: row.requester,
            consumed_cost_amount: Number(totals?.consumed_cost_amount) || 0,
            remaining_cost_budget: totals ? Number(totals.remaining_cost_budget) : Number(row.allocated_cost_budget),
            items_count: totals?.items_count || 0,
            gross_margin: Number(row.advance_amount) - Number(row.allocated_cost_budget),
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
    const { error: insertError } = await supabase.from('b2b_sourcing_missions').insert({
      reseller_id: input.reseller_id,
      user_id: input.user_id || null,
      title: input.title.trim(),
      advance_amount: input.advance_amount,
      allocated_cost_budget: input.allocated_cost_budget,
      payment_method: input.payment_method?.trim() || null,
      paid_at: input.paid_at || null,
      notes: input.notes?.trim() || null,
    });

    if (insertError) return { success: false, error: insertError.message };
    await fetchMissions();
    return { success: true };
  };

  const updateMission = async (id: string, input: SourcingMissionInput): Promise<{ success: boolean; error?: string }> => {
    const { error: updateError } = await supabase.from('b2b_sourcing_missions').update({
      user_id: input.user_id || null,
      title: input.title.trim(),
      advance_amount: input.advance_amount,
      allocated_cost_budget: input.allocated_cost_budget,
      payment_method: input.payment_method?.trim() || null,
      paid_at: input.paid_at || null,
      notes: input.notes?.trim() || null,
    }).eq('id', id);

    if (updateError) return { success: false, error: updateError.message };
    await fetchMissions();
    return { success: true };
  };

  const setMissionStatus = async (id: string, status: 'active' | 'completed' | 'cancelled'): Promise<{ success: boolean; error?: string }> => {
    const { error: updateError } = await supabase.from('b2b_sourcing_missions').update({ status }).eq('id', id);
    if (updateError) return { success: false, error: updateError.message };
    await fetchMissions();
    return { success: true };
  };

  const setMissionPublished = async (id: string, published: boolean): Promise<{ success: boolean; error?: string }> => {
    const { error: updateError } = await supabase
      .from('b2b_sourcing_missions')
      .update({ is_published_to_reseller: published, ...(published ? { published_at: new Date().toISOString() } : {}) })
      .eq('id', id);
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

  return { missions, loading, error, refresh: fetchMissions, createMission, updateMission, setMissionStatus, setMissionPublished };
};
