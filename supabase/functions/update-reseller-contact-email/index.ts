// Edge Function : update-reseller-contact-email
//
// Change l'email de connexion (Supabase Auth) d'un contact revendeur, à
// l'initiative de l'admin OZË. Nécessite la clé service-role (modifier
// l'email d'un autre utilisateur ne peut pas se faire côté client).
// Déploiement : `supabase functions deploy update-reseller-contact-email`

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

    const { data: callerProfile } = await callerClient
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single();

    if (callerProfile?.role !== 'admin') {
      return new Response(JSON.stringify({ error: 'Accès refusé : réservé aux administrateurs' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { profile_id, new_email } = await req.json();
    if (!profile_id || !new_email) {
      return new Response(JSON.stringify({ error: 'profile_id et new_email sont requis' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    const { data: targetProfile } = await adminClient
      .from('profiles')
      .select('role')
      .eq('id', profile_id)
      .single();

    if (targetProfile?.role !== 'reseller') {
      return new Response(JSON.stringify({ error: "Ce compte n'est pas un compte revendeur" }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { error: authUpdateError } = await adminClient.auth.admin.updateUserById(profile_id, {
      email: new_email,
      email_confirm: true,
    });

    if (authUpdateError) {
      return new Response(JSON.stringify({ error: authUpdateError.message }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { error: profileUpdateError } = await adminClient
      .from('profiles')
      .update({ email: new_email })
      .eq('id', profile_id);

    if (profileUpdateError) {
      return new Response(JSON.stringify({ error: profileUpdateError.message }), {
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
