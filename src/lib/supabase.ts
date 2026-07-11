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
  role: 'admin' | 'client'
  created_at: string
  updated_at: string
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