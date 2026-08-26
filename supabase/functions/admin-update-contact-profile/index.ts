// Edge Function : admin-update-contact-profile
//
// Modifie les coordonnées (nom/téléphone/adresse de livraison) d'un
// sous-compte revendeur précis, à l'initiative d'un admin OZË. Clé
// service-role requise : un admin doit pouvoir éditer N'IMPORTE QUEL
// sous-compte, pas seulement le sien — même prudence que
// update-reseller-contact-email (vérifie que la cible est bien un compte
// revendeur avant d'écrire). L'email se change séparément via
// update-reseller-contact-email (touche aussi Supabase Auth, pas seulement
// la table profiles).
// Déploiement : `supabase functions deploy admin-update-contact-profile`

import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Non authentifié' }, 401);

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;

    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userError } = await callerClient.auth.getUser();
    if (userError || !user) return json({ error: 'Non authentifié' }, 401);

    const { data: callerProfile } = await callerClient
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .maybeSingle();
    if (callerProfile?.role !== 'admin') {
      return json({ error: 'Accès refusé : réservé aux administrateurs' }, 403);
    }

    const { profile_id, first_name, last_name, phone, address, city, postal_code, country } = await req.json();
    if (!profile_id) return json({ error: 'profile_id est requis' }, 400);

    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    const { data: targetProfile } = await adminClient
      .from('profiles')
      .select('role')
      .eq('id', profile_id)
      .maybeSingle();
    if (targetProfile?.role !== 'reseller') {
      return json({ error: "Ce compte n'est pas un compte revendeur" }, 400);
    }

    const payload: Record<string, unknown> = {};
    if (first_name !== undefined) payload.first_name = String(first_name).trim();
    if (last_name !== undefined) payload.last_name = String(last_name).trim();
    if (phone !== undefined) payload.phone = String(phone).trim() || null;
    if (address !== undefined) payload.address = String(address).trim() || null;
    if (city !== undefined) payload.city = String(city).trim() || null;
    if (postal_code !== undefined) payload.postal_code = String(postal_code).trim() || null;
    if (country !== undefined) payload.country = String(country).trim() || null;

    const { error: updateError } = await adminClient
      .from('profiles')
      .update(payload)
      .eq('id', profile_id);

    if (updateError) return json({ error: updateError.message }, 400);

    return json({ success: true });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'Erreur inconnue' }, 500);
  }
});
