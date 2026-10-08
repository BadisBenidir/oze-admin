import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, ChevronDown, ChevronRight, ExternalLink, RefreshCw, Tag, TrendingUp, Users } from 'lucide-react';
import { Card, CardContent } from '../../ui/Card';
import { Badge } from '../../ui/Badge';
import { supabase } from '../../../lib/supabase';
import { invokeEdgeFunction } from '../../../utils/invokeEdgeFunction';

/**
 * Codes promo des abonnements Club B2B (page « Codes promo Club ») : les codes
 * eux-mêmes sont créés dans Stripe (Coupons → Codes promotionnels) et listés
 * par l'Edge Function subscription-promo-codes ; les membres et le CA par code
 * viennent des factures d'abonnement enregistrées (b2b_subscription_payments,
 * colonnes promo_code / discount_amount, 0191).
 */

interface StripePromoCode {
  id: string;
  code: string;
  active: boolean;
  times_redeemed: number;
  max_redemptions: number | null;
  expires_at: string | null;
  created_at: string;
  coupon: {
    name: string | null;
    percent_off: number | null;
    amount_off: number | null;
    duration: 'once' | 'repeating' | 'forever';
    duration_in_months: number | null;
  };
}

interface PaymentRow {
  promo_code: string | null;
  reseller_id: string | null;
  amount: number;
  discount_amount: number;
  paid_at: string;
  reseller: { company_name: string | null; contact_email: string | null } | null;
}

interface MemberStat {
  resellerId: string;
  name: string;
  email: string | null;
  payments: number;
  revenue: number;
  discount: number;
  firstUse: string;
}

interface CodeRow {
  code: string;
  stripe: StripePromoCode | null;
  members: MemberStat[];
  payments: number;
  revenue: number;
  discount: number;
}

const EUR = (n: number) => n.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' });
const shortDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

const discountLabel = (p: StripePromoCode | null): string => {
  if (!p) return '—';
  const c = p.coupon;
  const amount = c.percent_off ? `-${c.percent_off} %` : c.amount_off ? `-${EUR(c.amount_off)}` : '—';
  const duration =
    c.duration === 'forever' ? 'à vie' : c.duration === 'once' ? '1er mois' : `${c.duration_in_months || 1} mois`;
  return `${amount} · ${duration}`;
};

