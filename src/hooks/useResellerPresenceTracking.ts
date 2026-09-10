import { useEffect } from 'react';
import { supabase } from '../lib/supabase';

export const B2B_PRESENCE_CHANNEL = 'online-b2b-users';

interface TrackedProfile {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  company_name: string;
}

/**
 * Présence temps réel du portail B2B (Supabase Realtime Presence) — chaque
 * sous-compte revendeur authentifié rejoint le canal 'online-b2b-users' et y
 * publie son état ; l'admin écoute ce même canal en lecture seule (voir
 * useB2BTraffic.ts) pour afficher "En ligne en temps réel". Éphémère par
 * nature : rien n'est stocké en base pour cette partie, la présence
 * disparaît dès la fermeture d'onglet/démontage (untrack automatique par
 * Supabase Realtime à la déconnexion du canal).
 *
 * Enregistre aussi, une fois par jour et par sous-compte, une ligne dans
 * reseller_daily_sessions (0125) pour le KPI "visiteurs uniques aujourd'hui"
 * et le graphique d'évolution — la contrainte unique (profile_id, date)
 * rend l'opération idempotente, pas besoin d'un vrai debounce/throttle.
 */
export const useResellerPresenceTracking = (profile: TrackedProfile | null) => {
  useEffect(() => {
    if (!profile?.id) return;

    const channel = supabase.channel(B2B_PRESENCE_CHANNEL, {
      config: { presence: { key: profile.id } },
    });

    channel.subscribe(async (status) => {
      if (status === 'SUBSCRIBED') {
        await channel.track({
          user_id: profile.id,
          email: profile.email,
          first_name: profile.first_name,
          last_name: profile.last_name,
          company_name: profile.company_name,
          online_at: new Date().toISOString(),
        });
      }
    });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [profile?.id, profile?.email, profile?.first_name, profile?.last_name, profile?.company_name]);

  useEffect(() => {
    if (!profile?.id) return;
    const today = new Date().toISOString().slice(0, 10);
    supabase
      .from('reseller_daily_sessions')
      .upsert({ profile_id: profile.id, date: today }, { onConflict: 'profile_id,date', ignoreDuplicates: true })
      .then(({ error }) => {
        if (error) console.error('Erreur lors de l\'enregistrement de la session quotidienne:', error.message);
      });
  }, [profile?.id]);
};
