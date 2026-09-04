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
  /** Champs descriptifs de la fiche produit liée (voir 0097) — absents
   * (undefined) pour une pièce créée à la volée (pas de product_id), ou
   * tant que la migration 0097 n'est pas encore appliquée sur cet
   * environnement (repli, voir fetchMissions). Jamais de prix ici. */
  description?: string | null;
  condition?: string | null;
  material?: string | null;
  colors?: string[] | null;
  serial_number?: string | null;
  defects?: string | null;
  defect_images?: string[] | null;
  category_name?: string | null;
}

export interface ResellerSourcingMission {
  id: string;
  title: string;
  /** Numéro de référence généré automatiquement — voir 0096. Nullable ici
   * uniquement en repli tant que cette migration n'est pas encore
   * appliquée sur l'environnement courant (voir fetchMissions) — toujours
   * renseigné une fois la migration passée. */
  reference: string | null;
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

      let { data: missionRows, error: missionsError } = await supabase
        .from('reseller_sourcing_missions')
        .select('id, title, reference, advance_amount, paid_at, status, is_published_to_reseller, published_at, created_at')
        .order('created_at', { ascending: false });

      // Repli : la migration 0096 (colonne reference + vue mise à jour)
      // n'a pas encore été appliquée sur cet environnement — Postgres
      // rejette alors la colonne inconnue avec une erreur 400 explicite
      // ("column ... reference does not exist"), qui ferait planter toute
      // la page pour un simple numéro d'affichage, pas une donnée
      // essentielle. On retente sans la colonne plutôt que de casser tout
      // l'écran ; le titre sert d'identifiant tant que la migration n'est
      // pas passée (voir missionStatusBadge/rendu : mission.reference ||
      // mission.title).
      if (missionsError?.message?.includes('reference')) {
        const fallback = await supabase
          .from('reseller_sourcing_missions')
          .select('id, title, advance_amount, paid_at, status, is_published_to_reseller, published_at, created_at')
          .order('created_at', { ascending: false });
        missionRows = (fallback.data || []).map((m) => ({ ...m, reference: null })) as typeof missionRows;
        missionsError = fallback.error;
      }

      if (missionsError) throw new Error(missionsError.message);

      const missionIds = (missionRows || []).map((m) => m.id);
      if (missionIds.length === 0) {
        setMissions([]);
        return;
      }

      const itemColumns = 'id, mission_id, title, brand, photos, status, created_at, description, condition, material, colors, serial_number, defects, defect_images, category_name';
      let { data: itemRows, error: itemsError } = await supabase
        .from('reseller_sourcing_items')
        .select(itemColumns)
        .in('mission_id', missionIds)
        .order('created_at', { ascending: false });

      // Même repli que pour les missions : la migration 0097 (colonnes
      // descriptives) n'est peut-être pas encore appliquée — on retombe sur
      // les colonnes de base plutôt que de casser toute la page pour des
      // champs de confort (description, état...).
      if (itemsError) {
        const fallback = await supabase
          .from('reseller_sourcing_items')
          .select('id, mission_id, title, brand, photos, status, created_at')
          .in('mission_id', missionIds)
          .order('created_at', { ascending: false });
        itemRows = fallback.data as typeof itemRows;
        itemsError = fallback.error;
      }
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
