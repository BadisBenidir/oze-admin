import React, { useMemo } from 'react';
import {
  ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  PieChart, Pie, Cell,
} from 'recharts';
import { DollarSign, PiggyBank, ShoppingBag, Wallet, Banknote, Receipt } from 'lucide-react';
import { Card, CardContent, CardHeader } from '../../ui/Card';
import { AccountingKpiCard } from './AccountingKpiCard';
import { AccountingRawData } from '../../../hooks/useAccountingRawData';
import { AccountingPeriod, isWithinRange, monthKeyLabel } from '../../../utils/accountingPeriods';
import { computeChannelTotals, computeLiveTotals, combineTotals, computeMonthlySeries } from '../../../utils/accountingCalc';

const EUR = (n: number) => (Number(n) || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
const pct = (current: number, previous: number): number | null => (previous ? ((current - previous) / Math.abs(previous)) * 100 : null);

const CHANNEL_COLORS = { web: '#2563eb', b2b: '#7c3aed', live: '#d97706' };

interface DashboardGlobalTabProps {
  data: AccountingRawData;
  period: AccountingPeriod;
}

export const DashboardGlobalTab: React.FC<DashboardGlobalTabProps> = ({ data, period }) => {
  const current = useMemo(() => {
    const web = computeChannelTotals(data.orders, 'web', period.range);
    const b2b = computeChannelTotals(data.orders, 'b2b', period.range);
    const live = computeLiveTotals(data.liveSales, period.range);
    return { web, b2b, live, global: combineTotals(web, b2b, live) };
  }, [data, period.range]);

  const mom = useMemo(() => {
    if (!period.momRange) return null;
    const web = computeChannelTotals(data.orders, 'web', period.momRange);
    const b2b = computeChannelTotals(data.orders, 'b2b', period.momRange);
    const live = computeLiveTotals(data.liveSales, period.momRange);
    return combineTotals(web, b2b, live);
  }, [data, period.momRange]);

  const yoy = useMemo(() => {
    if (!period.yoyRange) return null;
    const web = computeChannelTotals(data.orders, 'web', period.yoyRange);
    const b2b = computeChannelTotals(data.orders, 'b2b', period.yoyRange);
    const live = computeLiveTotals(data.liveSales, period.yoyRange);
    return combineTotals(web, b2b, live);
  }, [data, period.yoyRange]);

  const monthly = useMemo(() => computeMonthlySeries(data, 12), [data]);

  const donutData = useMemo(
    () => [
      { name: 'B2C', value: current.web.revenue, color: CHANNEL_COLORS.web },
      { name: 'B2B', value: current.b2b.revenue, color: CHANNEL_COLORS.b2b },
      { name: 'Lives', value: current.live.revenue, color: CHANNEL_COLORS.live },
    ].filter((d) => d.value > 0),
    [current]
  );

  // Trésorerie & fiscalité — voir accountingCalc.ts / useSalesJournalExport.ts
  // pour la même définition de "paiement encaissé" et le même régime TVA
  // standard 20% (aucun régime de la marge dans ce repo).
  const treasury = useMemo(() => {
    const inRangeOrders = data.orders.filter((o) => isWithinRange(o.created_at, period.range) && (o.order_channel === 'web' || o.order_channel === 'b2b'));
    const invoiced = inRangeOrders.reduce((s, o) => s + (Number(o.total_amount) || 0), 0);
    const collected = current.web.revenue + current.b2b.revenue;
    const activeAdvances = data.sourcingAdvances.filter((m) => m.status === 'active');
    const activeAdvancesTotal = activeAdvances.reduce((s, m) => s + m.advance_amount, 0);
    const tvaBase = collected + activeAdvancesTotal; // même périmètre que le Journal des ventes (scope "all")
    const tvaCollectee = tvaBase - tvaBase / 1.2;
    return { invoiced, collected, activeAdvancesCount: activeAdvances.length, activeAdvancesTotal, tvaCollectee };
  }, [data, period.range, current]);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <AccountingKpiCard
          label="Chiffre d'affaires total (TTC)"
          value={EUR(current.global.revenue)}
          icon={DollarSign}
          tone="green"
          hint={`HT ≈ ${EUR(current.global.revenue / 1.2)}`}
          deltaMoM={mom ? pct(current.global.revenue, mom.revenue) : undefined}
          deltaYoY={yoy ? pct(current.global.revenue, yoy.revenue) : undefined}
        />
        <AccountingKpiCard
          label="Coût d'achat global (COGS)"
          value={EUR(current.global.cogs)}
          icon={ShoppingBag}
          deltaMoM={mom ? pct(current.global.cogs, mom.cogs) : undefined}
          deltaYoY={yoy ? pct(current.global.cogs, yoy.cogs) : undefined}
        />
        <AccountingKpiCard
          label="Marge brute totale"
          value={EUR(current.global.margin)}
          icon={PiggyBank}
          tone={current.global.margin >= 0 ? 'green' : 'red'}
          hint={current.global.marginRate !== null ? `Taux de marge : ${current.global.marginRate.toFixed(1)}%` : undefined}
          deltaMoM={mom ? pct(current.global.margin, mom.margin) : undefined}
          deltaYoY={yoy ? pct(current.global.margin, yoy.margin) : undefined}
        />
        <AccountingKpiCard
          label="Ventes & panier moyen"
          value={`${current.global.count} vente${current.global.count > 1 ? 's' : ''}`}
          icon={Receipt}
          hint={`Panier moyen : ${EUR(current.global.averageBasket)}`}
          deltaMoM={mom ? pct(current.global.count, mom.count) : undefined}
          deltaYoY={yoy ? pct(current.global.count, yoy.count) : undefined}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2">
          <CardHeader><h3 className="text-base font-semibold text-gray-900">Évolution mensuelle — 12 derniers mois</h3></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <ComposedChart data={monthly.map((m) => ({ ...m, label: monthKeyLabel(m.ym) }))}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="label" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} width={70} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k€`} />
                <Tooltip formatter={(v: any) => EUR(Number(v))} />
                <Legend />
                <Bar dataKey="web" stackId="ca" name="CA B2C" fill={CHANNEL_COLORS.web} radius={[0, 0, 0, 0]} />
                <Bar dataKey="b2b" stackId="ca" name="CA B2B" fill={CHANNEL_COLORS.b2b} />
                <Bar dataKey="live" stackId="ca" name="CA Lives" fill={CHANNEL_COLORS.live} radius={[4, 4, 0, 0]} />
                <Line type="monotone" dataKey="cogs" name="Coût d'achat" stroke="#dc2626" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="margin" name="Marge brute" stroke="#16a34a" strokeWidth={2} dot={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><h3 className="text-base font-semibold text-gray-900">Répartition du CA par canal</h3></CardHeader>
          <CardContent>
            {donutData.length === 0 ? (
              <p className="text-sm text-gray-500 text-center py-12">Aucune vente sur la période</p>
            ) : (
              <>
                <ResponsiveContainer width="100%" height={220}>
                  <PieChart>
                    <Pie data={donutData} dataKey="value" nameKey="name" innerRadius={55} outerRadius={85} paddingAngle={2}>
                      {donutData.map((d) => <Cell key={d.name} fill={d.color} />)}
                    </Pie>
                    <Tooltip formatter={(v: any) => EUR(Number(v))} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="space-y-1.5 mt-2">
                  {donutData.map((d) => (
                    <div key={d.name} className="flex items-center justify-between text-sm">
                      <span className="flex items-center gap-2 text-gray-600">
                        <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: d.color }} />
                        {d.name}
                      </span>
                      <span className="font-medium text-gray-900">{EUR(d.value)}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><h3 className="text-base font-semibold text-gray-900">Tableau comparatif mensuel</h3></CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="text-left py-2.5 px-4 font-medium text-gray-500 text-xs">Mois</th>
                  <th className="text-right py-2.5 px-4 font-medium text-gray-500 text-xs">CA B2C</th>
                  <th className="text-right py-2.5 px-4 font-medium text-gray-500 text-xs">CA B2B</th>
                  <th className="text-right py-2.5 px-4 font-medium text-gray-500 text-xs">CA Lives</th>
                  <th className="text-right py-2.5 px-4 font-medium text-gray-500 text-xs">CA Total</th>
                  <th className="text-right py-2.5 px-4 font-medium text-gray-500 text-xs">Coût d'achat</th>
                  <th className="text-right py-2.5 px-4 font-medium text-gray-500 text-xs">Marge brute</th>
                  <th className="text-right py-2.5 px-4 font-medium text-gray-500 text-xs">Marge %</th>
                  <th className="text-right py-2.5 px-4 font-medium text-gray-500 text-xs">Croissance MoM</th>
                </tr>
              </thead>
              <tbody>
                {monthly.map((m, i) => {
                  const prevTotal = i > 0 ? monthly[i - 1].total : 0;
                  const growth = pct(m.total, prevTotal);
                  const marginRate = m.total > 0 ? (m.margin / m.total) * 100 : null;
                  return (
                    <tr key={m.ym} className="border-b border-gray-50 hover:bg-gray-50">
                      <td className="py-2.5 px-4 text-sm text-gray-900 capitalize">{monthKeyLabel(m.ym)}</td>
                      <td className="py-2.5 px-4 text-right text-sm text-gray-600 tabular-nums">{EUR(m.web)}</td>
                      <td className="py-2.5 px-4 text-right text-sm text-gray-600 tabular-nums">{EUR(m.b2b)}</td>
                      <td className="py-2.5 px-4 text-right text-sm text-gray-600 tabular-nums">{EUR(m.live)}</td>
                      <td className="py-2.5 px-4 text-right text-sm font-medium text-gray-900 tabular-nums">{EUR(m.total)}</td>
                      <td className="py-2.5 px-4 text-right text-sm text-gray-600 tabular-nums">{EUR(m.cogs)}</td>
                      <td className={`py-2.5 px-4 text-right text-sm font-medium tabular-nums ${m.margin >= 0 ? 'text-green-600' : 'text-red-600'}`}>{EUR(m.margin)}</td>
                      <td className="py-2.5 px-4 text-right text-sm text-gray-600 tabular-nums">{marginRate !== null ? `${marginRate.toFixed(1)}%` : '—'}</td>
                      <td className={`py-2.5 px-4 text-right text-sm font-medium tabular-nums ${growth === null ? 'text-gray-400' : growth >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                        {growth === null ? '—' : `${growth >= 0 ? '+' : ''}${growth.toFixed(1)}%`}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><h3 className="text-base font-semibold text-gray-900">Trésorerie & fiscalité</h3></CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
            <div>
              <p className="text-xs text-gray-500 flex items-center gap-1.5"><Banknote className="h-3.5 w-3.5" /> Encaissé (période)</p>
              <p className="text-lg font-semibold text-gray-900 mt-1">{EUR(treasury.collected)}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500 flex items-center gap-1.5"><Receipt className="h-3.5 w-3.5" /> Facturé (période, tous statuts)</p>
              <p className="text-lg font-semibold text-gray-900 mt-1">{EUR(treasury.invoiced)}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500 flex items-center gap-1.5"><Wallet className="h-3.5 w-3.5" /> Avances B2B en cours ({treasury.activeAdvancesCount})</p>
              <p className="text-lg font-semibold text-amber-600 mt-1">{EUR(treasury.activeAdvancesTotal)}</p>
              <p className="text-xs text-gray-400">Encaissées, pas encore converties en CA</p>
            </div>
            <div>
              <p className="text-xs text-gray-500 flex items-center gap-1.5"><DollarSign className="h-3.5 w-3.5" /> TVA collectée (estimée)</p>
              <p className="text-lg font-semibold text-gray-900 mt-1">{EUR(treasury.tvaCollectee)}</p>
              <p className="text-xs text-gray-400">Régime standard 20% — aucun régime de la marge appliqué</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default DashboardGlobalTab;
