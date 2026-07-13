// Edge Function : invite-reseller-contact
//
// Crée un compte de connexion pour un contact revendeur (rôle "reseller") et
// le rattache à une entreprise `resellers`. Nécessite la clé service-role
// (création d'utilisateur Auth) : ne peut donc pas être fait côté client.
// Déploiement : `supabase functions deploy invite-reseller-contact`

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

    // Client "appelant" (clé anon + JWT de la requête) : sert uniquement à
    // vérifier que l'appelant est bien un admin, avant toute opération privilégiée.
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

    const { reseller_id, email, first_name, last_name, password, is_primary } = await req.json();
    if (!reseller_id || !email) {
      return new Response(JSON.stringify({ error: 'reseller_id et email sont requis' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    if (password && password.length < 8) {
      return new Response(JSON.stringify({ error: 'Le mot de passe doit contenir au moins 8 caractères' }), {
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

    // Un admin OZË peut créer un contact pour n'importe quel revendeur. Un
    // contact "principal" (is_primary) peut créer des comptes UNIQUEMENT
    // pour sa propre entreprise, tant qu'elle est active — c'est ce qui
    // permet à un revendeur de gérer ses propres employés en autonomie.
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
        callerContact.reseller_id === reseller_id &&
        callerReseller?.status === 'active'
      );
    }

    if (!isAdmin && !isPrimaryOfSameReseller) {
      return new Response(JSON.stringify({ error: 'Accès refusé : réservé aux administrateurs ou au contact principal de cette entreprise' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Seul un admin OZË peut désigner un contact "principal" : un contact
    // créé par un revendeur pour son équipe n'est jamais principal.
    const finalIsPrimary = isAdmin ? Boolean(is_primary) : false;

    // Client admin (clé service-role) : seul habilité à créer un utilisateur Auth.
    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    // Deux modes : soit l'admin fixe lui-même le mot de passe (le revendeur
    // peut se connecter immédiatement, aucun email envoyé), soit on envoie
    // une invitation par email classique (le revendeur choisit son mot de
    // passe via le lien reçu).
    const { data: created, error: createError } = password
      ? await adminClient.auth.admin.createUser({
          email,
          password,
          email_confirm: true,
          user_metadata: { first_name: first_name ?? '', last_name: last_name ?? '' },
        })
      : await adminClient.auth.admin.inviteUserByEmail(email, {
          data: { first_name: first_name ?? '', last_name: last_name ?? '' },
        });

    let newUserId: string;

    if (createError || !created?.user) {
      const emailAlreadyUsed =
        createError?.code === 'email_exists' || /already.*registered/i.test(createError?.message ?? '');

      if (!emailAlreadyUsed) {
        return new Response(JSON.stringify({ error: createError?.message ?? "Échec de la création de l'utilisateur" }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // L'email correspond déjà à un utilisateur Auth existant : plutôt que
      // d'échouer sans recours, on va voir si ce compte peut être "adopté"
      // comme contact revendeur (cas fréquent : une tentative précédente a
      // échoué à mi-chemin et a laissé le compte Auth orphelin, sans profil
      // ni rattachement). On ne l'adopte QUE s'il n'a aucun rôle conflictuel
      // ni contact revendeur existant, pour ne jamais réassigner le compte
      // de quelqu'un d'autre (client ou admin) silencieusement.
      const { data: listResult, error: listError } = await adminClient.auth.admin.listUsers({ perPage: 1000 });
      const existingUser = listError
        ? undefined
        : listResult?.users.find((u) => u.email?.toLowerCase() === String(email).toLowerCase());

      if (!existingUser) {
        return new Response(JSON.stringify({ error: createError?.message ?? "Échec de la création de l'utilisateur" }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const { data: existingProfile } = await adminClient
        .from('profiles')
        .select('role')
        .eq('id', existingUser.id)
        .maybeSingle();

      if (existingProfile && existingProfile.role !== 'reseller') {
        return new Response(JSON.stringify({ error: `Cet email est déjà utilisé par un compte existant (rôle : ${existingProfile.role}). Utilise une autre adresse email.` }), {
          status: 409,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const { data: existingContact } = await adminClient
        .from('reseller_contacts')
        .select('reseller_id')
        .eq('profile_id', existingUser.id)
        .maybeSingle();

      if (existingContact) {
        return new Response(JSON.stringify({ error: existingContact.reseller_id === reseller_id ? 'Ce contact existe déjà pour ce revendeur.' : 'Cet email est déjà rattaché à un autre revendeur.' }), {
          status: 409,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Compte orphelin sûr à adopter : on met à jour le mot de passe si
      // fourni, puis on continue le flux normal (upsert profil + contact).
      if (password) {
        const { error: updateError } = await adminClient.auth.admin.updateUserById(existingUser.id, {
          password,
          email_confirm: true,
        });
        if (updateError) {
          return new Response(JSON.stringify({ error: updateError.message }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
      }

      newUserId = existingUser.id;
    } else {
      newUserId = created.user.id;
    }

    const { error: profileError } = await adminClient
      .from('profiles')
      .upsert({
        id: newUserId,
        email,
        first_name: first_name ?? '',
        last_name: last_name ?? '',
        role: 'reseller',
      });

    if (profileError) {
      return new Response(JSON.stringify({ error: profileError.message }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { error: contactError } = await adminClient
      .from('reseller_contacts')
      .insert({ reseller_id, profile_id: newUserId, is_primary: finalIsPrimary });

    if (contactError) {
      return new Response(JSON.stringify({ error: contactError.message }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ success: true, user_id: newUserId }), {
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
