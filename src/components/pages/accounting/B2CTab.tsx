import React, { useMemo, useState } from 'react';
import { Globe, Receipt, DollarSign, CreditCard, Tag } from 'lucide-react';
import { Card, CardContent, CardHeader } from '../../ui/Card';
import { Badge } from '../../ui/Badge';
import { AccountingKpiCard } from './AccountingKpiCard';
import { AccountingRawData, AccountingOrder, isOrderPaid } from '../../../hooks/useAccountingRawData';
import { AccountingPeriod, isWithinRange } from '../../../utils/accountingPeriods';
import { computeChannelTotals, computeTopBrands, estimateGatewayFees } from '../../../utils/accountingCalc';

const EUR = (n: number) => (Number(n) || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
const pct = (current: number, previous: number): number | null => (previous ? ((current - previous) / Math.abs(previous)) * 100 : null);
const PAGE_SIZE = 20;

const orderMargin = (o: AccountingOrder): number =>
  o.order_items.filter((i) => i.status === 'active').reduce((s, i) => s + (Number(i.line_total) || 0) - (Number(i.product_snapshot?.purchase_price) || 0), 0);

interface B2CTabProps {
  data: AccountingRawData;
  period: AccountingPeriod;
}

export const B2CTab: React.FC<B2CTabProps> = ({ data, period }) => {
  const [page, setPage] = useState(0);

  const scopedOrders = useMemo(
    () => data.orders.filter((o) => o.order_channel === 'web' && isWithinRange(o.created_at, period.range)).sort((a, b) => b.created_at.localeCompare(a.created_at)),
    [data.orders, period.range]
  );

  const current = useMemo(() => computeChannelTotals(data.orders, 'web', period.range), [data.orders, period.range]);
  const mom = period.momRange ? computeChannelTotals(data.orders, 'web', period.momRange) : null;
  const yoy = period.yoyRange ? computeChannelTotals(data.orders, 'web', period.yoyRange) : null;

  const topBrands = useMemo(() => computeTopBrands(data.orders, 'web', period.range, 8), [data.orders, period.range]);
  const gatewayFees = useMemo(() => estimateGatewayFees(current.revenue, current.count), [current]);

  const totalPages = Math.max(1, Math.ceil(scopedOrders.length / PAGE_SIZE));
  const pageOrders = scopedOrders.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <AccountingKpiCard
          label="CA Web (B2C)"
          value={EUR(current.revenue)}
          icon={Globe}
          tone="green"
          deltaMoM={mom ? pct(current.revenue, mom.revenue) : undefined}
          deltaYoY={yoy ? pct(current.revenue, yoy.revenue) : undefined}
        />
        <AccountingKpiCard
          label="Commandes"
          value={String(current.count)}
          icon={Receipt}
          deltaMoM={mom ? pct(current.count, mom.count) : undefined}
          deltaYoY={yoy ? pct(current.count, yoy.count) : undefined}
        />
        <AccountingKpiCard
          label="Panier moyen"
          value={EUR(current.averageBasket)}
          icon={DollarSign}
          deltaMoM={mom ? pct(current.averageBasket, mom.averageBasket) : undefined}
          deltaYoY={yoy ? pct(current.averageBasket, yoy.averageBasket) : undefined}
        />
        <AccountingKpiCard
          label="Frais de passerelle (estimés)"
          value={EUR(gatewayFees)}
          icon={CreditCard}
          tone="red"
          hint="Estimation Stripe (1,5% + 0,25€/transaction) — aucune donnée de frais réelle en base"
        />
      </div>

      <Card>
        <CardHeader><h3 className="text-base font-semibold text-gray-900 flex items-center gap-2"><Tag className="h-4 w-4" /> Top marques vendues</h3></CardHeader>
        <CardContent>
          {topBrands.length === 0 ? (
            <p className="text-sm text-gray-500 text-center py-4">Aucune vente sur la période</p>
          ) : (
            <div className="space-y-3">
              {topBrands.map((b) => {
                const widthPct = topBrands[0].revenue > 0 ? (b.revenue / topBrands[0].revenue) * 100 : 0;
                return (
                  <div key={b.brand}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm text-gray-700">{b.brand}</span>
                      <span className="text-sm font-medium text-gray-900">{EUR(b.revenue)} · {b.count} pièce{b.count > 1 ? 's' : ''}</span>
                    </div>
                    <div className="w-full bg-gray-100 rounded-full h-2">
                      <div className="bg-blue-500 h-2 rounded-full" style={{ width: `${widthPct}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex items-center justify-between">
          <h3 className="text-base font-semibold text-gray-900">Commandes web de la période ({scopedOrders.length})</h3>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="text-left py-2.5 px-4 font-medium text-gray-500 text-xs">Date</th>
                  <th className="text-left py-2.5 px-4 font-medium text-gray-500 text-xs">N° Commande</th>
                  <th className="text-left py-2.5 px-4 font-medium text-gray-500 text-xs">Client</th>
                  <th className="text-right py-2.5 px-4 font-medium text-gray-500 text-xs">Montant</th>
                  <th className="text-right py-2.5 px-4 font-medium text-gray-500 text-xs">Marge estimée</th>
                  <th className="text-left py-2.5 px-4 font-medium text-gray-500 text-xs">Statut</th>
                </tr>
              </thead>
              <tbody>
                {pageOrders.length === 0 ? (
                  <tr><td colSpan={6} className="py-6 text-center text-gray-400 text-sm">Aucune commande sur la période</td></tr>
                ) : (
                  pageOrders.map((o) => (
                    <tr key={o.id} className="border-b border-gray-50 hover:bg-gray-50">
                      <td className="py-2.5 px-4 text-sm text-gray-600">{new Date(o.created_at).toLocaleDateString('fr-FR')}</td>
                      <td className="py-2.5 px-4 font-mono text-sm text-gray-900">{o.order_number}</td>
                      <td className="py-2.5 px-4 text-sm text-gray-900">{o.customer_name || '—'}</td>
                      <td className="py-2.5 px-4 text-right text-sm font-medium text-gray-900 tabular-nums">{EUR(o.total_amount)}</td>
                      <td className="py-2.5 px-4 text-right text-sm text-gray-600 tabular-nums">{EUR(orderMargin(o))}</td>
                      <td className="py-2.5 px-4">
                        <Badge variant={o.status === 'cancelled' ? 'danger' : isOrderPaid(o) ? 'success' : 'warning'}>
                          {o.status === 'cancelled' ? 'Annulée' : isOrderPaid(o) ? 'Encaissée' : 'En attente'}
                        </Badge>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          {totalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100">
              <span className="text-xs text-gray-500">Page {page + 1} / {totalPages}</span>
              <div className="flex gap-2">
                <button
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                  disabled={page === 0}
                  className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg disabled:opacity-40 hover:bg-gray-50"
                >
                  Précédent
                </button>
                <button
                  onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                  disabled={page >= totalPages - 1}
                  className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg disabled:opacity-40 hover:bg-gray-50"
                >
                  Suivant
                </button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default B2CTab;
