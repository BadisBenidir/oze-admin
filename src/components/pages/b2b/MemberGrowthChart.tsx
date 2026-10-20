import React, { useEffect, useMemo, useState } from 'react';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from 'recharts';
import { TrendingUp } from 'lucide-react';
import { Card, CardContent, CardHeader } from '../../ui/Card';
import { supabase } from '../../../lib/supabase';
import { useHideFigures } from '../../../hooks/useHideFigures';
import { useSubscriptionPromos, lifetimeFreeCode } from '../../../hooks/useSubscriptionPromos';
import type { Reseller } from '../../../hooks/useResellers';

/**
 * Croissance des membres depuis le lancement de la plateforme : nombre
 * cumulé, jour après jour, de comptes ayant rejoint le portail — date
 * d'arrivée = reseller_contacts.created_at.
 *   - Abonnés : comptes Club B2B payants (resellers.account_type =
 *     'subscriber'). Un abonné gratuit à vie (code promo Club 100 % à vie,
 *     même règle que le badge « Gratuit à vie » de la liste des abonnés)
 *     est compté en Partenaire ;
 *   - Membres d'accompagnement : sous-comptes des entreprises partenaires
 *     (account_type 'company', contact non principal) ;
 *   - Partenaires : contact principal de chaque entreprise partenaire, plus
 *     les abonnés gratuits à vie.
 * Les comptes supprimés depuis n'apparaissent plus (aucun historique).
 *
 * Vue « Par origine » : d'où vient chaque compte —
 *   - une communauté partenaire (entreprise avec des prix d'abonnement
 *     programmés, ex. Aurel Vinted) : tous ses comptes ;
 *   - un partenaire de code promo Club (club_promo_codes.partner_name, ex.
 *     Julia, Dawsell, Homade) : abonnés ayant souscrit avec un de ses codes ;
 *   - Direct : tout le reste (abonnés sans code partenaire, autres comptes).
 */

const DIRECT = 'Direct';
const ORIGIN_COLORS = ['#2563eb', '#db2777', '#d97706', '#0891b2', '#7c3aed', '#65a30d', '#dc2626', '#0f766e'];

type Group = 'subscribers' | 'members' | 'partners';

const SERIES: { key: Group; label: string; color: string }[] = [
  { key: 'subscribers', label: 'Abonnés', color: '#7c3aed' },
  { key: 'members', label: "Membres d'accompagnement", color: '#2563eb' },
  { key: 'partners', label: 'Partenaires', color: '#059669' },
];

interface ContactRow {
  created_at: string;
  is_primary: boolean;
  reseller: { id: string; company_name: string | null; account_type: string | null; subscription_plan: Reseller['subscription_plan']; stripe_subscription_id: string | null } | null;
}

const dayKey = (d: Date) => d.toLocaleDateString('en-CA');
const dayLabel = (key: string) => new Date(`${key}T00:00:00`).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' });

