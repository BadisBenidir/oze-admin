// Edge Function : impersonate-member
//
// « Voir son espace » : le PROPRIÉTAIRE (role 'admin' — jamais un employé)
// ouvre le portail pro connecté en tant qu'un membre, pour voir exactement
// ce qu'il voit. Génère un lien de connexion magique à usage unique
// (auth.admin.generateLink, aucun email envoyé) vers pro.ozeparis.com ;
// la session admin (admin.ozeparis.com, autre origine) n'est pas touchée.
// Toute action faite dans cet onglet l'est AU NOM DU MEMBRE (achat,
// enchère…) : réservé à la consultation. Chaque génération est journalisée.
// Corps : { profile_id }.
// Déploiement : `supabase functions deploy impersonate-member`

import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

const PRO_URL = 'https://pro.ozeparis.com';

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Non authentifié' }, 401);

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const callerClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user } } = await callerClient.auth.getUser();
    if (!user) return json({ error: 'Non authentifié' }, 401);
    const { data: me } = await callerClient.from('profiles').select('role').eq('id', user.id).maybeSingle();
    if (me?.role !== 'admin') return json({ error: 'Réservé au propriétaire du compte' }, 403);

    const { profile_id } = await req.json();
    if (!profile_id) return json({ error: 'profile_id requis' }, 400);

    const admin = createClient(supabaseUrl, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const { data: target } = await admin.from('profiles').select('email, role').eq('id', profile_id).maybeSingle();
    if (!target?.email) return json({ error: 'Membre introuvable' }, 404);
    if (target.role !== 'reseller') return json({ error: 'Seuls les comptes membres (portail pro) peuvent être ouverts' }, 400);

    const { data, error } = await admin.auth.admin.generateLink({
      type: 'magiclink',
      email: target.email,
      options: { redirectTo: `${PRO_URL}/catalogue` },
    });
    if (error || !data?.properties?.action_link) {
      return json({ error: error?.message || 'Lien de connexion impossible à générer' }, 400);
    }

    console.log(`[impersonate-member] ${user.email} ouvre l'espace de ${target.email} (${profile_id})`);
    return json({ url: data.properties.action_link });
  } catch (err) {
    console.error('impersonate-member: erreur', err instanceof Error ? err.stack || err.message : err);
    return json({ error: err instanceof Error ? err.message : 'Erreur inconnue' }, 500);
  }
});
