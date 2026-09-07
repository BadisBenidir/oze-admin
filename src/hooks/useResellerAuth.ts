import { useState, useEffect } from 'react'
import { User, Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { CGV_VERSION } from '../config/legal'

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
  /**
   * Statut juridique de CE sous-compte (voir 0109) — indépendant par
   * profil, jamais partagé avec les collègues du même reseller_id (chaque
   * login déclare le sien). Null tant qu'il n'est pas renseigné, ce qui
   * bloque commande et enchère (CartPage.tsx / Auctions.tsx). Conditionne le
   * droit de rétractation (14 jours en 'individual') et les mentions
   * légales à facturer.
   */
  legal_status: 'individual' | 'sole_proprietorship' | 'company' | null
  /** Nom officiel de l'EI ou dénomination sociale — vide pour 'individual'. */
  legal_entity_name: string | null
  siret: string | null
  vat_number: string | null
  legal_form: string | null
  /** Adresse de facturation pro / siège social de CE sous-compte, distincte
   * de address/city/... ci-dessus (adresse de livraison personnelle). */
  legal_address: string | null
  legal_city: string | null
  legal_postal_code: string | null
  legal_country: string | null
  /** Premier consentement explicite aux CGV (voir Terms.tsx, 0110) — condition
   * bloquante pour enchérir (place_auto_bid), reconfirmé par case à cocher à
   * chaque commande (CartPage.tsx) sans re-timestamper ce champ. */
  terms_accepted_at: string | null
  terms_version: string | null
}

export interface LegalInfoInput {
  legalStatus: 'individual' | 'sole_proprietorship' | 'company'
  legalEntityName: string
  siret: string
  vatNumber: string
  legalForm: string
  address: string
  city: string
  postalCode: string
  country: string
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
          legal_status, legal_entity_name, siret, vat_number, legal_form,
          legal_address, legal_city, legal_postal_code, legal_country,
          terms_accepted_at, terms_version,
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
          legal_status: data.legal_status || null,
          legal_entity_name: data.legal_entity_name || null,
          siret: data.siret || null,
          vat_number: data.vat_number || null,
          legal_form: data.legal_form || null,
          legal_address: data.legal_address || null,
          legal_city: data.legal_city || null,
          legal_postal_code: data.legal_postal_code || null,
          legal_country: data.legal_country || null,
          terms_accepted_at: data.terms_accepted_at || null,
          terms_version: data.terms_version || null,
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

  /** Recharge le profil sans repasser par un changement de session — utilisé
   * après un update direct sur `profiles` ou une RPC comme set_reseller_legal_info. */
  const refreshProfile = async () => {
    if (!authState.user) return
    const { profile, pendingReason } = await fetchResellerProfile(authState.user.id)
    setAuthState((current) => ({ ...current, profile, isReseller: Boolean(profile), pendingReason }))
  }

  const updateLegalInfo = async (input: LegalInfoInput): Promise<{ success: boolean; error?: string }> => {
    const { error } = await supabase.rpc('set_reseller_legal_info', {
      p_legal_status: input.legalStatus,
      p_legal_entity_name: input.legalEntityName,
      p_siret: input.siret,
      p_vat_number: input.vatNumber,
      p_legal_form: input.legalForm,
      p_address: input.address,
      p_city: input.city,
      p_postal_code: input.postalCode,
      p_country: input.country,
    })
    if (error) return { success: false, error: error.message }
    await refreshProfile()
    // Équivalent pratique du "trigger sur mise à jour du profil" : dès que le
    // statut juridique est fixé (voir 0115_invoices.sql), on rattrape les
    // factures de toutes les commandes déjà payées qui en manquaient.
    await supabase.rpc('backfill_missing_invoices_for_profile')
    return { success: true }
  }

  /**
   * Consentement CGV pour l'accès aux enchères (0110) — contrairement au
   * checkout (une case à cocher requise à chaque commande, voir
   * CartPage.tsx / b2b-checkout), ici c'est un geste ponctuel qui débloque
   * durablement la mise (Auctions.tsx) : pas de règle métier conditionnelle
   * à valider comme pour le statut juridique, un simple update direct
   * suffit (même policy RLS d'auto-édition que phone/adresse).
   */
  const acceptTerms = async (): Promise<{ success: boolean; error?: string }> => {
    if (!authState.user) return { success: false, error: 'Non authentifié' }
    const { error } = await supabase
      .from('profiles')
      .update({ terms_accepted_at: new Date().toISOString(), terms_version: CGV_VERSION })
      .eq('id', authState.user.id)
    if (error) return { success: false, error: error.message }
    await refreshProfile()
    return { success: true }
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
    refreshProfile,
    updateLegalInfo,
    acceptTerms,
  }
}
