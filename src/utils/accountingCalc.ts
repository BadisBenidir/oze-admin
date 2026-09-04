import { AccountingOrder, AccountingLiveSale, AccountingRawData, isOrderPaid } from '../hooks/useAccountingRawData';
import { DateRange, isWithinRange, monthKey } from './accountingPeriods';

export interface ChannelTotals {
  revenue: number;
  cogs: number;
  margin: number;
  marginRate: number | null;
  count: number;
  averageBasket: number;
}

const EMPTY_TOTALS: ChannelTotals = { revenue: 0, cogs: 0, margin: 0, marginRate: null, count: 0, averageBasket: 0 };

const orderCogs = (order: AccountingOrder): number =>
  order.order_items
    .filter((i) => i.status === 'active')
    .reduce((sum, i) => sum + (Number(i.product_snapshot?.purchase_price) || 0) * (i.quantity || 1), 0);

/** Totaux d'un canal ('web' ou 'b2b') sur une plage donnée — seules les
 * commandes réellement encaissées comptent (isOrderPaid), même prédicat que
 * partout ailleurs dans le module comptable. */
export const computeChannelTotals = (orders: AccountingOrder[], channel: 'web' | 'b2b', range: DateRange): ChannelTotals => {
  const scoped = orders.filter((o) => o.order_channel === channel && isWithinRange(o.created_at, range) && isOrderPaid(o));
  if (scoped.length === 0) return EMPTY_TOTALS;

  const revenue = scoped.reduce((sum, o) => sum + (Number(o.total_amount) || 0), 0);
  const cogs = scoped.reduce((sum, o) => sum + orderCogs(o), 0);
  const margin = revenue - cogs;
  return {
    revenue,
    cogs,
    margin,
    marginRate: revenue > 0 ? (margin / revenue) * 100 : null,
    count: scoped.length,
    averageBasket: revenue / scoped.length,
  };
};

export const computeLiveTotals = (liveSales: AccountingLiveSale[], range: DateRange): ChannelTotals => {
  const scoped = liveSales.filter((p) => isWithinRange(p.sold_at, range));
  if (scoped.length === 0) return EMPTY_TOTALS;

  const revenue = scoped.reduce((sum, p) => sum + p.sale_price, 0);
  const cogs = scoped.reduce((sum, p) => sum + (p.purchase_price || 0), 0);
  const margin = revenue - cogs;
  return {
    revenue,
    cogs,
    margin,
    marginRate: revenue > 0 ? (margin / revenue) * 100 : null,
    count: scoped.length,
    averageBasket: revenue / scoped.length,
  };
};

export const combineTotals = (...parts: ChannelTotals[]): ChannelTotals => {
  const revenue = parts.reduce((s, p) => s + p.revenue, 0);
  const cogs = parts.reduce((s, p) => s + p.cogs, 0);
  const count = parts.reduce((s, p) => s + p.count, 0);
  const margin = revenue - cogs;
  return {
    revenue,
    cogs,
    margin,
    marginRate: revenue > 0 ? (margin / revenue) * 100 : null,
    count,
    averageBasket: count > 0 ? revenue / count : 0,
  };
};

export interface MonthlyChannelRow {
  ym: string;
  web: number;
  b2b: number;
  live: number;
  total: number;
  cogs: number;
  margin: number;
}

/** Premier mois d'activité réelle de la société — les mois antérieurs sont
 * exclus de la série mensuelle (jamais affichés, pas juste masqués à
 * zéro) : rien à comparer avant que l'entreprise n'existe. */
export const COMPANY_ACTIVITY_START_MONTH = '2026-05';

/** Série mensuelle CA par canal + coût/marge, sur `months` mois glissants
 * (le plus récent en dernier), jamais avant COMPANY_ACTIVITY_START_MONTH —
 * alimente le graphique d'évolution et le tableau comparatif du Dashboard
 * Global. */
export const computeMonthlySeries = (data: AccountingRawData, months: number): MonthlyChannelRow[] => {
  const now = new Date();
  const keys: string[] = [];
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    if (key >= COMPANY_ACTIVITY_START_MONTH) keys.push(key);
  }

  const rows = new Map<string, MonthlyChannelRow>(keys.map((k) => [k, { ym: k, web: 0, b2b: 0, live: 0, total: 0, cogs: 0, margin: 0 }]));

  data.orders.filter(isOrderPaid).forEach((o) => {
    const key = monthKey(o.created_at);
    const row = rows.get(key);
    if (!row) return;
    const revenue = Number(o.total_amount) || 0;
    const cogs = orderCogs(o);
    if (o.order_channel === 'web') row.web += revenue;
    else row.b2b += revenue;
    row.total += revenue;
    row.cogs += cogs;
    row.margin += revenue - cogs;
  });

  data.liveSales.forEach((p) => {
    const key = monthKey(p.sold_at);
    const row = rows.get(key);
    if (!row) return;
    row.live += p.sale_price;
    row.total += p.sale_price;
    row.cogs += p.purchase_price || 0;
    row.margin += p.sale_price - (p.purchase_price || 0);
  });

  return keys.map((k) => rows.get(k)!);
};

export interface BrandTotal {
  brand: string;
  revenue: number;
  count: number;
}

/** Top marques vendues sur une plage donnée, pour un canal — résolu via la
 * fiche produit ACTUELLE (product.brand), pas via product_snapshot (qui ne
 * conserve que brand_id, jamais le nom résolu) : imprécis seulement si la
 * marque d'un produit est réattribuée après coup, cas marginal. */
export const computeTopBrands = (orders: AccountingOrder[], channel: 'web' | 'b2b', range: DateRange, limit: number): BrandTotal[] => {
  const totals = new Map<string, BrandTotal>();
  orders
    .filter((o) => o.order_channel === channel && isWithinRange(o.created_at, range) && isOrderPaid(o))
    .forEach((o) => {
      o.order_items
        .filter((i) => i.status === 'active')
        .forEach((i) => {
          const brand = i.product?.brand?.name || i.product_snapshot?.name?.split(' ')[0] || 'Autre';
          const existing = totals.get(brand) || { brand, revenue: 0, count: 0 };
          existing.revenue += Number(i.line_total) || 0;
          existing.count += 1;
          totals.set(brand, existing);
        });
    });
  return Array.from(totals.values()).sort((a, b) => b.revenue - a.revenue).slice(0, limit);
};

/** Coût estimé (indicatif) d'un portefeuille offert — AUCUNE donnée réelle
 * n'existe dans ce repo pour ce coût (jamais saisi nulle part) : valeur par
 * défaut raisonnable, à ajuster si un jour renseignée quelque part. Toujours
 * affichée comme une estimation dans l'UI, jamais comme un montant réel. */
export const ESTIMATED_GIFT_WALLET_UNIT_COST = 15;

/** Estimation des frais de passerelle de paiement (Stripe) — AUCUNE donnée
 * réelle de frais n'existe dans ce repo (ni colonne, ni webhook qui la
 * capture) : taux standard Stripe EU (1.5% + 0.25€/transaction) appliqué au
 * nombre et montant de commandes payées par carte, à titre indicatif
 * uniquement. Alma n'est pas intégré dans ce repo (aucune trace de code) :
 * pas d'estimation le concernant. */
export const estimateGatewayFees = (revenue: number, paidOrdersCount: number): number =>
  revenue * 0.015 + paidOrdersCount * 0.25;
