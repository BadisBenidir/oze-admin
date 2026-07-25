import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';

export interface PromoCode {
  id: string;
  code: string;
  discount_type: 'percentage' | 'fixed_amount';
  discount_value: number;
  min_order_amount: number | null;
  max_uses: number | null;
  uses_count: number;
  valid_until: string | null;
  status: 'active' | 'inactive';
  /** Usage unique global (premier arrivé, premier servi) : le code s'invalide
   * définitivement dès qu'un revendeur l'utilise, indépendamment de max_uses. */
  is_single_use: boolean;
  created_at: string;
}

export interface PromoCodeFormData {
  code: string;
  discount_type: 'percentage' | 'fixed_amount';
  discount_value: number;
  min_order_amount: number | null;
  max_uses: number | null;
  valid_until: string | null;
  status: 'active' | 'inactive';
  is_single_use: boolean;
}

interface UseB2BPromoCodesResult {
  promoCodes: PromoCode[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  createPromoCode: (data: PromoCodeFormData) => Promise<{ success: boolean; error?: string }>;
  togglePromoCodeStatus: (id: string, status: 'active' | 'inactive') => Promise<{ success: boolean; error?: string }>;
  deletePromoCode: (id: string) => Promise<{ success: boolean; error?: string }>;
}

export const useB2BPromoCodes = (isAdmin: boolean = false): UseB2BPromoCodesResult => {
  const [promoCodes, setPromoCodes] = useState<PromoCode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchPromoCodes = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const { data, error: fetchError } = await supabase
        .from('promo_codes')
        .select('*')
        .is('deleted_at', null)
        .order('created_at', { ascending: false });

      if (fetchError) throw new Error(fetchError.message);
      setPromoCodes(data || []);
    } catch (err) {
      console.error('Erreur lors du chargement des codes promo:', err);
      setError(err instanceof Error ? err.message : 'Erreur inconnue');
    } finally {
      setLoading(false);
    }
  }, []);

  const createPromoCode = async (data: PromoCodeFormData): Promise<{ success: boolean; error?: string }> => {
    const { data: userData } = await supabase.auth.getUser();
    const { error: insertError } = await supabase.from('promo_codes').insert({
      code: data.code.toUpperCase().trim(),
      discount_type: data.discount_type,
      discount_value: data.discount_value,
      min_order_amount: data.min_order_amount,
      max_uses: data.is_single_use ? 1 : data.max_uses,
      valid_until: data.valid_until,
      status: data.status,
      is_single_use: data.is_single_use,
      created_by: userData?.user?.id ?? null,
    });

    if (insertError) {
      if (insertError.code === '23505') {
        return { success: false, error: 'Ce code promo existe déjà' };
      }
      return { success: false, error: insertError.message };
    }
    await fetchPromoCodes();
    return { success: true };
  };

  const togglePromoCodeStatus = async (id: string, status: 'active' | 'inactive'): Promise<{ success: boolean; error?: string }> => {
    const { error: updateError } = await supabase.from('promo_codes').update({ status }).eq('id', id);
    if (updateError) return { success: false, error: updateError.message };
    await fetchPromoCodes();
    return { success: true };
  };

  const deletePromoCode = async (id: string): Promise<{ success: boolean; error?: string }> => {
    const { error: deleteError } = await supabase.from('promo_codes').delete().eq('id', id);

    if (deleteError) {
      // 23503 = violation de clé étrangère : ce code a déjà été utilisé dans
      // au moins une commande (orders.promo_code_id le référence, sans
      // cascade — voir 0033/0043). Impossible de le supprimer physiquement
      // sans casser l'historique comptable de ces commandes : on le masque
      // à la place (soft delete), il n'apparaîtra plus jamais dans la liste.
      if (deleteError.code === '23503') {
        const { error: softDeleteError } = await supabase
          .from('promo_codes')
          .update({ deleted_at: new Date().toISOString() })
          .eq('id', id);
        if (softDeleteError) return { success: false, error: softDeleteError.message };
        await fetchPromoCodes();
        return { success: true };
      }
      return { success: false, error: deleteError.message };
    }

    await fetchPromoCodes();
    return { success: true };
  };

  useEffect(() => {
    if (!isAdmin) {
      setLoading(false);
      return;
    }
    fetchPromoCodes();
  }, [isAdmin, fetchPromoCodes]);

  return { promoCodes, loading, error, refresh: fetchPromoCodes, createPromoCode, togglePromoCodeStatus, deletePromoCode };
};
