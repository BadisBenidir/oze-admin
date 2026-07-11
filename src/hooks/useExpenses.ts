import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'

export type ExpenseCategory =
  | 'achat-marchandise'
  | 'marketing'
  | 'logistique'
  | 'loyer'
  | 'personnel'
  | 'autre'

export interface Expense {
  id: string
  label: string
  category: ExpenseCategory | null
  amount: number
  spent_at: string // date (YYYY-MM-DD)
  notes: string | null
  created_at: string
}

export const EXPENSE_CATEGORY_LABELS: Record<string, string> = {
  'achat-marchandise': 'Achat marchandise',
  'marketing': 'Marketing',
  'logistique': 'Logistique',
  'loyer': 'Loyer / locaux',
  'personnel': 'Personnel',
  'autre': 'Autre',
}

interface UseExpensesResult {
  expenses: Expense[]
  loading: boolean
  error: string | null
  total: number
  totalByCategory: Array<{ category: string; label: string; total: number }>
  refresh: () => Promise<void>
  createExpense: (data: Partial<Expense>) => Promise<void>
  updateExpense: (id: string, data: Partial<Expense>) => Promise<void>
  deleteExpense: (id: string) => Promise<void>
}

export const useExpenses = (isAuthenticated: boolean = false): UseExpensesResult => {
  const [expenses, setExpenses] = useState<Expense[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchExpenses = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const { data, error } = await supabase
        .from('expenses')
        .select('*')
        .order('spent_at', { ascending: false })
      if (error) throw new Error(error.message)
      setExpenses((data as Expense[]) || [])
    } catch (err) {
      console.error('Erreur chargement dépenses:', err)
      setError(err instanceof Error ? err.message : 'Erreur inconnue')
    } finally {
      setLoading(false)
    }
  }, [])

  const refresh = useCallback(async () => {
    await fetchExpenses()
  }, [fetchExpenses])

  const createExpense = async (data: Partial<Expense>) => {
    const { error } = await supabase.from('expenses').insert([{
      label: data.label,
      category: data.category ?? null,
      amount: data.amount ?? 0,
      spent_at: data.spent_at || new Date().toISOString().slice(0, 10),
      notes: data.notes ?? null,
    }])
    if (error) throw new Error(error.message)
    await fetchExpenses()
  }

  const updateExpense = async (id: string, data: Partial<Expense>) => {
    const { error } = await supabase.from('expenses').update({
      label: data.label,
      category: data.category ?? null,
      amount: data.amount ?? 0,
      spent_at: data.spent_at,
      notes: data.notes ?? null,
    }).eq('id', id)
    if (error) throw new Error(error.message)
    await fetchExpenses()
  }

  const deleteExpense = async (id: string) => {
    const { error } = await supabase.from('expenses').delete().eq('id', id)
    if (error) throw new Error(error.message)
    await fetchExpenses()
  }

  useEffect(() => {
    if (!isAuthenticated) {
      setLoading(false)
      return
    }
    fetchExpenses()
  }, [isAuthenticated, fetchExpenses])

  const total = expenses.reduce((sum, e) => sum + Number(e.amount || 0), 0)

  const byCategoryMap = new Map<string, number>()
  expenses.forEach((e) => {
    const key = e.category || 'autre'
    byCategoryMap.set(key, (byCategoryMap.get(key) || 0) + Number(e.amount || 0))
  })
  const totalByCategory = Array.from(byCategoryMap.entries())
    .map(([category, total]) => ({
      category,
      label: EXPENSE_CATEGORY_LABELS[category] || category,
      total,
    }))
    .sort((a, b) => b.total - a.total)

  return {
    expenses,
    loading,
    error,
    total,
    totalByCategory,
    refresh,
    createExpense,
    updateExpense,
    deleteExpense,
  }
}
