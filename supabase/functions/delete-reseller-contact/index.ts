// Edge Function : delete-reseller-contact
//
// Supprime DÉFINITIVEMENT un contact revendeur : profil ET compte Auth (pas
// seulement le lien reseller_contacts, contrairement à l'ancien
// comportement qui ne faisait que "détacher" la personne en laissant son
// compte de connexion actif). Nécessite la clé service-role.
// Deux niveaux d'autorisation :
//   - Admin OZË : peut supprimer n'importe quel contact, toute entreprise confondue.
//   - Contact principal d'un revendeur : peut supprimer UNIQUEMENT les
//     contacts de sa propre entreprise (vérifié via reseller_id).
// Le contact principal ne peut jamais être supprimé par cette fonction (il
// faut d'abord en désigner un autre, ou passer par la suppression du
// revendeur lui-même) — évite de laisser une entreprise sans personne pour
// la gérer.
// Déploiement : `supabase functions deploy delete-reseller-contact`

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

    const { contact_id } = await req.json();
    if (!contact_id) {
      return new Response(JSON.stringify({ error: 'contact_id est requis' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    // Cible : le contact à supprimer, avec son entreprise et son statut.
    const { data: targetContact, error: targetError } = await adminClient
      .from('reseller_contacts')
      .select('id, profile_id, reseller_id, is_primary')
      .eq('id', contact_id)
      .maybeSingle();

    if (targetError) {
      return new Response(JSON.stringify({ error: targetError.message }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    if (!targetContact) {
      return new Response(JSON.stringify({ error: 'Contact introuvable' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    if (targetContact.is_primary) {
      return new Response(JSON.stringify({ error: 'Impossible de supprimer le contact principal de cette façon. Désigne un autre contact principal au préalable, ou supprime le revendeur lui-même.' }), {
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

    let isPrimaryOfSameReseller = false;
    if (!isAdmin) {
      const { data: callerContact } = await callerClient
        .from('reseller_contacts')
        .select('reseller_id, is_primary, resellers(status)')
        .eq('profile_id', user.id)
        .single();

      const callerReseller = Array.isArray(callerContact?.resellers) ? callerContact?.resellers[0] : callerContact?.resellers;
      isPrimaryOfSameReseller = Boolean(
        callerContact?.is_primary &&
        callerContact.reseller_id === targetContact.reseller_id &&
        callerReseller?.status === 'active'
      );
    }

    if (!isAdmin && !isPrimaryOfSameReseller) {
      return new Response(JSON.stringify({ error: 'Accès refusé : réservé aux administrateurs ou au contact principal de cette entreprise' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 1) Profil (entraîne la suppression en cascade de reseller_contacts,
    //    contrainte ON DELETE CASCADE — voir migration 0001).
    const { error: profileDeleteError } = await adminClient
      .from('profiles')
      .delete()
      .eq('id', targetContact.profile_id);

    if (profileDeleteError) {
      return new Response(JSON.stringify({ error: profileDeleteError.message }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 2) Compte Auth : invalide complètement les accès de connexion.
    const { error: authDeleteError } = await adminClient.auth.admin.deleteUser(targetContact.profile_id);
    if (authDeleteError) {
      return new Response(JSON.stringify({ error: `Profil supprimé mais échec de la suppression du compte de connexion : ${authDeleteError.message}` }), {
        status: 500,
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
