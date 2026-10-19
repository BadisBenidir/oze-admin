import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { rawDataWindowStart } from '../utils/accountingPeriods';
import { fetchSourcingFulfillmentOrderIds } from '../utils/sourcingFulfillment';

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

/** Paiement d'un abonnement — Club B2B (pass mensuel, 0185) ou membre de
 * communauté partenaire (0217) — 100 % de marge. `source` : à qui revient
 * ce CA (SUBSCRIPTION_SOURCE_CLIENTS, partenaire du code promo Club utilisé
 * à la souscription, ou entreprise de la communauté). */
export interface AccountingSubscriptionPayment {
  amount: number;
  paid_at: string;
  plan: string | null;
  source: string;
}

/** Abonnés Club sans code promo de partenaire. */
export const SUBSCRIPTION_SOURCE_CLIENTS = 'Clients';

export interface AccountingRawData {
  orders: AccountingOrder[];
  liveSales: AccountingLiveSale[];
  sourcingAdvances: AccountingSourcingAdvance[];
  giftRewards: AccountingGiftReward[];
  subscriptionPayments: AccountingSubscriptionPayment[];
  /** Sources de CA d'abonnement à afficher, même à 0 (clients, communautés, partenaires). */
  subscriptionSources: string[];
}

/** Prédicat "encaissé" partagé avec useSalesJournalExport.ts / Accounting.tsx
 * — ne jamais diverger de cette définition (paiement carte confirmé OU
 * commande déjà passée par un statut qui implique le paiement).
 *
 * Exclut explicitement `status = 'cancelled'`/`'canceled'` : payment_status
 * reste 'paid' après une annulation (le paiement a bien eu lieu, seul un
 * remboursement suit), donc sans cette exclusion une commande entièrement
 * annulée continuait de compter dans le CA/marge de Comptabilité & Finances
 * — total_amount n'est pas fiable à 0 sur tous les chemins d'annulation. */
export const isOrderPaid = (o: Pick<AccountingOrder, 'payment_status' | 'status'>): boolean =>
  !['cancelled', 'canceled'].includes(o.status) &&
  (['paid', 'succeeded'].includes(o.payment_status) || ['confirmed', 'shipped', 'delivered'].includes(o.status));

/** Charge en un seul aller-retour toutes les données brutes nécessaires aux
 * 4 onglets de "Comptabilité & Finances" sur une fenêtre glissante de 25
 * mois (voir RAW_DATA_WINDOW_MONTHS) — chaque onglet/période filtre ensuite
 * en mémoire plutôt que de refaire une requête par sélection de période ou
 * de comparaison, ce qui rend le changement de période instantané. */
