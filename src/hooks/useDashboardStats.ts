import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

export interface DashboardStats {
  totalProducts: number
  productsForSale: number
  soldProducts: number
  draftProducts: number
  totalValue: number
  averagePrice: number
  totalPurchaseValue: number
  totalSaleValue: number
  potentialMargin: number
  averagePurchasePrice: number
  categoriesCount: number
  brandsCount: number
  recentProducts: Array<{
    id: string
    name: string
    brand_name: string | null
    sale_price: number
    created_at: string
  }>
  topCategories: Array<{
    category_id: string
    category_name: string
    product_count: number
  }>
  topBrands: Array<{
    brand_id: string
    brand_name: string
    product_count: number
  }>
  statusBreakdown: Array<{
    status: string
    count: number
    percentage: number
    totalPurchaseValue: number
    totalSaleValue: number
    potentialMargin: number
    averagePurchasePrice: number
    averageSalePrice: number
  }>
}

interface UseDashboardStatsResult {
  stats: DashboardStats | null
  loading: boolean
  error: string | null
  refreshStats: () => Promise<void>
}

export const useDashboardStats = (isAuthenticated: boolean = false): UseDashboardStatsResult => {
  const [stats, setStats] = useState<DashboardStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchStats = async () => {
    try {
      setLoading(true)
      setError(null)

      // Statistiques générales des produits
      const { data: productsData, error: productsError } = await supabase
        .from('products')
        .select(`
          id,
          name,
          sale_price,
          purchase_price,
          status,
          created_at,
          brand_id,
          category_id,
          brands(name),
          categories(name)
        `)

      if (productsError) throw productsError

      // Compter les catégories
      const { count: categoriesCount, error: categoriesError } = await supabase
        .from('categories')
        .select('*', { count: 'exact', head: true })

      if (categoriesError) throw categoriesError

      // Compter les marques
      const { count: brandsCount, error: brandsError } = await supabase
        .from('brands')
        .select('*', { count: 'exact', head: true })

      if (brandsError) throw brandsError

      // Calculer les statistiques
      const products = productsData || []
      const totalProducts = products.length
      const productsForSale = products.filter(p => 
        p.status === 'for-sale-online' || p.status === 'for-sale-other-platform'
      ).length
      const soldProducts = products.filter(p =>
        p.status === 'sold-online' || p.status === 'sold-other-platform' || p.status === 'sold-auction'
      ).length
      const draftProducts = products.filter(p => p.status === 'draft').length

      // Valeur totale du stock (produits en vente)
      const totalValue = products
        .filter(p => p.status === 'for-sale-online' || p.status === 'for-sale-other-platform')
        .reduce((sum, p) => sum + (p.sale_price || 0), 0)

      // Prix moyen
      const averagePrice = totalProducts > 0 
        ? products.reduce((sum, p) => sum + (p.sale_price || 0), 0) / totalProducts
        : 0

      // Calculs pour les marges
      const productsWithPurchasePrice = products.filter(p => p.purchase_price !== null && p.purchase_price > 0)
      
      // Valeur totale des achats (tous produits avec prix d'achat)
      const totalPurchaseValue = productsWithPurchasePrice
        .reduce((sum, p) => sum + (p.purchase_price || 0), 0)

      // Valeur totale des prix de vente (tous produits avec prix d'achat)
      const totalSaleValue = productsWithPurchasePrice
        .reduce((sum, p) => sum + (p.sale_price || 0), 0)

      // Marge potentielle en euros
      const potentialMargin = totalSaleValue - totalPurchaseValue

      // Prix d'achat moyen
      const averagePurchasePrice = productsWithPurchasePrice.length > 0
        ? totalPurchaseValue / productsWithPurchasePrice.length
        : 0

      // Produits récents (5 derniers)
      const recentProducts = products
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
        .slice(0, 5)
        .map(p => ({
          id: p.id,
          name: p.name,
          brand_name: (p.brands as any)?.name || null,
          sale_price: p.sale_price,
          created_at: p.created_at
        }))

      // Top catégories
      const categoryStats = new Map<string, { name: string, count: number }>()
      products.forEach(p => {
        if (p.category_id && p.categories) {
          const categoryName = (p.categories as any).name
          const current = categoryStats.get(p.category_id) || { name: categoryName, count: 0 }
          categoryStats.set(p.category_id, { ...current, count: current.count + 1 })
        }
      })

      const topCategories = Array.from(categoryStats.entries())
        .map(([id, data]) => ({
          category_id: id,
          category_name: data.name,
          product_count: data.count
        }))
        .sort((a, b) => b.product_count - a.product_count)
        .slice(0, 5)

      // Top marques
      const brandStats = new Map<string, { name: string, count: number }>()
      products.forEach(p => {
        if (p.brand_id && p.brands) {
          const brandName = (p.brands as any).name
          const current = brandStats.get(p.brand_id) || { name: brandName, count: 0 }
          brandStats.set(p.brand_id, { ...current, count: current.count + 1 })
        }
      })

      const topBrands = Array.from(brandStats.entries())
        .map(([id, data]) => ({
          brand_id: id,
          brand_name: data.name,
          product_count: data.count
        }))
        .sort((a, b) => b.product_count - a.product_count)
        .slice(0, 5)

      // Répartition par statut avec analyse financière
      const statusStats = new Map<string, {
        count: number
        products: typeof products
      }>()
      
      products.forEach(p => {
        const current = statusStats.get(p.status) || { count: 0, products: [] }
        statusStats.set(p.status, { 
          count: current.count + 1, 
          products: [...current.products, p] 
        })
      })

      const statusBreakdown = Array.from(statusStats.entries())
        .map(([status, data]) => {
          const productsWithPurchasePrice = data.products.filter(p => p.purchase_price !== null && p.purchase_price > 0)
          
          const totalPurchaseValue = productsWithPurchasePrice
            .reduce((sum, p) => sum + (p.purchase_price || 0), 0)
          
          const totalSaleValue = productsWithPurchasePrice
            .reduce((sum, p) => sum + (p.sale_price || 0), 0)
          
          const potentialMargin = totalSaleValue - totalPurchaseValue
          
          const averagePurchasePrice = productsWithPurchasePrice.length > 0
            ? totalPurchaseValue / productsWithPurchasePrice.length
            : 0
          
          const averageSalePrice = productsWithPurchasePrice.length > 0
            ? totalSaleValue / productsWithPurchasePrice.length
            : data.products.reduce((sum, p) => sum + (p.sale_price || 0), 0) / data.products.length
          
          return {
            status,
            count: data.count,
            percentage: totalProducts > 0 ? Math.round((data.count / totalProducts) * 100) : 0,
            totalPurchaseValue,
            totalSaleValue,
            potentialMargin,
            averagePurchasePrice,
            averageSalePrice
          }
        })
        .sort((a, b) => b.count - a.count)

      setStats({
        totalProducts,
        productsForSale,
        soldProducts,
        draftProducts,
        totalValue,
        averagePrice,
        totalPurchaseValue,
        totalSaleValue,
        potentialMargin,
        averagePurchasePrice,
        categoriesCount: categoriesCount || 0,
        brandsCount: brandsCount || 0,
        recentProducts,
        topCategories,
        topBrands,
        statusBreakdown
      })

    } catch (err) {
      console.error('Erreur lors du chargement des statistiques:', err)
      setError(err instanceof Error ? err.message : 'Erreur inconnue')
    } finally {
      setLoading(false)
    }
  }

  const refreshStats = async () => {
    await fetchStats()
  }

  useEffect(() => {
    if (!isAuthenticated) {
      setLoading(false)
      return
    }
    
    fetchStats()
  }, [isAuthenticated])

  return {
    stats,
    loading,
    error,
    refreshStats
  }
}