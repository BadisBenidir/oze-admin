import { createClient } from '@supabase/supabase-js'
import { SUPABASE_CONFIG } from '../config/supabase.config'

// Configuration Supabase pour l'admin
const supabaseUrl = SUPABASE_CONFIG.url
const supabaseAnonKey = SUPABASE_CONFIG.anonKey

console.log('Initialisation Supabase avec:', { supabaseUrl, anonKey: supabaseAnonKey ? 'DÉFINI' : 'MANQUANT' })

if (!supabaseUrl || !supabaseAnonKey || supabaseUrl.includes('votre-projet')) {
  console.error('Variables Supabase manquantes ou incorrectes')
  throw new Error('Missing or incorrect Supabase environment variables')
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,
    // Stockage sécurisé dans localStorage
    storage: window.localStorage,
    flowType: 'pkce'
  }
})

// Types pour la table profiles (admin)
export interface AdminProfile {
  id: string
  email: string
  first_name: string
  last_name: string
  role: 'admin' | 'client' | 'staff'
  created_at: string
  updated_at: string
  /** Droits d'un compte employé (role 'staff', 0208) — absent pour le propriétaire. */
  staff?: StaffPermissions | null
}

export type StaffAction = 'wallet' | 'refunds' | 'invoicing' | 'accounts'

export interface StaffPermissions {
  /** Pages visibles, ids 'onglet:sous-onglet' (config/navigation.ts). */
  pages: string[]
  actions: StaffAction[]
  /** Prix d'achat, coûts et marges. */
  show_figures: boolean
  /** Chiffre d'affaires (0209) — absent avant la migration. */
  show_revenue?: boolean
  active: boolean
}

// Types pour la table customers (gestion admin)
export interface CustomerData {
  id: string
  profile_id: string
  customer_code: string
  phone: string | null
  newsletter: boolean
  birth_date: string | null
  address_line1: string | null
  address_line2: string | null
  city: string | null
  postal_code: string | null
  country: string
  created_at: string
  updated_at: string
}