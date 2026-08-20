import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';

export interface ReceptionItem {
  id: string;
  fulfillment_status: 'ordered' | 'received';
  product_snapshot: { name?: string; images?: string[]; main_image_index?: number; product_code?: string } | null;
  order: { id: string; order_number: string } | null;
}

export interface ReceptionGroup {
  resellerId: string;
  companyName: string;
  toReceive: ReceptionItem[];
  received: ReceptionItem[];
}

interface ActionResult {
  success: boolean;
  error?: string;
}

/**
 * Articles B2B pas encore expédiés au stade "réception" (ordered/received),
 * groupés par revendeur — voir 0062_shipments_schema.sql /
 * 0063_shipment_fulfillment_rpcs.sql. "Marquer comme reçu" et "Marquer comme
 * prêt à être livré" sont deux actions distinctes de cette même vue.
 */
export const useReceptionItems = (isAuthenticated: boolean = false) => {
  const [groups, setGroups] = useState<ReceptionGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchItems = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const { data, error: fetchError } = await supabase
        .from('order_items')
        .select(
          'id, fulfillment_status, product_snapshot, order:orders!inner(id, order_number, order_channel, reseller_id, reseller:resellers(company_name))'
        )
        .eq('status', 'active')
        .eq('order.order_channel', 'b2b')
        .in('fulfillment_status', ['ordered', 'received'])
        .order('created_at', { ascending: true });

      if (fetchError) throw new Error(fetchError.message);

      const byReseller = new Map<string, ReceptionGroup>();
      for (const row of (data || []) as unknown as Array<{
        id: string;
        fulfillment_status: 'ordered' | 'received';
        product_snapshot: ReceptionItem['product_snapshot'];
        order: { id: string; order_number: string; reseller_id: string; reseller: { company_name: string } | null } | null;
      }>) {
        if (!row.order) continue;
        const resellerId = row.order.reseller_id;
        if (!byReseller.has(resellerId)) {
          byReseller.set(resellerId, {
            resellerId,
            companyName: row.order.reseller?.company_name || 'Revendeur',
            toReceive: [],
            received: [],
          });
        }
        const group = byReseller.get(resellerId)!;
        const item: ReceptionItem = {
          id: row.id,
          fulfillment_status: row.fulfillment_status,
          product_snapshot: row.product_snapshot,
          order: { id: row.order.id, order_number: row.order.order_number },
        };
        if (row.fulfillment_status === 'ordered') group.toReceive.push(item);
        else group.received.push(item);
      }

      setGroups(Array.from(byReseller.values()).sort((a, b) => a.companyName.localeCompare(b.companyName)));
    } catch (err) {
      console.error('Erreur lors du chargement des articles à réceptionner:', err);
      setError(err instanceof Error ? err.message : 'Erreur inconnue');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isAuthenticated) {
      setLoading(false);
      return;
    }
    fetchItems();
  }, [isAuthenticated, fetchItems]);

  const markReceived = async (itemIds: string[]): Promise<ActionResult> => {
    const { error: rpcError } = await supabase.rpc('admin_mark_items_received', { p_item_ids: itemIds });
    if (rpcError) return { success: false, error: rpcError.message };
    await fetchItems();
    return { success: true };
  };

  const markReadyToShip = async (itemIds: string[]): Promise<ActionResult> => {
    const { error: rpcError } = await supabase.rpc('admin_mark_items_ready_to_ship', { p_item_ids: itemIds });
    if (rpcError) return { success: false, error: rpcError.message };
    await fetchItems();
    return { success: true };
  };

  return { groups, loading, error, refresh: fetchItems, markReceived, markReadyToShip };
};
