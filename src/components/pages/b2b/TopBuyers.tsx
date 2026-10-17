import React, { useEffect, useMemo, useState } from 'react';
import { Trophy } from 'lucide-react';
import { Card, CardContent, CardHeader } from '../../ui/Card';
import { supabase } from '../../../lib/supabase';
import { useHideFigures } from '../../../hooks/useHideFigures';
import { fetchSourcingFulfillmentOrderIds } from '../../../utils/sourcingFulfillment';

/**
 * Meilleurs acheteurs B2B (Statistiques B2B) : montant dépensé par membre —
 * commandes B2B payées et non annulées (catalogue, drops, enchères), plus
 * les avances de sourcing sur mesure encaissées (hors commandes de suivi,
 * 0204, et hors missions dont la commande validée est déjà comptée).
 * Filtres : communauté (entreprise partenaire, ou abonnés du Club) et période.
 */

type Period = 'all' | '30d' | 'month' | 'year';

interface Purchase {
  profileId: string;
  name: string;
  email: string | null;
  resellerId: string;
  community: string;
  amount: number;
  items: number;
  date: string;
}

interface BuyerRow {
  profileId: string;
  name: string;
  email: string | null;
  community: string;
  amount: number;
  orders: number;
  items: number;
  lastPurchase: string | null;
}

interface Member {
  profileId: string;
  name: string;
  email: string | null;
  community: string;
}

const EUR = (n: number) => n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
const TOP = 10;

const periodStart = (p: Period): number => {
  const now = new Date();
  if (p === '30d') return Date.now() - 30 * 86_400_000;
  if (p === 'month') return new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  if (p === 'year') return new Date(now.getFullYear(), 0, 1).getTime();
  return 0;
};

const personName = (p: { first_name: string | null; last_name: string | null; email?: string | null } | null) =>
  p ? `${p.first_name || ''} ${p.last_name || ''}`.trim() || p.email || 'Membre' : 'Membre';

