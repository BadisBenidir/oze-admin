// Edge Function : accept-reseller-invite-link
//
// Acceptation d'un lien d'invitation d'équipe réutilisable (reseller_invite_links) :
// crée un compte de connexion (rôle "reseller", non principal) et le rattache
// à la société revendeuse propriétaire du lien. Public (aucune authentification
// requise) : le token porte lui-même l'autorisation, comme un mot de passe à
// usage limité. Nécessite la clé service-role (création d'utilisateur Auth).
// Déploiement : `supabase functions deploy accept-reseller-invite-link`

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
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    const { token, email, first_name, last_name, password } = await req.json();
    if (!token || !email || !password) {
      return new Response(JSON.stringify({ error: 'token, email et password sont requis' }), {
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

    const { data: link, error: linkError } = await adminClient
      .from('reseller_invite_links')
      .select('id, reseller_id, is_active, max_uses, use_count')
      .eq('token', token)
      .maybeSingle();

    if (linkError || !link) {
      return new Response(JSON.stringify({ error: "Lien d'invitation invalide" }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    if (!link.is_active) {
      return new Response(JSON.stringify({ error: "Ce lien d'invitation a été désactivé" }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    if (link.max_uses !== null && link.use_count >= link.max_uses) {
      return new Response(JSON.stringify({ error: "Ce lien d'invitation a atteint son nombre maximal d'utilisations" }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { data: reseller } = await adminClient
      .from('resellers')
      .select('status')
      .eq('id', link.reseller_id)
      .maybeSingle();
    if (!reseller || reseller.status !== 'active') {
      return new Response(JSON.stringify({ error: "L'entreprise associée à ce lien n'est plus active" }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { data: listResult } = await adminClient.auth.admin.listUsers({ perPage: 1000 });
    const existingUser = listResult?.users.find((u) => u.email?.toLowerCase() === String(email).toLowerCase());
    if (existingUser) {
      return new Response(JSON.stringify({ error: 'Un compte existe déjà avec cet email. Connecte-toi normalement ou contacte ton administrateur OZË.' }), {
        status: 409,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { data: created, error: createError } = await adminClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { first_name: first_name ?? '', last_name: last_name ?? '' },
    });
    if (createError || !created?.user) {
      return new Response(JSON.stringify({ error: createError?.message ?? "Échec de la création du compte" }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { error: profileError } = await adminClient
      .from('profiles')
      .upsert({
        id: created.user.id,
        email,
        first_name: first_name ?? '',
        last_name: last_name ?? '',
        role: 'reseller',
        activated_at: new Date().toISOString(),
        last_invited_at: null,
      });
    if (profileError) {
      await adminClient.auth.admin.deleteUser(created.user.id);
      return new Response(JSON.stringify({ error: profileError.message }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { error: contactError } = await adminClient
      .from('reseller_contacts')
      .insert({ reseller_id: link.reseller_id, profile_id: created.user.id, is_primary: false });
    if (contactError) {
      await adminClient.auth.admin.deleteUser(created.user.id);
      return new Response(JSON.stringify({ error: contactError.message }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Best-effort : le compte est déjà valide et rattaché à ce stade, on ne
    // fait pas échouer la requête si seul ce compteur ne se met pas à jour.
    await adminClient
      .from('reseller_invite_links')
      .update({ use_count: link.use_count + 1 })
      .eq('id', link.id);

    return new Response(JSON.stringify({ success: true, user_id: created.user.id }), {
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
