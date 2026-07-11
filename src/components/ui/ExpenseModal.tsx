import React, { useState, useEffect } from 'react'
import { Modal } from './Modal'
import { Expense, ExpenseCategory, EXPENSE_CATEGORY_LABELS } from '../../hooks/useExpenses'

interface ExpenseModalProps {
  isOpen: boolean
  onClose: () => void
  onSave: (data: Partial<Expense>) => Promise<void>
  expense?: Expense | null
  isLoading?: boolean
}

const todayISO = () => new Date().toISOString().slice(0, 10)

export const ExpenseModal: React.FC<ExpenseModalProps> = ({
  isOpen,
  onClose,
  onSave,
  expense,
  isLoading = false,
}) => {
  const [form, setForm] = useState({
    label: '',
    category: 'autre' as ExpenseCategory,
    amount: '',
    spent_at: todayISO(),
    notes: '',
  })
  const [errors, setErrors] = useState<{ label?: string; amount?: string }>({})

  useEffect(() => {
    if (isOpen) {
      if (expense) {
        setForm({
          label: expense.label || '',
          category: (expense.category as ExpenseCategory) || 'autre',
          amount: expense.amount != null ? String(expense.amount) : '',
          spent_at: expense.spent_at || todayISO(),
          notes: expense.notes || '',
        })
      } else {
        setForm({ label: '', category: 'autre', amount: '', spent_at: todayISO(), notes: '' })
      }
      setErrors({})
    }
  }, [isOpen, expense])

  const parseAmount = (v: string) => {
    const n = parseFloat((v || '').replace(',', '.'))
    return isNaN(n) ? NaN : n
  }

  const validate = () => {
    const e: { label?: string; amount?: string } = {}
    if (!form.label.trim()) e.label = 'Le libellé est obligatoire'
    const amt = parseAmount(form.amount)
    if (isNaN(amt) || amt < 0) e.amount = 'Montant invalide'
    setErrors(e)
    return Object.keys(e).length === 0
  }

  const handleSubmit = async (ev: React.FormEvent) => {
    ev.preventDefault()
    if (!validate()) return
    try {
      await onSave({
        label: form.label.trim(),
        category: form.category,
        amount: parseAmount(form.amount),
        spent_at: form.spent_at,
        notes: form.notes.trim() || null,
      })
      onClose()
    } catch (error) {
      console.error('Erreur sauvegarde dépense:', error)
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={expense ? 'Modifier la dépense' : 'Nouvelle dépense'}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Libellé *</label>
          <input
            type="text"
            value={form.label}
            onChange={(e) => setForm((p) => ({ ...p, label: e.target.value }))}
            className={`w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 ${errors.label ? 'border-red-300' : 'border-gray-300'}`}
            placeholder="Ex: Campagne Instagram, Loyer février..."
            disabled={isLoading}
          />
          {errors.label && <p className="mt-1 text-sm text-red-600">{errors.label}</p>}
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Catégorie</label>
            <select
              value={form.category}
              onChange={(e) => setForm((p) => ({ ...p, category: e.target.value as ExpenseCategory }))}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              disabled={isLoading}
            >
              {Object.entries(EXPENSE_CATEGORY_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Montant (€) *</label>
            <input
              type="text"
              inputMode="decimal"
              value={form.amount}
              onChange={(e) => setForm((p) => ({ ...p, amount: e.target.value.replace(/[^0-9.,]/g, '') }))}
              className={`w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 ${errors.amount ? 'border-red-300' : 'border-gray-300'}`}
              placeholder="Ex: 250"
              disabled={isLoading}
            />
            {errors.amount && <p className="mt-1 text-sm text-red-600">{errors.amount}</p>}
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Date</label>
          <input
            type="date"
            value={form.spent_at}
            onChange={(e) => setForm((p) => ({ ...p, spent_at: e.target.value }))}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            disabled={isLoading}
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
          <textarea
            rows={2}
            value={form.notes}
            onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="Optionnel"
            disabled={isLoading}
          />
        </div>

        <div className="flex justify-end space-x-3 pt-2">
          <button
            type="button"
            onClick={onClose}
            disabled={isLoading}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50"
          >
            Annuler
          </button>
          <button
            type="submit"
            disabled={isLoading}
            className={`px-4 py-2 text-sm font-medium text-white rounded-md ${isLoading ? 'bg-blue-400 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-700'}`}
          >
            {isLoading ? 'Enregistrement...' : expense ? 'Modifier' : 'Ajouter'}
          </button>
        </div>
      </form>
    </Modal>
  )
}