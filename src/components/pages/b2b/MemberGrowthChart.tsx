import React, { useEffect, useMemo, useState } from 'react';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from 'recharts';
import { TrendingUp } from 'lucide-react';
import { Card, CardContent, CardHeader } from '../../ui/Card';
import { supabase } from '../../../lib/supabase';
import { useHideFigures } from '../../../hooks/useHideFigures';
import { useSubscriptionPromos, expectedMonthlyAmount } from '../../../hooks/useSubscriptionPromos';
import type { Reseller } from '../../../hooks/useResellers';

/**
 * Évolution des comptes ACTIFS depuis le lancement de la plateforme, jour
 * après jour (pas un cumul d'inscriptions : un compte qui devient inactif
 * fait baisser la courbe). Décision admin : seuls les comptes actifs comptent.
 *   - Abonnés : comptes Club (account_type 'subscriber') qui PAIENT — même
 *     règle que la section « Payants » de la liste des abonnés (compte actif,
 *     abonnement en cours, montant mensuel > 0), un par compte, depuis leur
 *     inscription. Accès gratuits (dont gratuit à vie) non comptés.
 *   - Membres d'accompagnement : sous-comptes des communautés (account_type
 *     'company', contact non principal). Actif depuis son inscription, et :
 *       · qui paie son abonnement de communauté (0214) → toujours actif ;
 *       · (aussi : abonnés payants venus par un code promo Vintellia, Matthieu,
 *         Homade ou Dawsell — ACCOMPANYING_PARTNERS) ;
 *       · dont le groupe reste à 0 € (ex. Groupe 3 — 700 € déjà payés) →
 *         toujours actif ;
 *       · sinon actif tant que l'accompagnement était gratuit : jusqu'au
 *         premier prix > 0 de son groupe (community_group_prices, même règle
 *         que la coupure d'accès 0221 ; non classé : premier prix payant de la
 *         communauté), prolongé par un accès offert (free_access_until, 0222).
 *         C'est la chute visible au passage au payant.
 *     Un accès retiré par l'admin (access_revoked_at, 0237) arrête l'activité.
 * Les entreprises partenaires (contact principal) et les contacts sans compte
 * ne sont pas comptés. Les comptes supprimés n'apparaissent plus.
 *
 * Vue « Par origine » : mêmes comptes actifs, par provenance —
 *   - une communauté partenaire (entreprise avec des prix d'abonnement
 *     programmés, ex. Aurel Vinted) : ses membres ;
 *   - un partenaire de code promo Club (club_promo_codes.partner_name) :
 *     abonnés ayant souscrit avec un de ses codes ;
 *   - Direct : le reste.
 */

const DIRECT = 'Direct';
const ORIGIN_COLORS = ['#2563eb', '#db2777', '#d97706', '#0891b2', '#7c3aed', '#65a30d', '#dc2626', '#0f766e'];
const DAY = 86_400_000;

type Group = 'subscribers' | 'members';

const SERIES: { key: Group; label: string; color: string }[] = [
  { key: 'subscribers', label: 'Abonnés', color: '#7c3aed' },
  { key: 'members', label: "Membres d'accompagnement", color: '#2563eb' },
];

interface ContactRow {
  created_at: string;
  is_primary: boolean;
  community_sub_status: string | null;
  member_group: number | null;
  free_access_until: string | null;
  access_revoked_at: string | null;
  reseller: Pick<
    Reseller,
    'id' | 'company_name' | 'account_type' | 'status' | 'subscription_plan' | 'subscription_status' | 'subscription_amount' | 'stripe_subscription_id'
  > | null;
}

interface PriceRow {
  reseller_id: string;
  member_group: number;
  monthly_price: number | null;
  effective_from: string;
}

/** Période d'activité d'un compte : [start, end[, end null = toujours actif. */
interface Span {
  row: ContactRow;
  group: Group;
  start: number;
  end: number | null;
}

