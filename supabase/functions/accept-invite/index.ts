// Edge Function : accept-invite
//
// Finalise l'activation d'un compte revendeur invité (voir AcceptInvite.tsx
// et `redirectTo` dans invite-reseller-contact) : fixe le mot de passe choisi
// par l'utilisateur et marque son profil comme activé.
//
// Pourquoi pas `supabase.auth.updateUser({ password })` côté client : sur une
// session issue d'un lien d'invitation, GoTrue applique la même validation
// que pour un changement de mot de passe volontaire ("New password should be
// different from the old password"), y compris pour un compte qui n'a
// jamais eu de mot de passe. On passe donc par l'API admin (clé
// service-role), qui fixe le mot de passe directement sans cette
// vérification — même pattern que reset-reseller-password.
// Nécessite la clé service-role : ne peut donc pas être fait côté client.
// Déploiement : `supabase functions deploy accept-invite`

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

    // Client "appelant" (clé anon + JWT de la session d'invitation) : sert
    // uniquement à identifier l'utilisateur derrière le token, avant toute
    // opération privilégiée.
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

    const { first_name, last_name, password } = await req.json();
    if (!first_name?.trim() || !last_name?.trim()) {
      return new Response(JSON.stringify({ error: 'Prénom et nom sont requis' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    if (!password || password.length < 8) {
      return new Response(JSON.stringify({ error: 'Le mot de passe doit contenir au moins 8 caractères' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    // On n'autorise cette route qu'à finaliser une invitation en cours, pas
    // à modifier un compte déjà actif (le mot de passe se change alors via
    // "Mon profil / Sécurité", ou est réinitialisé via reset-reseller-password).
    const { data: profile } = await adminClient
      .from('profiles')
      .select('activated_at')
      .eq('id', user.id)
      .maybeSingle();

    if (profile?.activated_at) {
      return new Response(JSON.stringify({ error: 'Ce compte est déjà activé.' }), {
        status: 409,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { error: updateError } = await adminClient.auth.admin.updateUserById(user.id, {
      password,
      user_metadata: { first_name: first_name.trim(), last_name: last_name.trim() },
    });

    if (updateError) {
      return new Response(JSON.stringify({ error: updateError.message }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { error: profileError } = await adminClient
      .from('profiles')
      .update({
        first_name: first_name.trim(),
        last_name: last_name.trim(),
        activated_at: new Date().toISOString(),
      })
      .eq('id', user.id);

    if (profileError) {
      return new Response(JSON.stringify({ error: profileError.message }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ success: true }), {
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
