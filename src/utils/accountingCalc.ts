import { AccountingOrder, AccountingLiveSale, AccountingManualRevenue, AccountingRawData, AccountingSubscriptionPayment, isOrderPaid } from '../hooks/useAccountingRawData';
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

/** CA des abonnements Club B2B (pass) sur une plage — aucun coût d'achat. */
export const computeSubscriptionTotals = (payments: AccountingSubscriptionPayment[], range: DateRange): ChannelTotals => {
  const scoped = payments.filter((p) => isWithinRange(p.paid_at, range));
  if (scoped.length === 0) return EMPTY_TOTALS;
  const revenue = scoped.reduce((sum, p) => sum + p.amount, 0);
  return {
    revenue,
    cogs: 0,
    margin: revenue,
    marginRate: revenue > 0 ? 100 : null,
    count: scoped.length,
    averageBasket: revenue / scoped.length,
  };
};

/** CA d'abonnement par source sur une plage (toutes les sources connues, même à 0). */
export const computeSubscriptionBySource = (payments: AccountingSubscriptionPayment[], sources: string[], range: DateRange): { source: string; revenue: number }[] => {
  const totals = new Map<string, number>(sources.map((s) => [s, 0]));
  for (const p of payments) if (isWithinRange(p.paid_at, range)) totals.set(p.source, (totals.get(p.source) || 0) + p.amount);
  return [...totals.entries()].map(([source, revenue]) => ({ source, revenue }));
};

/** Frais d'expédition Sendcloud HT de la période (0239). */
export const computeShippingCharges = (charges: { date: string; amount: number }[], range: DateRange): number =>
  (charges || []).filter((c) => isWithinRange(c.date, range)).reduce((s, c) => s + c.amount, 0);

/** CA des frais de livraison payés par les clients sur une plage (sans coût
 * propre : le coût est la facture Sendcloud ; non compté dans les ventes). */
export const computeDeliveryTotals = (payments: { date: string; amount: number }[], range: DateRange): ChannelTotals => {
  const revenue = (payments || []).filter((p) => isWithinRange(p.date, range)).reduce((s, p) => s + p.amount, 0);
  return { revenue, cogs: 0, margin: revenue, marginRate: revenue > 0 ? 100 : null, count: 0, averageBasket: 0 };
};

/** Autres revenus saisis à la main (0275) sur une plage : coût d'achat =
 * purchase_price si renseigné (vente d'article), 0 sinon (prestation). */
export const manualRevenueDate = (r: { revenue_date: string }) => `${r.revenue_date}T12:00:00`;

export const computeManualRevenueTotals = (revenues: AccountingManualRevenue[], range: DateRange): ChannelTotals => {
  const rows = (revenues || []).filter((r) => isWithinRange(manualRevenueDate(r), range));
  const revenue = rows.reduce((s, r) => s + r.amount, 0);
  const cogs = rows.reduce((s, r) => s + (r.purchase_price || 0), 0);
  const margin = revenue - cogs;
  return {
    revenue,
    cogs,
    margin,
    marginRate: revenue > 0 ? (margin / revenue) * 100 : null,
    count: rows.length,
    averageBasket: rows.length > 0 ? revenue / rows.length : 0,
  };
};

/** Totaux après déduction des frais d'expédition (marge nette des envois). */
export const withShipping = (t: ChannelTotals, shipping: number): ChannelTotals => {
  const margin = t.margin - shipping;
  return { ...t, margin, marginRate: t.revenue > 0 ? (margin / t.revenue) * 100 : null };
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
  subscriptions: number;
  /** CA d'abonnement du mois par source (clients, communautés, partenaires). */
  subsBySource: Record<string, number>;
  total: number;
  cogs: number;
  /** Frais d'expédition Sendcloud HT du mois (0239), déduits de la marge. */
  shipping: number;
  /** Frais de livraison payés par les clients (demandes de livraison B2B). */
  deliveries: number;
  /** Autres revenus saisis à la main (0275). */
  other: number;
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

  const rows = new Map<string, MonthlyChannelRow>(keys.map((k) => [k, { ym: k, web: 0, b2b: 0, live: 0, subscriptions: 0, subsBySource: {}, total: 0, cogs: 0, shipping: 0, deliveries: 0, other: 0, margin: 0 }]));

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

  (data.subscriptionPayments || []).forEach((p) => {
    const row = rows.get(monthKey(p.paid_at));
    if (!row) return;
    row.subscriptions += p.amount;
    row.subsBySource[p.source] = (row.subsBySource[p.source] || 0) + p.amount;
    row.total += p.amount;
    row.margin += p.amount;
  });

  (data.deliveryPayments || []).forEach((d) => {
    const row = rows.get(monthKey(d.date));
    if (!row) return;
    row.deliveries += d.amount;
    row.total += d.amount;
    row.margin += d.amount;
  });

  (data.manualRevenues || []).forEach((r) => {
    const row = rows.get(monthKey(manualRevenueDate(r)));
    if (!row) return;
    row.other += r.amount;
    row.total += r.amount;
    row.cogs += r.purchase_price || 0;
    row.margin += r.amount - (r.purchase_price || 0);
  });

  (data.shippingCharges || []).forEach((c) => {
    const row = rows.get(monthKey(c.date));
    if (!row) return;
    row.shipping += c.amount;
    row.margin -= c.amount;
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

/** Frais externes saisis à la main (Comptabilité → Frais externes, 0274).
 * spent_at est une date sans heure : lue à midi pour ne jamais glisser de
 * jour avec le fuseau. */
export const expenseDate = (e: { spent_at: string }) => new Date(`${e.spent_at}T12:00:00`);

export const expensesInRange = <T extends { spent_at: string }>(expenses: T[], range: DateRange): T[] =>
  (expenses || [])
    .filter((e) => {
      const t = expenseDate(e).getTime();
      return t >= range.start.getTime() && t <= range.end.getTime();
    })
    .sort((a, b) => b.spent_at.localeCompare(a.spent_at));

type ChargeLike = { spent_at: string; amount: number; category: string | null; review_status?: string };

/** Achat de marchandise : déjà dans le coût d'achat produits, jamais une charge externe. */
export const isGoodsPurchase = (category: string | null) => category === 'Achat marchandise' || category === 'achat-marchandise';

/** Charge externe comptée (0276) : validée (ni « À vérifier » ni exclue) et hors achat de marchandise. */
export const isCountedCharge = (e: { category: string | null; review_status?: string }) =>
  (e.review_status ?? 'validated') === 'validated' && !isGoodsPurchase(e.category);

export const computeExpensesTotal = (expenses: ChargeLike[], range: DateRange): number =>
  expensesInRange(expenses, range).filter(isCountedCharge).reduce((s, e) => s + (Number(e.amount) || 0), 0);

/** Charges externes comptées par mois (clé YYYY-MM). */
export const expensesByMonth = (expenses: ChargeLike[]): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const e of (expenses || []).filter(isCountedCharge)) {
    const k = e.spent_at.slice(0, 7);
    out[k] = (out[k] || 0) + (Number(e.amount) || 0);
  }
  return out;
};