const dayKey = (d: Date) => d.toLocaleDateString('en-CA');
const dayLabel = (key: string) => new Date(`${key}T00:00:00`).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' });
const ONGOING = new Set(['active', 'trialing', 'past_due']);
/** Groupe 3 — 700 € : accès déjà payé, compté actif sans abonnement mensuel. */
const PREPAID_GROUP = 3;
/** Partenaires de codes promo Club qui accompagnent leurs abonnés (club_promo_codes.partner_name) :
 * un abonné payant venu par leur code compte en membre d'accompagnement. */
const ACCOMPANYING_PARTNERS = /vintellia|homade|dawsell|matthieu/i;
const isCommunityMember = (r: ContactRow) => r.reseller?.account_type === 'company' && !r.is_primary;

/** Courbe jour par jour : nombre de périodes actives chaque jour, par clé. */
function buildSeries(spans: Span[], keyOf: (s: Span) => string, keys: string[], field: (k: string) => string) {
  const delta = new Map<string, Map<string, number>>();
  const bump = (t: number, k: string, n: number) => {
    const d = dayKey(new Date(t));
    if (!delta.has(d)) delta.set(d, new Map());
    const m = delta.get(d)!;
    m.set(k, (m.get(k) || 0) + n);
  };
  for (const s of spans) {
    bump(s.start, keyOf(s), 1);
    if (s.end != null && s.end <= Date.now()) bump(s.end, keyOf(s), -1);
  }
  const series: Array<Record<string, number | string>> = [];
  if (spans.length === 0) return series;
  const running = new Map<string, number>(keys.map((k) => [k, 0]));
  const cursor = new Date(`${dayKey(new Date(Math.min(...spans.map((s) => s.start))))}T00:00:00`);
  const today = new Date(`${dayKey(new Date())}T00:00:00`);
  while (cursor <= today) {
    const key = dayKey(cursor);
    const d = delta.get(key);
    if (d) for (const [k, n] of d) running.set(k, (running.get(k) || 0) + n);
    const point: Record<string, number | string> = { date: key, label: dayLabel(key) };
    let total = 0;
    for (const k of keys) {
      point[field(k)] = running.get(k) || 0;
      total += running.get(k) || 0;
    }
    point.total = total;
    series.push(point);
    cursor.setDate(cursor.getDate() + 1);
  }
  return series;
}

/** Actifs aujourd'hui et variation nette sur 30 jours, par clé. */
function countsOf(spans: Span[], keyOf: (s: Span) => string) {
  const now = Date.now();
  const ago = now - 30 * DAY;
  const activeAt = (s: Span, t: number) => s.start <= t && (s.end == null || s.end > t);
  const current = new Map<string, number>();
  const change = new Map<string, number>();
  for (const s of spans) {
    const k = keyOf(s);
    const diff = (activeAt(s, now) ? 1 : 0) - (activeAt(s, ago) ? 1 : 0);
    if (activeAt(s, now)) current.set(k, (current.get(k) || 0) + 1);
    change.set(k, (change.get(k) || 0) + diff);
  }
  return { current, change };
}

