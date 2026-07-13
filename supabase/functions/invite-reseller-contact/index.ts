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

    // Client admin (clé service-role) : seul habilité à créer/modifier un utilisateur Auth.
    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    const COOLDOWN_MS = 30 * 1000;
    const inviteRedirectTo = 'https://pro.ozeparis.com/accept-invite';

    // On vérifie D'ABORD si un compte existe déjà pour cet email, pour
    // pouvoir gérer proprement le renvoi d'invitation et l'anti-spam avant
    // toute tentative de création (qui échouerait sinon sur "email déjà
    // utilisé" sans aucun moyen de s'en sortir).
    const { data: listResult, error: listError } = await adminClient.auth.admin.listUsers({ perPage: 1000 });
    if (listError) {
      return new Response(JSON.stringify({ error: listError.message }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const existingUser = listResult?.users.find((u) => u.email?.toLowerCase() === String(email).toLowerCase());

    let newUserId: string;
    // Le mot de passe est fixé directement par l'admin : le compte est donc
    // utilisable immédiatement, sans étape d'activation par email.
    const activatedAt: string | null = password ? new Date().toISOString() : null;
    let contactAlreadyLinked = false;

    if (existingUser) {
      const { data: existingProfile } = await adminClient
        .from('profiles')
        .select('role, activated_at, last_invited_at')
        .eq('id', existingUser.id)
        .maybeSingle();

      // Compte existant d'un autre type (admin/client) : jamais réassigné
      // silencieusement à un rôle revendeur.
      if (existingProfile && existingProfile.role !== 'reseller') {
        return new Response(JSON.stringify({ error: `Cet email est déjà utilisé par un compte existant (rôle : ${existingProfile.role}). Utilise une autre adresse email.` }), {
          status: 409,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Compte revendeur déjà pleinement activé : rien à faire, il doit se
      // connecter normalement (ou passer par "mot de passe oublié").
      if (existingProfile?.activated_at) {
        return new Response(JSON.stringify({ error: 'Ce compte est déjà actif.' }), {
          status: 409,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const { data: existingContact } = await adminClient
        .from('reseller_contacts')
        .select('reseller_id')
        .eq('profile_id', existingUser.id)
        .maybeSingle();

      if (existingContact && existingContact.reseller_id !== reseller_id) {
        return new Response(JSON.stringify({ error: 'Cet email est déjà rattaché à un autre revendeur.' }), {
          status: 409,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      if (password) {
        // Compte jamais activé, sûr à réutiliser : l'admin lui fixe un mot
        // de passe directement, le compte devient utilisable tout de suite.
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
        newUserId = existingUser.id;
        contactAlreadyLinked = Boolean(existingContact);
      } else {
        // Renvoi d'invitation par email : protégé par un cooldown pour
        // éviter le spam en cas de double-clic ou de tentatives répétées.
        if (existingProfile?.last_invited_at) {
          const elapsedMs = Date.now() - new Date(existingProfile.last_invited_at).getTime();
          if (elapsedMs < COOLDOWN_MS) {
            return new Response(JSON.stringify({ error: 'Veuillez patienter 30 secondes avant de renvoyer une nouvelle invitation.' }), {
              status: 429,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
          }
        }

        // Supabase n'offre pas de "renvoyer l'invitation" pour un compte
        // existant : on supprime le compte jamais activé (aucune perte,
        // aucun contact ni commande n'a jamais pu lui être rattaché) puis on
        // en recrée un, ce qui régénère un token frais et redéclenche
        // l'envoi de l'email (même modèle FR, même lien signé). La
        // suppression du profil entraîne aussi celle de l'éventuel contact
        // orphelin (contrainte ON DELETE CASCADE).
        const { error: deleteError } = await adminClient.auth.admin.deleteUser(existingUser.id);
        if (deleteError) {
          return new Response(JSON.stringify({ error: deleteError.message }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
        await adminClient.from('profiles').delete().eq('id', existingUser.id);

        const { data: recreated, error: recreateError } = await adminClient.auth.admin.inviteUserByEmail(email, {
          data: { first_name: first_name ?? '', last_name: last_name ?? '' },
          redirectTo: inviteRedirectTo,
        });
        if (recreateError || !recreated?.user) {
          return new Response(JSON.stringify({ error: recreateError?.message ?? "Échec du renvoi de l'invitation" }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
        newUserId = recreated.user.id;
      }
    } else {
      // Aucun compte existant pour cet email : création normale. Deux modes
      // — soit l'admin fixe lui-même le mot de passe (compte utilisable
      // immédiatement, aucun email envoyé), soit on envoie une invitation
      // par email classique (le revendeur choisit son mot de passe via le
      // lien reçu, voir AcceptInvite.tsx).
      const { data: created, error: createError } = password
        ? await adminClient.auth.admin.createUser({
            email,
            password,
            email_confirm: true,
            user_metadata: { first_name: first_name ?? '', last_name: last_name ?? '' },
          })
        : await adminClient.auth.admin.inviteUserByEmail(email, {
            data: { first_name: first_name ?? '', last_name: last_name ?? '' },
            redirectTo: inviteRedirectTo,
          });

      if (createError || !created?.user) {
        return new Response(JSON.stringify({ error: createError?.message ?? "Échec de la création de l'utilisateur" }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
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
        activated_at: activatedAt,
        last_invited_at: password ? null : new Date().toISOString(),
      });

    if (profileError) {
      return new Response(JSON.stringify({ error: profileError.message }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!contactAlreadyLinked) {
      const { error: contactError } = await adminClient
        .from('reseller_contacts')
        .insert({ reseller_id, profile_id: newUserId, is_primary: finalIsPrimary });

      if (contactError) {
        return new Response(JSON.stringify({ error: contactError.message }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
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
