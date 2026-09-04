import React, { useMemo } from 'react';
import { Handshake, PiggyBank, Package, DollarSign, Wallet, Gift } from 'lucide-react';
import { Card, CardContent, CardHeader } from '../../ui/Card';
import { AccountingKpiCard } from './AccountingKpiCard';
import { AccountingRawData } from '../../../hooks/useAccountingRawData';
import { AccountingPeriod, isWithinRange } from '../../../utils/accountingPeriods';
import { computeChannelTotals, ESTIMATED_GIFT_WALLET_UNIT_COST } from '../../../utils/accountingCalc';

const EUR = (n: number) => (Number(n) || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
const pct = (current: number, previous: number): number | null => (previous ? ((current - previous) / Math.abs(previous)) * 100 : null);

interface B2BTabProps {
  data: AccountingRawData;
  period: AccountingPeriod;
}

export const B2BTab: React.FC<B2BTabProps> = ({ data, period }) => {
  const current = useMemo(() => computeChannelTotals(data.orders, 'b2b', period.range), [data.orders, period.range]);
  const mom = period.momRange ? computeChannelTotals(data.orders, 'b2b', period.momRange) : null;
  const yoy = period.yoyRange ? computeChannelTotals(data.orders, 'b2b', period.yoyRange) : null;

  const piecesCount = useMemo(
    () =>
      data.orders
        .filter((o) => o.order_channel === 'b2b' && isWithinRange(o.created_at, period.range))
        .reduce((s, o) => s + o.order_items.filter((i) => i.status === 'active').length, 0),
    [data.orders, period.range]
  );

  const activeAdvances = useMemo(() => data.sourcingAdvances.filter((m) => m.status === 'active'), [data.sourcingAdvances]);
  const activeAdvancesTotal = activeAdvances.reduce((s, m) => s + m.advance_amount, 0);

  // Classement par entreprise cliente — regroupe commandes B2B ET missions
  // de sourcing déjà validées (une mission validée crée une vraie commande
  // order_channel='b2b', voir 0098 : déjà comptée une seule fois ici via
  // `data.orders`, jamais en double avec advance_amount).
  const byCompany = useMemo(() => {
    const map = new Map<string, { company: string; revenue: number; orders: number }>();
    data.orders
      .filter((o) => o.order_channel === 'b2b' && isWithinRange(o.created_at, period.range) && (o.status !== 'cancelled'))
      .forEach((o) => {
        const key = o.company_name || '—';
        const existing = map.get(key) || { company: key, revenue: 0, orders: 0 };
        existing.revenue += Number(o.total_amount) || 0;
        existing.orders += 1;
        map.set(key, existing);
      });
    return Array.from(map.values()).sort((a, b) => b.revenue - a.revenue);
  }, [data.orders, period.range]);

  // Coût des portefeuilles offerts expédiés sur la période — voir
  // ESTIMATED_GIFT_WALLET_UNIT_COST (aucun coût réel unitaire en base,
  // valeur indicative).
  const giftsShippedQty = useMemo(
    () => data.giftRewards.filter((g) => g.status === 'shipped' && isWithinRange(g.created_at, period.range)).reduce((s, g) => s + g.quantity, 0),
    [data.giftRewards, period.range]
  );
  const giftsCostEstimate = giftsShippedQty * ESTIMATED_GIFT_WALLET_UNIT_COST;
  const netAfterGifts = current.margin - giftsCostEstimate;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <AccountingKpiCard
          label="CA Réalisé (B2B)"
          value={EUR(current.revenue)}
          icon={Handshake}
          tone="green"
          hint="Commandes B2B + missions de sourcing validées"
          deltaMoM={mom ? pct(current.revenue, mom.revenue) : undefined}
          deltaYoY={yoy ? pct(current.revenue, yoy.revenue) : undefined}
        />
        <AccountingKpiCard
          label="Marge brute B2B"
          value={EUR(current.margin)}
          icon={PiggyBank}
          tone={current.margin >= 0 ? 'green' : 'red'}
          hint={current.marginRate !== null ? `Taux : ${current.marginRate.toFixed(1)}%` : undefined}
          deltaMoM={mom ? pct(current.margin, mom.margin) : undefined}
          deltaYoY={yoy ? pct(current.margin, yoy.margin) : undefined}
        />
        <AccountingKpiCard label="Volume de pièces" value={String(piecesCount)} icon={Package} />
        <AccountingKpiCard
          label="Panier moyen revendeur"
          value={EUR(current.averageBasket)}
          icon={DollarSign}
          deltaMoM={mom ? pct(current.averageBasket, mom.averageBasket) : undefined}
          deltaYoY={yoy ? pct(current.averageBasket, yoy.averageBasket) : undefined}
        />
      </div>

      <Card>
        <CardHeader><h3 className="text-base font-semibold text-gray-900 flex items-center gap-2"><Wallet className="h-4 w-4 text-amber-500" /> Encours & Avances</h3></CardHeader>
        <CardContent>
          <p className="text-sm text-gray-500 mb-4">
            {activeAdvances.length} avance{activeAdvances.length > 1 ? 's' : ''} active{activeAdvances.length > 1 ? 's' : ''} en attente de clôture — encaissées mais pas encore converties en CA.
          </p>
          {activeAdvances.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-2">Aucune avance en cours</p>
          ) : (
            <div className="space-y-2">
              {activeAdvances.map((m) => (
                <div key={m.id} className="flex items-center justify-between p-3 bg-amber-50/60 border border-amber-100 rounded-lg">
                  <span className="text-sm text-gray-800">{m.company_name}</span>
                  <span className="text-sm font-semibold text-amber-700">{EUR(m.advance_amount)}</span>
                </div>
              ))}
              <div className="flex items-center justify-between pt-2 border-t border-gray-100 mt-2">
                <span className="text-sm font-medium text-gray-900">Total encours</span>
                <span className="text-sm font-bold text-amber-700">{EUR(activeAdvancesTotal)}</span>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><h3 className="text-base font-semibold text-gray-900">Répartition par entreprise cliente</h3></CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="text-left py-2.5 px-4 font-medium text-gray-500 text-xs">Entreprise</th>
                  <th className="text-right py-2.5 px-4 font-medium text-gray-500 text-xs">Commandes</th>
                  <th className="text-right py-2.5 px-4 font-medium text-gray-500 text-xs">CA</th>
                  <th className="text-right py-2.5 px-4 font-medium text-gray-500 text-xs">Part du CA B2B</th>
                </tr>
              </thead>
              <tbody>
                {byCompany.length === 0 ? (
                  <tr><td colSpan={4} className="py-6 text-center text-gray-400 text-sm">Aucune commande B2B sur la période</td></tr>
                ) : (
                  byCompany.map((c) => (
                    <tr key={c.company} className="border-b border-gray-50 hover:bg-gray-50">
                      <td className="py-2.5 px-4 text-sm text-gray-900">{c.company}</td>
                      <td className="py-2.5 px-4 text-right text-sm text-gray-600 tabular-nums">{c.orders}</td>
                      <td className="py-2.5 px-4 text-right text-sm font-medium text-gray-900 tabular-nums">{EUR(c.revenue)}</td>
                      <td className="py-2.5 px-4 text-right text-sm text-gray-600 tabular-nums">
                        {current.revenue > 0 ? `${((c.revenue / current.revenue) * 100).toFixed(1)}%` : '—'}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><h3 className="text-base font-semibold text-gray-900 flex items-center gap-2"><Gift className="h-4 w-4 text-amber-500" /> Rentabilité nette après portefeuilles offerts</h3></CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <p className="text-xs text-gray-500">Marge brute B2B</p>
              <p className="text-lg font-semibold text-gray-900 mt-1">{EUR(current.margin)}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Coût estimé portefeuilles expédiés ({giftsShippedQty})</p>
              <p className="text-lg font-semibold text-red-600 mt-1">−{EUR(giftsCostEstimate)}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Marge nette estimée</p>
              <p className={`text-lg font-semibold mt-1 ${netAfterGifts >= 0 ? 'text-green-600' : 'text-red-600'}`}>{EUR(netAfterGifts)}</p>
            </div>
          </div>
          <p className="text-xs text-gray-400 mt-3">
            Coût unitaire indicatif de {EUR(ESTIMATED_GIFT_WALLET_UNIT_COST)}/portefeuille — aucun coût réel n'est enregistré en base, valeur estimative à ajuster.
          </p>
        </CardContent>
      </Card>
    </div>
  );
};

export default B2BTab;
