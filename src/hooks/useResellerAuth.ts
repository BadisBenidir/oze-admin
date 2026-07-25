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
  reseller_status: 'pending' | 'active' | 'suspended' | 'deleted'
  /** Contact principal de l'entreprise : seul rôle autorisé à gérer les autres comptes de son équipe */
  is_primary: boolean
  /**
   * Coordonnées INDIVIDUELLES de ce contact (saisies à l'activation du
   * compte via /accept-invite, modifiables ensuite dans "Mon profil") —
   * distinctes de l'adresse de l'entreprise (table resellers, gérée par un
   * admin OZË). C'est CETTE adresse qui préremplit "Livrer à mon
   * entreprise" dans le checkout, pas celle de resellers.
   */
  phone: string | null
  address: string | null
  postal_code: string | null
  city: string | null
  country: string | null
  /** Instructions de livraison à domicile (étage, digicode...), voir "Mon profil". */
  delivery_instructions: string | null
  /** Point relais favori enregistré (même forme que ChronopostPickupPoint), ou null si aucun. */
  default_relay_point: Record<string, unknown> | null
  /** Mode de livraison présélectionné au checkout si renseigné. */
  default_delivery_type: 'domicile' | 'point_relais' | null
}

interface ResellerAuthState {
  user: User | null
  profile: ResellerProfile | null
  session: Session | null
  loading: boolean
  isReseller: boolean
  /** Compte revendeur trouvé mais pas encore actif (en attente/suspendu/supprimé) */
  pendingReason: 'pending' | 'suspended' | 'deleted' | null
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

  const fetchResellerProfile = async (userId: string): Promise<{ profile: ResellerProfile | null; pendingReason: 'pending' | 'suspended' | 'deleted' | null }> => {
    try {
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Timeout: requête trop longue')), 10000)
      )

      const queryPromise = supabase
        .from('profiles')
        .select(`
          id, email, first_name, last_name, role, phone, address, postal_code, city, country,
          delivery_instructions, default_relay_point, default_delivery_type,
          reseller_contacts!inner(
            reseller_id, is_primary,
            resellers!inner(company_name, status)
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
        return {
          profile: null,
          pendingReason: reseller.status === 'suspended' ? 'suspended' : reseller.status === 'deleted' ? 'deleted' : 'pending',
        }
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
          reseller_status: reseller.status,
          is_primary: Boolean(contact.is_primary),
          phone: data.phone || null,
          address: data.address || null,
          postal_code: data.postal_code || null,
          city: data.city || null,
          country: data.country || null,
          delivery_instructions: data.delivery_instructions || null,
          default_relay_point: data.default_relay_point || null,
          default_delivery_type: data.default_delivery_type || null,
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

    // Re-résout le profil sur CHAQUE changement de session, pas seulement à
    // la déconnexion : sinon, passer d'un compte à l'autre dans le même
    // onglet (ex. déconnexion + connexion sur un sous-compte) laisse
    // `profile` bloqué sur les données du compte précédent (nom affiché,
    // reseller_id, adresse...) jusqu'au prochain rechargement complet de la
    // page. Même pattern que useSessionRole.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      handleSession(session)
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
