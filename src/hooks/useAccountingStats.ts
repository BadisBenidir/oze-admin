import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'

/**
 * Agrège les données financières réelles pour la page Comptabilité.
 *
 * Définitions (approximation de gestion — voir légende UI) :
 *   CA          = commandes valides (orders.total_amount, hors cancelled/pending/refunded)
 *                 + ventes Live enchères (products.sale_price où status = 'sold-auction')
 *   COGS        = somme purchase_price des produits vendus (sold-online/-other-platform/-display/-auction)
 *   Marge brute = CA − COGS
 *   Bénéfice net = Marge brute − Dépenses
 */
export interface MonthlyRow {
  ym: string // 'YYYY-MM'
  revenue: number
  expenses: number
  result: number
}

export interface AccountingStats {
  onlineRevenue: number
  auctionRevenue: number
  ca: number
  cogs: number
  grossMargin: number
  expensesTotal: number
  netProfit: number
  ordersCount: number
  auctionCount: number
  averageBasket: number
  // Paiements
  refundedTotal: number
  pendingTotal: number
  monthly: MonthlyRow[]
}

const SOLD_STATUSES = ['sold-online', 'sold-other-platform', 'sold-display', 'sold-auction']
const VALID_ORDER = (status: string) => !['cancelled', 'pending', 'refunded'].includes(status)
const ym = (iso: string) => (iso || '').slice(0, 7)

interface UseAccountingStatsResult {
  stats: AccountingStats | null
  loading: boolean
  error: string | null
  refresh: () => Promise<void>
}

export const useAccountingStats = (isAuthenticated: boolean = false): UseAccountingStatsResult => {
  const [stats, setStats] = useState<AccountingStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchStats = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)

      const [ordersRes, productsRes, expensesRes] = await Promise.all([
        supabase.from('orders').select('total_amount, status, payment_status, created_at'),
        supabase.from('products').select('sale_price, purchase_price, status, updated_at'),
        supabase.from('expenses').select('amount, spent_at'),
      ])

      if (ordersRes.error) throw new Error(ordersRes.error.message)
      if (productsRes.error) throw new Error(productsRes.error.message)
      if (expensesRes.error) throw new Error(expensesRes.error.message)

      const orders = ordersRes.data || []
      const products = productsRes.data || []
      const expenses = expensesRes.data || []

      // Commandes valides (CA en ligne).
      const validOrders = orders.filter((o: any) => VALID_ORDER(o.status))
      const onlineRevenue = validOrders.reduce((s: number, o: any) => s + Number(o.total_amount || 0), 0)
      const ordersCount = validOrders.length

      // Remboursements / en attente (vue paiements).
      const refundedTotal = orders
        .filter((o: any) => o.payment_status === 'refunded' || o.status === 'refunded')
        .reduce((s: number, o: any) => s + Number(o.total_amount || 0), 0)
      const pendingTotal = orders
        .filter((o: any) => o.status === 'pending')
        .reduce((s: number, o: any) => s + Number(o.total_amount || 0), 0)

      // Ventes Live enchères.
      const auctionSold = products.filter((p: any) => p.status === 'sold-auction')
      const auctionRevenue = auctionSold.reduce((s: number, p: any) => s + Number(p.sale_price || 0), 0)
      const auctionCount = auctionSold.length

      // COGS : coût d'achat de tous les articles vendus.
      const cogs = products
        .filter((p: any) => SOLD_STATUSES.includes(p.status))
        .reduce((s: number, p: any) => s + Number(p.purchase_price || 0), 0)

      const expensesTotal = expenses.reduce((s: number, e: any) => s + Number(e.amount || 0), 0)

      const ca = onlineRevenue + auctionRevenue
      const grossMargin = ca - cogs
      const netProfit = grossMargin - expensesTotal
      const averageBasket = ordersCount > 0 ? onlineRevenue / ordersCount : 0

      // Série mensuelle : CA (commandes par created_at + ventes Live par updated_at) et dépenses (spent_at).
      const monthlyMap = new Map<string, { revenue: number; expenses: number }>()
      const bump = (key: string, field: 'revenue' | 'expenses', value: number) => {
        if (!key) return
        const cur = monthlyMap.get(key) || { revenue: 0, expenses: 0 }
        cur[field] += value
        monthlyMap.set(key, cur)
      }
      validOrders.forEach((o: any) => bump(ym(o.created_at), 'revenue', Number(o.total_amount || 0)))
      auctionSold.forEach((p: any) => bump(ym(p.updated_at), 'revenue', Number(p.sale_price || 0)))
      expenses.forEach((e: any) => bump(ym(e.spent_at), 'expenses', Number(e.amount || 0)))

      const monthly: MonthlyRow[] = Array.from(monthlyMap.entries())
        .map(([key, v]) => ({ ym: key, revenue: v.revenue, expenses: v.expenses, result: v.revenue - v.expenses }))
        .sort((a, b) => b.ym.localeCompare(a.ym))

      setStats({
        onlineRevenue,
        auctionRevenue,
        ca,
        cogs,
        grossMargin,
        expensesTotal,
        netProfit,
        ordersCount,
        auctionCount,
        averageBasket,
        refundedTotal,
        pendingTotal,
        monthly,
      })
    } catch (err) {
      console.error('Erreur chargement stats comptables:', err)
      setError(err instanceof Error ? err.message : 'Erreur inconnue')
    } finally {
      setLoading(false)
    }
  }, [])

  const refresh = useCallback(async () => {
    await fetchStats()
  }, [fetchStats])

  useEffect(() => {
    if (!isAuthenticated) {
      setLoading(false)
      return
    }
    fetchStats()
  }, [isAuthenticated, fetchStats])

  return { stats, loading, error, refresh }
}