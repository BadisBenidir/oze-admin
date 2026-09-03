import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';

export interface Drop {
  id: string;
  title: string | null;
  scheduled_at: string;
  product_ids: string[];
  status: 'planifie' | 'publie' | 'annule';
  created_by: string | null;
  created_at: string;
  published_at: string | null;
}

export interface DropInput {
  title?: string;
  scheduled_at: string;
  product_ids: string[];
}

interface UseDropsResult {
  drops: Drop[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  createDrop: (input: DropInput) => Promise<{ success: boolean; error?: string }>;
  updateDrop: (id: string, input: DropInput) => Promise<{ success: boolean; error?: string }>;
  cancelDrop: (id: string) => Promise<{ success: boolean; error?: string }>;
  /** Renomme un drop quel que soit son statut (contrairement à updateDrop, restreint à 'planifie'). */
  renameDrop: (id: string, title: string) => Promise<{ success: boolean; error?: string }>;
  /** Fusionne sourceId dans targetId (union des articles) et annule sourceId — fonctionne pour des drops de tout statut. */
  mergeDrops: (sourceId: string, targetId: string) => Promise<{ success: boolean; error?: string }>;
  /** Déplace un article d'un drop vers un autre — fonctionne pour des drops de tout statut. */
  reassignDropProduct: (productId: string, fromDropId: string, toDropId: string) => Promise<{ success: boolean; error?: string }>;
  /** Supprime définitivement un drop — refusé par admin_delete_drop si l'un
   * de ses articles a déjà été vendu (voir 0088). */
  deleteDrop: (id: string) => Promise<{ success: boolean; error?: string }>;
}

export const useDrops = (isAdmin: boolean = false): UseDropsResult => {
  const [drops, setDrops] = useState<Drop[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchDrops = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const { data, error: fetchError } = await supabase
        .from('drops')
        .select('*')
        .order('scheduled_at', { ascending: true });

      if (fetchError) throw new Error(fetchError.message);
      setDrops(data || []);
    } catch (err) {
      console.error('Erreur lors du chargement des drops:', err);
      setError(err instanceof Error ? err.message : 'Erreur inconnue');
    } finally {
      setLoading(false);
    }
  }, []);

  const createDrop = async (input: DropInput): Promise<{ success: boolean; error?: string }> => {
    const { data: userData } = await supabase.auth.getUser();
    const { error: insertError } = await supabase.from('drops').insert({
      title: input.title || null,
      scheduled_at: input.scheduled_at,
      product_ids: input.product_ids,
      created_by: userData?.user?.id ?? null,
    });

    if (insertError) return { success: false, error: insertError.message };
    await fetchDrops();
    return { success: true };
  };

  const updateDrop = async (id: string, input: DropInput): Promise<{ success: boolean; error?: string }> => {
    const { error: updateError } = await supabase
      .from('drops')
      .update({
        title: input.title || null,
        scheduled_at: input.scheduled_at,
        product_ids: input.product_ids,
      })
      .eq('id', id)
      .eq('status', 'planifie');

    if (updateError) return { success: false, error: updateError.message };
    await fetchDrops();
    return { success: true };
  };

  const cancelDrop = async (id: string): Promise<{ success: boolean; error?: string }> => {
    const { error: updateError } = await supabase
      .from('drops')
      .update({ status: 'annule' })
      .eq('id', id)
      .eq('status', 'planifie');

    if (updateError) return { success: false, error: updateError.message };
    await fetchDrops();
    return { success: true };
  };

  const renameDrop = async (id: string, title: string): Promise<{ success: boolean; error?: string }> => {
    const { error: rpcError } = await supabase.rpc('admin_rename_drop', { p_drop_id: id, p_title: title });
    if (rpcError) return { success: false, error: rpcError.message };
    await fetchDrops();
    return { success: true };
  };

  const mergeDrops = async (sourceId: string, targetId: string): Promise<{ success: boolean; error?: string }> => {
    const { error: rpcError } = await supabase.rpc('admin_merge_drops', { p_source_drop_id: sourceId, p_target_drop_id: targetId });
    if (rpcError) return { success: false, error: rpcError.message };
    await fetchDrops();
    return { success: true };
  };

  const reassignDropProduct = async (productId: string, fromDropId: string, toDropId: string): Promise<{ success: boolean; error?: string }> => {
    const { error: rpcError } = await supabase.rpc('admin_reassign_drop_product', {
      p_product_id: productId,
      p_from_drop_id: fromDropId,
      p_to_drop_id: toDropId,
    });
    if (rpcError) return { success: false, error: rpcError.message };
    await fetchDrops();
    return { success: true };
  };

  const deleteDrop = async (id: string): Promise<{ success: boolean; error?: string }> => {
    const { error: rpcError } = await supabase.rpc('admin_delete_drop', { p_drop_id: id });
    if (rpcError) return { success: false, error: rpcError.message };
    await fetchDrops();
    return { success: true };
  };

  useEffect(() => {
    if (!isAdmin) {
      setLoading(false);
      return;
    }
    fetchDrops();
  }, [isAdmin, fetchDrops]);

  return { drops, loading, error, refresh: fetchDrops, createDrop, updateDrop, cancelDrop, renameDrop, mergeDrops, reassignDropProduct, deleteDrop };
};