export const SubscriptionPromoCodes: React.FC = () => {
  const [codes, setCodes] = useState<StripePromoCode[]>([]);
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const [stripeRes, paymentsRes] = await Promise.all([
      invokeEdgeFunction<{ codes: StripePromoCode[] }>('subscription-promo-codes', {}),
      supabase
        .from('b2b_subscription_payments')
        .select('promo_code, reseller_id, amount, discount_amount, paid_at, reseller:resellers(company_name, contact_email)')
        .not('promo_code', 'is', null),
    ]);
    if (stripeRes.error) setError(stripeRes.error);
    else setCodes(stripeRes.data?.codes || []);
    if (paymentsRes.error) setError(paymentsRes.error.message);
    else setPayments((paymentsRes.data || []) as unknown as PaymentRow[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const rows = useMemo<CodeRow[]>(() => {
    const byCode = new Map<string, CodeRow>();
    for (const c of codes) {
      byCode.set(c.code.toUpperCase(), { code: c.code, stripe: c, members: [], payments: 0, revenue: 0, discount: 0 });
    }
    const members = new Map<string, Map<string, MemberStat>>();
    for (const p of payments) {
      if (!p.promo_code) continue;
      const key = p.promo_code.toUpperCase();
      if (!byCode.has(key)) byCode.set(key, { code: p.promo_code, stripe: null, members: [], payments: 0, revenue: 0, discount: 0 });
      const row = byCode.get(key)!;
      row.payments += 1;
      row.revenue += Number(p.amount) || 0;
      row.discount += Number(p.discount_amount) || 0;
      const memberKey = p.reseller_id || 'inconnu';
      if (!members.has(key)) members.set(key, new Map());
      const m = members.get(key)!;
      const existing = m.get(memberKey);
      if (existing) {
        existing.payments += 1;
        existing.revenue += Number(p.amount) || 0;
        existing.discount += Number(p.discount_amount) || 0;
        if (p.paid_at < existing.firstUse) existing.firstUse = p.paid_at;
      } else {
        m.set(memberKey, {
          resellerId: memberKey,
          name: p.reseller?.company_name || 'Compte inconnu',
          email: p.reseller?.contact_email || null,
          payments: 1,
          revenue: Number(p.amount) || 0,
          discount: Number(p.discount_amount) || 0,
          firstUse: p.paid_at,
        });
      }
    }
    for (const [key, m] of members) {
      byCode.get(key)!.members = [...m.values()].sort((a, b) => b.firstUse.localeCompare(a.firstUse));
    }
    return [...byCode.values()].sort((a, b) => b.members.length - a.members.length || b.revenue - a.revenue || a.code.localeCompare(b.code));
  }, [codes, payments]);

  const totals = useMemo(() => {
    const memberIds = new Set(payments.filter((p) => p.promo_code).map((p) => p.reseller_id));
    return {
      members: memberIds.size,
      revenue: payments.reduce((s, p) => s + (Number(p.amount) || 0), 0),
      discount: payments.reduce((s, p) => s + (Number(p.discount_amount) || 0), 0),
      activeCodes: codes.filter((c) => c.active).length,
    };
  }, [payments, codes]);

  const sync = async () => {
    setSyncing(true);
    setSyncMessage(null);
    const { data, error: err } = await invokeEdgeFunction<{ recorded: number }>('sync-subscription-payments', {});
    setSyncing(false);
    setSyncMessage(err ? `Échec : ${err}` : `${data?.recorded ?? 0} facture(s) relue(s) chez Stripe.`);
    if (!err) load();
  };

  return (
    <div className="p-4 md:p-6">
      <div className="mb-6 flex flex-col justify-between gap-4 md:flex-row md:items-center">
        <div>
          <h3 className="text-lg font-semibold text-gray-900">Codes promo Club B2B</h3>
          <p className="text-sm text-gray-500">Codes utilisables à l'inscription au Pass Drops et au Pass Revendeur</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <a
            href="https://dashboard.stripe.com/coupons"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
          >
            <ExternalLink className="h-4 w-4" /> Créer un code dans Stripe
          </a>
          <button
            onClick={sync}
            disabled={syncing}
            className="flex items-center gap-1.5 rounded-lg bg-gray-900 px-3 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${syncing ? 'animate-spin' : ''}`} /> Synchroniser
          </button>
        </div>
      </div>

      {syncMessage && <p className="mb-4 text-sm text-gray-600">{syncMessage}</p>}
      {error && (
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          <AlertCircle className="h-4 w-4 flex-shrink-0" /> {error}
        </div>
      )}

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { icon: Tag, label: 'Codes actifs', value: String(totals.activeCodes) },
          { icon: Users, label: 'Membres avec un code', value: String(totals.members) },
          { icon: TrendingUp, label: 'CA encaissé via codes', value: EUR(totals.revenue) },
          { icon: Tag, label: 'Remises accordées', value: EUR(totals.discount) },
        ].map(({ icon: Icon, label, value }) => (
          <Card key={label}>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 text-xs font-medium text-gray-500">
                <Icon className="h-4 w-4 text-gray-400" /> {label}
              </div>
              <p className="mt-2 text-2xl font-semibold tabular-nums text-gray-900">{loading ? '…' : value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-100 text-left text-xs font-medium text-gray-500">
                  <th className="px-4 py-3">Code</th>
                  <th className="px-4 py-3">Remise</th>
                  <th className="px-4 py-3">Statut</th>
                  <th className="px-4 py-3 text-right">Utilisations</th>
                  <th className="px-4 py-3 text-right">Membres</th>
                  <th className="px-4 py-3 text-right">CA encaissé</th>
                  <th className="px-4 py-3 text-right">Remises</th>
                  <th className="px-4 py-3">Expire</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={8} className="px-4 py-8 text-center text-sm text-gray-400">Chargement…</td></tr>
                ) : rows.length === 0 ? (
                  <tr><td colSpan={8} className="px-4 py-8 text-center text-sm text-gray-500">Aucun code promo. Crée-en un dans Stripe (Coupons → Codes promotionnels).</td></tr>
                ) : (
                  rows.map((r) => {
                    const open = expanded === r.code;
                    return (
                      <React.Fragment key={r.code}>
                        <tr
                          onClick={() => setExpanded(open ? null : r.code)}
                          className="cursor-pointer border-b border-gray-50 text-sm hover:bg-gray-50"
                        >
                          <td className="px-4 py-3 font-mono font-medium text-gray-900">
                            <span className="inline-flex items-center gap-1.5">
                              {open ? <ChevronDown className="h-3.5 w-3.5 text-gray-400" /> : <ChevronRight className="h-3.5 w-3.5 text-gray-400" />}
                              {r.code}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-gray-700">{discountLabel(r.stripe)}</td>
                          <td className="px-4 py-3">
                            {!r.stripe ? (
                              <Badge variant="default">Hors liste Stripe</Badge>
                            ) : r.stripe.active ? (
                              <Badge variant="success">Actif</Badge>
                            ) : (
                              <Badge variant="default">Inactif</Badge>
                            )}
                          </td>
                          <td className="px-4 py-3 text-right tabular-nums text-gray-700">
                            {r.stripe ? `${r.stripe.times_redeemed}${r.stripe.max_redemptions ? ` / ${r.stripe.max_redemptions}` : ''}` : '—'}
                          </td>
                          <td className="px-4 py-3 text-right font-medium tabular-nums text-gray-900">{r.members.length}</td>
                          <td className="px-4 py-3 text-right tabular-nums text-gray-900">{EUR(r.revenue)}</td>
                          <td className="px-4 py-3 text-right tabular-nums text-gray-500">{EUR(r.discount)}</td>
                          <td className="px-4 py-3 text-gray-500">{shortDate(r.stripe?.expires_at ?? null)}</td>
                        </tr>
                        {open && (
                          <tr className="border-b border-gray-100 bg-gray-50/60">
                            <td colSpan={8} className="px-4 py-3">
                              {r.members.length === 0 ? (
                                <p className="text-sm text-gray-500">Aucun membre n'a encore payé avec ce code.</p>
                              ) : (
                                <table className="w-full text-sm">
                                  <thead>
                                    <tr className="text-left text-xs text-gray-500">
                                      <th className="py-1.5 pr-4 font-medium">Membre</th>
                                      <th className="py-1.5 pr-4 font-medium">Depuis le</th>
                                      <th className="py-1.5 pr-4 text-right font-medium">Paiements</th>
                                      <th className="py-1.5 pr-4 text-right font-medium">CA encaissé</th>
                                      <th className="py-1.5 text-right font-medium">Remise</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {r.members.map((m) => (
                                      <tr key={m.resellerId} className="border-t border-gray-100">
                                        <td className="py-1.5 pr-4">
                                          <span className="font-medium text-gray-900">{m.name}</span>
                                          {m.email && <span className="ml-2 text-xs text-gray-500">{m.email}</span>}
                                        </td>
                                        <td className="py-1.5 pr-4 text-gray-600">{shortDate(m.firstUse)}</td>
                                        <td className="py-1.5 pr-4 text-right tabular-nums text-gray-700">{m.payments}</td>
                                        <td className="py-1.5 pr-4 text-right tabular-nums text-gray-900">{EUR(m.revenue)}</td>
                                        <td className="py-1.5 text-right tabular-nums text-gray-500">{EUR(m.discount)}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              )}
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
      <p className="mt-3 text-xs text-gray-400">
        « Utilisations » : compteur Stripe (tous usages du code). « Membres » et « CA » : abonnés ayant payé au moins une
        échéance avec ce code, d'après les factures enregistrées — utilise « Synchroniser » pour rattraper l'historique.
      </p>
    </div>
  );
};

export default SubscriptionPromoCodes;
