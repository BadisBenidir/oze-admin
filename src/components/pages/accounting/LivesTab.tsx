import React, { useMemo } from 'react';
import { Gavel, DollarSign, Trophy, Package } from 'lucide-react';
import { Card, CardContent, CardHeader } from '../../ui/Card';
import { AccountingKpiCard } from './AccountingKpiCard';
import { AccountingRawData } from '../../../hooks/useAccountingRawData';
import { AccountingPeriod } from '../../../utils/accountingPeriods';
import { computeLiveTotals } from '../../../utils/accountingCalc';

const EUR = (n: number) => (Number(n) || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
const pct = (current: number, previous: number): number | null => (previous ? ((current - previous) / Math.abs(previous)) * 100 : null);

interface SessionRow {
  date: string;
  count: number;
  revenue: number;
  cogs: number;
  margin: number;
}

interface LivesTabProps {
  data: AccountingRawData;
  period: AccountingPeriod;
}

/** Regroupement par JOUR de vente (products.updated_at) faute d'une vraie
 * notion de "session live" en base (aucune table/colonne ne l'identifie
 * aujourd'hui — voir choix explicite : approximation acceptée, pas de
 * migration). Imprécis si plusieurs lives ont lieu le même jour, ou si un
 * article vendu est modifié plus tard pour une autre raison. */
export const LivesTab: React.FC<LivesTabProps> = ({ data, period }) => {
  const current = useMemo(() => computeLiveTotals(data.liveSales, period.range), [data.liveSales, period.range]);
  const mom = period.momRange ? computeLiveTotals(data.liveSales, period.momRange) : null;
  const yoy = period.yoyRange ? computeLiveTotals(data.liveSales, period.yoyRange) : null;

  const sessions = useMemo(() => {
    const map = new Map<string, SessionRow>();
    data.liveSales
      .filter((p) => {
        const t = new Date(p.sold_at).getTime();
        return t >= period.range.start.getTime() && t <= period.range.end.getTime();
      })
      .forEach((p) => {
        const day = p.sold_at.slice(0, 10);
        const row = map.get(day) || { date: day, count: 0, revenue: 0, cogs: 0, margin: 0 };
        row.count += 1;
        row.revenue += p.sale_price;
        row.cogs += p.purchase_price || 0;
        row.margin += p.sale_price - (p.purchase_price || 0);
        map.set(day, row);
      });
    return Array.from(map.values()).sort((a, b) => b.date.localeCompare(a.date));
  }, [data.liveSales, period.range]);

  const bestSession = useMemo(
    () => (sessions.length === 0 ? null : sessions.reduce((best, s) => (s.revenue > best.revenue ? s : best), sessions[0])),
    [sessions]
  );

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <AccountingKpiCard
          label="CA total Lives"
          value={EUR(current.revenue)}
          icon={Gavel}
          tone="green"
          deltaMoM={mom ? pct(current.revenue, mom.revenue) : undefined}
          deltaYoY={yoy ? pct(current.revenue, yoy.revenue) : undefined}
        />
        <AccountingKpiCard label="Panier moyen en live" value={EUR(current.averageBasket)} icon={DollarSign} />
        <AccountingKpiCard
          label="Meilleure session"
          value={bestSession ? EUR(bestSession.revenue) : '—'}
          icon={Trophy}
          hint={bestSession ? new Date(bestSession.date).toLocaleDateString('fr-FR') : undefined}
        />
        <AccountingKpiCard label="Pièces écoulées" value={String(current.count)} icon={Package} />
      </div>

      <Card>
        <CardHeader>
          <h3 className="text-base font-semibold text-gray-900">Tableau de bord par session (regroupement par jour de vente)</h3>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="text-left py-2.5 px-4 font-medium text-gray-500 text-xs">Date du live</th>
                  <th className="text-right py-2.5 px-4 font-medium text-gray-500 text-xs">Articles vendus</th>
                  <th className="text-right py-2.5 px-4 font-medium text-gray-500 text-xs">CA généré</th>
                  <th className="text-right py-2.5 px-4 font-medium text-gray-500 text-xs">Coût d'achat</th>
                  <th className="text-right py-2.5 px-4 font-medium text-gray-500 text-xs">Marge brute</th>
                  <th className="text-right py-2.5 px-4 font-medium text-gray-500 text-xs">Panier moyen</th>
                </tr>
              </thead>
              <tbody>
                {sessions.length === 0 ? (
                  <tr><td colSpan={6} className="py-6 text-center text-gray-400 text-sm">Aucune vente live sur la période</td></tr>
                ) : (
                  sessions.map((s) => (
                    <tr key={s.date} className="border-b border-gray-50 hover:bg-gray-50">
                      <td className="py-2.5 px-4 text-sm text-gray-900">
                        {new Date(s.date).toLocaleDateString('fr-FR', { weekday: 'long', day: '2-digit', month: 'long' })}
                        {bestSession?.date === s.date && <span className="ml-2 text-xs text-amber-600 font-medium">🏆 meilleure</span>}
                      </td>
                      <td className="py-2.5 px-4 text-right text-sm text-gray-600 tabular-nums">{s.count}</td>
                      <td className="py-2.5 px-4 text-right text-sm font-medium text-gray-900 tabular-nums">{EUR(s.revenue)}</td>
                      <td className="py-2.5 px-4 text-right text-sm text-gray-600 tabular-nums">{EUR(s.cogs)}</td>
                      <td className={`py-2.5 px-4 text-right text-sm font-medium tabular-nums ${s.margin >= 0 ? 'text-green-600' : 'text-red-600'}`}>{EUR(s.margin)}</td>
                      <td className="py-2.5 px-4 text-right text-sm text-gray-600 tabular-nums">{EUR(s.count > 0 ? s.revenue / s.count : 0)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default LivesTab;