export const MemberGrowthChart: React.FC = () => {
  const [rows, setRows] = useState<ContactRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { show } = useHideFigures();
  const promoData = useSubscriptionPromos(true);
  const [view, setView] = useState<'type' | 'origin'>('type');
  // Origine : partenaires des codes promo Club et communautés à abonnement.
  const [partnerByCode, setPartnerByCode] = useState<Map<string, string>>(new Map());
  const [communityIds, setCommunityIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    Promise.all([
      supabase.from('club_promo_codes').select('code, partner_name'),
      supabase.from('community_group_prices').select('reseller_id'),
    ]).then(([codesRes, pricesRes]) => {
      const map = new Map<string, string>();
      for (const c of (codesRes.data || []) as { code: string; partner_name: string | null }[]) {
        if (c.partner_name?.trim()) map.set(c.code.toUpperCase(), c.partner_name.trim());
      }
      setPartnerByCode(map);
      setCommunityIds(new Set(((pricesRes.data || []) as { reseller_id: string }[]).map((r) => r.reseller_id)));
    });
  }, []);

  useEffect(() => {
    supabase
      .from('reseller_contacts')
      .select('created_at, is_primary, reseller:resellers(id, company_name, account_type, subscription_plan, stripe_subscription_id)')
      .order('created_at', { ascending: true })
      .then(({ data, error: fetchError }) => {
        if (fetchError) setError(fetchError.message);
        else setRows((data || []) as unknown as ContactRow[]);
      });
  }, []);


  const { series, totals, last30, lifetimeFreeCount } = useMemo(() => {
    const totals: Record<Group, number> = { subscribers: 0, members: 0, partners: 0 };
    const last30: Record<Group, number> = { subscribers: 0, members: 0, partners: 0 };
    if (!rows || rows.length === 0 || !promoData) return { series: [], totals, last30, lifetimeFreeCount: 0 };

    // Abonnés gratuits à vie : comptés en Partenaires, pas en Abonnés.
    const isLifetimeFree = (r: ContactRow) =>
      r.reseller?.account_type === 'subscriber' && Boolean(lifetimeFreeCode(r.reseller as unknown as Reseller, promoData));
    const groupOf = (r: ContactRow): Group =>
      r.reseller?.account_type === 'subscriber'
        ? isLifetimeFree(r) ? 'partners' : 'subscribers'
        : r.is_primary ? 'partners' : 'members';
    const lifetimeFreeCount = rows.filter(isLifetimeFree).length;

    const joinsByDay = new Map<string, Record<Group, number>>();
    const since30 = Date.now() - 30 * 86_400_000;
    for (const r of rows) {
      const g = groupOf(r);
      const key = dayKey(new Date(r.created_at));
      if (!joinsByDay.has(key)) joinsByDay.set(key, { subscribers: 0, members: 0, partners: 0 });
      joinsByDay.get(key)![g] += 1;
      totals[g] += 1;
      if (new Date(r.created_at).getTime() >= since30) last30[g] += 1;
    }

    // Un point par jour, du premier inscrit à aujourd'hui (courbe cumulée).
    const series: Array<Record<string, number | string>> = [];
    const running: Record<Group, number> = { subscribers: 0, members: 0, partners: 0 };
    const cursor = new Date(`${dayKey(new Date(rows[0].created_at))}T00:00:00`);
    const today = new Date(`${dayKey(new Date())}T00:00:00`);
    while (cursor <= today) {
      const key = dayKey(cursor);
      const joins = joinsByDay.get(key);
      if (joins) for (const s of SERIES) running[s.key] += joins[s.key];
      series.push({
        date: key,
        label: dayLabel(key),
        ...running,
        total: running.subscribers + running.members + running.partners,
      });
      cursor.setDate(cursor.getDate() + 1);
    }
    return { series, totals, last30, lifetimeFreeCount };
  }, [rows, promoData]);

  const grandTotal = totals.subscribers + totals.members + totals.partners;

  // ---- Vue par origine ----
  const byOrigin = useMemo(() => {
    if (!rows || rows.length === 0 || !promoData) return null;
    // Partenaire d'un abonné : code promo partenaire utilisé sur l'une de ses factures.
    const partnerOfReseller = new Map<string, string>();
    for (const pay of promoData.payments) {
      const partner = pay.promo_code ? partnerByCode.get(pay.promo_code.toUpperCase()) : undefined;
      if (!partner) continue;
      if (pay.reseller_id && !partnerOfReseller.has(pay.reseller_id)) partnerOfReseller.set(pay.reseller_id, partner);
      if (pay.stripe_subscription_id && !partnerOfReseller.has(pay.stripe_subscription_id)) partnerOfReseller.set(pay.stripe_subscription_id, partner);
    }
    const originOf = (r: ContactRow): string => {
      const rs = r.reseller;
      if (!rs) return DIRECT;
      if (rs.account_type === 'subscriber') {
        return partnerOfReseller.get(rs.id) || (rs.stripe_subscription_id && partnerOfReseller.get(rs.stripe_subscription_id)) || DIRECT;
      }
      return communityIds.has(rs.id) ? (rs.company_name || 'Communauté').trim() : DIRECT;
    };

    const totalsBy = new Map<string, number>();
    const last30By = new Map<string, number>();
    const joinsByDay = new Map<string, Map<string, number>>();
    const since30 = Date.now() - 30 * 86_400_000;
    for (const r of rows) {
      const o = originOf(r);
      const key = dayKey(new Date(r.created_at));
      if (!joinsByDay.has(key)) joinsByDay.set(key, new Map());
      const day = joinsByDay.get(key)!;
      day.set(o, (day.get(o) || 0) + 1);
      totalsBy.set(o, (totalsBy.get(o) || 0) + 1);
      if (new Date(r.created_at).getTime() >= since30) last30By.set(o, (last30By.get(o) || 0) + 1);
    }
    // Ordre : communautés et partenaires par taille, « Direct » en dernier.
    const origins = [...totalsBy.keys()].sort((a, b) => (a === DIRECT ? 1 : b === DIRECT ? -1 : (totalsBy.get(b) || 0) - (totalsBy.get(a) || 0)));
    const colors = new Map(origins.map((o, i) => [o, o === DIRECT ? '#6b7280' : ORIGIN_COLORS[i % ORIGIN_COLORS.length]]));

    const series: Array<Record<string, number | string>> = [];
    const running = new Map<string, number>(origins.map((o) => [o, 0]));
    const cursor = new Date(`${dayKey(new Date(rows[0].created_at))}T00:00:00`);
    const today = new Date(`${dayKey(new Date())}T00:00:00`);
    while (cursor <= today) {
      const key = dayKey(cursor);
      const joins = joinsByDay.get(key);
      if (joins) for (const [o, n] of joins) running.set(o, (running.get(o) || 0) + n);
      const point: Record<string, number | string> = { date: key, label: dayLabel(key) };
      let total = 0;
      origins.forEach((o, i) => {
        point[`o${i}`] = running.get(o) || 0;
        total += running.get(o) || 0;
      });
      point.total = total;
      series.push(point);
      cursor.setDate(cursor.getDate() + 1);
    }
    return { origins, colors, totalsBy, last30By, series };
  }, [rows, promoData, partnerByCode, communityIds]);

  return (
    <Card>
      <CardHeader>
        <h3 className="text-base font-semibold text-gray-900 flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-gray-400" /> Croissance des membres depuis le lancement
        </h3>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex gap-1 rounded-lg bg-gray-100 p-1 w-fit">
          {([['type', 'Par type'], ['origin', 'Par origine']] as const).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setView(id)}
              className={`rounded-md px-3 py-1 text-xs font-medium ${view === id ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-800'}`}
            >
              {label}
            </button>
          ))}
        </div>

        {view === 'origin' && byOrigin ? (
          <>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
              <div className="rounded-lg border border-gray-100 p-3">
                <p className="text-xs text-gray-500">Total membres</p>
                <p className="text-xl font-semibold tabular-nums text-gray-900">{show(grandTotal)}</p>
                <p className="text-xs text-gray-500">+{show(last30.subscribers + last30.members + last30.partners)} sur 30 jours</p>
              </div>
              {byOrigin.origins.map((o) => (
                <div key={o} className="rounded-lg border border-gray-100 p-3">
                  <p className="flex items-center gap-1.5 text-xs text-gray-500">
                    <span className="h-2 w-2 rounded-full" style={{ backgroundColor: byOrigin.colors.get(o) }} />
                    {o === DIRECT ? 'Direct (sans partenaire)' : o}
                  </p>
                  <p className="text-xl font-semibold tabular-nums text-gray-900">{show(byOrigin.totalsBy.get(o) || 0)}</p>
                  <p className="text-xs text-gray-500">+{show(byOrigin.last30By.get(o) || 0)} sur 30 jours</p>
                </div>
              ))}
            </div>
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={byOrigin.series} margin={{ top: 8, right: 12, left: -12, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#6b7280' }} interval="preserveStartEnd" minTickGap={24} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#6b7280' }} />
                  <Tooltip />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Line type="monotone" dataKey="total" name="Total" stroke="#111827" strokeWidth={2} dot={false} />
                  {byOrigin.origins.map((o, i) => (
                    <Line key={o} type="monotone" dataKey={`o${i}`} name={o === DIRECT ? 'Direct' : o} stroke={byOrigin.colors.get(o)} strokeWidth={2} dot={false} />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
            <p className="text-xs text-gray-400">
              Origine : communauté partenaire (tous ses comptes), partenaire du code promo Club utilisé à l'abonnement (Codes promo Club → champ
              « Partenaire »), sinon Direct.
            </p>
          </>
        ) : (
        <>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="rounded-lg border border-gray-100 p-3">
            <p className="text-xs text-gray-500">Total membres</p>
            <p className="text-xl font-semibold text-gray-900 tabular-nums">{show(grandTotal)}</p>
            <p className="text-xs text-gray-500">+{show(last30.subscribers + last30.members + last30.partners)} sur 30 jours</p>
          </div>
          {SERIES.map((s) => (
            <div key={s.key} className="rounded-lg border border-gray-100 p-3">
              <p className="text-xs text-gray-500 flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: s.color }} />
                {s.label}
              </p>
              <p className="text-xl font-semibold text-gray-900 tabular-nums">{show(totals[s.key])}</p>
              {s.key === 'partners' && lifetimeFreeCount > 0 && (
                <p className="text-xs text-gray-400">dont {show(lifetimeFreeCount)} abonné{lifetimeFreeCount > 1 ? 's' : ''} gratuit{lifetimeFreeCount > 1 ? 's' : ''} à vie</p>
              )}
              <p className="text-xs text-gray-500">+{show(last30[s.key])} sur 30 jours</p>
            </div>
          ))}
        </div>

        <div className="h-72">
          {rows === null || !promoData ? (
            <div className="h-full bg-gray-50 rounded-lg animate-pulse" />
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={series} margin={{ top: 8, right: 12, left: -12, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#6b7280' }} interval="preserveStartEnd" minTickGap={24} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#6b7280' }} />
                <Tooltip />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Line type="monotone" dataKey="total" name="Total" stroke="#111827" strokeWidth={2} dot={false} />
                {SERIES.map((s) => (
                  <Line key={s.key} type="monotone" dataKey={s.key} name={s.label} stroke={s.color} strokeWidth={2} dot={false} />
                ))}
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
        </>
        )}
        <p className="text-xs text-gray-400">
          Date d'arrivée = création du compte sur le portail. Les comptes supprimés depuis ne sont pas comptés.
        </p>
      </CardContent>
    </Card>
  );
};

export default MemberGrowthChart;
