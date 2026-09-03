import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';

export interface SourcingItem {
  id: string;
  mission_id: string;
  product_id: string | null;
  title: string;
  brand: string | null;
  billed_price: number;
  cost_price: number | null;
  status: 'sourced' | 'validated' | 'shipped' | 'cancelled';
  photos: string[];
  created_at: string;
  product: { id: string; name: string; images: string[]; main_image_index: number } | null;
}

export interface SourcingItemInput {
  product_id?: string;
  title: string;
  brand?: string;
  billed_price: number;
  cost_price?: number;
  photos?: string[];
}

interface UseSourcingItemsResult {
  items: SourcingItem[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  addItem: (input: SourcingItemInput) => Promise<{ success: boolean; error?: string }>;
  setItemStatus: (id: string, status: SourcingItem['status']) => Promise<{ success: boolean; error?: string }>;
}

/** Pièces sourcées pour UNE mission (voir 0089_b2b_sourcing_missions.sql). */
export const useSourcingItems = (missionId: string | null): UseSourcingItemsResult => {
  const [items, setItems] = useState<SourcingItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchItems = useCallback(async () => {
    if (!missionId) {
      setItems([]);
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      setError(null);
      const { data, error: fetchError } = await supabase
        .from('b2b_sourcing_items')
        .select('*, product:products(id, name, images, main_image_index)')
        .eq('mission_id', missionId)
        .order('created_at', { ascending: false });

      if (fetchError) throw new Error(fetchError.message);
      setItems((data || []) as unknown as SourcingItem[]);
    } catch (err) {
      console.error('Erreur lors du chargement des pièces sourcées:', err);
      setError(err instanceof Error ? err.message : 'Erreur inconnue');
    } finally {
      setLoading(false);
    }
  }, [missionId]);

  const addItem = async (input: SourcingItemInput): Promise<{ success: boolean; error?: string }> => {
    if (!missionId) return { success: false, error: 'Mission inconnue' };
    const { error: insertError } = await supabase.from('b2b_sourcing_items').insert({
      mission_id: missionId,
      product_id: input.product_id || null,
      title: input.title.trim(),
      brand: input.brand?.trim() || null,
      billed_price: input.billed_price,
      cost_price: input.cost_price ?? null,
      photos: input.photos || [],
    });

    if (insertError) return { success: false, error: insertError.message };
    await fetchItems();
    return { success: true };
  };

  const setItemStatus = async (id: string, status: SourcingItem['status']): Promise<{ success: boolean; error?: string }> => {
    const { error: updateError } = await supabase.from('b2b_sourcing_items').update({ status }).eq('id', id);
    if (updateError) return { success: false, error: updateError.message };
    await fetchItems();
    return { success: true };
  };

  useEffect(() => {
    fetchItems();
  }, [fetchItems]);

  return { items, loading, error, refresh: fetchItems, addItem, setItemStatus };
};
