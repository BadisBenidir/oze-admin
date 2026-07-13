import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '../lib/supabase'

// Interface pour un produit
export interface Product {
  id: string
  product_code: string
  // Référence auto-générée « OZ-[MARQUE]-[NNN] » + code-barres (trigger BDD à la création).
  reference: string | null
  barcode: string | null
  name: string
  brand_id: string | null
  category_id: string | null
  genre: 'femme' | 'homme' | 'fille' | 'garcon' | null
  purchase_price: number | null
  sale_price: number
  weight: number | null
  images: string[]
  main_image_index: number
  condition: 'neuf' | 'excellent' | 'very-good' | 'good' | 'fair' | 'S' | 'A' | 'AB' | 'B' | 'BC' | 'C' | 'D'
  description: string | null
  defects: string | null
  colors: string[]
  material: string | null
  status: 'draft' | 'for-sale-online' | 'for-sale-other-platform' | 'sold-online' | 'sold-other-platform' | 'sold-display' | 'for-auction-live' | 'sold-auction' | 'for-sale-b2b' | 'reserved-b2b' | 'sold-b2b'
  serial_number: string | null
  internal_comments: string | null
  created_at: string
  updated_at: string
  // Relations
  brand?: { id: string, name: string }
  category?: { id: string, name: string }
}

export interface ProductFilters {
  search?: string
  categoryId?: string
  status?: string
  sortBy?: 'recent' | 'oldest' | 'price-asc' | 'price-desc'
}

interface UseProductsResult {
  products: Product[]
  loading: boolean
  error: string | null
  totalCount: number
  currentPage: number
  totalPages: number
  hasNextPage: boolean
  hasPreviousPage: boolean
  refreshProducts: () => Promise<void>
  setPage: (page: number) => void
  setFilters: (filters: ProductFilters) => void
  filters: ProductFilters
  deleteProduct: (id: string) => Promise<void>
}

const ITEMS_PER_PAGE = 20

export const useProducts = (isAuthenticated: boolean = false): UseProductsResult => {
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [totalCount, setTotalCount] = useState(0)
  const [currentPage, setCurrentPage] = useState(1)
  const [filters, setFiltersState] = useState<ProductFilters>({})
  const filtersRef = useRef<ProductFilters>({})

  const fetchProducts = useCallback(async (page: number = 1, currentFilters: ProductFilters = {}) => {
    try {
      setLoading(true)
      setError(null)

      const from = (page - 1) * ITEMS_PER_PAGE
      const to = from + ITEMS_PER_PAGE - 1

      let countQuery = supabase
        .from('products')
        .select('*', { count: 'exact', head: true })

      if (currentFilters.search) {
        const searchTerm = currentFilters.search
        countQuery = countQuery.or('name.ilike.%' + searchTerm + '%,product_code.ilike.%' + searchTerm + '%')
      }
      if (currentFilters.categoryId) {
        countQuery = countQuery.eq('category_id', currentFilters.categoryId)
      }
      if (currentFilters.status) {
        countQuery = countQuery.eq('status', currentFilters.status)
      }

      const { count, error: countError } = await countQuery

      if (countError) {
        throw new Error(countError.message)
      }

      setTotalCount(count || 0)

      let dataQuery = supabase
        .from('products')
        .select('*, brand:brands(id, name), category:categories(id, name)')

      if (currentFilters.search) {
        const searchTerm = currentFilters.search
        dataQuery = dataQuery.or('name.ilike.%' + searchTerm + '%,product_code.ilike.%' + searchTerm + '%')
      }
      if (currentFilters.categoryId) {
        dataQuery = dataQuery.eq('category_id', currentFilters.categoryId)
      }
      if (currentFilters.status) {
        dataQuery = dataQuery.eq('status', currentFilters.status)
      }

      switch (currentFilters.sortBy) {
        case 'oldest':
          dataQuery = dataQuery.order('created_at', { ascending: true })
          break
        case 'price-asc':
          dataQuery = dataQuery.order('sale_price', { ascending: true })
          break
        case 'price-desc':
          dataQuery = dataQuery.order('sale_price', { ascending: false })
          break
        default:
          dataQuery = dataQuery.order('created_at', { ascending: false })
      }

      const { data, error: fetchError } = await dataQuery.range(from, to)

      if (fetchError) {
        throw new Error(fetchError.message)
      }

      setProducts(data || [])
    } catch (err) {
      console.error('Erreur lors du chargement des produits:', err)
      setError(err instanceof Error ? err.message : 'Erreur inconnue')
    } finally {
      setLoading(false)
    }
  }, [])

  const refreshProducts = async () => {
    await fetchProducts(currentPage, filtersRef.current)
  }

  const setPage = (page: number) => {
    setCurrentPage(page)
    if (isAuthenticated) {
      fetchProducts(page, filtersRef.current)
    }
  }

  const setFilters = (newFilters: ProductFilters) => {
    filtersRef.current = newFilters
    setFiltersState(newFilters)
    setCurrentPage(1)
    if (isAuthenticated) {
      fetchProducts(1, newFilters)
    }
  }

  const deleteProduct = async (id: string) => {
    try {
      const { error } = await supabase
        .from('products')
        .delete()
        .eq('id', id)

      if (error) {
        throw new Error(error.message)
      }

      await fetchProducts(currentPage, filtersRef.current)
    } catch (err) {
      console.error('Erreur lors de la suppression du produit:', err)
      throw err
    }
  }

  const totalPages = Math.ceil(totalCount / ITEMS_PER_PAGE)
  const hasNextPage = currentPage < totalPages
  const hasPreviousPage = currentPage > 1

  useEffect(() => {
    if (!isAuthenticated) {
      setLoading(false)
      return
    }

    fetchProducts(currentPage, filtersRef.current)
  }, [isAuthenticated, fetchProducts])

  return {
    products,
    loading,
    error,
    totalCount,
    currentPage,
    totalPages,
    hasNextPage,
    hasPreviousPage,
    refreshProducts,
    setPage,
    setFilters,
    filters,
    deleteProduct
  }
}