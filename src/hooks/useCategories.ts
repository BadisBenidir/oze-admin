import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

// Interface pour une catégorie
export interface Category {
  id: string
  name: string
  description?: string
  created_at: string
  updated_at: string
}

interface UseCategoriesResult {
  categories: Category[]
  loading: boolean
  error: string | null
  totalCount: number
  currentPage: number
  totalPages: number
  hasNextPage: boolean
  hasPreviousPage: boolean
  refreshCategories: () => Promise<void>
  setPage: (page: number) => void
  createCategory: (categoryData: Partial<Category>) => Promise<void>
  updateCategory: (id: string, categoryData: Partial<Category>) => Promise<void>
  deleteCategory: (id: string) => Promise<void>
}

const ITEMS_PER_PAGE = 10

export const useCategories = (isAuthenticated: boolean = false): UseCategoriesResult => {
  const [categories, setCategories] = useState<Category[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [totalCount, setTotalCount] = useState(0)
  const [currentPage, setCurrentPage] = useState(1)

  const fetchCategories = async (page: number = currentPage) => {
    try {
      setLoading(true)
      setError(null)

      // Calculer l'offset pour la pagination
      const from = (page - 1) * ITEMS_PER_PAGE
      const to = from + ITEMS_PER_PAGE - 1

      // Récupérer le total des catégories
      const { count, error: countError } = await supabase
        .from('categories')
        .select('*', { count: 'exact', head: true })

      if (countError) {
        throw new Error(countError.message)
      }

      setTotalCount(count || 0)

      // Récupérer les catégories paginées
      const { data, error: fetchError } = await supabase
        .from('categories')
        .select('*')
        .order('name', { ascending: true })
        .range(from, to)

      if (fetchError) {
        throw new Error(fetchError.message)
      }

      setCategories(data || [])
    } catch (err) {
      console.error('Erreur lors du chargement des catégories:', err)
      setError(err instanceof Error ? err.message : 'Erreur inconnue')
    } finally {
      setLoading(false)
    }
  }

  const refreshCategories = async () => {
    await fetchCategories(currentPage)
  }

  const setPage = (page: number) => {
    setCurrentPage(page)
    if (isAuthenticated) {
      fetchCategories(page)
    }
  }

  const createCategory = async (categoryData: Partial<Category>) => {
    try {
      const { data, error } = await supabase
        .from('categories')
        .insert([{
          name: categoryData.name,
          description: categoryData.description
        }])
        .select()

      if (error) {
        throw new Error(error.message)
      }

      // Rafraîchir la liste
      await fetchCategories(currentPage)
    } catch (err) {
      console.error('Erreur lors de la création de la catégorie:', err)
      throw err
    }
  }

  const updateCategory = async (id: string, categoryData: Partial<Category>) => {
    try {
      const { error } = await supabase
        .from('categories')
        .update({
          name: categoryData.name,
          description: categoryData.description
        })
        .eq('id', id)

      if (error) {
        throw new Error(error.message)
      }

      // Rafraîchir la liste
      await fetchCategories(currentPage)
    } catch (err) {
      console.error('Erreur lors de la modification de la catégorie:', err)
      throw err
    }
  }

  const deleteCategory = async (id: string) => {
    try {
      const { error } = await supabase
        .from('categories')
        .delete()
        .eq('id', id)

      if (error) {
        throw new Error(error.message)
      }

      // Rafraîchir la liste
      await fetchCategories(currentPage)
    } catch (err) {
      console.error('Erreur lors de la suppression de la catégorie:', err)
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
    
    fetchCategories(currentPage)
  }, [isAuthenticated])

  return {
    categories,
    loading,
    error,
    totalCount,
    currentPage,
    totalPages,
    hasNextPage,
    hasPreviousPage,
    refreshCategories,
    setPage,
    createCategory,
    updateCategory,
    deleteCategory
  }
}