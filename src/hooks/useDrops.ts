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

  useEffect(() => {
    if (!isAdmin) {
      setLoading(false);
      return;
    }
    fetchDrops();
  }, [isAdmin, fetchDrops]);

  return { drops, loading, error, refresh: fetchDrops, createDrop, updateDrop, cancelDrop };
};
