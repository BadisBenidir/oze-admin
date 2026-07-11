import { useState, useEffect } from 'react'
import { User, Session } from '@supabase/supabase-js'
import { supabase, AdminProfile } from '../lib/supabase'

interface AdminAuthState {
  user: User | null
  profile: AdminProfile | null
  session: Session | null
  loading: boolean
  isAdmin: boolean
}

export const useAdminAuth = () => {
  const [authState, setAuthState] = useState<AdminAuthState>({
    user: null,
    profile: null,
    session: null,
    loading: true,
    isAdmin: false
  })

  // Fonction pour récupérer le profil admin avec timeout
  const fetchAdminProfile = async (userId: string): Promise<AdminProfile | null> => {
    try {
      console.log('Recherche profil admin pour userId:', userId)
      
      // Timeout de 10 secondes pour éviter le blocage
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Timeout: requête trop longue')), 10000)
      )
      
      const queryPromise = supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single()
      
      const result = await Promise.race([queryPromise, timeoutPromise]) as any
      const { data, error } = result

      if (error) {
        console.error('Erreur récupération profil:', error)
        return null
      }

      console.log('Profil trouvé:', data)

      // Vérifier si c'est bien un admin
      if (data && data.role === 'admin') {
        console.log('Profil admin confirmé')
        return data as AdminProfile
      } else {
        console.log('Profil trouvé mais pas admin. Rôle:', data?.role)
        return null
      }
    } catch (error) {
      console.error('Erreur récupération profil admin:', error)
      // Si timeout ou erreur, on considère que ce n'est pas un admin
      return null
    }
  }

  // Fonction de connexion admin
  const signIn = async (email: string, password: string) => {
    try {
      console.log('Tentative de connexion pour:', email)
      setAuthState(prev => ({ ...prev, loading: true }))

      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password
      })

      console.log('Réponse Supabase auth:', { data, error })
      
      if (error) {
        console.error('Erreur d\'authentification:', error)
        throw error
      }

      if (data.user) {
        // Vérifier que l'utilisateur est bien un admin
        const adminProfile = await fetchAdminProfile(data.user.id)
        
        if (!adminProfile) {
          // Si pas admin, déconnecter immédiatement
          await supabase.auth.signOut()
          throw new Error('Accès non autorisé. Seuls les administrateurs peuvent se connecter.')
        }

        setAuthState(prev => ({
          ...prev,
          user: data.user,
          profile: adminProfile,
          session: data.session,
          loading: false,
          isAdmin: true
        }))

        return { success: true }
      }
    } catch (error) {
      setAuthState(prev => ({ ...prev, loading: false }))
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Erreur de connexion'
      }
    }
  }

  // Fonction de déconnexion
  const signOut = async () => {
    try {
      const { error } = await supabase.auth.signOut()
      if (error) throw error
      
      setAuthState({
        user: null,
        profile: null,
        session: null,
        loading: false,
        isAdmin: false
      })
    } catch (error) {
      console.error('Erreur de déconnexion:', error)
    }
  }

  useEffect(() => {
    let mounted = true

    // Fonction pour traiter une session
    const handleSession = async (session: any) => {
      if (!mounted) return
      
      try {
        if (session?.user) {
          console.log('Traitement session pour:', session.user.email)
          // Vérifier que c'est un admin
          const adminProfile = await fetchAdminProfile(session.user.id)
          
          if (!mounted) return
          
          if (adminProfile) {
            console.log('Admin validé')
            setAuthState({
              user: session.user,
              profile: adminProfile,
              session,
              loading: false,
              isAdmin: true
            })
          } else {
            console.log('Utilisateur non admin, déconnexion')
            await supabase.auth.signOut()
            setAuthState({
              user: null,
              profile: null,
              session: null,
              loading: false,
              isAdmin: false
            })
          }
        } else {
          console.log('Aucune session')
          if (mounted) {
            setAuthState({
              user: null,
              profile: null,
              session: null,
              loading: false,
              isAdmin: false
            })
          }
        }
      } catch (error) {
        console.error('Erreur traitement session:', error)
        if (mounted) {
          setAuthState(prev => ({ ...prev, loading: false }))
        }
      }
    }

    // Récupérer la session initiale
    const initAuth = async () => {
      console.log('Initialisation auth admin...')
      const { data: { session } } = await supabase.auth.getSession()
      await handleSession(session)
    }

    initAuth()

    // Écouter les changements (mais pas SIGNED_IN qui duplique)
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        console.log('Auth state change:', event)
        if (event === 'SIGNED_OUT') {
          setAuthState({
            user: null,
            profile: null,
            session: null,
            loading: false,
            isAdmin: false
          })
        }
        // Ne pas traiter SIGNED_IN ici pour éviter les doublons
      }
    )

    return () => {
      mounted = false
      subscription.unsubscribe()
    }
  }, [])

  return {
    ...authState,
    signIn,
    signOut
  }
}