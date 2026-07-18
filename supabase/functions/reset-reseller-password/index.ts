// Edge Function : reset-reseller-password
//
// Réinitialise le mot de passe d'un contact revendeur, à l'initiative d'un
// admin OZË (n'importe quel revendeur) ou du contact principal ("Modo") de
// l'entreprise (uniquement ses propres collègues, jamais lui-même : voir
// "Mon profil / Sécurité" pour l'auto-changement de mot de passe). Force
// ensuite la déconnexion de toutes les sessions actives de la cible via
// revoke_user_sessions, pour qu'une session déjà ouverte sur un autre
// appareil ne reste pas valide avec l'ancien mot de passe.
// Nécessite la clé service-role : ne peut donc pas être fait côté client.
// Déploiement : `supabase functions deploy reset-reseller-password`

import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Non authentifié' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;

    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: userError } = await callerClient.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: 'Non authentifié' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { profile_id, password } = await req.json();
    if (!profile_id || !password) {
      return new Response(JSON.stringify({ error: 'profile_id et password sont requis' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    if (password.length < 8) {
      return new Response(JSON.stringify({ error: 'Le mot de passe doit contenir au moins 8 caractères' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    if (profile_id === user.id) {
      return new Response(JSON.stringify({ error: 'Utilise "Mon profil / Sécurité" pour changer ton propre mot de passe' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { data: callerProfile } = await callerClient
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single();

    const isAdmin = callerProfile?.role === 'admin';

    // Un admin OZË peut réinitialiser n'importe quel contact revendeur. Le
    // contact principal peut réinitialiser UNIQUEMENT les collègues de sa
    // propre entreprise, tant qu'elle est active — même logique
    // d'autorisation que invite-reseller-contact.
    let callerResellerId: string | null = null;
    if (!isAdmin) {
      const { data: callerContact } = await callerClient
        .from('reseller_contacts')
        .select('reseller_id, is_primary, resellers(status)')
        .eq('profile_id', user.id)
        .single();

      const callerReseller = Array.isArray(callerContact?.resellers) ? callerContact?.resellers[0] : callerContact?.resellers;
      const isPrimaryOfActiveReseller = Boolean(
        callerContact?.is_primary && callerReseller?.status === 'active'
      );
      if (isPrimaryOfActiveReseller) {
        callerResellerId = callerContact!.reseller_id;
      }
    }

    if (!isAdmin && !callerResellerId) {
      return new Response(JSON.stringify({ error: 'Accès refusé : réservé aux administrateurs ou au contact principal de cette entreprise' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    // On vérifie que la cible est bien un revendeur actif, et — si
    // l'appelant n'est pas admin — qu'elle appartient bien à sa propre
    // entreprise, avant de toucher à son mot de passe.
    const { data: targetProfile } = await adminClient
      .from('profiles')
      .select('role, activated_at')
      .eq('id', profile_id)
      .single();

    if (targetProfile?.role !== 'reseller') {
      return new Response(JSON.stringify({ error: 'Ce compte n\'est pas un compte revendeur' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!isAdmin) {
      // Un admin OZË peut vouloir fixer un mot de passe pour débloquer un
      // compte jamais activé ; le contact principal, lui, ne fait que
      // régénérer le mot de passe d'un collègue déjà opérationnel.
      if (!targetProfile.activated_at) {
        return new Response(JSON.stringify({ error: 'Ce compte n\'a pas encore été activé : renvoie une invitation plutôt qu\'une réinitialisation' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const { data: targetContact } = await adminClient
        .from('reseller_contacts')
        .select('reseller_id')
        .eq('profile_id', profile_id)
        .maybeSingle();

      if (!targetContact || targetContact.reseller_id !== callerResellerId) {
        return new Response(JSON.stringify({ error: 'Ce compte n\'appartient pas à votre entreprise' }), {
          status: 403,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    const { error: updateError } = await adminClient.auth.admin.updateUserById(profile_id, { password });

    if (updateError) {
      return new Response(JSON.stringify({ error: updateError.message }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Déconnexion forcée : la session ouverte par l'employé (le cas échéant)
    // ne doit plus rester valide avec l'ancien mot de passe. Un échec ici ne
    // remet pas en cause le changement de mot de passe déjà effectué, mais
    // est remonté pour que le Modo sache qu'il faudra vérifier manuellement.
    let sessionsRevoked = true;
    const { error: revokeError } = await adminClient.rpc('revoke_user_sessions', { target_user_id: profile_id });
    if (revokeError) {
      console.error('Échec de la révocation des sessions:', revokeError.message);
      sessionsRevoked = false;
    }

    return new Response(JSON.stringify({ success: true, sessions_revoked: sessionsRevoked }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : 'Erreur inconnue' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
