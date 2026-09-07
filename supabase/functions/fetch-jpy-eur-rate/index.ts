// Edge Function : fetch-jpy-eur-rate
//
// Récupère le taux de change JPY -> EUR du jour (api.frankfurter.app, taux
// de référence BCE, sans clé) et l'enregistre dans jpy_eur_rates
// (0113_jpy_eur_rate_history.sql), une ligne par jour (upsert sur
// rate_date) — tous les articles créés le même jour utilisent donc le même
// taux, peu importe combien de fois cette fonction est appelée.
//
// Deux modes d'appel : quotidien via pg_cron (net.http_post, aucun JWT —
// d'où l'usage de la clé service-role, jamais d'authentification requise
// ici, la donnée écrite est un simple taux de change public) et manuel
// depuis le dashboard admin (bouton "Rafraîchir", useJpyEurRate.refreshNow).
// Déploiement : `supabase functions deploy fetch-jpy-eur-rate`

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

    const res = await fetch('https://api.frankfurter.app/latest?from=JPY&to=EUR');
    if (!res.ok) {
      throw new Error(`API frankfurter.app indisponible (${res.status})`);
    }
    const payload = await res.json();
    const rate = payload?.rates?.EUR;
    if (typeof rate !== 'number' || !(rate > 0)) {
      throw new Error('Taux JPY/EUR invalide reçu de frankfurter.app');
    }

    const rateDate = new Date().toISOString().slice(0, 10);

    const { error: upsertError } = await adminClient
      .from('jpy_eur_rates')
      .upsert({ rate_date: rateDate, rate, fetched_at: new Date().toISOString() }, { onConflict: 'rate_date' });

    if (upsertError) {
      throw new Error(upsertError.message);
    }

    return new Response(JSON.stringify({ success: true, rate_date: rateDate, rate }), {
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
