import React, { useState, useEffect } from 'react'
import { Modal } from './Modal'
import { Brand } from '../../hooks/useBrands'

interface BrandModalProps {
  isOpen: boolean
  onClose: () => void
  onSave: (brandData: Partial<Brand>) => Promise<void>
  brand?: Brand | null
  isLoading?: boolean
}

export const BrandModal: React.FC<BrandModalProps> = ({
  isOpen,
  onClose,
  onSave,
  brand,
  isLoading = false
}) => {
  const [formData, setFormData] = useState({
    name: '',
    code: '',
    description: ''
  })
  
  const [errors, setErrors] = useState<{name?: string}>({})

  // Réinitialiser le formulaire quand la modal s'ouvre/ferme
  useEffect(() => {
    if (isOpen) {
      if (brand) {
        // Mode édition
        setFormData({
          name: brand.name || '',
          code: brand.code || '',
          description: brand.description || ''
        })
      } else {
        // Mode création
        setFormData({
          name: '',
          code: '',
          description: ''
        })
      }
      setErrors({})
    }
  }, [isOpen, brand])

  const validateForm = () => {
    const newErrors: {name?: string} = {}
    
    if (!formData.name.trim()) {
      newErrors.name = 'Le nom est obligatoire'
    }
    
    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!validateForm()) {
      return
    }

    try {
      await onSave({
        name: formData.name.trim(),
        code: formData.code.trim().toUpperCase() || undefined,
        description: formData.description.trim() || undefined
      })
      onClose()
    } catch (error) {
      console.error('Erreur lors de la sauvegarde:', error)
    }
  }

  const handleInputChange = (field: keyof typeof formData, value: string) => {
    setFormData(prev => ({
      ...prev,
      [field]: value
    }))
    
    // Effacer l'erreur du champ si l'utilisateur commence à taper
    if (errors[field as keyof typeof errors]) {
      setErrors(prev => ({
        ...prev,
        [field]: undefined
      }))
    }
  }

  return (
    <Modal 
      isOpen={isOpen} 
      onClose={onClose} 
      title={brand ? 'Modifier la marque' : 'Nouvelle marque'}
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="name" className="block text-sm font-medium text-gray-700 mb-1">
            Nom de la marque *
          </label>
          <input
            type="text"
            id="name"
            value={formData.name}
            onChange={(e) => handleInputChange('name', e.target.value)}
            className={`w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 ${
              errors.name ? 'border-red-300' : 'border-gray-300'
            }`}
            placeholder="Ex: Chanel, Louis Vuitton..."
            disabled={isLoading}
          />
          {errors.name && (
            <p className="mt-1 text-sm text-red-600">{errors.name}</p>
          )}
        </div>

        <div>
          <label htmlFor="code" className="block text-sm font-medium text-gray-700 mb-1">
            Abréviation
          </label>
          <input
            type="text"
            id="code"
            value={formData.code}
            onChange={(e) => handleInputChange('code', e.target.value.toUpperCase())}
            maxLength={4}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 uppercase"
            placeholder="Ex: GUC, LV, DIO"
            disabled={isLoading}
          />
          <p className="mt-1 text-xs text-gray-500">
            Utilisée dans la référence produit (OZ-<strong>{formData.code || 'XXX'}</strong>-001). Laissez vide pour la déduire du nom.
          </p>
        </div>

        <div>
          <label htmlFor="description" className="block text-sm font-medium text-gray-700 mb-1">
            Description
          </label>
          <textarea
            id="description"
            rows={3}
            value={formData.description}
            onChange={(e) => handleInputChange('description', e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="Description de la marque (optionnel)"
            disabled={isLoading}
          />
        </div>

        <div className="flex justify-end space-x-3 pt-4">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-500 transition-colors"
            disabled={isLoading}
          >
            Annuler
          </button>
          <button
            type="submit"
            className={`px-4 py-2 text-sm font-medium text-white rounded-md focus:outline-none focus:ring-2 focus:ring-offset-2 transition-colors ${
              isLoading
                ? 'bg-blue-400 cursor-not-allowed'
                : 'bg-blue-600 hover:bg-blue-700 focus:ring-blue-500'
            }`}
            disabled={isLoading}
          >
            {isLoading ? (
              <span className="flex items-center">
                <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                {brand ? 'Modification...' : 'Création...'}
              </span>
            ) : (
              brand ? 'Modifier' : 'Créer'
            )}
          </button>
        </div>
      </form>
    </Modal>
  )
}