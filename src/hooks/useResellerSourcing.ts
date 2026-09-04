import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { useResellerAuth } from './useResellerAuth';

export interface ResellerSourcingItem {
  id: string;
  mission_id: string;
  title: string;
  brand: string | null;
  photos: string[];
  status: 'sourced' | 'validated' | 'shipped' | 'cancelled';
  created_at: string;
}

export interface ResellerSourcingMission {
  id: string;
  title: string;
  /** Numéro de référence généré automatiquement — voir 0096. */
  reference: string;
  advance_amount: number;
  paid_at: string | null;
  status: 'active' | 'completed' | 'cancelled';
  /** Contrôle uniquement la galerie de pièces (`items`) — la mission elle-même est toujours visible, voir 0095. */
  is_published_to_reseller: boolean;
  published_at: string | null;
  created_at: string;
  items: ResellerSourcingItem[];
}

/**
 * Missions de sourcing sur mesure visibles par le revendeur connecté —
 * lit exclusivement reseller_sourcing_missions / reseller_sourcing_items
 * (0094/0095_b2b_sourcing_reseller_portal*.sql), jamais
 * b2b_sourcing_missions / b2b_sourcing_items directement : ces vues
 * n'exposent QUE les colonnes autorisées (jamais allocated_cost_budget,
 * cost_price, billed_price). La mission est toujours renvoyée dès qu'elle
 * appartient au revendeur (statut != cancelled) ; seule
 * reseller_sourcing_items reste conditionnée à is_published_to_reseller —
 * pas de filtre supplémentaire à reproduire ici.
 */
export const useResellerSourcing = (isAuthenticated: boolean = false) => {
  const { profile } = useResellerAuth();
  const [missions, setMissions] = useState<ResellerSourcingMission[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchMissions = useCallback(async () => {
    if (!profile) {
      setMissions([]);
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      setError(null);

      const { data: missionRows, error: missionsError } = await supabase
        .from('reseller_sourcing_missions')
        .select('id, title, reference, advance_amount, paid_at, status, is_published_to_reseller, published_at, created_at')
        .order('created_at', { ascending: false });
      if (missionsError) throw new Error(missionsError.message);

      const missionIds = (missionRows || []).map((m) => m.id);
      if (missionIds.length === 0) {
        setMissions([]);
        return;
      }

      const { data: itemRows, error: itemsError } = await supabase
        .from('reseller_sourcing_items')
        .select('id, mission_id, title, brand, photos, status, created_at')
        .in('mission_id', missionIds)
        .order('created_at', { ascending: false });
      if (itemsError) throw new Error(itemsError.message);

      const itemsByMission = new Map<string, ResellerSourcingItem[]>();
      for (const item of (itemRows || []) as ResellerSourcingItem[]) {
        const list = itemsByMission.get(item.mission_id) || [];
        list.push(item);
        itemsByMission.set(item.mission_id, list);
      }

      setMissions(
        (missionRows || []).map((m) => ({
          ...m,
          items: itemsByMission.get(m.id) || [],
        }))
      );
    } catch (err) {
      console.error('Erreur lors du chargement du sourcing sur mesure:', err);
      setError(err instanceof Error ? err.message : 'Erreur inconnue');
    } finally {
      setLoading(false);
    }
  }, [profile]);

  useEffect(() => {
    if (!isAuthenticated) {
      setLoading(false);
      return;
    }
    fetchMissions();
  }, [isAuthenticated, fetchMissions]);

  return { missions, loading, error, refresh: fetchMissions };
};
