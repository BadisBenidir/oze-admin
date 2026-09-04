import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { rawDataWindowStart } from '../utils/accountingPeriods';

export interface AccountingOrderItem {
  id: string;
  line_total: number;
  quantity: number;
  status: 'active' | 'cancelled';
  product_snapshot: { name?: string; purchase_price?: number } | null;
  product: { brand: { name: string } | null } | null;
}

export interface AccountingOrder {
  id: string;
  order_number: string;
  order_channel: 'web' | 'b2b';
  status: string;
  payment_status: string;
  total_amount: number;
  shipping_cost: number;
  created_at: string;
  email: string;
  customer_name: string | null;
  reseller_id: string | null;
  company_name: string | null;
  requester_name: string | null;
  order_items: AccountingOrderItem[];
}

export interface AccountingLiveSale {
  id: string;
  name: string;
  sale_price: number;
  purchase_price: number | null;
  brand_name: string | null;
  sold_at: string;
}

export interface AccountingSourcingAdvance {
  id: string;
  reseller_id: string;
  company_name: string;
  advance_amount: number;
  paid_at: string | null;
  status: 'active' | 'completed' | 'cancelled';
  order_id: string | null;
  created_at: string;
}

export interface AccountingGiftReward {
  quantity: number;
  status: 'pending' | 'assigned' | 'shipped';
  created_at: string;
}

export interface AccountingRawData {
  orders: AccountingOrder[];
  liveSales: AccountingLiveSale[];
  sourcingAdvances: AccountingSourcingAdvance[];
  giftRewards: AccountingGiftReward[];
}

/** Prédicat "encaissé" partagé avec useSalesJournalExport.ts / Accounting.tsx
 * — ne jamais diverger de cette définition (paiement carte confirmé OU
 * commande déjà passée par un statut qui implique le paiement). */
export const isOrderPaid = (o: Pick<AccountingOrder, 'payment_status' | 'status'>): boolean =>
  ['paid', 'succeeded'].includes(o.payment_status) || ['confirmed', 'shipped', 'delivered'].includes(o.status);

/** Charge en un seul aller-retour toutes les données brutes nécessaires aux
 * 4 onglets de "Comptabilité & Finances" sur une fenêtre glissante de 25
 * mois (voir RAW_DATA_WINDOW_MONTHS) — chaque onglet/période filtre ensuite
 * en mémoire plutôt que de refaire une requête par sélection de période ou
 * de comparaison, ce qui rend le changement de période instantané. */
export const useAccountingRawData = (isAdmin: boolean = false) => {
  const [data, setData] = useState<AccountingRawData>({ orders: [], liveSales: [], sourcingAdvances: [], giftRewards: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const windowStart = rawDataWindowStart().toISOString();

      const [ordersRes, liveRes, sourcingRes, giftsRes] = await Promise.all([
        supabase
          .from('orders')
          .select(
            'id, order_number, order_channel, status, payment_status, total_amount, shipping_cost, created_at, email, reseller_id, ' +
            'resellers(company_name), placed_by:profiles!placed_by_profile_id(first_name, last_name), ' +
            'order_items(id, line_total, quantity, status, product_snapshot, product:products(brand:brands(name)))'
          )
          .in('order_channel', ['web', 'b2b'])
          .gte('created_at', windowStart)
          .order('created_at', { ascending: false }),
        supabase
          .from('products')
          .select('id, name, sale_price, purchase_price, updated_at, brand:brands(name)')
          .eq('status', 'sold-auction')
          .gte('updated_at', windowStart),
        supabase
          .from('b2b_sourcing_missions')
          .select('id, reseller_id, advance_amount, paid_at, status, order_id, created_at, resellers(company_name)')
          .not('paid_at', 'is', null)
          .neq('status', 'cancelled'),
        supabase.from('b2b_gift_rewards').select('quantity, status, created_at'),
      ]);

      if (ordersRes.error) throw new Error(ordersRes.error.message);
      if (liveRes.error) throw new Error(liveRes.error.message);
      if (sourcingRes.error) throw new Error(sourcingRes.error.message);
      if (giftsRes.error) throw new Error(giftsRes.error.message);

      type OrderRow = Omit<AccountingOrder, 'company_name' | 'requester_name' | 'customer_name'> & {
        resellers: { company_name: string } | null;
        placed_by: { first_name: string | null; last_name: string | null } | null;
      };

      const orders: AccountingOrder[] = ((ordersRes.data || []) as unknown as OrderRow[]).map((o) => ({
        ...o,
        company_name: o.resellers?.company_name || null,
        requester_name: o.placed_by ? `${o.placed_by.first_name || ''} ${o.placed_by.last_name || ''}`.trim() || null : null,
        customer_name: o.email || null,
      }));

      type LiveRow = { id: string; name: string; sale_price: number; purchase_price: number | null; updated_at: string; brand: { name: string } | null };
      const liveSales: AccountingLiveSale[] = ((liveRes.data || []) as unknown as LiveRow[]).map((p) => ({
        id: p.id,
        name: p.name,
        sale_price: Number(p.sale_price) || 0,
        purchase_price: p.purchase_price != null ? Number(p.purchase_price) : null,
        brand_name: p.brand?.name || null,
        sold_at: p.updated_at,
      }));

      type SourcingRow = { id: string; reseller_id: string; advance_amount: number; paid_at: string | null; status: 'active' | 'completed' | 'cancelled'; order_id: string | null; created_at: string; resellers: { company_name: string } | null };
      const sourcingAdvances: AccountingSourcingAdvance[] = ((sourcingRes.data || []) as unknown as SourcingRow[]).map((m) => ({
        id: m.id,
        reseller_id: m.reseller_id,
        company_name: m.resellers?.company_name || '—',
        advance_amount: Number(m.advance_amount) || 0,
        paid_at: m.paid_at,
        status: m.status,
        order_id: m.order_id,
        created_at: m.created_at,
      }));

      setData({ orders, liveSales, sourcingAdvances, giftRewards: giftsRes.data || [] });
    } catch (err) {
      console.error('Erreur lors du chargement des données comptables:', err);
      setError(err instanceof Error ? err.message : 'Erreur inconnue');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isAdmin) {
      setLoading(false);
      return;
    }
    fetchAll();
  }, [isAdmin, fetchAll]);

  return { data, loading, error, refresh: fetchAll };
};
