import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

// Interface pour les données client complètes (profiles + customers)
export interface CustomerWithDetails {
  id: string // customer.id
  profile_id: string // customer.profile_id
  customer_code: string
  name: string // first_name + last_name du profile
  email: string
  phone: string | null
  birth_date: string | null
  address_line1: string | null
  address_line2: string | null
  city: string | null
  postal_code: string | null
  country: string
  newsletter: boolean
  totalOrders: number
  totalSpent: number
  status: 'active' | 'inactive'
  joinDate: string // created_at du profile
}

interface UseCustomersResult {
  customers: CustomerWithDetails[]
  loading: boolean
  error: string | null
  refreshCustomers: () => Promise<void>
}

export const useCustomers = (isAuthenticated: boolean = false): UseCustomersResult => {
  const [customers, setCustomers] = useState<CustomerWithDetails[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchCustomers = async () => {
    try {
      setLoading(true)
      setError(null)

      // Requête pour récupérer les clients avec leurs profils
      const { data, error: fetchError } = await supabase
        .from('customers')
        .select(`
          id,
          profile_id,
          customer_code,
          phone,
          birth_date,
          address_line1,
          address_line2,
          city,
          postal_code,
          country,
          newsletter,
          created_at,
          profiles!inner (
            email,
            first_name,
            last_name,
            role,
            created_at
          )
        `)
        .eq('profiles.role', 'client') // Seulement les clients, pas les admins
        .order('created_at', { ascending: false })

      if (fetchError) {
        throw new Error(fetchError.message)
      }

      if (!data) {
        setCustomers([])
        return
      }

      // Transformer les données pour correspondre à l'interface
      const transformedCustomers: CustomerWithDetails[] = data.map(customer => ({
        id: customer.id,
        profile_id: customer.profile_id,
        customer_code: customer.customer_code,
        name: `${customer.profiles.first_name} ${customer.profiles.last_name}`.trim(),
        email: customer.profiles.email,
        phone: customer.phone,
        birth_date: customer.birth_date,
        address_line1: customer.address_line1,
        address_line2: customer.address_line2,
        city: customer.city,
        postal_code: customer.postal_code,
        country: customer.country,
        newsletter: customer.newsletter,
        // TODO: Calculer les vraies valeurs depuis les commandes
        totalOrders: 0,
        totalSpent: 0,
        // Considérer actif si au moins une adresse est renseignée
        status: (customer.address_line1 && customer.city) ? 'active' : 'inactive',
        joinDate: customer.profiles.created_at
      }))

      setCustomers(transformedCustomers)
    } catch (err) {
      console.error('Erreur lors du chargement des clients:', err)
      setError(err instanceof Error ? err.message : 'Erreur inconnue')
    } finally {
      setLoading(false)
    }
  }

  const refreshCustomers = async () => {
    await fetchCustomers()
  }

  useEffect(() => {
    // Ne pas exécuter si l'admin n'est pas authentifié
    if (!isAuthenticated) {
      setLoading(false)
      return
    }
    
    fetchCustomers()
  }, [isAuthenticated])

  return {
    customers,
    loading,
    error,
    refreshCustomers
  }
}