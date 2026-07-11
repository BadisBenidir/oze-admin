import { useState, useEffect } from 'react'
import { User, Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'

export interface ResellerProfile {
  id: string
  email: string
  first_name: string
  last_name: string
  role: string
  reseller_id: string
  company_name: string
  discount_percent: number
  reseller_status: 'pending' | 'active' | 'suspended'
}

interface ResellerAuthState {
  user: User | null
  profile: ResellerProfile | null
  session: Session | null
  loading: boolean
  isReseller: boolean
  /** Compte revendeur trouvé mais pas encore actif (en attente/suspendu) */
  pendingReason: 'pending' | 'suspended' | null
}

export const useResellerAuth = () => {
  const [authState, setAuthState] = useState<ResellerAuthState>({
    user: null,
    profile: null,
    session: null,
    loading: true,
    isReseller: false,
    pendingReason: null,
  })

  const fetchResellerProfile = async (userId: string): Promise<{ profile: ResellerProfile | null; pendingReason: 'pending' | 'suspended' | null }> => {
    try {
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Timeout: requête trop longue')), 10000)
      )

      const queryPromise = supabase
        .from('profiles')
        .select(`
          id, email, first_name, last_name, role,
          reseller_contacts!inner(
            reseller_id,
            resellers!inner(company_name, discount_percent, status)
          )
        `)
        .eq('id', userId)
        .eq('role', 'reseller')
        .single()

      const result = await Promise.race([queryPromise, timeoutPromise]) as any
      const { data, error } = result

      if (error || !data) {
        return { profile: null, pendingReason: null }
      }

      const contact = Array.isArray(data.reseller_contacts) ? data.reseller_contacts[0] : data.reseller_contacts
      const reseller = contact?.resellers

      if (!contact || !reseller) {
        return { profile: null, pendingReason: null }
      }

      if (reseller.status !== 'active') {
        return { profile: null, pendingReason: reseller.status === 'suspended' ? 'suspended' : 'pending' }
      }

      return {
        profile: {
          id: data.id,
          email: data.email,
          first_name: data.first_name,
          last_name: data.last_name,
          role: data.role,
          reseller_id: contact.reseller_id,
          company_name: reseller.company_name,
          discount_percent: reseller.discount_percent,
          reseller_status: reseller.status,
        },
        pendingReason: null,
      }
    } catch (error) {
      console.error('Erreur récupération profil revendeur:', error)
      return { profile: null, pendingReason: null }
    }
  }

  const signOut = async () => {
    try {
      await supabase.auth.signOut()
    } catch (error) {
      console.error('Erreur de déconnexion:', error)
    } finally {
      setAuthState({ user: null, profile: null, session: null, loading: false, isReseller: false, pendingReason: null })
    }
  }

  useEffect(() => {
    let mounted = true

    const handleSession = async (session: Session | null) => {
      if (!mounted) return

      if (!session?.user) {
        setAuthState({ user: null, profile: null, session: null, loading: false, isReseller: false, pendingReason: null })
        return
      }

      const { profile, pendingReason } = await fetchResellerProfile(session.user.id)
      if (!mounted) return

      setAuthState({
        user: session.user,
        profile,
        session,
        loading: false,
        isReseller: Boolean(profile),
        pendingReason,
      })
    }

    supabase.auth.getSession().then(({ data: { session } }) => handleSession(session))

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT') {
        setAuthState({ user: null, profile: null, session: null, loading: false, isReseller: false, pendingReason: null })
      }
    })

    return () => {
      mounted = false
      subscription.unsubscribe()
    }
  }, [])

  return {
    ...authState,
    signOut,
  }
}