export const useAccountingRawData = (isAdmin: boolean = false) => {
  const [data, setData] = useState<AccountingRawData>({ orders: [], liveSales: [], sourcingAdvances: [], giftRewards: [], subscriptionPayments: [], subscriptionSources: [SUBSCRIPTION_SOURCE_CLIENTS] });
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

      // Commandes de suivi des missions clôturées (0197/0204) : jamais dans
      // les chiffres — la mission est comptée plus bas (closedMissionOrders).
      const fulfillmentOrderIds = await fetchSourcingFulfillmentOrderIds();
      const orders: AccountingOrder[] = ((ordersRes.data || []) as unknown as OrderRow[]).filter((o) => !fulfillmentOrderIds.has(o.id)).map((o) => ({
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

      // Missions de sourcing clôturées par l'admin SANS validation du revendeur
      // (donc sans commande) : comptées comme une vente B2B à leur date de
      // clôture (completed_at, 0184) — l'avance encaissée en CA, le coût
      // d'achat des pièces sourcées en coût. Sans ça, elles disparaissaient
      // des chiffres (ni CA, ni avance en cours). Lecture séparée et
      // tolérante : avant la migration 0184, rien n'est ajouté.
      const closedMissionOrders: AccountingOrder[] = [];
      const { data: closedMissions, error: closedError } = await supabase
        .from('b2b_sourcing_missions')
        .select('id, reference, title, reseller_id, advance_amount, completed_at, resellers(company_name)')
        .eq('status', 'completed')
        .or('order_id.is.null,order_generated_by_admin.eq.true')
        .not('paid_at', 'is', null)
        .not('completed_at', 'is', null);
      if (!closedError && closedMissions && closedMissions.length > 0) {
        type ClosedMission = { id: string; reference: string | null; title: string | null; reseller_id: string; advance_amount: number; completed_at: string; resellers: { company_name: string } | null };
        const missions = closedMissions as unknown as ClosedMission[];
        const { data: missionItems } = await supabase
          .from('b2b_sourcing_items')
          .select('id, mission_id, cost_price, status, product:products(name)')
          .in('mission_id', missions.map((m) => m.id))
          .neq('status', 'cancelled');
        type MissionItem = { id: string; mission_id: string; cost_price: number | null; product: { name: string } | null };
        for (const m of missions) {
          const items = ((missionItems || []) as unknown as MissionItem[]).filter((i) => i.mission_id === m.id);
          closedMissionOrders.push({
            id: `sourcing-${m.id}`,
            order_number: m.reference || m.title || 'Sourcing',
            order_channel: 'b2b',
            status: 'confirmed',
            payment_status: 'paid',
            total_amount: Number(m.advance_amount) || 0,
            shipping_cost: 0,
            created_at: m.completed_at,
            email: '',
            customer_name: null,
            reseller_id: m.reseller_id,
            company_name: m.resellers?.company_name || null,
            requester_name: null,
            order_items: items.map((i) => ({
              id: i.id,
              line_total: 0,
              quantity: 1,
              status: 'active' as const,
              product_snapshot: { name: i.product?.name || 'Pièce sourcée', purchase_price: Number(i.cost_price) || 0 },
              product: null,
            })),
          });
        }
      }

      // Abonnements (0185, 0217) : lecture tolérante (tables absentes avant les migrations).
      const [subsRes, codesRes, communityRes, communityPricesRes] = await Promise.all([
        supabase.from('b2b_subscription_payments').select('amount, paid_at, plan, promo_code, stripe_subscription_id'),
        supabase.from('club_promo_codes').select('code, partner_name'),
        supabase.from('community_subscription_payments').select('amount, paid_at, plan, reseller_id, resellers(company_name)'),
        supabase.from('community_group_prices').select('reseller_id, resellers(company_name)'),
      ]);
      const partnerByCode = new Map<string, string>();
      for (const c of (codesRes.error ? [] : codesRes.data || []) as { code: string; partner_name: string | null }[]) {
        if (c.partner_name?.trim()) partnerByCode.set(c.code.toUpperCase(), c.partner_name.trim());
      }
      // Tout le CA d'un abonnement Club (renouvellements compris) revient au
      // partenaire du code promo utilisé sur l'une de ses factures.
      type ClubPaymentRow = { amount: number; paid_at: string; plan: string | null; promo_code: string | null; stripe_subscription_id: string | null };
      const clubRows = (subsRes.error ? [] : subsRes.data || []) as ClubPaymentRow[];
      const partnerBySubscription = new Map<string, string>();
      for (const p of clubRows) {
        const partner = p.promo_code ? partnerByCode.get(p.promo_code.toUpperCase()) : undefined;
        if (partner && p.stripe_subscription_id && !partnerBySubscription.has(p.stripe_subscription_id)) partnerBySubscription.set(p.stripe_subscription_id, partner);
      }
      const companyOf = (r: unknown) => {
        const reseller = Array.isArray(r) ? r[0] : r;
        return ((reseller as { company_name?: string } | null)?.company_name || 'Communauté').trim();
      };
      type CommunityPaymentRow = { amount: number; paid_at: string; plan: string | null; resellers: unknown };
      const subscriptionPayments: AccountingSubscriptionPayment[] = [
        ...clubRows.map((p) => ({
          amount: Number(p.amount) || 0,
          paid_at: p.paid_at,
          plan: p.plan ?? null,
          source:
            (p.stripe_subscription_id && partnerBySubscription.get(p.stripe_subscription_id)) ||
            (p.promo_code && partnerByCode.get(p.promo_code.toUpperCase())) ||
            SUBSCRIPTION_SOURCE_CLIENTS,
        })),
        ...((communityRes.error ? [] : communityRes.data || []) as CommunityPaymentRow[]).map((p) => ({
          amount: Number(p.amount) || 0,
          paid_at: p.paid_at,
          plan: p.plan ?? null,
          source: companyOf(p.resellers),
        })),
      ];
      // Sources affichées même sans CA : communautés avec des prix programmés, partenaires des codes.
      const communities = new Set<string>();
      for (const r of (communityPricesRes.error ? [] : communityPricesRes.data || []) as { resellers: unknown }[]) communities.add(companyOf(r.resellers));
      const partners = new Set(partnerByCode.values());
      for (const p of subscriptionPayments) if (p.source !== SUBSCRIPTION_SOURCE_CLIENTS && !partners.has(p.source)) communities.add(p.source);
      const subscriptionSources = [
        SUBSCRIPTION_SOURCE_CLIENTS,
        ...[...communities].sort((a, b) => a.localeCompare(b, 'fr')),
        ...[...partners].filter((p) => !communities.has(p)).sort((a, b) => a.localeCompare(b, 'fr')),
      ];

      setData({ orders: [...orders, ...closedMissionOrders], liveSales, sourcingAdvances, giftRewards: giftsRes.data || [], subscriptionPayments, subscriptionSources });
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
