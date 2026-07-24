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
      max_uses: data.max_uses,
      valid_until: data.valid_until,
      status: data.status,
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
    if (deleteError) return { success: false, error: deleteError.message };
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