export const TopBuyers: React.FC = () => {
  const [purchases, setPurchases] = useState<Purchase[] | null>(null);
  // Tous les membres du portail, y compris ceux qui n'ont encore rien acheté.
  const [members, setMembers] = useState<Member[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [community, setCommunity] = useState('all');
  const [period, setPeriod] = useState<Period>('all');
  const [expanded, setExpanded] = useState(false);
  const { show } = useHideFigures('detail');

  useEffect(() => {
    (async () => {
      const [ordersRes, missionsRes, fulfillmentIds, contactsRes] = await Promise.all([
        supabase
          .from('orders')
          .select(
            'id, total_amount, created_at, status, payment_status, reseller_id, placed_by_profile_id, ' +
              'placed_by:profiles!placed_by_profile_id(first_name, last_name, email), ' +
              'reseller:resellers(company_name, account_type), order_items(status)'
          )
          .eq('order_channel', 'b2b')
          .not('placed_by_profile_id', 'is', null),
        supabase
          .from('b2b_sourcing_missions')
          .select(
            'advance_amount, paid_at, status, order_id, order_generated_by_admin, reseller_id, user_id, ' +
              'requester:profiles!user_id(first_name, last_name, email), resellers(company_name, account_type), ' +
              'b2b_sourcing_items(status)'
          )
          .not('paid_at', 'is', null)
          .neq('status', 'cancelled'),
        fetchSourcingFulfillmentOrderIds(),
        supabase
          .from('reseller_contacts')
          .select('profile_id, profile:profiles(first_name, last_name, email), reseller:resellers(company_name, account_type)'),
      ]);
      if (ordersRes.error || missionsRes.error) {
        setError(ordersRes.error?.message || missionsRes.error?.message || 'Erreur de chargement');
        return;
      }
      type Reseller = { company_name: string; account_type: string | null } | null;
      const communityOf = (r: Reseller) => (r?.account_type === 'subscriber' ? 'Abonnés du Club' : r?.company_name || '—');

      const list: Purchase[] = [];
      for (const o of (ordersRes.data || []) as unknown as {
        id: string;
        total_amount: number;
        created_at: string;
        status: string;
        payment_status: string;
        reseller_id: string;
        placed_by_profile_id: string;
        placed_by: { first_name: string | null; last_name: string | null; email: string | null } | null;
        reseller: Reseller;
        order_items: { status: string }[];
      }[]) {
        const paid = ['paid', 'succeeded'].includes(o.payment_status) || ['shipped', 'delivered'].includes(o.status);
        if (!paid || ['cancelled', 'canceled'].includes(o.status) || fulfillmentIds.has(o.id)) continue;
        list.push({
          profileId: o.placed_by_profile_id,
          name: personName(o.placed_by),
          email: o.placed_by?.email ?? null,
          resellerId: o.reseller_id,
          community: communityOf(o.reseller),
          amount: Number(o.total_amount) || 0,
          items: (o.order_items || []).filter((i) => i.status !== 'cancelled').length,
          date: o.created_at,
        });
      }
      for (const m of (missionsRes.data || []) as unknown as {
        advance_amount: number;
        paid_at: string;
        order_id: string | null;
        order_generated_by_admin: boolean | null;
        reseller_id: string;
        user_id: string | null;
        requester: { first_name: string | null; last_name: string | null; email: string | null } | null;
        resellers: Reseller;
        b2b_sourcing_items: { status: string }[];
      }[]) {
        // Mission validée par le membre : sa commande est déjà comptée ci-dessus.
        if (!m.user_id || (m.order_id && !m.order_generated_by_admin)) continue;
        list.push({
          profileId: m.user_id,
          name: personName(m.requester),
          email: m.requester?.email ?? null,
          resellerId: m.reseller_id,
          community: communityOf(m.resellers),
          amount: Number(m.advance_amount) || 0,
          items: (m.b2b_sourcing_items || []).filter((i) => i.status !== 'cancelled').length,
          date: m.paid_at,
        });
      }
      setMembers(
        ((contactsRes.data || []) as unknown as {
          profile_id: string;
          profile: { first_name: string | null; last_name: string | null; email: string | null } | null;
          reseller: Reseller;
        }[]).map((c) => ({
          profileId: c.profile_id,
          name: personName(c.profile),
          email: c.profile?.email ?? null,
          community: communityOf(c.reseller),
        }))
      );
      setPurchases(list);
    })();
  }, []);

  const communities = useMemo(
    () => Array.from(new Set([...members, ...(purchases || [])].map((p) => p.community))).sort((a, b) => a.localeCompare(b)),
    [purchases, members]
  );

  const buyers = useMemo(() => {
    const since = periodStart(period);
    const byProfile = new Map<string, BuyerRow>();
    for (const m of members) {
      if (community !== 'all' && m.community !== community) continue;
      byProfile.set(m.profileId, { ...m, amount: 0, orders: 0, items: 0, lastPurchase: null });
    }
    for (const p of purchases || []) {
      if (community !== 'all' && p.community !== community) continue;
      if (new Date(p.date).getTime() < since) continue;
      const row = byProfile.get(p.profileId) || {
        profileId: p.profileId,
        name: p.name,
        email: p.email,
        community: p.community,
        amount: 0,
        orders: 0,
        items: 0,
        lastPurchase: p.date,
      };
      row.amount += p.amount;
      row.orders += 1;
      row.items += p.items;
      if (!row.lastPurchase || p.date > row.lastPurchase) row.lastPurchase = p.date;
      byProfile.set(p.profileId, row);
    }
    return Array.from(byProfile.values()).sort((a, b) => b.amount - a.amount || a.name.localeCompare(b.name));
  }, [purchases, members, community, period]);
  const buyersCount = buyers.filter((b) => b.orders > 0).length;

  const visible = expanded ? buyers : buyers.slice(0, TOP);
  const select = 'px-3 py-1.5 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:border-gray-400';

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <h3 className="text-base font-semibold text-gray-900 flex items-center gap-2">
            <Trophy className="h-4 w-4 text-amber-500" /> Meilleurs acheteurs
          </h3>
          <div className="flex flex-wrap items-center gap-2">
            <select value={community} onChange={(e) => setCommunity(e.target.value)} className={select}>
              <option value="all">Toutes les communautés</option>
              {communities.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
            <select value={period} onChange={(e) => setPeriod(e.target.value as Period)} className={select}>
              <option value="all">Depuis le lancement</option>
              <option value="year">Cette année</option>
              <option value="month">Ce mois-ci</option>
              <option value="30d">30 derniers jours</option>
            </select>
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {error ? (
          <p className="p-6 text-sm text-red-600">{error}</p>
        ) : purchases === null ? (
          <div className="m-4 h-40 rounded-lg bg-gray-50 animate-pulse" />
        ) : buyers.length === 0 ? (
          <p className="p-6 text-center text-sm text-gray-500">Aucun membre pour ces filtres.</p>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px]">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50 text-xs text-gray-500">
                    <th className="py-2.5 px-4 text-left font-medium w-12">#</th>
                    <th className="py-2.5 px-4 text-left font-medium">Membre</th>
                    <th className="py-2.5 px-4 text-left font-medium">Communauté</th>
                    <th className="py-2.5 px-4 text-right font-medium">Achats</th>
                    <th className="py-2.5 px-4 text-right font-medium">Articles</th>
                    <th className="py-2.5 px-4 text-right font-medium">Total dépensé</th>
                    <th className="py-2.5 px-4 text-right font-medium">Dernier achat</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((b, i) => (
                    <tr key={b.profileId} className="border-b border-gray-50 last:border-b-0">
                      <td className="py-2.5 px-4 text-sm font-semibold text-gray-400 tabular-nums">
                        {i < 3 ? ['🥇', '🥈', '🥉'][i] : i + 1}
                      </td>
                      <td className="py-2.5 px-4">
                        <p className="text-sm font-medium text-gray-900">{b.name}</p>
                        {b.email && <p className="text-xs text-gray-400">{b.email}</p>}
                      </td>
                      <td className="py-2.5 px-4 text-sm text-gray-600">{b.community}</td>
                      <td className="py-2.5 px-4 text-right text-sm tabular-nums text-gray-700">{b.orders}</td>
                      <td className="py-2.5 px-4 text-right text-sm tabular-nums text-gray-700">{b.items}</td>
                      <td className="py-2.5 px-4 text-right text-sm font-semibold tabular-nums text-gray-900">{show(EUR(b.amount))}</td>
                      <td className="py-2.5 px-4 text-right text-xs text-gray-500">{b.lastPurchase ? new Date(b.lastPurchase).toLocaleDateString('fr-FR') : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {buyers.length > TOP && (
              <button
                type="button"
                onClick={() => setExpanded((v) => !v)}
                className="w-full border-t border-gray-100 py-3 text-sm font-medium text-gray-600 hover:bg-gray-50 hover:text-gray-900"
              >
                {expanded ? 'Afficher le top 10' : `Voir tous les membres (${buyers.length} — dont ${buyersCount} acheteur${buyersCount > 1 ? 's' : ''})`}
              </button>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
};

export default TopBuyers;
