// Edge Function : deactivate-reseller
//
// C'est ce qui se cache derrière le bouton "Supprimer" d'un revendeur dans
// l'admin — mais ce n'est JAMAIS une suppression physique. Un revendeur
// actif a presque toujours des commandes, des transactions de portefeuille
// ou des cadeaux fidélité qui le référencent (orders.reseller_id,
// wallet_transactions.reseller_id, loyalty_gifts.reseller_id, promo_code_uses
// .reseller_id — aucune de ces FK n'a ON DELETE CASCADE, voir 0043), donc un
// vrai DELETE échouerait de toute façon avec une violation de contrainte. Et
// même si ça ne bloquait pas, effacer cet historique casserait la
// comptabilité et les rapports de chiffre d'affaires B2B passés.
//
// Ce que fait réellement cette fonction :
//   1) bannit (au lieu de supprimer) le compte Auth de CHAQUE contact de
//      cette entreprise — révoque leur accès à pro.ozeparis.com sans
//      toucher à profiles/orders/wallet_transactions ;
//   2) passe resellers.status à 'deleted', ce qui le retire de la liste
//      admin (filtrée) ET fait déjà échouer current_reseller_id() côté RLS
//      (qui exige status = 'active'), en défense en profondeur.
//
// Réservé aux admins OZË (contrairement à delete-reseller-contact, qui
// autorise aussi le contact principal pour SES PROPRES sous-comptes — ici
// c'est l'entreprise entière qui est désactivée).
// Déploiement : `supabase functions deploy deactivate-reseller`

import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// GoTrue n'a pas de "ban permanent" dédié : une durée très longue en fait
// l'équivalent en pratique (un admin pourrait toujours débannir manuellement
// depuis le dashboard Supabase si besoin).
const PERMANENT_BAN_DURATION = '876000h';

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
      return new Response(JSON.stringify({ error: 'Accès refusé : réservé aux administrateurs OZË' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { reseller_id } = await req.json();
    if (!reseller_id) {
      return new Response(JSON.stringify({ error: 'reseller_id est requis' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    const { data: reseller, error: resellerError } = await adminClient
      .from('resellers')
      .select('id, status')
      .eq('id', reseller_id)
      .maybeSingle();

    if (resellerError) {
      return new Response(JSON.stringify({ error: resellerError.message }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    if (!reseller) {
      return new Response(JSON.stringify({ error: 'Revendeur introuvable' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    if (reseller.status === 'deleted') {
      return new Response(JSON.stringify({ success: true, already_deleted: true }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { data: contacts, error: contactsError } = await adminClient
      .from('reseller_contacts')
      .select('profile_id')
      .eq('reseller_id', reseller_id);

    if (contactsError) {
      return new Response(JSON.stringify({ error: contactsError.message }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Bannit chaque contact individuellement — une erreur isolée sur un
    // compte ne doit pas empêcher de traiter les autres ni de désactiver
    // l'entreprise (au pire, ce contact précis garde son accès et devra être
    // banni manuellement, mais l'entreprise disparaît bien de la liste).
    const banErrors: string[] = [];
    for (const contact of contacts || []) {
      const { error: banError } = await adminClient.auth.admin.updateUserById(contact.profile_id, {
        ban_duration: PERMANENT_BAN_DURATION,
      });
      if (banError) {
        banErrors.push(`${contact.profile_id}: ${banError.message}`);
      }
    }

    const { error: statusError } = await adminClient
      .from('resellers')
      .update({ status: 'deleted' })
      .eq('id', reseller_id);

    if (statusError) {
      return new Response(JSON.stringify({ error: statusError.message }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ success: true, ban_errors: banErrors.length > 0 ? banErrors : undefined }), {
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
