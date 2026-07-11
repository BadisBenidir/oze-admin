import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';

export interface Coupon {
  id: string;
  code: string;
  description: string | null;
  discount_type: 'percentage' | 'fixed_amount';
  discount_value: number;
  max_discount_amount: number | null;
  min_order_amount: number | null;
  valid_from: string | null;
  valid_until: string | null;
  max_uses: number | null;
  uses_count: number;
  status: 'active' | 'paused' | 'expired';
  created_at: string;
  updated_at: string;
}

export interface CouponFormData {
  code: string;
  description: string;
  discount_type: 'percentage' | 'fixed_amount';
  discount_value: number;
  max_discount_amount: number | null;
  min_order_amount: number | null;
  valid_from: string | null;
  valid_until: string | null;
  max_uses: number | null;
  status: 'active' | 'paused' | 'expired';
}

interface UseCouponsResult {
  coupons: Coupon[];
  loading: boolean;
  error: string | null;
  refreshCoupons: () => Promise<void>;
  createCoupon: (data: CouponFormData) => Promise<{ success: boolean; error?: string }>;
  updateCoupon: (id: string, data: Partial<CouponFormData>) => Promise<{ success: boolean; error?: string }>;
  deleteCoupon: (id: string) => Promise<{ success: boolean; error?: string }>;
  toggleCouponStatus: (id: string, newStatus: 'active' | 'paused') => Promise<{ success: boolean; error?: string }>;
}

export const useCoupons = (isAuthenticated: boolean = false): UseCouponsResult => {
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchCoupons = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const { data, error: fetchError } = await supabase
        .from('coupons')
        .select('*')
        .order('created_at', { ascending: false });

      if (fetchError) {
        throw new Error(fetchError.message);
      }

      setCoupons(data || []);
    } catch (err) {
      console.error('Erreur lors du chargement des coupons:', err);
      setError(err instanceof Error ? err.message : 'Erreur inconnue');
    } finally {
      setLoading(false);
    }
  }, []);

  const refreshCoupons = async () => {
    await fetchCoupons();
  };

  const createCoupon = async (data: CouponFormData): Promise<{ success: boolean; error?: string }> => {
    try {
      const { error: insertError } = await supabase
        .from('coupons')
        .insert([{
          code: data.code.toUpperCase().trim(),
          description: data.description || null,
          discount_type: data.discount_type,
          discount_value: data.discount_value,
          max_discount_amount: data.max_discount_amount || null,
          min_order_amount: data.min_order_amount || null,
          valid_from: data.valid_from || null,
          valid_until: data.valid_until || null,
          max_uses: data.max_uses || null,
          status: data.status || 'active'
        }]);

      if (insertError) {
        if (insertError.code === '23505') {
          return { success: false, error: 'Ce code promo existe déjà' };
        }
        throw new Error(insertError.message);
      }

      await fetchCoupons();
      return { success: true };
    } catch (err) {
      console.error('Erreur lors de la création du coupon:', err);
      return { success: false, error: err instanceof Error ? err.message : 'Erreur inconnue' };
    }
  };

  const updateCoupon = async (id: string, data: Partial<CouponFormData>): Promise<{ success: boolean; error?: string }> => {
    try {
      const updateData: any = { ...data };
      if (updateData.code) {
        updateData.code = updateData.code.toUpperCase().trim();
      }

      const { error: updateError } = await supabase
        .from('coupons')
        .update(updateData)
        .eq('id', id);

      if (updateError) {
        if (updateError.code === '23505') {
          return { success: false, error: 'Ce code promo existe déjà' };
        }
        throw new Error(updateError.message);
      }

      await fetchCoupons();
      return { success: true };
    } catch (err) {
      console.error('Erreur lors de la mise à jour du coupon:', err);
      return { success: false, error: err instanceof Error ? err.message : 'Erreur inconnue' };
    }
  };

  const deleteCoupon = async (id: string): Promise<{ success: boolean; error?: string }> => {
    try {
      const { error: deleteError } = await supabase
        .from('coupons')
        .delete()
        .eq('id', id);

      if (deleteError) {
        throw new Error(deleteError.message);
      }

      await fetchCoupons();
      return { success: true };
    } catch (err) {
      console.error('Erreur lors de la suppression du coupon:', err);
      return { success: false, error: err instanceof Error ? err.message : 'Erreur inconnue' };
    }
  };

  const toggleCouponStatus = async (id: string, newStatus: 'active' | 'paused'): Promise<{ success: boolean; error?: string }> => {
    return updateCoupon(id, { status: newStatus });
  };

  useEffect(() => {
    if (!isAuthenticated) {
      setLoading(false);
      return;
    }

    fetchCoupons();
  }, [isAuthenticated, fetchCoupons]);

  return {
    coupons,
    loading,
    error,
    refreshCoupons,
    createCoupon,
    updateCoupon,
    deleteCoupon,
    toggleCouponStatus
  };
};