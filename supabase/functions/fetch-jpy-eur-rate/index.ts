// Edge Function : fetch-jpy-eur-rate
//
// Récupère le taux de change JPY -> EUR (api.frankfurter.app, taux de
// référence BCE, sans clé) et l'enregistre dans jpy_eur_rates
// (0113_jpy_eur_rate_history.sql), une ligne par jour (upsert sur
// rate_date) — tous les articles créés le même jour utilisent donc le même
// taux, peu importe combien de fois cette fonction est appelée.
//
// Trois modes d'appel :
//   - quotidien via pg_cron (net.http_post, aucun JWT — d'où l'usage de la
//     clé service-role, jamais d'authentification requise ici, la donnée
//     écrite est un simple taux de change public) : récupère le taux du jour.
//   - manuel depuis le dashboard admin (bouton "Rafraîchir",
//     useJpyEurRate.refreshNow) : idem, à la demande.
//   - backfill ponctuel ({ backfill_days: N } dans le corps, bouton "Importer
//     l'historique", useJpyEurRate.backfillHistory) : récupère toute une
//     plage via l'endpoint "time series" de frankfurter.app en un seul appel,
//     pour peupler le graphique rétroactivement. Frankfurter (BCE) ne publie
//     rien le week-end/jours fériés — trous normaux dans la série.
// Déploiement : `supabase functions deploy fetch-jpy-eur-rate`

import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const toIsoDate = (d: Date): string => d.toISOString().slice(0, 10);

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    let backfillDays: number | null = null;
    if (req.method === 'POST') {
      const body = await req.json().catch(() => ({}));
      if (typeof body?.backfill_days === 'number' && body.backfill_days > 0) {
        backfillDays = Math.min(Math.floor(body.backfill_days), 3650);
      }
    }

    if (backfillDays) {
      const end = new Date();
      const start = new Date();
      start.setDate(start.getDate() - backfillDays);

      const res = await fetch(
        `https://api.frankfurter.app/${toIsoDate(start)}..${toIsoDate(end)}?from=JPY&to=EUR`
      );
      if (!res.ok) {
        throw new Error(`API frankfurter.app indisponible (${res.status})`);
      }
      const payload = await res.json();
      const rates = payload?.rates as Record<string, { EUR?: number }> | undefined;
      if (!rates || Object.keys(rates).length === 0) {
        throw new Error('Aucun historique reçu de frankfurter.app');
      }

      const rows = Object.entries(rates)
        .filter(([, v]) => typeof v?.EUR === 'number' && v.EUR > 0)
        .map(([date, v]) => ({ rate_date: date, rate: v.EUR as number, fetched_at: new Date().toISOString() }));

      const { error: upsertError } = await adminClient
        .from('jpy_eur_rates')
        .upsert(rows, { onConflict: 'rate_date' });

      if (upsertError) {
        throw new Error(upsertError.message);
      }

      return new Response(JSON.stringify({ success: true, imported: rows.length }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const res = await fetch('https://api.frankfurter.app/latest?from=JPY&to=EUR');
    if (!res.ok) {
      throw new Error(`API frankfurter.app indisponible (${res.status})`);
    }
    const payload = await res.json();
    const rate = payload?.rates?.EUR;
    if (typeof rate !== 'number' || !(rate > 0)) {
      throw new Error('Taux JPY/EUR invalide reçu de frankfurter.app');
    }

    const rateDate = toIsoDate(new Date());

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
