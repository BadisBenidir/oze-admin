import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

// Interface pour une marque
export interface Brand {
  id: string
  name: string
  // Abréviation marque (ex: GUC, LV, DIO) utilisée pour la référence produit.
  code?: string | null
  description?: string
  created_at: string
  updated_at: string
}

interface UseBrandsResult {
  brands: Brand[]
  loading: boolean
  error: string | null
  totalCount: number
  currentPage: number
  totalPages: number
  hasNextPage: boolean
  hasPreviousPage: boolean
  refreshBrands: () => Promise<void>
  setPage: (page: number) => void
  createBrand: (brandData: Partial<Brand>) => Promise<void>
  updateBrand: (id: string, brandData: Partial<Brand>) => Promise<void>
  deleteBrand: (id: string) => Promise<void>
}

const ITEMS_PER_PAGE = 10

export const useBrands = (isAuthenticated: boolean = false): UseBrandsResult => {
  const [brands, setBrands] = useState<Brand[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [totalCount, setTotalCount] = useState(0)
  const [currentPage, setCurrentPage] = useState(1)

  const fetchBrands = async (page: number = currentPage) => {
    try {
      setLoading(true)
      setError(null)

      // Calculer l'offset pour la pagination
      const from = (page - 1) * ITEMS_PER_PAGE
      const to = from + ITEMS_PER_PAGE - 1

      // Récupérer le total des marques
      const { count, error: countError } = await supabase
        .from('brands')
        .select('*', { count: 'exact', head: true })

      if (countError) {
        throw new Error(countError.message)
      }

      setTotalCount(count || 0)

      // Récupérer les marques paginées
      const { data, error: fetchError } = await supabase
        .from('brands')
        .select('*')
        .order('name', { ascending: true })
        .range(from, to)

      if (fetchError) {
        throw new Error(fetchError.message)
      }

      setBrands(data || [])
    } catch (err) {
      console.error('Erreur lors du chargement des marques:', err)
      setError(err instanceof Error ? err.message : 'Erreur inconnue')
    } finally {
      setLoading(false)
    }
  }

  const refreshBrands = async () => {
    await fetchBrands(currentPage)
  }

  const setPage = (page: number) => {
    setCurrentPage(page)
    if (isAuthenticated) {
      fetchBrands(page)
    }
  }

  const createBrand = async (brandData: Partial<Brand>) => {
    try {
      const { data, error } = await supabase
        .from('brands')
        .insert([{
          name: brandData.name,
          code: brandData.code?.trim().toUpperCase() || null,
          description: brandData.description
        }])
        .select()

      if (error) {
        throw new Error(error.message)
      }

      // Rafraîchir la liste
      await fetchBrands(currentPage)
    } catch (err) {
      console.error('Erreur lors de la création de la marque:', err)
      throw err
    }
  }

  const updateBrand = async (id: string, brandData: Partial<Brand>) => {
    try {
      const { error } = await supabase
        .from('brands')
        .update({
          name: brandData.name,
          code: brandData.code?.trim().toUpperCase() || null,
          description: brandData.description
        })
        .eq('id', id)

      if (error) {
        throw new Error(error.message)
      }

      // Rafraîchir la liste
      await fetchBrands(currentPage)
    } catch (err) {
      console.error('Erreur lors de la modification de la marque:', err)
      throw err
    }
  }

  const deleteBrand = async (id: string) => {
    try {
      const { error } = await supabase
        .from('brands')
        .delete()
        .eq('id', id)

      if (error) {
        throw new Error(error.message)
      }

      // Rafraîchir la liste
      await fetchBrands(currentPage)
    } catch (err) {
      console.error('Erreur lors de la suppression de la marque:', err)
      throw err
    }
  }

  // Calcul des informations de pagination
  const totalPages = Math.ceil(totalCount / ITEMS_PER_PAGE)
  const hasNextPage = currentPage < totalPages
  const hasPreviousPage = currentPage > 1

  useEffect(() => {
    // Ne pas exécuter si l'admin n'est pas authentifié
    if (!isAuthenticated) {
      setLoading(false)
      return
    }
    
    fetchBrands(currentPage)
  }, [isAuthenticated])

  return {
    brands,
    loading,
    error,
    totalCount,
    currentPage,
    totalPages,
    hasNextPage,
    hasPreviousPage,
    refreshBrands,
    setPage,
    createBrand,
    updateBrand,
    deleteBrand
  }
}