export const MemberGrowthChart: React.FC = () => {
  const [rows, setRows] = useState<ContactRow[] | null>(null);
  const [prices, setPrices] = useState<PriceRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { show } = useHideFigures();
  const promoData = useSubscriptionPromos(true);
  const [view, setView] = useState<'type' | 'origin'>('type');
  const [partnerByCode, setPartnerByCode] = useState<Map<string, string>>(new Map());

  useEffect(() => {
    Promise.all([
      supabase.from('club_promo_codes').select('code, partner_name'),
      supabase.from('community_group_prices').select('reseller_id, member_group, monthly_price, effective_from'),
    ]).then(([codesRes, pricesRes]) => {
      const map = new Map<string, string>();
      for (const c of (codesRes.data || []) as { code: string; partner_name: string | null }[]) {
        if (c.partner_name?.trim()) map.set(c.code.toUpperCase(), c.partner_name.trim());
      }
      setPartnerByCode(map);
      if (pricesRes.error) setError(pricesRes.error.message);
      setPrices((pricesRes.data || []) as PriceRow[]);
    });
  }, []);

  useEffect(() => {
    supabase
      .from('reseller_contacts')
      .select(
        'created_at, is_primary, community_sub_status, member_group, free_access_until, access_revoked_at, reseller:resellers(id, company_name, account_type, status, subscription_plan, subscription_status, subscription_amount, stripe_subscription_id)'
      )
      .then(({ data, error: fetchError }) => {
        if (fetchError) setError(fetchError.message);
        else setRows((data || []) as unknown as ContactRow[]);
      });
  }, []);

  const communityIds = useMemo(() => new Set((prices || []).map((p) => p.reseller_id)), [prices]);

  // Partenaire d'un abonné : code promo partenaire utilisé sur l'une de ses factures.
  const partnerOf = useMemo(() => {
    const byKey = new Map<string, string>();
    for (const pay of promoData?.payments || []) {
      const partner = pay.promo_code ? partnerByCode.get(pay.promo_code.toUpperCase()) : undefined;
      if (!partner) continue;
      if (pay.reseller_id && !byKey.has(pay.reseller_id)) byKey.set(pay.reseller_id, partner);
      if (pay.stripe_subscription_id && !byKey.has(pay.stripe_subscription_id)) byKey.set(pay.stripe_subscription_id, partner);
    }
    return (rs: NonNullable<ContactRow['reseller']>) =>
      byKey.get(rs.id) || (rs.stripe_subscription_id ? byKey.get(rs.stripe_subscription_id) : undefined) || null;
  }, [promoData, partnerByCode]);

  // Périodes d'activité (voir en-tête).
  const spans = useMemo<Span[] | null>(() => {
    if (!rows || !prices || !promoData) return null;
    // Premier jour où le groupe (ou, pour un non classé, la communauté) devient payant.
    const paidFrom = new Map<string, number>();
    for (const p of prices) {
      if (!(Number(p.monthly_price) > 0)) continue;
      const t = new Date(`${p.effective_from}T00:00:00`).getTime();
      for (const k of [`${p.reseller_id}:${p.member_group}`, `${p.reseller_id}:*`]) {
        if (!paidFrom.has(k) || t < paidFrom.get(k)!) paidFrom.set(k, t);
      }
    }
    const out: Span[] = [];
    const seen = new Set<string>();
    for (const r of rows) {
      const rs = r.reseller;
      if (!rs?.id) continue;
      const start = new Date(r.created_at).getTime();
      const revoked = r.access_revoked_at ? new Date(r.access_revoked_at).getTime() : null;
      if (isCommunityMember(r)) {
        let end: number | null = null;
        // Groupe 3 (700 € déjà payés) : accès gratuit, toujours actif.
        if (!ONGOING.has(r.community_sub_status || '') && r.member_group !== PREPAID_GROUP) {
          const cut = paidFrom.get(r.member_group != null ? `${rs.id}:${r.member_group}` : `${rs.id}:*`) ?? null;
          const free = r.free_access_until ? new Date(r.free_access_until).getTime() : null;
          end = cut == null ? null : Math.max(cut, free ?? 0);
        }
        if (revoked != null) end = end == null ? revoked : Math.min(end, revoked);
        if (end != null && end <= start) continue; // jamais actif
        out.push({ row: r, group: 'members', start, end });
      } else if (rs.account_type === 'subscriber' && !seen.has(rs.id)) {
        const paying =
          rs.status === 'active' &&
          ONGOING.has(rs.subscription_status || '') &&
          expectedMonthlyAmount(rs as unknown as Reseller, promoData) > 0;
        if (!paying) continue;
        seen.add(rs.id);
        // Abonnés venus d'un partenaire accompagnant (code promo) : membres d'accompagnement.
        const partner = partnerOf(rs);
        const accompanied = partner != null && ACCOMPANYING_PARTNERS.test(partner);
        out.push({ row: r, group: accompanied ? 'members' : 'subscribers', start, end: null });
      }
    }
    return out;
  }, [rows, prices, promoData, partnerOf]);

  // ---- Vue par type ----
  const byType = useMemo(() => {
    if (!spans) return null;
    const keyOf = (s: Span) => s.group;
    return { ...countsOf(spans, keyOf), series: buildSeries(spans, keyOf, SERIES.map((s) => s.key), (k) => k) };
  }, [spans]);

  // ---- Vue par origine ----
  const byOrigin = useMemo(() => {
    if (!spans || spans.length === 0 || !promoData) return null;
    const keyOf = (s: Span): string => {
      const rs = s.row.reseller!;
      if (rs.account_type === 'subscriber') {
        return partnerOf(rs) || DIRECT;
      }
      return communityIds.has(rs.id) ? (rs.company_name || 'Communauté').trim() : DIRECT;
    };
    const { current, change } = countsOf(spans, keyOf);
    const all = new Set(spans.map(keyOf));
    // Ordre : par nombre d'actifs, « Direct » en dernier.
    const origins = [...all].sort((a, b) => (a === DIRECT ? 1 : b === DIRECT ? -1 : (current.get(b) || 0) - (current.get(a) || 0)));
    const colors = new Map(origins.map((o, i) => [o, o === DIRECT ? '#6b7280' : ORIGIN_COLORS[i % ORIGIN_COLORS.length]]));
    const series = buildSeries(spans, keyOf, origins, (k) => `o${origins.indexOf(k)}`);
    return { origins, colors, current, change, series };
  }, [spans, promoData, partnerOf, communityIds]);

  const signed = (n: number) => `${n >= 0 ? '+' : '−'}${show(Math.abs(n))}`;
  const grandTotal = byType ? [...byType.current.values()].reduce((a, b) => a + b, 0) : 0;
  const grandChange = byType ? [...byType.change.values()].reduce((a, b) => a + b, 0) : 0;

  return (
    <Card>
      <CardHeader>
        <h3 className="text-base font-semibold text-gray-900 flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-gray-400" /> Membres actifs depuis le lancement
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
                <p className="text-xs text-gray-500">Membres actifs</p>
                <p className="text-xl font-semibold tabular-nums text-gray-900">{show(grandTotal)}</p>
                <p className="text-xs text-gray-500">{signed(grandChange)} sur 30 jours</p>
              </div>
              {byOrigin.origins.map((o) => (
                <div key={o} className="rounded-lg border border-gray-100 p-3">
                  <p className="flex items-center gap-1.5 text-xs text-gray-500">
                    <span className="h-2 w-2 rounded-full" style={{ backgroundColor: byOrigin.colors.get(o) }} />
                    {o === DIRECT ? 'Direct (sans partenaire)' : o}
                  </p>
                  <p className="text-xl font-semibold tabular-nums text-gray-900">{show(byOrigin.current.get(o) || 0)}</p>
                  <p className="text-xs text-gray-500">{signed(byOrigin.change.get(o) || 0)} sur 30 jours</p>
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
          </>
        ) : (
          <>
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
              <div className="rounded-lg border border-gray-100 p-3">
                <p className="text-xs text-gray-500">Membres actifs</p>
                <p className="text-xl font-semibold text-gray-900 tabular-nums">{show(grandTotal)}</p>
                <p className="text-xs text-gray-500">{signed(grandChange)} sur 30 jours</p>
              </div>
              {SERIES.map((s) => (
                <div key={s.key} className="rounded-lg border border-gray-100 p-3">
                  <p className="text-xs text-gray-500 flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full" style={{ backgroundColor: s.color }} />
                    {s.label}
                  </p>
                  <p className="text-xl font-semibold text-gray-900 tabular-nums">{show(byType?.current.get(s.key) || 0)}</p>
                  <p className="text-xs text-gray-500">{signed(byType?.change.get(s.key) || 0)} sur 30 jours</p>
                </div>
              ))}
            </div>

            <div className="h-72">
              {!byType ? (
                <div className="h-full bg-gray-50 rounded-lg animate-pulse" />
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={byType.series} margin={{ top: 8, right: 12, left: -12, bottom: 0 }}>
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
          Comptes actifs chaque jour : abonnés qui paient ; membres d'accompagnement qui paient leur abonnement ou dont le groupe reste
          gratuit (Groupe 3 — 700 €), dont les abonnés venus par un code Vintellia, Homade, Dawsell ou Matthieu. Les autres membres comptent tant que l'accompagnement était gratuit, puis sortent le jour où le
          prix de leur groupe est devenu payant. Entreprises partenaires non comptées.
        </p>
      </CardContent>
    </Card>
  );
};

export default MemberGrowthChart;
