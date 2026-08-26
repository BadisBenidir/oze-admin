// Edge Function : sendcloud-download-label
//
// Le `label_url` renvoyé par l'API Sendcloud (documents[].link, voir
// generate-b2b-shipment-labels) pointe vers panel.sendcloud.sc mais reste un
// endpoint d'API protégé par Basic Auth (SENDCLOUD_PUBLIC_KEY/SECRET_KEY) —
// PAS une page nécessitant une session panel authentifiée. Ouvrir ce lien
// directement dans le navigateur du client échoue donc en 401
// "not_authenticated" (aucun header d'auth envoyé par un simple <a href>).
// Cette fonction proxy le récupère côté serveur avec les clés API et
// retransmet le flux PDF binaire au client déjà authentifié (admin OZË).
//
// Déploiement : `supabase functions deploy sendcloud-download-label`

import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

// N'accepte que des URLs Sendcloud réelles — jamais une URL arbitraire
// fournie par le client (évite qu'un proxy authentifié par nos clés API ne
// serve de relais SSRF vers un hôte tiers).
const isSendcloudUrl = (raw: string): boolean => {
  try {
    const u = new URL(raw);
    return u.protocol === 'https:' && /(^|\.)sendcloud\.sc$/i.test(u.hostname);
  } catch {
    return false;
  }
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const sendcloudPublicKey = Deno.env.get('SENDCLOUD_PUBLIC_KEY');
    const sendcloudSecretKey = Deno.env.get('SENDCLOUD_SECRET_KEY');

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Non authentifié' }, 401);

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
      return json({ error: 'Action réservée aux administrateurs' }, 403);
    }

    if (!sendcloudPublicKey || !sendcloudSecretKey) {
      return json({ error: 'Clés Sendcloud manquantes côté serveur' }, 500);
    }

    const { label_url } = await req.json().catch(() => ({}));
    if (!label_url || typeof label_url !== 'string' || !isSendcloudUrl(label_url)) {
      return json({ error: 'label_url invalide' }, 400);
    }

    const upstream = await fetch(label_url, {
      headers: { Authorization: 'Basic ' + btoa(`${sendcloudPublicKey}:${sendcloudSecretKey}`) },
    });

    if (!upstream.ok) {
      const detail = await upstream.text().catch(() => '');
      return json({ error: `Échec de récupération du bordereau auprès de Sendcloud (${upstream.status})${detail ? ' — ' + detail : ''}` }, upstream.status === 401 || upstream.status === 403 ? 502 : upstream.status);
    }

    const pdfBytes = await upstream.arrayBuffer();
    return new Response(pdfBytes, {
      status: 200,
      headers: {
        ...corsHeaders,
        'Content-Type': upstream.headers.get('content-type') || 'application/pdf',
        'Content-Disposition': 'inline; filename="bordereau.pdf"',
      },
    });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'Erreur inconnue' }, 500);
  }
});
